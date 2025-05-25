// File: api/index.js
'use strict';

const path = require('path');
const Fastify = require('fastify');
const fastifyView = require('@fastify/view');
const fastifyStatic = require('@fastify/static');
const handlebars = require('handlebars');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

// Load environment variables
dotenv.config();

// Initialize Fastify server
const app = Fastify({ 
  logger: true
});

// Import service modules
const raindropService = require('../services/raindrop');
const notionService = require('../services/notion');

// Password Protection Configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sync2025';

// GLOBAL SYNC LOCK VARIABLES
let GLOBAL_SYNC_LOCK = false;
let SYNC_START_TIME = null;
let SYNC_LOCK_ID = null;

// Middleware to check password
function requirePassword(request, reply, done) {
  const password = request.query.password || request.headers.authorization?.replace('Bearer ', '');
  
  console.log(`Access attempt with password: ${password ? 'provided' : 'missing'}`);
  
  if (password !== ADMIN_PASSWORD) {
    console.log(`Access denied - incorrect password`);
    return reply.code(401).send({ 
      error: 'Unauthorized',
      message: 'Access denied. Please provide the correct password as a URL parameter: ?password=yourpassword'
    });
  }
  
  console.log(`Access granted with correct password`);
  done();
}

// Register template engine
app.register(fastifyView, {
  engine: { handlebars },
  root: path.join(__dirname, '../src/pages'),
  layout: false
});

// Serve static files
app.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/public/',
  decorateReply: false
});

// SYNC STATE MANAGEMENT
let currentSync = null;
const activeStreams = new Map();

// Helper function to send SSE data to all connected streams
function broadcastSSEData(data) {
  for (const [streamId, reply] of activeStreams.entries()) {
    try {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error(`Error sending to stream ${streamId}:`, error.message);
      activeStreams.delete(streamId);
    }
  }
}

// Helper function to send SSE data to a specific stream
function sendSSEData(reply, data) {
  try {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error('Error sending SSE data:', error);
  }
}

// Main dashboard route
app.get('/', { preHandler: requirePassword }, async (request, reply) => {
  try {
    return reply.view('index.hbs', {
      raindropTotal: '...',
      notionTotal: '...',
      isSynced: false,
      loading: true,
      password: request.query.password
    });
  } catch (error) {
    app.log.error(error);
    return reply.view('error.hbs', {
      error: error.message || 'Unknown error occurred',
      password: request.query.password
    });
  }
});

// API endpoint to get counts in background
app.get('/api/counts', { preHandler: requirePassword }, async (request, reply) => {
  try {
    console.log('📊 Fetching counts for dashboard...');
    
    const raindropTotal = await raindropService.getRaindropTotal();
    const notionTotal = await notionService.getTotalNotionPages();
    const isSynced = raindropTotal === notionTotal;

    return reply.send({
      raindropTotal,
      notionTotal,
      isSynced,
      success: true
    });
  } catch (error) {
    app.log.error('Error fetching counts:', error);
    return reply.code(500).send({
      success: false,
      error: error.message || 'Failed to fetch counts'
    });
  }
});

// Sync page routes (both incremental and full use same efficient logic)
app.get('/sync', { preHandler: requirePassword }, async (request, reply) => {
  const mode = request.query.mode || 'new';
  return reply.view('sync.hbs', { 
    mode,
    password: request.query.password
  });
});

app.get('/sync-all', { preHandler: requirePassword }, async (request, reply) => {
  const mode = 'all';
  return reply.view('sync-all.hbs', { 
    mode,
    password: request.query.password
  });
});

// SSE route for streaming sync updates
app.get('/sync-stream', { preHandler: requirePassword }, (request, reply) => {
  const mode = request.query.mode || 'new';
  const limit = parseInt(request.query.limit || '0', 10);
  const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  
  console.log(`🔗 NEW SYNC REQUEST: ${streamId}, mode: ${mode}`);
  
  // Set headers for SSE
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Add this stream to active streams
  activeStreams.set(streamId, reply);
  console.log(`📡 Client connected. Active streams: ${activeStreams.size}`);
  
  // Keepalive interval
  const keepAliveInterval = setInterval(() => {
    if (activeStreams.has(streamId)) {
      try {
        reply.raw.write(": keepalive\n\n");
      } catch (error) {
        clearInterval(keepAliveInterval);
        activeStreams.delete(streamId);
      }
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 30000);
  
  // Check if another sync is running
  if (GLOBAL_SYNC_LOCK) {
    const lockDuration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    console.log(`🚫 SYNC LOCK ACTIVE - Lock ID: ${SYNC_LOCK_ID}, Duration: ${lockDuration}s`);
    
    sendSSEData(reply, {
      message: `⏸️ Sync already running (${lockDuration}s elapsed). Please wait...`,
      type: 'waiting',
      lockInfo: { locked: true, lockId: SYNC_LOCK_ID, duration: lockDuration }
    });
    return;
  }
  
  if (currentSync && currentSync.isRunning) {
    const syncDuration = Math.round((Date.now() - currentSync.startTime) / 1000);
    console.log(`🚫 CURRENT SYNC RUNNING - Duration: ${syncDuration}s`);
    
    sendSSEData(reply, {
      message: `⏸️ Sync in progress (${syncDuration}s). Please wait...`,
      counts: currentSync.counts || { added: 0, updated: 0, skipped: 0 },
      type: 'waiting'
    });
    return;
  }
  
  // Set global lock
  GLOBAL_SYNC_LOCK = true;
  SYNC_START_TIME = Date.now();
  SYNC_LOCK_ID = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  console.log(`🔐 SETTING SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
  
  // Create new sync process
  currentSync = {
    mode,
    limit,
    isRunning: true,
    lockId: SYNC_LOCK_ID,
    startTime: Date.now(),
    counts: { added: 0, updated: 0, skipped: 0, deleted: 0 },
    completed: false
  };
  
  // Start sync process
  performSmartDiffSync(mode, limit)
    .then(() => {
      console.log(`✅ Sync completed successfully - Lock ID: ${SYNC_LOCK_ID}`);
    })
    .catch(error => {
      console.error(`❌ SYNC ERROR - Lock ID: ${SYNC_LOCK_ID}:`, error);
      broadcastSSEData({
        message: `Sync failed: ${error.message}`,
        type: 'failed',
        complete: true
      });
    })
    .finally(() => {
      // Always release lock
      console.log(`🔓 RELEASING SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
      GLOBAL_SYNC_LOCK = false;
      SYNC_START_TIME = null;
      SYNC_LOCK_ID = null;
      
      if (currentSync) {
        currentSync.isRunning = false;
        currentSync = null;
      }
    });
  
  // Handle client disconnect
  request.raw.on('close', () => {
    if (activeStreams.has(streamId)) {
      console.log(`📡 Client disconnected: ${streamId}`);
      activeStreams.delete(streamId);
    }
    clearInterval(keepAliveInterval);
  });
});

// OPTIMIZED SMART DIFF SYNC FUNCTION
async function performSmartDiffSync(mode, limit) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🧠 Smart Diff Sync starting - Lock ID: ${lockId}, mode: ${mode}`);
  
  if (!GLOBAL_SYNC_LOCK) {
    throw new Error('Sync started without global lock - aborting');
  }
  
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  
  try {
    const isFullSync = mode === 'all';
    
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🧠 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { added: addedCount, updated: updatedCount, skipped: skippedCount, deleted: deletedCount },
        lockInfo: {
          locked: GLOBAL_SYNC_LOCK,
          lockId: lockId,
          duration: SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0
        }
      };
      
      // Update current sync state
      if (currentSync) {
        currentSync.counts = updateData.counts;
      }
      
      broadcastSSEData(updateData);
    };
    
    sendUpdate(`🧠 Starting Smart Diff Sync (${isFullSync ? 'full' : 'incremental'})`, 'info');
    
    // === STEP 1: FETCH ALL DATA (EFFICIENT) ===
    sendUpdate('📡 Fetching raindrops...', 'fetching');
    let raindrops = [];
    try {
      if (mode === 'new') {
        raindrops = await raindropService.getRecentRaindrops();
      } else if (mode === 'dev') {
        raindrops = await raindropService.getAllRaindrops(limit || 5);
      } else {
        raindrops = await raindropService.getAllRaindrops(limit);
      }
    } catch (error) {
      throw new Error(`Failed to fetch raindrops: ${error.message}`);
    }
    
    sendUpdate(`✅ Found ${raindrops.length} raindrops`, 'success');
    
    if (raindrops.length === 0) {
      sendUpdate('No raindrops to process. Sync complete.', 'complete');
      broadcastSSEData({ complete: true });
      return;
    }
    
    sendUpdate('📡 Fetching Notion pages...', 'fetching');
    let notionPages = [];
    try {
      notionPages = await notionService.getNotionPages();
    } catch (error) {
      throw new Error(`Failed to fetch Notion pages: ${error.message}`);
    }
    
    sendUpdate(`✅ Found ${notionPages.length} Notion pages`, 'success');
    
    // === STEP 2: BUILD LOOKUP MAPS ===
    sendUpdate('🗺️ Building lookup maps...', 'processing');
    const { notionPagesByUrl, notionPagesByTitle, raindropUrlSet } = 
      buildLookupMaps(notionPages, raindrops);
    
    // === STEP 3: SMART DIFF ANALYSIS ===
    sendUpdate('🔍 Performing Smart Diff analysis...', 'processing');
    
    const itemsToAdd = [];
    const itemsToUpdate = [];
    const itemsToSkip = [];
    const pagesToDelete = [];
    
    // Analyze raindrops for changes
    for (const item of raindrops) {
      const normUrl = normalizeUrl(item.link);
      const normTitle = normalizeTitle(item.title);
      
      const existingPage = notionPagesByUrl.get(normUrl) || notionPagesByTitle.get(normTitle);
      
      if (existingPage) {
        // Check if update needed
        const currentTitle = existingPage.properties?.Name?.title?.[0]?.text?.content || '';
        const currentUrl = existingPage.properties?.URL?.url || '';
        
        const currentTags = new Set();
        if (existingPage.properties?.Tags?.multi_select) {
          existingPage.properties.Tags.multi_select.forEach(tag => {
            currentTags.add(tag.name);
          });
        }
        
        const needsUpdate = 
          (normalizeTitle(currentTitle) !== normalizeTitle(item.title)) ||
          (normalizeUrl(currentUrl) !== normUrl) ||
          !tagsMatch(currentTags, item.tags || []);
        
        if (needsUpdate) {
          itemsToUpdate.push({ item, existingPage });
        } else {
          itemsToSkip.push(item);
        }
      } else {
        itemsToAdd.push(item);
      }
    }
    
    // Find pages to delete (full sync only)
    if (isFullSync) {
      for (const [url, page] of notionPagesByUrl.entries()) {
        if (!raindropUrlSet.has(url)) {
          pagesToDelete.push(page);
        }
      }
    }
    
    const totalOperations = itemsToAdd.length + itemsToUpdate.length + pagesToDelete.length;
    skippedCount = itemsToSkip.length;
    
    sendUpdate(`🔍 Smart Diff complete: ${itemsToAdd.length} to add, ${itemsToUpdate.length} to update, ${itemsToSkip.length} to skip, ${pagesToDelete.length} to delete`, 'analysis');
    
    if (totalOperations === 0) {
      sendUpdate('🎉 Everything already in sync! No changes needed.', 'complete');
      broadcastSSEData({ complete: true, counts: { added: 0, updated: 0, skipped: skippedCount, deleted: 0 } });
      return;
    }
    
    const efficiency = Math.round((totalOperations / raindrops.length) * 100);
    sendUpdate(`🚀 Processing ${totalOperations} operations (${efficiency}% efficiency vs 100% in old system)`, 'info');
    
    // === STEP 4: PROCESS ONLY THE DIFFERENCES ===
    
    // Process additions
    if (itemsToAdd.length > 0) {
      sendUpdate(`➕ Creating ${itemsToAdd.length} new pages...`, 'processing');
      
      const addBatches = chunkArray(itemsToAdd, 3);
      for (let i = 0; i < addBatches.length; i++) {
        const batch = addBatches[i];
        
        for (const item of batch) {
          try {
            const result = await notionService.createNotionPage(item);
            if (result.success) {
              sendUpdate(`✅ Created: "${item.title}"`, 'added');
              addedCount++;
              // Update lookup maps for subsequent operations
              notionPagesByUrl.set(normalizeUrl(item.link), { id: result.pageId });
              notionPagesByTitle.set(normalizeTitle(item.title), { id: result.pageId });
            } else {
              sendUpdate(`❌ Failed to create: "${item.title}"`, 'failed');
              failedCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
          } catch (error) {
            sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Process updates
    if (itemsToUpdate.length > 0) {
      sendUpdate(`🔄 Updating ${itemsToUpdate.length} existing pages...`, 'processing');
      
      const updateBatches = chunkArray(itemsToUpdate, 3);
      for (let i = 0; i < updateBatches.length; i++) {
        const batch = updateBatches[i];
        
        for (const { item, existingPage } of batch) {
          try {
            const success = await notionService.updateNotionPage(existingPage.id, item);
            if (success) {
              sendUpdate(`🔄 Updated: "${item.title}"`, 'updated');
              updatedCount++;
            } else {
              sendUpdate(`❌ Failed to update: "${item.title}"`, 'failed');
              failedCount++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
          } catch (error) {
            sendUpdate(`❌ Error updating "${item.title}": ${error.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Process deletions
    if (pagesToDelete.length > 0) {
      sendUpdate(`🗑️ Deleting ${pagesToDelete.length} obsolete pages...`, 'processing');
      
      const deleteBatches = chunkArray(pagesToDelete, 2);
      for (let i = 0; i < deleteBatches.length; i++) {
        const batch = deleteBatches[i];
        
        for (const page of batch) {
          try {
            const url = page.properties?.URL?.url || 'Unknown URL';
            await notionService.deleteNotionPage(page.id);
            sendUpdate(`🗑️ Deleted: ${url}`, 'deleted');
            deletedCount++;
            await new Promise(resolve => setTimeout(resolve, 500));
            
          } catch (error) {
            sendUpdate(`❌ Error deleting page: ${error.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    }
    
    // Final summary
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    const finalEfficiency = Math.round((totalOperations / raindrops.length) * 100);
    
    sendUpdate(`🎉 Smart Diff Sync completed in ${duration}s!`, 'complete');
    sendUpdate(`📊 Efficiency: ${totalOperations}/${raindrops.length} items processed (${finalEfficiency}% vs 100% in old system)`, 'info');
    sendUpdate(`📈 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${deletedCount} deleted, ${failedCount} failed`, 'summary');
    
    console.log(`✅ [${lockId}] SMART DIFF COMPLETE: ${duration}s, ${finalEfficiency}% efficiency`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, deleted: deletedCount, failed: failedCount },
      efficiency: { itemsProcessed: totalOperations, totalItems: raindrops.length, percentage: finalEfficiency, duration }
    });
    
  } catch (error) {
    console.error(`❌ [${lockId}] SMART DIFF ERROR:`, error);
    broadcastSSEData({
      message: `Smart Diff Sync failed: ${error.message}`,
      type: 'failed',
      complete: true
    });
    throw error;
  }
}

// Helper function to build lookup maps
function buildLookupMaps(notionPages, raindrops) {
  const notionPagesByUrl = new Map();
  const notionPagesByTitle = new Map();
  const raindropUrlSet = new Set();
  
  // Process Notion pages
  for (const page of notionPages) {
    const url = page.properties?.URL?.url;
    const title = page.properties?.Name?.title?.[0]?.text?.content;
    
    if (url) {
      notionPagesByUrl.set(normalizeUrl(url), page);
    }
    
    if (title) {
      notionPagesByTitle.set(normalizeTitle(title), page);
    }
  }
  
  // Process raindrops
  for (const item of raindrops) {
    raindropUrlSet.add(normalizeUrl(item.link));
  }
  
  return { notionPagesByUrl, notionPagesByTitle, raindropUrlSet };
}

// Helper function to compare tags
function tagsMatch(currentTags, newTags) {
  if (currentTags.size !== newTags.length) {
    return false;
  }
  
  for (const tag of newTags) {
    if (!currentTags.has(tag)) {
      return false;
    }
  }
  
  return true;
}

// Helper function to normalize URLs
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return url;
  }
}

// Helper function to normalize titles
function normalizeTitle(title) {
  return (title || '').trim().toLowerCase();
}

// Helper function to chunk arrays
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// Utility routes
app.get('/ping', async (request, reply) => {
  return { status: 'ok' };
});

app.get('/diagnostic', { preHandler: requirePassword }, async (request, reply) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    sync_status: {
      active_sync: currentSync ? {
        mode: currentSync.mode,
        started: new Date(currentSync.startTime).toISOString(),
        completed: currentSync.completed,
        isRunning: currentSync.isRunning,
        counts: currentSync.counts
      } : null,
      active_streams: activeStreams.size,
      global_sync_lock: GLOBAL_SYNC_LOCK,
      sync_lock_id: SYNC_LOCK_ID
    },
    environment_variables: {
      RAINDROP_TOKEN: process.env.RAINDROP_TOKEN ? 'Set ✓' : 'Missing ✗',
      NOTION_TOKEN: process.env.NOTION_TOKEN ? 'Set ✓' : 'Missing ✗',
      NOTION_DB_ID: process.env.NOTION_DB_ID ? 'Set ✓' : 'Missing ✗',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? 'Set ✓' : 'Using default'
    },
    api_tests: {}
  };

  // Test API connections
  try {
    const raindropTotal = await raindropService.getRaindropTotal();
    diagnostics.api_tests.raindrop = {
      status: 'Connected ✓',
      total_items: raindropTotal,
      message: 'Successfully connected to Raindrop.io API'
    };
  } catch (error) {
    diagnostics.api_tests.raindrop = {
      status: 'Failed ✗',
      error: error.message,
      message: 'Unable to connect to Raindrop.io API'
    };
  }

  try {
    const notionTotal = await notionService.getTotalNotionPages();
    diagnostics.api_tests.notion = {
      status: 'Connected ✓',
      total_pages: notionTotal,
      message: 'Successfully connected to Notion API'
    };
  } catch (error) {
    diagnostics.api_tests.notion = {
      status: 'Failed ✗',
      error: error.message,
      message: 'Unable to connect to Notion API'
    };
  }

  return reply
    .header('Content-Type', 'application/json')
    .send(JSON.stringify(diagnostics, null, 2));
});

app.get('/sync-debug', { preHandler: requirePassword }, async (request, reply) => {
  const debug = {
    timestamp: new Date().toISOString(),
    globalSyncLock: GLOBAL_SYNC_LOCK || false,
    syncStartTime: SYNC_START_TIME,
    syncLockId: SYNC_LOCK_ID,
    currentSync: currentSync ? {
      mode: currentSync.mode,
      isRunning: currentSync.isRunning,
      completed: currentSync.completed,
      lockId: currentSync.lockId,
      startTime: new Date(currentSync.startTime).toISOString(),
      counts: currentSync.counts
    } : null,
    activeStreams: {
      count: activeStreams.size,
      streamIds: Array.from(activeStreams.keys())
    },
    suggestions: []
  };
  
  if (GLOBAL_SYNC_LOCK) {
    const lockDuration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    debug.suggestions.push(`Sync locked for ${lockDuration}s - this is normal during active sync`);
  }
  
  if (activeStreams.size > 1) {
    debug.suggestions.push(`⚠️ Multiple streams (${activeStreams.size}) detected`);
  }
  
  if (!GLOBAL_SYNC_LOCK && !currentSync) {
    debug.suggestions.push('✅ No active sync - ready to start new sync');
  }
  
  return reply
    .header('Content-Type', 'application/json')
    .send(JSON.stringify(debug, null, 2));
});

app.get('/test-sync-lock', { preHandler: requirePassword }, async (request, reply) => {
  const action = request.query.action;
  
  if (action === 'set') {
    GLOBAL_SYNC_LOCK = true;
    SYNC_START_TIME = Date.now();
    SYNC_LOCK_ID = `test_${Date.now()}`;
    return reply.send({ message: 'Lock set', lockId: SYNC_LOCK_ID });
  }
  
  if (action === 'clear') {
    GLOBAL_SYNC_LOCK = false;
    SYNC_START_TIME = null;
    const oldLockId = SYNC_LOCK_ID;
    SYNC_LOCK_ID = null;
    return reply.send({ message: 'Lock cleared', previousLockId: oldLockId });
  }
  
  return reply.send({ 
    message: 'Use ?action=set or ?action=clear', 
    currentLock: GLOBAL_SYNC_LOCK,
    lockId: SYNC_LOCK_ID 
  });
});

// Start the server
const start = async () => {
  try {
    await app.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    console.log(`🚀 Server running at http://localhost:${process.env.PORT || 3000}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
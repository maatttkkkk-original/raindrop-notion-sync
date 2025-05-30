// Optimized Fastify server with PROVEN WORKING SYNC + Robust EventSource
const path = require('path');
const Fastify = require('fastify');
const handlebars = require('handlebars');

const fastify = Fastify({ logger: true });

// Import the PROVEN WORKING sync functions
const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

// Helper functions from working version
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

function normalizeTitle(title) {
  return (title || '').trim().toLowerCase();
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// Global sync management from working version
let GLOBAL_SYNC_LOCK = false;
let SYNC_START_TIME = null;
let SYNC_LOCK_ID = null;
let currentSync = null;
const activeStreams = new Map();

// Helper to broadcast to all streams
function broadcastSSEData(data) {
  for (const [streamId, reply] of activeStreams.entries()) {
    try {
      reply.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      console.error(`Error sending to stream ${streamId}:`, error.message);
      activeStreams.delete(streamId);
    }
  }
}

// Password validation
function validatePassword(password) {
  return password === process.env.ADMIN_PASSWORD;
}

// Register ONLY essential Handlebars helpers
handlebars.registerHelper('eq', (a, b) => a === b);

// Register view engine
fastify.register(require('@fastify/view'), {
  engine: { handlebars },
  root: path.join(__dirname, '../src/pages'),
  layout: false
});

// Register static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/public/'
});

// PROVEN WORKING SYNC FUNCTIONS FROM DOCUMENT 3
// MODE 1: RESET & FULL SYNC (Exact copy with proven timing)
// Replace the performResetAndFullSync function in your api/index.js with this exact version:

async function performResetAndFullSync(limit = 0) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🔄 Reset & Full Sync starting - Lock ID: ${lockId}`);
  
  let createdCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  
  try {
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🔄 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { created: createdCount, deleted: deletedCount, failed: failedCount },
        lockInfo: {
          locked: GLOBAL_SYNC_LOCK,
          lockId: lockId,
          duration: SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0
        }
      };
      
      if (currentSync) {
        currentSync.counts = updateData.counts;
      }
      
      broadcastSSEData(updateData);
    };
    
    sendUpdate('🔄 Starting Reset & Full Sync', 'info');
    
    // === STEP 1: DELETE ALL EXISTING NOTION PAGES ===
    sendUpdate('🗑️ Fetching existing Notion pages for deletion...', 'processing');
    
    let existingPages = [];
    try {
      existingPages = await getNotionPages();
    } catch (error) {
      throw new Error(`Failed to fetch existing Notion pages: ${error.message}`);
    }
    
    if (existingPages.length > 0) {
      sendUpdate(`🗑️ Deleting ${existingPages.length} existing Notion pages...`, 'processing');
      
      // Delete in batches using PROVEN WORKING TIMINGS
      const deleteChunks = chunkArray(existingPages, 10); // 10 items per batch
      
      for (let i = 0; i < deleteChunks.length; i++) {
        const chunk = deleteChunks[i];
        sendUpdate(`🗑️ Deleting batch ${i + 1}/${deleteChunks.length} (${chunk.length} pages)`, 'processing');
        
        for (const page of chunk) {
          try {
            await deleteNotionPage(page.id);
            deletedCount++;
            
            if (deletedCount % 20 === 0) {
              sendUpdate(`🗑️ Deleted ${deletedCount}/${existingPages.length} pages`, 'processing');
            }
            
            // PROVEN WORKING DELAY: 200ms between deletions
            await new Promise(resolve => setTimeout(resolve, 200));
            
          } catch (error) {
            sendUpdate(`❌ Failed to delete page: ${error.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
        
        // PROVEN WORKING DELAY: 2000ms between batches
        if (i < deleteChunks.length - 1) {
          sendUpdate(`⏳ Deletion batch ${i + 1} complete, waiting...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      sendUpdate(`✅ Database reset complete: ${deletedCount} pages deleted`, 'success');
    } else {
      sendUpdate('✅ Notion database is already empty', 'info');
    }
    
    // === STEP 2: FETCH ALL RAINDROPS ===
    sendUpdate('📡 Fetching all Raindrop bookmarks...', 'fetching');
    
    let raindrops = [];
    try {
      raindrops = await getAllRaindrops(limit);
    } catch (error) {
      throw new Error(`Failed to fetch raindrops: ${error.message}`);
    }
    
    sendUpdate(`✅ Found ${raindrops.length} Raindrop bookmarks to sync`, 'success');
    
    if (raindrops.length === 0) {
      sendUpdate('No raindrops to sync. Process complete.', 'complete');
      broadcastSSEData({ complete: true });
      return { complete: true };
    }
    
    // === STEP 3: CREATE ALL PAGES ===
    sendUpdate(`📝 Creating ${raindrops.length} new Notion pages...`, 'processing');
    
    // Create in batches using PROVEN WORKING TIMINGS
    const batches = chunkArray(raindrops, 10); // 10 items per batch (proven to work)
    const batchCount = batches.length;
    
    for (let i = 0; i < batchCount; i++) {
      const batch = batches[i];
      sendUpdate(`📝 Processing batch ${i + 1}/${batchCount} (${batch.length} pages)`, 'processing');
      
      for (const item of batch) {
        try {
          const result = await createNotionPage(item);
          if (result.success) {
            createdCount++;
            sendUpdate(`✅ Created: "${item.title}"`, 'added');
            
            if (createdCount % 20 === 0) {
              sendUpdate(`📊 Progress: ${createdCount}/${raindrops.length} pages created`, 'info');
            }
          } else {
            sendUpdate(`❌ Failed to create: "${item.title}"`, 'failed');
            failedCount++;
          }
          
          // PROVEN WORKING DELAY: 200ms between operations
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          // Longer delay on error
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
      
      // PROVEN WORKING DELAY: 2000ms between batches
      if (i < batchCount - 1) {
        sendUpdate(`⏳ Batch ${i + 1} complete, waiting before next batch...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // === FINAL SUMMARY ===
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`🎉 Reset & Full Sync completed in ${duration}s!`, 'complete');
    sendUpdate(`📊 Results: ${createdCount} created, ${deletedCount} deleted, ${failedCount} failed`, 'summary');
    
    console.log(`✅ [${lockId}] RESET & FULL SYNC COMPLETE: ${duration}s`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { created: createdCount, deleted: deletedCount, failed: failedCount },
      mode: 'reset',
      duration
    });
    
    return { complete: true };
    
  } catch (error) {
    console.error(`❌ [${lockId}] RESET & FULL SYNC ERROR:`, error);
    broadcastSSEData({
      message: `Reset & Full Sync failed: ${error.message}`,
      type: 'failed',
      complete: true
    });
    throw error;
  }
}

// MODE 2: SMART INCREMENTAL SYNC (Exact copy with proven timing)
async function performSmartIncrementalSync(daysBack = 30) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🧠 Smart Incremental Sync starting - Lock ID: ${lockId}, checking last ${daysBack} days`);
  
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  
  try {
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🧠 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { added: addedCount, updated: updatedCount, skipped: skippedCount, failed: failedCount },
        lockInfo: {
          locked: GLOBAL_SYNC_LOCK,
          lockId: lockId,
          duration: SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0
        }
      };
      
      if (currentSync) {
        currentSync.counts = updateData.counts;
      }
      
      broadcastSSEData(updateData);
    };
    
    sendUpdate(`🧠 Starting Smart Incremental Sync (last ${daysBack} days)`, 'info');
    
    // === STEP 1: GET RECENT RAINDROPS (TEMPORAL FILTERING) ===
    sendUpdate(`📡 Fetching recent Raindrop bookmarks (last ${daysBack} days)...`, 'fetching');
    
    let recentRaindrops = [];
    try {
      const hoursBack = daysBack * 24;
      recentRaindrops = await getRecentRaindrops(hoursBack);
    } catch (error) {
      throw new Error(`Failed to fetch recent raindrops: ${error.message}`);
    }
    
    sendUpdate(`✅ Found ${recentRaindrops.length} recent Raindrop bookmarks`, 'success');
    
    if (recentRaindrops.length === 0) {
      sendUpdate('No recent raindrops found. Everything is up to date!', 'complete');
      broadcastSSEData({ 
        complete: true,
        finalCounts: { added: 0, updated: 0, skipped: 0, failed: 0 },
        mode: 'incremental'
      });
      return { complete: true };
    }
    
    // === STEP 2: BUILD NOTION URL LOOKUP (EFFICIENT) ===
    sendUpdate('📡 Building Notion URL lookup...', 'processing');
    
    let notionPages = [];
    try {
      notionPages = await getNotionPages();
    } catch (error) {
      throw new Error(`Failed to fetch Notion pages: ${error.message}`);
    }
    
    // Create efficient lookup map
    const notionUrlMap = new Map();
    const notionTitleMap = new Map();
    
    for (const page of notionPages) {
      const url = page.properties?.URL?.url;
      const title = page.properties?.Name?.title?.[0]?.text?.content;
      
      if (url) {
        notionUrlMap.set(normalizeUrl(url), page);
      }
      if (title) {
        notionTitleMap.set(normalizeTitle(title), page);
      }
    }
    
    sendUpdate(`✅ Built lookup maps from ${notionPages.length} Notion pages`, 'success');
    
    // === STEP 3: SMART DIFF ON RECENT ITEMS ONLY ===
    sendUpdate('🔍 Performing Smart Diff on recent items...', 'processing');
    
    const itemsToAdd = [];
    const itemsToUpdate = [];
    const itemsToSkip = [];
    
    for (const item of recentRaindrops) {
      const normUrl = normalizeUrl(item.link);
      const normTitle = normalizeTitle(item.title);
      
      const existingPage = notionUrlMap.get(normUrl) || notionTitleMap.get(normTitle);
      
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
    
    function tagsMatch(currentTags, newTags) {
      if (currentTags.size !== newTags.length) return false;
      for (const tag of newTags) {
        if (!currentTags.has(tag)) return false;
      }
      return true;
    }
    
    const totalOperations = itemsToAdd.length + itemsToUpdate.length;
    skippedCount = itemsToSkip.length;
    
    sendUpdate(`🔍 Smart Diff complete: ${itemsToAdd.length} to add, ${itemsToUpdate.length} to update, ${itemsToSkip.length} already synced`, 'analysis');
    
    if (totalOperations === 0) {
      sendUpdate('🎉 All recent items already synced! No changes needed.', 'complete');
      broadcastSSEData({ 
        complete: true, 
        finalCounts: { added: 0, updated: 0, skipped: skippedCount, failed: 0 },
        mode: 'incremental' 
      });
      return { complete: true };
    }
    
    const efficiency = recentRaindrops.length > 0 ? 
      Math.round(((recentRaindrops.length - totalOperations) / recentRaindrops.length) * 100) : 100;
    sendUpdate(`🚀 Processing ${totalOperations} operations (${efficiency}% efficiency - only checking recent items!)`, 'info');
    
    // Send efficiency update
    broadcastSSEData({
      efficiency: {
        percentage: efficiency,
        itemsProcessed: totalOperations,
        totalItems: recentRaindrops.length
      },
      type: 'efficiency'
    });
    
    // === STEP 4: PROCESS OPERATIONS ===
    
    // Process new items
    if (itemsToAdd.length > 0) {
      sendUpdate(`➕ Creating ${itemsToAdd.length} new pages...`, 'processing');
      
      for (const item of itemsToAdd) {
        try {
          const result = await createNotionPage(item);
          if (result.success) {
            sendUpdate(`✅ Created: "${item.title}"`, 'added');
            addedCount++;
          } else {
            sendUpdate(`❌ Failed to create: "${item.title}"`, 'failed');
            failedCount++;
          }
          
          // PROVEN WORKING DELAY: 200ms between operations
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    }
    
    // Process updates
    if (itemsToUpdate.length > 0) {
      sendUpdate(`🔄 Updating ${itemsToUpdate.length} existing pages...`, 'processing');
      
      for (const { item, existingPage } of itemsToUpdate) {
        try {
          const success = await updateNotionPage(existingPage.id, item);
          if (success) {
            sendUpdate(`🔄 Updated: "${item.title}"`, 'updated');
            updatedCount++;
          } else {
            sendUpdate(`❌ Failed to update: "${item.title}"`, 'failed');
            failedCount++;
          }
          
          // PROVEN WORKING DELAY: 200ms between operations
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error updating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    }
    
    // === FINAL SUMMARY ===
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`🎉 Smart Incremental Sync completed in ${duration}s!`, 'complete');
    sendUpdate(`📊 Efficiency: Only checked ${recentRaindrops.length} recent items instead of all bookmarks`, 'info');
    sendUpdate(`📈 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed`, 'summary');
    
    console.log(`✅ [${lockId}] SMART INCREMENTAL COMPLETE: ${duration}s, ${efficiency}% efficiency`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, failed: failedCount },
      efficiency: { itemsProcessed: totalOperations, totalItems: recentRaindrops.length, percentage: efficiency, duration },
      mode: 'incremental'
    });
    
    return { complete: true };
    
  } catch (error) {
    console.error(`❌ [${lockId}] SMART INCREMENTAL ERROR:`, error);
    broadcastSSEData({
      message: `Smart Incremental Sync failed: ${error.message}`,
      type: 'failed',
      complete: true
    });
    throw error;
  }
}

// DASHBOARD - KEEP REAL COUNTS BUT OPTIMIZE
fastify.get('/', async (req, reply) => {
  const password = req.query.password || '';

  if (!validatePassword(password)) {
    return reply.view('error', {
      error: 'Invalid password',
      password: '',
      code: 'AUTH_ERROR',
      details: 'Please provide a valid password'
    });
  }

  try {
    console.time('Dashboard Load');
    
    // Get ONLY the counts - fastest possible
    const [raindropTotal, notionTotal] = await Promise.all([
      getRaindropTotal(),
      getTotalNotionPages()
    ]);
    
    console.timeEnd('Dashboard Load');

    const diff = Math.abs(raindropTotal - notionTotal);
    const isSynced = diff <= 5;

    reply.view('index', {
      password,
      raindropTotal,
      notionTotal,
      raindropCount: raindropTotal,
      notionCount: notionTotal,
      diff,
      isSynced,
      syncStatus: isSynced ? 'Synced' : `${diff} bookmarks need sync`,
      statusClass: isSynced ? 'synced' : 'not-synced'
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    reply.view('error', { 
      error: error.message,
      password,
      code: 'FETCH_ERROR',
      details: 'Failed to load dashboard data'
    });
  }
});

// SYNC PAGE - INSTANT LOAD
fastify.get('/sync', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';

  if (!validatePassword(password)) {
    return reply.view('error', {
      error: 'Invalid password',
      password: '',
      code: 'AUTH_ERROR',
      details: 'Please provide a valid password'
    });
  }

  // NO processing - just render immediately
  reply.view('sync', {
    password,
    mode
  });
});

// ULTRA-MINIMAL /sync-stream route - Replace in your api/index.js

fastify.get('/sync-stream', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';
  const limit = parseInt(req.query.limit || '0', 10);

  // Auth check
  if (!validatePassword(password)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  // Set EventSource headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const streamId = Date.now().toString();
  activeStreams.set(streamId, reply.raw);

  // Simple send function
  const send = (data) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      activeStreams.delete(streamId);
    }
  };

  console.log(`🔗 Sync request: ${mode}`);
  send({ message: '🔗 Connected', type: 'info' });

  // Check if sync already running
  if (GLOBAL_SYNC_LOCK) {
    send({ message: '⏸️ Sync already running, please wait...', type: 'waiting' });
    return;
  }

  // Set simple lock
  GLOBAL_SYNC_LOCK = true;

  // Choose and start sync
  let syncPromise;
  if (mode === 'reset' || mode === 'full') {
    syncPromise = performResetAndFullSync(limit);
  } else {
    syncPromise = performSmartIncrementalSync(30);
  }

  // Handle sync completion
  syncPromise
    .then(() => {
      send({ message: '✅ Sync completed successfully', type: 'complete', complete: true });
    })
    .catch(error => {
      send({ message: `❌ Sync failed: ${error.message}`, type: 'error', complete: true });
    })
    .finally(() => {
      // Clean up
      GLOBAL_SYNC_LOCK = false;
      activeStreams.delete(streamId);
      
      try {
        reply.raw.end();
      } catch (e) {
        // Connection already closed
      }
    });

  // Handle client disconnect
  req.raw.on('close', () => {
    console.log(`🔌 Client disconnected: ${streamId}`);
    activeStreams.delete(streamId);
    // Note: Don't stop sync - let it complete on server
  });
});

// VERCEL SERVERLESS HANDLER
module.exports = async (req, res) => {
  try {
    await fastify.ready();
    fastify.server.emit('request', req, res);
  } catch (error) {
    console.error('Fastify handler error:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
};
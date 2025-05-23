// File: server.js
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
  decorateReply: false // prevents conflicts with existing `reply.send`
});

// SYNC DEDUPLICATION STATE
let currentSync = null; // Stores active sync process info
const activeStreams = new Map(); // Stores all connected EventSource streams

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

// Main dashboard route - SECURED WITH INSTANT LOADING
app.get('/', { preHandler: requirePassword }, async (request, reply) => {
  try {
    // Load page instantly with placeholder data
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

// NEW: API endpoint to get counts in background
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

// Sync page route - SECURED
app.get('/sync', { preHandler: requirePassword }, async (request, reply) => {
  const mode = request.query.mode || 'new';
  return reply.view('sync.hbs', { 
    mode,
    password: request.query.password
  });
});

// SSE route for streaming sync updates - SECURED WITH DEDUPLICATION
app.get('/sync-stream', { preHandler: requirePassword }, (request, reply) => {
  const mode = request.query.mode || 'new';
  const isFullSync = mode === 'all';
  const limit = parseInt(request.query.limit || '0', 10);
  const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  
  // Set headers for SSE
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Add this stream to active streams
  activeStreams.set(streamId, reply);
  console.log(`📡 Client connected to sync stream. Active streams: ${activeStreams.size}`);
  
  // Set up keepalive interval to prevent timeout
  const keepAliveInterval = setInterval(() => {
    if (activeStreams.has(streamId)) {
      try {
        reply.raw.write(": keepalive\n\n");
      } catch (error) {
        clearInterval(keepAliveInterval);
        console.error(`Keepalive error for stream ${streamId}:`, error.message);
        activeStreams.delete(streamId);
      }
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 30000); // Send keepalive every 30 seconds
  
  // Check if there's already a sync running
  if (currentSync) {
    console.log(`🔄 Sync already in progress. Connecting client to existing sync...`);
    
    // Send current sync status to the new client
    sendSSEData(reply, {
      message: `Joining sync in progress... (${currentSync.mode} mode)`,
      counts: currentSync.counts || { added: 0, updated: 0, skipped: 0 }
    });
    
    // If sync is already complete, let them know
    if (currentSync.completed) {
      sendSSEData(reply, {
        message: 'Previous sync completed. You can start a new sync if needed.',
        complete: true
      });
    }
  } else {
    console.log(`🚀 Starting new ${isFullSync ? 'full' : 'incremental'} sync...`);
    
    // Create new sync process
    currentSync = {
      mode,
      limit,
      isFullSync,
      startTime: Date.now(),
      counts: { added: 0, updated: 0, skipped: 0 },
      completed: false
    };
    
    // Notify all connected clients
    broadcastSSEData({
      message: `Starting ${isFullSync ? 'full' : 'incremental'} sync...`,
      counts: currentSync.counts
    });
    
    // Start sync process in the background
    performSync(mode, limit).catch(error => {
      app.log.error('Sync error:', error);
      
      // Notify all connected clients about the error
      broadcastSSEData({
        message: `Error: ${error.message}`,
        type: 'failed',
        complete: true
      });
      
      // Clear the current sync
      currentSync = null;
      
      clearInterval(keepAliveInterval);
    });
  }
  
  // Handle client disconnect
  request.raw.on('close', () => {
    if (activeStreams.has(streamId)) {
      console.log(`📡 Client disconnected from stream ${streamId}. Active streams: ${activeStreams.size - 1}`);
      activeStreams.delete(streamId);
    }
    
    clearInterval(keepAliveInterval);
  });
});

// Helper function to perform the sync process (DEDUPLICATED)
async function performSync(mode, limit) {
  // Initialize counters
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  
  try {
    const isFullSync = mode === 'all';
    
    // Helper to send progress updates to all connected clients
    const sendUpdate = (message, type = '') => {
      const updateData = {
        message,
        type,
        counts: {
          added: addedCount,
          updated: updatedCount,
          skipped: skippedCount
        }
      };
      
      // Update the current sync state
      if (currentSync) {
        currentSync.counts = updateData.counts;
      }
      
      // Broadcast to all connected clients
      broadcastSSEData(updateData);
    };
    
    // 1. Get raindrops based on the mode
    let raindrops = [];
    
    if (mode === 'new') {
      sendUpdate('Fetching recent raindrops from Raindrop.io...');
      raindrops = await raindropService.getRecentRaindrops();
    } else if (mode === 'dev') {
      sendUpdate('Fetching a limited set of raindrops for testing...');
      raindrops = await raindropService.getAllRaindrops(limit || 5);
    } else {
      sendUpdate('Fetching all raindrops from Raindrop.io...');
      raindrops = await raindropService.getAllRaindrops(limit);
    }
    
    sendUpdate(`Found ${raindrops.length} raindrops to process`);
    
    if (raindrops.length === 0) {
      sendUpdate('No raindrops to process. Sync complete.', 'skipped');
      
      // Mark sync as completed
      if (currentSync) {
        currentSync.completed = true;
      }
      
      // Notify all clients that sync is complete
      broadcastSSEData({ complete: true });
      
      // Clear the sync after a delay
      setTimeout(() => {
        currentSync = null;
      }, 5000);
      
      return;
    }
    
    // 2. Get Notion pages
    sendUpdate('Fetching existing pages from Notion...');
    const notionPages = await notionService.getNotionPages();
    sendUpdate(`Found ${notionPages.length} Notion pages`);
    
    // 3. Process the raindrops
    const { notionPagesByUrl, notionPagesByTitle, raindropUrlSet } = 
      buildLookupMaps(notionPages, raindrops);
    
    // 4. Process in batches
    const batches = chunkArray(raindrops, 5);
    sendUpdate(`Processing ${batches.length} batches (5 items per batch)`);
    
    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      sendUpdate(`Processing batch ${i + 1} of ${batches.length} (${batch.length} items)`);
      
      for (const item of batch) {
        const result = await processSingleItem(item, notionPagesByUrl, notionPagesByTitle);
        
        if (result.action === 'added') {
          sendUpdate(`Created: "${item.title}"`, 'added');
          addedCount++;
          
          // Add to our maps to prevent duplicates
          notionPagesByUrl.set(normalizeUrl(item.link), { id: result.pageId });
          notionPagesByTitle.set(normalizeTitle(item.title), { id: result.pageId });
        } else if (result.action === 'updated') {
          sendUpdate(`Updated: "${item.title}"`, 'updated');
          updatedCount++;
        } else if (result.action === 'skipped') {
          sendUpdate(`Skipped: "${item.title}"`, 'skipped');
          skippedCount++;
        } else if (result.action === 'failed') {
          sendUpdate(`Failed: "${item.title}" - ${result.error}`, 'failed');
          failedCount++;
        }
        
        // Add small delay between items
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // 5. Handle deletions for full sync
    if (isFullSync) {
      sendUpdate('Checking for pages to delete...');
      
      const deletions = [];
      for (const [url, page] of notionPagesByUrl.entries()) {
        if (!raindropUrlSet.has(url)) {
          deletions.push({ pageId: page.id, url });
        }
      }
      
      if (deletions.length > 0) {
        sendUpdate(`Found ${deletions.length} pages to delete`);
        
        const deletionBatches = chunkArray(deletions, 5);
        for (let i = 0; i < deletionBatches.length; i++) {
          const batch = deletionBatches[i];
          sendUpdate(`Processing deletion batch ${i + 1} of ${deletionBatches.length}`);
          
          for (const { pageId, url } of batch) {
            try {
              sendUpdate(`Deleting page: ${url}`, 'deleted');
              await notionService.deleteNotionPage(pageId);
              deletedCount++;
            } catch (error) {
              sendUpdate(`Failed to delete: ${url} - ${error.message}`, 'failed');
              failedCount++;
            }
            
            // Small delay between deletions
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      } else {
        sendUpdate('No pages to delete');
      }
    }
    
    // 6. Send final summary
    sendUpdate(`Sync completed! Added: ${addedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, Deleted: ${deletedCount}, Failed: ${failedCount}`);
    
    // Mark sync as completed
    if (currentSync) {
      currentSync.completed = true;
    }
    
    // Notify all clients that sync is complete
    broadcastSSEData({ complete: true });
    
    // Clear the sync after a delay to allow clients to see completion
    setTimeout(() => {
      currentSync = null;
      console.log('🧹 Sync process cleared');
    }, 5000);
    
  } catch (error) {
    app.log.error('Sync error:', error);
    
    // Notify all connected clients about the error
    broadcastSSEData({
      message: `Error: ${error.message}`,
      type: 'failed',
      complete: true
    });
    
    // Clear the current sync
    currentSync = null;
    
    throw error;
  }
}

// Process a single raindrop item
async function processSingleItem(item, notionPagesByUrl, notionPagesByTitle) {
  try {
    const normUrl = normalizeUrl(item.link);
    const normTitle = normalizeTitle(item.title);
    
    // Check if already exists in Notion
    const existingPage = notionPagesByUrl.get(normUrl) || notionPagesByTitle.get(normTitle);
    
    if (existingPage) {
      // Check if it needs an update
      const currentTitle = existingPage.properties?.Name?.title?.[0]?.text?.content || '';
      const currentUrl = existingPage.properties?.URL?.url || '';
      
      // Get current tags
      const currentTags = new Set();
      if (existingPage.properties?.Tags?.multi_select) {
        existingPage.properties.Tags.multi_select.forEach(tag => {
          currentTags.add(tag.name);
        });
      }
      
      // Check if update needed
      const needsUpdate = 
        (normalizeTitle(currentTitle) !== normalizeTitle(item.title)) ||
        (normalizeUrl(currentUrl) !== normUrl) ||
        !tagsMatch(currentTags, item.tags || []);
      
      if (needsUpdate) {
        const success = await notionService.updateNotionPage(existingPage.id, item);
        return success ? { action: 'updated' } : { action: 'failed', error: 'Failed to update' };
      } else {
        return { action: 'skipped' };
      }
    } else {
      // Create new page
      const result = await notionService.createNotionPage(item);
      return result.success ? 
        { action: 'added', pageId: result.pageId } : 
        { action: 'failed', error: result.error };
    }
  } catch (error) {
    return { action: 'failed', error: error.message };
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

// Add a ping route to keep connections alive - UNSECURED (for monitoring)
app.get('/ping', async (request, reply) => {
  return { status: 'ok' };
});

// Diagnostic route to check API connections - SECURED
app.get('/diagnostic', { preHandler: requirePassword }, async (request, reply) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    sync_status: {
      active_sync: currentSync ? {
        mode: currentSync.mode,
        started: new Date(currentSync.startTime).toISOString(),
        completed: currentSync.completed,
        counts: currentSync.counts
      } : null,
      active_streams: activeStreams.size
    },
    environment_variables: {
      RAINDROP_TOKEN: process.env.RAINDROP_TOKEN ? 'Set ✓' : 'Missing ✗',
      NOTION_TOKEN: process.env.NOTION_TOKEN ? 'Set ✓' : 'Missing ✗',
      NOTION_DB_ID: process.env.NOTION_DB_ID ? 'Set ✓' : 'Missing ✗',
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? 'Set ✓' : 'Using default'
    },
    api_tests: {}
  };

  // Test Raindrop API connection
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

  // Test Notion API connection
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
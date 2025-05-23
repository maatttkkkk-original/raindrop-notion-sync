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

// Create a Map to store active sync processes for SSE
const activeStreams = new Map();

// Helper function to send SSE data
function sendSSEData(response, data) {
  response.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Main dashboard route
app.get('/', async (request, reply) => {
  try {
    const raindropTotal = await raindropService.getRaindropTotal();
    const notionTotal = await notionService.getTotalNotionPages();
    const isSynced = raindropTotal === notionTotal;

    return reply.view('index.hbs', {
      raindropTotal,
      notionTotal,
      isSynced
    });
  } catch (error) {
    app.log.error(error);
    return reply.view('error.hbs', {
      error: error.message || 'Unknown error occurred'
    });
  }
});

// Sync page route (just serves the template)
app.get('/sync', async (request, reply) => {
  const mode = request.query.mode || 'new';
  return reply.view('sync.hbs', { mode });
});

// SSE route for streaming sync updates
app.get('/sync-stream', (request, reply) => {
  const mode = request.query.mode || 'new';
  const isFullSync = mode === 'all';
  const limit = parseInt(request.query.limit || '0', 10);
  const streamId = Date.now().toString();
  
  // Set headers for SSE
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Store the response in activeStreams
  activeStreams.set(streamId, reply);
  
  // Initial message
  sendSSEData(reply, {
    message: `Starting ${isFullSync ? 'full' : 'incremental'} sync...`,
    counts: { added: 0, updated: 0, skipped: 0 }
  });
  
  // Set up keepalive interval to prevent timeout
  const keepAliveInterval = setInterval(() => {
    if (activeStreams.has(streamId)) {
      try {
        // Send a comment line (not a data event) as a keepalive
        reply.raw.write(": keepalive\n\n");
      } catch (error) {
        clearInterval(keepAliveInterval);
        console.error('Keepalive error, connection likely closed:', error.message);
        activeStreams.delete(streamId);
      }
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 30000); // Send keepalive every 30 seconds
  
  // Start sync process in the background
  performSync(mode, limit, streamId).catch(error => {
    app.log.error('Sync error:', error);
    
    // Send error to client if stream is still active
    if (activeStreams.has(streamId)) {
      sendSSEData(activeStreams.get(streamId), {
        message: `Error: ${error.message}`,
        type: 'failed',
        complete: true
      });
      
      // Remove from active streams
      activeStreams.delete(streamId);
    }
    
    clearInterval(keepAliveInterval);
  });
  
  // Handle client disconnect
  request.raw.on('close', () => {
    if (activeStreams.has(streamId)) {
      app.log.info(`Client disconnected from stream ${streamId}, but sync will continue in the background`);
      activeStreams.delete(streamId);
    }
    
    clearInterval(keepAliveInterval);
  });
});

// Helper function to perform the sync process
async function performSync(mode, limit, streamId) {
  // Initialize counters
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  
  try {
    const isFullSync = mode === 'all';
    
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      if (activeStreams.has(streamId)) {
        sendSSEData(activeStreams.get(streamId), {
          message,
          type,
          counts: {
            added: addedCount,
            updated: updatedCount,
            skipped: skippedCount
          }
        });
      }
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
      
      // Close the stream
      if (activeStreams.has(streamId)) {
        sendSSEData(activeStreams.get(streamId), { complete: true });
        activeStreams.delete(streamId);
      }
      
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
    
    // Close the stream
    if (activeStreams.has(streamId)) {
      sendSSEData(activeStreams.get(streamId), { complete: true });
      activeStreams.delete(streamId);
    }
  } catch (error) {
    app.log.error('Sync error:', error);
    
    if (activeStreams.has(streamId)) {
      sendSSEData(activeStreams.get(streamId), {
        message: `Error: ${error.message}`,
        type: 'failed',
        complete: true
      });
      
      activeStreams.delete(streamId);
    }
    
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

// Add a ping route to keep connections alive
app.get('/ping', async (request, reply) => {
  return { status: 'ok' };
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

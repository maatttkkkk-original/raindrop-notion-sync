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

// Sync page route - SECURED (for incremental sync)
app.get('/sync', { preHandler: requirePassword }, async (request, reply) => {
  const mode = request.query.mode || 'new';
  return reply.view('sync.hbs', { 
    mode,
    password: request.query.password
  });
});

// ✅ NEW EFFICIENT ROUTE:
app.get('/sync-all', { preHandler: requirePassword }, async (request, reply) => {
  const mode = 'all'; // Always full sync for sync-all
  return reply.view('sync.hbs', {  // Use the efficient template instead!
    mode,
    password: request.query.password
  });
});

// CHUNKED SYNC API ROUTE - Used by /sync-all for full reconciliation
app.get('/sync-chunked', { preHandler: requirePassword }, (request, reply) => {
  const mode = request.query.mode || 'new';
  const chunkSize = parseInt(request.query.chunkSize || '100', 10);
  const startOffset = parseInt(request.query.offset || '0', 10);
  const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  
  console.log(`🧩 CHUNKED SYNC REQUEST: mode=${mode}, chunkSize=${chunkSize}, offset=${startOffset}`);
  
  // Set headers for SSE
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Add this stream to active streams
  activeStreams.set(streamId, reply);
  console.log(`📡 Chunked client connected. Active streams: ${activeStreams.size}`);
  
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
  }, 15000);
  
  // Check if another chunked sync is running
  if (GLOBAL_SYNC_LOCK) {
    sendSSEData(reply, {
      message: `⏸️ Another sync chunk is running. Please wait...`,
      type: 'waiting',
      complete: true
    });
    return;
  }
  
  // Start chunked processing
  performChunkedSync(mode, chunkSize, startOffset, streamId, reply)
    .catch(error => {
      console.error(`❌ Chunked sync error:`, error);
      sendSSEData(reply, {
        message: `Chunk failed: ${error.message}`,
        type: 'failed',
        complete: true
      });
    })
    .finally(() => {
      clearInterval(keepAliveInterval);
      activeStreams.delete(streamId);
    });
  
  // Handle client disconnect
  request.raw.on('close', () => {
    clearInterval(keepAliveInterval);
    activeStreams.delete(streamId);
    console.log(`📡 Chunked client ${streamId} disconnected`);
  });
});

// CHUNKED SYNC PROCESSOR FUNCTION
async function performChunkedSync(mode, chunkSize, startOffset, streamId, reply) {
  const chunkId = `chunk_${streamId}_${startOffset}`;
  console.log(`🧩 Starting chunk: ${chunkId}`);
  
  // Set lock for this chunk
  GLOBAL_SYNC_LOCK = true;
  SYNC_START_TIME = Date.now();
  SYNC_LOCK_ID = chunkId;
  
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  
  try {
    // Helper to send updates
    const sendUpdate = (message, type = '') => {
      console.log(`🧩 [${chunkId}] ${message}`);
      sendSSEData(reply, {
        message: `[${chunkId}] ${message}`,
        type,
        counts: { added: addedCount, updated: updatedCount, skipped: skippedCount },
        chunkInfo: {
          chunkId,
          startOffset,
          chunkSize
        }
      });
    };
    
    // 1. Get ALL raindrops first (to know total count)
    let allRaindrops = [];
    try {
      if (mode === 'new') {
        sendUpdate('Fetching recent raindrops...');
        allRaindrops = await raindropService.getRecentRaindrops();
      } else {
        sendUpdate('Fetching all raindrops...');
        allRaindrops = await raindropService.getAllRaindrops();
      }
    } catch (error) {
      throw new Error(`Failed to fetch raindrops: ${error.message}`);
    }
    
    sendUpdate(`Found ${allRaindrops.length} total raindrops`);
    
    // 2. Calculate chunk boundaries
    const totalItems = allRaindrops.length;
    const endOffset = Math.min(startOffset + chunkSize, totalItems);
    const isLastChunk = endOffset >= totalItems;
    const itemsInThisChunk = endOffset - startOffset;
    
    if (startOffset >= totalItems) {
      sendUpdate('Chunk offset beyond total items - sync complete!', 'complete');
      sendSSEData(reply, { 
        complete: true, 
        allChunksComplete: true,
        totalProcessed: totalItems 
      });
      return;
    }
    
    sendUpdate(`Processing chunk: items ${startOffset + 1} to ${endOffset} of ${totalItems} (${itemsInThisChunk} items)`);
    
    // 3. Get chunk of raindrops
    const chunkRaindrops = allRaindrops.slice(startOffset, endOffset);
    
    // 4. Get Notion pages for comparison
    let notionPages = [];
    try {
      sendUpdate('Fetching Notion pages...');
      notionPages = await notionService.getNotionPages();
    } catch (error) {
      throw new Error(`Failed to fetch Notion pages: ${error.message}`);
    }
    
    sendUpdate(`Found ${notionPages.length} Notion pages`);
    
    // 5. Build lookup maps
    const { notionPagesByUrl, notionPagesByTitle } = buildLookupMaps(notionPages, chunkRaindrops);
    
    // 6. Process chunk items in small batches
    const batchSize = 5; // Small batches within the chunk
    const batches = chunkArray(chunkRaindrops, batchSize);
    
    sendUpdate(`Processing ${batches.length} batches within this chunk`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      sendUpdate(`Processing batch ${i + 1} of ${batches.length} (${batch.length} items)`);
      
      for (const item of batch) {
        try {
          const result = await processSingleItem(item, notionPagesByUrl, notionPagesByTitle);
          
          if (result.action === 'added') {
            sendUpdate(`Created: "${item.title}"`, 'added');
            addedCount++;
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
          
          // Short delay between items (300ms)
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (itemError) {
          console.error(`❌ [${chunkId}] Error processing item:`, itemError);
          sendUpdate(`Failed: "${item.title}" - ${itemError.message}`, 'failed');
          failedCount++;
        }
      }
      
      // Short delay between batches (500ms)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 7. Chunk complete summary
    const duration = Math.round((Date.now() - SYNC_START_TIME) / 1000);
    sendUpdate(`Chunk completed in ${duration}s! Added: ${addedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}`);
    
    // 8. Determine next steps
    if (isLastChunk) {
      sendUpdate(`🎉 All chunks completed! Total items processed: ${totalItems}`, 'complete');
      sendSSEData(reply, { 
        complete: true, 
        allChunksComplete: true,
        totalProcessed: totalItems,
        finalCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, failed: failedCount }
      });
    } else {
      const nextOffset = endOffset;
      const remainingItems = totalItems - nextOffset;
      
      sendUpdate(`Chunk complete. ${remainingItems} items remaining. Next chunk starts at item ${nextOffset + 1}`, 'chunkComplete');
      
      sendSSEData(reply, {
        chunkComplete: true,
        nextOffset: nextOffset,
        remainingItems: remainingItems,
        totalItems: totalItems,
        chunkCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, failed: failedCount }
      });
    }
    
  } catch (error) {
    console.error(`❌ [${chunkId}] Chunk error:`, error);
    throw error;
  } finally {
    // Release lock
    GLOBAL_SYNC_LOCK = false;
    SYNC_START_TIME = null;
    SYNC_LOCK_ID = null;
    console.log(`🔓 [${chunkId}] Lock released`);
  }
}

// SSE route for streaming sync updates - SECURED (for incremental sync)
app.get('/sync-stream', { preHandler: requirePassword }, (request, reply) => {
  const mode = request.query.mode || 'new';
  const isFullSync = mode === 'all';
  const limit = parseInt(request.query.limit || '0', 10);
  const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
  
  console.log(`🔗 NEW CLIENT REQUESTING SYNC: ${streamId}, mode: ${mode}`);
  console.log(`🔒 GLOBAL_SYNC_LOCK: ${GLOBAL_SYNC_LOCK}`);
  console.log(`📊 currentSync exists: ${!!currentSync}`);
  if (currentSync) {
    console.log(`📊 currentSync.isRunning: ${currentSync.isRunning}`);
  }
  
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
  
  // ULTRA-STRICT: Check multiple conditions to prevent ANY new sync starts
  if (GLOBAL_SYNC_LOCK) {
    const lockDuration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    console.log(`🚫 GLOBAL SYNC LOCK ACTIVE - Lock ID: ${SYNC_LOCK_ID}, Duration: ${lockDuration}s`);
    
    sendSSEData(reply, {
      message: `⏸️ Sync already running (${lockDuration}s elapsed). Lock ID: ${SYNC_LOCK_ID}. Please wait...`,
      type: 'waiting',
      lockInfo: {
        locked: true,
        lockId: SYNC_LOCK_ID,
        duration: lockDuration
      }
    });
    
    return; // HARD EXIT - NO NEW SYNC ALLOWED
  }
  
  if (currentSync && currentSync.isRunning) {
    const syncDuration = Math.round((Date.now() - currentSync.startTime) / 1000);
    console.log(`🚫 CURRENT SYNC RUNNING - Duration: ${syncDuration}s, Batch: ${currentSync.currentBatch}/${currentSync.totalBatches}`);
    
    sendSSEData(reply, {
      message: `⏸️ Sync in progress (${syncDuration}s, batch ${currentSync.currentBatch}/${currentSync.totalBatches}). Please wait...`,
      counts: currentSync.counts || { added: 0, updated: 0, skipped: 0 },
      progress: currentSync.progress || null,
      type: 'waiting'
    });
    
    return; // HARD EXIT - NO NEW SYNC ALLOWED
  }
  
  // ULTRA-LOCK: Set global lock BEFORE starting anything
  GLOBAL_SYNC_LOCK = true;
  SYNC_START_TIME = Date.now();
  SYNC_LOCK_ID = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  console.log(`🔐 SETTING GLOBAL SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
  console.log(`🚀 Starting new ${isFullSync ? 'full' : 'incremental'} sync...`);
  
  // Create new sync process with ultra-protection
  currentSync = {
    mode,
    limit,
    isFullSync,
    isRunning: true,
    lockId: SYNC_LOCK_ID,
    startTime: Date.now(),
    counts: { added: 0, updated: 0, skipped: 0 },
    progress: null,
    currentBatch: 0,
    totalBatches: 0,
    completed: false
  };
  
  // Notify all connected clients
  broadcastSSEData({
    message: `🔒 Starting ${isFullSync ? 'full' : 'incremental'} sync (Lock ID: ${SYNC_LOCK_ID})...`,
    counts: currentSync.counts,
    progress: currentSync.progress,
    lockInfo: {
      locked: true,
      lockId: SYNC_LOCK_ID,
      duration: 0
    }
  });
  
  // Start sync process with ultra-protection
  performSyncUltraLocked(mode, limit)
    .then(() => {
      console.log(`✅ Sync completed successfully - Lock ID: ${SYNC_LOCK_ID}`);
    })
    .catch(error => {
      console.error(`❌ SYNC ERROR - Lock ID: ${SYNC_LOCK_ID}:`, error);
      app.log.error('Sync error:', error);
      
      // Notify all connected clients about the error
      broadcastSSEData({
        message: `Sync failed (Lock ID: ${SYNC_LOCK_ID}): ${error.message}`,
        type: 'failed',
        complete: true
      });
    })
    .finally(() => {
      // ULTRA-CRITICAL: Always release lock
      console.log(`🔓 RELEASING GLOBAL SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
      GLOBAL_SYNC_LOCK = false;
      SYNC_START_TIME = null;
      
      if (currentSync) {
        currentSync.isRunning = false;
        currentSync = null;
      }
      
      console.log(`🔓 Lock released. GLOBAL_SYNC_LOCK: ${GLOBAL_SYNC_LOCK}`);
    });
  
  // Handle client disconnect
  request.raw.on('close', () => {
    if (activeStreams.has(streamId)) {
      console.log(`📡 Client disconnected from stream ${streamId}. Active streams: ${activeStreams.size - 1}`);
      activeStreams.delete(streamId);
    }
    
    clearInterval(keepAliveInterval);
  });
});

// ULTRA-LOCKED VERSION of performSync (for incremental sync)
async function performSyncUltraLocked(mode, limit) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🔄 performSyncUltraLocked starting - Lock ID: ${lockId}, mode: ${mode}, limit: ${limit}`);
  
  // Double-check lock
  if (!GLOBAL_SYNC_LOCK) {
    throw new Error('Sync started without global lock - aborting');
  }
  
  // Initialize counters
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  let processedBatches = 0;
  let totalBatches = 0;
  
  try {
    const isFullSync = mode === 'all';
    
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`📊 [${lockId}] UPDATE: ${message}`);
      
      const updateData = {
        message: `[${lockId}] ${message}`,
        type,
        counts: { added: addedCount, updated: updatedCount, skipped: skippedCount },
        progress: totalBatches > 0 ? {
          current: processedBatches,
          total: totalBatches,
          percentage: Math.round((processedBatches / totalBatches) * 100)
        } : null,
        lockInfo: {
          locked: GLOBAL_SYNC_LOCK,
          lockId: lockId,
          duration: SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0
        }
      };
      
      // Update current sync state
      if (currentSync) {
        currentSync.counts = updateData.counts;
        currentSync.progress = updateData.progress;
        currentSync.currentBatch = processedBatches;
        currentSync.totalBatches = totalBatches;
      }
      
      // Broadcast with lock protection
      try {
        broadcastSSEData(updateData);
      } catch (sseError) {
        console.error(`Error broadcasting SSE data for lock ${lockId}:`, sseError);
      }
    };
    
    // 1. Get raindrops
    let raindrops = [];
    try {
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
    } catch (raindropError) {
      console.error(`❌ [${lockId}] Error fetching raindrops:`, raindropError);
      throw new Error(`Failed to fetch raindrops: ${raindropError.message}`);
    }
    
    sendUpdate(`Found ${raindrops.length} raindrops to process`);
    
    if (raindrops.length === 0) {
      sendUpdate('No raindrops to process. Sync complete.', 'skipped');
      broadcastSSEData({ complete: true });
      return;
    }
    
    // 2. Get Notion pages
    let notionPages = [];
    try {
      sendUpdate('Fetching existing pages from Notion...');
      notionPages = await notionService.getNotionPages();
    } catch (notionError) {
      console.error(`❌ [${lockId}] Error fetching Notion pages:`, notionError);
      throw new Error(`Failed to fetch Notion pages: ${notionError.message}`);
    }
    
    sendUpdate(`Found ${notionPages.length} Notion pages`);
    
    // 3. Build lookup maps
    const { notionPagesByUrl, notionPagesByTitle, raindropUrlSet } = 
      buildLookupMaps(notionPages, raindrops);
    
    // 4. Process in batches WITH LOCK CHECKS
    const batchSize = raindrops.length > 100 ? 2 : 3;
    const batches = chunkArray(raindrops, batchSize);
    totalBatches = batches.length;
    
    sendUpdate(`Processing ${batches.length} batches (${batchSize} items per batch)`);
    console.log(`🔧 [${lockId}] BATCH PROCESSING: ${raindrops.length} items → ${batches.length} batches`);
    
    // Process each batch with LOCK VERIFICATION
    for (let i = 0; i < batches.length; i++) {
      // ULTRA-CHECK: Verify lock is still held
      if (!GLOBAL_SYNC_LOCK) {
        throw new Error(`Global lock lost during processing at batch ${i + 1}`);
      }
      
      if (!currentSync || !currentSync.isRunning) {
        throw new Error(`Sync state lost during processing at batch ${i + 1}`);
      }
      
      const batch = batches[i];
      processedBatches = i + 1;
      
      sendUpdate(`Processing batch ${processedBatches} of ${totalBatches} (${batch.length} items)`);
      console.log(`📦 [${lockId}] Processing batch ${processedBatches}/${totalBatches}`);
      
      // Process items in the batch
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        
        try {
          const result = await processSingleItem(item, notionPagesByUrl, notionPagesByTitle);
          
          if (result.action === 'added') {
            sendUpdate(`Created: "${item.title}"`, 'added');
            addedCount++;
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
          
          // Item delay (faster now)
          await new Promise(resolve => setTimeout(resolve, 300));
          
        } catch (itemError) {
          console.error(`❌ [${lockId}] Error processing item "${item.title}":`, itemError);
          sendUpdate(`Failed: "${item.title}" - ${itemError.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      // Batch delay (faster now)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Memory cleanup every 10 batches
      if (processedBatches % 10 === 0) {
        sendUpdate(`Checkpoint: ${processedBatches}/${totalBatches} batches completed.`);
        console.log(`🔄 [${lockId}] CHECKPOINT: Processed ${processedBatches}/${totalBatches} batches`);
        
        if (global.gc) {
          global.gc();
          console.log(`🧹 [${lockId}] Forced garbage collection`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    sendUpdate(`Item processing complete. Processed ${processedBatches}/${totalBatches} batches.`);
    
    // Handle deletions for full sync
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
        
        const deletionBatches = chunkArray(deletions, 3);
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
            
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      } else {
        sendUpdate('No pages to delete');
      }
    }
    
    // Final summary
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    sendUpdate(`Sync completed in ${duration}s! Added: ${addedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}, Deleted: ${deletedCount}, Failed: ${failedCount}`);
    
    console.log(`✅ [${lockId}] SYNC COMPLETE: ${duration}s total, ${processedBatches}/${totalBatches} batches`);
    
    // Mark as completed
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ complete: true });
    
  } catch (error) {
    console.error(`❌ [${lockId}] SYNC ERROR:`, error);
    
    broadcastSSEData({
      message: `Error in sync ${lockId} after ${processedBatches}/${totalBatches} batches: ${error.message}`,
      type: 'failed',
      complete: true
    });
    
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
        isRunning: currentSync.isRunning,
        currentBatch: currentSync.currentBatch,
        totalBatches: currentSync.totalBatches,
        counts: currentSync.counts,
        progress: currentSync.progress
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

// Sync Debug Route - SECURED
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
      currentBatch: currentSync.currentBatch,
      totalBatches: currentSync.totalBatches,
      counts: currentSync.counts
    } : null,
    activeStreams: {
      count: activeStreams.size,
      streamIds: Array.from(activeStreams.keys())
    },
    suggestions: []
  };
  
  // Add suggestions based on current state
  if (GLOBAL_SYNC_LOCK) {
    const lockDuration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    debug.suggestions.push(`Sync locked for ${lockDuration}s - this is normal during active sync`);
  }
  
  if (activeStreams.size > 1) {
    debug.suggestions.push(`⚠️ Multiple streams (${activeStreams.size}) detected - this might cause restart issues`);
  }
  
  if (!GLOBAL_SYNC_LOCK && !currentSync) {
    debug.suggestions.push('✅ No active sync - ready to start new sync');
  }
  
  return reply
    .header('Content-Type', 'application/json')
    .send(JSON.stringify(debug, null, 2));
});

// Test Sync Lock Route - SECURED
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
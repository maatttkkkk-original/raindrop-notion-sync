// Complete Fastify server with PROVEN WORKING SYNC + NO DELETIONS
const path = require('path');
const Fastify = require('fastify');
const handlebars = require('handlebars');

const fastify = Fastify({ logger: true });

// Import the PROVEN WORKING sync functions
const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage } = require('../services/notion');

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

// ENHANCED: Loop protection globals (no deletion tracking)
let SYNC_OPERATION_LOG = new Map(); // Track operations to prevent loops
let LAST_SYNC_STATE = null;

// ENHANCED: Loop protection helper (no deletion operations)
function trackSyncOperation(operation, itemId, itemTitle) {
  const key = `${operation}-${itemId}`;
  const now = Date.now();
  
  if (!SYNC_OPERATION_LOG.has(key)) {
    SYNC_OPERATION_LOG.set(key, []);
  }
  
  const operations = SYNC_OPERATION_LOG.get(key);
  operations.push({ timestamp: now, title: itemTitle });
  
  // Keep only recent operations (last 10 minutes)
  const tenMinutesAgo = now - (10 * 60 * 1000);
  SYNC_OPERATION_LOG.set(key, operations.filter(op => op.timestamp > tenMinutesAgo));
  
  // Check for loops (same operation > 3 times in 5 minutes)
  const fiveMinutesAgo = now - (5 * 60 * 1000);
  const recentOps = operations.filter(op => op.timestamp > fiveMinutesAgo);
  
  if (recentOps.length > 3) {
    console.warn(`🔄 Potential loop detected: ${operation} on "${itemTitle}" happened ${recentOps.length} times in 5 minutes`);
    return true; // Indicates potential loop
  }
  
  return false;
}

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

// MODE 1 - FULL SYNC with Vercel-Safe Chunks (NO DELETIONS)
async function performFullSync(startIndex = 0, chunkSize = 25, limit = 0) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`Chunked Full Sync starting - Lock ID: ${lockId}, startIndex: ${startIndex}, chunkSize: ${chunkSize}`);
  
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let loopPreventionSkips = 0;
  
  try {
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`[${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { 
          created: createdCount, 
          updated: updatedCount, 
          failed: failedCount,
          skipped: loopPreventionSkips 
        },
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
    
    sendUpdate(`Starting chunk from index ${startIndex} (${chunkSize} items)`, 'info');
    
    // === STEP 1: FETCH ALL RAINDROPS (once, but slice for chunk) ===
    if (startIndex === 0) {
      sendUpdate('Fetching all Raindrop bookmarks...', 'fetching');
    } else {
      sendUpdate(`Continuing from bookmark ${startIndex + 1}...`, 'info');
    }
    
    let allRaindrops = [];
    try {
      allRaindrops = await getAllRaindrops(limit);
    } catch (error) {
      throw new Error(`Failed to fetch raindrops: ${error.message}`);
    }
    
    // Slice for this chunk
    const endIndex = Math.min(startIndex + chunkSize, allRaindrops.length);
    const raindrops = allRaindrops.slice(startIndex, endIndex);
    const totalRaindrops = allRaindrops.length;
    
    console.log(`Processing chunk: items ${startIndex + 1} to ${endIndex} of ${totalRaindrops}`);
    sendUpdate(`Processing ${raindrops.length} bookmarks (${startIndex + 1} to ${endIndex} of ${totalRaindrops})`, 'processing');
    
    if (raindrops.length === 0) {
      sendUpdate('No more raindrops to process in this chunk.', 'complete');
      broadcastSSEData({ 
        complete: true,
        chunkComplete: true,
        hasMore: false,
        nextIndex: endIndex,
        totalItems: totalRaindrops,
        finalCounts: { created: 0, updated: 0, failed: 0, skipped: 0 }
      });
      return { complete: true, hasMore: false };
    }
    
    // === STEP 2: FETCH EXISTING NOTION PAGES (only if first chunk) ===
    let existingPages = [];
    if (startIndex === 0) {
      sendUpdate('Fetching existing Notion pages...', 'fetching');
      
      try {
        existingPages = await getNotionPages();
      } catch (error) {
        throw new Error(`Failed to fetch existing Notion pages: ${error.message}`);
      }
      
      sendUpdate(`Found ${existingPages.length} existing Notion pages`, 'success');
    } else {
      // For continuation chunks, get fresh Notion data to include newly created pages
      sendUpdate('Refreshing Notion page data...', 'fetching');
      try {
        existingPages = await getNotionPages();
      } catch (error) {
        console.warn('Failed to refresh Notion pages, continuing with empty set');
        existingPages = [];
      }
    }
    
    // === STEP 3: BUILD NOTION LOOKUP MAPS ===
    const notionUrlMap = new Map();
    const notionTitleMap = new Map();
    
    for (const page of existingPages) {
      const url = page.properties?.URL?.url;
      const title = page.properties?.Name?.title?.[0]?.text?.content;
      
      if (url) {
        notionUrlMap.set(normalizeUrl(url), page);
      }
      if (title) {
        notionTitleMap.set(normalizeTitle(title), page);
      }
    }
    
    // === STEP 4: PROCESS CHUNK OF RAINDROPS ===
    sendUpdate(`Processing chunk: ${raindrops.length} bookmarks`, 'processing');
    
    // Process items individually with 200ms delays
    let processedInChunk = 0;
    
    for (const item of raindrops) {
      try {
        const currentItemNumber = startIndex + processedInChunk + 1;
        console.log(`Processing item ${currentItemNumber}/${totalRaindrops}: "${item.title}"`);
        
        // Add timeout wrapper for individual item processing
        const processItem = async () => {
          const normUrl = normalizeUrl(item.link);
          const normTitle = normalizeTitle(item.title);
          
          const existingPage = notionUrlMap.get(normUrl) || notionTitleMap.get(normTitle);
          
          if (existingPage) {
            // UPDATE EXISTING PAGE
            const isLoop = trackSyncOperation('update', existingPage.id, item.title);
            
            if (isLoop) {
              loopPreventionSkips++;
              console.log(`Skipping update of "${item.title}" - potential loop detected`);
              return 'skipped';
            }
            
            const success = await updateNotionPage(existingPage.id, item);
            if (success) {
              updatedCount++;
              console.log(`✅ Updated item ${currentItemNumber}: "${item.title}"`);
              return 'updated';
            } else {
              failedCount++;
              console.log(`❌ Failed to update item ${currentItemNumber}: "${item.title}"`);
              return 'failed';
            }
          } else {
            // CREATE NEW PAGE
            const itemKey = normalizeUrl(item.link) + '|' + normalizeTitle(item.title);
            const isLoop = trackSyncOperation('create', itemKey, item.title);
            
            if (isLoop) {
              loopPreventionSkips++;
              console.log(`Skipping create of "${item.title}" - potential loop detected`);
              return 'skipped';
            }
            
            const result = await createNotionPage(item);
            if (result.success) {
              createdCount++;
              console.log(`✅ Created item ${currentItemNumber}: "${item.title}"`);
              return 'created';
            } else {
              failedCount++;
              console.log(`❌ Failed to create item ${currentItemNumber}: "${item.title}"`);
              return 'failed';
            }
          }
        };
        
        // Process item with 8 second timeout (shorter for chunks)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Item processing timeout')), 8000);
        });
        
        const result = await Promise.race([processItem(), timeoutPromise]);
        processedInChunk++;
        
        console.log(`Item ${currentItemNumber} completed: ${result}`);
        
        // PROVEN WORKING DELAY: 200ms between operations
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        // Individual item error handling
        failedCount++;
        processedInChunk++;
        const currentItemNumber = startIndex + processedInChunk;
        
        console.error(`❌ Error processing item ${currentItemNumber} "${item.title}":`, error.message);
        sendUpdate(`Failed item ${currentItemNumber}: "${item.title}" - ${error.message}`, 'failed');
        
        // Continue with next item after error
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    
    // === CHUNK COMPLETION ===
    const chunkEndIndex = startIndex + processedInChunk;
    const hasMore = chunkEndIndex < totalRaindrops;
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`Chunk complete: ${processedInChunk} items processed in ${duration}s`, 'complete');
    sendUpdate(`Chunk results: ${createdCount} created, ${updatedCount} updated, ${failedCount} failed, ${loopPreventionSkips} skipped`, 'summary');
    
    console.log(`[${lockId}] CHUNK COMPLETE: ${duration}s, processed ${chunkEndIndex}/${totalRaindrops}`);
    
    // Send progress update with chunk completion
    const progressData = {
      type: 'progress',
      completed: chunkEndIndex,
      total: totalRaindrops,
      percentage: Math.round((chunkEndIndex / totalRaindrops) * 100),
      counts: { 
        created: createdCount, 
        updated: updatedCount, 
        failed: failedCount,
        skipped: loopPreventionSkips 
      }
    };
    
    broadcastSSEData(progressData);
    
    // Send chunk completion data
    broadcastSSEData({ 
      complete: !hasMore, // Only complete if no more chunks
      chunkComplete: true,
      hasMore: hasMore,
      nextIndex: chunkEndIndex,
      totalItems: totalRaindrops,
      chunkCounts: { 
        created: createdCount, 
        updated: updatedCount, 
        failed: failedCount, 
        skipped: loopPreventionSkips 
      },
      mode: 'full',
      duration
    });
    
    if (currentSync) {
      currentSync.completed = !hasMore;
      currentSync.isRunning = hasMore;
      currentSync.counts = { created: createdCount, updated: updatedCount, failed: failedCount, skipped: loopPreventionSkips };
    }
    
    return { 
      complete: !hasMore, 
      hasMore: hasMore, 
      nextIndex: chunkEndIndex,
      totalItems: totalRaindrops,
      counts: { created: createdCount, updated: updatedCount, failed: failedCount, skipped: loopPreventionSkips }
    };
    
  } catch (error) {
    console.error(`[${lockId}] CHUNKED SYNC ERROR:`, error);
    broadcastSSEData({
      message: `Chunked sync failed: ${error.message}`,
      type: 'failed',
      complete: true,
      chunkComplete: true,
      hasMore: false
    });
    throw error;
  }
}

// ENHANCED MODE 2: SMART INCREMENTAL SYNC with Loop Protection (NO DELETIONS)
async function performSmartIncrementalSync(daysBack = 30) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🧠 Smart Incremental Sync starting - Lock ID: ${lockId}, checking last ${daysBack} days (NO DELETIONS)`);
  
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let loopPreventionSkips = 0;
  
  try {
    // Clear operation log for fresh start
    SYNC_OPERATION_LOG.clear();
    
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🧠 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { 
          added: addedCount, 
          updated: updatedCount, 
          skipped: skippedCount + loopPreventionSkips, 
          failed: failedCount 
        },
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
    
    sendUpdate(`🧠 Starting Smart Incremental Sync with loop protection (last ${daysBack} days, no deletions)`, 'info');
    
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
    
    // === STEP 4: PROCESS OPERATIONS (CREATE + UPDATE ONLY) ===
    
    // Process new items - using your working API call structure
    if (itemsToAdd.length > 0) {
      sendUpdate(`➕ Creating ${itemsToAdd.length} new pages...`, 'processing');
      
      for (const item of itemsToAdd) {
        try {
          // ENHANCED: Check for creation loop
          const itemKey = normalizeUrl(item.link) + '|' + normalizeTitle(item.title);
          const isLoop = trackSyncOperation('create', itemKey, item.title);
          
          if (isLoop) {
            sendUpdate(`⚠️ Skipping create of "${item.title}" - potential loop detected`, 'warning');
            loopPreventionSkips++;
            continue;
          }
          
          // Use your working API call structure
          try {
            const result = await createNotionPage(item);
            if (result.success) {
              sendUpdate(`✅ Created: "${item.title}"`, 'added');
              addedCount++;
            } else {
              sendUpdate(`❌ Failed to create: "${item.title}"`, 'failed');
              failedCount++;
            }
          } catch (createError) {
            sendUpdate(`❌ Error creating "${item.title}": ${createError.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 400));
          }
          
          // PROVEN WORKING DELAY: 200ms between operations (from your working file)
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    }
    
    // Process updates - using your working error handling
    if (itemsToUpdate.length > 0) {
      sendUpdate(`🔄 Updating ${itemsToUpdate.length} existing pages...`, 'processing');
      
      for (const { item, existingPage } of itemsToUpdate) {
        try {
          // ENHANCED: Check for update loop
          const isLoop = trackSyncOperation('update', existingPage.id, item.title);
          
          if (isLoop) {
            sendUpdate(`⚠️ Skipping update of "${item.title}" - potential loop detected`, 'warning');
            loopPreventionSkips++;
            continue;
          }
          
          // Use your working API call structure
          try {
            const success = await updateNotionPage(existingPage.id, item);
            if (success) {
              sendUpdate(`🔄 Updated: "${item.title}"`, 'updated');
              updatedCount++;
            } else {
              sendUpdate(`❌ Failed to update: "${item.title}"`, 'failed');
              failedCount++;
            }
          } catch (updateError) {
            sendUpdate(`❌ Error updating "${item.title}": ${updateError.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 400));
          }
          
          // PROVEN WORKING DELAY: 200ms between operations (from your working file)
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
    sendUpdate(`📈 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed, ${loopPreventionSkips} loop-prevention skips`, 'summary');
    
    console.log(`✅ [${lockId}] SMART INCREMENTAL COMPLETE: ${duration}s, ${efficiency}% efficiency`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { 
        added: addedCount, 
        updated: updatedCount, 
        skipped: skippedCount + loopPreventionSkips, 
        failed: failedCount 
      },
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

// ENHANCED /sync-stream route with better error handling
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

  console.log(`🔗 Sync request: ${mode} (Stream ID: ${streamId})`);
  send({ message: ' Connected to sync stream', type: 'info' });

  // Check if sync already running
  if (GLOBAL_SYNC_LOCK) {
    send({ message: '⏸️ Sync already running, please wait...', type: 'waiting' });
    
    // Clean up this stream since we can't start sync
    setTimeout(() => {
      activeStreams.delete(streamId);
      try {
        reply.raw.end();
      } catch (e) {
        // Connection already closed
      }
    }, 5000);
    return;
  }

  // Set enhanced lock with tracking
  GLOBAL_SYNC_LOCK = true;
  SYNC_START_TIME = Date.now();
  SYNC_LOCK_ID = streamId;
  
  currentSync = {
    lockId: streamId,
    mode: mode,
    startTime: SYNC_START_TIME,
    isRunning: true,
    completed: false,
    counts: {}
  };

  // Choose and start sync with chunking support
  let syncPromise;
  if (mode === 'full') {
    const startIndex = parseInt(req.query.startIndex || '0', 10);
    const chunkSize = parseInt(req.query.chunkSize || '25', 10);
    syncPromise = performFullSync(startIndex, chunkSize, limit);
  } else {
    syncPromise = performSmartIncrementalSync(30);
  }

  // Handle sync completion
  syncPromise
    .then(() => {
      send({ message: 'Sync completed successfully', type: 'complete', complete: true });
    })
    .catch(error => {
      send({ message: ` Sync failed: ${error.message}`, type: 'error', complete: true });
    })
    .finally(() => {
      // Clean up
      GLOBAL_SYNC_LOCK = false;
      SYNC_START_TIME = null;
      SYNC_LOCK_ID = null;
      currentSync = null;
      
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

// Health check endpoint
fastify.get('/health', async (req, reply) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    sync: {
      locked: GLOBAL_SYNC_LOCK,
      lockId: SYNC_LOCK_ID,
      activeStreams: activeStreams.size,
      currentSync: currentSync ? {
        mode: currentSync.mode,
        startTime: currentSync.startTime,
        duration: Date.now() - currentSync.startTime,
        isRunning: currentSync.isRunning,
        completed: currentSync.completed
      } : null
    },
    operationLog: {
      size: SYNC_OPERATION_LOG.size,
      operations: Array.from(SYNC_OPERATION_LOG.keys()).slice(0, 5) // Show first 5 for debugging
    }
  };
  
  reply.send(health);
});

// Debug endpoint for admin
fastify.get('/debug', async (req, reply) => {
  const password = req.query.password || '';
  
  if (!validatePassword(password)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  
  const debug = {
    sync: {
      locked: GLOBAL_SYNC_LOCK,
      lockId: SYNC_LOCK_ID,
      startTime: SYNC_START_TIME,
      activeStreams: activeStreams.size,
      currentSync: currentSync
    },
    operationLog: {
      size: SYNC_OPERATION_LOG.size,
      recentOperations: Array.from(SYNC_OPERATION_LOG.entries()).slice(-10)
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    }
  };
  
  reply.send(debug);
});

// Reset operation log endpoint (for debugging)
fastify.post('/reset-log', async (req, reply) => {
  const password = req.query.password || '';
  
  if (!validatePassword(password)) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
  
  const oldSize = SYNC_OPERATION_LOG.size;
  SYNC_OPERATION_LOG.clear();
  
  reply.send({ 
    message: 'Operation log cleared',
    oldSize: oldSize,
    newSize: SYNC_OPERATION_LOG.size
  });
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  console.error('Fastify error:', error);
  
  const errorResponse = {
    error: 'Internal Server Error',
    message: error.message,
    timestamp: new Date().toISOString()
  };
  
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }
  
  reply.status(500).send(errorResponse);
});

// 404 handler
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: 'Not Found',
    message: `Route ${request.method} ${request.url} not found`,
    timestamp: new Date().toISOString()
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
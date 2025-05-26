// Vercel-compatible version with CHUNKED PROCESSING to fix timeout issues

// Import your existing service files
const { getAllRaindrops, getRaindropTotal } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

// Helper functions from your original working code
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

// Global sync management
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

// NEW: Chunked processing function
async function performChunkedSync(mode, limit = 0, chunkIndex = 0, operationsData = null) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  const CHUNK_SIZE = 8; // Process 8 operations per chunk (≈5-6 seconds)
  const OPTIMIZED_DELAY = 50; // Reduced from 100-500ms to 50ms
  
  console.log(`🧠 Chunked Sync starting - Lock ID: ${lockId}, mode: ${mode}, chunk: ${chunkIndex}`);
  
  if (!GLOBAL_SYNC_LOCK) {
    throw new Error('Sync started without global lock - aborting');
  }
  
  let addedCount = currentSync?.counts?.added || 0;
  let updatedCount = currentSync?.counts?.updated || 0;
  let skippedCount = currentSync?.counts?.skipped || 0;
  let deletedCount = currentSync?.counts?.deleted || 0;
  let failedCount = currentSync?.counts?.failed || 0;
  
  try {
    const isFirstChunk = chunkIndex === 0;
    const isFullSync = mode === 'all';
    
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🧠 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { added: addedCount, updated: updatedCount, skipped: skippedCount, deleted: deletedCount, failed: failedCount },
        chunkInfo: { index: chunkIndex, isFirstChunk },
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
    
    let operations = operationsData;
    
    // FIRST CHUNK: Perform Smart Diff analysis
    if (isFirstChunk) {
      sendUpdate(`🧠 Starting Smart Diff Sync (${isFullSync ? 'full' : 'incremental'})`, 'info');
      
      // === STEP 1: FETCH ALL DATA (EFFICIENT) ===
      sendUpdate('📡 Fetching raindrops...', 'fetching');
      let raindrops = [];
      try {
        if (mode === 'new') {
          raindrops = await getAllRaindrops(limit || 50);
        } else {
          raindrops = await getAllRaindrops(limit);
        }
      } catch (error) {
        throw new Error(`Failed to fetch raindrops: ${error.message}`);
      }
      
      sendUpdate(`✅ Found ${raindrops.length} raindrops`, 'success');
      
      if (raindrops.length === 0) {
        sendUpdate('No raindrops to process. Sync complete.', 'complete');
        broadcastSSEData({ complete: true });
        return { complete: true };
      }
      
      sendUpdate('📡 Fetching Notion pages...', 'fetching');
      let notionPages = [];
      try {
        notionPages = await getNotionPages();
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
        return { complete: true };
      }
      
      const efficiency = Math.round(((raindrops.length - totalOperations) / raindrops.length) * 100);
      sendUpdate(`🚀 Processing ${totalOperations} operations (${efficiency}% efficiency vs 0% in old system)`, 'info');
      
      // Prepare operations for chunked processing
      operations = {
        itemsToAdd,
        itemsToUpdate,
        pagesToDelete,
        totalOperations,
        efficiency
      };
      
      sendUpdate(`📦 Breaking into chunks of ${CHUNK_SIZE} operations for timeout prevention`, 'info');
    }
    
    // === STEP 4: PROCESS CHUNK OF OPERATIONS ===
    const { itemsToAdd, itemsToUpdate, pagesToDelete, totalOperations, efficiency } = operations;
    
    // Calculate which operations belong to this chunk
    const allOperations = [
      ...itemsToAdd.map(item => ({ type: 'add', data: item })),
      ...itemsToUpdate.map(update => ({ type: 'update', data: update })),
      ...pagesToDelete.map(page => ({ type: 'delete', data: page }))
    ];
    
    const chunkStart = chunkIndex * CHUNK_SIZE;
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, allOperations.length);
    const currentChunk = allOperations.slice(chunkStart, chunkEnd);
    const isLastChunk = chunkEnd >= allOperations.length;
    
    if (currentChunk.length === 0) {
      // No operations in this chunk, must be complete
      const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
      sendUpdate(`🎉 Smart Diff Sync completed in ${duration}s!`, 'complete');
      sendUpdate(`📊 Efficiency: ${totalOperations}/${totalOperations + skippedCount} items processed (${efficiency}% efficiency improvement)`, 'info');
      sendUpdate(`📈 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${deletedCount} deleted, ${failedCount} failed`, 'summary');
      
      broadcastSSEData({ 
        complete: true,
        finalCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, deleted: deletedCount, failed: failedCount },
        efficiency: { itemsProcessed: totalOperations, totalItems: totalOperations + skippedCount, percentage: efficiency, duration }
      });
      
      return { complete: true };
    }
    
    sendUpdate(`📦 Processing chunk ${chunkIndex + 1} (operations ${chunkStart + 1}-${chunkEnd} of ${totalOperations})`, 'processing');
    
    // Process current chunk
    for (const operation of currentChunk) {
      try {
        if (operation.type === 'add') {
          const result = await createNotionPage(operation.data);
          if (result.success) {
            sendUpdate(`✅ Created: "${operation.data.title}"`, 'added');
            addedCount++;
          } else {
            sendUpdate(`❌ Failed to create: "${operation.data.title}"`, 'failed');
            failedCount++;
          }
        } else if (operation.type === 'update') {
          const { item, existingPage } = operation.data;
          const success = await updateNotionPage(existingPage.id, item);
          if (success) {
            sendUpdate(`🔄 Updated: "${item.title}"`, 'updated');
            updatedCount++;
          } else {
            sendUpdate(`❌ Failed to update: "${item.title}"`, 'failed');
            failedCount++;
          }
        } else if (operation.type === 'delete') {
          const url = operation.data.properties?.URL?.url || 'Unknown URL';
          await deleteNotionPage(operation.data.id);
          sendUpdate(`🗑️ Deleted: ${url}`, 'deleted');
          deletedCount++;
        }
        
        // Optimized delay - much shorter than before
        await new Promise(resolve => setTimeout(resolve, OPTIMIZED_DELAY));
        
      } catch (error) {
        sendUpdate(`❌ Error processing operation: ${error.message}`, 'failed');
        failedCount++;
        await new Promise(resolve => setTimeout(resolve, OPTIMIZED_DELAY * 2)); // Longer delay on error
      }
    }
    
    // Update counts in current sync
    if (currentSync) {
      currentSync.counts = { added: addedCount, updated: updatedCount, skipped: skippedCount, deleted: deletedCount, failed: failedCount };
    }
    
    if (isLastChunk) {
      // Final chunk complete
      const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
      sendUpdate(`🎉 Smart Diff Sync completed in ${duration}s!`, 'complete');
      sendUpdate(`📊 Efficiency: ${totalOperations}/${totalOperations + skippedCount} items processed (${efficiency}% efficiency improvement)`, 'info');
      sendUpdate(`📈 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${deletedCount} deleted, ${failedCount} failed`, 'summary');
      
      console.log(`✅ [${lockId}] SMART DIFF COMPLETE: ${duration}s, ${efficiency}% efficiency`);
      
      if (currentSync) {
        currentSync.completed = true;
        currentSync.isRunning = false;
      }
      
      broadcastSSEData({ 
        complete: true,
        finalCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, deleted: deletedCount, failed: failedCount },
        efficiency: { itemsProcessed: totalOperations, totalItems: totalOperations + skippedCount, percentage: efficiency, duration }
      });
      
      return { complete: true };
    } else {
      // More chunks to process - continue
      const nextChunkIndex = chunkIndex + 1;
      sendUpdate(`⏭️ Chunk ${chunkIndex + 1} complete, continuing with chunk ${nextChunkIndex + 1}...`, 'info');
      
      // Return continuation data
      return {
        complete: false,
        continueWith: {
          chunkIndex: nextChunkIndex,
          operationsData: operations
        }
      };
    }
    
  } catch (error) {
    console.error(`❌ [${lockId}] CHUNKED SYNC ERROR:`, error);
    broadcastSSEData({
      message: `Smart Diff Sync failed: ${error.message}`,
      type: 'failed',
      complete: true
    });
    throw error;
  }
}

// Main Vercel export function
module.exports = async (req, res) => {
  try {
    console.log('Request:', req.method, req.url);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const password = url.searchParams.get('password');
    const mode = url.searchParams.get('mode') || 'all';
    const limit = parseInt(url.searchParams.get('limit') || '0', 10);
    
    // NEW: Chunked processing parameters
    const chunkIndex = parseInt(url.searchParams.get('chunkIndex') || '0', 10);
    const operationsData = url.searchParams.get('operationsData') ? 
      JSON.parse(decodeURIComponent(url.searchParams.get('operationsData'))) : null;
    
    // Password check
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const pathname = url.pathname;
    
    if (pathname === '/health') {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }
    
    if (pathname === '/api/counts') {
      try {
        const [raindropTotal, notionTotal] = await Promise.all([
          getRaindropTotal(),
          getTotalNotionPages()
        ]);
        
        res.json({
          raindropTotal,
          notionTotal,
          isSynced: raindropTotal === notionTotal,
          success: true
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
      return;
    }
    
    if (pathname === '/sync-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      activeStreams.set(streamId, res);
      
      console.log(`🔗 NEW SYNC REQUEST: ${streamId}, mode: ${mode}, chunk: ${chunkIndex}`);
      
      // Check if another sync is running
      if (GLOBAL_SYNC_LOCK) {
        const lockDuration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
        console.log(`🚫 SYNC LOCK ACTIVE - Lock ID: ${SYNC_LOCK_ID}, Duration: ${lockDuration}s`);
        
        res.write(`data: ${JSON.stringify({
          message: `⏸️ Sync already running (${lockDuration}s elapsed). Please wait...`,
          type: 'waiting',
          lockInfo: { locked: true, lockId: SYNC_LOCK_ID, duration: lockDuration }
        })}\n\n`);
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
        chunkIndex,
        isRunning: true,
        lockId: SYNC_LOCK_ID,
        startTime: Date.now(),
        counts: { added: 0, updated: 0, skipped: 0, deleted: 0, failed: 0 },
        completed: false
      };
      
      // Start chunked sync process
      performChunkedSync(mode, limit, chunkIndex, operationsData)
        .then((result) => {
          console.log(`✅ Chunk completed successfully - Lock ID: ${SYNC_LOCK_ID}`);
          
          if (result.complete) {
            console.log(`✅ Full sync completed - Lock ID: ${SYNC_LOCK_ID}`);
          } else if (result.continueWith) {
            // Send continuation instruction to client
            const continueUrl = `/sync-stream?password=${encodeURIComponent(password)}&mode=${mode}&limit=${limit}&chunkIndex=${result.continueWith.chunkIndex}&operationsData=${encodeURIComponent(JSON.stringify(result.continueWith.operationsData))}`;
            
            broadcastSSEData({
              message: `🔄 Chunk complete, automatically continuing...`,
              type: 'info',
              continueWith: continueUrl
            });
          }
        })
        .catch(error => {
          console.error(`❌ CHUNKED SYNC ERROR - Lock ID: ${SYNC_LOCK_ID}:`, error);
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
          
          activeStreams.delete(streamId);
        });
      
      // Handle client disconnect
      req.on('close', () => {
        activeStreams.delete(streamId);
      });
      
      return;
    }
    
    if (pathname === '/sync' || pathname === '/sync-all') {
      const syncMode = pathname === '/sync-all' ? 'all' : (mode || 'new');
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${syncMode === 'all' ? 'Full Sync' : 'Incremental Sync'}</title>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { font-size: 72px; font-weight: normal; margin-bottom: 40px; }
            button { font-size: 48px; background: none; border: none; cursor: pointer; margin: 20px 0; }
            button:hover { opacity: 0.7; }
            button:disabled { opacity: 0.3; cursor: not-allowed; }
            .back { font-size: 24px; color: #666; text-decoration: none; }
            .status { background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0; max-height: 400px; overflow-y: auto; }
            .message { padding: 8px; margin: 4px 0; border-left: 3px solid #ccc; font-family: monospace; font-size: 14px; }
            .success { border-left-color: #22c55e; background: rgba(34, 197, 94, 0.1); }
            .error { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
            .info { border-left-color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
            .added { border-left-color: #22c55e; background: rgba(34, 197, 94, 0.1); }
            .updated { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.1); }
            .deleted { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
            .failed { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
            .complete { border-left-color: #22c55e; background: rgba(34, 197, 94, 0.1); font-weight: bold; }
          </style>
        </head>
        <body>
          <a href="/?password=${password}" class="back">← Back to Dashboard</a>
          <h1>${syncMode === 'all' ? 'Full Sync - Smart Diff' : 'Incremental Sync'}</h1>
          <p>${syncMode === 'all' ? 'Complete reconciliation using Smart Diff technology with chunked processing' : 'Sync recent bookmarks only'}</p>
          
          <button id="syncBtn" onclick="startSync()">
            Start ${syncMode === 'all' ? 'Smart Diff' : 'Incremental'} Sync
          </button>
          
          <div id="status" class="status" style="display: none;"></div>
          
          <script>
            let currentEventSource = null;
            
            function startSync() {
              const btn = document.getElementById('syncBtn');
              const status = document.getElementById('status');
              
              btn.disabled = true;
              btn.textContent = 'Sync Running...';
              status.style.display = 'block';
              status.innerHTML = '';
              
              connectToSync('/sync-stream?password=${password}&mode=${syncMode}');
            }
            
            function connectToSync(url) {
              if (currentEventSource) {
                currentEventSource.close();
              }
              
              currentEventSource = new EventSource(url);
              
              currentEventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                const div = document.createElement('div');
                div.className = 'message ' + (data.type || 'info');
                div.textContent = data.message;
                status.appendChild(div);
                status.scrollTop = status.scrollHeight;
                
                // Handle automatic continuation
                if (data.continueWith) {
                  setTimeout(() => {
                    connectToSync(data.continueWith);
                  }, 1000); // 1 second delay between chunks
                }
                
                if (data.complete) {
                  currentEventSource.close();
                  currentEventSource = null;
                  document.getElementById('syncBtn').disabled = false;
                  document.getElementById('syncBtn').textContent = 'Start ${syncMode === 'all' ? 'Smart Diff' : 'Incremental'} Sync';
                }
              };
              
              currentEventSource.onerror = function() {
                currentEventSource.close();
                currentEventSource = null;
                document.getElementById('syncBtn').disabled = false;
                document.getElementById('syncBtn').textContent = 'Start ${syncMode === 'all' ? 'Smart Diff' : 'Incremental'} Sync';
                const div = document.createElement('div');
                div.className = 'message error';
                div.textContent = '❌ Connection error';
                status.appendChild(div);
              };
            }
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    // Dashboard
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Raindrop/Notion Sync</title>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { font-size: 72px; font-weight: normal; letter-spacing: -0.05em; margin-bottom: 40px; }
            .count { font-size: 72px; margin-bottom: 20px; }
            .status { font-size: 72px; margin-bottom: 40px; color: #666; }
            .actions a { font-size: 72px; display: block; margin: 20px 0; color: #000; text-decoration: none; }
            .actions a:hover { opacity: 0.7; }
            .actions a.secondary { color: #e1e1e1; }
            .indicator { width: 100px; height: 20px; margin-bottom: 40px; background: #ff0000; }
            .indicator.synced { background: #17d827; }
          </style>
        </head>
        <body>
          <div id="indicator" class="indicator"></div>
          <h1>Raindrop/Notion Sync</h1>
          <div class="count" id="raindrop">... Raindrop Bookmarks</div>
          <div class="count" id="notion">... Notion Pages</div>
          <div class="status" id="status">Loading...</div>
          
          <div class="actions">
            <a href="/sync?password=${password}&mode=new">Sync New ↻</a>
            <a href="/sync-all?password=${password}" class="secondary">Reset / FullSync</a>
          </div>
          
          <script>
            fetch('/api/counts?password=${password}')
              .then(r => r.json())
              .then(data => {
                document.getElementById('raindrop').textContent = data.raindropTotal.toLocaleString() + ' Raindrop Bookmarks';
                document.getElementById('notion').textContent = data.notionTotal.toLocaleString() + ' Notion Pages';
                
                const diff = Math.abs(data.raindropTotal - data.notionTotal);
                const synced = diff <= 5;
                
                if (synced) {
                  document.getElementById('indicator').classList.add('synced');
                  document.getElementById('status').textContent = 'All bookmarks are synchronized';
                  document.getElementById('status').style.color = '#17d827';
                } else {
                  document.getElementById('status').textContent = diff.toLocaleString() + ' bookmarks need synchronization';
                  document.getElementById('status').style.color = '#ff0000';
                }
              })
              .catch(e => {
                document.getElementById('status').textContent = 'Error loading status';
                document.getElementById('status').style.color = '#ff0000';
                console.error('Count loading error:', e);
              });
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    res.status(404).json({ error: 'Not found' });
    
  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({ error: error.message });
  }
};
// Progressive Enhancement Sync System - Base Layer
// Single smart function handles all sync scenarios

// Import your excellent service files
const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

// Helper functions (kept from your original)
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

// Global sync management (simplified)
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

// ===== CORE SMART SYNC FUNCTION =====
// One function to handle all sync scenarios
async function performSmartSync(options = {}) {
  const {
    mode = 'smart',           // 'smart', 'reset', 'incremental'
    daysBack = 30,           // for incremental mode
    deleteOrphaned = false,   // whether to clean up deleted bookmarks
    limit = 0                // for testing (0 = no limit)
  } = options;

  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🧠 Starting Smart Sync (${mode} mode) - Lock ID: ${lockId}`);
  
  let addedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  
  try {
    // Helper to send progress updates
    const sendUpdate = (message, type = '') => {
      console.log(`🧠 [${lockId}] ${message}`);
      
      const updateData = {
        message: `${message}`,
        type,
        counts: { added: addedCount, updated: updatedCount, deleted: deletedCount, skipped: skippedCount, failed: failedCount },
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
    
    sendUpdate(`🧠 Starting Smart Sync (${mode} mode)`, 'info');
    
    // ===== PHASE 1: LOAD DATA (Parallel for speed) =====
    sendUpdate('📡 Loading data from both systems...', 'fetching');
    
    let raindrops = [];
    let notionPages = [];
    
    try {
      if (mode === 'incremental') {
        // Only get recent raindrops for incremental mode
        const hoursBack = daysBack * 24;
        [raindrops, notionPages] = await Promise.all([
          getRecentRaindrops(hoursBack),
          getNotionPages()
        ]);
        sendUpdate(`✅ Loaded ${raindrops.length} recent raindrops and ${notionPages.length} Notion pages`, 'success');
      } else {
        // Get all data for smart/reset modes
        [raindrops, notionPages] = await Promise.all([
          getAllRaindrops(limit),
          getNotionPages()
        ]);
        sendUpdate(`✅ Loaded ${raindrops.length} raindrops and ${notionPages.length} Notion pages`, 'success');
      }
    } catch (error) {
      throw new Error(`Data loading failed: ${error.message}`);
    }
    
    // ===== PHASE 2: SMART ANALYSIS =====
    if (mode === 'reset') {
      // Reset mode: Delete all, recreate all
      sendUpdate('🔄 Reset mode: Will delete all and recreate', 'analysis');
      
      // Delete all existing pages first
      if (notionPages.length > 0) {
        sendUpdate(`🗑️ Deleting ${notionPages.length} existing pages...`, 'processing');
        
        const deleteChunks = chunkArray(notionPages, 10);
        for (let i = 0; i < deleteChunks.length; i++) {
          const chunk = deleteChunks[i];
          sendUpdate(`🗑️ Deleting batch ${i + 1}/${deleteChunks.length}`, 'processing');
          
          for (const page of chunk) {
            try {
              await deleteNotionPage(page.id);
              deletedCount++;
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
              sendUpdate(`❌ Delete failed: ${error.message}`, 'failed');
              failedCount++;
              await new Promise(resolve => setTimeout(resolve, 400));
            }
          }
          
          if (i < deleteChunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      // Create all raindrops
      sendUpdate(`📝 Creating ${raindrops.length} new pages...`, 'processing');
      
      const createChunks = chunkArray(raindrops, 10);
      for (let i = 0; i < createChunks.length; i++) {
        const chunk = createChunks[i];
        sendUpdate(`📝 Creating batch ${i + 1}/${createChunks.length}`, 'processing');
        
        for (const item of chunk) {
          try {
            const result = await createNotionPage(item);
            if (result.success) {
              addedCount++;
              sendUpdate(`✅ Created: "${item.title}"`, 'added');
            } else {
              failedCount++;
              sendUpdate(`❌ Create failed: "${item.title}"`, 'failed');
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            failedCount++;
            sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
        
        if (i < createChunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
    } else {
      // Smart/Incremental mode: Calculate differences
      sendUpdate('🔍 Analyzing differences (Smart Diff)...', 'analysis');
      
      // Create lookup maps for fast comparison
      const notionByUrl = new Map();
      const notionByTitle = new Map();
      
      for (const page of notionPages) {
        const url = page.properties?.URL?.url;
        const title = page.properties?.Name?.title?.[0]?.text?.content;
        
        if (url) {
          notionByUrl.set(normalizeUrl(url), page);
        }
        if (title) {
          notionByTitle.set(normalizeTitle(title), page);
        }
      }
      
      const operations = {
        create: [],
        update: [],
        skip: []
      };
      
      // Analyze each raindrop
      for (const item of raindrops) {
        const normUrl = normalizeUrl(item.link);
        const normTitle = normalizeTitle(item.title);
        
        // Smart matching: URL first, then title fallback
        const existingPage = notionByUrl.get(normUrl) || notionByTitle.get(normTitle);
        
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
            operations.update.push({ item, existingPage });
          } else {
            operations.skip.push(item);
          }
        } else {
          operations.create.push(item);
        }
      }
      
      function tagsMatch(currentTags, newTags) {
        if (currentTags.size !== newTags.length) return false;
        for (const tag of newTags) {
          if (!currentTags.has(tag)) return false;
        }
        return true;
      }
      
      // Handle orphaned pages (if deleteOrphaned is true)
      if (deleteOrphaned && mode === 'smart') {
        const raindropUrls = new Set(raindrops.map(r => normalizeUrl(r.link)));
        for (const page of notionPages) {
          const pageUrl = normalizeUrl(page.properties?.URL?.url);
          if (pageUrl && !raindropUrls.has(pageUrl)) {
            operations.delete = operations.delete || [];
            operations.delete.push(page);
          }
        }
      }
      
      skippedCount = operations.skip.length;
      const totalOperations = operations.create.length + operations.update.length + (operations.delete?.length || 0);
      
      const efficiency = raindrops.length > 0 ? 
        Math.round(((raindrops.length - totalOperations) / raindrops.length) * 100) : 100;
      
      sendUpdate(`🔍 Smart Diff complete: ${operations.create.length} to add, ${operations.update.length} to update, ${skippedCount} already synced`, 'analysis');
      sendUpdate(`🚀 Processing ${totalOperations} operations (${efficiency}% efficiency!)`, 'info');
      
      if (totalOperations === 0) {
        sendUpdate('🎉 Everything already synced! No changes needed.', 'complete');
        broadcastSSEData({ 
          complete: true, 
          finalCounts: { added: 0, updated: 0, deleted: 0, skipped: skippedCount, failed: 0 },
          mode,
          efficiency: { percentage: 100 }
        });
        return { complete: true };
      }
      
      // ===== PHASE 3: EXECUTE OPERATIONS =====
      
      // Delete orphaned pages first (if any)
      if (operations.delete && operations.delete.length > 0) {
        sendUpdate(`🗑️ Removing ${operations.delete.length} orphaned pages...`, 'processing');
        for (const page of operations.delete) {
          try {
            await deleteNotionPage(page.id);
            deletedCount++;
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            failedCount++;
            sendUpdate(`❌ Delete failed: ${error.message}`, 'failed');
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
      }
      
      // Create new pages
      if (operations.create.length > 0) {
        sendUpdate(`➕ Creating ${operations.create.length} new pages...`, 'processing');
        for (const item of operations.create) {
          try {
            const result = await createNotionPage(item);
            if (result.success) {
              addedCount++;
              sendUpdate(`✅ Created: "${item.title}"`, 'added');
            } else {
              failedCount++;
              sendUpdate(`❌ Create failed: "${item.title}"`, 'failed');
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            failedCount++;
            sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
      }
      
      // Update existing pages
      if (operations.update.length > 0) {
        sendUpdate(`🔄 Updating ${operations.update.length} existing pages...`, 'processing');
        for (const { item, existingPage } of operations.update) {
          try {
            const success = await updateNotionPage(existingPage.id, item);
            if (success) {
              updatedCount++;
              sendUpdate(`🔄 Updated: "${item.title}"`, 'updated');
            } else {
              failedCount++;
              sendUpdate(`❌ Update failed: "${item.title}"`, 'failed');
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            failedCount++;
            sendUpdate(`❌ Error updating "${item.title}": ${error.message}`, 'failed');
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
      }
    }
    
    // ===== FINAL SUMMARY =====
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`🎉 Smart Sync completed in ${duration}s!`, 'complete');
    
    if (mode === 'reset') {
      sendUpdate(`📊 Results: ${addedCount} created, ${deletedCount} deleted, ${failedCount} failed`, 'summary');
    } else {
      const efficiency = raindrops.length > 0 ? 
        Math.round(((raindrops.length - (addedCount + updatedCount)) / raindrops.length) * 100) : 100;
      sendUpdate(`📊 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed`, 'summary');
      sendUpdate(`📈 Efficiency: ${efficiency}% (processed only necessary changes)`, 'info');
    }
    
    console.log(`✅ [${lockId}] SMART SYNC COMPLETE: ${duration}s`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { added: addedCount, updated: updatedCount, deleted: deletedCount, skipped: skippedCount, failed: failedCount },
      mode,
      duration
    });
    
    return { complete: true };
    
  } catch (error) {
    console.error(`❌ [${lockId}] SMART SYNC ERROR:`, error);
    broadcastSSEData({
      message: `Smart Sync failed: ${error.message}`,
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
    const mode = url.searchParams.get('mode') || 'smart';
    const limit = parseInt(url.searchParams.get('limit') || '0', 10);
    const daysBack = parseInt(url.searchParams.get('daysBack') || '30', 10);
    const deleteOrphaned = url.searchParams.get('deleteOrphaned') === 'true';
    
    // Password check
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const pathname = url.pathname;
    
    // Health check
    if (pathname === '/health') {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }
    
    // API: Get counts
    if (pathname === '/api/counts') {
      try {
        const [raindropTotal, notionTotal] = await Promise.all([
          getRaindropTotal(),
          getTotalNotionPages()
        ]);
        
        res.json({
          raindropTotal,
          notionTotal,
          isSynced: Math.abs(raindropTotal - notionTotal) <= 5,
          success: true
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
      return;
    }
    
    // Sync stream - the heart of the system
    if (pathname === '/sync-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      activeStreams.set(streamId, res);
      
      console.log(`🔗 NEW SYNC REQUEST: ${streamId}, mode: ${mode}`);
      
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
        isRunning: true,
        lockId: SYNC_LOCK_ID,
        startTime: Date.now(),
        counts: { added: 0, updated: 0, deleted: 0, skipped: 0, failed: 0 },
        completed: false
      };
      
      // Start the smart sync with options
      const syncOptions = {
        mode,
        limit,
        daysBack,
        deleteOrphaned
      };
      
      const syncPromise = performSmartSync(syncOptions);
      
      // Handle sync completion
      syncPromise
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
          
          activeStreams.delete(streamId);
        });
      
      // Handle client disconnect
      req.on('close', () => {
        activeStreams.delete(streamId);
      });
      
      return;
    }
    
    // Pages
    if (pathname === '/sync') {
      const syncMode = mode || 'smart';
      const pageTitle = syncMode === 'reset' ? 'Reset & Full Sync' : 
                       syncMode === 'incremental' ? 'Incremental Sync' : 'Smart Sync';
      const pageDescription = syncMode === 'reset' ? 'Delete all Notion pages and recreate from Raindrop' :
                             syncMode === 'incremental' ? 'Sync only recent bookmarks' : 'Smart analysis - only sync what needs to change';
      
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${pageTitle}</title>
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/dashboard.css">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <div class="container">
            <a href="/?password=${password}" class="back-button">← Back to Dashboard</a>
            <h1 class="text-huge">${pageTitle}</h1>
            <div class="text-medium" style="color: #666; margin-bottom: 40px;">${pageDescription}</div>
            
            <button id="syncBtn" onclick="startSync()" class="text-huge" style="background: none; border: none; cursor: pointer; margin: 20px 0;">
              Start ${pageTitle}
            </button>
            
            <div id="status" style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0; max-height: 400px; overflow-y: auto; display: none;"></div>
            
            <script>
              let currentEventSource = null;
              
              function startSync() {
                const btn = document.getElementById('syncBtn');
                const status = document.getElementById('status');
                
                btn.disabled = true;
                btn.textContent = 'Sync Running...';
                status.style.display = 'block';
                status.innerHTML = '<div style="padding: 8px; margin: 4px 0; border-left: 3px solid #3b82f6; background: rgba(59, 130, 246, 0.1); font-family: monospace; font-size: 14px;">🚀 Starting sync...</div>';
                
                const syncUrl = '/sync-stream?password=${password}&mode=${syncMode}&daysBack=${daysBack}&deleteOrphaned=${deleteOrphaned}';
                connectToSync(syncUrl);
              }
              
              function addMessage(message, type = 'info') {
                const status = document.getElementById('status');
                const div = document.createElement('div');
                div.style.cssText = 'padding: 8px; margin: 4px 0; border-left: 3px solid #ccc; font-family: monospace; font-size: 14px;';
                
                if (type === 'success' || type === 'added') div.style.borderLeftColor = '#22c55e';
                if (type === 'error' || type === 'failed') div.style.borderLeftColor = '#ef4444';
                if (type === 'info') div.style.borderLeftColor = '#3b82f6';
                if (type === 'updated') div.style.borderLeftColor = '#f59e0b';
                if (type === 'complete') div.style.borderLeftColor = '#22c55e';
                if (type === 'analysis') div.style.borderLeftColor = '#6366f1';
                
                div.textContent = message;
                status.appendChild(div);
                status.scrollTop = status.scrollHeight;
              }
              
              function connectToSync(url) {
                if (currentEventSource) {
                  currentEventSource.close();
                }
                
                addMessage('🔗 Connecting to sync stream...', 'info');
                currentEventSource = new EventSource(url);
                
                currentEventSource.onopen = function() {
                  addMessage('✅ Connected to sync stream', 'success');
                };
                
                currentEventSource.onmessage = function(event) {
                  try {
                    const data = JSON.parse(event.data);
                    
                    if (data.message) {
                      addMessage(data.message, data.type || 'info');
                    }
                    
                    if (data.complete) {
                      currentEventSource.close();
                      currentEventSource = null;
                      document.getElementById('syncBtn').disabled = false;
                      document.getElementById('syncBtn').textContent = 'Start ${pageTitle}';
                      
                      if (data.finalCounts) {
                        const counts = data.finalCounts;
                        addMessage(\`🎉 SYNC COMPLETE! Added: \${counts.added}, Updated: \${counts.updated}, Deleted: \${counts.deleted}, Skipped: \${counts.skipped}, Failed: \${counts.failed}\`, 'complete');
                      }
                    }
                    
                  } catch (error) {
                    console.error('Error parsing sync message:', error);
                    addMessage('❌ Error parsing sync data', 'error');
                  }
                };
                
                currentEventSource.onerror = function(error) {
                  console.error('EventSource error:', error);
                  currentEventSource.close();
                  currentEventSource = null;
                  document.getElementById('syncBtn').disabled = false;
                  document.getElementById('syncBtn').textContent = 'Start ${pageTitle}';
                  addMessage('❌ Connection error - sync interrupted', 'error');
                };
              }
            </script>
          </div>
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
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/dashboard.css">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <div class="container">
            <div class="dashboard">
              <div class="status-indicator not-synced" id="indicator"></div>
              <h1 class="text-huge">Raindrop/Notion Sync</h1>
              <div class="text-huge" id="raindrop">... Raindrop Bookmarks</div>
              <div class="text-huge" id="notion">... Notion Pages</div>
              <div class="text-huge" id="status" style="color: #666; margin-bottom: 40px;">Loading...</div>
              
              <div class="dashboard-actions">
                <a href="/sync?password=${password}&mode=smart" class="action-button primary">
                  Smart Sync ↻
                </a>
                
                <a href="/sync?password=${password}&mode=incremental" class="action-button secondary">
                  Recent Only (${daysBack} days)
                </a>
                
                <a href="/sync?password=${password}&mode=reset&deleteOrphaned=true" class="action-button secondary" style="color: #ff4444;">
                  Reset & Full Sync
                </a>
              </div>
            </div>
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
                  document.getElementById('indicator').classList.remove('not-synced');
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
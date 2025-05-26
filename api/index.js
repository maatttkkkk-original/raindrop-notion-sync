// Two-Mode Sync System: Reset & Full Sync + Smart Incremental with Temporal Filtering

// Node.js built-in modules
const fs = require('fs');
const path = require('path');

// Import your optimized service files
const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');


// Helper functions
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
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// === BASIC CACHE SYSTEM ===
const CACHE_CONFIG = {
  cacheDir: '/tmp/raindrop-cache',
  raindropsFile: 'raindrops-data.json',
  maxAge: 6 * 60 * 60 * 1000 // 6 hours
};

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_CONFIG.cacheDir)) {
      fs.mkdirSync(CACHE_CONFIG.cacheDir, { recursive: true });
    }
    return true;
  } catch (error) {
    console.error('Cache directory creation failed:', error.message);
    return false;
  }
}

function getCacheFilePath() {
  return path.join(CACHE_CONFIG.cacheDir, CACHE_CONFIG.raindropsFile);
}

function getCacheStatus() {
  try {
    const cachePath = getCacheFilePath();
    
    if (!fs.existsSync(cachePath)) {
      return { exists: false, valid: false, message: 'No cache found' };
    }
    
    const stats = fs.statSync(cachePath);
    const age = Date.now() - stats.mtime.getTime();
    const ageMinutes = Math.round(age / (1000 * 60));
    const isValid = age <= CACHE_CONFIG.maxAge;
    
    return {
      exists: true,
      valid: isValid,
      ageMinutes,
      message: isValid ? `Cache valid (${ageMinutes}m old)` : `Cache expired (${ageMinutes}m old)`
    };
  } catch (error) {
    return { exists: false, valid: false, error: error.message };
  }

  function getCacheStatus() {
  // ... existing code ...
}

// ADD THIS FUNCTION:
async function writeCacheData(raindrops) {
  try {
    if (!ensureCacheDir()) {
      throw new Error('Failed to create cache directory');
    }
    
    const cachePath = getCacheFilePath();
    const cacheData = {
      raindrops,
      timestamp: Date.now(),
      count: raindrops.length,
      cachedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(cachePath, JSON.stringify(cacheData), 'utf8');
    
    console.log(`✅ Cache written: ${raindrops.length} items`);
    return { success: true, itemCount: raindrops.length };
    
  } catch (error) {
    console.error('❌ Cache write failed:', error.message);
    throw error;
  }
}

}
async function readCacheData() {
  try {
    const cachePath = getCacheFilePath();
    
    if (!fs.existsSync(cachePath)) {
      throw new Error('Cache file not found');
    }
    
    const cacheRaw = fs.readFileSync(cachePath, 'utf8');
    const cacheData = JSON.parse(cacheRaw);
    
    // Check if cache is still valid
    const age = Date.now() - cacheData.timestamp;
    if (age > CACHE_CONFIG.maxAge) {
      throw new Error('Cache expired');
    }
    
    console.log(`✅ Cache read: ${cacheData.count} items`);
    return {
      success: true,
      raindrops: cacheData.raindrops,
      metadata: {
        count: cacheData.count,
        age: Math.round(age / (1000 * 60)), // age in minutes
        cachedAt: cacheData.cachedAt
      }
    };
    
  } catch (error) {
    console.error('❌ Cache read failed:', error.message);
    throw error;
  }
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

// MODE 1: RESET & FULL SYNC (Simple approach)
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
    
    // Create in batches using PROVEN WORKING TIMINGS from March 17th
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
      
      // PROVEN WORKING DELAY: 1000ms between batches (increased to 2000ms for extra safety)
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

// MODE 2: SMART INCREMENTAL SYNC (Temporal filtering)
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
          // PROVEN WORKING DELAY: 200ms between operations (error case gets 400ms)
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
          // PROVEN WORKING DELAY: 200ms between operations (error case gets 400ms)
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
    const mode = url.searchParams.get('mode') || 'incremental';
    const limit = parseInt(url.searchParams.get('limit') || '0', 10);
    const daysBack = parseInt(url.searchParams.get('daysBack') || '30', 10);
    
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
  if (pathname === '/api/cache-test') {
      try {
        const status = getCacheStatus();
        res.json({
          success: true,
          cache: status,
          config: {
            cacheDir: CACHE_CONFIG.cacheDir,
            maxAge: CACHE_CONFIG.maxAge
          }
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
      return;
    }
    
    if (pathname === '/api/cache-create') {
      try {
        console.log('🔄 Creating cache...');
        
        // Get recent raindrops for testing (limit to 10 for safety)
        const raindrops = await getAllRaindrops(10);
        
        // Write to cache
        const result = await writeCacheData(raindrops);
        
        res.json({
          success: true,
          message: `Cache created with ${result.itemCount} items`,
          result
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
      return;
    }
 if (pathname === '/api/cache-read') {
      try {
        const cacheData = await readCacheData();
        res.json({
          success: true,
          message: `Read ${cacheData.metadata.count} items from cache`,
          metadata: cacheData.metadata,
          sampleItems: cacheData.raindrops.slice(0, 3).map(item => ({
            title: item.title,
            link: item.link
          }))
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
      return;
    }
    if (pathname === '/api/cache-combo-test') {
      try {
        // Step 1: Create cache
        console.log('🔄 Creating cache...');
        const raindrops = await getAllRaindrops(5);
        await writeCacheData(raindrops);
        
        // Step 2: Immediately try to read it
        console.log('🔄 Reading cache...');
        const cacheData = await readCacheData();
        
        res.json({
          success: true,
          message: 'Cache create + read test successful',
          created: raindrops.length,
          read: cacheData.metadata.count
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
      return;
    }
    

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
        limit,
        daysBack,
        isRunning: true,
        lockId: SYNC_LOCK_ID,
        startTime: Date.now(),
        counts: { added: 0, updated: 0, skipped: 0, deleted: 0, failed: 0 },
        completed: false
      };
      
      // Choose sync mode
      let syncPromise;
      if (mode === 'reset' || mode === 'full') {
        syncPromise = performResetAndFullSync(limit);
      } else {
        syncPromise = performSmartIncrementalSync(daysBack);
      }
      
      // Start sync process
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
    
    // Sync pages with mode selection
    if (pathname === '/sync' || pathname === '/sync-all' || pathname === '/reset-sync') {
      let syncMode, pageTitle, pageDescription;
      
      if (pathname === '/reset-sync') {
        syncMode = 'reset';
        pageTitle = 'Reset & Full Sync';
        pageDescription = 'Delete all Notion pages and recreate from Raindrop';
      } else if (pathname === '/sync-all') {
        syncMode = 'reset';  // For now, full sync = reset sync
        pageTitle = 'Reset & Full Sync';
        pageDescription = 'Complete database reset and recreation';
      } else {
        syncMode = 'incremental';
        pageTitle = 'Smart Incremental Sync';
        pageDescription = 'Sync only recent bookmarks (last 30 days)';
      }
      
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${pageTitle}</title>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { font-size: 72px; font-weight: normal; margin-bottom: 40px; }
            .subtitle { font-size: 24px; color: #666; margin-bottom: 40px; line-height: 1.4; }
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
            .processing { border-left-color: #8b5cf6; background: rgba(139, 92, 246, 0.1); }
            .analysis { border-left-color: #6366f1; background: rgba(99, 102, 241, 0.1); }
            .fetching { border-left-color: #06b6d4; background: rgba(6, 182, 212, 0.1); }
            .summary { border-left-color: #10b981; background: rgba(16, 185, 129, 0.1); font-weight: bold; }
          </style>
        </head>
        <body>
          <a href="/?password=${password}" class="back">← Back to Dashboard</a>
          <h1>${pageTitle}</h1>
          <div class="subtitle">${pageDescription}</div>
          
          <button id="syncBtn" onclick="startSync()">
            Start ${syncMode === 'reset' ? 'Reset & Full' : 'Incremental'} Sync
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
              status.innerHTML = '<div class="message info">🚀 Starting sync...</div>';
              
              connectToSync('/sync-stream?password=${password}&mode=${syncMode}&daysBack=30');
            }
            
            function addMessage(message, type = 'info') {
              const status = document.getElementById('status');
              const div = document.createElement('div');
              div.className = 'message ' + type;
              div.textContent = message;
              status.appendChild(div);
              status.scrollTop = status.scrollHeight;
              
              const timestamp = new Date().toLocaleTimeString();
              console.log(\`[\${timestamp}] \${type.toUpperCase()}: \${message}\`);
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
                    document.getElementById('syncBtn').textContent = 'Start ${syncMode === 'reset' ? 'Reset & Full' : 'Incremental'} Sync';
                    
                    if (data.finalCounts) {
                      const counts = data.finalCounts;
                      if (data.mode === 'reset') {
                        addMessage(\`🎉 SYNC COMPLETE! Created: \${counts.created}, Deleted: \${counts.deleted}, Failed: \${counts.failed}\`, 'complete');
                      } else {
                        addMessage(\`🎉 SYNC COMPLETE! Added: \${counts.added}, Updated: \${counts.updated}, Skipped: \${counts.skipped}, Failed: \${counts.failed}\`, 'complete');
                      }
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
                document.getElementById('syncBtn').textContent = 'Start ${syncMode === 'reset' ? 'Reset & Full' : 'Incremental'} Sync';
                addMessage('❌ Connection error - sync interrupted', 'error');
              };
            }
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    // Dashboard with new sync options
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
            .actions a.danger { color: #ff4444; }
            .indicator { width: 100px; height: 20px; margin-bottom: 40px; background: #ff0000; }
            .indicator.synced { background: #17d827; }
            .mode-description { font-size: 24px; color: #999; margin-left: 20px; }
          </style>
        </head>
        <body>
          <div id="indicator" class="indicator"></div>
          <h1>Raindrop/Notion Sync</h1>
          <div class="count" id="raindrop">... Raindrop Bookmarks</div>
          <div class="count" id="notion">... Notion Pages</div>
          <div class="status" id="status">Loading...</div>
          
          <div class="actions">
            <a href="/sync?password=${password}&mode=incremental">
              Sync Recent ↻
              <div class="mode-description">Smart incremental (last 30 days)</div>
            </a>
            
            <a href="/reset-sync?password=${password}" class="danger">
              Reset & Full Sync
              <div class="mode-description">Delete all → recreate from Raindrop</div>
            </a>
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
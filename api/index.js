// Two-Mode Sync System: Reset & Full Sync + Smart Incremental with Temporal Filtering

// Import your optimized service files
const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

// Cache system imports
const fs = require('fs');
const path = require('path');

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

// === CACHE SYSTEM ===
const CACHE_CONFIG = {
  cacheDir: '/tmp/raindrop-cache',
  raindropsFile: 'raindrops-data.json',
  metadataFile: 'cache-metadata.json',
  maxAge: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
  compressionEnabled: true
};

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_CONFIG.cacheDir)) {
      fs.mkdirSync(CACHE_CONFIG.cacheDir, { recursive: true });
      console.log(`📁 Created cache directory: ${CACHE_CONFIG.cacheDir}`);
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to create cache directory:', error.message);
    return false;
  }
}

function getCacheFilePaths() {
  return {
    raindrops: path.join(CACHE_CONFIG.cacheDir, CACHE_CONFIG.raindropsFile),
    metadata: path.join(CACHE_CONFIG.cacheDir, CACHE_CONFIG.metadataFile)
  };
}

async function writeCacheData(raindrops) {
  const startTime = Date.now();
  
  try {
    if (!ensureCacheDir()) {
      throw new Error('Failed to ensure cache directory exists');
    }
    
    const paths = getCacheFilePaths();
    
    const cacheData = {
      raindrops,
      timestamp: Date.now(),
      count: raindrops.length
    };
    
    const metadata = {
      cachedAt: new Date().toISOString(),
      timestamp: Date.now(),
      itemCount: raindrops.length,
      version: '1.0',
      source: 'raindrop-api'
    };
    
    const dataJson = JSON.stringify(cacheData, null, 0);
    const metadataJson = JSON.stringify(metadata, null, 2);
    
    fs.writeFileSync(paths.raindrops, dataJson, 'utf8');
    fs.writeFileSync(paths.metadata, metadataJson, 'utf8');
    
    const duration = Date.now() - startTime;
    const sizeKB = Math.round(Buffer.byteLength(dataJson, 'utf8') / 1024);
    
    console.log(`✅ Cache written: ${raindrops.length} items, ${sizeKB}KB, ${duration}ms`);
    
    return {
      success: true,
      itemCount: raindrops.length,
      sizeKB,
      duration,
      cachedAt: metadata.cachedAt
    };
    
  } catch (error) {
    console.error('❌ Cache write failed:', error.message);
    throw error;
  }
}

async function readCacheData() {
  const startTime = Date.now();
  
  try {
    const paths = getCacheFilePaths();
    
    if (!fs.existsSync(paths.raindrops) || !fs.existsSync(paths.metadata)) {
      throw new Error('Cache files not found');
    }
    
    const metadataRaw = fs.readFileSync(paths.metadata, 'utf8');
    const metadata = JSON.parse(metadataRaw);
    
    const age = Date.now() - metadata.timestamp;
    const isExpired = age > CACHE_CONFIG.maxAge;
    
    if (isExpired) {
      const ageHours = Math.round(age / (1000 * 60 * 60));
      throw new Error(`Cache expired (${ageHours}h old)`);
    }
    
    const cacheRaw = fs.readFileSync(paths.raindrops, 'utf8');
    const cacheData = JSON.parse(cacheRaw);
    
    const duration = Date.now() - startTime;
    const sizeKB = Math.round(Buffer.byteLength(cacheRaw, 'utf8') / 1024);
    
    console.log(`✅ Cache read: ${cacheData.count} items, ${sizeKB}KB, ${duration}ms`);
    
    return {
      success: true,
      raindrops: cacheData.raindrops,
      metadata: {
        ...metadata,
        age: Math.round(age / (1000 * 60)),
        isValid: !isExpired
      },
      stats: {
        itemCount: cacheData.count,
        sizeKB,
        readDuration: duration
      }
    };
    
  } catch (error) {
    console.error('❌ Cache read failed:', error.message);
    throw error;
  }
}

async function getCacheStatus() {
  try {
    const paths = getCacheFilePaths();
    
    const cacheExists = fs.existsSync(paths.raindrops) && fs.existsSync(paths.metadata);
    
    if (!cacheExists) {
      return {
        exists: false,
        valid: false,
        message: 'No cache found'
      };
    }
    
    const metadataRaw = fs.readFileSync(paths.metadata, 'utf8');
    const metadata = JSON.parse(metadataRaw);
    
    const age = Date.now() - metadata.timestamp;
    const ageMinutes = Math.round(age / (1000 * 60));
    const ageHours = Math.round(age / (1000 * 60 * 60));
    const isValid = age <= CACHE_CONFIG.maxAge;
    
    const stats = fs.statSync(paths.raindrops);
    const sizeKB = Math.round(stats.size / 1024);
    
    return {
      exists: true,
      valid: isValid,
      metadata: {
        ...metadata,
        age: ageMinutes,
        ageHours,
        sizeKB
      },
      message: isValid ? 
        `Cache valid (${ageMinutes}m old, ${metadata.itemCount} items)` :
        `Cache expired (${ageHours}h old)`
    };
    
  } catch (error) {
    console.error('❌ Cache status check failed:', error.message);
    return {
      exists: false,
      valid: false,
      error: error.message,
      message: 'Cache status check failed'
    };
  }
}

async function clearCache() {
  try {
    const paths = getCacheFilePaths();
    
    let deletedFiles = 0;
    
    if (fs.existsSync(paths.raindrops)) {
      fs.unlinkSync(paths.raindrops);
      deletedFiles++;
    }
    
    if (fs.existsSync(paths.metadata)) {
      fs.unlinkSync(paths.metadata);
      deletedFiles++;
    }
    
    console.log(`🗑️ Cache cleared: ${deletedFiles} files deleted`);
    
    return {
      success: true,
      filesDeleted: deletedFiles,
      message: `Cache cleared (${deletedFiles} files deleted)`
    };
    
  } catch (error) {
    console.error('❌ Cache clear failed:', error.message);
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

// === CACHED SYNC FUNCTIONS ===

async function performCachedResetAndFullSync(limit = 0) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🔄 CACHED Reset & Full Sync starting - Lock ID: ${lockId}`);
  
  let createdCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  
  try {
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
    
    sendUpdate('🔄 Starting CACHED Reset & Full Sync', 'info');
    
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
      
      const deleteChunks = chunkArray(existingPages, 10);
      
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
            
            await new Promise(resolve => setTimeout(resolve, 200));
            
          } catch (error) {
            sendUpdate(`❌ Failed to delete page: ${error.message}`, 'failed');
            failedCount++;
            await new Promise(resolve => setTimeout(resolve, 400));
          }
        }
        
        if (i < deleteChunks.length - 1) {
          sendUpdate(`⏳ Deletion batch ${i + 1} complete, waiting...`, 'info');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      sendUpdate(`✅ Database reset complete: ${deletedCount} pages deleted`, 'success');
    } else {
      sendUpdate('✅ Notion database is already empty', 'info');
    }
    
    // === STEP 2: READ CACHED RAINDROP DATA ===
    sendUpdate('📁 Reading cached Raindrop data...', 'fetching');
    
    let raindrops = [];
    try {
      const cacheResult = await readCacheData();
      raindrops = cacheResult.raindrops;
      
      const ageMinutes = cacheResult.metadata.age;
      sendUpdate(`✅ Loaded ${raindrops.length} bookmarks from cache (${ageMinutes}m old)`, 'success');
    } catch (error) {
      throw new Error(`Failed to read cached raindrops: ${error.message}`);
    }
    
    if (limit > 0 && raindrops.length > limit) {
      raindrops = raindrops.slice(0, limit);
      sendUpdate(`✂️ Limited to ${limit} bookmarks for testing`, 'info');
    }
    
    if (raindrops.length === 0) {
      sendUpdate('No raindrops to sync. Process complete.', 'complete');
      broadcastSSEData({ complete: true });
      return { complete: true };
    }
    
    // === STEP 3: CREATE ALL PAGES (FAST!) ===
    sendUpdate(`📝 Creating ${raindrops.length} new Notion pages (using cached data)...`, 'processing');
    
    const batches = chunkArray(raindrops, 10);
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
          
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
      
      if (i < batchCount - 1) {
        sendUpdate(`⏳ Batch ${i + 1} complete, waiting before next batch...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`🎉 CACHED Reset & Full Sync completed in ${duration}s!`, 'complete');
    sendUpdate(`📊 Results: ${createdCount} created, ${deletedCount} deleted, ${failedCount} failed`, 'summary');
    sendUpdate(`⚡ SPEED BOOST: Used cached data instead of 1000+ API calls!`, 'success');
    
    console.log(`✅ [${lockId}] CACHED RESET & FULL SYNC COMPLETE: ${duration}s`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { created: createdCount, deleted: deletedCount, failed: failedCount },
      mode: 'cached-reset',
      duration,
      cached: true
    });
    
    return { complete: true };
    
  } catch (error) {
    console.error(`❌ [${lockId}] CACHED RESET & FULL SYNC ERROR:`, error);
    broadcastSSEData({
      message: `Cached Reset & Full Sync failed: ${error.message}`,
      type: 'failed',
      complete: true
    });
    throw error;
  }
}

async function performCachedSmartIncrementalSync(daysBack = 30) {
  const lockId = currentSync ? currentSync.lockId : 'unknown';
  console.log(`🧠 CACHED Smart Incremental Sync starting - Lock ID: ${lockId}, checking last ${daysBack} days`);
  
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  
  try {
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
    
    sendUpdate(`🧠 Starting CACHED Smart Incremental Sync (last ${daysBack} days)`, 'info');
    
    // === STEP 1: GET RECENT RAINDROPS FROM CACHE ===
    sendUpdate(`📁 Reading cached Raindrop data...`, 'fetching');
    
    let allRaindrops = [];
    try {
      const cacheResult = await readCacheData();
      allRaindrops = cacheResult.raindrops;
      
      const ageMinutes = cacheResult.metadata.age;
      sendUpdate(`✅ Loaded ${allRaindrops.length} bookmarks from cache (${ageMinutes}m old)`, 'success');
    } catch (error) {
      throw new Error(`Failed to read cached raindrops: ${error.message}`);
    }
    
    sendUpdate(`🔍 Filtering for recent items (last ${daysBack} days)...`, 'processing');
    
    const cutoffTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    const recentRaindrops = allRaindrops.filter(item => {
      if (!item.created) return true;
      const itemTime = new Date(item.created).getTime();
      return itemTime >= cutoffTime;
    });
    
    sendUpdate(`✅ Found ${recentRaindrops.length} recent bookmarks (from ${allRaindrops.length} total)`, 'success');
    
    if (recentRaindrops.length === 0) {
      sendUpdate('No recent raindrops found. Everything is up to date!', 'complete');
      broadcastSSEData({ 
        complete: true,
        finalCounts: { added: 0, updated: 0, skipped: 0, failed: 0 },
        mode: 'cached-incremental'
      });
      return { complete: true };
    }
    
    sendUpdate('📡 Building Notion URL lookup...', 'processing');
    
    let notionPages = [];
    try {
      notionPages = await getNotionPages();
    } catch (error) {
      throw new Error(`Failed to fetch Notion pages: ${error.message}`);
    }
    
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
    
    sendUpdate('🔍 Performing Smart Diff on recent items...', 'processing');
    
    const itemsToAdd = [];
    const itemsToUpdate = [];
    const itemsToSkip = [];
    
    for (const item of recentRaindrops) {
      const normUrl = normalizeUrl(item.link);
      const normTitle = normalizeTitle(item.title);
      
      const existingPage = notionUrlMap.get(normUrl) || notionTitleMap.get(normTitle);
      
      if (existingPage) {
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
        mode: 'cached-incremental' 
      });
      return { complete: true };
    }
    
    const efficiency = recentRaindrops.length > 0 ? 
      Math.round(((recentRaindrops.length - totalOperations) / recentRaindrops.length) * 100) : 100;
    sendUpdate(`🚀 Processing ${totalOperations} operations (${efficiency}% efficiency - using cached data!)`, 'info');
    
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
          
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error creating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    }
    
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
          
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          sendUpdate(`❌ Error updating "${item.title}": ${error.message}`, 'failed');
          failedCount++;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    }
    
    const duration = SYNC_START_TIME ? Math.round((Date.now() - SYNC_START_TIME) / 1000) : 0;
    
    sendUpdate(`🎉 CACHED Smart Incremental Sync completed in ${duration}s!`, 'complete');
    sendUpdate(`📊 Efficiency: Only checked ${recentRaindrops.length} recent items (cached data = no timeouts!)`, 'info');
    sendUpdate(`📈 Results: ${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed`, 'summary');
    
    console.log(`✅ [${lockId}] CACHED SMART INCREMENTAL COMPLETE: ${duration}s, ${efficiency}% efficiency`);
    
    if (currentSync) {
      currentSync.completed = true;
      currentSync.isRunning = false;
    }
    
    broadcastSSEData({ 
      complete: true,
      finalCounts: { added: addedCount, updated: updatedCount, skipped: skippedCount, failed: failedCount },
      efficiency: { itemsProcessed: totalOperations, totalItems: recentRaindrops.length, percentage: efficiency, duration },
      mode: 'cached-incremental',
      cached: true
    });
    
    return { complete: true };
    
  } catch (error) {
    console.error(`❌ [${lockId}] CACHED SMART INCREMENTAL ERROR:`, error);
    broadcastSSEData({
      message: `Cached Smart Incremental Sync failed: ${error.message}`,
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
    
    // === CACHE ENDPOINTS ===
    
    if (pathname === '/api/cache-status') {
      try {
        const status = await getCacheStatus();
        res.json({
          success: true,
          cache: status
        });
      } catch (error) {
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
      return;
    }
    
    if (pathname === '/api/cache-raindrops') {
      try {
        const limit = parseInt(url.searchParams.get('limit') || '0', 10);
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const streamId = Date.now().toString();
        console.log(`🔗 CACHE REQUEST: ${streamId}`);
        
        res.write(`data: ${JSON.stringify({
          message: '📡 Starting Raindrop data fetch for caching...',
          type: 'info'
        })}\n\n`);
        
        const cacheStatus = await getCacheStatus();
        if (cacheStatus.exists && cacheStatus.valid) {
          res.write(`data: ${JSON.stringify({
            message: `⚠️ Valid cache already exists (${cacheStatus.metadata.ageMinutes}m old, ${cacheStatus.metadata.itemCount} items)`,
            type: 'warning'
          })}\n\n`);
          
          res.write(`data: ${JSON.stringify({
            message: '🔄 Fetching fresh data anyway...',
            type: 'info'
          })}\n\n`);
        }
        
        res.write(`data: ${JSON.stringify({
          message: `📚 Fetching ${limit > 0 ? limit : 'all'} Raindrop bookmarks...`,
          type: 'fetching'
        })}\n\n`);
        
        const startTime = Date.now();
        const raindrops = await getAllRaindrops(limit);
        const fetchDuration = Math.round((Date.now() - startTime) / 1000);
        
        res.write(`data: ${JSON.stringify({
          message: `✅ Fetched ${raindrops.length} bookmarks in ${fetchDuration}s`,
          type: 'success'
        })}\n\n`);
        
        res.write(`data: ${JSON.stringify({
          message: '💾 Writing data to cache...',
          type: 'processing'
        })}\n\n`);
        
        const cacheResult = await writeCacheData(raindrops);
        
        res.write(`data: ${JSON.stringify({
          message: `✅ Cache updated: ${cacheResult.itemCount} items, ${cacheResult.sizeKB}KB`,
          type: 'success'
        })}\n\n`);
        
        const totalDuration = Math.round((Date.now() - startTime) / 1000);
        
        res.write(`data: ${JSON.stringify({
          message: `🎉 Cache refresh complete in ${totalDuration}s!`,
          type: 'complete',
          complete: true,
          stats: {
            itemCount: cacheResult.itemCount,
            sizeKB: cacheResult.sizeKB,
            duration: totalDuration,
            cachedAt: cacheResult.cachedAt
          }
        })}\n\n`);
        
        res.end();
        
      } catch (error) {
        res.write(`data: ${JSON.stringify({
          message: `❌ Cache refresh failed: ${error.message}`,
          type: 'failed',
          complete: true
        })}\n\n`);
        res.end();
      }
      return;
    }
    
    if (pathname === '/api/cache-clear') {
      try {
        const result = await clearCache();
        res.json({
          success: true,
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
    
    // === CACHED SYNC STREAMING ENDPOINT ===
    
    if (pathname === '/cached-sync-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      activeStreams.set(streamId, res);
      
      console.log(`🔗 NEW CACHED SYNC REQUEST: ${streamId}, mode: ${mode}`);
      
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
      
      try {
        const cacheStatus = await getCacheStatus();
        if (!cacheStatus.exists || !cacheStatus.valid) {
          res.write(`data: ${JSON.stringify({
            message: `❌ Cache ${!cacheStatus.exists ? 'not found' : 'expired'}. Please refresh cache first.`,
            type: 'failed',
            complete: true,
            needsCache: true
          })}\n\n`);
          activeStreams.delete(streamId);
          return;
        }
        
        res.write(`data: ${JSON.stringify({
          message: `✅ Using cached data (${cacheStatus.metadata.ageMinutes}m old, ${cacheStatus.metadata.itemCount} items)`,
          type: 'info'
        })}\n\n`);
        
      } catch (error) {
        res.write(`data: ${JSON.stringify({
          message: `❌ Cache check failed: ${error.message}`,
          type: 'failed',
          complete: true
        })}\n\n`);
        activeStreams.delete(streamId);
        return;
      }
      
      GLOBAL_SYNC_LOCK = true;
      SYNC_START_TIME = Date.now();
      SYNC_LOCK_ID = `cached_sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      console.log(`🔐 SETTING CACHED SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
      
      currentSync = {
        mode: 'cached-' + mode,
        limit,
        daysBack,
        isRunning: true,
        lockId: SYNC_LOCK_ID,
        startTime: Date.now(),
        counts: { added: 0, updated: 0, skipped: 0, deleted: 0, failed: 0 },
        completed: false,
        cached: true
      };
      
      let syncPromise;
      if (mode === 'reset' || mode === 'full') {
        syncPromise = performCachedResetAndFullSync(limit);
      } else {
        syncPromise = performCachedSmartIncrementalSync(daysBack);
      }
      
      syncPromise
        .then(() => {
          console.log(`✅ Cached sync completed successfully - Lock ID: ${SYNC_LOCK_ID}`);
        })
        .catch(error => {
          console.error(`❌ CACHED SYNC ERROR - Lock ID: ${SYNC_LOCK_ID}:`, error);
          broadcastSSEData({
            message: `Cached sync failed: ${error.message}`,
            type: 'failed',
            complete: true
          });
        })
        .finally(() => {
          console.log(`🔓 RELEASING CACHED SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
          GLOBAL_SYNC_LOCK = false;
          SYNC_START_TIME = null;
          SYNC_LOCK_ID = null;
          
          if (currentSync) {
            currentSync.isRunning = false;
            currentSync = null;
          }
          
          activeStreams.delete(streamId);
        });
      
      req.on('close', () => {
        activeStreams.delete(streamId);
      });
      
      return;
    }
    
    // === CACHE MANAGEMENT PAGES ===
    
    if (pathname === '/cache') {
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Cache Management</title>
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/dashboard.css">
          <link rel="stylesheet" href="/public/styles/components.css">
        </head>
        <body>
          <div class="container">
            <main class="dashboard">
              <div class="status-indicator" id="cache-indicator"></div>
              <h1 class="dashboard-title text-huge text-primary">Cache Management</h1>
              
              <div class="status-message calculating text-medium" id="cache-status">
                Loading cache status...
              </div>
              
              <div class="dashboard-actions">
                <button id="refresh-cache-btn" class="action-button primary">
                  Refresh Cache
                </button>
                <button id="clear-cache-btn" class="action-button secondary">
                  Clear Cache
                </button>
                <a href="/?password=${password}" class="action-button secondary">
                  Back to Dashboard
                </a>
              </div>
              
              <div class="live-updates" id="status" style="display: none;">
                <div id="sync-updates"></div>
              </div>
            </main>
          </div>
          
          <script>
            let currentEventSource = null;
            
            function startSync() {
              const btn = document.getElementById('syncBtn');
              const status = document.getElementById('status');
              
              btn.disabled = true;
              btn.textContent = 'Sync Running...';
              status.style.display = 'block';
              document.getElementById('sync-updates').innerHTML = '<div class="sync-update info">Starting cached sync...</div>';
              
              connectToSync('/cached-sync-stream?password=${password}&mode=incremental&daysBack=30');
            }
            
            function addMessage(message, type = 'info') {
              const updates = document.getElementById('sync-updates');
              const div = document.createElement('div');
              div.className = 'sync-update ' + type;
              div.textContent = message;
              updates.appendChild(div);
              updates.scrollTop = updates.scrollHeight;
            }
            
            function connectToSync(url) {
              if (currentEventSource) {
                currentEventSource.close();
              }
              
              addMessage('Connecting to cached sync stream...', 'info');
              currentEventSource = new EventSource(url);
              
              currentEventSource.onopen = function() {
                addMessage('Connected to cached sync stream', 'success');
              };
              
              currentEventSource.onmessage = function(event) {
                try {
                  const data = JSON.parse(event.data);
                  
                  if (data.message) {
                    addMessage(data.message, data.type || 'info');
                  }
                  
                  if (data.needsCache) {
                    addMessage('Go to Cache Management to refresh cache first', 'warning');
                  }
                  
                  if (data.complete) {
                    currentEventSource.close();
                    currentEventSource = null;
                    document.getElementById('syncBtn').disabled = false;
                    document.getElementById('syncBtn').textContent = 'Start CACHED Incremental Sync';
                    
                    if (data.finalCounts) {
                      const counts = data.finalCounts;
                      addMessage('CACHED SYNC COMPLETE! Added: ' + counts.added + ', Updated: ' + counts.updated + ', Skipped: ' + counts.skipped + ', Failed: ' + counts.failed, 'complete');
                    }
                  }
                } catch (error) {
                  console.error('Error parsing cached sync message:', error);
                  addMessage('Error parsing sync data', 'error');
                }
              };
              
              currentEventSource.onerror = function(error) {
                console.error('EventSource error:', error);
                currentEventSource.close();
                currentEventSource = null;
                document.getElementById('syncBtn').disabled = false;
                document.getElementById('syncBtn').textContent = 'Start CACHED Incremental Sync';
                addMessage('Connection error - cached sync interrupted', 'error');
              };
            }
            
            document.getElementById('syncBtn').addEventListener('click', startSync);
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    if (pathname === '/sync-all-cached') {
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>CACHED Full Sync</title>
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/sync.css">
          <link rel="stylesheet" href="/public/styles/components.css">
        </head>
        <body>
          <div class="container">
            <main class="sync-page">
              <div class="sync-status-indicator not-synced" id="sync-indicator"></div>
              <h1 class="text-huge text-primary">CACHED Reset & Full Sync</h1>
              <p class="text-medium">Lightning fast full sync using cached data</p>
              
              <div class="dashboard-actions">
                <button id="syncBtn" class="action-button primary">
                  Start CACHED Reset & Full Sync
                </button>
                <a href="/?password=${password}" class="action-button secondary">
                  Back to Dashboard
                </a>
              </div>
              
              <div class="live-updates" id="status" style="display: none;">
                <div id="sync-updates"></div>
              </div>
            </main>
          </div>
          
          <script>
            let currentEventSource = null;
            
            function startSync() {
              const btn = document.getElementById('syncBtn');
              const status = document.getElementById('status');
              
              btn.disabled = true;
              btn.textContent = 'Sync Running...';
              status.style.display = 'block';
              document.getElementById('sync-updates').innerHTML = '<div class="sync-update info">Starting cached full sync...</div>';
              
              connectToSync('/cached-sync-stream?password=${password}&mode=reset&daysBack=30');
            }
            
            function addMessage(message, type = 'info') {
              const updates = document.getElementById('sync-updates');
              const div = document.createElement('div');
              div.className = 'sync-update ' + type;
              div.textContent = message;
              updates.appendChild(div);
              updates.scrollTop = updates.scrollHeight;
            }
            
            function connectToSync(url) {
              if (currentEventSource) {
                currentEventSource.close();
              }
              
              addMessage('Connecting to cached sync stream...', 'info');
              currentEventSource = new EventSource(url);
              
              currentEventSource.onopen = function() {
                addMessage('Connected to cached sync stream', 'success');
              };
              
              currentEventSource.onmessage = function(event) {
                try {
                  const data = JSON.parse(event.data);
                  
                  if (data.message) {
                    addMessage(data.message, data.type || 'info');
                  }
                  
                  if (data.needsCache) {
                    addMessage('Go to Cache Management to refresh cache first', 'warning');
                  }
                  
                  if (data.complete) {
                    currentEventSource.close();
                    currentEventSource = null;
                    document.getElementById('syncBtn').disabled = false;
                    document.getElementById('syncBtn').textContent = 'Start CACHED Reset & Full Sync';
                    
                    if (data.finalCounts) {
                      const counts = data.finalCounts;
                      addMessage('CACHED SYNC COMPLETE! Created: ' + counts.created + ', Deleted: ' + counts.deleted + ', Failed: ' + counts.failed, 'complete');
                    }
                  }
                } catch (error) {
                  console.error('Error parsing cached sync message:', error);
                  addMessage('Error parsing sync data', 'error');
                }
              };
              
              currentEventSource.onerror = function(error) {
                console.error('EventSource error:', error);
                currentEventSource.close();
                currentEventSource = null;
                document.getElementById('syncBtn').disabled = false;
                document.getElementById('syncBtn').textContent = 'Start CACHED Reset & Full Sync';
                addMessage('Connection error - cached sync interrupted', 'error');
              };
            }
            
            document.getElementById('syncBtn').addEventListener('click', startSync);
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    if (pathname === '/sync-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      activeStreams.set(streamId, res);
      
      console.log(`🔗 NEW SYNC REQUEST: ${streamId}, mode: ${mode}`);
      
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
      
      GLOBAL_SYNC_LOCK = true;
      SYNC_START_TIME = Date.now();
      SYNC_LOCK_ID = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      console.log(`🔐 SETTING SYNC LOCK - ID: ${SYNC_LOCK_ID}`);
      
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
      
      let syncPromise;
      if (mode === 'reset' || mode === 'full') {
        syncPromise = performResetAndFullSync(limit);
      } else {
        syncPromise = performSmartIncrementalSync(daysBack);
      }
      
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
        syncMode = 'reset';
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
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/sync.css">
          <link rel="stylesheet" href="/public/styles/components.css">
        </head>
        <body>
          <div class="container">
            <main class="sync-page">
              <div class="sync-status-indicator not-synced" id="sync-indicator"></div>
              <h1 class="text-huge text-primary">${pageTitle}</h1>
              <p class="text-medium">${pageDescription}</p>
              
              <div class="dashboard-actions">
                <button id="syncBtn" class="action-button primary">
                  Start ${syncMode === 'reset' ? 'Reset & Full' : 'Incremental'} Sync
                </button>
                <a href="/?password=${password}" class="action-button secondary">
                  Back to Dashboard
                </a>
              </div>
              
              <div class="live-updates" id="status" style="display: none;">
                <div id="sync-updates"></div>
              </div>
            </main>
          </div>
          
          <script>
            let currentEventSource = null;
            
            function startSync() {
              const btn = document.getElementById('syncBtn');
              const status = document.getElementById('status');
              
              btn.disabled = true;
              btn.textContent = 'Sync Running...';
              status.style.display = 'block';
              document.getElementById('sync-updates').innerHTML = '<div class="sync-update info">Starting sync...</div>';
              
              connectToSync('/sync-stream?password=${password}&mode=${syncMode}&daysBack=30');
            }
            
            function addMessage(message, type = 'info') {
              const updates = document.getElementById('sync-updates');
              const div = document.createElement('div');
              div.className = 'sync-update ' + type;
              div.textContent = message;
              updates.appendChild(div);
              updates.scrollTop = updates.scrollHeight;
            }
            
            function connectToSync(url) {
              if (currentEventSource) {
                currentEventSource.close();
              }
              
              addMessage('Connecting to sync stream...', 'info');
              currentEventSource = new EventSource(url);
              
              currentEventSource.onopen = function() {
                addMessage('Connected to sync stream', 'success');
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
                        addMessage('SYNC COMPLETE! Created: ' + counts.created + ', Deleted: ' + counts.deleted + ', Failed: ' + counts.failed, 'complete');
                      } else {
                        addMessage('SYNC COMPLETE! Added: ' + counts.added + ', Updated: ' + counts.updated + ', Skipped: ' + counts.skipped + ', Failed: ' + counts.failed, 'complete');
                      }
                    }
                  }
                } catch (error) {
                  console.error('Error parsing sync message:', error);
                  addMessage('Error parsing sync data', 'error');
                }
              };
              
              currentEventSource.onerror = function(error) {
                console.error('EventSource error:', error);
                currentEventSource.close();
                currentEventSource = null;
                document.getElementById('syncBtn').disabled = false;
                document.getElementById('syncBtn').textContent = 'Start ${syncMode === 'reset' ? 'Reset & Full' : 'Incremental'} Sync';
                addMessage('Connection error - sync interrupted', 'error');
              };
            }
            
            document.getElementById('syncBtn').addEventListener('click', startSync);
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
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/dashboard.css">
          <link rel="stylesheet" href="/public/styles/components.css">
        </head>
        <body>
          <div class="container">
            <main class="dashboard">
              <div class="status-indicator" id="indicator"></div>
              <h1 class="dashboard-title text-huge text-primary">Raindrop/Notion Sync</h1>
              <div class="count-display" id="raindrop">... Raindrop Bookmarks</div>
              <div class="count-display" id="notion">... Notion Pages</div>
              <div class="status-message calculating text-huge" id="status">Loading...</div>
              
              <div class="dashboard-actions">
                <a href="/sync?password=${password}&mode=incremental" class="action-button primary">
                  Sync Recent ↻
                </a>
                <a href="/reset-sync?password=${password}" class="action-button secondary">
                  Reset / FullSync
                </a>
                <a href="/sync-cached?password=${password}&mode=incremental" class="action-button cached" id="cached-sync-new">
                  CACHED Sync Recent ↻ [FAST]
                </a>
                <a href="/sync-all-cached?password=${password}" class="action-button cached" id="cached-full-sync">
                  CACHED Reset & Full Sync [FAST]
                </a>
                <a href="/cache?password=${password}" class="action-button secondary">
                  Manage Cache
                </a>
              </div>
            </main>
          </div>
          
          <script>
            Promise.all([
              fetch('/api/counts?password=${password}').then(r => r.json()),
              fetch('/api/cache-status?password=${password}').then(r => r.json())
            ]).then(([countsData, cacheData]) => {
              document.getElementById('raindrop').textContent = countsData.raindropTotal.toLocaleString() + ' Raindrop Bookmarks';
              document.getElementById('notion').textContent = countsData.notionTotal.toLocaleString() + ' Notion Pages';
              
              const diff = Math.abs(countsData.raindropTotal - countsData.notionTotal);
              const synced = diff <= 5;
              
              if (synced) {
                document.getElementById('indicator').classList.add('synced');
                document.getElementById('status').textContent = 'All bookmarks are synchronized';
                document.getElementById('status').style.color = '#17d827';
              } else {
                document.getElementById('status').textContent = diff.toLocaleString() + ' bookmarks need synchronization';
                document.getElementById('status').style.color = '#ff0000';
              }
              
              const cachedButtons = document.querySelectorAll('.action-button.cached');
              if (cacheData.success && cacheData.cache.exists && cacheData.cache.valid) {
                cachedButtons.forEach(btn => {
                  btn.style.opacity = '1';
                  btn.style.pointerEvents = 'auto';
                });
              } else {
                cachedButtons.forEach(btn => {
                  btn.style.opacity = '0.5';
                  btn.style.pointerEvents = 'none';
                  btn.onclick = (e) => {
                    e.preventDefault();
                    alert('Cache not available. Please refresh cache first.');
                  };
                });
              }
            }).catch(e => {
              document.getElementById('status').textContent = 'Error loading status';
              document.getElementById('status').style.color = '#ff0000';
              console.error('Loading error:', e);
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
                </a>
              </div>
              
              <div class="status-message calculating text-small" id="refresh-status" style="display: none;"></div>
            </main>
          </div>
          
          <script>
            let currentEventSource = null;
            
            async function loadCacheStatus() {
              try {
                const response = await fetch('/api/cache-status?password=${password}');
                const data = await response.json();
                
                const statusDiv = document.getElementById('cache-status');
                const indicator = document.getElementById('cache-indicator');
                
                if (data.success && data.cache.exists) {
                  const cache = data.cache;
                  
                  if (cache.valid) {
                    statusDiv.textContent = 'Cache Status: ' + cache.message;
                    statusDiv.className = 'status-message synced text-medium';
                    indicator.className = 'status-indicator synced';
                  } else {
                    statusDiv.textContent = 'Cache Status: ' + cache.message;
                    statusDiv.className = 'status-message not-synced text-medium';
                    indicator.className = 'status-indicator not-synced';
                  }
                } else {
                  statusDiv.textContent = 'Cache Status: No cache found';
                  statusDiv.className = 'status-message not-synced text-medium';
                  indicator.className = 'status-indicator not-synced';
                }
              } catch (error) {
                document.getElementById('cache-status').textContent = 'Error loading cache status';
                document.getElementById('cache-indicator').className = 'status-indicator not-synced';
              }
            }
            
            function refreshCache() {
              const btn = document.getElementById('refresh-cache-btn');
              const statusDiv = document.getElementById('refresh-status');
              
              btn.disabled = true;
              btn.textContent = 'Refreshing...';
              statusDiv.style.display = 'block';
              statusDiv.textContent = 'Starting cache refresh...';
              statusDiv.className = 'status-message calculating text-small';
              
              if (currentEventSource) {
                currentEventSource.close();
              }
              
              currentEventSource = new EventSource('/api/cache-raindrops?password=${password}');
              
              currentEventSource.onmessage = function(event) {
                try {
                  const data = JSON.parse(event.data);
                  statusDiv.textContent = data.message;
                  
                  if (data.complete) {
                    currentEventSource.close();
                    currentEventSource = null;
                    btn.disabled = false;
                    btn.textContent = 'Refresh Cache';
                    statusDiv.className = 'status-message synced text-small';
                    
                    setTimeout(() => {
                      loadCacheStatus();
                    }, 1000);
                  }
                } catch (error) {
                  console.error('Error parsing cache message:', error);
                }
              };
              
              currentEventSource.onerror = function(error) {
                console.error('Cache refresh error:', error);
                currentEventSource.close();
                currentEventSource = null;
                btn.disabled = false;
                btn.textContent = 'Refresh Cache';
                statusDiv.textContent = 'Cache refresh failed';
                statusDiv.className = 'status-message not-synced text-small';
              };
            }
            
            async function clearCache() {
              if (!confirm('Are you sure you want to clear the cache?')) {
                return;
              }
              
              try {
                const response = await fetch('/api/cache-clear?password=${password}');
                const data = await response.json();
                
                if (data.success) {
                  loadCacheStatus();
                } else {
                  alert('Failed to clear cache: ' + data.error);
                }
              } catch (error) {
                alert('Error clearing cache: ' + error.message);
              }
            }
            
            document.getElementById('refresh-cache-btn').addEventListener('click', refreshCache);
            document.getElementById('clear-cache-btn').addEventListener('click', clearCache);
            
            loadCacheStatus();
          </script>
        </body>
        </html>
      `);
      return;
    }
    
    if (pathname === '/sync-cached') {
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>CACHED Incremental Sync</title>
          <link rel="stylesheet" href="/public/styles/design-system.css">
          <link rel="stylesheet" href="/public/styles/sync.css">
          <link rel="stylesheet" href="/public/styles/components.css">
        </head>
        <body>
          <div class="container">
            <main class="sync-page">
              <div class="sync-status-indicator not-synced" id="sync-indicator"></div>
              <h1 class="text-huge text-primary">CACHED Incremental Sync</h1>
              <p class="text-medium">Lightning fast sync using cached data</p>
              
              <div class="dashboard-actions">
                <button id="syncBtn" class="action-button primary">
                  Start CACHED Incremental Sync
                </button>
                <a href="/?password=${password}" class="action-button secondary">
                  Back to Dashboard
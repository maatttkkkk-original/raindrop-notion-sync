const fastify = require('fastify')({ logger: true });
const path = require('path');
const { getRaindrops } = require('./services/raindrop');
const { getNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('./services/notion');

// Register view engine for Handlebars
fastify.register(require('@fastify/view'), {
  engine: {
    handlebars: require('handlebars')
  },
  root: path.join(__dirname, '..', 'src', 'pages'),
  layout: false
});

// Register static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/public/'
});

// Password middleware
const requirePassword = async (request, reply) => {
  const password = request.query.password;
  if (!password || password !== process.env.APP_PASSWORD) {
    reply.code(401).send('Unauthorized');
  }
};

// Global sync state management
let GLOBAL_SYNC_LOCK = false;
let SYNC_START_TIME = null;
let SYNC_LOCK_ID = null;
let currentSync = null;

// Helper function to send SSE data
function sendSSEData(reply, data) {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Smart Diff Sync Function
async function performSmartDiffSync(mode = 'all', reply) {
  const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  try {
    sendSSEData(reply, { 
      message: `🔒 Starting Smart Diff sync (${mode})`, 
      type: 'info',
      syncId: syncId
    });

    // Step 1: Fetch all data once (efficient!)
    sendSSEData(reply, { message: '📡 Fetching raindrops...', type: 'info' });
    const raindrops = await getRaindrops();
    const totalRaindrops = raindrops.length;
    
    sendSSEData(reply, { 
      message: `✅ Found ${totalRaindrops} raindrops`, 
      type: 'success',
      progress: 25
    });

    sendSSEData(reply, { message: '📄 Fetching Notion pages...', type: 'info' });
    const notionPages = await getNotionPages();
    const totalNotion = notionPages.length;
    
    sendSSEData(reply, { 
      message: `✅ Found ${totalNotion} Notion pages`, 
      type: 'success',
      progress: 50
    });

    // Step 2: Build lookup maps for O(1) comparison
    sendSSEData(reply, { message: '🗺️ Building lookup maps...', type: 'info' });
    
    const notionLookupByUrl = new Map();
    const notionLookupByTitle = new Map();
    
    notionPages.forEach(page => {
      const url = page.properties?.URL?.url;
      const title = page.properties?.Name?.title?.[0]?.text?.content;
      
      if (url) notionLookupByUrl.set(url, page);
      if (title) notionLookupByTitle.set(title, page);
    });

    sendSSEData(reply, { 
      message: '✅ Lookup maps created', 
      type: 'success',
      progress: 60
    });

    // Step 3: Smart Diff Analysis - Pre-identify all differences
    sendSSEData(reply, { message: '🔍 Performing Smart Diff analysis...', type: 'info' });
    
    const toAdd = [];
    const toUpdate = [];
    const toSkip = [];
    let processed = 0;

    // Analyze each raindrop
    for (const raindrop of raindrops) {
      processed++;
      
      // Filter based on mode
      if (mode === 'new') {
        const createdDate = new Date(raindrop.created);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (createdDate < thirtyDaysAgo) {
          toSkip.push(raindrop);
          continue;
        }
      }

      const existingPageByUrl = notionLookupByUrl.get(raindrop.link);
      const existingPageByTitle = notionLookupByTitle.get(raindrop.title);
      const existingPage = existingPageByUrl || existingPageByTitle;

      if (!existingPage) {
        // New item to add
        toAdd.push(raindrop);
      } else {
        // Check if update needed
        const notionTitle = existingPage.properties?.Name?.title?.[0]?.text?.content || '';
        const notionUrl = existingPage.properties?.URL?.url || '';
        const notionTags = existingPage.properties?.Tags?.multi_select?.map(tag => tag.name) || [];
        const raindropTags = raindrop.tags || [];

        const needsUpdate = 
          notionTitle !== raindrop.title ||
          notionUrl !== raindrop.link ||
          JSON.stringify(notionTags.sort()) !== JSON.stringify(raindropTags.sort());

        if (needsUpdate) {
          toUpdate.push({ raindrop, existingPage });
        } else {
          toSkip.push(raindrop);
        }
      }

      // Progress update every 100 items
      if (processed % 100 === 0) {
        const progress = 60 + (processed / totalRaindrops) * 20;
        sendSSEData(reply, { 
          message: `🔍 Analyzed ${processed}/${totalRaindrops} items...`, 
          type: 'info',
          progress: Math.round(progress)
        });
      }
    }

    // Handle deletions for full sync
    const toDelete = [];
    if (mode === 'all') {
      const raindropUrls = new Set(raindrops.map(r => r.link));
      const raindropTitles = new Set(raindrops.map(r => r.title));
      
      for (const page of notionPages) {
        const url = page.properties?.URL?.url;
        const title = page.properties?.Name?.title?.[0]?.text?.content;
        
        if (url && !raindropUrls.has(url) && title && !raindropTitles.has(title)) {
          toDelete.push(page);
        }
      }
    }

    const totalOperations = toAdd.length + toUpdate.length + toDelete.length;
    const efficiencyPercentage = totalOperations > 0 ? 
      Math.round(((totalRaindrops - totalOperations) / totalRaindrops) * 100) : 100;

    sendSSEData(reply, { 
      message: `🔍 Smart Diff complete: ${toAdd.length} to add, ${toUpdate.length} to update, ${toSkip.length} to skip, ${toDelete.length} to delete`, 
      type: 'success',
      progress: 80
    });

    sendSSEData(reply, { 
      message: `🚀 Processing ${totalOperations} operations (${efficiencyPercentage}% efficiency vs 100% in old system)`, 
      type: 'info'
    });

    // Step 4: Process only the differences (not all items!)
    let completedOperations = 0;

    // Add new items
    if (toAdd.length > 0) {
      sendSSEData(reply, { message: `➕ Adding ${toAdd.length} new pages...`, type: 'info' });
      
      for (const raindrop of toAdd) {
        try {
          await createNotionPage({
            name: raindrop.title,
            url: raindrop.link,
            tags: raindrop.tags || [],
            created: raindrop.created,
            excerpt: raindrop.excerpt || ''
          });
          
          completedOperations++;
          sendSSEData(reply, { 
            message: `➕ Added: "${raindrop.title}"`, 
            type: 'success'
          });

          // Progress update
          const progress = 80 + (completedOperations / totalOperations) * 20;
          sendSSEData(reply, { progress: Math.round(progress) });
          
        } catch (error) {
          sendSSEData(reply, { 
            message: `❌ Failed to add: "${raindrop.title}" - ${error.message}`, 
            type: 'error'
          });
        }
      }
    }

    // Update existing items
    if (toUpdate.length > 0) {
      sendSSEData(reply, { message: `🔄 Updating ${toUpdate.length} existing pages...`, type: 'info' });
      
      for (const { raindrop, existingPage } of toUpdate) {
        try {
          await updateNotionPage(existingPage.id, {
            name: raindrop.title,
            url: raindrop.link,
            tags: raindrop.tags || [],
            excerpt: raindrop.excerpt || ''
          });
          
          completedOperations++;
          sendSSEData(reply, { 
            message: `🔄 Updated: "${raindrop.title}"`, 
            type: 'success'
          });

          // Progress update
          const progress = 80 + (completedOperations / totalOperations) * 20;
          sendSSEData(reply, { progress: Math.round(progress) });
          
        } catch (error) {
          sendSSEData(reply, { 
            message: `❌ Failed to update: "${raindrop.title}" - ${error.message}`, 
            type: 'error'
          });
        }
      }
    }

    // Delete orphaned items (full sync only)
    if (toDelete.length > 0) {
      sendSSEData(reply, { message: `🗑️ Removing ${toDelete.length} orphaned pages...`, type: 'info' });
      
      for (const page of toDelete) {
        try {
          await deleteNotionPage(page.id);
          
          completedOperations++;
          const title = page.properties?.Name?.title?.[0]?.text?.content || 'Unknown';
          sendSSEData(reply, { 
            message: `🗑️ Removed: "${title}"`, 
            type: 'success'
          });

          // Progress update
          const progress = 80 + (completedOperations / totalOperations) * 20;
          sendSSEData(reply, { progress: Math.round(progress) });
          
        } catch (error) {
          const title = page.properties?.Name?.title?.[0]?.text?.content || 'Unknown';
          sendSSEData(reply, { 
            message: `❌ Failed to remove: "${title}" - ${error.message}`, 
            type: 'error'
          });
        }
      }
    }

    // Completion
    const endTime = Date.now();
    const duration = endTime - SYNC_START_TIME;
    const durationStr = `${Math.round(duration / 1000)}s`;

    sendSSEData(reply, { 
      message: `✅ Smart Diff sync completed in ${durationStr}! Efficiency: ${efficiencyPercentage}%`, 
      type: 'success',
      progress: 100,
      isComplete: true,
      stats: {
        added: toAdd.length,
        updated: toUpdate.length,
        skipped: toSkip.length,
        deleted: toDelete.length,
        duration: durationStr,
        efficiency: efficiencyPercentage
      }
    });

    return true;

  } catch (error) {
    console.error('Smart Diff sync error:', error);
    sendSSEData(reply, { 
      message: `❌ Sync failed: ${error.message}`, 
      type: 'error',
      isComplete: true,
      hasError: true
    });
    throw error;
  }
}

// Routes

// Main dashboard route
fastify.get('/', { preHandler: requirePassword }, async (request, reply) => {
  try {
    return reply.view('index.hbs', {
      password: request.query.password
    });
  } catch (error) {
    fastify.log.error(error);
    return reply.view('error.hbs', {
      error: error.message || 'Unknown error occurred',
      password: request.query.password
    });
  }
});

// Universal sync page (handles both incremental and full sync)
fastify.get('/sync', { preHandler: requirePassword }, async (request, reply) => {
  return reply.view('sync.hbs', {
    mode: request.query.mode || 'new',
    password: request.query.password
  });
});

// Full sync page (redirects to universal sync with mode=all)
fastify.get('/sync-all', { preHandler: requirePassword }, async (request, reply) => {
  return reply.view('sync.hbs', {
    mode: 'all',
    password: request.query.password
  });
});

// SSE route for streaming sync updates
fastify.get('/sync-stream', { preHandler: requirePassword }, (request, reply) => {
  const mode = request.query.mode || 'all';
  
  // Set SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('Access-Control-Allow-Origin', '*');

  // Check if another sync is already running
  if (GLOBAL_SYNC_LOCK) {
    const elapsedTime = Math.round((Date.now() - SYNC_START_TIME) / 1000);
    sendSSEData(reply, { 
      message: `⏸️ Sync already running (${elapsedTime}s elapsed). Please wait...`, 
      type: 'warning'
    });
    return reply;
  }

  // Set sync lock
  GLOBAL_SYNC_LOCK = true;
  SYNC_START_TIME = Date.now();
  SYNC_LOCK_ID = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Store current sync info
  currentSync = {
    id: SYNC_LOCK_ID,
    mode: mode,
    startTime: SYNC_START_TIME,
    isRunning: true
  };

  // Handle client disconnect
  request.raw.on('close', () => {
    console.log('Client disconnected from sync stream');
  });

  // Start sync process
  performSmartDiffSync(mode, reply)
    .then(() => {
      console.log('Sync completed successfully');
    })
    .catch((error) => {
      console.error('Sync failed:', error);
    })
    .finally(() => {
      // Clear sync lock
      GLOBAL_SYNC_LOCK = false;
      SYNC_START_TIME = null;
      SYNC_LOCK_ID = null;
      currentSync = null;
      
      // Close connection
      reply.raw.end();
    });

  return reply;
});

// API endpoint for counts
fastify.get('/api/counts', { preHandler: requirePassword }, async (request, reply) => {
  try {
    // Fetch counts in parallel for efficiency
    const [raindrops, notionPages] = await Promise.all([
      getRaindrops(),
      getNotionPages()
    ]);

    const counts = {
      raindropTotal: raindrops.length,
      notionTotal: notionPages.length,
      lastUpdated: new Date().toISOString(),
      isSynced: Math.abs(raindrops.length - notionPages.length) <= 5 // Allow small difference
    };

    reply.send(counts);
  } catch (error) {
    fastify.log.error('Error fetching counts:', error);
    reply.code(500).send({ error: 'Failed to fetch counts' });
  }
});

// Diagnostic route
fastify.get('/diagnostic', { preHandler: requirePassword }, async (request, reply) => {
  try {
    const [raindrops, notionPages] = await Promise.all([
      getRaindrops().catch(e => ({ error: e.message })),
      getNotionPages().catch(e => ({ error: e.message }))
    ]);

    const diagnostic = {
      timestamp: new Date().toISOString(),
      raindrop: {
        status: raindrops.error ? 'error' : 'ok',
        count: raindrops.error ? 0 : raindrops.length,
        error: raindrops.error
      },
      notion: {
        status: notionPages.error ? 'error' : 'ok',
        count: notionPages.error ? 0 : notionPages.length,
        error: notionPages.error
      },
      sync: {
        locked: GLOBAL_SYNC_LOCK,
        lockId: SYNC_LOCK_ID,
        startTime: SYNC_START_TIME,
        currentSync: currentSync
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage()
      }
    };

    reply.send(diagnostic);
  } catch (error) {
    fastify.log.error('Diagnostic error:', error);
    reply.code(500).send({ error: 'Diagnostic failed' });
  }
});

// Debug route for sync status
fastify.get('/sync-debug', { preHandler: requirePassword }, async (request, reply) => {
  const debug = {
    syncInProgress: GLOBAL_SYNC_LOCK,
    syncLockId: SYNC_LOCK_ID,
    syncStartTime: SYNC_START_TIME,
    currentSync: currentSync,
    timestamp: new Date().toISOString()
  };

  if (SYNC_START_TIME) {
    debug.elapsedTime = Date.now() - SYNC_START_TIME;
    debug.elapsedTimeFormatted = `${Math.round(debug.elapsedTime / 1000)}s`;
  }

  reply.send(debug);
});

// Lock management route
fastify.get('/test-sync-lock', { preHandler: requirePassword }, async (request, reply) => {
  const action = request.query.action;
  
  if (action === 'clear') {
    GLOBAL_SYNC_LOCK = false;
    SYNC_START_TIME = null;
    SYNC_LOCK_ID = null;
    currentSync = null;
    
    reply.send({ 
      message: 'Sync lock cleared',
      timestamp: new Date().toISOString()
    });
  } else {
    reply.send({
      locked: GLOBAL_SYNC_LOCK,
      lockId: SYNC_LOCK_ID,
      startTime: SYNC_START_TIME,
      currentSync: currentSync,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  
  // Check if it's a password error
  if (error.statusCode === 401) {
    reply.code(401).send('Unauthorized - Invalid password');
    return;
  }
  
  reply.code(500).send({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Health check
fastify.get('/health', async (request, reply) => {
  reply.send({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Export for Vercel
module.exports = fastify;
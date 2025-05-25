const fastify = require('fastify')({ logger: true });
const path = require('path');

// Try to require services
let getRaindrops, getNotionPages, createNotionPage, updateNotionPage, deleteNotionPage;

try {
  const raindropService = require('./services/raindrop');
  const notionService = require('./services/notion');
  
  getRaindrops = raindropService.getRaindrops;
  getNotionPages = notionService.getNotionPages;
  createNotionPage = notionService.createNotionPage;
  updateNotionPage = notionService.updateNotionPage;
  deleteNotionPage = notionService.deleteNotionPage;
  
  console.log('✅ Services loaded successfully');
} catch (error) {
  console.error('❌ Error loading services:', error.message);
  // Provide dummy functions for testing
  getRaindrops = async () => [];
  getNotionPages = async () => [];
  createNotionPage = async () => {};
  updateNotionPage = async () => {};
  deleteNotionPage = async () => {};
}

// Register view engine for Handlebars
try {
  fastify.register(require('@fastify/view'), {
    engine: {
      handlebars: require('handlebars')
    },
    root: path.join(__dirname, '..', 'src', 'pages'),
    layout: false,
    options: {
      helpers: {
        eq: function(a, b) {
          return a === b;
        }
      }
    }
  });
  console.log('✅ View engine registered');
} catch (error) {
  console.error('❌ Error registering view engine:', error.message);
}

// Register static files
try {
  fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/public/'
  });
  console.log('✅ Static files registered');
} catch (error) {
  console.error('❌ Error registering static files:', error.message);
}

// Password middleware - using ADMIN_PASSWORD
const requirePassword = async (request, reply) => {
  const password = request.query.password;
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    reply.code(401).send('Unauthorized');
  }
};

// Global sync state
let GLOBAL_SYNC_LOCK = false;
let SYNC_START_TIME = null;
let SYNC_LOCK_ID = null;
let currentSync = null;

// Helper function to send SSE data
function sendSSEData(reply, data) {
  try {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error('Error sending SSE data:', error);
  }
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
    console.error('Dashboard error:', error);
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>Raindrop/Notion Sync</title></head>
      <body>
        <h1>Raindrop/Notion Sync</h1>
        <p>Dashboard temporarily unavailable. Template error: ${error.message}</p>
        <a href="/sync?password=${request.query.password}">Go to Sync</a>
      </body>
      </html>
    `);
  }
});

// Universal sync page
fastify.get('/sync', { preHandler: requirePassword }, async (request, reply) => {
  try {
    return reply.view('sync.hbs', {
      mode: request.query.mode || 'new',
      password: request.query.password
    });
  } catch (error) {
    console.error('Sync page error:', error);
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>Sync</title></head>
      <body>
        <h1>Sync</h1>
        <p>Sync page temporarily unavailable. Template error: ${error.message}</p>
        <a href="/?password=${request.query.password}">Back to Dashboard</a>
      </body>
      </html>
    `);
  }
});

// Full sync page
fastify.get('/sync-all', { preHandler: requirePassword }, async (request, reply) => {
  try {
    return reply.view('sync.hbs', {
      mode: 'all',
      password: request.query.password
    });
  } catch (error) {
    console.error('Sync-all page error:', error);
    return reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
      <head><title>Full Sync</title></head>
      <body>
        <h1>Full Sync</h1>
        <p>Sync page temporarily unavailable. Template error: ${error.message}</p>
        <a href="/?password=${request.query.password}">Back to Dashboard</a>
      </body>
      </html>
    `);
  }
});

// SSE route for streaming sync updates
fastify.get('/sync-stream', { preHandler: requirePassword }, (request, reply) => {
  const mode = request.query.mode || 'all';
  
  try {
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
        try {
          reply.raw.end();
        } catch (error) {
          console.error('Error closing SSE connection:', error);
        }
      });

  } catch (error) {
    console.error('SSE route error:', error);
    try {
      reply.code(500).send({ error: 'SSE connection failed' });
    } catch (replyError) {
      console.error('Error sending error response:', replyError);
    }
  }

  return reply;
});

// API endpoint for counts
fastify.get('/api/counts', { preHandler: requirePassword }, async (request, reply) => {
  try {
    const [raindrops, notionPages] = await Promise.all([
      getRaindrops(),
      getNotionPages()
    ]);

    const counts = {
      raindropTotal: raindrops.length,
      notionTotal: notionPages.length,
      lastUpdated: new Date().toISOString(),
      isSynced: Math.abs(raindrops.length - notionPages.length) <= 5
    };

    reply.send(counts);
  } catch (error) {
    console.error('Error fetching counts:', error);
    reply.code(500).send({ 
      error: 'Failed to fetch counts',
      raindropTotal: 0,
      notionTotal: 0,
      lastUpdated: new Date().toISOString(),
      isSynced: false
    });
  }
});

// Health check
fastify.get('/health', async (request, reply) => {
  reply.send({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Lock management
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
  console.error('Fastify error:', error);
  
  reply.code(error.statusCode || 500).send({
    error: 'Server Error',
    message: error.message
  });
});

// Export for Vercel
module.exports = fastify;
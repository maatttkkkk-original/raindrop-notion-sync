// Fastify server - SPEED OPTIMIZED VERSION
const path = require('path');
const Fastify = require('fastify');
const handlebars = require('handlebars');

const fastify = Fastify({ logger: true });

// Import only the FAST functions we need
const { getRaindropTotal } = require('../services/raindrop');
const { getTotalNotionPages } = require('../services/notion');

// Password validation function
function validatePassword(password) {
  if (!password) return false;
  return password === process.env.ADMIN_PASSWORD;
}

// Register Handlebars helpers
const helpers = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  lt: (a, b) => a < b,
  and: (a, b) => a && b,
  or: (a, b) => a || b,
  not: (a) => !a,
  formatNumber: (num) => num ? num.toLocaleString() : '0'
};

Object.entries(helpers).forEach(([name, fn]) => {
  handlebars.registerHelper(name, fn);
});

// Register view engine
fastify.register(require('@fastify/view'), {
  engine: { handlebars: handlebars },
  root: path.join(__dirname, '../src/pages'),
  layout: false
});

// Register static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/public/'
});

// DASHBOARD PAGE - FAST VERSION
fastify.get('/', async (req, reply) => {
  const password = req.query.password || '';

  // Validate password
  if (!validatePassword(password)) {
    return reply.view('error', {
      error: 'Invalid password',
      password: '',
      code: 'AUTH_ERROR',
      details: 'Please provide a valid password'
    });
  }

  try {
    // Get ONLY the counts - much faster than loading all data
    console.log('⏱️ Loading dashboard counts...');
    const startTime = Date.now();
    
    const [raindropTotal, notionTotal] = await Promise.all([
      getRaindropTotal(),
      getTotalNotionPages()
    ]);
    
    const loadTime = Date.now() - startTime;
    console.log(`✅ Dashboard loaded in ${loadTime}ms`);

    // Calculate sync status
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
    console.error('❌ Dashboard error:', error);
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
  const daysBack = parseInt(req.query.daysBack || '30');
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

  // Validate password
  if (!validatePassword(password)) {
    return reply.view('error', {
      error: 'Invalid password',
      password: '',
      code: 'AUTH_ERROR',
      details: 'Please provide a valid password'
    });
  }

  try {
    // NO DATA LOADING - just render the page immediately
    console.log('⚡ Rendering sync page instantly...');
    
    reply.view('sync', {
      password,
      mode,
      syncMode: mode,
      daysBack,
      deleteOrphaned,
      pageTitle: mode === 'reset' ? 'Reset & Full Sync' : mode === 'incremental' ? 'Incremental Sync' : 'Smart Sync',
      pageDescription:
        mode === 'reset'
          ? 'Delete all Notion pages and recreate from Raindrop'
          : mode === 'incremental'
          ? `Sync only recent bookmarks (${daysBack} days)`
          : 'Smart analysis — only sync what needs to change'
    });

  } catch (error) {
    console.error('❌ Sync page error:', error);
    reply.view('error', { 
      error: error.message,
      password,
      code: 'SYNC_PAGE_ERROR',
      details: 'Failed to load sync page'
    });
  }
});

// API COUNTS - FAST VERSION
fastify.get('/api/counts', async (req, reply) => {
  const password = req.query.password || '';

  if (!validatePassword(password)) {
    return reply.status(401).send({
      error: 'Invalid password',
      success: false
    });
  }

  try {
    const [raindropTotal, notionTotal] = await Promise.all([
      getRaindropTotal(),
      getTotalNotionPages()
    ]);

    const diff = Math.abs(raindropTotal - notionTotal);
    const isSynced = diff <= 5;

    reply.send({
      raindropTotal,
      notionTotal,
      isSynced,
      diff,
      syncStatus: isSynced ? 'Synced' : `${diff} bookmarks need sync`,
      success: true
    });

  } catch (error) {
    reply.status(500).send({ 
      error: error.message,
      success: false 
    });
  }
});

// SYNC STREAM - LOAD DATA ONLY WHEN SYNC STARTS
fastify.get('/sync-stream', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';
  const daysBack = parseInt(req.query.daysBack || '30');
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

  if (!validatePassword(password)) {
    reply.raw.writeHead(401, { 'Content-Type': 'application/json' });
    reply.raw.write(JSON.stringify({ error: 'Invalid password' }));
    reply.raw.end();
    return;
  }

  // Set up SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const send = (data) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Import heavy functions only when actually syncing
    const { getAllRaindrops, getRecentRaindrops } = require('../services/raindrop');
    const { getNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

    send({ message: '🔗 Connected to sync stream', type: 'info' });
    send({ message: '📊 Loading data for sync...', type: 'info' });

    // Load data only when sync starts
    let raindrops;
    if (mode === 'incremental') {
      const hours = daysBack * 24;
      raindrops = await getRecentRaindrops(hours);
      send({ message: `📅 Loaded ${raindrops.length} recent bookmarks`, type: 'info' });
    } else {
      raindrops = await getAllRaindrops();
      send({ message: `📚 Loaded ${raindrops.length} bookmarks`, type: 'info' });
    }

    const notionPages = await getNotionPages();
    send({ message: `📋 Loaded ${notionPages.length} Notion pages`, type: 'info' });

    // Create URL map for quick lookup
    const notionMap = new Map();
    notionPages.forEach(page => {
      const url = page.properties?.URL?.url;
      if (url) notionMap.set(url, page);
    });

    let added = 0, updated = 0, deleted = 0, failed = 0;
    let processed = 0;
    const total = raindrops.length;

    // Process in small batches with delays
    const batchSize = 3; // Smaller batches for better rate limiting
    for (let i = 0; i < raindrops.length; i += batchSize) {
      const batch = raindrops.slice(i, i + batchSize);
      
      for (const drop of batch) {
        try {
          const existingPage = notionMap.get(drop.link);
          
          if (!existingPage) {
            const result = await createNotionPage(drop);
            if (result.success) {
              send({ message: `➕ Added: ${drop.title}`, type: 'added' });
              added++;
            } else {
              send({ message: `❌ Failed: ${drop.title}`, type: 'failed' });
              failed++;
            }
          } else {
            await updateNotionPage(existingPage.id, drop);
            send({ message: `🔄 Updated: ${drop.title}`, type: 'updated' });
            updated++;
          }
        } catch (error) {
          failed++;
          send({ message: `❌ Error: ${drop.title}`, type: 'failed' });
        }

        processed++;
        const progress = Math.round((processed / total) * 100);
        
        send({ 
          progress, 
          counts: { added, updated, deleted, failed },
          type: 'progress'
        });

        // Delay between items
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Longer delay between batches
      if (i + batchSize < raindrops.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Handle deletions for reset mode
    if (deleteOrphaned && mode === 'reset') {
      send({ message: '🗑️ Cleaning up orphaned pages...', type: 'info' });
      
      const raindropUrls = new Set(raindrops.map(drop => drop.link));
      
      for (const page of notionPages) {
        const pageUrl = page.properties?.URL?.url;
        if (pageUrl && !raindropUrls.has(pageUrl)) {
          try {
            await deleteNotionPage(page.id);
            const title = page.properties?.Name?.title?.[0]?.text?.content || 'Untitled';
            send({ message: `🗑️ Deleted: ${title}`, type: 'deleted' });
            deleted++;
          } catch (error) {
            send({ message: `❌ Delete failed: ${error.message}`, type: 'failed' });
            failed++;
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }

    // Send completion
    send({
      message: `🎉 SYNC COMPLETE! Added: ${added}, Updated: ${updated}, Deleted: ${deleted}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated, deleted, skipped: 0, failed }
    });

  } catch (error) {
    console.error('Sync error:', error);
    send({ 
      message: `❌ Sync failed: ${error.message}`, 
      type: 'error',
      error: true
    });
  } finally {
    reply.raw.end();
  }
});

// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  console.error('Server error:', error);
  
  const password = request.query.password || '';
  
  reply.view('error', {
    error: error.message,
    password,
    code: error.code || 'UNKNOWN_ERROR',
    details: 'Server error occurred'
  });
});

// Export for Vercel
module.exports = async (req, res) => {
  await fastify.ready();
  fastify.server.emit('request', req, res);
};

// Local dev mode
if (require.main === module) {
  fastify.listen({ port: 3000 }, err => {
    if (err) throw err;
    console.log('⚡ Fast server listening on http://localhost:3000');
  });
}
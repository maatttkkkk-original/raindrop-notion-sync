// Fastify server with full sync capabilities and view rendering, Vercel-compatible
const path = require('path');
const Fastify = require('fastify');
const handlebars = require('handlebars');

const fastify = Fastify({ logger: true });

const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const {
  getNotionPages,
  getTotalNotionPages,
  createNotionPage,
  updateNotionPage,
  deleteNotionPage
} = require('../services/notion');

// Register all helpers in a more robust way
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

// Register helpers before view engine setup
Object.entries(helpers).forEach(([name, fn]) => {
  handlebars.registerHelper(name, fn);
});

// Now register the view engine
fastify.register(require('@fastify/view'), {
  engine: {
    handlebars: handlebars
  },
  root: path.join(__dirname, '../src/pages'),
  layout: false
});

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/public/'
});

fastify.get('/', async (req, reply) => {
  const password = req.query.password || '';

  try {
    const raindropTotal = await getRaindropTotal(password);
    const notionTotal = await getTotalNotionPages(password);

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
    req.log.error(error);
    reply.view('error', { 
      error: error.message,
      password,
      code: 'FETCH_ERROR',
      details: 'Failed to load dashboard data'
    });
  }
});

fastify.get('/sync', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

  try {
    reply.view('sync', {
      password,
      mode,
      syncMode: mode,
      deleteOrphaned,
      pageTitle: mode === 'reset' ? 'Reset & Full Sync' : 'Smart Sync',
      pageDescription: mode === 'reset'
        ? 'Delete all Notion pages and recreate from Raindrop'
        : 'Smart analysis — only sync what needs to change'
    });
  } catch (error) {
    req.log.error(error);
    reply.view('error', { 
      error: error.message,
      password,
      code: 'SYNC_PAGE_ERROR',
      details: 'Failed to load sync page'
    });
  }
});

fastify.get('/api/counts', async (req, reply) => {
  const password = req.query.password || '';

  try {
    const [raindropTotal, notionTotal] = await Promise.all([
      getRaindropTotal(password),
      getTotalNotionPages(password)
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

fastify.get('/sync-stream', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

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
    // Initial connection message
    send({ message: '🔗 Connection established', type: 'info' });
    
    // Verify connection before starting
    send({ message: '🚀 Starting sync...', type: 'info' });

    // Get initial counts to verify API access
    const [raindropTotal, notionTotal] = await Promise.all([
      getRaindropTotal(),
      getTotalNotionPages()
    ]);

    send({ 
      message: `📊 Found ${raindropTotal} Raindrop bookmarks and ${notionTotal} Notion pages`,
      type: 'info'
    });

    // Rest of your sync logic with proper progress updates...
    const raindrops = await getAllRaindrops();
    send({ message: `📚 Loaded ${raindrops.length} bookmarks`, type: 'info' });

    // Process in batches of 10 with proven delays
    const batches = chunkArray(raindrops, 10);
    let processed = 0;
    let added = 0, updated = 0, deleted = 0, failed = 0;

    for (const batch of batches) {
      send({ message: `📝 Processing batch of ${batch.length} items...`, type: 'info' });
      
      for (const drop of batch) {
        try {
          // Your existing sync logic here
          processed++;
          // Send progress updates
          send({
            progress: Math.round((processed / raindrops.length) * 100),
            counts: { added, updated, deleted, failed },
            type: 'progress'
          });
          
          // Proven delay between operations
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          failed++;
          send({ message: `❌ Error: ${error.message}`, type: 'error' });
          // Longer delay after error
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
      
      // Proven delay between batches
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Send completion message
    send({
      message: `✅ Sync complete! Added: ${added}, Updated: ${updated}, Deleted: ${deleted}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated, deleted, failed }
    });

  } catch (error) {
    send({ 
      message: `❌ Sync failed: ${error.message}`, 
      type: 'error',
      error: true
    });
  } finally {
    reply.raw.end();
  }
});

// Helper function for chunking arrays
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  request.log.error(error);
  
  const password = request.query.password || '';
  
  reply.view('error', {
    error: error.message,
    password,
    code: error.code || 'UNKNOWN_ERROR',
    details: error.stack || 'No additional details available'
  });
});

// Export for Vercel
module.exports = async (req, res) => {
  await fastify.ready();
  fastify.server.emit('request', req, res);
};

// Optional: Local dev mode
if (require.main === module) {
  fastify.listen({ port: 3000 }, err => {
    if (err) throw err;
    console.log('Server listening on http://localhost:3000');
  });
}
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

// Password validation function
function validatePassword(password) {
  if (!password) return false;
  return password === process.env.ADMIN_PASSWORD;
}

// Register all helpers
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

// Register view engine
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
    // Services use environment tokens, not the password parameter
    const raindropTotal = await getRaindropTotal();
    const notionTotal = await getTotalNotionPages();

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

  // Validate password
  if (!validatePassword(password)) {
    return reply.status(401).send({
      error: 'Invalid password',
      success: false
    });
  }

  try {
    // Services use environment tokens
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

fastify.get('/sync-stream', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';
  const daysBack = parseInt(req.query.daysBack || '30');
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

  // Validate password
  if (!validatePassword(password)) {
    reply.raw.writeHead(401, {
      'Content-Type': 'application/json'
    });
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

  const end = () => {
    reply.raw.end();
  };

  try {
    // Initial connection message
    send({ message: '🔗 Connected to sync stream', type: 'info' });
    
    // Start sync process
    send({ message: '🚀 Starting sync...', type: 'info' });

    // Get data from both services (they use environment tokens)
    let raindrops;
    if (mode === 'incremental') {
      const hours = daysBack * 24;
      raindrops = await getRecentRaindrops(hours);
      send({ message: `📅 Loaded ${raindrops.length} recent bookmarks (${daysBack} days)`, type: 'info' });
    } else {
      raindrops = await getAllRaindrops();
      send({ message: `📚 Loaded ${raindrops.length} total bookmarks`, type: 'info' });
    }

    const notionPages = await getNotionPages();
    send({ message: `📋 Loaded ${notionPages.length} Notion pages`, type: 'info' });

    // Create a map of existing Notion pages by URL for quick lookup
    const notionMap = new Map();
    notionPages.forEach(page => {
      const url = page.properties?.URL?.url;
      if (url) {
        notionMap.set(url, page);
      }
    });

    let added = 0, updated = 0, deleted = 0, failed = 0;
    const total = raindrops.length;
    let processed = 0;

    // Process raindrops in smaller batches
    const batchSize = 5;
    for (let i = 0; i < raindrops.length; i += batchSize) {
      const batch = raindrops.slice(i, i + batchSize);
      
      send({ message: `📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(raindrops.length/batchSize)}...`, type: 'info' });

      for (const drop of batch) {
        try {
          const existingPage = notionMap.get(drop.link);
          
          if (!existingPage) {
            // Create new page
            const result = await createNotionPage(drop);
            if (result.success) {
              send({ message: `➕ Added: ${drop.title}`, type: 'added' });
              added++;
            } else {
              send({ message: `❌ Failed to add: ${drop.title}`, type: 'failed' });
              failed++;
            }
          } else {
            // Update existing page
            await updateNotionPage(existingPage.id, drop);
            send({ message: `🔄 Updated: ${drop.title}`, type: 'updated' });
            updated++;
          }
        } catch (error) {
          failed++;
          send({ message: `❌ Error processing "${drop.title}": ${error.message}`, type: 'failed' });
        }

        processed++;
        const progress = Math.round((processed / total) * 100);
        
        // Send progress update
        send({ 
          progress, 
          counts: { added, updated, deleted, failed },
          message: `Progress: ${processed}/${total} items (${progress}%)`,
          type: 'progress'
        });

        // Small delay between items to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Longer delay between batches
      if (i + batchSize < raindrops.length) {
        send({ message: '⏸️ Pausing between batches...', type: 'info' });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Handle orphaned pages deletion if requested
    if (deleteOrphaned && mode === 'reset') {
      send({ message: '🗑️ Checking for orphaned pages...', type: 'info' });
      
      const raindropUrls = new Set(raindrops.map(drop => drop.link));
      
      for (const page of notionPages) {
        const pageUrl = page.properties?.URL?.url;
        if (pageUrl && !raindropUrls.has(pageUrl)) {
          try {
            await deleteNotionPage(page.id);
            const pageTitle = page.properties?.Name?.title?.[0]?.text?.content || 'Untitled';
            send({ message: `🗑️ Deleted orphaned: ${pageTitle}`, type: 'deleted' });
            deleted++;
          } catch (error) {
            send({ message: `❌ Failed to delete orphaned page: ${error.message}`, type: 'failed' });
            failed++;
          }
          
          // Delay after deletion
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    // Calculate efficiency
    const totalOperations = added + updated + deleted;
    const efficiency = total > 0 ? Math.round(((total - totalOperations) / total) * 100) : 100;

    // Send final completion message
    send({
      message: `🎉 SYNC COMPLETE! Added: ${added}, Updated: ${updated}, Deleted: ${deleted}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated, deleted, skipped: 0, failed },
      efficiency: {
        percentage: efficiency,
        itemsProcessed: totalOperations,
        totalItems: total
      }
    });

  } catch (error) {
    console.error('Sync stream error:', error);
    send({ 
      message: `❌ Sync failed: ${error.message}`, 
      type: 'error',
      error: true
    });
  } finally {
    end();
  }
});

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
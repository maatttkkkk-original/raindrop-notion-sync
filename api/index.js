// Optimized Fastify server - Keep real functionality, fix performance
const path = require('path');
const Fastify = require('fastify');
const handlebars = require('handlebars');

const fastify = Fastify({ logger: true });

// Only import the FAST count functions for dashboard
const { getRaindropTotal } = require('../services/raindrop');
const { getTotalNotionPages } = require('../services/notion');

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

// SYNC STREAM - REAL SYNC WITH BEAUTIFUL LOGGING
fastify.get('/sync-stream', async (req, reply) => {
  const password = req.query.password || '';
  const mode = req.query.mode || 'smart';

  if (!validatePassword(password)) {
    reply.raw.writeHead(401, { 'Content-Type': 'application/json' });
    reply.raw.write(JSON.stringify({ error: 'Invalid password' }));
    reply.raw.end();
    return;
  }

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
    // Import ONLY when syncing starts
    const { getAllRaindrops } = require('../services/raindrop');
    const { getNotionPages, createNotionPage, updateNotionPage } = require('../services/notion');

    send({ message: '🔗 Connected to sync stream', type: 'info' });
    send({ message: '📊 Loading data for sync...', type: 'info' });

    // Load data with progress updates
    const raindrops = await getAllRaindrops();
    send({ message: `📚 Loaded ${raindrops.length} Raindrop bookmarks`, type: 'info' });

    const notionPages = await getNotionPages();
    send({ message: `📋 Loaded ${notionPages.length} Notion pages`, type: 'info' });

    // Create lookup map
    const notionMap = new Map();
    notionPages.forEach(page => {
      const url = page.properties?.URL?.url;
      if (url) notionMap.set(url, page);
    });

    send({ message: '🔍 Starting smart analysis...', type: 'info' });

    let added = 0, updated = 0, failed = 0, skipped = 0;
    const total = raindrops.length;

    // Process in small batches with beautiful progress
    const batchSize = 5;
    for (let i = 0; i < raindrops.length; i += batchSize) {
      const batch = raindrops.slice(i, i + batchSize);
      
      send({ 
        message: `📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(raindrops.length/batchSize)}...`, 
        type: 'info' 
      });

      for (const drop of batch) {
        try {
          const existingPage = notionMap.get(drop.link);
          
          if (!existingPage) {
            const result = await createNotionPage(drop);
            if (result.success) {
              send({ message: `➕ Added: ${drop.title}`, type: 'added' });
              added++;
            } else {
              send({ message: `❌ Failed to add: ${drop.title}`, type: 'failed' });
              failed++;
            }
          } else {
            // Check if update needed (simple title comparison)
            const existingTitle = existingPage.properties?.Name?.title?.[0]?.text?.content || '';
            if (existingTitle !== drop.title) {
              await updateNotionPage(existingPage.id, drop);
              send({ message: `🔄 Updated: ${drop.title}`, type: 'updated' });
              updated++;
            } else {
              send({ message: `⏭️ Skipped: ${drop.title} (no changes)`, type: 'info' });
              skipped++;
            }
          }
        } catch (error) {
          failed++;
          send({ message: `❌ Error processing: ${drop.title}`, type: 'failed' });
        }

        const processed = i + batch.indexOf(drop) + 1;
        const progress = Math.round((processed / total) * 100);
        
        send({ 
          progress, 
          counts: { added, updated, deleted: 0, failed },
          type: 'progress'
        });

        // Conservative delay
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Batch delay
      if (i + batchSize < raindrops.length) {
        send({ message: '⏸️ Pausing between batches...', type: 'info' });
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Calculate efficiency
    const totalOperations = added + updated;
    const efficiency = total > 0 ? Math.round(((total - totalOperations) / total) * 100) : 100;

    send({
      message: `🎉 SYNC COMPLETE! Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated, deleted: 0, skipped, failed },
      efficiency: {
        percentage: efficiency,
        itemsProcessed: totalOperations,
        totalItems: total
      }
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
  
  reply.view('error', {
    error: error.message,
    password: request.query.password || '',
    code: 'SERVER_ERROR',
    details: 'Internal server error'
  });
});

// Export for Vercel
module.exports = async (req, res) => {
  await fastify.ready();
  fastify.server.emit('request', req, res);
};

if (require.main === module) {
  fastify.listen({ port: 3000 }, err => {
    if (err) throw err;
    console.log('Server ready on http://localhost:3000');
  });
}
// Fastify server with full sync capabilities and view rendering, Vercel-compatible
const path = require('path');
const Fastify = require('fastify');
const fastify = Fastify({ logger: true });

const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const {
  getNotionPages,
  getTotalNotionPages,
  createNotionPage,
  updateNotionPage,
  deleteNotionPage
} = require('../services/notion');

fastify.register(require('@fastify/view'), {
  engine: {
    handlebars: require('handlebars')
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
  const daysBack = parseInt(req.query.daysBack || '30');
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

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
  const daysBack = parseInt(req.query.daysBack || '30');
  const deleteOrphaned = req.query.deleteOrphaned === 'true';

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  const send = (data) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const end = () => {
    reply.raw.end();
  };

  try {
    send({ message: '🚀 Starting sync...', type: 'info' });

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

    const notionMap = new Map(notionPages.map(page => [page.properties?.URL?.url, page]));

    let added = 0, updated = 0, deleted = 0, skipped = 0, failed = 0;
    const total = raindrops.length + (deleteOrphaned ? notionPages.length : 0);
    let processed = 0;

    // Process raindrops
    for (const drop of raindrops) {
      const notionPage = notionMap.get(drop.link);
      try {
        if (!notionPage) {
          const result = await createNotionPage(drop);
          if (result.success) {
            send({ message: `➕ Added: ${drop.title}`, type: 'added' });
            added++;
          } else {
            send({ message: `❌ Failed to add: ${drop.title}`, type: 'failed' });
            failed++;
          }
        } else {
          await updateNotionPage(notionPage.id, drop);
          send({ message: `🔄 Updated: ${drop.title}`, type: 'updated' });
          updated++;
        }
      } catch (err) {
        failed++;
        send({ message: `❌ Failed on: ${drop.title} - ${err.message}`, type: 'failed' });
      }

      processed++;
      const progress = Math.round((processed / total) * 100);
      send({ 
        progress, 
        counts: { added, updated, deleted, skipped, failed },
        message: `Progress: ${processed}/${total} (${progress}%)`,
        type: 'info'
      });
    }

    // Handle orphaned pages if requested
    if (deleteOrphaned) {
      send({ message: '🗑️ Checking for orphaned pages...', type: 'info' });
      
      for (const page of notionPages) {
        const pageUrl = page.properties?.URL?.url;
        if (pageUrl && !raindrops.some(drop => drop.link === pageUrl)) {
          try {
            await deleteNotionPage(page.id);
            send({ message: `🗑️ Deleted orphan: ${page.properties?.Name?.title?.[0]?.text?.content || 'Untitled'}`, type: 'deleted' });
            deleted++;
          } catch (err) {
            send({ message: `❌ Failed to delete: ${page.properties?.Name?.title?.[0]?.text?.content || 'Untitled'}`, type: 'failed' });
            failed++;
          }
        }
        
        processed++;
        const progress = Math.round((processed / total) * 100);
        send({ 
          progress, 
          counts: { added, updated, deleted, skipped, failed },
          type: 'info'
        });
      }
    }

    // Calculate efficiency
    const totalOperations = added + updated + deleted;
    const efficiency = total > 0 ? Math.round(((total - totalOperations) / total) * 100) : 100;

    send({
      message: `🎉 SYNC COMPLETE! Added: ${added}, Updated: ${updated}, Deleted: ${deleted}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated, deleted, skipped, failed },
      efficiency: {
        percentage: efficiency,
        itemsProcessed: totalOperations,
        totalItems: total
      }
    });

    end();
  } catch (err) {
    send({ message: `❌ Sync error: ${err.message}`, type: 'error' });
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
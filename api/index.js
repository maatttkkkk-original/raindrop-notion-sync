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

    reply.view('index', {
      password,
      raindropTotal,
      notionTotal,
      diff: Math.abs(raindropTotal - notionTotal)
    });
  } catch (error) {
    req.log.error(error);
    reply.view('error', { error: error.message });
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
      syncMode: mode,
      daysBack,
      deleteOrphaned,
      pageTitle: mode === 'reset' ? 'Reset & Full Sync' : mode === 'incremental' ? 'Incremental Sync' : 'Smart Sync',
      pageDescription:
        mode === 'reset'
          ? 'Delete all Notion pages and recreate from Raindrop'
          : mode === 'incremental'
          ? 'Sync only recent bookmarks'
          : 'Smart analysis — only sync what needs to change'
    });
  } catch (error) {
    req.log.error(error);
    reply.view('error', { error: error.message });
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
    Connection: 'keep-alive'
  });

  const send = (data) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const end = () => {
    reply.raw.end();
  };

  try {
    send({ message: '🚀 Starting sync...', type: 'info' });

    const raindrops = mode === 'incremental'
      ? await getRecentRaindrops(password, daysBack)
      : await getAllRaindrops(password);
    const notionPages = await getNotionPages(password);

    const notionMap = new Map(notionPages.map(page => [page.url, page]));

    let added = 0, updated = 0, deleted = 0, skipped = 0, failed = 0;

    for (const drop of raindrops) {
      const notionPage = notionMap.get(drop.url);
      try {
        if (!notionPage) {
          await createNotionPage(drop, password);
          send({ message: `➕ Added: ${drop.title}`, type: 'added' });
          added++;
        } else {
          await updateNotionPage(drop, notionPage, password);
          send({ message: `🔄 Updated: ${drop.title}`, type: 'updated' });
          updated++;
        }
      } catch (err) {
        failed++;
        send({ message: `❌ Failed on: ${drop.title}`, type: 'failed' });
      }
    }

    if (deleteOrphaned) {
      for (const page of notionPages) {
        if (!raindrops.some(drop => drop.url === page.url)) {
          await deleteNotionPage(page, password);
          send({ message: `🗑️ Deleted orphan: ${page.title}`, type: 'deleted' });
          deleted++;
        }
      }
    }

    send({
      message: `🎉 SYNC COMPLETE! Added: ${added}, Updated: ${updated}, Deleted: ${deleted}, Skipped: ${skipped}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated, deleted, skipped, failed }
    });

    end();
  } catch (err) {
    send({ message: `❌ Sync error: ${err.message}`, type: 'error' });
    end();
  }
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
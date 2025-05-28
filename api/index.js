// Bulletproof Fastify server - Sync page WILL load
const path = require('path');
const Fastify = require('fastify');
const handlebars = require('handlebars');

const fastify = Fastify({ logger: true });

// Import only fast functions
const { getRaindropTotal } = require('../services/raindrop');
const { getTotalNotionPages } = require('../services/notion');

// Password validation
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

// DASHBOARD - FAST LOADING
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
    console.log('⏱️ Loading dashboard...');
    const startTime = Date.now();
    
    const [raindropTotal, notionTotal] = await Promise.all([
      getRaindropTotal(),
      getTotalNotionPages()
    ]);
    
    console.log(`✅ Dashboard loaded in ${Date.now() - startTime}ms`);

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
      details: 'Failed to load dashboard'
    });
  }
});

// SYNC PAGE - BULLETPROOF VERSION
fastify.get('/sync', async (req, reply) => {
  const password = req.query.password || '';
  
  console.log('🔄 Sync page request received');

  // Validate password
  if (!validatePassword(password)) {
    console.log('❌ Invalid password for sync page');
    return reply.view('error', {
      error: 'Invalid password',
      password: '',
      code: 'AUTH_ERROR',
      details: 'Please provide a valid password'
    });
  }

  console.log('✅ Password valid, rendering sync page...');

  try {
    // Simple template data - no complex processing
    reply.view('sync', {
      password: password,
      mode: req.query.mode || 'smart'
    });
    
    console.log('✅ Sync page sent successfully');

  } catch (error) {
    console.error('❌ Sync template error:', error);
    
    // FALLBACK: Send raw HTML if template fails
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Smart Sync</title>
        <link rel="stylesheet" href="/public/styles/design-system.css?v=2024-05-28-001">
        <link rel="stylesheet" href="/public/styles/components.css?v=2024-05-28-001">
        <link rel="stylesheet" href="/public/styles/dashboard.css?v=2024-05-28-001">
      </head>
      <body>
        <main class="dashboard-8-section" id="main-content" role="main">
          <!-- Section 1: Title -->
          <div class="dashboard-section section-1 bg-white">
            <div class="section-content">
              <h1 class="text-huge">Smart Sync</h1>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 2: Sync Button -->
          <div class="dashboard-section section-2 bg-yellow" id="action-section">
            <div class="section-content">
              <button id="syncBtn" class="section-action-button text-huge text-black" type="button">
                Start Smart Sync
              </button>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 3: Description -->
          <div class="dashboard-section section-3 bg-white">
            <div class="section-content">
              <div class="text-large">Smart analysis - only sync what needs to change</div>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 4: Progress -->
          <div class="dashboard-section section-4 bg-white">
            <div class="section-content">
              <div class="text-medium" id="progress-text">Ready to sync...</div>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 5: Stats -->
          <div class="dashboard-section section-5 bg-white">
            <div class="section-content">
              <div class="sync-stats" id="sync-stats" style="display: none;">
                <div class="stat-group">
                  <div class="stat-item">
                    <span class="stat-number text-large" id="added-count">0</span>
                    <span class="stat-label text-small">Added</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-number text-large" id="updated-count">0</span>
                    <span class="stat-label text-small">Updated</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-number text-large" id="deleted-count">0</span>
                    <span class="stat-label text-small">Deleted</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-number text-large" id="failed-count">0</span>
                    <span class="stat-label text-small">Failed</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 6: Efficiency -->
          <div class="dashboard-section section-6 bg-white">
            <div class="section-content">
              <div class="efficiency-display" id="efficiency-display" style="display: none;">
                <div class="text-large">
                  <span id="efficiency-percentage">--</span>% Efficiency
                </div>
                <div class="text-small" id="efficiency-status">Calculating...</div>
              </div>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 7: Log Area -->
          <div class="dashboard-section section-7 bg-white log-section">
            <div class="section-content">
              <div 
                id="status" 
                class="status-display" 
                role="log" 
                aria-live="polite"
                style="display: none; height: 100%; overflow-y: auto;"
              ></div>
            </div>
          </div>
          
          <div class="dashboard-divider"></div>
          
          <!-- Section 8: Back Button -->
          <div class="dashboard-section section-8 bg-light-gray back-section">
            <div class="section-content">
              <a href="/?password=${password}" class="back-button text-large">Back ↺</a>
            </div>
          </div>
        </main>

        <script src="/public/scripts/utils.js"></script>
        <script src="/public/scripts/sync.js"></script>
      </body>
      </html>
    `);
  }
});

// API COUNTS
fastify.get('/api/counts', async (req, reply) => {
  const password = req.query.password || '';

  if (!validatePassword(password)) {
    return reply.status(401).send({ error: 'Invalid password', success: false });
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
    reply.status(500).send({ error: error.message, success: false });
  }
});

// SYNC STREAM - Only loads when sync starts
fastify.get('/sync-stream', async (req, reply) => {
  const password = req.query.password || '';

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
    // Import heavy functions only when syncing
    const { getAllRaindrops, getRecentRaindrops } = require('../services/raindrop');
    const { getNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

    send({ message: '🔗 Connected to sync stream', type: 'info' });
    send({ message: '📊 Loading data...', type: 'info' });

    // Load data
    const raindrops = await getAllRaindrops();
    send({ message: `📚 Loaded ${raindrops.length} bookmarks`, type: 'info' });

    const notionPages = await getNotionPages();
    send({ message: `📋 Loaded ${notionPages.length} pages`, type: 'info' });

    // Quick sync simulation for now
    let added = 0, updated = 0, failed = 0;
    const total = Math.min(raindrops.length, 10); // Limit to 10 for testing

    for (let i = 0; i < total; i++) {
      const drop = raindrops[i];
      
      try {
        send({ message: `Processing: ${drop.title}`, type: 'info' });
        
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 500));
        
        added++;
        send({ 
          message: `✅ Processed: ${drop.title}`, 
          type: 'added',
          progress: Math.round(((i + 1) / total) * 100),
          counts: { added, updated, failed }
        });
        
      } catch (error) {
        failed++;
        send({ message: `❌ Failed: ${drop.title}`, type: 'failed' });
      }
    }

    send({
      message: `🎉 Test complete! Processed: ${total}, Added: ${added}, Failed: ${failed}`,
      type: 'complete',
      complete: true,
      finalCounts: { added, updated: 0, deleted: 0, failed }
    });

  } catch (error) {
    console.error('Sync error:', error);
    send({ message: `❌ Error: ${error.message}`, type: 'error' });
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
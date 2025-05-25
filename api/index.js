const fastify = require('fastify')({ logger: true });

// Password check
const requirePassword = async (request, reply) => {
  const password = request.query.password;
  if (!password || password !== process.env.APP_PASSWORD) {
    reply.code(401).send('Unauthorized');
  }
};

// Basic HTML responses
fastify.get('/', { preHandler: requirePassword }, async (request, reply) => {
  return reply.type('text/html').send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Raindrop/Notion Sync</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        h1 { font-size: 72px; margin-bottom: 40px; }
        a { font-size: 48px; display: block; margin: 20px 0; color: #000; text-decoration: none; }
        a:hover { opacity: 0.7; }
      </style>
    </head>
    <body>
      <h1>Raindrop/Notion Sync</h1>
      <p>Loading counts...</p>
      <div id="counts">Checking sync status...</div>
      <br>
      <a href="/sync?password=${request.query.password}&mode=new">Sync New ↻</a>
      <a href="/sync-all?password=${request.query.password}">Reset / FullSync</a>
      
      <script>
        fetch('/api/counts?password=${request.query.password}')
          .then(r => r.json())
          .then(data => {
            document.getElementById('counts').innerHTML = 
              data.raindropTotal + ' Raindrop Bookmarks<br>' +
              data.notionTotal + ' Notion Pages<br>' +
              (data.isSynced ? '✅ Synced' : '❌ Not Synced');
          })
          .catch(e => {
            document.getElementById('counts').innerHTML = 'Error loading counts';
          });
      </script>
    </body>
    </html>
  `);
});

fastify.get('/sync', { preHandler: requirePassword }, async (request, reply) => {
  return reply.type('text/html').send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sync</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        h1 { font-size: 72px; margin-bottom: 40px; }
        button { font-size: 48px; background: none; border: none; cursor: pointer; }
        #status { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
      </style>
    </head>
    <body>
      <a href="/?password=${request.query.password}">← Back</a>
      <h1>Sync ${request.query.mode === 'all' ? 'All' : 'New'}</h1>
      <button onclick="startSync()">Start Sync</button>
      <div id="status"></div>
      
      <script>
        function startSync() {
          document.getElementById('status').innerHTML = 'Starting sync...';
          const mode = '${request.query.mode || 'new'}';
          const password = '${request.query.password}';
          
          const evtSource = new EventSource('/sync-stream?password=' + password + '&mode=' + mode);
          
          evtSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            document.getElementById('status').innerHTML += '<div>' + data.message + '</div>';
            
            if (data.isComplete) {
              evtSource.close();
            }
          };
          
          evtSource.onerror = function() {
            document.getElementById('status').innerHTML += '<div>❌ Connection error</div>';
            evtSource.close();
          };
        }
      </script>
    </body>
    </html>
  `);
});

fastify.get('/sync-all', { preHandler: requirePassword }, async (request, reply) => {
  return reply.redirect(`/sync?password=${request.query.password}&mode=all`);
});

// API counts
fastify.get('/api/counts', { preHandler: requirePassword }, async (request, reply) => {
  try {
    // Try to load services
    const { getRaindrops } = require('./services/raindrop');
    const { getNotionPages } = require('./services/notion');
    
    const [raindrops, notionPages] = await Promise.all([
      getRaindrops(),
      getNotionPages()
    ]);

    reply.send({
      raindropTotal: raindrops.length,
      notionTotal: notionPages.length,
      isSynced: Math.abs(raindrops.length - notionPages.length) <= 5,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Counts error:', error);
    reply.send({
      raindropTotal: 0,
      notionTotal: 0,
      isSynced: false,
      error: error.message,
      lastUpdated: new Date().toISOString()
    });
  }
});

// Sync stream
fastify.get('/sync-stream', { preHandler: requirePassword }, async (request, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');

  try {
    const { getRaindrops } = require('./services/raindrop');
    const { getNotionPages } = require('./services/notion');
    
    reply.raw.write(`data: ${JSON.stringify({message: '🔒 Starting sync...', type: 'info'})}\n\n`);
    
    const raindrops = await getRaindrops();
    reply.raw.write(`data: ${JSON.stringify({message: `✅ Found ${raindrops.length} raindrops`, type: 'success'})}\n\n`);
    
    const notionPages = await getNotionPages();
    reply.raw.write(`data: ${JSON.stringify({message: `✅ Found ${notionPages.length} notion pages`, type: 'success'})}\n\n`);
    
    reply.raw.write(`data: ${JSON.stringify({message: '✅ Sync completed!', type: 'success', isComplete: true})}\n\n`);
    
  } catch (error) {
    reply.raw.write(`data: ${JSON.stringify({message: `❌ Error: ${error.message}`, type: 'error', isComplete: true})}\n\n`);
  }
  
  reply.raw.end();
});

// Health check
fastify.get('/health', async (request, reply) => {
  reply.send({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  console.error('Error:', error);
  reply.code(500).send({ error: error.message });
});

module.exports = fastify;
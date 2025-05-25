// Vercel native function - no Fastify dependencies

// Try to load services with better error handling
let getRaindrops, getNotionPages, createNotionPage, updateNotionPage, deleteNotionPage;

try {
  const raindropService = require('./services/raindrop');
  const notionService = require('./services/notion');
  
  // Use the correct function names from your service files
  getRaindrops = raindropService.getAllRaindrops;
  getNotionPages = notionService.getNotionPages;
  createNotionPage = notionService.createNotionPage;
  updateNotionPage = notionService.updateNotionPage;
  deleteNotionPage = notionService.deleteNotionPage;
  
  console.log('✅ Services loaded');
} catch (error) {
  console.error('❌ Service error:', error.message);
  getRaindrops = async () => { throw new Error('Raindrop service not loaded'); };
  getNotionPages = async () => { throw new Error('Notion service not loaded'); };
  createNotionPage = async () => { throw new Error('Notion service not loaded'); };
  updateNotionPage = async () => { throw new Error('Notion service not loaded'); };
  deleteNotionPage = async () => { throw new Error('Notion service not loaded'); };
}

// Password check function
function checkPassword(password) {
  return password && password === process.env.ADMIN_PASSWORD;
}

// Helper to send SSE data
function writeSSE(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (error) {
    console.error('SSE write error:', error);
  }
}

// Smart Diff sync function
async function performSmartDiffSync(mode, res) {
  try {
    writeSSE(res, { message: `🔒 Starting Smart Diff sync (${mode})`, type: 'info' });
    
    // Fetch data
    writeSSE(res, { message: '📡 Fetching raindrops...', type: 'info' });
    const raindrops = await getRaindrops();
    writeSSE(res, { message: `✅ Found ${raindrops.length} raindrops`, type: 'success' });
    
    writeSSE(res, { message: '📄 Fetching Notion pages...', type: 'info' });
    const notionPages = await getNotionPages();
    writeSSE(res, { message: `✅ Found ${notionPages.length} notion pages`, type: 'success' });
    
    // Build lookup maps
    const notionLookupByUrl = new Map();
    const notionLookupByTitle = new Map();
    
    notionPages.forEach(page => {
      const url = page.properties?.URL?.url;
      const title = page.properties?.Name?.title?.[0]?.text?.content;
      if (url) notionLookupByUrl.set(url, page);
      if (title) notionLookupByTitle.set(title, page);
    });
    
    writeSSE(res, { message: '🗺️ Lookup maps created', type: 'success' });
    
    // Smart Diff analysis
    const toAdd = [];
    const toUpdate = [];
    const toSkip = [];
    
    for (const raindrop of raindrops) {
      // Filter based on mode
      if (mode === 'new') {
        const createdDate = new Date(raindrop.created);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (createdDate < thirtyDaysAgo) {
          toSkip.push(raindrop);
          continue;
        }
      }

      const existingPage = notionLookupByUrl.get(raindrop.link) || notionLookupByTitle.get(raindrop.title);

      if (!existingPage) {
        toAdd.push(raindrop);
      } else {
        const notionTitle = existingPage.properties?.Name?.title?.[0]?.text?.content || '';
        const notionUrl = existingPage.properties?.URL?.url || '';
        
        if (notionTitle !== raindrop.title || notionUrl !== raindrop.link) {
          toUpdate.push({ raindrop, existingPage });
        } else {
          toSkip.push(raindrop);
        }
      }
    }
    
    const totalOperations = toAdd.length + toUpdate.length;
    const efficiency = totalOperations > 0 ? Math.round(((raindrops.length - totalOperations) / raindrops.length) * 100) : 100;
    
    writeSSE(res, { 
      message: `🔍 Smart Diff complete: ${toAdd.length} to add, ${toUpdate.length} to update, ${toSkip.length} to skip`, 
      type: 'success'
    });
    
    writeSSE(res, { 
      message: `🚀 ${efficiency}% efficiency - processing only ${totalOperations} of ${raindrops.length} items`, 
      type: 'info'
    });
    
    // Process additions
    for (const raindrop of toAdd) {
      try {
        await createNotionPage({
          name: raindrop.title,
          url: raindrop.link,
          tags: raindrop.tags || [],
          created: raindrop.created,
          excerpt: raindrop.excerpt || ''
        });
        writeSSE(res, { message: `➕ Added: "${raindrop.title}"`, type: 'success' });
      } catch (error) {
        writeSSE(res, { message: `❌ Failed to add: "${raindrop.title}"`, type: 'error' });
      }
    }
    
    // Process updates
    for (const { raindrop, existingPage } of toUpdate) {
      try {
        await updateNotionPage(existingPage.id, {
          name: raindrop.title,
          url: raindrop.link,
          tags: raindrop.tags || [],
          excerpt: raindrop.excerpt || ''
        });
        writeSSE(res, { message: `🔄 Updated: "${raindrop.title}"`, type: 'success' });
      } catch (error) {
        writeSSE(res, { message: `❌ Failed to update: "${raindrop.title}"`, type: 'error' });
      }
    }
    
    writeSSE(res, { 
      message: `✅ Smart Diff sync completed! ${efficiency}% efficiency achieved`, 
      type: 'success',
      isComplete: true
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    writeSSE(res, { message: `❌ Sync failed: ${error.message}`, type: 'error', isComplete: true });
  }
}

// Main export function
module.exports = async (req, res) => {
  console.log('Request:', req.method, req.url);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const password = url.searchParams.get('password');
  const mode = url.searchParams.get('mode') || 'all';
  
  // Password check
  if (!checkPassword(password)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  
  const pathname = url.pathname;
  console.log('Route:', pathname);
  
  // Routes
  if (pathname === '/health') {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
    return;
  }
  
  if (pathname === '/api/counts') {
    try {
      const [raindrops, notionPages] = await Promise.all([
        getRaindrops(),
        getNotionPages()
      ]);
      
      res.json({
        raindropTotal: raindrops.length,
        notionTotal: notionPages.length,
        isSynced: Math.abs(raindrops.length - notionPages.length) <= 5,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
    return;
  }
  
  if (pathname === '/test-raindrop') {
    try {
      console.log('Testing Raindrop service...');
      const raindrops = await getRaindrops();
      res.json({
        success: true,
        count: raindrops.length,
        sample: raindrops.slice(0, 3).map(r => ({ title: r.title, link: r.link })),
        hasApiKey: !!process.env.RAINDROP_TOKEN,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Raindrop test failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
        hasApiKey: !!process.env.RAINDROP_TOKEN
      });
    }
    return;
  }
  
  if (pathname === '/test-notion') {
    try {
      console.log('Testing Notion service...');
      const notionPages = await getNotionPages();
      res.json({
        success: true,
        count: notionPages.length,
        sample: notionPages.slice(0, 3).map(p => ({ 
          title: p.properties?.Name?.title?.[0]?.text?.content,
          url: p.properties?.URL?.url 
        })),
        hasApiKey: !!process.env.NOTION_TOKEN,
        hasDatabaseId: !!process.env.NOTION_DATABASE_ID,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Notion test failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
        hasApiKey: !!process.env.NOTION_TOKEN,
        hasDatabaseId: !!process.env.NOTION_DATABASE_ID
      });
    }
    return;
  }
  
  if (pathname === '/debug-env') {
    res.json({
      hasAdminPassword: !!process.env.ADMIN_PASSWORD,
      hasRaindropToken: !!process.env.RAINDROP_TOKEN,
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasNotionDatabase: !!process.env.NOTION_DB_ID,
      // Check alternative names too
      hasNotionDatabaseId: !!process.env.NOTION_DATABASE_ID,
      allEnvVars: Object.keys(process.env).filter(key => 
        key.includes('NOTION') || 
        key.includes('RAINDROP') || 
        key.includes('ADMIN')
      ),
      nodeVersion: process.version,
      timestamp: new Date().toISOString()
    });
    return;
  }
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Start sync
    await performSmartDiffSync(mode, res);
    res.end();
    return;
  }
  
  if (pathname === '/sync' || pathname === '/sync-all') {
    const syncMode = pathname === '/sync-all' ? 'all' : (mode || 'new');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${syncMode === 'all' ? 'Full Sync' : 'Incremental Sync'}</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { font-size: 72px; font-weight: normal; margin-bottom: 40px; }
          button { font-size: 48px; background: none; border: none; cursor: pointer; margin: 20px 0; }
          button:hover { opacity: 0.7; }
          button:disabled { opacity: 0.3; cursor: not-allowed; }
          .back { font-size: 24px; color: #666; text-decoration: none; }
          .status { background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .message { padding: 8px; margin: 4px 0; border-left: 3px solid #ccc; }
          .success { border-left-color: #22c55e; background: rgba(34, 197, 94, 0.1); }
          .error { border-left-color: #ef4444; background: rgba(239, 68, 68, 0.1); }
          .info { border-left-color: #3b82f6; background: rgba(59, 130, 246, 0.1); }
        </style>
      </head>
      <body>
        <a href="/?password=${password}" class="back">← Back to Dashboard</a>
        <h1>${syncMode === 'all' ? 'Full Sync - Smart Diff' : 'Incremental Sync'}</h1>
        <p>${syncMode === 'all' ? 'Complete reconciliation using Smart Diff technology' : 'Sync recent bookmarks only'}</p>
        
        <button id="syncBtn" onclick="startSync()">
          Start ${syncMode === 'all' ? 'Smart Diff' : 'Incremental'} Sync
        </button>
        
        <div id="status" class="status" style="display: none;"></div>
        
        <script>
          function startSync() {
            const btn = document.getElementById('syncBtn');
            const status = document.getElementById('status');
            
            btn.disabled = true;
            btn.textContent = 'Sync Running...';
            status.style.display = 'block';
            status.innerHTML = '';
            
            const evtSource = new EventSource('/sync-stream?password=${password}&mode=${syncMode}');
            
            evtSource.onmessage = function(event) {
              const data = JSON.parse(event.data);
              const div = document.createElement('div');
              div.className = 'message ' + (data.type || 'info');
              div.textContent = data.message;
              status.appendChild(div);
              status.scrollTop = status.scrollHeight;
              
              if (data.isComplete) {
                evtSource.close();
                btn.disabled = false;
                btn.textContent = 'Start ${syncMode === 'all' ? 'Smart Diff' : 'Incremental'} Sync';
              }
            };
            
            evtSource.onerror = function() {
              evtSource.close();
              btn.disabled = false;
              btn.textContent = 'Start ${syncMode === 'all' ? 'Smart Diff' : 'Incremental'} Sync';
              const div = document.createElement('div');
              div.className = 'message error';
              div.textContent = '❌ Connection error';
              status.appendChild(div);
            };
          }
        </script>
      </body>
      </html>
    `);
    return;
  }
  
  // Dashboard (root)
  if (pathname === '/') {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Raindrop/Notion Sync</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { font-size: 72px; font-weight: normal; letter-spacing: -0.05em; margin-bottom: 40px; }
          .count { font-size: 72px; margin-bottom: 20px; }
          .status { font-size: 72px; margin-bottom: 40px; color: #666; }
          .actions a { font-size: 72px; display: block; margin: 20px 0; color: #000; text-decoration: none; }
          .actions a:hover { opacity: 0.7; }
          .actions a.secondary { color: #e1e1e1; }
          .indicator { width: 100px; height: 20px; margin-bottom: 40px; background: #ff0000; }
          .indicator.synced { background: #17d827; }
        </style>
      </head>
      <body>
        <div id="indicator" class="indicator"></div>
        <h1>Raindrop/Notion Sync</h1>
        <div class="count" id="raindrop">... Raindrop Bookmarks</div>
        <div class="count" id="notion">... Notion Pages</div>
        <div class="status" id="status">Loading...</div>
        
        <div class="actions">
          <a href="/sync?password=${password}&mode=new">Sync New ↻</a>
          <a href="/sync-all?password=${password}" class="secondary">Reset / FullSync</a>
        </div>
        
        <script>
          fetch('/api/counts?password=${password}')
            .then(r => r.json())
            .then(data => {
              document.getElementById('raindrop').textContent = data.raindropTotal.toLocaleString() + ' Raindrop Bookmarks';
              document.getElementById('notion').textContent = data.notionTotal.toLocaleString() + ' Notion Pages';
              
              const diff = Math.abs(data.raindropTotal - data.notionTotal);
              const synced = diff <= 5;
              
              if (synced) {
                document.getElementById('indicator').classList.add('synced');
                document.getElementById('status').textContent = 'All bookmarks are synchronized';
                document.getElementById('status').style.color = '#17d827';
              } else {
                document.getElementById('status').textContent = diff.toLocaleString() + ' bookmarks need synchronization';
                document.getElementById('status').style.color = '#ff0000';
              }
            })
            .catch(e => {
              document.getElementById('status').textContent = 'Error loading status';
              document.getElementById('status').style.color = '#ff0000';
            });
        </script>
      </body>
      </html>
    `);
    return;
  }
  
  // 404
  res.status(404).json({ error: 'Not found' });
};
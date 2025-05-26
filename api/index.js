// Fixed version with correct Vercel paths

const path = require('path');

// Try to load services with correct Vercel paths
let getRaindrops, getNotionPages, createNotionPage, updateNotionPage, deleteNotionPage;

try {
  console.log('Current working directory:', process.cwd());
  console.log('__dirname:', __dirname);
  
  // Try different possible paths for Vercel
  const possiblePaths = [
    './services/raindrop',
    '../services/raindrop', 
    '../../services/raindrop',
    path.join(process.cwd(), 'services', 'raindrop'),
    path.join(__dirname, '..', 'services', 'raindrop'),
    path.join(__dirname, '..', '..', 'services', 'raindrop')
  ];
  
  let raindropService, notionService;
  
  for (const servicePath of possiblePaths) {
    try {
      console.log('Trying raindrop path:', servicePath);
      raindropService = require(servicePath);
      console.log('✅ Raindrop service loaded from:', servicePath);
      break;
    } catch (e) {
      console.log('❌ Failed path:', servicePath, e.message);
    }
  }
  
  for (const servicePath of possiblePaths) {
    try {
      const notionPath = servicePath.replace('raindrop', 'notion');
      console.log('Trying notion path:', notionPath);
      notionService = require(notionPath);
      console.log('✅ Notion service loaded from:', notionPath);
      break;
    } catch (e) {
      console.log('❌ Failed notion path:', servicePath.replace('raindrop', 'notion'), e.message);
    }
  }
  
  if (raindropService && notionService) {
    // Use the correct function names from your service files
    getRaindrops = raindropService.getAllRaindrops;
    getNotionPages = notionService.getNotionPages;
    createNotionPage = notionService.createNotionPage;
    updateNotionPage = notionService.updateNotionPage;
    deleteNotionPage = notionService.deleteNotionPage;
    
    console.log('✅ All services loaded successfully');
  } else {
    throw new Error('Could not load services from any path');
  }
  
} catch (error) {
  console.error('❌ Service loading error:', error.message);
  
  // Fallback: Use inline service functions
  console.log('📦 Using inline service functions as fallback');
  
  // Inline Raindrop functions
  getRaindrops = async function getAllRaindrops(limit = 0) {
    console.log('🔄 Fetching bookmarks from Raindrop (inline)...');
    
    let allItems = [];
    let page = 0;
    const perPage = 50;
    let hasMore = true;
    const MAX_PAGES = 30;
    let pageCount = 0;
    
    while (hasMore && pageCount < MAX_PAGES && (limit === 0 || allItems.length < limit)) {
      try {
        if (pageCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        const res = await fetch(`https://api.raindrop.io/rest/v1/raindrops/0?page=${page}&perpage=${perPage}`, {
          headers: {
            Authorization: `Bearer ${process.env.RAINDROP_TOKEN}`
          }
        });

        if (!res.ok) {
          if (res.status === 429) {
            console.log('⏳ Rate limit hit, waiting 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          const errorText = await res.text();
          throw new Error(`Raindrop API error (${res.status}): ${errorText}`);
        }

        const data = await res.json();
        const items = data.items || [];
        
        if (limit > 0) {
          const remaining = limit - allItems.length;
          allItems = [...allItems, ...items.slice(0, remaining)];
        } else {
          allItems = [...allItems, ...items];
        }
        
        hasMore = items.length === perPage && (limit === 0 || allItems.length < limit);
        page++;
        pageCount++;

        console.log(`✅ Retrieved ${items.length} bookmarks (total so far: ${allItems.length})`);
      } catch (error) {
        console.error('Error fetching raindrops:', error);
        throw error;
      }
    }

    console.log(`📚 Total bookmarks fetched: ${allItems.length}`);
    return allItems;
  };
  
  // Inline Notion functions
  getNotionPages = async function() {
    console.log('🔄 Fetching pages from Notion (inline)...');
    
    const pages = [];
    let hasMore = true;
    let startCursor = null;
    let requestCount = 0;

    while (hasMore) {
      if (requestCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      try {
        const res = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_DB_ID}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(startCursor ? { start_cursor: startCursor } : {})
        });

        if (!res.ok) {
          if (res.status === 429) {
            console.log('⏳ Rate limit hit, waiting 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          const data = await res.json();
          throw new Error(`Notion API error: ${data.message || `Status ${res.status}`}`);
        }

        const data = await res.json();
        pages.push(...data.results);
        hasMore = data.has_more;
        startCursor = data.next_cursor;
        requestCount++;
        
        console.log(`Retrieved ${data.results.length} Notion pages (total so far: ${pages.length})`);
      } catch (error) {
        console.error('Error fetching Notion pages:', error);
        throw error;
      }
    }

    return pages;
  };
  
  createNotionPage = async function(item) {
    console.log(`📝 Creating: "${item.name}"`);

    const page = {
      parent: { database_id: process.env.NOTION_DB_ID },
      properties: {
        Name: { title: [{ text: { content: item.name || 'Untitled' } }] },
        URL: { url: item.url },
        Tags: {
          multi_select: (item.tags || []).map(tag => ({ name: tag }))
        }
      }
    };

    try {
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(page)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(`Failed to create page: ${data.message || `Status ${res.status}`}`);
      }
      
      const createdPage = await res.json();
      return { success: true, pageId: createdPage.id };
    } catch (error) {
      console.error(`Error creating page for "${item.name}":`, error);
      return { success: false, error: error.message };
    }
  };
  
  updateNotionPage = async function(pageId, item) {
    const page = {
      properties: {
        Name: { title: [{ text: { content: item.name || 'Untitled' } }] },
        URL: { url: item.url },
        Tags: {
          multi_select: (item.tags || []).map(tag => ({ name: tag }))
        }
      }
    };

    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(page)
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(`Failed to update page: ${data.message || `Status ${res.status}`}`);
      }

      return true;
    } catch (error) {
      console.error(`Error updating page ${pageId}:`, error);
      throw error;
    }
  };
  
  deleteNotionPage = async function(pageId) {
    try {
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          archived: true
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(`Failed to delete page: ${data.message || `Status ${res.status}`}`);
      }

      return true;
    } catch (error) {
      console.error(`Error deleting page ${pageId}:`, error);
      throw error;
    }
  };
}

// Smart Diff sync function
async function performSmartDiffSync(mode, res) {
  try {
    res.write(`data: ${JSON.stringify({message: `🔒 Starting Smart Diff sync (${mode})`, type: 'info'})}\n\n`);
    
    // Fetch data
    res.write(`data: ${JSON.stringify({message: '📡 Fetching raindrops...', type: 'info'})}\n\n`);
    const raindrops = await getRaindrops();
    res.write(`data: ${JSON.stringify({message: `✅ Found ${raindrops.length} raindrops`, type: 'success'})}\n\n`);
    
    res.write(`data: ${JSON.stringify({message: '📄 Fetching Notion pages...', type: 'info'})}\n\n`);
    const notionPages = await getNotionPages();
    res.write(`data: ${JSON.stringify({message: `✅ Found ${notionPages.length} notion pages`, type: 'success'})}\n\n`);
    
    // Build lookup maps
    const notionLookupByUrl = new Map();
    const notionLookupByTitle = new Map();
    
    notionPages.forEach(page => {
      const url = page.properties?.URL?.url;
      const title = page.properties?.Name?.title?.[0]?.text?.content;
      if (url) notionLookupByUrl.set(url, page);
      if (title) notionLookupByTitle.set(title, page);
    });
    
    res.write(`data: ${JSON.stringify({message: '🗺️ Lookup maps created', type: 'success'})}\n\n`);
    
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
    
    res.write(`data: ${JSON.stringify({ 
      message: `🔍 Smart Diff complete: ${toAdd.length} to add, ${toUpdate.length} to update, ${toSkip.length} to skip`, 
      type: 'success'
    })}\n\n`);
    
    res.write(`data: ${JSON.stringify({ 
      message: `🚀 ${efficiency}% efficiency - processing only ${totalOperations} of ${raindrops.length} items`, 
      type: 'info'
    })}\n\n`);
    
    // Process additions
    for (const raindrop of toAdd) {
      try {
        await createNotionPage({
          name: raindrop.title,
          url: raindrop.link,
          tags: raindrop.tags || []
        });
        res.write(`data: ${JSON.stringify({message: `➕ Added: "${raindrop.title}"`, type: 'success'})}\n\n`);
      } catch (error) {
        res.write(`data: ${JSON.stringify({message: `❌ Failed to add: "${raindrop.title}"`, type: 'error'})}\n\n`);
      }
    }
    
    // Process updates
    for (const { raindrop, existingPage } of toUpdate) {
      try {
        await updateNotionPage(existingPage.id, {
          name: raindrop.title,
          url: raindrop.link,
          tags: raindrop.tags || []
        });
        res.write(`data: ${JSON.stringify({message: `🔄 Updated: "${raindrop.title}"`, type: 'success'})}\n\n`);
      } catch (error) {
        res.write(`data: ${JSON.stringify({message: `❌ Failed to update: "${raindrop.title}"`, type: 'error'})}\n\n`);
      }
    }
    
    res.write(`data: ${JSON.stringify({ 
      message: `✅ Smart Diff sync completed! ${efficiency}% efficiency achieved`, 
      type: 'success',
      isComplete: true
    })}\n\n`);
    
  } catch (error) {
    console.error('Sync error:', error);
    res.write(`data: ${JSON.stringify({message: `❌ Sync failed: ${error.message}`, type: 'error', isComplete: true})}\n\n`);
  }
}

// Main export function
module.exports = async (req, res) => {
  try {
    console.log('Request:', req.method, req.url);
    
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
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    const pathname = url.pathname;
    
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
    
    if (pathname === '/sync-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
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
            .status { background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0; max-height: 400px; overflow-y: auto; }
            .message { padding: 8px; margin: 4px 0; border-left: 3px solid #ccc; font-family: monospace; font-size: 14px; }
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
    
    // Dashboard
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
    
    res.status(404).json({ error: 'Not found' });
    
  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({ error: error.message });
  }
};
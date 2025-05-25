// Ultra-simple test to get your site working again

module.exports = async (req, res) => {
  try {
    console.log('Function called:', req.url);
    
    // Basic headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const password = url.searchParams.get('password');
    const pathname = url.pathname;
    
    // Simple password check
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ 
        error: 'Unauthorized',
        hasAdminPassword: !!process.env.ADMIN_PASSWORD,
        providedPassword: !!password
      });
      return;
    }
    
    if (pathname === '/health') {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }
    
    if (pathname === '/debug-env') {
      res.json({
        hasAdminPassword: !!process.env.ADMIN_PASSWORD,
        hasRaindropToken: !!process.env.RAINDROP_TOKEN,
        hasNotionToken: !!process.env.NOTION_TOKEN,
        hasNotionDbId: !!process.env.NOTION_DB_ID,
        hasNotionDatabaseId: !!process.env.NOTION_DATABASE_ID,
        allEnvKeys: Object.keys(process.env).filter(key => 
          key.includes('NOTION') || key.includes('RAINDROP') || key.includes('ADMIN')
        ),
        nodeVersion: process.version
      });
      return;
    }
    
    if (pathname === '/test-services') {
      // Test loading services without calling them
      let serviceStatus = {};
      
      try {
        const raindropService = require('./services/raindrop');
        serviceStatus.raindrop = 'loaded';
        serviceStatus.raindropFunctions = Object.keys(raindropService);
      } catch (error) {
        serviceStatus.raindrop = `error: ${error.message}`;
      }
      
      try {
        const notionService = require('./services/notion');
        serviceStatus.notion = 'loaded';
        serviceStatus.notionFunctions = Object.keys(notionService);
      } catch (error) {
        serviceStatus.notion = `error: ${error.message}`;
      }
      
      res.json({
        services: serviceStatus,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    // Default dashboard
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Raindrop/Notion Sync - Debug</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          .status { background: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .success { background: #d4edda; }
          .error { background: #f8d7da; }
          a { display: block; margin: 10px 0; padding: 10px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; text-align: center; }
        </style>
      </head>
      <body>
        <h1>🔧 System Debug</h1>
        
        <div class="status success">
          ✅ Function is working!<br>
          ✅ Password authentication OK<br>
          ✅ Basic routing OK
        </div>
        
        <h2>Debug Tools</h2>
        <a href="/debug-env?password=${password}">🔍 Check Environment Variables</a>
        <a href="/test-services?password=${password}">🧪 Test Service Loading</a>
        <a href="/health?password=${password}">❤️ Health Check</a>
        
        <div class="status">
          <strong>Next Step:</strong> Click "Check Environment Variables" to see what API keys are missing.
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({
      error: 'Function failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};
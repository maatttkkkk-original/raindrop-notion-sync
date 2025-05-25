// Absolute minimal test - just to see if Vercel functions work at all

module.exports = async (req, res) => {
  console.log('Function called:', req.url);
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const password = url.searchParams.get('password');
  
  console.log('Pathname:', pathname);
  console.log('Password provided:', !!password);
  
  // Debug ALL possible password environment variables
  console.log('All password-related env vars:');
  console.log('APP_PASSWORD:', process.env.APP_PASSWORD);
  console.log('PASSWORD:', process.env.PASSWORD);
  console.log('SYNC_PASSWORD:', process.env.SYNC_PASSWORD);
  console.log('AUTH_PASSWORD:', process.env.AUTH_PASSWORD);
  
  // Try multiple possible password env vars
  const possiblePasswords = [
    process.env.APP_PASSWORD,
    process.env.PASSWORD,
    process.env.SYNC_PASSWORD,
    process.env.AUTH_PASSWORD,
    '!BANGOULA413!' // hardcoded fallback for testing
  ];
  
  const correctPassword = possiblePasswords.find(p => p && password === p);
  
  // Check password
  if (!password || !correctPassword) {
    console.log('Password check failed');
    res.status(401).json({ 
      error: 'Unauthorized',
      debug: {
        providedPassword: password ? 'PROVIDED' : 'MISSING',
        possiblePasswords: possiblePasswords.map(p => p ? `SET (${p.length} chars)` : 'NOT SET'),
        providedPasswordLength: password ? password.length : 0
      }
    });
    return;
  }
  
  // Route handling
  if (pathname === '/health') {
    console.log('Health check');
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      env: {
        hasPassword: !!process.env.APP_PASSWORD,
        nodeVersion: process.version
      }
    });
    return;
  }
  
  if (pathname === '/') {
    console.log('Dashboard request');
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Raindrop/Notion Sync - Test</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h1 { color: #333; }
          .status { background: #f0f0f0; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .success { background: #d4edda; color: #155724; }
          .error { background: #f8d7da; color: #721c24; }
          button { background: #007bff; color: white; border: none; padding: 10px 20px; cursor: pointer; border-radius: 4px; }
          button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <h1>🔧 Raindrop/Notion Sync - Debug Mode</h1>
        
        <div class="status success">
          ✅ Basic function is working!<br>
          ✅ Password authentication working<br>
          ✅ Environment variables accessible<br>
          Timestamp: ${new Date().toISOString()}
        </div>
        
        <h2>System Info</h2>
        <div class="status">
          <strong>Node.js:</strong> ${process.version}<br>
          <strong>Platform:</strong> ${process.platform}<br>
          <strong>Has Password:</strong> ${!!process.env.APP_PASSWORD}<br>
          <strong>Memory:</strong> ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
        </div>
        
        <h2>Test Services</h2>
        <button onclick="testServices()">Test Raindrop/Notion Connection</button>
        <div id="service-test"></div>
        
        <h2>Quick Actions</h2>
        <p>
          <a href="/health?password=${password}">🔍 Health Check</a><br>
          <a href="/test-services?password=${password}">🧪 Test Services</a>
        </p>
        
        <script>
          async function testServices() {
            const btn = event.target;
            const resultDiv = document.getElementById('service-test');
            
            btn.disabled = true;
            btn.textContent = 'Testing...';
            resultDiv.innerHTML = '<div class="status">Testing services...</div>';
            
            try {
              const response = await fetch('/test-services?password=${password}');
              const data = await response.json();
              
              resultDiv.innerHTML = '<div class="status ' + (data.success ? 'success' : 'error') + '">' + 
                JSON.stringify(data, null, 2) + '</div>';
            } catch (error) {
              resultDiv.innerHTML = '<div class="status error">Error: ' + error.message + '</div>';
            }
            
            btn.disabled = false;
            btn.textContent = 'Test Raindrop/Notion Connection';
          }
        </script>
      </body>
      </html>
    `);
    return;
  }
  
  if (pathname === '/test-services') {
    console.log('Testing services');
    try {
      // Try to require services
      const raindropService = require('./services/raindrop');
      const notionService = require('./services/notion');
      
      console.log('Services required successfully');
      
      // Try to call them
      const raindrops = await raindropService.getRaindrops();
      const notionPages = await notionService.getNotionPages();
      
      console.log('Services called successfully');
      
      res.status(200).json({
        success: true,
        raindropCount: raindrops.length,
        notionCount: notionPages.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Service test failed:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    }
    return;
  }
  
  // 404 for other routes
  res.status(404).json({ error: 'Not found', path: pathname });
};
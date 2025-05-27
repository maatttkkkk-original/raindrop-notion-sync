// Progressive Enhancement Sync System - Base Layer

const { getAllRaindrops, getRaindropTotal, getRecentRaindrops } = require('../services/raindrop');
const { getNotionPages, getTotalNotionPages, createNotionPage, updateNotionPage, deleteNotionPage } = require('../services/notion');

// ...existing helper functions and sync logic (unchanged)...

// Main Vercel export function
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
    const mode = url.searchParams.get('mode') || 'smart';
    const limit = parseInt(url.searchParams.get('limit') || '0', 10);
    const daysBack = parseInt(url.searchParams.get('daysBack') || '30', 10);
    const deleteOrphaned = url.searchParams.get('deleteOrphaned') === 'true';

    // Password check
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const pathname = url.pathname;

    // Health check
    if (pathname === '/health') {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
      return;
    }

    // API: Get counts
    if (pathname === '/api/counts') {
      try {
        const [raindropTotal, notionTotal] = await Promise.all([
          getRaindropTotal(),
          getTotalNotionPages()
        ]);
        res.json({
          raindropTotal,
          notionTotal,
          isSynced: Math.abs(raindropTotal - notionTotal) <= 5,
          success: true
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
      return;
    }

    // Sync stream - the heart of the system
    if (pathname === '/sync-stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      activeStreams.set(streamId, res);

      // ...existing sync stream logic...

      req.on('close', () => {
        activeStreams.delete(streamId);
      });

      return;
    }

    // No HTML rendering here! Let your framework/templates handle all frontend routes.

    res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({ error: error.message });
  }
};
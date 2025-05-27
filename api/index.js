const express = require('express');
const router = express.Router();
const {
  getAllRaindrops, getRaindropTotal, getRecentRaindrops
} = require('../services/raindrop');
const {
  getNotionPages, getTotalNotionPages, createNotionPage,
  updateNotionPage, deleteNotionPage
} = require('../services/notion');

// SSE state
let GLOBAL_SYNC_LOCK = false;
let SYNC_START_TIME = null;
let SYNC_LOCK_ID = null;
let currentSync = null;
const activeStreams = new Map();

function broadcastSSEData(data) {
  for (const [id, res] of activeStreams.entries()) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      activeStreams.delete(id);
    }
  }
}

// Health check
router.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Counts API
router.get('/api/counts', async (req, res) => {
  const { password } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync stream
router.get('/sync-stream', async (req, res) => {
  const { password, mode = 'smart', daysBack = '30', deleteOrphaned = 'false', limit = '0' } = req.query;
  if (password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const streamId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeStreams.set(streamId, res);

  if (GLOBAL_SYNC_LOCK) {
    const duration = Math.round((Date.now() - SYNC_START_TIME) / 1000);
    res.write(`data: ${JSON.stringify({
      message: `⏸️ Sync already running (${duration}s elapsed). Please wait...`,
      type: 'waiting',
      lockInfo: { locked: true, lockId: SYNC_LOCK_ID, duration }
    })}\n\n`);
    return;
  }

  GLOBAL_SYNC_LOCK = true;
  SYNC_START_TIME = Date.now();
  SYNC_LOCK_ID = `sync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  currentSync = { isRunning: true, lockId: SYNC_LOCK_ID };

  const syncOptions = {
    mode,
    daysBack: parseInt(daysBack, 10),
    deleteOrphaned: deleteOrphaned === 'true',
    limit: parseInt(limit, 10)
  };

  const syncPromise = require('./sync-core')(syncOptions, {
    getAllRaindrops,
    getRecentRaindrops,
    getNotionPages,
    createNotionPage,
    updateNotionPage,
    deleteNotionPage,
    broadcast: broadcastSSEData
  });

  syncPromise.finally(() => {
    GLOBAL_SYNC_LOCK = false;
    SYNC_START_TIME = null;
    SYNC_LOCK_ID = null;
    currentSync = null;
    activeStreams.delete(streamId);
  });

  req.on('close', () => {
    activeStreams.delete(streamId);
  });
});

// Pages

router.get('/', (req, res) => {
  const { password = '' } = req.query;
  res.render('index', { password });
});

router.get('/sync', (req, res) => {
  const { password = '', mode = 'smart', daysBack = '30', deleteOrphaned = 'false' } = req.query;

  const pageTitle =
    mode === 'reset' ? 'Reset & Full Sync' :
    mode === 'incremental' ? 'Incremental Sync' :
    'Smart Sync';

  const pageDescription =
    mode === 'reset' ? 'Delete all Notion pages and recreate from Raindrop' :
    mode === 'incremental' ? 'Sync only recent bookmarks' :
    'Smart analysis — only sync what needs to change';

  res.render('sync', {
    password,
    syncMode: mode,
    daysBack: parseInt(daysBack, 10),
    deleteOrphaned: deleteOrphaned === 'true',
    pageTitle,
    pageDescription
  });
});

// Catch-all 404
router.use((req, res) => {
  res.status(404).render('error', {
    statusCode: 404,
    message: 'Page not found'
  });
});

module.exports = router;
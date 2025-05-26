/**
 * Enhanced Sync Management - Progressive Enhancement
 * Unified sync handling with modern web APIs
 */

class SyncManager {
  constructor() {
    this.evtSource = null;
    this.syncInProgress = false;
    this.abortController = null;
    this.elements = {};
    this.stats = {
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      failed: 0
    };
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.setupElements();
      this.bindEvents();
      this.checkForExistingSync();
    });
  }

  setupElements() {
    // Cache DOM elements
    this.elements = {
      startBtn: document.getElementById('syncBtn') || document.getElementById('startBtn'),
      status: document.getElementById('status'),
      progress: document.querySelector('.progress-fill'),
      indicator: document.getElementById('indicator'),
      // Stats elements
      addedCount: document.getElementById('added-count'),
      updatedCount: document.getElementById('updated-count'),
      deletedCount: document.getElementById('deleted-count'),
      skippedCount: document.getElementById('skipped-count'),
      // Efficiency display
      efficiencyPercentage: document.getElementById('efficiency-percentage'),
      operationsCount: document.getElementById('operations-count'),
      efficiencyStatus: document.getElementById('efficiency-status')
    };
  }

  bindEvents() {
    // Bind start button
    if (this.elements.startBtn) {
      this.elements.startBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.startSync();
      });
    }

    // Handle page visibility for cleanup
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.evtSource) {
        // Don't close connection on hide - let it continue
        Utils.log.info('Page hidden but keeping sync connection alive');
      } else if (document.visibilityState === 'visible') {
        // Reconnect if needed
        this.checkConnectionStatus();
      }
    });

    // Handle beforeunload for graceful cleanup
    window.addEventListener('beforeunload', () => {
      if (this.evtSource) {
        this.evtSource.close();
      }
      if (this.abortController) {
        this.abortController.abort();
      }
    });

    // Enhanced error handling
    window.addEventListener('error', (event) => {
      if (this.syncInProgress) {
        Utils.log.error('Sync error detected:', event.error);
        this.handleSyncError('An unexpected error occurred');
      }
    });

    // Listen for online/offline events
    window.addEventListener('online', () => {
      if (this.syncInProgress && !this.evtSource) {
        Utils.log.info('Connection restored, attempting to reconnect...');
        this.showStatus('🌐 Connection restored, reconnecting...', 'info');
      }
    });

    window.addEventListener('offline', () => {
      if (this.syncInProgress) {
        this.showStatus('🌐 Connection lost - sync will continue when online', 'warning');
      }
    });
  }

  // Enhanced sync starter with options detection
  startSync() {
    // Prevent multiple syncs
    if (this.syncInProgress) {
      this.showStatus('Sync already in progress', 'warning');
      return;
    }

    // Reset stats
    this.resetStats();

    // Get sync parameters from URL or default
    const urlParams = Utils.getUrlParams();
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';
    const daysBack = urlParams.get('daysBack') || '30';
    const deleteOrphaned = urlParams.get('deleteOrphaned') === 'true';

    if (!password) {
      this.showStatus('Password required', 'error');
      return;
    }

    // Create abort controller for this sync
    this.abortController = new AbortController();

    // Update UI immediately
    this.updateSyncUI(true);
    
    // Build sync URL with parameters
    const syncUrl = new URL('/sync-stream', window.location.origin);
    syncUrl.searchParams.set('password', password);
    syncUrl.searchParams.set('mode', mode);
    syncUrl.searchParams.set('daysBack', daysBack);
    syncUrl.searchParams.set('deleteOrphaned', deleteOrphaned);
    
    // Add cache-busting parameters
    syncUrl.searchParams.set('_t', Date.now().toString());
    syncUrl.searchParams.set('_id', Math.random().toString(36).substring(7));

    Utils.log.info('Starting sync with parameters:', { mode, daysBack, deleteOrphaned });

    // Start performance measurement
    Utils.perf.mark('sync-start');

    // Add small delay to prevent race conditions
    setTimeout(() => {
      this.connectToSyncStream(syncUrl.toString());
    }, 100);
  }

  connectToSyncStream(url) {
    try {
      this.evtSource = new EventSource(url);
      
      this.evtSource.onopen = () => {
        this.showStatus('🔗 Connected to sync stream', 'info');
        Utils.log.info('EventSource connected');
      };

      this.evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleSyncMessage(data);
        } catch (error) {
          Utils.log.error('Error parsing sync message:', error);
          this.showStatus('Error parsing sync data', 'error');
        }
      };

      this.evtSource.onerror = (error) => {
        Utils.log.error('EventSource error:', error);
        
        // Check if we're still online
        if (!navigator.onLine) {
          this.showStatus('🌐 Connection lost - waiting for network...', 'warning');
          return;
        }
        
        // Check readyState to determine error type
        if (this.evtSource.readyState === EventSource.CLOSED) {
          this.handleSyncError('Connection closed unexpectedly');
        } else {
          this.handleSyncError('Connection error occurred');
        }
      };

    } catch (error) {
      Utils.log.error('Failed to create EventSource:', error);
      this.handleSyncError('Failed to establish connection');
    }
  }

  handleSyncMessage(data) {
    const { message, type, counts, complete, finalCounts, mode, efficiency } = data;

    // Update progress if available
    if (data.progress !== undefined && this.elements.progress) {
      this.elements.progress.style.width = `${data.progress}%`;
    }

    // Update counts if available
    if (counts) {
      this.updateStats(counts);
    }

    // Show message with enhanced styling
    if (message) {
      this.showStatus(message, type || 'info');
    }

    // Handle efficiency updates
    if (efficiency) {
      this.updateEfficiencyDisplay(efficiency);
    }

    // Handle completion
    if (complete) {
      Utils.perf.mark('sync-end');
      const duration = Utils.perf.measure('sync-duration', 'sync-start', 'sync-end');
      
      this.handleSyncComplete(finalCounts, mode, duration);
    }
  }

  handleSyncComplete(finalCounts, mode, duration) {
    setTimeout(() => {
      this.cleanupConnection();
      this.updateSyncUI(false);
      
      // Show completion message with enhanced details
      if (finalCounts) {
        this.updateStats(finalCounts);
        
        const total = finalCounts.added + finalCounts.updated + finalCounts.deleted;
        let message = '🎉 Sync completed successfully!';
        
        if (mode === 'reset') {
          message += ` Created: ${finalCounts.added}, Deleted: ${finalCounts.deleted}`;
        } else {
          message += ` Added: ${finalCounts.added}, Updated: ${finalCounts.updated}, Skipped: ${finalCounts.skipped}`;
        }
        
        if (duration) {
          message += ` (${Utils.time.formatDuration(duration)})`;
        }
        
        this.showStatus(message, 'complete');
        
        // Update indicator if present
        if (this.elements.indicator && total > 0) {
          this.elements.indicator.classList.remove('not-synced');
          this.elements.indicator.classList.add('synced');
        }
        
        // Emit completion event for other components
        Utils.events.emit('syncCompleted', finalCounts);
        
        // Auto-refresh dashboard counts after successful sync
        this.refreshDashboard();
        
      } else {
        this.showStatus('🎉 Sync completed!', 'complete');
      }

      // Log performance info
      if (duration) {
        Utils.log.info('Sync performance:', {
          duration: Utils.time.formatDuration(duration),
          counts: finalCounts,
          memory: Utils.perf.getMemoryUsage()
        });
      }
      
    }, 500);
  }

  handleSyncError(errorMessage) {
    this.cleanupConnection();
    this.updateSyncUI(false);
    
    const message = `❌ ${errorMessage}`;
    this.showStatus(message, 'error');
    
    Utils.log.error('Sync error:', errorMessage);
    
    // Emit error event
    Utils.events.emit('syncError', { message: errorMessage });
  }

  cleanupConnection() {
    if (this.evtSource) {
      this.evtSource.close();
      this.evtSource = null;
    }
    
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    this.syncInProgress = false;
  }

  updateSyncUI(inProgress) {
    this.syncInProgress = inProgress;
    
    if (!this.elements.startBtn) return;

    if (inProgress) {
      this.elements.startBtn.disabled = true;
      this.elements.startBtn.textContent = 'Sync Running...';
      this.elements.startBtn.classList.add('running');
      
      // Add visual feedback
      if (Utils.animate) {
        this.elements.startBtn.style.opacity = '0.7';
      }
      
      // Show status container
      if (this.elements.status) {
        Utils.ui.show(this.elements.status);
      }
      
    } else {
      this.elements.startBtn.disabled = false;
      this.elements.startBtn.textContent = this.getOriginalButtonText();
      this.elements.startBtn.classList.remove('running');
      
      // Reset visual feedback
      this.elements.startBtn.style.opacity = '';
    }
  }

  getOriginalButtonText() {
    // Try to determine original button text from URL params
    const mode = Utils.getParam('mode', 'smart');
    
    switch (mode) {
      case 'reset': return 'Start Reset & Full Sync';
      case 'incremental': return 'Start Incremental Sync';
      case 'smart': 
      default: return 'Start Smart Sync';
    }
  }

  showStatus(message, type = 'info') {
    if (!this.elements.status) return;

    // Create status element with enhanced styling
    const statusElement = document.createElement('div');
    statusElement.className = `sync-update ${type}`;
    
    // Enhanced styling based on type
    const styles = {
      info: { borderLeftColor: '#3b82f6', background: '#e3f2fd' },
      success: { borderLeftColor: '#22c55e', background: '#e8f5e8' },
      added: { borderLeftColor: '#22c55e', background: '#e8f5e8' },
      updated: { borderLeftColor: '#f59e0b', background: '#fff3cd' },
      deleted: { borderLeftColor: '#ef4444', background: '#f8d7da' },
      failed: { borderLeftColor: '#ef4444', background: '#f8d7da' },
      error: { borderLeftColor: '#ef4444', background: '#f8d7da' },
      warning: { borderLeftColor: '#f59e0b', background: '#fff3cd' },
      complete: { borderLeftColor: '#22c55e', background: '#d4edda', fontWeight: '600' },
      analysis: { borderLeftColor: '#6f42c1', background: '#f3e5f5', fontWeight: '500' }
    };
    
    const style = styles[type] || styles.info;
    Object.assign(statusElement.style, {
      padding: '8px 12px',
      margin: '4px 0',
      borderRadius: '4px',
      borderLeft: `4px solid ${style.borderLeftColor}`,
      backgroundColor: style.background,
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
      fontSize: '14px',
      lineHeight: '1.4',
      fontWeight: style.fontWeight || 'normal'
    });
    
    statusElement.textContent = message;
    
    // Add to status container
    this.elements.status.appendChild(statusElement);
    
    // Auto-scroll to bottom
    this.elements.status.scrollTop = this.elements.status.scrollHeight;
    
    // Add entrance animation if supported
    if (Utils.animate && !Utils.device.prefersReducedMotion()) {
      Utils.animate.slideIn(statusElement, 200);
    }
    
    // Log to console for debugging
    Utils.log.info(`Sync ${type}:`, message);
    
    // Limit number of status messages (performance)
    const maxMessages = 100;
    const messages = this.elements.status.children;
    if (messages.length > maxMessages) {
      this.elements.status.removeChild(messages[0]);
    }
  }

  updateStats(counts) {
    this.stats = { ...this.stats, ...counts };
    
    // Update stat displays if present
    const statUpdates = {
      addedCount: counts.added,
      updatedCount: counts.updated,
      deletedCount: counts.deleted,
      skippedCount: counts.skipped
    };
    
    Object.entries(statUpdates).forEach(([elementKey, value]) => {
      if (this.elements[elementKey] && value !== undefined) {
        this.elements[elementKey].textContent = value.toString();
        
        // Add subtle animation for number changes
        if (Utils.animate && !Utils.device.prefersReducedMotion()) {
          this.elements[elementKey].style.transform = 'scale(1.1)';
          setTimeout(() => {
            this.elements[elementKey].style.transform = '';
          }, 150);
        }
      }
    });
  }

  updateEfficiencyDisplay(efficiency) {
    if (this.elements.efficiencyPercentage && efficiency.percentage !== undefined) {
      this.elements.efficiencyPercentage.textContent = `${efficiency.percentage}%`;
    }
    
    if (this.elements.operationsCount && efficiency.itemsProcessed !== undefined) {
      this.elements.operationsCount.textContent = 
        `${efficiency.itemsProcessed} of ${efficiency.totalItems} items`;
    }
    
    if (this.elements.efficiencyStatus && efficiency.percentage !== undefined) {
      const percentage = efficiency.percentage;
      let status = '';
      
      if (percentage >= 95) {
        status = '🚀 Excellent efficiency - minimal processing needed!';
      } else if (percentage >= 80) {
        status = '✨ Good efficiency - smart diff working well';
      } else if (percentage >= 50) {
        status = '⚡ Moderate efficiency - some changes detected';
      } else {
        status = '🔄 Major sync - processing many changes';
      }
      
      this.elements.efficiencyStatus.textContent = status;
    }
  }

  resetStats() {
    this.stats = {
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      failed: 0
    };
    
    this.updateStats(this.stats);
  }

  checkForExistingSync() {
    // Check if there's evidence of an existing sync
    const syncLockKey = 'sync_in_progress';
    const existingSync = Utils.storage.get(syncLockKey);
    
    if (existingSync) {
      const now = Date.now();
      const syncAge = now - existingSync.timestamp;
      const maxSyncTime = 15 * 60 * 1000; // 15 minutes
      
      if (syncAge < maxSyncTime) {
        this.showStatus('⏸️ Sync may be running in another tab or session', 'warning');
        Utils.log.info('Existing sync detected:', existingSync);
      } else {
        // Clean up old sync lock
        Utils.storage.remove(syncLockKey);
      }
    }
  }

  checkConnectionStatus() {
    if (this.syncInProgress && !this.evtSource) {
      this.showStatus('🔄 Checking connection status...', 'info');
      
      // Try to determine if sync is still active on server
      // This would require additional server endpoint
    }
  }

  refreshDashboard() {
    // Try to refresh dashboard counts if we're on the dashboard
    if (window.location.pathname === '/' || window.location.pathname.includes('dashboard')) {
      const password = Utils.getParam('password');
      if (password) {
        this.loadCounts(password);
      }
    }
  }

  async loadCounts(password) {
    try {
      const response = await Utils.api.get(`/api/counts?password=${encodeURIComponent(password)}`);
      
      // Update dashboard elements if present
      const raindropElement = document.getElementById('raindrop');
      const notionElement = document.getElementById('notion');
      const statusElement = document.getElementById('status');
      const indicator = document.getElementById('indicator');
      
      if (raindropElement) {
        raindropElement.textContent = `${Utils.formatNumber(response.raindropTotal)} Raindrop Bookmarks`;
      }
      
      if (notionElement) {
        notionElement.textContent = `${Utils.formatNumber(response.notionTotal)} Notion Pages`;
      }
      
      if (statusElement && indicator) {
        const diff = Math.abs(response.raindropTotal - response.notionTotal);
        const synced = diff <= 5;
        
        if (synced) {
          indicator.classList.add('synced');
          indicator.classList.remove('not-synced');
          statusElement.textContent = 'All bookmarks are synchronized';
          statusElement.style.color = '#17d827';
        } else {
          statusElement.textContent = `${Utils.formatNumber(diff)} bookmarks need synchronization`;
          statusElement.style.color = '#ff0000';
        }
      }
      
      Utils.log.info('Dashboard counts refreshed:', response);
      
    } catch (error) {
      Utils.log.error('Failed to refresh dashboard counts:', error);
    }
  }

  // Public API methods
  stopSync() {
    if (this.evtSource) {
      this.cleanupConnection();
      this.showStatus('Sync stopped by user', 'warning');
      this.updateSyncUI(false);
    }
  }

  isRunning() {
    return this.syncInProgress;
  }

  getStats() {
    return { ...this.stats };
  }

  // Enhanced debugging info
  getDebugInfo() {
    return {
      syncInProgress: this.syncInProgress,
      hasEventSource: !!this.evtSource,
      eventSourceState: this.evtSource?.readyState,
      stats: this.stats,
      elements: Object.keys(this.elements).reduce((acc, key) => {
        acc[key] = !!this.elements[key];
        return acc;
      }, {}),
      connectionInfo: Utils.device.getConnection(),
      performance: Utils.perf.getMemoryUsage()
    };
  }
}

// Enhanced component for dashboard-specific functionality
class DashboardManager {
  constructor() {
    this.countCache = null;
    this.lastUpdate = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.elements = {};
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.setupElements();
      this.loadCounts();
      this.setupEventListeners();
      this.startPeriodicUpdates();
    });
  }

  setupElements() {
    this.elements = {
      raindropCount: document.getElementById('raindrop'),
      notionCount: document.getElementById('notion'),
      syncStatus: document.getElementById('status'),
      indicator: document.getElementById('indicator')
    };
  }

  setupEventListeners() {
    // Listen for sync completion
    Utils.events.on('syncCompleted', () => {
      Utils.log.info('Sync completed, refreshing dashboard');
      this.invalidateCache();
      setTimeout(() => this.loadCounts(), 2000);
    });

    // Handle window focus
    window.addEventListener('focus', () => {
      if (this.isCacheStale()) {
        Utils.log.info('Window focused and cache stale, refreshing');
        this.loadCounts();
      }
    });

    // Handle page visibility
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isCacheStale()) {
        Utils.log.info('Page visible and cache stale, refreshing');
        this.loadCounts();
      }
    });
  }

  async loadCounts() {
    try {
      // Check cache first
      if (this.countCache && !this.isCacheStale()) {
        this.updateCountsDisplay(this.countCache);
        return;
      }

      const password = Utils.getParam('password');
      if (!password) {
        throw new Error('Password required');
      }

      Utils.log.info('Fetching fresh counts from API');
      const response = await Utils.api.get(`/api/counts?password=${encodeURIComponent(password)}`);
      
      // Update cache
      this.countCache = response;
      this.lastUpdate = Date.now();
      
      // Update display
      this.updateCountsDisplay(response);
      
    } catch (error) {
      Utils.log.error('Failed to load counts:', error);
      this.handleCountsError(error);
    }
  }

  updateCountsDisplay(data) {
    if (this.elements.raindropCount) {
      this.elements.raindropCount.textContent = `${Utils.formatNumber(data.raindropTotal)} Raindrop Bookmarks`;
    }
    
    if (this.elements.notionCount) {
      this.elements.notionCount.textContent = `${Utils.formatNumber(data.notionTotal)} Notion Pages`;
    }
    
    // Update sync status
    const diff = Math.abs(data.raindropTotal - data.notionTotal);
    const synced = diff <= 5;
    
    if (this.elements.syncStatus) {
      if (synced) {
        this.elements.syncStatus.textContent = 'All bookmarks are synchronized';
        this.elements.syncStatus.style.color = '#17d827';
      } else {
        this.elements.syncStatus.textContent = `${Utils.formatNumber(diff)} bookmarks need synchronization`;
        this.elements.syncStatus.style.color = '#ff0000';
      }
    }
    
    if (this.elements.indicator) {
      if (synced) {
        this.elements.indicator.classList.add('synced');
        this.elements.indicator.classList.remove('not-synced');
      } else {
        this.elements.indicator.classList.remove('synced');
        this.elements.indicator.classList.add('not-synced');
      }
    }
  }

  handleCountsError(error) {
    if (this.elements.raindropCount) {
      this.elements.raindropCount.textContent = 'Error loading counts';
    }
    
    if (this.elements.notionCount) {
      this.elements.notionCount.textContent = 'Error loading counts';
    }
    
    if (this.elements.syncStatus) {
      this.elements.syncStatus.textContent = 'Failed to load sync status';
      this.elements.syncStatus.style.color = '#ff0000';
    }
  }

  invalidateCache() {
    this.countCache = null;
    this.lastUpdate = null;
  }

  isCacheStale() {
    if (!this.lastUpdate || !this.countCache) {
      return true;
    }
    
    const age = Date.now() - this.lastUpdate;
    return age > this.cacheTimeout;
  }

  startPeriodicUpdates() {
    // Update counts every 5 minutes when page is visible
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.loadCounts();
      }
    }, this.cacheTimeout);
  }
}

// Initialize sync manager
Utils.ready(() => {
  if (typeof window !== 'undefined') {
    // Initialize appropriate manager based on page
    if (document.getElementById('syncBtn') || document.getElementById('startBtn')) {
      window.syncManager = new SyncManager();
    }
    
    if (document.getElementById('raindrop') || document.getElementById('notion')) {
      window.dashboardManager = new DashboardManager();
    }
    
    Utils.log.info('Sync management initialized');
  }
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SyncManager, DashboardManager };
}
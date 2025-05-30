/**
 * Enhanced Sync Management - Robust EventSource Connection
 * Fixed connection stability and error handling
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
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.heartbeatTimeout = null;
    this.connectionTimeout = null;
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.setupElements();
      this.bindEvents();
      console.log('🚀 Enhanced SyncManager initialized with robust EventSource handling');
    });
  }

  setupElements() {
    // Cache DOM elements - EXACT IDs from your sync.hbs
    this.elements = {
      // Main sync button
      startBtn: document.getElementById('syncBtn'),
      
      // Status/log area
      status: document.getElementById('status'),
      
      // Progress elements
      progressText: document.getElementById('progress-text'),
      progressFill: document.getElementById('progress-fill'),
      
      // Stats elements
      syncStats: document.getElementById('sync-stats'),
      addedCount: document.getElementById('added-count'),
      updatedCount: document.getElementById('updated-count'),
      deletedCount: document.getElementById('deleted-count'),
      failedCount: document.getElementById('failed-count'),
      
      // Efficiency elements
      efficiencyDisplay: document.getElementById('efficiency-display'),
      efficiencyPercentage: document.getElementById('efficiency-percentage'),
      efficiencyStatus: document.getElementById('efficiency-status'),
      
      // Section elements for background changes
      actionSection: document.getElementById('action-section'),
      logSection: document.getElementById('log-section'),
      statsSection: document.getElementById('stats-section'),
      efficiencySection: document.getElementById('efficiency-section'),
      
      // Dashboard elements (for dashboard page)
      raindrop: document.getElementById('raindrop'),
      notion: document.getElementById('notion'),
      indicator: document.getElementById('indicator')
    };

    // Log which elements were found
    const foundElements = Object.keys(this.elements).filter(k => this.elements[k]);
    const missingElements = Object.keys(this.elements).filter(k => !this.elements[k]);
    
    console.log('✅ Found elements:', foundElements);
    if (missingElements.length > 0) {
      console.log('⚠️ Missing elements:', missingElements);
    }
  }

  bindEvents() {
    // Bind sync button
    if (this.elements.startBtn) {
      this.elements.startBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('🎯 Sync button clicked!');
        this.startSync();
      });
      console.log('✅ Sync button bound successfully');
    } else {
      console.error('❌ Sync button (#syncBtn) not found!');
      // Try alternative selectors
      const altBtn = document.querySelector('button[id*="sync"]') || document.querySelector('.section-action-button');
      if (altBtn) {
        console.log('🔄 Found alternative sync button:', altBtn);
        altBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.startSync();
        });
      }
    }

    // Page cleanup events
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });

    // Network status events
    window.addEventListener('online', () => {
      if (this.syncInProgress && !this.evtSource) {
        this.showStatus('🌐 Connection restored, attempting to reconnect...', 'info');
        this.reconnect();
      }
    });

    window.addEventListener('offline', () => {
      if (this.syncInProgress) {
        this.showStatus('🌐 Connection lost - sync will continue when online', 'warning');
      }
    });

    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.evtSource) {
        console.log('📱 Page hidden, keeping connection alive');
      } else if (!document.hidden && this.syncInProgress && !this.evtSource) {
        console.log('📱 Page visible again, checking connection');
        this.reconnect();
      }
    });
  }

  startSync() {
    console.log('🚀 Starting sync process...');
    
    if (this.syncInProgress) {
      this.showStatus('⚠️ Sync already in progress', 'warning');
      return;
    }

    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';
    const daysBack = urlParams.get('daysBack') || '30';
    const deleteOrphaned = urlParams.get('deleteOrphaned') === 'true';

    console.log('📋 Sync parameters:', { password: password ? '[PRESENT]' : '[MISSING]', mode, daysBack, deleteOrphaned });

    if (!password) {
      this.showStatus('❌ Password required for sync', 'error');
      console.error('❌ No password found in URL parameters');
      return;
    }

    // Reset state
    this.resetStats();
    this.connectionRetries = 0;

    // Update UI immediately
    this.updateSyncUI(true);
    
    // Build sync URL
    const syncUrl = new URL('/sync-stream', window.location.origin);
    syncUrl.searchParams.set('password', password);
    syncUrl.searchParams.set('mode', mode);
    syncUrl.searchParams.set('daysBack', daysBack);
    syncUrl.searchParams.set('deleteOrphaned', deleteOrphaned);
    
    // Cache busting
    syncUrl.searchParams.set('_t', Date.now().toString());

    console.log('🔗 Connecting to:', syncUrl.toString());

    // Show initial status
    this.showStatus('🚀 Initializing sync connection...', 'info');
    
    // Start connection
    this.connectToSyncStream(syncUrl.toString());
  }

  connectToSyncStream(url) {
    console.log('🔌 Creating STABLE EventSource connection to:', url);
    
    try {
      // Clean up any existing connection
      this.cleanup();
      
      this.evtSource = new EventSource(url);
      
      // Set up connection timeout (separate from heartbeat)
      this.connectionTimeout = setTimeout(() => {
        console.log('⏰ Connection timeout - but sync may still be running on server');
        this.showStatus('⏰ Connection timeout - sync continues on server', 'warning');
        // Don't restart sync on timeout - just show status
      }, 30000);
      
      this.evtSource.onopen = (event) => {
        console.log('✅ EventSource connection opened', event);
        this.showStatus('🔗 Connected to sync stream', 'success');
        this.connectionRetries = 0; // Reset retry counter on successful connection
        
        // Clear connection timeout on successful open
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
      };

      this.evtSource.onmessage = (event) => {
        try {
          console.log('📨 Raw message received:', event.data);
          const data = JSON.parse(event.data);
          console.log('📦 Parsed message:', data);
          
          this.handleSyncMessage(data);
        } catch (error) {
          console.error('❌ Error parsing sync message:', error, 'Raw data:', event.data);
          this.showStatus('❌ Error parsing sync data', 'error');
        }
      };

      this.evtSource.onerror = (error) => {
        console.error('❌ EventSource error:', error);
        console.log('EventSource readyState:', this.evtSource?.readyState);
        
        // Clear connection timeout
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
        
        if (!navigator.onLine) {
          this.showStatus('🌐 No internet connection - sync may continue on server', 'warning');
          return;
        }
        
        // Handle different error scenarios
        if (this.evtSource?.readyState === EventSource.CLOSED) {
          // Connection closed - this might be normal completion
          this.showStatus('🔌 Connection closed - checking if sync completed...', 'info');
          
          // Don't automatically reconnect - sync might have completed normally
          // Wait a moment to see if we get completion status
          setTimeout(() => {
            if (this.syncInProgress && this.connectionRetries < this.maxRetries) {
              this.showStatus('🔄 Attempting to reconnect to check sync status...', 'info');
              this.handleConnectionError('Connection closed, reconnecting to check status');
            }
          }, 3000);
          
        } else if (this.evtSource?.readyState === EventSource.CONNECTING) {
          this.showStatus('🔄 Reconnecting to sync stream...', 'info');
        } else {
          this.handleConnectionError('Connection error occurred');
        }
      };

    } catch (error) {
      console.error('❌ Failed to create EventSource:', error);
      this.handleSyncError('Failed to establish sync connection');
    }
  }

  handleConnectionError(errorMessage) {
    console.error('🔌 Connection error:', errorMessage);
    
    // CRITICAL: Don't restart sync, just try to reconnect for status updates
    if (this.connectionRetries < this.maxRetries && this.syncInProgress) {
      this.connectionRetries++;
      const delay = Math.min(2000 * this.connectionRetries, 10000); // Progressive delay
      
      this.showStatus(`🔄 Connection lost, reconnecting in ${delay/1000}s to check status... (${this.connectionRetries}/${this.maxRetries})`, 'warning');
      
      setTimeout(() => {
        if (this.syncInProgress) {
          this.reconnect();
        }
      }, delay);
    } else {
      // Max retries reached or sync not in progress
      if (this.connectionRetries >= this.maxRetries) {
        this.showStatus('🔌 Connection lost - sync may still be running on server', 'warning');
        this.showStatus('↻ Refresh page to check if sync completed', 'info');
      }
      
      // Don't call handleSyncError - that would show "failed" when sync might be succeeding
      this.updateSyncUI(false);
    }
  }

  reconnect() {
    if (!this.syncInProgress) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';
    const daysBack = urlParams.get('daysBack') || '30';
    const deleteOrphaned = urlParams.get('deleteOrphaned') === 'true';
    
    const syncUrl = new URL('/sync-stream', window.location.origin);
    syncUrl.searchParams.set('password', password);
    syncUrl.searchParams.set('mode', mode);
    syncUrl.searchParams.set('daysBack', daysBack);
    syncUrl.searchParams.set('deleteOrphaned', deleteOrphaned);
    syncUrl.searchParams.set('reconnect', 'true'); // Flag for server
    syncUrl.searchParams.set('_t', Date.now().toString());
    
    console.log('🔄 Reconnecting to check sync status...');
    this.connectToSyncStream(syncUrl.toString());
  }

  handleSyncMessage(data) {
    const { message, type, counts, complete, finalCounts, progress, efficiency, connected, error } = data;

    console.log('🔄 Processing sync message:', { type, message: message?.substring(0, 50) + '...', progress, complete });

    // Handle heartbeat messages
    if (type === 'heartbeat') {
      console.log('💓 Heartbeat received');
      return;
    }

    // Handle connection confirmation
    if (connected) {
      console.log('🔗 Connection confirmed');
      return;
    }

    // Update progress bar and text
    if (progress !== undefined) {
      if (this.elements.progressFill) {
        this.elements.progressFill.style.width = `${progress}%`;
      }
      if (this.elements.progressText) {
        this.elements.progressText.textContent = `Progress: ${progress}% complete`;
      }
    }

    // Update stats if available
    if (counts) {
      this.updateStats(counts);
    }

    // Show status message - THIS IS THE KEY LOG FUNCTION
    if (message) {
      this.showStatus(message, type || 'info');
    }

    // Update efficiency display
    if (efficiency) {
      this.updateEfficiencyDisplay(efficiency);
    }

    // Handle completion
    if (complete) {
      console.log('🎉 Sync completed!', finalCounts);
      this.handleSyncComplete(finalCounts, data.mode);
    }

    // Handle errors
    if (error) {
      this.handleSyncError(message || 'Sync error occurred');
    }
  }

  handleSyncComplete(finalCounts, mode) {
    setTimeout(() => {
      this.cleanup();
      this.updateSyncUI(false);
      
      // Update action section to show completion
      if (this.elements.actionSection) {
        this.elements.actionSection.classList.remove('bg-yellow', 'bg-red');
        this.elements.actionSection.classList.add('bg-green');
        
        const actionContent = this.elements.actionSection.querySelector('.section-content');
        if (actionContent) {
          actionContent.innerHTML = '<span class="text-huge text-white">✅ Sync Complete!</span>';
        }
      }
      
      // Show final completion message
      if (finalCounts) {
        this.updateStats(finalCounts);
        
        let message = '🎉 Sync completed successfully! ';
        
        if (mode === 'reset') {
          message += `Created: ${finalCounts.created || finalCounts.added}, Deleted: ${finalCounts.deleted}`;
        } else {
          message += `Added: ${finalCounts.added}, Updated: ${finalCounts.updated}, Failed: ${finalCounts.failed || 0}`;
        }
        
        this.showStatus(message, 'complete');
        
        // Emit completion event
        Utils.events.emit('syncCompleted', finalCounts);
      } else {
        this.showStatus('🎉 Sync completed successfully!', 'complete');
      }
      
    }, 500);
  }

  handleSyncError(errorMessage) {
    console.error('❌ Sync error:', errorMessage);
    
    this.cleanup();
    this.updateSyncUI(false);
    
    // Update action section to show error
    if (this.elements.actionSection) {
      this.elements.actionSection.classList.remove('bg-yellow', 'bg-green');
      this.elements.actionSection.classList.add('bg-red');
      
      const actionContent = this.elements.actionSection.querySelector('.section-content');
      if (actionContent) {
        actionContent.innerHTML = '<span class="text-huge text-white">❌ Sync Failed</span>';
      }
    }
    
    this.showStatus(`❌ ${errorMessage}`, 'error');
    
    // Emit error event
    Utils.events.emit('syncError', { message: errorMessage });
  }

  cleanup() {
    console.log('🧹 Cleaning up connections and timers');
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    
    if (this.evtSource) {
      console.log('🔌 Closing EventSource connection');
      this.evtSource.close();
      this.evtSource = null;
    }
    
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    this.syncInProgress = false;
    this.connectionRetries = 0;
  }

  updateSyncUI(inProgress) {
    this.syncInProgress = inProgress;
    
    if (inProgress) {
      console.log('🔄 Updating UI for sync start');
      
      if (this.elements.startBtn) {
        this.elements.startBtn.disabled = true;
        this.elements.startBtn.textContent = 'Sync Running...';
        this.elements.startBtn.classList.add('running');
      }
      
      // Show status log area
      if (this.elements.status) {
        this.elements.status.style.display = 'block';
        console.log('✅ Status log area shown');
      }
      
      // Show stats section
      if (this.elements.syncStats) {
        this.elements.syncStats.style.display = 'block';
        console.log('✅ Stats section shown');
      }
      
      // Show efficiency section
      if (this.elements.efficiencyDisplay) {
        this.elements.efficiencyDisplay.style.display = 'block';
        console.log('✅ Efficiency section shown');
      }
      
    } else {
      console.log('🔄 Updating UI for sync end');
      
      if (this.elements.startBtn) {
        this.elements.startBtn.disabled = false;
        this.elements.startBtn.textContent = this.getOriginalButtonText();
        this.elements.startBtn.classList.remove('running');
      }
    }
  }

  getOriginalButtonText() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode') || 'smart';
    
    switch (mode) {
      case 'reset': return 'Start Reset & Full Sync';
      case 'incremental': return 'Start Incremental Sync';
      case 'smart': 
      default: return 'Start Smart Sync';
    }
  }

  // 🎯 MAIN LOG FUNCTION - ENHANCED WITH BETTER STYLING
  showStatus(message, type = 'info') {
    console.log(`📝 Showing status: [${type}] ${message}`);
    
    if (!this.elements.status) {
      console.warn('⚠️ Status element (#status) not found, logging to console only');
      console.log(`Status: ${message} (${type})`);
      return;
    }

    // Ensure status container is visible
    this.elements.status.style.display = 'block';

    // Create styled status message
    const statusElement = document.createElement('div');
    statusElement.className = `sync-update ${type}`;
    
    // Enhanced styling based on message type
    const styles = {
      info: { borderLeft: '4px solid #3b82f6', background: '#eff6ff', color: '#1e40af' },
      success: { borderLeft: '4px solid #22c55e', background: '#f0fdf4', color: '#15803d' },
      added: { borderLeft: '4px solid #22c55e', background: '#f0fdf4', color: '#15803d' },
      updated: { borderLeft: '4px solid #f59e0b', background: '#fffbeb', color: '#d97706' },
      deleted: { borderLeft: '4px solid #ef4444', background: '#fef2f2', color: '#dc2626' },
      failed: { borderLeft: '4px solid #ef4444', background: '#fef2f2', color: '#dc2626' },
      error: { borderLeft: '4px solid #ef4444', background: '#fef2f2', color: '#dc2626' },
      warning: { borderLeft: '4px solid #f59e0b', background: '#fffbeb', color: '#d97706' },
      complete: { borderLeft: '4px solid #22c55e', background: '#f0fdf4', color: '#15803d', fontWeight: '600' },
      analysis: { borderLeft: '4px solid #8b5cf6', background: '#f3e8ff', color: '#7c3aed', fontWeight: '500' },
      processing: { borderLeft: '4px solid #8b5cf6', background: '#f3e8ff', color: '#7c3aed' },
      fetching: { borderLeft: '4px solid #06b6d4', background: '#ecfeff', color: '#0891b2' },
      summary: { borderLeft: '4px solid #10b981', background: '#ecfdf5', color: '#047857', fontWeight: '600' }
    };
    
    const style = styles[type] || styles.info;
    Object.assign(statusElement.style, {
      padding: '12px 16px',
      margin: '6px 0',
      borderRadius: '6px',
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
      fontSize: '14px',
      lineHeight: '1.5',
      wordBreak: 'break-word',
      transition: 'all 0.2s ease',
      ...style
    });
    
    // Add message content with timestamp
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    statusElement.textContent = `[${timestamp}] ${message}`;
    
    // Add to status container with smooth animation
    this.elements.status.appendChild(statusElement);
    
    // Auto-scroll to bottom for real-time feel
    this.elements.status.scrollTop = this.elements.status.scrollHeight;
    
    // Limit messages for performance (keep last 100)
    const messages = this.elements.status.children;
    if (messages.length > 100) {
      this.elements.status.removeChild(messages[0]);
    }
    
    console.log('✅ Status message added to DOM');
  }

  updateStats(counts) {
    this.stats = { ...this.stats, ...counts };
    
    console.log('📊 Updating stats:', counts);
    
    // Update individual stat counters with animation
    if (this.elements.addedCount && counts.added !== undefined) {
      this.animateCounter(this.elements.addedCount, counts.added);
    }
    if (this.elements.updatedCount && counts.updated !== undefined) {
      this.animateCounter(this.elements.updatedCount, counts.updated);
    }
    if (this.elements.deletedCount && counts.deleted !== undefined) {
      this.animateCounter(this.elements.deletedCount, counts.deleted);
    }
    if (this.elements.failedCount && counts.failed !== undefined) {
      this.animateCounter(this.elements.failedCount, counts.failed);
    }
  }

  animateCounter(element, newValue) {
    const currentValue = parseInt(element.textContent) || 0;
    if (currentValue === newValue) return;
    
    // Simple counter animation
    const duration = 500;
    const steps = 20;
    const increment = (newValue - currentValue) / steps;
    let current = currentValue;
    let step = 0;
    
    const timer = setInterval(() => {
      step++;
      current += increment;
      
      if (step >= steps) {
        element.textContent = newValue;
        clearInterval(timer);
      } else {
        element.textContent = Math.round(current);
      }
    }, duration / steps);
  }

  updateEfficiencyDisplay(efficiency) {
    console.log('⚡ Updating efficiency:', efficiency);
    
    if (this.elements.efficiencyPercentage && efficiency.percentage !== undefined) {
      this.elements.efficiencyPercentage.textContent = efficiency.percentage;
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
    this.stats = { added: 0, updated: 0, deleted: 0, skipped: 0, failed: 0 };
    this.updateStats(this.stats);
  }

  // Public API
  stopSync() {
    if (this.evtSource) {
      this.cleanup();
      this.showStatus('⏹️ Sync stopped by user', 'warning');
      this.updateSyncUI(false);
    }
  }

  isRunning() {
    return this.syncInProgress;
  }

  getDebugInfo() {
    return {
      syncInProgress: this.syncInProgress,
      hasEventSource: !!this.evtSource,
      eventSourceState: this.evtSource?.readyState,
      connectionRetries: this.connectionRetries,
      elements: Object.keys(this.elements).reduce((acc, key) => {
        acc[key] = !!this.elements[key];
        return acc;
      }, {}),
      currentUrl: window.location.href,
      urlParams: Object.fromEntries(new URLSearchParams(window.location.search))
    };
  }

  // Connection health check
  checkConnection() {
    if (!this.evtSource) return 'disconnected';
    
    switch (this.evtSource.readyState) {
      case EventSource.CONNECTING: return 'connecting';
      case EventSource.OPEN: return 'connected';
      case EventSource.CLOSED: return 'closed';
      default: return 'unknown';
    }
  }
}

// Dashboard manager for count updates
class DashboardManager {
  constructor() {
    this.elements = {};
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.setupElements();
      this.setupEventListeners();
    });
  }

  setupElements() {
    this.elements = {
      raindropCount: document.getElementById('raindrop'),
      notionCount: document.getElementById('notion'),
      indicator: document.getElementById('indicator')
    };
  }

  setupEventListeners() {
    Utils.events.on('syncCompleted', () => {
      console.log('🔄 Sync completed, refreshing dashboard counts');
      setTimeout(() => this.refreshCounts(), 2000);
    });
  }

  async refreshCounts() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const password = urlParams.get('password');
      if (!password) return;

      const response = await Utils.api.get(`/api/counts?password=${encodeURIComponent(password)}`);
      
      if (this.elements.raindropCount) {
        this.elements.raindropCount.textContent = `${response.raindropTotal} Raindrop Bookmarks`;
      }
      
      if (this.elements.notionCount) {
        this.elements.notionCount.textContent = `${response.notionTotal} Notion Pages`;
      }
      
      if (this.elements.indicator) {
        if (response.isSynced) {
          this.elements.indicator.classList.add('synced');
          this.elements.indicator.classList.remove('not-synced');
        } else {
          this.elements.indicator.classList.remove('synced');
          this.elements.indicator.classList.add('not-synced');
        }
      }
      
      console.log('✅ Dashboard counts refreshed');
      
    } catch (error) {
      console.error('❌ Failed to refresh counts:', error);
    }
  }
}

// Initialize everything
Utils.ready(() => {
  console.log('🚀 Initializing enhanced sync management system...');
  
  // Initialize sync manager if sync button exists
  if (document.getElementById('syncBtn')) {
    window.syncManager = new SyncManager();
    console.log('✅ Enhanced SyncManager initialized');
  } else {
    console.log('ℹ️ No sync button found, skipping SyncManager');
  }
  
  // Initialize dashboard manager if dashboard elements exist
  if (document.getElementById('raindrop') || document.getElementById('notion')) {
    window.dashboardManager = new DashboardManager();
    console.log('✅ DashboardManager initialized');
  }
  
  // Add debug helpers
  window.syncDebug = () => {
    if (window.syncManager) {
      console.log('🐛 Enhanced Sync Debug Info:', window.syncManager.getDebugInfo());
      console.log('🔌 Connection Status:', window.syncManager.checkConnection());
    } else {
      console.log('❌ No sync manager found');
    }
  };
  
  window.syncStop = () => {
    if (window.syncManager) {
      window.syncManager.stopSync();
    }
  };
  
  console.log('🎉 Enhanced sync management system ready!');
  console.log('💡 Use syncDebug() and syncStop() in console for debugging');
});
/**
 * Enhanced Sync Management - Exact Match to Your 8-Section Layout
 * Verified against your actual HTML structure
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
      console.log('🚀 SyncManager initialized');
    });
  }

  setupElements() {
    // Cache DOM elements - EXACT IDs from your sync.hbs
    this.elements = {
      // Main sync button - from your sync.hbs: id="syncBtn"
      startBtn: document.getElementById('syncBtn'),
      
      // Status/log area - from your sync.hbs: id="status"
      status: document.getElementById('status'),
      
      // Progress elements - from your sync.hbs
      progressText: document.getElementById('progress-text'),
      progressFill: document.getElementById('progress-fill'),
      
      // Stats elements - from your sync.hbs
      syncStats: document.getElementById('sync-stats'),
      addedCount: document.getElementById('added-count'),
      updatedCount: document.getElementById('updated-count'),
      deletedCount: document.getElementById('deleted-count'),
      failedCount: document.getElementById('failed-count'),
      
      // Efficiency elements - from your sync.hbs
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
    // Bind sync button - this should work now
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
      if (this.evtSource) {
        this.evtSource.close();
      }
    });

    // Network status events
    window.addEventListener('online', () => {
      if (this.syncInProgress && !this.evtSource) {
        this.showStatus('🌐 Connection restored, attempting to reconnect...', 'info');
      }
    });

    window.addEventListener('offline', () => {
      if (this.syncInProgress) {
        this.showStatus('🌐 Connection lost - sync will continue when online', 'warning');
      }
    });
  }

  startSync() {
    console.log('🚀 Starting sync process...');
    
    if (this.syncInProgress) {
      this.showStatus('⚠️ Sync already in progress', 'warning');
      return;
    }

    // Get URL parameters - EXACT parameter names from your code
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

    // Reset stats
    this.resetStats();

    // Update UI immediately
    this.updateSyncUI(true);
    
    // Build sync URL - EXACT endpoint from your api/index.js
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
    
    // Start connection with small delay
    setTimeout(() => {
      this.connectToSyncStream(syncUrl.toString());
    }, 100);
  }

  connectToSyncStream(url) {
    console.log('🔌 Creating EventSource connection to:', url);
    
    try {
      this.evtSource = new EventSource(url);
      
      this.evtSource.onopen = (event) => {
        console.log('✅ EventSource connection opened', event);
        this.showStatus('🔗 Connected to sync stream', 'success');
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
        
        if (!navigator.onLine) {
          this.showStatus('🌐 No internet connection - waiting...', 'warning');
          return;
        }
        
        if (this.evtSource?.readyState === EventSource.CLOSED) {
          this.handleSyncError('Connection closed unexpectedly');
        } else {
          this.handleSyncError('Connection error occurred');
        }
      };

    } catch (error) {
      console.error('❌ Failed to create EventSource:', error);
      this.handleSyncError('Failed to establish sync connection');
    }
  }

  handleSyncMessage(data) {
    const { message, type, counts, complete, finalCounts, progress, efficiency } = data;

    console.log('🔄 Processing sync message:', { type, message: message?.substring(0, 50) + '...', progress, complete });

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
  }

  handleSyncComplete(finalCounts, mode) {
    setTimeout(() => {
      this.cleanupConnection();
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
        
        const total = finalCounts.added + finalCounts.updated + finalCounts.deleted;
        let message = '🎉 Sync completed successfully! ';
        
        if (mode === 'reset') {
          message += `Created: ${finalCounts.added}, Deleted: ${finalCounts.deleted}`;
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
    
    this.cleanupConnection();
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

  cleanupConnection() {
    if (this.evtSource) {
      console.log('🧹 Cleaning up EventSource connection');
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

  // 🎯 THIS IS THE MAIN LOG FUNCTION - VERIFIED TO WORK
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
    
    // Styling based on message type
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
      analysis: { borderLeft: '4px solid #8b5cf6', background: '#f3e8ff', color: '#7c3aed', fontWeight: '500' }
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
      ...style
    });
    
    // Add message content with timestamp
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    statusElement.textContent = `[${timestamp}] ${message}`;
    
    // Add to status container
    this.elements.status.appendChild(statusElement);
    
    // Auto-scroll to bottom for real-time feel
    this.elements.status.scrollTop = this.elements.status.scrollHeight;
    
    // Limit messages for performance (keep last 50)
    const messages = this.elements.status.children;
    if (messages.length > 50) {
      this.elements.status.removeChild(messages[0]);
    }
    
    console.log('✅ Status message added to DOM');
  }

  updateStats(counts) {
    this.stats = { ...this.stats, ...counts };
    
    console.log('📊 Updating stats:', counts);
    
    // Update individual stat counters
    if (this.elements.addedCount && counts.added !== undefined) {
      this.elements.addedCount.textContent = counts.added;
    }
    if (this.elements.updatedCount && counts.updated !== undefined) {
      this.elements.updatedCount.textContent = counts.updated;
    }
    if (this.elements.deletedCount && counts.deleted !== undefined) {
      this.elements.deletedCount.textContent = counts.deleted;
    }
    if (this.elements.failedCount && counts.failed !== undefined) {
      this.elements.failedCount.textContent = counts.failed;
    }
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
      this.cleanupConnection();
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
      elements: Object.keys(this.elements).reduce((acc, key) => {
        acc[key] = !!this.elements[key];
        return acc;
      }, {}),
      currentUrl: window.location.href,
      urlParams: Object.fromEntries(new URLSearchParams(window.location.search))
    };
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
  console.log('🚀 Initializing sync management system...');
  
  // Initialize sync manager if sync button exists
  if (document.getElementById('syncBtn')) {
    window.syncManager = new SyncManager();
    console.log('✅ SyncManager initialized');
  } else {
    console.log('ℹ️ No sync button found, skipping SyncManager');
  }
  
  // Initialize dashboard manager if dashboard elements exist
  if (document.getElementById('raindrop') || document.getElementById('notion')) {
    window.dashboardManager = new DashboardManager();
    console.log('✅ DashboardManager initialized');
  }
  
  // Add debug helper
  window.syncDebug = () => {
    if (window.syncManager) {
      console.log('🐛 Sync Debug Info:', window.syncManager.getDebugInfo());
    } else {
      console.log('❌ No sync manager found');
    }
  };
  
  console.log('🎉 Sync management system ready!');
  console.log('💡 Use syncDebug() in console for debugging info');
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SyncManager, DashboardManager };
}
/**
 * Multi-Sync Prevention System
 * Prevents multiple syncs from running simultaneously
 */

class SyncPrevention {
  constructor() {
    this.STORAGE_KEY = 'sync_state';
    this.MAX_SYNC_TIME = 15 * 60 * 1000; // 15 minutes max sync time
    this.CLEANUP_INTERVAL = 30 * 1000; // Check every 30 seconds
    
    this.init();
  }

  init() {
    // Clean up old sync states on page load
    this.cleanupOldStates();
    
    // Set up periodic cleanup
    this.startCleanupInterval();
    
    // Handle page visibility changes
    this.handleVisibilityChange();
    
    // Handle beforeunload to clean up properly
    this.handlePageUnload();
  }

  // Check if sync can start
  canStartSync() {
    const syncState = this.getSyncState();
    
    // No sync running
    if (!syncState) {
      return true;
    }
    
    // Check if sync is too old (stuck)
    const now = Date.now();
    const syncAge = now - syncState.startTime;
    
    if (syncAge > this.MAX_SYNC_TIME) {
      Utils.log.warn('Sync appears stuck, clearing old state');
      this.clearSyncState();
      return true;
    }
    
    // Sync is currently running
    Utils.log.info('Sync already in progress, preventing duplicate');
    return false;
  }

  // Set sync as in progress
  setSyncInProgress(inProgress, syncId = null) {
    if (inProgress) {
      const syncState = {
        inProgress: true,
        startTime: Date.now(),
        syncId: syncId || this.generateSyncId(),
        tabId: this.getTabId(),
        userAgent: navigator.userAgent,
        url: window.location.href
      };
      
      Utils.storage.set(this.STORAGE_KEY, syncState);
      Utils.log.info('Sync state set to in progress:', syncState.syncId);
      
      // Emit event for other components
      Utils.events.emit('syncStateChanged', { inProgress: true, syncState });
    } else {
      const syncState = this.getSyncState();
      Utils.storage.remove(this.STORAGE_KEY);
      Utils.log.info('Sync state cleared');
      
      // Emit event for other components
      Utils.events.emit('syncStateChanged', { inProgress: false, syncState });
    }
  }

  // Check if sync is currently in progress
  isSyncInProgress() {
    const syncState = this.getSyncState();
    
    if (!syncState) {
      return false;
    }
    
    // Check age to handle stuck syncs
    const now = Date.now();
    const syncAge = now - syncState.startTime;
    
    if (syncAge > this.MAX_SYNC_TIME) {
      Utils.log.warn('Sync appears stuck, auto-clearing');
      this.clearSyncState();
      return false;
    }
    
    return syncState.inProgress;
  }

  // Get current sync state
  getSyncState() {
    return Utils.storage.get(this.STORAGE_KEY);
  }

  // Clear sync state
  clearSyncState() {
    Utils.storage.remove(this.STORAGE_KEY);
    Utils.log.info('Sync state manually cleared');
    Utils.events.emit('syncStateChanged', { inProgress: false, cleared: true });
  }

  // Generate unique sync ID
  generateSyncId() {
    return `sync_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // Generate unique tab ID
  getTabId() {
    let tabId = Utils.storage.get('tab_id');
    if (!tabId) {
      tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      Utils.storage.set('tab_id', tabId);
    }
    return tabId;
  }

  // Clean up old/stuck sync states
  cleanupOldStates() {
    const syncState = this.getSyncState();
    
    if (!syncState) {
      return;
    }
    
    const now = Date.now();
    const syncAge = now - syncState.startTime;
    
    // Clear if too old
    if (syncAge > this.MAX_SYNC_TIME) {
      Utils.log.warn(`Cleaning up old sync state (${Utils.time.formatDuration(syncAge)} old)`);
      this.clearSyncState();
    }
  }

  // Start periodic cleanup
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupOldStates();
    }, this.CLEANUP_INTERVAL);
  }

  // Handle page visibility changes
  handleVisibilityChange() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Page became visible, check for stuck syncs
        this.cleanupOldStates();
      }
    });
  }

  // Handle page unload
  handlePageUnload() {
    window.addEventListener('beforeunload', () => {
      // Don't clear sync state on unload - sync might still be running
      // Let the cleanup interval handle it
    });
  }

  // Force clear (for admin use)
  forceClear() {
    this.clearSyncState();
    Utils.log.info('Sync state force cleared');
  }

  // Get sync status info
  getStatusInfo() {
    const syncState = this.getSyncState();
    
    if (!syncState) {
      return {
        inProgress: false,
        message: 'No sync running'
      };
    }
    
    const now = Date.now();
    const duration = now - syncState.startTime;
    const remaining = Math.max(0, this.MAX_SYNC_TIME - duration);
    
    return {
      inProgress: true,
      syncId: syncState.syncId,
      duration: Utils.time.formatDuration(duration),
      remaining: Utils.time.formatDuration(remaining),
      startTime: new Date(syncState.startTime).toLocaleString(),
      tabId: syncState.tabId,
      message: `Sync running for ${Utils.time.formatDuration(duration)}`
    };
  }

  // Debug info
  getDebugInfo() {
    const syncState = this.getSyncState();
    const statusInfo = this.getStatusInfo();
    
    return {
      syncState,
      statusInfo,
      canStart: this.canStartSync(),
      tabId: this.getTabId(),
      maxSyncTime: this.MAX_SYNC_TIME,
      cleanupInterval: this.CLEANUP_INTERVAL
    };
  }
}

// Button prevention utility
class ButtonPrevention {
  constructor(button, options = {}) {
    this.button = button;
    this.originalText = button.textContent;
    this.options = {
      disabledText: 'Running...',
      disabledClass: 'disabled',
      preventMultiClick: true,
      clickDelay: 1000,
      ...options
    };
    
    this.isDisabled = false;
    this.lastClickTime = 0;
    
    this.init();
  }

  init() {
    if (!this.button) return;
    
    // Add click prevention
    this.button.addEventListener('click', (e) => this.handleClick(e), true);
  }

  handleClick(e) {
    const now = Date.now();
    
    // Prevent if disabled
    if (this.isDisabled) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    // Prevent rapid clicking
    if (this.options.preventMultiClick && 
        now - this.lastClickTime < this.options.clickDelay) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    
    this.lastClickTime = now;
    return true;
  }

  disable() {
    if (!this.button) return;
    
    this.isDisabled = true;
    this.button.disabled = true;
    this.button.textContent = this.options.disabledText;
    
    if (this.options.disabledClass) {
      this.button.classList.add(this.options.disabledClass);
    }
  }

  enable() {
    if (!this.button) return;
    
    this.isDisabled = false;
    this.button.disabled = false;
    this.button.textContent = this.originalText;
    
    if (this.options.disabledClass) {
      this.button.classList.remove(this.options.disabledClass);
    }
  }

  isButtonDisabled() {
    return this.isDisabled;
  }
}

// Make classes globally available
if (typeof window !== 'undefined') {
  window.SyncPrevention = SyncPrevention;
  window.ButtonPrevention = ButtonPrevention;
}

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SyncPrevention, ButtonPrevention };
}
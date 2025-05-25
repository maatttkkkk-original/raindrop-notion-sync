/**
 * Dashboard JavaScript
 * Handles dashboard functionality, count loading, and state management
 */

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
    // Cache DOM elements
    this.elements = {
      raindropCount: document.getElementById('raindropCount'),
      notionCount: document.getElementById('notionCount'),
      syncStatus: document.getElementById('syncStatus'),
      syncStatusIcon: document.getElementById('syncStatusIcon'),
      syncStatusText: document.getElementById('syncStatusText'),
      raindropCard: document.querySelector('[data-card="raindrop"]'),
      notionCard: document.querySelector('[data-card="notion"]'),
      loadingSpinner: document.querySelector('.loading-spinner')
    };
  }

  setupEventListeners() {
    // Listen for sync completion events
    Utils.events.on('syncCompleted', () => {
      Utils.log.info('Sync completed, refreshing counts');
      this.invalidateCache();
      setTimeout(() => this.loadCounts(), 2000); // Small delay for data propagation
    });

    // Listen for sync state changes
    Utils.events.on('syncStateChanged', (event) => {
      this.updateSyncStatus(event.detail);
    });

    // Handle window focus to refresh stale data
    window.addEventListener('focus', () => {
      if (this.isCacheStale()) {
        Utils.log.info('Window focused and cache is stale, refreshing');
        this.loadCounts();
      }
    });

    // Handle page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isCacheStale()) {
        Utils.log.info('Page visible and cache is stale, refreshing');
        this.loadCounts();
      }
    });
  }

  async loadCounts() {
    try {
      // Show loading state
      this.setLoadingState(true);
      
      // Check cache first
      if (this.countCache && !this.isCacheStale()) {
        Utils.log.info('Using cached counts');
        this.updateCountsDisplay(this.countCache);
        this.setLoadingState(false);
        return;
      }

      // Get password from URL
      const password = Utils.getParam('password');
      if (!password) {
        throw new Error('Password required');
      }

      // Fetch fresh counts
      Utils.log.info('Fetching fresh counts from API');
      const response = await Utils.api.get(`/api/counts?password=${encodeURIComponent(password)}`);
      
      // Update cache
      this.countCache = response;
      this.lastUpdate = Date.now();
      
      // Update display
      this.updateCountsDisplay(response);
      
      Utils.log.info('Counts updated successfully', response);
      
    } catch (error) {
      Utils.log.error('Failed to load counts:', error);
      this.handleCountsError(error);
    } finally {
      this.setLoadingState(false);
    }
  }

  updateCountsDisplay(data) {
    try {
      // Update counts
      Utils.ui.setText(this.elements.raindropCount, Utils.formatNumber(data.raindropTotal || 0));
      Utils.ui.setText(this.elements.notionCount, Utils.formatNumber(data.notionTotal || 0));
      
      // Calculate sync status
      const isSynced = this.calculateSyncStatus(data);
      
      // Update sync status
      this.updateSyncStatusDisplay(isSynced, data);
      
      // Update card states
      this.updateCardStates(isSynced, data);
      
      // Remove error states
      this.clearErrorStates();
      
    } catch (error) {
      Utils.log.error('Error updating counts display:', error);
      this.handleCountsError(error);
    }
  }

  calculateSyncStatus(data) {
    const raindropCount = data.raindropTotal || 0;
    const notionCount = data.notionTotal || 0;
    const difference = Math.abs(raindropCount - notionCount);
    
    // Consider synced if difference is small (accounting for potential timing differences)
    const threshold = 5; // Allow small differences
    return difference <= threshold;
  }

  updateSyncStatusDisplay(isSynced, data) {
    const statusElement = this.elements.syncStatus;
    const iconElement = this.elements.syncStatusIcon;
    const textElement = this.elements.syncStatusText;
    
    if (!statusElement) return;
    
    // Remove existing classes
    statusElement.classList.remove('synced', 'not-synced');
    
    if (isSynced) {
      statusElement.classList.add('synced');
      Utils.ui.setText(iconElement, '✅');
      Utils.ui.setText(textElement, 'All bookmarks are synchronized');
    } else {
      statusElement.classList.add('not-synced');
      Utils.ui.setText(iconElement, '⚠️');
      
      const difference = Math.abs((data.raindropTotal || 0) - (data.notionTotal || 0));
      Utils.ui.setText(textElement, `${Utils.formatNumber(difference)} bookmarks need synchronization`);
    }
  }

  updateCardStates(isSynced, data) {
    const raindropCard = this.elements.raindropCard;
    const notionCard = this.elements.notionCard;
    
    if (raindropCard) {
      raindropCard.classList.remove('synced', 'not-synced');
      raindropCard.classList.add(isSynced ? 'synced' : 'not-synced');
    }
    
    if (notionCard) {
      notionCard.classList.remove('synced', 'not-synced');
      notionCard.classList.add(isSynced ? 'synced' : 'not-synced');
    }
  }

  setLoadingState(loading) {
    const countElements = [this.elements.raindropCount, this.elements.notionCount];
    
    countElements.forEach(element => {
      if (element) {
        if (loading) {
          element.classList.add('loading');
          if (!element.textContent || element.textContent === '0') {
            element.textContent = '...';
          }
        } else {
          element.classList.remove('loading');
        }
      }
    });
    
    // Show/hide loading spinner if it exists
    if (this.elements.loadingSpinner) {
      if (loading) {
        Utils.ui.show(this.elements.loadingSpinner);
      } else {
        Utils.ui.hide(this.elements.loadingSpinner);
      }
    }
  }

  handleCountsError(error) {
    Utils.log.error('Dashboard error:', error);
    
    // Show error state
    Utils.ui.setText(this.elements.raindropCount, 'Error');
    Utils.ui.setText(this.elements.notionCount, 'Error');
    
    // Update sync status to show error
    const statusElement = this.elements.syncStatus;
    if (statusElement) {
      statusElement.classList.remove('synced', 'not-synced');
      statusElement.classList.add('error');
      Utils.ui.setText(this.elements.syncStatusIcon, '❌');
      Utils.ui.setText(this.elements.syncStatusText, 'Failed to load sync status');
    }
    
    // Add error state to cards
    [this.elements.raindropCard, this.elements.notionCard].forEach(card => {
      if (card) {
        card.classList.add('error');
      }
    });
  }

  clearErrorStates() {
    // Remove error classes
    [this.elements.raindropCard, this.elements.notionCard, this.elements.syncStatus].forEach(element => {
      if (element) {
        element.classList.remove('error');
      }
    });
  }

  updateSyncStatus(syncState) {
    // This method handles sync status updates from other components
    if (syncState.inProgress) {
      Utils.log.info('Sync in progress, updating status');
      // Could show "syncing" state here if desired
    } else if (syncState.cleared) {
      Utils.log.info('Sync cleared, refreshing counts');
      setTimeout(() => this.loadCounts(), 1000);
    }
  }

  invalidateCache() {
    this.countCache = null;
    this.lastUpdate = null;
    Utils.log.info('Count cache invalidated');
  }

  isCacheStale() {
    if (!this.lastUpdate || !this.countCache) {
      return true;
    }
    
    const age = Date.now() - this.lastUpdate;
    return age > this.cacheTimeout;
  }

  startPeriodicUpdates() {
    // Update counts every 5 minutes
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        Utils.log.info('Periodic count update');
        this.loadCounts();
      }
    }, this.cacheTimeout);
  }

  // Public methods for external control
  refreshCounts() {
    this.invalidateCache();
    return this.loadCounts();
  }

  getCachedCounts() {
    return this.countCache;
  }

  getLastUpdateTime() {
    return this.lastUpdate;
  }

  // Force refresh (for admin use)
  forceRefresh() {
    this.invalidateCache();
    this.loadCounts();
  }
}

// Initialize dashboard manager when script loads
Utils.ready(() => {
  if (typeof window !== 'undefined') {
    window.dashboardManager = new DashboardManager();
  }
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DashboardManager;
}
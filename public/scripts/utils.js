/**
 * Utility Functions
 * Shared utilities across the application
 */

// DOM utilities
const Utils = {
  // Wait for DOM to be ready
  ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  },

  // Get URL parameters
  getUrlParams() {
    return new URLSearchParams(window.location.search);
  },

  // Get specific URL parameter
  getParam(name, defaultValue = '') {
    const params = this.getUrlParams();
    return params.get(name) || defaultValue;
  },

  // Format numbers with commas
  formatNumber(num) {
    if (typeof num !== 'number') return '0';
    return num.toLocaleString();
  },

  // Debounce function calls
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function calls
  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Local storage helpers
  storage: {
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.warn('Failed to set localStorage:', error);
        return false;
      }
    },

    get(key, defaultValue = null) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (error) {
        console.warn('Failed to get localStorage:', error);
        return defaultValue;
      }
    },

    remove(key) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch (error) {
        console.warn('Failed to remove localStorage:', error);
        return false;
      }
    },

    clear() {
      try {
        localStorage.clear();
        return true;
      } catch (error) {
        console.warn('Failed to clear localStorage:', error);
        return false;
      }
    }
  },

  // Time utilities
  time: {
    // Format duration in milliseconds to human readable
    formatDuration(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);

      if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
      } else {
        return `${seconds}s`;
      }
    },

    // Get relative time string
    getRelativeTime(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
      if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      return 'Just now';
    }
  },

  // API helpers
  api: {
    async get(url, options = {}) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.error('API GET error:', error);
        throw error;
      }
    },

    async post(url, data = {}, options = {}) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          body: JSON.stringify(data),
          ...options
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.error('API POST error:', error);
        throw error;
      }
    }
  },

  // UI helpers
  ui: {
    // Show/hide elements
    show(element) {
      if (element) {
        element.style.display = '';
        element.removeAttribute('hidden');
      }
    },

    hide(element) {
      if (element) {
        element.style.display = 'none';
      }
    },

    toggle(element) {
      if (element) {
        if (element.style.display === 'none') {
          this.show(element);
        } else {
          this.hide(element);
        }
      }
    },

    // Add/remove classes safely
    addClass(element, className) {
      if (element && className) {
        element.classList.add(className);
      }
    },

    removeClass(element, className) {
      if (element && className) {
        element.classList.remove(className);
      }
    },

    toggleClass(element, className) {
      if (element && className) {
        element.classList.toggle(className);
      }
    },

    // Set text content safely
    setText(element, text) {
      if (element) {
        element.textContent = text || '';
      }
    },

    // Set HTML content safely
    setHTML(element, html) {
      if (element) {
        element.innerHTML = html || '';
      }
    }
  },

  // Validation helpers
  validate: {
    email(email) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(email);
    },

    url(url) {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },

    notEmpty(value) {
      return value !== null && value !== undefined && value.toString().trim() !== '';
    }
  },

  // Event helpers
  events: {
    // Custom event emitter
    emit(eventName, data = {}) {
      const event = new CustomEvent(eventName, { detail: data });
      document.dispatchEvent(event);
    },

    on(eventName, callback) {
      document.addEventListener(eventName, callback);
    },

    off(eventName, callback) {
      document.removeEventListener(eventName, callback);
    }
  },

  // Console logging with timestamp
  log: {
    info(...args) {
      console.log(`[${new Date().toISOString()}] INFO:`, ...args);
    },

    warn(...args) {
      console.warn(`[${new Date().toISOString()}] WARN:`, ...args);
    },

    error(...args) {
      console.error(`[${new Date().toISOString()}] ERROR:`, ...args);
    },

    debug(...args) {
      if (Utils.getParam('debug') === 'true') {
        console.log(`[${new Date().toISOString()}] DEBUG:`, ...args);
      }
    }
  },

  // Test state management for test pages
  testStates: {
    // Dashboard test states
    dashboard: {
      synced: {
        indicator: 'synced',
        raindropCount: '1365 Raindrop Bookmarks',
        raindropClass: 'synced',
        notionCount: '1365 Notion Pages',
        notionClass: 'synced',
        statusMessage: 'All bookmarks are synchronized',
        statusClass: 'synced',
        primaryAction: 'Sync New? ↻',
        secondaryAction: 'Reset / FullSync'
      },
      'not-synced': {
        indicator: 'not-synced',
        raindropCount: '1365 Raindrop Bookmarks',
        raindropClass: 'not-synced',
        notionCount: '65 Notion Pages',
        notionClass: 'not-synced',
        statusMessage: '1300 bookmarks need synchronization',
        statusClass: 'not-synced',
        primaryAction: 'Sync New? ↻',
        secondaryAction: 'Reset / FullSync'
      },
      processing: {
        indicator: 'processing',
        raindropCount: '1365 Raindrop Bookmarks',
        raindropClass: 'neutral',
        notionCount: '... Notion Pages',
        notionClass: 'neutral loading',
        statusMessage: 'Sync in progress...',
        statusClass: 'processing',
        primaryAction: 'Stop!',
        secondaryAction: 'Please Wait...'
      },
      error: {
        indicator: 'not-synced',
        raindropCount: 'Error loading counts',
        raindropClass: 'not-synced error',
        notionCount: 'Error loading counts',
        notionClass: 'not-synced error',
        statusMessage: 'Failed to load sync status',
        statusClass: 'not-synced',
        primaryAction: 'Retry ↻',
        secondaryAction: 'Back ↤'
      },
      loading: {
        indicator: 'processing',
        raindropCount: '... Raindrop Bookmarks',
        raindropClass: 'neutral loading',
        notionCount: '... Notion Pages',
        notionClass: 'neutral loading',
        statusMessage: 'Loading...',
        statusClass: 'processing',
        primaryAction: 'Please Wait...',
        secondaryAction: 'Cancel'
      }
    },

    // Sync test modes
    syncModes: {
      smart: {
        title: 'Smart Sync',
        description: 'Smart analysis - only sync what needs to change',
        button: 'Start Smart Sync',
        showEfficiency: true,
        infoCard: {
          title: '🧠 Smart Sync Technology',
          description: 'Advanced algorithm that analyzes all data and processes only necessary changes:',
          features: [
            'Intelligent difference detection',
            '95%+ efficiency improvement',
            'Preserves unchanged data',
            'Minimal API usage'
          ]
        }
      },
      incremental: {
        title: 'Incremental Sync',
        description: 'Sync only recent bookmarks (7 days)',
        button: 'Start Incremental Sync',
        showEfficiency: true,
        infoCard: {
          title: '⚡ Incremental Sync',
          description: 'Fast synchronization focusing on recent activity:',
          features: [
            'Last 7 days of bookmarks',
            'Modified items only',
            'Minimal processing time',
            'Preserves existing data'
          ]
        }
      },
      reset: {
        title: 'Reset & Full Sync',
        description: 'Delete all Notion pages and recreate from Raindrop',
        button: 'Start Reset & Full Sync',
        showEfficiency: false,
        warning: true,
        infoCard: {
          title: '⚠️ Reset Mode',
          description: 'This will delete all existing Notion pages and recreate them from Raindrop. This operation cannot be undone.',
          features: [
            'All Notion pages will be deleted',
            'All bookmarks will be recreated',
            'Custom Notion data will be lost'
          ]
        }
      }
    },

    // Apply dashboard state
    setDashboardState(stateName) {
      const state = this.dashboard[stateName];
      if (!state) {
        console.warn('Unknown dashboard state:', stateName);
        return;
      }

      // Update active button
      document.querySelectorAll('.state-switcher button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(stateName.replace('-', ' '))) {
          btn.classList.add('active');
        }
      });

      // Update indicator
      const indicator = document.getElementById('statusIndicator');
      if (indicator) {
        indicator.className = `status-indicator ${state.indicator}`;
      }

      // Update counts
      const raindropCount = document.getElementById('raindropCount');
      if (raindropCount) {
        raindropCount.textContent = state.raindropCount;
        raindropCount.className = `count-display ${state.raindropClass}`;
      }

      const notionCount = document.getElementById('notionCount');
      if (notionCount) {
        notionCount.textContent = state.notionCount;
        notionCount.className = `count-display ${state.notionClass}`;
      }

      // Update status message
      const statusMessage = document.getElementById('statusMessage');
      if (statusMessage) {
        statusMessage.textContent = state.statusMessage;
        statusMessage.className = `status-message ${state.statusClass}`;
      }

      // Update action buttons
      const primaryAction = document.getElementById('primaryAction');
      const secondaryAction = document.getElementById('secondaryAction');
      if (primaryAction) primaryAction.textContent = state.primaryAction;
      if (secondaryAction) secondaryAction.textContent = state.secondaryAction;

      console.log(`Dashboard state changed to: ${stateName}`);
    },

    // Apply sync mode
    setSyncMode(modeName) {
      const mode = this.syncModes[modeName];
      if (!mode) {
        console.warn('Unknown sync mode:', modeName);
        return;
      }

      // Update active button
      document.querySelectorAll('.mode-switcher button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(modeName)) {
          btn.classList.add('active');
        }
      });

      // Update page content
      const syncTitle = document.getElementById('sync-title');
      const syncDescription = document.getElementById('sync-description');
      const syncBtn = document.getElementById('syncBtn');

      if (syncTitle) syncTitle.textContent = mode.title;
      if (syncDescription) syncDescription.textContent = mode.description;
      if (syncBtn) syncBtn.textContent = mode.button;

      // Show/hide efficiency display
      const efficiencyDisplay = document.getElementById('efficiency-display');
      if (efficiencyDisplay) {
        efficiencyDisplay.style.display = mode.showEfficiency ? 'block' : 'none';
      }

      // Update info card
      const infoCard = document.getElementById('info-card-1');
      if (infoCard) {
        if (mode.warning) {
          infoCard.classList.add('warning');
        } else {
          infoCard.classList.remove('warning');
        }

        const infoTitle = infoCard.querySelector('h3');
        const infoDescription = infoCard.querySelector('p');
        const infoList = infoCard.querySelector('ul');

        if (infoTitle) infoTitle.textContent = mode.infoCard.title;
        if (infoDescription) infoDescription.textContent = mode.infoCard.description;

        if (infoList) {
          infoList.innerHTML = '';
          mode.infoCard.features.forEach(feature => {
            const li = document.createElement('li');
            li.textContent = feature;
            infoList.appendChild(li);
          });
        }
      }

      console.log(`Sync mode changed to: ${modeName}`);
    }
  }
};

// Make Utils globally available
if (typeof window !== 'undefined') {
  window.Utils = Utils;
  
  // Auto-setup test state management on test pages
  Utils.ready(() => {
    // Setup dashboard test page
    if (document.querySelector('.state-switcher')) {
      window.setState = (stateName) => {
        Utils.testStates.setDashboardState(stateName);
      };
      Utils.log.info('Dashboard test state management initialized');
    }

    // Setup sync test page
    if (document.querySelector('.mode-switcher')) {
      window.setMode = (modeName) => {
        Utils.testStates.setSyncMode(modeName);
      };
      Utils.log.info('Sync test mode management initialized');
    }
  });
}

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
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

  // 8-Section Layout Helpers
  sections: {
    // Get section element by number
    getSection(number) {
      return document.querySelector(`.section-${number}`);
    },

    // Set section background color
    setSectionBackground(number, color) {
      const section = this.getSection(number);
      if (section) {
        // Remove all background classes
        section.classList.remove('bg-white', 'bg-yellow', 'bg-green', 'bg-red', 'bg-light-gray');
        // Add new background class
        section.classList.add(`bg-${color}`);
      }
    },

    // Set section content
    setSectionContent(number, content, textColor = 'black') {
      const section = this.getSection(number);
      if (section) {
        const contentElement = section.querySelector('.section-content');
        if (contentElement) {
          contentElement.innerHTML = `<span class="text-huge text-${textColor}">${content}</span>`;
        }
      }
    },

    // Clear section content
    clearSection(number) {
      const section = this.getSection(number);
      if (section) {
        const contentElement = section.querySelector('.section-content');
        if (contentElement) {
          contentElement.innerHTML = '';
        }
      }
    },

    // Show/hide section
    toggleSection(number, show = true) {
      const section = this.getSection(number);
      if (section) {
        section.style.display = show ? 'flex' : 'none';
      }
    }
  },

  // Test state management for test pages
  testStates: {
    // Enhanced dashboard test states for 8-section layout
    dashboard: {
      synced: {
        section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
        section2: { bg: 'white', content: '1365 Raindrop Bookmarks', textColor: 'green' },
        section3: { bg: 'white', content: '1365 Notion Pages', textColor: 'green' },
        section4: { bg: 'green', content: 'Synced', textColor: 'white' },
        section5: { bg: 'white', content: 'Sync New? ↻', textColor: 'black' },
        section6: { bg: 'white', content: '', textColor: 'black' },
        section7: { bg: 'white', content: '', textColor: 'black' },
        section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
      },
      'not-synced': {
        section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
        section2: { bg: 'white', content: '1365 Raindrop Bookmarks', textColor: 'red' },
        section3: { bg: 'white', content: '65 Notion Pages', textColor: 'red' },
        section4: { bg: 'red', content: '1300 Not Synced', textColor: 'white' },
        section5: { bg: 'white', content: 'Sync New? ↻', textColor: 'black' },
        section6: { bg: 'white', content: '', textColor: 'black' },
        section7: { bg: 'white', content: '', textColor: 'black' },
        section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
      },
      processing: {
        section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
        section2: { bg: 'yellow', content: 'Sync In Progress', textColor: 'black' },
        section3: { bg: 'white', content: 'Lorem ipsum dolor sit amet...', textColor: 'black' },
        section4: { bg: 'white', content: '', textColor: 'black' },
        section5: { bg: 'green', content: 'Sync Complete<br>1300 of 1300 added', textColor: 'white' },
        section6: { bg: 'white', content: '', textColor: 'black' },
        section7: { bg: 'white', content: '', textColor: 'black' },
        section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
      },
      error: {
        section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
        section2: { bg: 'white', content: 'Error', textColor: 'red' },
        section3: { bg: 'yellow', content: 'Back ↺', textColor: 'black' },
        section4: { bg: 'white', content: '', textColor: 'black' },
        section5: { bg: 'white', content: '', textColor: 'black' },
        section6: { bg: 'white', content: '', textColor: 'black' },
        section7: { bg: 'white', content: '', textColor: 'black' },
        section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
      },
      loading: {
        section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
        section2: { bg: 'white', content: '... Raindrop Bookmarks', textColor: 'black' },
        section3: { bg: 'white', content: '... Notion Pages', textColor: 'black' },
        section4: { bg: 'white', content: 'Loading...', textColor: 'black' },
        section5: { bg: 'white', content: 'Please Wait...', textColor: 'black' },
        section6: { bg: 'white', content: '', textColor: 'black' },
        section7: { bg: 'white', content: '', textColor: 'black' },
        section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
      }
    },

    // Sync test modes for 8-section layout
    syncModes: {
      smart: {
        title: 'Smart Sync',
        description: 'Smart analysis - only sync what needs to change',
        button: 'Start Smart Sync',
        showEfficiency: true,
        sections: {
          section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
          section2: { bg: 'yellow', content: 'Start Smart Sync?', textColor: 'black' },
          section3: { bg: 'white', content: '', textColor: 'black' },
          section4: { bg: 'white', content: '', textColor: 'black' },
          section5: { bg: 'white', content: '', textColor: 'black' },
          section6: { bg: 'white', content: '', textColor: 'black' },
          section7: { bg: 'white', content: '', textColor: 'black' },
          section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
        }
      },
      incremental: {
        title: 'Incremental Sync',
        description: 'Sync only recent bookmarks (7 days)',
        button: 'Start Incremental Sync',
        showEfficiency: true,
        sections: {
          section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
          section2: { bg: 'yellow', content: 'Start Incremental Sync?', textColor: 'black' },
          section3: { bg: 'white', content: '', textColor: 'black' },
          section4: { bg: 'white', content: '', textColor: 'black' },
          section5: { bg: 'white', content: '', textColor: 'black' },
          section6: { bg: 'white', content: '', textColor: 'black' },
          section7: { bg: 'white', content: '', textColor: 'black' },
          section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
        }
      },
      reset: {
        title: 'Reset & Full Sync',
        description: 'Delete all Notion pages and recreate from Raindrop',
        button: 'Start Reset & Full Sync',
        showEfficiency: false,
        warning: true,
        sections: {
          section1: { bg: 'white', content: 'Raindrop/Notion Sync', textColor: 'black' },
          section2: { bg: 'red', content: 'Reset & Full Sync?', textColor: 'white' },
          section3: { bg: 'white', content: '⚠️ Warning: This will delete all existing pages', textColor: 'red' },
          section4: { bg: 'white', content: '', textColor: 'black' },
          section5: { bg: 'white', content: '', textColor: 'black' },
          section6: { bg: 'white', content: '', textColor: 'black' },
          section7: { bg: 'white', content: '', textColor: 'black' },
          section8: { bg: 'light-gray', content: 'Back ↺', textColor: 'black' }
        }
      }
    },

    // Apply dashboard state using 8-section layout
    setDashboardState(stateName) {
      const state = this.dashboard[stateName];
      if (!state) {
        console.warn('Unknown dashboard state:', stateName);
        return;
      }

      console.log(`Setting dashboard state: ${stateName}`);

      // Update active button in state switcher
      document.querySelectorAll('.state-switcher button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().replace(/\s+/g, '-').includes(stateName)) {
          btn.classList.add('active');
        }
      });

      // Apply each section configuration
      for (let i = 1; i <= 8; i++) {
        const sectionConfig = state[`section${i}`];
        if (sectionConfig) {
          Utils.sections.setSectionBackground(i, sectionConfig.bg);
          if (sectionConfig.content) {
            Utils.sections.setSectionContent(i, sectionConfig.content, sectionConfig.textColor);
          } else {
            Utils.sections.clearSection(i);
          }
        }
      }

      console.log(`Dashboard state changed to: ${stateName}`);
    },

    // Apply sync mode using 8-section layout
    setSyncMode(modeName) {
      const mode = this.syncModes[modeName];
      if (!mode) {
        console.warn('Unknown sync mode:', modeName);
        return;
      }

      console.log(`Setting sync mode: ${modeName}`);

      // Update active button in mode switcher
      document.querySelectorAll('.mode-switcher button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(modeName)) {
          btn.classList.add('active');
        }
      });

      // Apply section configurations
      if (mode.sections) {
        for (let i = 1; i <= 8; i++) {
          const sectionConfig = mode.sections[`section${i}`];
          if (sectionConfig) {
            Utils.sections.setSectionBackground(i, sectionConfig.bg);
            if (sectionConfig.content) {
              Utils.sections.setSectionContent(i, sectionConfig.content, sectionConfig.textColor);
            } else {
              Utils.sections.clearSection(i);
            }
          }
        }
      }

      // Update specific elements if they exist
      const syncTitle = document.getElementById('sync-title');
      const syncDescription = document.getElementById('sync-description');
      const syncBtn = document.getElementById('syncBtn');

      if (syncTitle) syncTitle.textContent = mode.title;
      if (syncDescription) syncDescription.textContent = mode.description;
      if (syncBtn) syncBtn.textContent = mode.button;

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

Utils.device = {
  prefersReducedMotion: () => false,
  prefersDarkMode: () => false, 
  prefersHighContrast: () => false,
  hasTouch: () => false,
  getConnection: () => null
};

Utils.perf = {
  mark: () => {},
  measure: () => 0,
  getMemoryUsage: () => ({ used: 0, total: 0, limit: 0 })
};

// Just ADD these missing functions to the END of your existing utils.js file
// Don't replace anything - just add these at the bottom:

// Add missing device functions
Utils.device = {
  prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  },

  prefersDarkMode() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (e) {
      return false;
    }
  },

  prefersHighContrast() {
    try {
      return window.matchMedia('(prefers-contrast: high)').matches;
    } catch (e) {
      return false;
    }
  },

  hasTouch() {
    try {
      return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    } catch (e) {
      return false;
    }
  },

  getConnection() {
    try {
      return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    } catch (e) {
      return null;
    }
  }
};

// Add missing performance functions
Utils.perf = {
  mark(name) {
    try {
      if (performance && performance.mark) {
        performance.mark(name);
      }
    } catch (e) {
      // Silently fail
    }
  },

  measure(name, start, end) {
    try {
      if (performance && performance.measure) {
        performance.measure(name, start, end);
        const measure = performance.getEntriesByName(name)[0];
        return measure ? measure.duration : 0;
      }
    } catch (e) {
      // Silently fail
    }
    return 0;
  },

  getMemoryUsage() {
    try {
      if (performance && performance.memory) {
        return {
          used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
          limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
      }
    } catch (e) {
      // Silently fail
    }
    return { used: 0, total: 0, limit: 0 };
  }
};
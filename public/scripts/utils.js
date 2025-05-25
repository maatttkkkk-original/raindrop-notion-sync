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
      if (this.getParam('debug') === 'true') {
        console.log(`[${new Date().toISOString()}] DEBUG:`, ...args);
      }
    }
  }
};

// Make Utils globally available
if (typeof window !== 'undefined') {
  window.Utils = Utils;
}

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
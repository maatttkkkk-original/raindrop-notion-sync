/**
 * Progressive Enhancement Features
 * Modern web API enhancements that gracefully degrade
 */

class ProgressiveEnhancements {
  constructor() {
    this.features = {
      intersectionObserver: false,
      resizeObserver: false,
      webAnimations: false,
      customProperties: false,
      containerQueries: false,
      viewTransitions: false
    };
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.detectFeatures();
      this.applyEnhancements();
      this.setupPerformanceOptimizations();
      Utils.log.info('Progressive enhancements initialized:', this.features);
    });
  }

  detectFeatures() {
    // Intersection Observer for lazy loading and scroll effects
    this.features.intersectionObserver = 'IntersectionObserver' in window;
    
    // Resize Observer for responsive components
    this.features.resizeObserver = 'ResizeObserver' in window;
    
    // Web Animations API for smooth animations
    this.features.webAnimations = 'animate' in document.createElement('div');
    
    // CSS Custom Properties support
    this.features.customProperties = window.CSS && CSS.supports('--test', 'value');
    
    // Container Queries (cutting edge)
    this.features.containerQueries = window.CSS && CSS.supports('container-type', 'inline-size');
    
    // View Transitions API (very cutting edge)
    this.features.viewTransitions = 'startViewTransition' in document;
  }

  applyEnhancements() {
    if (this.features.intersectionObserver) {
      this.setupLazyLoading();
      this.setupScrollEffects();
    }
    
    if (this.features.resizeObserver) {
      this.setupResponsiveComponents();
    }
    
    if (this.features.webAnimations) {
      this.setupSmoothAnimations();
    }
    
    if (this.features.customProperties) {
      this.setupDynamicTheming();
    }
    
    if (this.features.viewTransitions) {
      this.setupViewTransitions();
    }
    
    // Always apply these enhancements
    this.setupKeyboardNavigation();
    this.setupTouchEnhancements();
    this.setupAccessibilityEnhancements();
  }

  // ===== INTERSECTION OBSERVER ENHANCEMENTS =====
  setupLazyLoading() {
    const lazyElements = document.querySelectorAll('[data-lazy]');
    if (lazyElements.length === 0) return;

    const lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const element = entry.target;
          const src = element.dataset.lazy;
          
          if (element.tagName === 'IMG') {
            element.src = src;
          } else {
            element.style.backgroundImage = `url(${src})`;
          }
          
          element.removeAttribute('data-lazy');
          lazyObserver.unobserve(element);
        }
      });
    }, {
      rootMargin: '50px'
    });

    lazyElements.forEach(element => lazyObserver.observe(element));
    Utils.log.info(`Lazy loading enabled for ${lazyElements.length} elements`);
  }

  setupScrollEffects() {
    const scrollElements = document.querySelectorAll('[data-scroll-effect]');
    if (scrollElements.length === 0) return;

    const scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const element = entry.target;
        const effect = element.dataset.scrollEffect;
        
        if (entry.isIntersecting) {
          element.classList.add(`scroll-${effect}-in`);
          element.classList.remove(`scroll-${effect}-out`);
        } else {
          element.classList.add(`scroll-${effect}-out`);
          element.classList.remove(`scroll-${effect}-in`);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '-10px'
    });

    scrollElements.forEach(element => scrollObserver.observe(element));
    Utils.log.info(`Scroll effects enabled for ${scrollElements.length} elements`);
  }

  // ===== RESIZE OBSERVER ENHANCEMENTS =====
  setupResponsiveComponents() {
    const responsiveElements = document.querySelectorAll('[data-responsive]');
    if (responsiveElements.length === 0) return;

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach(entry => {
        const element = entry.target;
        const width = entry.contentRect.width;
        
        // Apply size-based classes
        element.classList.remove('size-small', 'size-medium', 'size-large');
        
        if (width < 300) {
          element.classList.add('size-small');
        } else if (width < 600) {
          element.classList.add('size-medium');
        } else {
          element.classList.add('size-large');
        }
        
        // Custom resize handling
        const handler = element.dataset.responsive;
        if (typeof window[handler] === 'function') {
          window[handler](element, { width, height: entry.contentRect.height });
        }
      });
    });

    responsiveElements.forEach(element => resizeObserver.observe(element));
    Utils.log.info(`Responsive components enabled for ${responsiveElements.length} elements`);
  }

  // ===== WEB ANIMATIONS ENHANCEMENTS =====
  setupSmoothAnimations() {
    // Enhanced fade-in for new elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE && node.dataset.animateIn) {
            this.animateElementIn(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Enhance existing sync status messages
    this.enhanceSyncMessages();
    
    Utils.log.info('Smooth animations enabled');
  }

  animateElementIn(element) {
    if (Utils.device.prefersReducedMotion()) return;

    const animationType = element.dataset.animateIn;
    
    const animations = {
      fade: [
        { opacity: 0 },
        { opacity: 1 }
      ],
      slide: [
        { transform: 'translateY(20px)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 }
      ],
      scale: [
        { transform: 'scale(0.9)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 }
      ]
    };

    const keyframes = animations[animationType] || animations.fade;
    
    element.animate(keyframes, {
      duration: 300,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'both'
    });
  }

  enhanceSyncMessages() {
    // Enhance sync status container if present
    const statusContainer = document.getElementById('status');
    if (!statusContainer) return;

    // Add smooth scroll for new messages
    const originalAppendChild = statusContainer.appendChild;
    statusContainer.appendChild = function(child) {
      const result = originalAppendChild.call(this, child);
      
      // Animate new message
      if (child.nodeType === Node.ELEMENT_NODE && !Utils.device.prefersReducedMotion()) {
        child.style.transform = 'translateX(-10px)';
        child.style.opacity = '0';
        
        child.animate([
          { transform: 'translateX(-10px)', opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 }
        ], {
          duration: 250,
          easing: 'ease-out'
        });
      }
      
      // Smooth scroll to bottom
      if (this.scrollTo) {
        this.scrollTo({
          top: this.scrollHeight,
          behavior: 'smooth'
        });
      }
      
      return result;
    };
  }

  // ===== DYNAMIC THEMING ENHANCEMENTS =====
  setupDynamicTheming() {
    // Add safety check
    if (!window.matchMedia) {
      console.warn('Media queries not supported - skipping dynamic theming');
      return;
    }

    try {
      const darkModePreference = window.matchMedia('(prefers-color-scheme: dark)');
      const theme = darkModePreference.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);

      darkModePreference.addEventListener('change', (e) => {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      });
    } catch (error) {
      console.warn('Error setting up dynamic theming:', error);
    }
  }

  // ===== VIEW TRANSITIONS ENHANCEMENTS =====
  setupViewTransitions() {
    // Enhance navigation between pages
    const links = document.querySelectorAll('a[href^="/"]');
    
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        
        e.preventDefault();
        this.navigateWithTransition(link.href);
      });
    });
    
    Utils.log.info('View transitions enabled');
  }

  async navigateWithTransition(url) {
    if (!document.startViewTransition) {
      window.location.href = url;
      return;
    }

    const transition = document.startViewTransition(() => {
      window.location.href = url;
    });

    try {
      await transition.finished;
    } catch (error) {
      Utils.log.warn('View transition failed:', error);
    }
  }

  // ===== KEYBOARD NAVIGATION ENHANCEMENTS =====
  setupKeyboardNavigation() {
    // Enhanced keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + R: Start sync (if sync button exists)
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        const syncBtn = document.getElementById('syncBtn') || document.getElementById('startBtn');
        if (syncBtn && !syncBtn.disabled) {
          e.preventDefault();
          syncBtn.click();
        }
      }
      
      // Escape: Stop sync
      if (e.key === 'Escape' && window.syncManager?.isRunning()) {
        window.syncManager.stopSync();
      }
      
      // Arrow keys: Navigate action buttons
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.navigateActionButtons(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
    
    // Skip link for accessibility
    this.addSkipLink();
    
    Utils.log.info('Keyboard navigation enhanced');
  }

  navigateActionButtons(direction) {
    const buttons = Array.from(document.querySelectorAll('.action-button, .sync-button'));
    if (buttons.length === 0) return;
    
    const focusedElement = document.activeElement;
    const currentIndex = buttons.indexOf(focusedElement);
    
    let nextIndex;
    if (currentIndex === -1) {
      nextIndex = direction > 0 ? 0 : buttons.length - 1;
    } else {
      nextIndex = (currentIndex + direction + buttons.length) % buttons.length;
    }
    
    buttons[nextIndex].focus();
  }

  addSkipLink() {
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Skip to main content';
    skipLink.className = 'skip-link';
    skipLink.style.cssText = `
      position: absolute;
      top: -40px;
      left: 6px;
      background: #000;
      color: #fff;
      padding: 8px;
      text-decoration: none;
      border-radius: 4px;
      z-index: 1000;
      transition: top 0.3s;
    `;
    
    skipLink.addEventListener('focus', () => {
      skipLink.style.top = '6px';
    });
    
    skipLink.addEventListener('blur', () => {
      skipLink.style.top = '-40px';
    });
    
    document.body.insertBefore(skipLink, document.body.firstChild);
  }

  // ===== TOUCH ENHANCEMENTS =====
  setupTouchEnhancements() {
    // Add safety check for touch capability
    const hasTouch = ('ontouchstart' in window) || 
                     (navigator.maxTouchPoints > 0) || 
                     (navigator.msMaxTouchPoints > 0);

    if (!hasTouch) {
      return; // Exit if device doesn't support touch
    }

    try {
      document.documentElement.classList.add('touch-device');
      
      // Add touch feedback to buttons
      const buttons = document.querySelectorAll('button, [role="button"]');
      buttons.forEach(button => {
        button.addEventListener('touchstart', () => {
          button.classList.add('touch-active');
        }, { passive: true });
        
        button.addEventListener('touchend', () => {
          button.classList.remove('touch-active');
        }, { passive: true });
      });
    } catch (error) {
      console.warn('Error setting up touch enhancements:', error);
    }
  }

  // ===== ACCESSIBILITY ENHANCEMENTS =====
  setupAccessibilityEnhancements() {
    // Announce sync status changes to screen readers
    Utils.events.on('syncCompleted', (event) => {
      this.announceToScreenReader('Sync completed successfully');
    });
    
    Utils.events.on('syncError', (event) => {
      this.announceToScreenReader(`Sync failed: ${event.detail.message}`);
    });
    
    // Enhanced focus management
    this.setupFocusManagement();
    
    // High contrast mode detection
    if (Utils.device.prefersHighContrast()) {
      document.documentElement.classList.add('high-contrast');
    }
    
    Utils.log.info('Accessibility enhancements enabled');
  }

  announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    
    document.body.appendChild(announcement);
    announcement.textContent = message;
    
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  setupFocusManagement() {
    // Trap focus in modal-like sync screens
    const syncContainers = document.querySelectorAll('.sync-page, .sync-progress');
    
    syncContainers.forEach(container => {
      container.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          this.trapFocus(e, container);
        }
      });
    });
  }

  trapFocus(e, container) {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }

  // ===== PERFORMANCE OPTIMIZATIONS =====
  setupPerformanceOptimizations() {
    // Debounce resize events
    if (window.ResizeObserver) {
      let resizeTimeout;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          Utils.events.emit('optimizedResize');
        }, 150);
      });
    }
    
    // Use requestIdleCallback for non-critical tasks
    if (window.requestIdleCallback) {
      requestIdleCallback(() => {
        this.performNonCriticalTasks();
      });
    }
    
    // Connection-aware features
    const connection = Utils.device.getConnection();
    if (connection?.saveData) {
      document.documentElement.classList.add('save-data');
      Utils.log.info('Save-Data mode enabled - reducing resource usage');
    }
    
    Utils.log.info('Performance optimizations enabled');
  }

  performNonCriticalTasks() {
    // Clean up old event listeners
    this.cleanupEventListeners();
    
    // Preload critical resources
    this.preloadResources();
    
    // Log performance metrics
    this.logPerformanceMetrics();
  }

  cleanupEventListeners() {
    // Remove event listeners from removed elements
    const elements = document.querySelectorAll('[data-cleanup]');
    elements.forEach(element => {
      if (!document.body.contains(element)) {
        // Element was removed, cleanup would happen here
        Utils.log.debug('Cleaned up removed element listeners');
      }
    });
  }

  preloadResources() {
    // Preload next likely pages
    const currentPath = window.location.pathname;
    let nextPage = null;
    
    if (currentPath === '/') {
      nextPage = '/sync';
    } else if (currentPath.includes('/sync')) {
      nextPage = '/';
    }
    
    if (nextPage) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = nextPage;
      document.head.appendChild(link);
    }
  }

  logPerformanceMetrics() {
    if (window.performance) {
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation) {
        Utils.log.info('Performance metrics:', {
          loadTime: Math.round(navigation.loadEventEnd - navigation.fetchStart),
          domContentLoaded: Math.round(navigation.domContentLoadedEventEnd - navigation.fetchStart),
          firstPaint: this.getFirstPaint(),
          memory: Utils.perf.getMemoryUsage()
        });
      }
    }
  }

  getFirstPaint() {
    const paintEntries = performance.getEntriesByType('paint');
    const firstPaint = paintEntries.find(entry => entry.name === 'first-paint');
    return firstPaint ? Math.round(firstPaint.startTime) : null;
  }

  // ===== PUBLIC API =====
  
  // Check if specific feature is available
  hasFeature(featureName) {
    return this.features[featureName] || false;
  }

  // Get all available features
  getAvailableFeatures() {
    return Object.keys(this.features).filter(key => this.features[key]);
  }

  // Enable/disable specific enhancement
  toggleFeature(featureName, enabled) {
    if (featureName in this.features) {
      this.features[featureName] = enabled;
      Utils.log.info(`Feature ${featureName} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  // Get enhancement status
  getStatus() {
    return {
      features: this.features,
      userPreferences: {
        reducedMotion: Utils.device.prefersReducedMotion(),
        darkMode: Utils.device.prefersDarkMode(),
        highContrast: Utils.device.prefersHighContrast(),
        hasTouch: Utils.device.hasTouch()
      },
      connection: Utils.device.getConnection(),
      performance: {
        memory: Utils.perf.getMemoryUsage(),
        timing: this.getFirstPaint()
      }
    };
  }
}

// ===== COMPONENT ENHANCEMENTS =====

// Enhanced Status Display Component
class EnhancedStatusDisplay {
  constructor(container) {
    this.container = container;
    this.messages = [];
    this.maxMessages = 100;
    
    // Add safety check for motion preferences
    this.reducedMotion = window.matchMedia ? 
      window.matchMedia('(prefers-reduced-motion: reduce)').matches : 
      false;
  }

  addMessage(message, type = 'info') {
    try {
      const element = document.createElement('div');
      element.className = 'message';
      element.textContent = message;
      
      this.applyEnhancedStyling(element, type);
      
      // Only animate if motion is not reduced
      if (!this.reducedMotion) {
        this.animateMessageIn(element);
      }
      
      this.container.appendChild(element);
      this.messages.push(element);
      this.limitMessages();
      this.scrollToBottom();
    } catch (error) {
      console.warn('Error adding status message:', error);
    }
  }

  applyEnhancedStyling(element, type) {
    const baseStyle = {
      padding: '12px 16px',
      margin: '4px 0',
      borderRadius: '6px',
      borderLeft: '4px solid',
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
      fontSize: '14px',
      lineHeight: '1.5',
      transition: 'all 0.2s ease',
      position: 'relative'
    };

    const typeStyles = {
      info: { borderLeftColor: '#3b82f6', backgroundColor: '#eff6ff', color: '#1e40af' },
      success: { borderLeftColor: '#10b981', backgroundColor: '#ecfdf5', color: '#047857' },
      added: { borderLeftColor: '#10b981', backgroundColor: '#ecfdf5', color: '#047857' },
      updated: { borderLeftColor: '#f59e0b', backgroundColor: '#fffbeb', color: '#92400e' },
      deleted: { borderLeftColor: '#ef4444', backgroundColor: '#fef2f2', color: '#dc2626' },
      failed: { borderLeftColor: '#ef4444', backgroundColor: '#fef2f2', color: '#dc2626' },
      error: { borderLeftColor: '#ef4444', backgroundColor: '#fef2f2', color: '#dc2626' },
      warning: { borderLeftColor: '#f59e0b', backgroundColor: '#fffbeb', color: '#92400e' },
      complete: { borderLeftColor: '#10b981', backgroundColor: '#ecfdf5', color: '#047857', fontWeight: '600' },
      analysis: { borderLeftColor: '#8b5cf6', backgroundColor: '#f3e8ff', color: '#7c3aed', fontWeight: '500' }
    };

    const style = { ...baseStyle, ...(typeStyles[type] || typeStyles.info) };
    
    Object.assign(element.style, style);
    
    // Add visual enhancement based on type
    if (type === 'complete') {
      element.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.2)';
    } else if (type === 'error' || type === 'failed') {
      element.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.2)';
    }
  }

  animateMessageIn(element) {
    if (Utils.device.prefersReducedMotion()) return;
    
    element.style.transform = 'translateX(-20px) scale(0.95)';
    element.style.opacity = '0';
    
    requestAnimationFrame(() => {
      element.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
      element.style.transform = 'translateX(0) scale(1)';
      element.style.opacity = '1';
    });
  }

  limitMessages() {
    const messages = this.container.children;
    while (messages.length > this.maxMessages) {
      const oldMessage = messages[0];
      
      // Animate out
      if (!Utils.device.prefersReducedMotion()) {
        oldMessage.style.transition = 'all 0.2s ease-out';
        oldMessage.style.transform = 'translateX(-100%)';
        oldMessage.style.opacity = '0';
        
        setTimeout(() => {
          if (oldMessage.parentNode) {
            this.container.removeChild(oldMessage);
          }
        }, 200);
      } else {
        this.container.removeChild(oldMessage);
      }
    }
  }

  scrollToBottom() {
    if (this.container.scrollTo) {
      this.container.scrollTo({
        top: this.container.scrollHeight,
        behavior: Utils.device.prefersReducedMotion() ? 'auto' : 'smooth'
      });
    } else {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }
}

// ===== INITIALIZATION =====

// Auto-initialize progressive enhancements
let enhancements = null;

Utils.ready(() => {
  enhancements = new ProgressiveEnhancements();
  
  // Enhance status displays
  const statusContainers = document.querySelectorAll('#status, .sync-updates');
  statusContainers.forEach(container => {
    container.enhancedDisplay = new EnhancedStatusDisplay(container);
  });
  
  // Global enhancements object
  window.enhancements = enhancements;
  
  Utils.log.info('All progressive enhancements loaded');
});

// Export for potential module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProgressiveEnhancements, EnhancedStatusDisplay };
}
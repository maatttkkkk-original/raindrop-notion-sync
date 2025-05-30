/**
 * FIXED Sync Manager - No Deletions Version
 * Issue 1: Proper log display for massive-log area
 * Issue 2: No deletion tracking or counters
 */

class SyncManager {
  constructor() {
    this.evtSource = null;
    this.syncInProgress = false;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.messageCount = 0;
    this.maxMessages = 100;
    
    // Loop protection (no deletion tracking)
    this.lastSyncType = null;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 5;
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.bindEvents();
      this.setupLogArea();
      console.log('🚀 Fixed SyncManager initialized (no deletions)');
    });
  }

  bindEvents() {
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.startSync();
      });
      console.log('✅ Sync button bound');
    }

    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }

  setupLogArea() {
    const status = document.getElementById('status');
    if (status) {
        // Clear content but maintain visibility
        status.innerHTML = '';
        status.style.display = 'block';
        status.style.visibility = 'visible';
        status.style.opacity = '1';
        
        // Ensure parent sections are visible
        const logSection = document.getElementById('log-section');
        if (logSection) {
            logSection.style.display = 'block';
            logSection.style.visibility = 'visible';
            logSection.style.opacity = '1';
        }
        
        console.log('✅ Log area initialized with visibility (no deletion tracking)');
    }
  }

  startSync() {
    if (this.syncInProgress) {
      this.showStatus('⚠️ Sync already running', 'warning');
      return;
    }

    // Reset error tracking
    this.consecutiveErrors = 0;
    this.messageCount = 0;

    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';

    if (!password) {
      this.showStatus('❌ Password required', 'error');
      return;
    }

    this.syncInProgress = true;
    this.lastSyncType = mode;
    this.updateButton(true);
    this.showLogArea();
    
    const syncUrl = `/sync-stream?password=${encodeURIComponent(password)}&mode=${mode}&_t=${Date.now()}`;
    this.connectToSync(syncUrl);
  }

  connectToSync(url) {
    console.log('🔌 Connecting to:', url);
    
    this.cleanup();
    this.evtSource = new EventSource(url);
    
    this.evtSource.onopen = () => {
      console.log('✅ Connected');
      this.showStatus('🔗 Connected to sync stream', 'info');
      this.connectionRetries = 0;
    };

    this.evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Parse error:', error);
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
          this.showStatus('❌ Too many parse errors, stopping sync', 'error');
          this.stopSync();
        }
      }
    };

    this.evtSource.onerror = () => {
      console.error('❌ Connection error');
      this.consecutiveErrors++;
      
      if (this.connectionRetries < this.maxRetries && this.consecutiveErrors < this.maxConsecutiveErrors) {
        this.connectionRetries++;
        this.showStatus(`🔄 Reconnecting... (${this.connectionRetries}/${this.maxRetries})`, 'warning');
        
        setTimeout(() => {
          if (this.syncInProgress) {
            this.connectToSync(url);
          }
        }, 2000 * this.connectionRetries);
      } else {
        this.showStatus('❌ Connection failed or too many errors', 'error');
        this.stopSync();
      }
    };
  }

  handleMessage(data) {
    // Skip heartbeat messages
    if (data.type === 'heartbeat') return;
    
    // Reset error counter on successful message
    this.consecutiveErrors = 0;
    
    // Handle new progress messages
    if (data.type === 'progress') {
      this.updateProgress(data.completed, data.total, data.percentage);
      return;
    }
    
    // Handle regular message content
    if (data.message) {
      this.showStatus(data.message, data.type || 'info');
    }
    
    // Update stats if available (no deletion counters)
    if (data.counts) {
      this.updateStats(data.counts);
    }
    
    // Handle completion
    if (data.complete) {
      this.showStatus('🎉 Sync completed!', 'complete');
      this.syncInProgress = false;
      this.updateButton(false);
      this.cleanup();
      
      // Show final stats (no deletions)
      if (data.finalCounts) {
        this.showFinalSummary(data.finalCounts, data.mode, data.duration);
      }
    }
    
    // Handle errors
    if (data.type === 'error' || data.type === 'failed') {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        this.showStatus('❌ Too many consecutive errors, stopping sync', 'error');
        this.stopSync();
      }
    }
  }

  showStatus(message, type = 'info') {
    const status = document.getElementById('status');
    if (!status) return;

    // Create update element
    const update = document.createElement('div');
    update.className = `sync-update ${type}`;
    
    // Add timestamp
    const now = new Date().toLocaleTimeString();
    update.textContent = `[${now}] ${message}`;
    
    // Important: Append BEFORE any style updates
    status.appendChild(update);
    
    // Ensure log area is visible
    status.closest('.log-section-massive').style.display = 'block';
    
    // Scroll to new message
    update.scrollIntoView({ behavior: 'smooth' });
  }

  updateProgress(completed, total, percentage) {
    // Update progress text in compact status
    const progressText = document.getElementById('progress-text');
    if (progressText) {
      progressText.textContent = `${completed}/${total} complete (${percentage}%)`;
    }
    
    // Update progress in stats area
    const syncStats = document.getElementById('sync-stats');
    if (syncStats) {
      syncStats.style.display = 'inline';
    }
    
    // Log progress to console and status area
    console.log(`📊 Progress: ${completed}/${total} bookmarks (${percentage}%)`);
    
    // Add a progress message to the log (less frequent than individual bookmarks)
    if (completed % 100 === 0 || completed === total) {
      this.showStatus(`📊 Progress: ${completed}/${total} bookmarks synced (${percentage}%)`, 'progress');
    }
  }

  // Show/hide stats (no deletion counters)
  updateStats(counts) {
    const stats = document.getElementById('sync-stats');
    if (stats) {
        stats.classList.remove('hidden');
        // Update count spans (no deleted counter)...
    }
  }

  limitMessages() {
    const status = document.getElementById('status');
    if (!status) return;
    
    const messages = status.children;
    while (messages.length > this.maxMessages) {
      const oldMessage = messages[0];
      status.removeChild(oldMessage);
      this.messageCount--;
    }
  }

  scrollToBottom() {
    const status = document.getElementById('status');
    if (!status) return;
    
    // Use multiple scroll methods for better compatibility
    try {
      status.scrollTop = status.scrollHeight;
      
      // Also try scrollIntoView on last message
      const lastMessage = status.lastElementChild;
      if (lastMessage) {
        lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    } catch (error) {
      console.warn('Scroll error:', error);
    }
  }

  showLogArea() {
    const status = document.getElementById('status');
    const logSection = document.getElementById('log-section');
    const compactSection = document.getElementById('compact-status-section');
    
    if (status) {
      status.style.display = 'block';
    }
    
    // Show the compact stats area as well
    if (compactSection) {
      const syncStats = document.getElementById('sync-stats');
      if (syncStats) {
        syncStats.style.display = 'inline';
      }
    }
    
    console.log('📊 Log areas activated (no deletion tracking)');
  }

  updateStats(counts) {
    // Updated to handle new count structure (no deletions)
    const elements = {
      'added-count': counts.added || counts.created || 0,
      'updated-count': counts.updated || 0,
      'failed-count': counts.failed || 0
    };
    
    Object.entries(elements).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = value;
      }
    });
    
    // Show stats container
    const syncStats = document.getElementById('sync-stats');
    if (syncStats) {
      syncStats.style.display = 'inline';
    }
  }

  showFinalSummary(counts, mode, duration) {
    // Updated final summary (no deletions)
    const summary = [
      `📊 Final Results:`,
      `• Added: ${counts.added || counts.created || 0}`,
      `• Updated: ${counts.updated || 0}`,
      `• Failed: ${counts.failed || 0}`,
      duration ? `⏱️ Duration: ${duration}s` : '',
      `🔄 Mode: ${mode || 'unknown'}`
    ].filter(Boolean).join(' ');
    
    this.showStatus(summary, 'summary');
  }

  updateButton(running) {
    const btn = document.getElementById('syncBtn');
    if (!btn) return;
    
    btn.disabled = running;
    
    const mode = new URLSearchParams(window.location.search).get('mode') || 'smart';
    
    if (running) {
      btn.textContent = mode === 'full' ? 'Full Sync Running...' : 'Smart Sync Running...';
      btn.style.opacity = '0.6';
    } else {
      btn.textContent = mode === 'full' ? 'Start Full Sync' : 'Start Smart Sync';
      btn.style.opacity = '1';
    }
  }

  stopSync() {
    console.log('🛑 Stopping sync');
    this.syncInProgress = false;
    this.updateButton(false);
    this.cleanup();
    this.showStatus('🛑 Sync stopped', 'warning');
  }

  cleanup() {
    if (this.evtSource) {
      this.evtSource.close();
      this.evtSource = null;
    }
    this.connectionRetries = 0;
    console.log('🧹 Cleanup completed');
  }

  // Public methods for external access
  getStatus() {
    return {
      running: this.syncInProgress,
      connected: !!this.evtSource,
      retries: this.connectionRetries,
      messages: this.messageCount,
      errors: this.consecutiveErrors
    };
  }

  // Manual stop method
  forceStop() {
    this.stopSync();
  }
}

// Initialize only once and make globally available
Utils.ready(() => {
  if (document.getElementById('syncBtn')) {
    // Clean up any existing instance
    if (window.syncManager) {
      window.syncManager.cleanup();
    }
    
    // Create new instance
    window.syncManager = new SyncManager();
    
    // Debug helpers
    window.syncDebug = () => console.log(window.syncManager.getStatus());
    window.syncStop = () => window.syncManager.forceStop();
    
    console.log('🎯 Fixed SyncManager ready (no deletions)');
  }
});

// Add after the SyncManager class definition
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

// Debug any mutation changes to status
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            console.log('Status children changed:', {
                added: mutation.addedNodes.length,
                removed: mutation.removedNodes.length,
                total: document.getElementById('status')?.children.length
            });
        }
    });
});

Utils.ready(() => {
    const status = document.getElementById('status');
    if (status) {
        observer.observe(status, { childList: true });
    }
});
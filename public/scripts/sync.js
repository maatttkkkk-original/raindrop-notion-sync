/**
 * FIXED Sync Manager - Handles both issues
 * Issue 1: Proper log display for massive-log area
 * Issue 2: Sync loop protection
 */

class SyncManager {
  constructor() {
    this.evtSource = null;
    this.syncInProgress = false;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.messageCount = 0;
    this.maxMessages = 100;
    
    // Loop protection
    this.lastSyncType = null;
    this.consecutiveErrors = 0;
    this.maxConsecutiveErrors = 5;
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.bindEvents();
      this.setupLogArea();
      console.log('🚀 Fixed SyncManager initialized');
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
      // Clear any existing content
      status.innerHTML = '';
      // Show the log area
      status.style.display = 'block';
      console.log('✅ Log area initialized');
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
    
    // Handle message content
    if (data.message) {
      this.showStatus(data.message, data.type || 'info');
    }
    
    // Update stats if available
    if (data.counts) {
      this.updateStats(data.counts);
    }
    
    // Handle completion
    if (data.complete) {
      this.showStatus('🎉 Sync completed!', 'complete');
      this.syncInProgress = false;
      this.updateButton(false);
      this.cleanup();
      
      // Show final stats
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
    if (!status) {
      console.log(`Status: ${message}`);
      return;
    }

    // Ensure status area is visible
    status.style.display = 'block';
    
    // Create message element
    const div = document.createElement('div');
    div.className = `sync-update ${type}`;
    
    // Apply styling that works with massive-log area
    const styles = {
      padding: '8px 12px',
      margin: '4px 0',
      borderRadius: '3px',
      fontFamily: "'SF Mono', 'Monaco', 'Cascadia Code', 'Roboto Mono', monospace",
      fontSize: '12px',
      lineHeight: '1.3',
      borderLeft: '3px solid #007bff',
      background: '#f8f9fa',
      color: '#333',
      wordWrap: 'break-word',
      display: 'block' // Ensure it's visible
    };
    
    // Type-specific styling
    const typeStyles = {
      info: { borderLeftColor: '#3b82f6', background: '#eff6ff' },
      success: { borderLeftColor: '#22c55e', background: '#f0fdf4' },
      added: { borderLeftColor: '#22c55e', background: '#f0fdf4' },
      updated: { borderLeftColor: '#f59e0b', background: '#fffbeb' },
      deleted: { borderLeftColor: '#ef4444', background: '#fef2f2' },
      failed: { borderLeftColor: '#ef4444', background: '#fef2f2', fontWeight: '500' },
      error: { borderLeftColor: '#ef4444', background: '#fef2f2', fontWeight: '500' },
      warning: { borderLeftColor: '#f59e0b', background: '#fffbeb' },
      complete: { borderLeftColor: '#22c55e', background: '#f0fdf4', fontWeight: '600' },
      analysis: { borderLeftColor: '#8b5cf6', background: '#f3e8ff' },
      processing: { borderLeftColor: '#8b5cf6', background: '#f3e8ff' },
      fetching: { borderLeftColor: '#06b6d4', background: '#ecfeff' }
    };
    
    // Apply styles
    Object.assign(div.style, styles, typeStyles[type] || {});
    
    // Add timestamp and message
    const now = new Date().toLocaleTimeString();
    div.textContent = `[${now}] ${message}`;
    
    // Append to container
    status.appendChild(div);
    this.messageCount++;
    
    // Limit messages to prevent memory issues
    this.limitMessages();
    
    // Auto-scroll to bottom
    this.scrollToBottom();
    
    console.log(`📝 Message added: ${message} (${type})`);
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
    
    console.log('📊 Log areas activated');
  }

  updateStats(counts) {
    const elements = {
      'added-count': counts.added || counts.created || 0,
      'updated-count': counts.updated || 0,
      'deleted-count': counts.deleted || 0,
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
    const summary = [
      `📊 Final Results:`,
      `• Added: ${counts.added || counts.created || 0}`,
      `• Updated: ${counts.updated || 0}`,
      `• Deleted: ${counts.deleted || 0}`,
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
      btn.textContent = mode === 'reset' ? 'Reset Sync Running...' : 'Smart Sync Running...';
      btn.style.opacity = '0.6';
    } else {
      btn.textContent = mode === 'reset' ? 'Start Reset & Full Sync' : 'Start Smart Sync';
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
    
    console.log('🎯 Fixed SyncManager ready');
  }
});
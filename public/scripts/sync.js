/**
 * FIXED Sync Manager - Works with existing Fastify backend
 * Handles: Progress messages, stop button, connection management
 */

class SyncManager {
  constructor() {
    this.evtSource = null;
    this.syncInProgress = false;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.bindEvents();
      this.setupUI();
      console.log('🚀 Fixed SyncManager initialized');
    });
  }

  bindEvents() {
    const syncBtn = document.getElementById('syncBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.startSync();
      });
    }
    
    if (stopBtn) {
      stopBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.stopSync();
      });
    }

    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });
  }

  setupUI() {
    this.updateProgressBar(0);
    this.hideStopButton();
  }

  startSync() {
    if (this.syncInProgress) {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';

    if (!password) {
      alert('Password required');
      return;
    }

    this.syncInProgress = true;
    this.updateSyncButton(true);
    this.showStopButton();
    this.updateProgressText('Starting sync...');
    
    const syncUrl = `/sync-stream?password=${encodeURIComponent(password)}&mode=${mode}&_t=${Date.now()}`;
    this.connectToSync(syncUrl);
  }

  connectToSync(url) {
    console.log('🔌 Connecting to:', url);
    
    this.cleanup();
    this.evtSource = new EventSource(url);
    
    this.evtSource.onopen = () => {
      console.log('✅ Connected');
      this.connectionRetries = 0;
    };

    this.evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Parse error:', error);
      }
    };

    this.evtSource.onerror = () => {
      console.error('❌ Connection error');
      
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        this.updateProgressText(`Reconnecting... (${this.connectionRetries}/${this.maxRetries})`);
        
        setTimeout(() => {
          if (this.syncInProgress) {
            this.connectToSync(url);
          }
        }, 2000 * this.connectionRetries);
      } else {
        this.updateProgressText('Connection failed');
        this.stopSync();
      }
    };
  }

  handleMessage(data) {
    console.log('📨 Message received:', data);
    
    // Skip heartbeat messages
    if (data.type === 'heartbeat') return;
    
    // Handle progress messages from backend (XX/ZZ complete)
    if (data.type === 'progress') {
      this.updateProgress(data.completed, data.total, data.percentage);
      return;
    }
    
    // Handle regular sync messages
    if (data.message) {
      this.updateProgressText(data.message);
    }
    
    // Handle completion
    if (data.complete) {
      this.handleCompletion(data);
    }
  }

  // Update XX/ZZ complete every 20 bookmarks
  updateProgress(completed, total, percentage) {
    // Update progress text: "20/1300 complete"
    this.updateProgressText(`${completed}/${total} complete`);
    
    // Update progress bar width
    this.updateProgressBar(percentage);
    
    console.log(`📊 Progress: ${completed}/${total} (${percentage}%)`);
  }

  updateProgressText(text) {
    const progressElement = document.getElementById('progress-text');
    if (progressElement) {
      progressElement.textContent = text;
    }
    console.log(`📝 Status: ${text}`);
  }

  updateProgressBar(percentage) {
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
    }
  }

  updateSyncButton(running) {
    const btn = document.getElementById('syncBtn');
    if (!btn) return;
    
    if (running) {
      btn.textContent = 'Syncing...';
      btn.disabled = true;
    } else {
      const mode = new URLSearchParams(window.location.search).get('mode') || 'smart';
      btn.textContent = mode === 'full' ? 'Start Full Sync' : 'Start Smart Sync';
      btn.disabled = false;
    }
  }

  showStopButton() {
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
      stopBtn.style.display = 'block';
    }
  }

  hideStopButton() {
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) {
      stopBtn.style.display = 'none';
    }
  }

  handleCompletion(data) {
    this.syncInProgress = false;
    this.updateSyncButton(false);
    this.hideStopButton();
    this.updateProgressText('Sync completed!');
    this.updateProgressBar(100);
    this.cleanup();
    
    if (data.finalCounts) {
      console.log('📊 Final results:', data.finalCounts);
    }
  }

  stopSync() {
    console.log('🛑 Stopping sync');
    this.syncInProgress = false;
    this.updateSyncButton(false);
    this.hideStopButton();
    this.updateProgressText('Sync stopped');
    this.cleanup();
  }

  cleanup() {
    if (this.evtSource) {
      this.evtSource.close();
      this.evtSource = null;
    }
    this.connectionRetries = 0;
  }

  // Public API
  getStatus() {
    return {
      running: this.syncInProgress,
      connected: !!this.evtSource
    };
  }

  isRunning() {
    return this.syncInProgress;
  }
}

// Initialize sync manager
Utils.ready(() => {
  if (document.getElementById('syncBtn')) {
    if (window.syncManager) {
      window.syncManager.cleanup();
    }
    
    window.syncManager = new SyncManager();
    console.log('🎯 Fixed SyncManager ready');
  }
});
/**
 * Minimal Sync Manager - Just What We Need
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
      console.log('🚀 Minimal SyncManager initialized');
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

  startSync() {
    if (this.syncInProgress) {
      this.showStatus('⚠️ Sync already running', 'warning');
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';

    if (!password) {
      this.showStatus('❌ Password required', 'error');
      return;
    }

    this.syncInProgress = true;
    this.updateButton(true);
    
    const syncUrl = `/sync-stream?password=${encodeURIComponent(password)}&mode=${mode}&_t=${Date.now()}`;
    this.connectToSync(syncUrl);
  }

  connectToSync(url) {
    console.log('🔌 Connecting to:', url);
    
    this.cleanup();
    this.evtSource = new EventSource(url);
    
    this.evtSource.onopen = () => {
      console.log('✅ Connected');
      this.showStatus('🔗 Connected to sync', 'success');
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
        this.showStatus(`🔄 Reconnecting... (${this.connectionRetries}/${this.maxRetries})`, 'warning');
        
        setTimeout(() => {
          if (this.syncInProgress) {
            this.connectToSync(url);
          }
        }, 2000 * this.connectionRetries);
      } else {
        this.showStatus('❌ Connection failed', 'error');
        this.syncInProgress = false;
        this.updateButton(false);
      }
    };
  }

  handleMessage(data) {
    if (data.type === 'heartbeat') return;
    
    if (data.message) {
      this.showStatus(data.message, data.type || 'info');
    }
    
    if (data.complete) {
      this.showStatus('🎉 Sync completed!', 'complete');
      this.syncInProgress = false;
      this.updateButton(false);
      this.cleanup();
    }
  }

  showStatus(message, type = 'info') {
    const status = document.getElementById('status');
    if (!status) {
      console.log(`Status: ${message}`);
      return;
    }

    status.style.display = 'block';
    
    const div = document.createElement('div');
    div.className = `sync-update ${type}`;
    div.style.cssText = `
      padding: 8px 12px;
      margin: 4px 0;
      border-left: 3px solid #007bff;
      background: #f8f9fa;
      font-family: monospace;
      font-size: 13px;
      border-radius: 3px;
    `;
    
    // Different colors for different types
    if (type === 'success') div.style.borderLeftColor = '#28a745';
    if (type === 'error') div.style.borderLeftColor = '#dc3545';
    if (type === 'warning') div.style.borderLeftColor = '#ffc107';
    if (type === 'complete') div.style.fontWeight = 'bold';
    
    const now = new Date().toLocaleTimeString();
    div.textContent = `[${now}] ${message}`;
    
    status.appendChild(div);
    status.scrollTop = status.scrollHeight;
    
    // Keep only last 50 messages
    while (status.children.length > 50) {
      status.removeChild(status.firstChild);
    }
  }

  updateButton(running) {
    const btn = document.getElementById('syncBtn');
    if (!btn) return;
    
    btn.disabled = running;
    btn.textContent = running ? 'Sync Running...' : 'Start Sync';
  }

  cleanup() {
    if (this.evtSource) {
      this.evtSource.close();
      this.evtSource = null;
    }
    this.connectionRetries = 0;
  }

  // Debug helper
  getStatus() {
    return {
      running: this.syncInProgress,
      connected: !!this.evtSource,
      retries: this.connectionRetries
    };
  }
}

// Initialize
Utils.ready(() => {
  if (document.getElementById('syncBtn')) {
    window.syncManager = new SyncManager();
    
    // Debug helper
    window.syncDebug = () => console.log(window.syncManager.getStatus());
  }
});
/**
 * Sync Functionality
 * Handles all sync operations with proper state management and prevention
 */

class SyncManager {
  constructor() {
    this.evtSource = null;
    this.syncInProgress = false;
    this.startBtn = null;
    this.statusDiv = null;
    this.resultDiv = null;
    this.progressBar = null;
    this.preventionManager = new SyncPrevention();
    
    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupElements());
    } else {
      this.setupElements();
    }
  }

  setupElements() {
    this.startBtn = document.getElementById('startBtn');
    this.statusDiv = document.getElementById('status');
    this.resultDiv = document.getElementById('result');
    this.progressBar = document.querySelector('.progress-fill');
    
    if (this.startBtn) {
      this.startBtn.addEventListener('click', (e) => this.handleSyncClick(e));
    }

    // Check for existing sync on page load
    this.checkExistingSync();
  }

  handleSyncClick(e) {
    e.preventDefault();
    
    // Prevention check
    if (!this.preventionManager.canStartSync()) {
      this.showStatus('Sync already in progress. Please wait...', 'warning');
      return;
    }

    this.startSync();
  }

  startSync() {
    // Set prevention state
    this.preventionManager.setSyncInProgress(true);
    
    // Update UI immediately
    this.updateSyncUI(true);
    
    // Get parameters
    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password') || '';
    const mode = urlParams.get('mode') || 'all';

    // Close any existing connection
    if (this.evtSource) {
      this.evtSource.close();
    }

    // Create unique connection URL to prevent caching
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const url = `/sync-stream?password=${encodeURIComponent(password)}&mode=${mode}&_t=${timestamp}&_id=${randomId}`;

    // Add small delay to prevent race conditions
    setTimeout(() => {
      this.connectToSyncStream(url);
    }, Math.random() * 1000 + 500);
  }

  connectToSyncStream(url) {
    this.evtSource = new EventSource(url);
    
    this.evtSource.onopen = () => {
      this.showStatus('🔗 Connected to sync stream...', 'info');
    };

    this.evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleSyncMessage(data);
      } catch (error) {
        console.error('Error parsing sync message:', error);
        this.showStatus('Error parsing sync data', 'error');
      }
    };

    this.evtSource.onerror = (error) => {
      console.error('EventSource error:', error);
      this.handleSyncError('Connection error occurred');
    };
  }

  handleSyncMessage(data) {
    const { message, type, progress, isComplete, hasError } = data;

    // Update progress if available
    if (progress !== undefined && this.progressBar) {
      this.progressBar.style.width = `${progress}%`;
    }

    // Show message
    if (message) {
      this.showStatus(message, type || 'info');
    }

    // Handle completion
    if (isComplete) {
      this.handleSyncComplete(hasError);
    }
  }

  handleSyncComplete(hasError = false) {
    setTimeout(() => {
      this.evtSource?.close();
      this.evtSource = null;
      
      // Clear prevention state
      this.preventionManager.setSyncInProgress(false);
      
      // Update UI
      this.updateSyncUI(false);
      
      // Show completion message
      const message = hasError ? 
        '❌ Sync completed with errors' : 
        '✅ Sync completed successfully!';
      const type = hasError ? 'error' : 'success';
      
      this.showStatus(message, type);
      
      // Auto-refresh dashboard after successful sync
      if (!hasError && window.location.pathname === '/') {
        setTimeout(() => {
          if (window.dashboardManager) {
            window.dashboardManager.loadCounts();
          }
        }, 1000);
      }
      
    }, 1000);
  }

  handleSyncError(errorMessage) {
    this.evtSource?.close();
    this.evtSource = null;
    
    // Clear prevention state
    this.preventionManager.setSyncInProgress(false);
    
    // Update UI
    this.updateSyncUI(false);
    
    // Show error
    this.showStatus(`❌ ${errorMessage}`, 'error');
  }

  updateSyncUI(inProgress) {
    if (!this.startBtn) return;

    this.syncInProgress = inProgress;
    
    if (inProgress) {
      this.startBtn.disabled = true;
      this.startBtn.textContent = 'Sync Running...';
      this.startBtn.classList.add('disabled');
      
      // Add pulsing animation
      this.startBtn.style.animation = 'pulse 2s infinite';
    } else {
      this.startBtn.disabled = false;
      this.startBtn.textContent = 'Start Sync';
      this.startBtn.classList.remove('disabled');
      this.startBtn.style.animation = '';
    }
  }

  showStatus(message, type = 'info') {
    if (!this.statusDiv) return;

    // Clear existing content
    this.statusDiv.innerHTML = '';
    
    // Create status element
    const statusElement = document.createElement('div');
    statusElement.className = `status-message status-${type}`;
    statusElement.textContent = message;
    
    // Add to status div
    this.statusDiv.appendChild(statusElement);
    
    // Also log to console for debugging
    console.log(`[Sync ${type.toUpperCase()}]`, message);
    
    // Auto-scroll to bottom if there are multiple messages
    this.statusDiv.scrollTop = this.statusDiv.scrollHeight;
  }

  checkExistingSync() {
    // Check if sync was in progress (page refresh scenario)
    if (this.preventionManager.isSyncInProgress()) {
      this.updateSyncUI(true);
      this.showStatus('Checking for existing sync...', 'info');
      
      // Try to reconnect to existing sync
      const urlParams = new URLSearchParams(window.location.search);
      const password = urlParams.get('password') || '';
      const mode = urlParams.get('mode') || 'all';
      
      // Check server for active sync
      this.checkServerSyncStatus(password, mode);
    }
  }

  async checkServerSyncStatus(password, mode) {
    try {
      const response = await fetch(`/sync-debug?password=${encodeURIComponent(password)}`);
      const data = await response.json();
      
      // If no active sync found, clear prevention state
      if (!data.syncInProgress) {
        this.preventionManager.setSyncInProgress(false);
        this.updateSyncUI(false);
        this.showStatus('No active sync found', 'info');
      }
    } catch (error) {
      console.error('Error checking sync status:', error);
      // Clear prevention state on error
      this.preventionManager.setSyncInProgress(false);
      this.updateSyncUI(false);
    }
  }

  // Public methods for external control
  stopSync() {
    if (this.evtSource) {
      this.evtSource.close();
      this.evtSource = null;
    }
    
    this.preventionManager.setSyncInProgress(false);
    this.updateSyncUI(false);
    this.showStatus('Sync stopped by user', 'warning');
  }

  isRunning() {
    return this.syncInProgress;
  }
}

// CSS for pulsing animation
const style = document.createElement('style');
style.textContent = `
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.7; }
    100% { opacity: 1; }
  }
  
  .status-message {
    padding: 8px 12px;
    margin: 4px 0;
    border-radius: 4px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 13px;
    line-height: 1.4;
  }
  
  .status-info { 
    background: rgba(59, 130, 246, 0.1); 
    color: #1e40af; 
    border-left: 3px solid #3b82f6;
  }
  
  .status-success { 
    background: rgba(34, 197, 94, 0.1); 
    color: #15803d; 
    border-left: 3px solid #22c55e;
  }
  
  .status-warning { 
    background: rgba(245, 158, 11, 0.1); 
    color: #d97706; 
    border-left: 3px solid #f59e0b;
  }
  
  .status-error { 
    background: rgba(239, 68, 68, 0.1); 
    color: #dc2626; 
    border-left: 3px solid #ef4444;
  }
`;
document.head.appendChild(style);

// Initialize sync manager when script loads
if (typeof window !== 'undefined') {
  window.syncManager = new SyncManager();
}
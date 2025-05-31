/**
 * CHUNKED Sync Manager - Handles 25-item chunks with state tracking
 * Features: Progress across chunks, fail tracking, clean stop logic
 */

class ChunkedSyncManager {
  constructor() {
    this.evtSource = null;
    this.syncInProgress = false;
    this.connectionRetries = 0;
    this.maxRetries = 2; // Reduced for clean failure
    
    // Chunk state tracking
    this.currentIndex = 0;
    this.totalItems = 0;
    this.chunkSize = 25;
    this.totalCreated = 0;
    this.totalUpdated = 0;
    this.totalFailed = 0;
    this.totalSkipped = 0;
    
    this.init();
  }

  init() {
    Utils.ready(() => {
      this.bindEvents();
      this.setupUI();
      console.log('🚀 Chunked SyncManager initialized');
    });
  }

  bindEvents() {
    const syncBtn = document.getElementById('syncBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    if (syncBtn) {
      syncBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.startChunkedSync();
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
    this.resetCounters();
  }

  resetCounters() {
    this.currentIndex = 0;
    this.totalItems = 0;
    this.totalCreated = 0;
    this.totalUpdated = 0;
    this.totalFailed = 0;
    this.totalSkipped = 0;
  }

  startChunkedSync() {
    if (this.syncInProgress) {
      return;
    }

    this.resetCounters();
    this.syncInProgress = true;
    this.updateSyncButton(true);
    this.showStopButton();
    this.updateProgressText('Starting sync...');
    
    // Start with first chunk
    this.processNextChunk();
  }

  processNextChunk() {
    if (!this.syncInProgress) {
      return; // Stop was called
    }

    const urlParams = new URLSearchParams(window.location.search);
    const password = urlParams.get('password');
    const mode = urlParams.get('mode') || 'smart';

    if (!password) {
      alert('Password required');
      this.stopSync();
      return;
    }

    const chunkNumber = Math.floor(this.currentIndex / this.chunkSize) + 1;
    console.log(`🔄 Starting chunk ${chunkNumber} from index ${this.currentIndex}`);
    
    this.updateProgressText(`Processing bookmarks...`);
    
    const syncUrl = `/sync-stream?password=${encodeURIComponent(password)}&mode=${mode}&startIndex=${this.currentIndex}&chunkSize=${this.chunkSize}&_t=${Date.now()}`;
    this.connectToSync(syncUrl);
  }

  connectToSync(url) {
    console.log('🔌 Connecting to:', url);
    
    this.cleanup();
    this.evtSource = new EventSource(url);
    
    this.evtSource.onopen = () => {
      console.log('✅ Connected to chunk');
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
        this.updateProgressText(`Connection lost, retrying... (${this.connectionRetries}/${this.maxRetries})`);
        
        setTimeout(() => {
          if (this.syncInProgress) {
            this.connectToSync(url);
          }
        }, 2000 * this.connectionRetries);
      } else {
        this.updateProgressText('Connection failed - stopping sync');
        this.stopSyncWithError('Connection failed after multiple attempts');
      }
    };
  }

  handleMessage(data) {
    console.log('📨 Message received:', data);
    
    // Skip heartbeat messages
    if (data.type === 'heartbeat') return;
    
    // Handle progress messages (XX/ZZ complete)
    if (data.type === 'progress') {
      this.updateProgress(data.completed, data.total, data.percentage);
      return;
    }
    
    // Handle chunk completion
    if (data.chunkComplete) {
      this.handleChunkCompletion(data);
      return;
    }
    
    // Handle regular sync messages
    if (data.message) {
      console.log(`📝 Status: ${data.message}`);
    }
  }

  // Update progress: "25/1365 complete"
  updateProgress(completed, total, percentage) {
    this.totalItems = total; // Update total if we didn't have it
    
    this.updateProgressText(`${completed}/${total} complete`);
    this.updateProgressBar(percentage);
    
    console.log(`📊 Overall Progress: ${completed}/${total} (${percentage}%)`);
  }

  handleChunkCompletion(data) {
    console.log('🎯 Chunk completed:', data);
    
    // Accumulate counts across chunks
    if (data.chunkCounts) {
      this.totalCreated += data.chunkCounts.created || 0;
      this.totalUpdated += data.chunkCounts.updated || 0;
      this.totalFailed += data.chunkCounts.failed || 0;
      this.totalSkipped += data.chunkCounts.skipped || 0;
    }
    
    // Update current position
    if (data.nextIndex !== undefined) {
      this.currentIndex = data.nextIndex;
    }
    
    // Update total items if provided
    if (data.totalItems) {
      this.totalItems = data.totalItems;
    }
    
    this.cleanup(); // Close current connection
    
    if (data.hasMore && this.syncInProgress) {
      // Continue with next chunk
      console.log(`🔄 Starting next chunk ${nextChunkNumber} from index ${this.currentIndex}`);
      
      // Small delay before next chunk - show continuing message
      this.updateProgressText(`Continuing sync...`);
      
      setTimeout(() => {
        if (this.syncInProgress) {
          this.processNextChunk();
        }
      }, 1000);
    } else {
      // All chunks complete
      this.handleSyncCompletion();
    }
  }

  handleSyncCompletion() {
    console.log('🎉 All chunks completed!');
    
    this.syncInProgress = false;
    this.updateSyncButton(false);
    this.hideStopButton();
    this.updateProgressBar(100);
    
    const totalProcessed = this.totalCreated + this.totalUpdated + this.totalFailed + this.totalSkipped;
    this.updateProgressText(`Sync completed! ${totalProcessed}/${this.totalItems} processed`);
    
    // Log final results
    console.log('📊 Final Results:', {
      total: this.totalItems,
      processed: totalProcessed,
      created: this.totalCreated,
      updated: this.totalUpdated,
      failed: this.totalFailed,
      skipped: this.totalSkipped
    });
    
    this.cleanup();
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

  stopSync() {
    console.log('🛑 Stopping chunked sync');
    this.syncInProgress = false;
    this.updateSyncButton(false);
    this.hideStopButton();
    
    const processed = this.totalCreated + this.totalUpdated + this.totalFailed + this.totalSkipped;
    this.updateProgressText(`Sync stopped at ${this.currentIndex}/${this.totalItems} (${processed} processed)`);
    
    this.cleanup();
  }

  stopSyncWithError(error) {
    console.error('🚨 Stopping sync due to error:', error);
    this.syncInProgress = false;
    this.updateSyncButton(false);
    this.hideStopButton();
    this.updateProgressText(`Sync failed: ${error}`);
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
      connected: !!this.evtSource,
      currentIndex: this.currentIndex,
      totalItems: this.totalItems,
      totalCreated: this.totalCreated,
      totalUpdated: this.totalUpdated,
      totalFailed: this.totalFailed,
      totalSkipped: this.totalSkipped
    };
  }

  isRunning() {
    return this.syncInProgress;
  }
}

// Initialize chunked sync manager
Utils.ready(() => {
  if (document.getElementById('syncBtn')) {
    if (window.syncManager) {
      window.syncManager.cleanup();
    }
    
    window.syncManager = new ChunkedSyncManager();
    console.log('🎯 Chunked SyncManager ready');
  }
});
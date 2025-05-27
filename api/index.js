/* Enhanced Dashboard & Sync Styles */
/* File: public/styles/dashboard.css */

/* 8-Section Dashboard Layout */
.dashboard-8-section {
  display: grid;
  grid-template-rows: 1fr 2px 1fr 2px 1fr 2px 1fr 2px 1fr 2px 1fr 2px 1fr 2px 1fr;
  height: 100vh;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.dashboard-section {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 var(--container-padding);
  width: 100%;
  position: relative;
}

.dashboard-section.section-1 {
  background: white;
}

.dashboard-section.section-2 {
  background: white;
}

.dashboard-section.section-3 {
  background: white;
}

.dashboard-section.section-4 {
  background: white;
}

.dashboard-section.section-5 {
  background: white;
}

.dashboard-section.section-6 {
  background: white;
}

.dashboard-section.section-7 {
  background: white;
}

.dashboard-section.section-8 {
  background: #f5f5f5;
}

/* Dividing Lines */
.dashboard-divider {
  width: 100%;
  height: 2px;
  background: black;
  margin: 0;
  padding: 0;
}

/* State-Based Section Backgrounds */
.dashboard-section.bg-yellow {
  background: #ffff00;
}

.dashboard-section.bg-green {
  background: #00ff00;
}

.dashboard-section.bg-red {
  background: #ff0000;
}

.dashboard-section.bg-white {
  background: white;
}

.dashboard-section.bg-light-gray {
  background: #f5f5f5;
}

/* Content Styling */
.section-content {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.section-content.center {
  justify-content: center;
}

.section-content.right {
  justify-content: flex-end;
}

/* Text Colors for Different Backgrounds */
.dashboard-section.bg-yellow .section-content,
.dashboard-section.bg-green .section-content,
.dashboard-section.bg-red .section-content {
  color: black;
}

.dashboard-section.bg-green .section-content {
  color: white;
}

.dashboard-section.bg-red .section-content {
  color: white;
}

/* Scrollable Log Area */
.log-section {
  overflow-y: auto;
  max-height: 100%;
  padding: var(--spacing-sm) var(--container-padding);
}

.log-section .status-display {
  background: transparent;
  border: none;
  padding: 0;
  max-height: none;
  overflow-y: auto;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.3;
}

/* Action Buttons in Sections */
.section-action-button {
  font-size: var(--font-size-huge);
  font-family: var(--font-primary);
  letter-spacing: var(--letter-spacing-tight);
  line-height: var(--line-height-tight);
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  transition: opacity var(--transition-fast);
}

.section-action-button:hover {
  opacity: 0.8;
}

.section-action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Back Button Styling */
.back-section {
  padding-left: var(--container-padding);
}

.back-button {
  font-size: var(--font-size-large);
  color: #999;
  text-decoration: none;
  transition: color var(--transition-fast);
}

.back-button:hover {
  color: #666;
}

/* ORIGINAL DASHBOARD STYLES (Preserved for compatibility) */

/* Dashboard Container */
.dashboard {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: var(--spacing-xl) 0;
  position: relative;
}

/* Status Indicator - Responsive */
.status-indicator {
  width: clamp(80px, 20vw, 120px);
  height: clamp(16px, 4vw, 24px);
  margin-bottom: var(--spacing-lg);
  border-radius: 2px;
  transition: all var(--transition-normal);
}

.status-indicator.synced {
  background-color: var(--color-synced-bg);
}

.status-indicator.not-synced {
  background-color: var(--color-not-synced-bg);
}

.status-indicator.processing {
  background: linear-gradient(45deg, #667eea, #764ba2);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Count Display */
.count-display {
  margin-bottom: var(--spacing-sm);
  position: relative;
  transition: all var(--transition-normal);
}

.count-display:hover {
  transform: translateX(4px);
}

.count-display.loading {
  opacity: 0.6;
}

.count-display.loading::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { left: -100%; }
  100% { left: 100%; }
}

.count-display.error {
  color: var(--color-not-synced-text);
}

/* Status Text & Messages */
.status-text {
  color: #666;
  margin-bottom: var(--spacing-lg);
}

.status-message {
  margin-bottom: var(--spacing-lg);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: 8px;
  font-weight: 500;
  line-height: 0.9;
  transition: all var(--transition-normal);
}

.status-message.synced {
  background-color: var(--color-synced-bg);
  color: var(--color-text-on-color);
}

.status-message.not-synced {
  background-color: var(--color-not-synced-bg);
  color: var(--color-text-on-color);
}

.status-message.processing {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: var(--color-text-on-color);
}

.status-message.calculating {
  background-color: var(--color-text-secondary);
  color: var(--color-text-primary);
}

/* Action Buttons */
.dashboard-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-lg);
}

.action-button {
  font-size: var(--font-size-huge);
  font-family: var(--font-primary);
  letter-spacing: var(--letter-spacing-tight);
  line-height: var(--line-height-tight);
  padding: var(--spacing-sm) 0;
  transition: all var(--transition-normal);
  cursor: pointer;
  border: none;
  background: none;
  text-align: left;
  text-decoration: none;
  display: block;
}

.action-button:hover {
  opacity: 0.7;
  transform: translateX(4px);
}

.action-button:active {
  transform: translateX(2px);
}

.action-button.primary {
  color: var(--color-text-primary);
  font-weight: normal;
}

.action-button.secondary {
  color: var(--color-text-secondary);
  font-weight: normal;
}

.action-button.danger {
  color: var(--color-not-synced-text);
  font-weight: normal;
}

.action-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.action-button.running {
  animation: pulse 2s infinite;
}

/* Sync Page Specific Styles */
.sync-page {
  min-height: 100vh;
  padding: var(--spacing-lg) 0;
}

.sync-header {
  margin-bottom: var(--spacing-xl);
}

.sync-title {
  margin-bottom: var(--spacing-sm);
}

.sync-description {
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.sync-interface {
  margin-bottom: var(--spacing-xl);
}

.sync-controls {
  margin-bottom: var(--spacing-lg);
}

.sync-button {
  min-width: 300px;
  padding: var(--spacing-md) var(--spacing-lg);
  font-size: var(--font-size-large);
  border-radius: 8px;
  transition: all var(--transition-normal);
}

.sync-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.sync-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Progress Components */
.sync-progress {
  margin-bottom: var(--spacing-lg);
  display: none;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: var(--spacing-sm);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #17d827, #22c55e);
  border-radius: 4px;
  transition: width 0.3s ease;
  width: 0%;
}

.progress-text {
  font-size: var(--font-size-small);
  color: var(--color-text-secondary);
  text-align: center;
}

/* Status Display */
.status-display {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: var(--spacing-md);
  max-height: 400px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 14px;
  line-height: 1.4;
  display: none;
}

.sync-update {
  padding: 12px 16px;
  margin: 4px 0;
  border-radius: 6px;
  border-left: 4px solid #ccc;
  font-family: monospace;
  font-size: 14px;
  transition: all 0.2s ease;
  position: relative;
}

.sync-update.info { 
  border-left-color: #3b82f6; 
  background: #eff6ff; 
  color: #1e40af; 
}

.sync-update.success,
.sync-update.added { 
  border-left-color: #10b981; 
  background: #ecfdf5; 
  color: #047857; 
}

.sync-update.updated { 
  border-left-color: #f59e0b; 
  background: #fffbeb; 
  color: #92400e; 
}

.sync-update.deleted { 
  border-left-color: #ef4444; 
  background: #fef2f2; 
  color: #dc2626; 
}

.sync-update.failed,
.sync-update.error { 
  border-left-color: #ef4444; 
  background: #fef2f2; 
  color: #dc2626; 
}

.sync-update.complete { 
  border-left-color: #10b981; 
  background: #ecfdf5; 
  color: #047857; 
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.2);
}

.sync-update.analysis { 
  border-left-color: #8b5cf6; 
  background: #f3e8ff; 
  color: #7c3aed; 
  font-weight: 500; 
}

.sync-update.warning {
  border-left-color: #f59e0b;
  background: #fffbeb;
  color: #92400e;
}

/* Sync Statistics */
.sync-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
  display: none;
}

.stat-group {
  display: flex;
  gap: var(--spacing-md);
  flex-wrap: wrap;
}

.stat-item {
  flex: 1;
  min-width: 80px;
  text-align: center;
  padding: var(--spacing-sm);
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
  transition: all var(--transition-normal);
}

.stat-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.stat-number {
  display: block;
  font-size: var(--font-size-large);
  font-weight: 600;
  color: var(--color-text-primary);
  transition: all var(--transition-normal);
}

.stat-label {
  display: block;
  font-size: var(--font-size-small);
  color: var(--color-text-secondary);
  margin-top: 4px;
}

/* Efficiency Display */
.efficiency-display {
  padding: var(--spacing-md);
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border-radius: 8px;
  text-align: center;
  margin-top: var(--spacing-md);
}

.efficiency-number {
  display: block;
  font-size: var(--font-size-huge);
  font-weight: 600;
  margin-bottom: var(--spacing-xs);
}

.efficiency-label {
  display: block;
  font-size: var(--font-size-small);
  opacity: 0.9;
  margin-bottom: var(--spacing-sm);
}

.efficiency-status {
  font-size: var(--font-size-small);
  opacity: 0.9;
}

/* Info Cards */
.sync-info {
  margin-top: var(--spacing-xl);
}

.info-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: var(--spacing-md);
  margin-bottom: var(--spacing-md);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.info-card.warning {
  border-left: 4px solid #f59e0b;
  background: #fffbeb;
}

.info-card h3 {
  margin-bottom: var(--spacing-sm);
  font-size: var(--font-size-medium);
  color: var(--color-text-primary);
}

.info-card p {
  margin-bottom: var(--spacing-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.info-card ul {
  margin: 0;
  padding-left: var(--spacing-md);
  color: var(--color-text-secondary);
}

.info-card li {
  margin-bottom: 4px;
}

/* Decorative Lines */
.decorative-lines {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: -1;
  opacity: 0.1;
}

.decorative-line {
  position: absolute;
  background-color: var(--color-line);
  transform-origin: center;
}

/* Generate decorative line positions */
.decorative-line:nth-child(1),
.line-1 {
  width: 2px;
  height: 40%;
  top: 10%;
  left: 15%;
  transform: rotate(15deg);
}

.decorative-line:nth-child(2),
.line-2 {
  width: 1px;
  height: 60%;
  top: 20%;
  right: 20%;
  transform: rotate(-25deg);
}

.decorative-line:nth-child(3),
.line-3 {
  width: 1px;
  height: 30%;
  top: 60%;
  left: 25%;
  transform: rotate(45deg);
}

.decorative-line:nth-child(4),
.line-4 {
  width: 2px;
  height: 50%;
  top: 15%;
  left: 60%;
  transform: rotate(-15deg);
}

.decorative-line:nth-child(5),
.line-5 {
  width: 1px;
  height: 35%;
  bottom: 20%;
  right: 30%;
  transform: rotate(30deg);
}

.decorative-line:nth-child(6),
.line-6 {
  width: 1px;
  height: 45%;
  bottom: 10%;
  left: 40%;
  transform: rotate(-40deg);
}

.decorative-line:nth-child(7),
.line-7 {
  width: 2px;
  height: 25%;
  top: 40%;
  right: 15%;
  transform: rotate(60deg);
}

.decorative-line:nth-child(8),
.line-8 {
  width: 1px;
  height: 55%;
  bottom: 25%;
  left: 10%;
  transform: rotate(-10deg);
}

/* Error States */
.error-page {
  text-align: left;
}

.error-message {
  background-color: rgba(255, 0, 0, 0.1);
  border: 1px solid var(--color-not-synced-primary);
  color: var(--color-not-synced-text);
  padding: var(--spacing-md);
  border-radius: 4px;
  margin: var(--spacing-md) 0;
  font-size: var(--font-size-small);
}

.error-details {
  margin: var(--spacing-lg) 0;
}

.error-label {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-xs);
}

.error-code {
  margin: var(--spacing-md) 0;
  padding: var(--spacing-sm);
  background: rgba(255, 0, 0, 0.1);
  border-radius: 4px;
  border-left: 4px solid var(--color-not-synced-primary);
}

.error-code-label {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-xs);
}

.error-code-value {
  font-family: monospace;
  color: var(--color-not-synced-text);
}

.error-details-extended {
  margin: var(--spacing-md) 0;
  padding: var(--spacing-sm);
  background: rgba(0, 0, 0, 0.05);
  border-radius: 4px;
}

.error-details-label {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-xs);
}

.error-details-text {
  color: var(--color-text-primary);
  line-height: 1.4;
}

.error-actions {
  margin-top: var(--spacing-lg);
}

.technical-details {
  margin-top: var(--spacing-xl);
  padding: var(--spacing-sm);
  background: rgba(0, 0, 0, 0.02);
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.technical-summary {
  cursor: pointer;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.technical-summary:hover {
  color: var(--color-text-primary);
}

.technical-content {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}

.stack-trace {
  background: rgba(0, 0, 0, 0.05);
  padding: var(--spacing-sm);
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  margin-top: var(--spacing-xs);
}

.retry-button {
  background: none;
  border: none;
  color: var(--color-text-primary);
  text-decoration: underline;
  cursor: pointer;
  font-size: inherit;
  margin-left: var(--spacing-xs);
}

.retry-button:hover {
  opacity: 0.7;
}

/* Hide decorative lines in 8-section layout */
.dashboard-8-section .decorative-lines {
  display: none;
}

/* Ensure old styles don't interfere in 8-section layout */
.dashboard-8-section .count-display,
.dashboard-8-section .status-message,
.dashboard-8-section .dashboard-actions {
  margin: 0;
  padding: 0;
  background: none;
  border-radius: 0;
}

.dashboard-8-section .count-display:hover {
  transform: none;
}

.dashboard-8-section .action-button {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  font-size: inherit;
  color: inherit;
  cursor: pointer;
  transition: opacity var(--transition-fast);
}

.dashboard-8-section .action-button:hover {
  opacity: 0.8;
  transform: none;
}

/* Responsive Adjustments */
@media (max-width: 768px) {
  .dashboard-section {
    padding: 0 var(--container-padding-mobile);
  }
  
  .section-content {
    font-size: calc(var(--font-size-huge) * 0.7);
  }
  
  .dashboard {
    padding: var(--spacing-lg) 0;
  }
  
  .dashboard-actions {
    margin-top: var(--spacing-md);
  }
  
  .decorative-lines {
    display: none; /* Hide decorative lines on mobile for cleaner look */
  }
  
  .sync-button {
    min-width: auto;
    width: 100%;
    font-size: var(--font-size-medium);
  }
  
  .stat-group {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
  
  .efficiency-number {
    font-size: var(--font-size-large);
  }
}

@media (max-width: 480px) {
  .dashboard-section {
    padding: 0 var(--container-padding-mobile);
  }
  
  .section-content {
    font-size: calc(var(--font-size-huge) * 0.5);
  }
  
  .status-indicator {
    width: 80px;
    height: 16px;
    margin-bottom: var(--spacing-md);
  }
  
  .action-button:hover,
  .sync-button:hover {
    transform: none; /* Disable hover transform on touch devices */
  }
  
  .stat-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-sm);
  }
}

/* High contrast mode support */
@media (prefers-contrast: high) {
  .status-indicator,
  .status-message {
    border: 2px solid currentColor;
  }
  
  .decorative-lines {
    opacity: 0.3;
  }
  
  .error-code,
  .error-details-extended,
  .technical-details {
    border-width: 2px;
  }
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  .action-button,
  .count-display,
  .status-indicator,
  .sync-button,
  .stat-item,
  .stat-number,
  .sync-update {
    animation: none !important;
    transition: none !important;
  }
  
  .action-button:hover,
  .sync-button:hover,
  .count-display:hover {
    transform: none;
  }
}
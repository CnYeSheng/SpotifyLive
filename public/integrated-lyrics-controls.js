/**
 * 整合版歌詞控制系統
 * 將 control-panel-content 整合到 lyrics-controls 中
 */

class IntegratedLyricsControls {
    constructor() {
        this.isVisible = false;
        this.autoHideTimeout = null;
        
        this.init();
        this.bindEvents();
        
        console.log('🎛️ 整合版歌詞控制系統已啟動');
    }

    init() {
        this.createIntegratedControls();
        this.addStyles();
    }

    createIntegratedControls() {
        // 移除現有的控制項
        const existingControls = document.querySelector('.lyrics-controls');
        if (existingControls) {
            existingControls.remove();
        }

        // 檢查是否有錯誤日誌控制面板
        const errorLoggerPanel = document.getElementById('error-logger-control-panel');
        const hasErrorLogger = !!errorLoggerPanel;

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'lyrics-controls integrated';
        controlsContainer.innerHTML = `
            <div class="controls-trigger">
                <div class="trigger-icon">🎵</div>
            </div>
            
            <div class="controls-panel">
                <div class="panel-header">
                    <span class="panel-title">🎛️ 控制面板</span>
                    <button class="panel-minimize" title="最小化">−</button>
                </div>
                
                <div class="panel-sections">
                    <!-- 歌詞控制區域 -->
                    <div class="control-section lyrics-section">
                        <div class="section-title">🎤 歌詞控制</div>
                        <div class="control-buttons">
                            <button class="control-btn" id="lyrics-fast-btn" title="歌詞快0.5秒">
                                <span class="btn-icon">⏪</span>
                                <span class="btn-text">快0.5s</span>
                            </button>
                            <button class="control-btn" id="lyrics-reset-btn" title="重置歌詞時間">
                                <span class="btn-icon">🔄</span>
                                <span class="btn-text">重置</span>
                            </button>
                            <button class="control-btn" id="lyrics-slow-btn" title="歌詞慢0.5秒">
                                <span class="btn-icon">⏩</span>
                                <span class="btn-text">慢0.5s</span>
                            </button>
                        </div>
                        
                        <div class="control-buttons">
                            <button class="control-btn" id="auto-scroll-btn" title="自動滾動">
                                <span class="btn-icon">📜</span>
                                <span class="btn-text">自動滾動</span>
                            </button>
                            <button class="control-btn" id="font-size-btn" title="字體大小">
                                <span class="btn-icon">🔤</span>
                                <span class="btn-text">字體大小</span>
                            </button>
                            <button class="control-btn" id="search-lyrics-btn" title="搜尋歌詞">
                                <span class="btn-icon">🔍</span>
                                <span class="btn-text">搜尋歌詞</span>
                            </button>
                        </div>
                    </div>

                    ${hasErrorLogger ? `
                    <!-- 日誌控制區域 -->
                    <div class="control-section logs-section">
                        <div class="section-title">📋 日誌控制</div>
                        <div class="control-buttons">
                            <button class="control-btn" id="integrated-download-btn" title="手動下載日誌">
                                <span class="btn-icon">📥</span>
                                <span class="btn-text">下載日誌</span>
                            </button>
                            <button class="control-btn" id="integrated-toggle-auto-btn" title="切換自動下載">
                                <span class="btn-icon">🔒</span>
                                <span class="btn-text">自動下載</span>
                            </button>
                            <button class="control-btn" id="integrated-clear-btn" title="清除日誌">
                                <span class="btn-icon">🗑️</span>
                                <span class="btn-text">清除日誌</span>
                            </button>
                        </div>
                        <div class="log-status">
                            <span class="status-text">日誌數量: </span>
                            <span class="log-count" id="integrated-log-count">0</span>
                        </div>
                    </div>
                    ` : ''}

                    <!-- 播放器控制區域 -->
                    <div class="control-section player-section">
                        <div class="section-title">🎮 播放控制</div>
                        <div class="control-buttons">
                            <button class="control-btn" id="integrated-prev-btn" title="上一首">
                                <span class="btn-icon">⏮️</span>
                                <span class="btn-text">上一首</span>
                            </button>
                            <button class="control-btn" id="integrated-play-pause-btn" title="播放/暫停">
                                <span class="btn-icon">⏯️</span>
                                <span class="btn-text">播放/暫停</span>
                            </button>
                            <button class="control-btn" id="integrated-next-btn" title="下一首">
                                <span class="btn-icon">⏭️</span>
                                <span class="btn-text">下一首</span>
                            </button>
                        </div>
                    </div>

                    <!-- 系統控制區域 -->
                    <div class="control-section system-section">
                        <div class="section-title">⚙️ 系統設定</div>
                        <div class="control-buttons">
                            <button class="control-btn" id="integrated-refresh-btn" title="刷新狀態">
                                <span class="btn-icon">🔄</span>
                                <span class="btn-text">刷新狀態</span>
                            </button>
                            <button class="control-btn" id="integrated-devices-btn" title="設備選擇">
                                <span class="btn-icon">📱</span>
                                <span class="btn-text">設備選擇</span>
                            </button>
                            <button class="control-btn" id="integrated-playlist-btn" title="播放清單">
                                <span class="btn-icon">📋</span>
                                <span class="btn-text">播放清單</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(controlsContainer);
        
        // 如果有錯誤日誌面板，隱藏原有的
        if (errorLoggerPanel) {
            errorLoggerPanel.style.display = 'none';
        }
    }

    addStyles() {
        const style = document.createElement('style');
        style.id = 'integrated-lyrics-controls-styles';
        style.textContent = `
            .lyrics-controls.integrated {
                position: fixed;
                right: -320px;
                top: 50%;
                transform: translateY(-50%);
                width: 300px;
                background: rgba(0, 0, 0, 0.95);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-right: none;
                border-radius: 16px 0 0 16px;
                transition: right 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                z-index: 1000;
                max-height: 80vh;
                overflow: hidden;
            }

            .lyrics-controls.integrated:hover,
            .lyrics-controls.integrated.show {
                right: 0;
            }

            .controls-trigger {
                position: absolute;
                left: -40px;
                top: 50%;
                transform: translateY(-50%);
                width: 36px;
                height: 36px;
                background: linear-gradient(135deg, #1db954, #1ed760);
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 16px rgba(29, 185, 84, 0.3);
            }

            .controls-trigger:hover {
                transform: translateY(-50%) scale(1.1);
                box-shadow: 0 8px 25px rgba(29, 185, 84, 0.6);
            }

            .trigger-icon {
                font-size: 16px;
                color: white;
            }

            .panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.05);
            }

            .panel-title {
                font-size: 14px;
                font-weight: 600;
                color: white;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
            }

            .panel-minimize {
                width: 24px;
                height: 24px;
                border: none;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.1);
                color: white;
                font-size: 14px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            }

            .panel-minimize:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: scale(1.1);
            }

            .panel-sections {
                max-height: calc(80vh - 60px);
                overflow-y: auto;
                padding: 12px;
            }

            .control-section {
                margin-bottom: 16px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 8px;
                padding: 12px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }

            .control-section:last-child {
                margin-bottom: 0;
            }

            .section-title {
                font-size: 12px;
                font-weight: 600;
                color: #1db954;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .control-buttons {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-bottom: 6px;
            }

            .control-buttons:last-child {
                margin-bottom: 0;
            }

            .control-btn {
                flex: 1;
                min-width: 80px;
                padding: 8px;
                border: none;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.9);
                font-size: 10px;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }

            .control-btn:hover {
                background: rgba(255, 255, 255, 0.15);
                transform: scale(1.05);
                border-color: rgba(29, 185, 84, 0.3);
            }

            .control-btn:active {
                transform: scale(0.95);
            }

            .control-btn.active {
                background: linear-gradient(135deg, #1db954, #1ed760);
                border-color: transparent;
                box-shadow: 0 2px 8px rgba(29, 185, 84, 0.4);
            }

            .btn-icon {
                font-size: 14px;
            }

            .btn-text {
                font-weight: 500;
                line-height: 1;
                text-align: center;
            }

            .log-status {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                font-size: 11px;
                color: rgba(255, 255, 255, 0.7);
                text-align: center;
            }

            .log-count {
                color: #1db954;
                font-weight: 600;
            }

            /* 手機版隱藏 */
            @media (max-width: 767px) {
                .lyrics-controls.integrated {
                    display: none;
                }
            }

            /* 滾動條樣式 */
            .panel-sections::-webkit-scrollbar {
                width: 4px;
            }

            .panel-sections::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
            }

            .panel-sections::-webkit-scrollbar-thumb {
                background: rgba(29, 185, 84, 0.6);
                border-radius: 2px;
            }
        `;
        
        document.head.appendChild(style);
    }

    bindEvents() {
        const panel = document.querySelector('.lyrics-controls.integrated');
        if (!panel) return;

        // 觸發顯示/隱藏
        const trigger = panel.querySelector('.controls-trigger');
        trigger?.addEventListener('click', () => {
            this.togglePanel();
        });

        // 鼠標進入保持顯示
        panel.addEventListener('mouseenter', () => {
            this.showPanel();
            this.clearAutoHide();
        });

        // 鼠標離開延遲隱藏
        panel.addEventListener('mouseleave', () => {
            this.scheduleAutoHide();
        });

        // 最小化按鈕
        const minimizeBtn = panel.querySelector('.panel-minimize');
        minimizeBtn?.addEventListener('click', () => {
            this.hidePanel();
        });

        // 綁定所有控制按鈕
        this.bindControlButtons();

        // 邊緣觸發
        this.bindEdgeDetection();
    }

    bindControlButtons() {
        // 歌詞控制按鈕
        this.bindButton('lyrics-fast-btn', () => window.player?.adjustLyricsOffset(-500));
        this.bindButton('lyrics-reset-btn', () => window.player?.resetLyricsOffset());
        this.bindButton('lyrics-slow-btn', () => window.player?.adjustLyricsOffset(500));
        this.bindButton('auto-scroll-btn', () => window.player?.autoScrollBtn?.click());
        this.bindButton('font-size-btn', () => window.player?.fontSizeBtn?.click());
        this.bindButton('search-lyrics-btn', () => this.showLyricsSearchModal());

        // 日誌控制按鈕（如果有錯誤日誌系統）
        if (window.enhancedAutoErrorLogger) {
            this.bindButton('integrated-download-btn', () => window.enhancedAutoErrorLogger.downloadLogs('manual'));
            this.bindButton('integrated-toggle-auto-btn', () => {
                window.enhancedAutoErrorLogger.toggleAutoDownload();
                this.updateLogControlsUI();
            });
            this.bindButton('integrated-clear-btn', () => {
                window.enhancedAutoErrorLogger.clearLogs();
                this.updateLogControlsUI();
            });
            
            // 定期更新日誌數量
            setInterval(() => this.updateLogControlsUI(), 2000);
        }

        // 播放器控制按鈕
        this.bindButton('integrated-prev-btn', () => window.player?.handlePrevious());
        this.bindButton('integrated-play-pause-btn', () => window.player?.handlePlayPause());
        this.bindButton('integrated-next-btn', () => window.player?.handleNext());

        // 系統控制按鈕
        this.bindButton('integrated-refresh-btn', () => window.player?.checkCurrentTrackWithRateLimit());
        this.bindButton('integrated-devices-btn', () => window.player?.showDevicesModal());
        this.bindButton('integrated-playlist-btn', () => window.player?.showPlaylistModal());
    }

    bindButton(id, callback) {
        const button = document.getElementById(id);
        if (button && callback) {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                callback();
                this.addClickEffect(button);
                this.scheduleAutoHide(2000); // 操作後2秒自動隱藏
            });
        }
    }

    bindEdgeDetection() {
        // 右邊緣檢測
        document.addEventListener('mousemove', (e) => {
            const rightDistance = window.innerWidth - e.clientX;
            if (rightDistance <= 30 && !this.isVisible) {
                this.showPanel();
                this.scheduleAutoHide(3000);
            }
        });
    }

    showPanel() {
        const panel = document.querySelector('.lyrics-controls.integrated');
        if (panel) {
            panel.classList.add('show');
            this.isVisible = true;
        }
    }

    hidePanel() {
        const panel = document.querySelector('.lyrics-controls.integrated');
        if (panel) {
            panel.classList.remove('show');
            this.isVisible = false;
        }
    }

    togglePanel() {
        if (this.isVisible) {
            this.hidePanel();
        } else {
            this.showPanel();
            this.scheduleAutoHide(5000);
        }
    }

    scheduleAutoHide(delay = 3000) {
        this.clearAutoHide();
        this.autoHideTimeout = setTimeout(() => {
            this.hidePanel();
        }, delay);
    }

    clearAutoHide() {
        if (this.autoHideTimeout) {
            clearTimeout(this.autoHideTimeout);
            this.autoHideTimeout = null;
        }
    }

    addClickEffect(button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = '';
        }, 150);
    }

    updateLogControlsUI() {
        if (!window.enhancedAutoErrorLogger) return;

        const toggleBtn = document.getElementById('integrated-toggle-auto-btn');
        const logCount = document.getElementById('integrated-log-count');

        if (toggleBtn) {
            const isEnabled = window.enhancedAutoErrorLogger.autoDownloadEnabled;
            const toggleIcon = toggleBtn.querySelector('.btn-icon');
            const toggleText = toggleBtn.querySelector('.btn-text');
            
            if (toggleIcon) toggleIcon.textContent = isEnabled ? '🔒' : '🔓';
            if (toggleText) toggleText.textContent = isEnabled ? '停用自動' : '啟用自動';
            
            toggleBtn.style.background = isEnabled ? 
                'linear-gradient(135deg, #ff6b35, #f7931e)' : 
                'linear-gradient(135deg, #1db954, #1ed760)';
        }

        if (logCount) {
            const count = window.enhancedAutoErrorLogger.logs?.length || 0;
            logCount.textContent = count;
        }
    }

    showLyricsSearchModal() {
        const modal = document.getElementById('lyrics-search-modal');
        if (modal) {
            modal.style.display = 'flex';
        } else if (window.player?.showLyricsSearchModal) {
            window.player.showLyricsSearchModal();
        }
    }

    destroy() {
        const panel = document.querySelector('.lyrics-controls.integrated');
        if (panel) {
            panel.remove();
        }
        
        const styles = document.getElementById('integrated-lyrics-controls-styles');
        if (styles) {
            styles.remove();
        }
        
        this.clearAutoHide();
        
        // 顯示原有的錯誤日誌面板
        const errorLoggerPanel = document.getElementById('error-logger-control-panel');
        if (errorLoggerPanel) {
            errorLoggerPanel.style.display = '';
        }
        
        console.log('🎛️ 整合版歌詞控制系統已停用');
    }
}

// 全域實例
window.integratedLyricsControls = null;

// 自動初始化
document.addEventListener('DOMContentLoaded', () => {
    // 等待其他組件載入
    setTimeout(() => {
        if (window.innerWidth > 767) { // 只在桌面版啟用
            window.integratedLyricsControls = new IntegratedLyricsControls();
        }
    }, 2000);
});

// 響應式檢測
window.addEventListener('resize', () => {
    if (window.innerWidth > 767 && !window.integratedLyricsControls) {
        window.integratedLyricsControls = new IntegratedLyricsControls();
    } else if (window.innerWidth <= 767 && window.integratedLyricsControls) {
        window.integratedLyricsControls.destroy();
        window.integratedLyricsControls = null;
    }
});
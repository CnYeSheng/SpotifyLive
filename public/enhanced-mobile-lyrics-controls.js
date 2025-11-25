/**
 * 增強版手機歌詞控制系統
 * 提供更好看的手機版歌詞控制介面
 */

class EnhancedMobileLyricsControls {
    constructor() {
        this.isMobile = window.innerWidth <= 767;
        this.isControlsVisible = false;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.lastTouchTime = 0;
        
        this.init();
        this.bindEvents();
        
        console.log('📱 增強版手機歌詞控制系統已啟動');
    }

    init() {
        this.createMobileControls();
        this.addStyles();
        this.updateLayout();
    }

    createMobileControls() {
        // 移除舊的控制項（如果存在）
        const existing = document.getElementById('enhanced-mobile-lyrics-controls');
        if (existing) {
            existing.remove();
        }

        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'enhanced-mobile-lyrics-controls';
        controlsContainer.className = 'enhanced-mobile-controls';
        
        controlsContainer.innerHTML = `
            <div class="mobile-controls-trigger" id="mobile-controls-trigger">
                <div class="trigger-icon">🎵</div>
                <div class="trigger-hint">歌詞控制</div>
            </div>
            
            <div class="mobile-controls-panel" id="mobile-controls-panel">
                <div class="panel-header">
                    <span class="panel-title">🎤 歌詞控制</span>
                    <button class="panel-close" id="panel-close">×</button>
                </div>
                
                <div class="panel-content">
                    <!-- 歌詞時間調整 -->
                    <div class="control-group">
                        <div class="group-title">⏰ 時間調整</div>
                        <div class="button-row">
                            <button class="control-btn fast-btn" data-action="lyrics-fast" title="快0.5秒">
                                <span class="btn-icon">⏪</span>
                                <span class="btn-text">快0.5s</span>
                            </button>
                            <button class="control-btn reset-btn" data-action="lyrics-reset" title="重置時間">
                                <span class="btn-icon">🔄</span>
                                <span class="btn-text">重置</span>
                            </button>
                            <button class="control-btn slow-btn" data-action="lyrics-slow" title="慢0.5秒">
                                <span class="btn-icon">⏩</span>
                                <span class="btn-text">慢0.5s</span>
                            </button>
                        </div>
                    </div>

                    <!-- 歌詞顯示設定 -->
                    <div class="control-group">
                        <div class="group-title">📝 顯示設定</div>
                        <div class="button-row">
                            <button class="control-btn scroll-btn" data-action="auto-scroll" title="自動滾動">
                                <span class="btn-icon">📜</span>
                                <span class="btn-text">自動滾動</span>
                            </button>
                            <button class="control-btn font-btn" data-action="font-size" title="字體大小">
                                <span class="btn-icon">🔤</span>
                                <span class="btn-text">字體大小</span>
                            </button>
                            <button class="control-btn search-btn" data-action="search-lyrics" title="搜尋歌詞">
                                <span class="btn-icon">🔍</span>
                                <span class="btn-text">搜尋歌詞</span>
                            </button>
                        </div>
                    </div>

                    <!-- 歌詞操作 -->
                    <div class="control-group">
                        <div class="group-title">💾 歌詞操作</div>
                        <div class="button-row">
                            <button class="control-btn save-btn" data-action="save-lyrics" title="保存歌詞">
                                <span class="btn-icon">💾</span>
                                <span class="btn-text">保存歌詞</span>
                            </button>
                            <button class="control-btn reload-btn" data-action="reload-lyrics" title="重新載入">
                                <span class="btn-icon">🔃</span>
                                <span class="btn-text">重新載入</span>
                            </button>
                        </div>
                    </div>

                    <!-- 快速操作 -->
                    <div class="control-group">
                        <div class="group-title">⚡ 快速操作</div>
                        <div class="button-row">
                            <button class="control-btn prev-btn" data-action="prev-track" title="上一首">
                                <span class="btn-icon">⏮️</span>
                                <span class="btn-text">上一首</span>
                            </button>
                            <button class="control-btn play-pause-btn" data-action="play-pause" title="播放/暫停">
                                <span class="btn-icon">⏯️</span>
                                <span class="btn-text">播放/暫停</span>
                            </button>
                            <button class="control-btn next-btn" data-action="next-track" title="下一首">
                                <span class="btn-icon">⏭️</span>
                                <span class="btn-text">下一首</span>
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="panel-footer">
                    <div class="swipe-hint">👆 向上滑動關閉</div>
                </div>
            </div>
            
            <div class="mobile-controls-backdrop" id="mobile-controls-backdrop"></div>
        `;
        
        document.body.appendChild(controlsContainer);
    }

    addStyles() {
        if (document.getElementById('enhanced-mobile-controls-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'enhanced-mobile-controls-styles';
        style.textContent = `
            .enhanced-mobile-controls {
                position: fixed;
                z-index: 10000;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }

            /* 觸發按鈕 */
            .mobile-controls-trigger {
                position: fixed;
                right: 16px;
                top: 50%;
                transform: translateY(-50%);
                width: 56px;
                height: 120px;
                background: linear-gradient(135deg, #1db954, #1ed760);
                border-radius: 28px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                box-shadow: 0 8px 24px rgba(29, 185, 84, 0.3);
                cursor: pointer;
                transition: all 0.3s ease;
                border: 2px solid rgba(255, 255, 255, 0.2);
                backdrop-filter: blur(10px);
                opacity: 0.85;
            }

            .mobile-controls-trigger:hover,
            .mobile-controls-trigger:active {
                transform: translateY(-50%) scale(1.05);
                opacity: 1;
                box-shadow: 0 12px 32px rgba(29, 185, 84, 0.4);
            }

            .trigger-icon {
                font-size: 24px;
                color: white;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }

            .trigger-hint {
                font-size: 10px;
                color: white;
                text-align: center;
                font-weight: 500;
                line-height: 1.2;
                letter-spacing: 0.5px;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
                writing-mode: vertical-lr;
                text-orientation: mixed;
            }

            /* 控制面板 */
            .mobile-controls-panel {
                position: fixed;
                bottom: -100%;
                left: 0;
                right: 0;
                background: rgba(0, 0, 0, 0.95);
                backdrop-filter: blur(20px);
                border-radius: 20px 20px 0 0;
                transition: bottom 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
                max-height: 80vh;
                overflow-y: auto;
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
            }

            .mobile-controls-panel.show {
                bottom: 0;
            }

            .panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 20px 20px 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                position: sticky;
                top: 0;
                background: inherit;
                backdrop-filter: inherit;
                z-index: 1;
            }

            .panel-title {
                font-size: 18px;
                font-weight: 600;
                color: white;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
            }

            .panel-close {
                width: 32px;
                height: 32px;
                border: none;
                border-radius: 16px;
                background: rgba(255, 255, 255, 0.1);
                color: white;
                font-size: 18px;
                font-weight: bold;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            }

            .panel-close:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: scale(1.1);
            }

            .panel-content {
                padding: 20px;
            }

            .control-group {
                margin-bottom: 24px;
            }

            .control-group:last-child {
                margin-bottom: 0;
            }

            .group-title {
                font-size: 14px;
                font-weight: 600;
                color: #1db954;
                margin-bottom: 12px;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
                letter-spacing: 0.5px;
            }

            .button-row {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }

            .control-btn {
                flex: 1;
                min-width: 0;
                padding: 16px 12px;
                border: none;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: white;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 6px;
                font-family: inherit;
                position: relative;
                overflow: hidden;
            }

            .control-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
                transition: left 0.5s ease;
            }

            .control-btn:hover::before {
                left: 100%;
            }

            .control-btn:hover {
                background: rgba(255, 255, 255, 0.15);
                transform: translateY(-2px);
                box-shadow: 0 8px 24px rgba(29, 185, 84, 0.2);
                border-color: rgba(29, 185, 84, 0.3);
            }

            .control-btn:active {
                transform: translateY(0);
                background: rgba(29, 185, 84, 0.3);
            }

            .control-btn.active {
                background: linear-gradient(135deg, #1db954, #1ed760);
                box-shadow: 0 4px 16px rgba(29, 185, 84, 0.4);
            }

            .btn-icon {
                font-size: 20px;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            }

            .btn-text {
                font-size: 11px;
                font-weight: 500;
                text-align: center;
                line-height: 1.2;
                opacity: 0.9;
            }

            .panel-footer {
                padding: 16px 20px 20px;
                text-align: center;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }

            .swipe-hint {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.6);
                font-weight: 500;
            }

            /* 背景遮罩 */
            .mobile-controls-backdrop {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(4px);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
                z-index: -1;
            }

            .mobile-controls-backdrop.show {
                opacity: 1;
                visibility: visible;
            }

            /* 桌面版隱藏 */
            @media (min-width: 768px) {
                .enhanced-mobile-controls {
                    display: none;
                }
            }

            /* 動畫效果 */
            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .control-group {
                animation: fadeInUp 0.3s ease forwards;
            }

            .control-group:nth-child(1) { animation-delay: 0.1s; }
            .control-group:nth-child(2) { animation-delay: 0.2s; }
            .control-group:nth-child(3) { animation-delay: 0.3s; }
            .control-group:nth-child(4) { animation-delay: 0.4s; }

            /* 滾動條樣式 */
            .mobile-controls-panel::-webkit-scrollbar {
                width: 4px;
            }

            .mobile-controls-panel::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
            }

            .mobile-controls-panel::-webkit-scrollbar-thumb {
                background: rgba(29, 185, 84, 0.6);
                border-radius: 2px;
            }
        `;
        
        document.head.appendChild(style);
    }

    bindEvents() {
        const trigger = document.getElementById('mobile-controls-trigger');
        const panel = document.getElementById('mobile-controls-panel');
        const backdrop = document.getElementById('mobile-controls-backdrop');
        const closeBtn = document.getElementById('panel-close');

        // 觸發按鈕點擊
        trigger?.addEventListener('click', () => {
            this.showControls();
        });

        // 關閉按鈕
        closeBtn?.addEventListener('click', () => {
            this.hideControls();
        });

        // 背景點擊關閉
        backdrop?.addEventListener('click', () => {
            this.hideControls();
        });

        // 控制按鈕事件
        panel?.addEventListener('click', (e) => {
            const btn = e.target.closest('.control-btn');
            if (btn) {
                const action = btn.dataset.action;
                this.handleControlAction(action, btn);
            }
        });

        // 手勢支持
        this.bindTouchEvents();

        // 響應式檢測
        window.addEventListener('resize', () => {
            this.updateLayout();
        });

        // ESC 鍵關閉
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isControlsVisible) {
                this.hideControls();
            }
        });
    }

    bindTouchEvents() {
        const panel = document.getElementById('mobile-controls-panel');
        
        panel?.addEventListener('touchstart', (e) => {
            this.touchStartY = e.touches[0].clientY;
            this.lastTouchTime = Date.now();
        });

        panel?.addEventListener('touchmove', (e) => {
            const touchY = e.touches[0].clientY;
            const deltaY = touchY - this.touchStartY;
            
            // 向下滑動時允許關閉面板
            if (deltaY > 50 && panel.scrollTop <= 0) {
                e.preventDefault();
                const opacity = Math.max(0, 1 - deltaY / 200);
                panel.style.transform = `translateY(${Math.max(0, deltaY - 50)}px)`;
                panel.style.opacity = opacity;
            }
        });

        panel?.addEventListener('touchend', (e) => {
            const touchEndY = e.changedTouches[0].clientY;
            const deltaY = touchEndY - this.touchStartY;
            const deltaTime = Date.now() - this.lastTouchTime;
            
            // 重置樣式
            panel.style.transform = '';
            panel.style.opacity = '';
            
            // 快速向下滑動或滑動距離足夠時關閉
            if ((deltaY > 100) || (deltaY > 50 && deltaTime < 300)) {
                this.hideControls();
            }
        });
    }

    showControls() {
        const panel = document.getElementById('mobile-controls-panel');
        const backdrop = document.getElementById('mobile-controls-backdrop');
        
        if (panel && backdrop) {
            panel.classList.add('show');
            backdrop.classList.add('show');
            this.isControlsVisible = true;
            
            // 防止背景滾動
            document.body.style.overflow = 'hidden';
        }
    }

    hideControls() {
        const panel = document.getElementById('mobile-controls-panel');
        const backdrop = document.getElementById('mobile-controls-backdrop');
        
        if (panel && backdrop) {
            panel.classList.remove('show');
            backdrop.classList.remove('show');
            this.isControlsVisible = false;
            
            // 恢復背景滾動
            document.body.style.overflow = '';
        }
    }

    handleControlAction(action, buttonElement) {
        console.log(`📱 執行手機控制操作: ${action}`);
        
        // 添加點擊回饋效果
        this.addClickFeedback(buttonElement);
        
        // 根據不同操作執行對應功能
        switch (action) {
            case 'lyrics-fast':
                this.triggerLyricsControl('lyrics-fast-btn');
                break;
            case 'lyrics-reset':
                this.triggerLyricsControl('lyrics-reset-btn');
                break;
            case 'lyrics-slow':
                this.triggerLyricsControl('lyrics-slow-btn');
                break;
            case 'auto-scroll':
                this.triggerLyricsControl('auto-scroll-btn');
                this.toggleButtonState(buttonElement);
                break;
            case 'font-size':
                this.triggerLyricsControl('font-size-btn');
                break;
            case 'search-lyrics':
                this.triggerLyricsControl('search-lyrics-btn');
                break;
            case 'save-lyrics':
                this.saveLyrics();
                break;
            case 'reload-lyrics':
                this.reloadLyrics();
                break;
            case 'prev-track':
                this.triggerPlayerControl('prev-btn');
                break;
            case 'play-pause':
                this.triggerPlayerControl('play-pause-btn');
                break;
            case 'next-track':
                this.triggerPlayerControl('next-btn');
                break;
            default:
                console.log(`❓ 未知的控制操作: ${action}`);
        }
    }

    addClickFeedback(buttonElement) {
        buttonElement.style.transform = 'scale(0.95)';
        setTimeout(() => {
            buttonElement.style.transform = '';
        }, 150);
    }

    toggleButtonState(buttonElement) {
        buttonElement.classList.toggle('active');
    }

    triggerLyricsControl(buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.click();
        } else {
            console.log(`❌ 找不到歌詞控制按鈕: ${buttonId}`);
        }
    }

    triggerPlayerControl(buttonId) {
        const button = document.getElementById(buttonId);
        if (button) {
            button.click();
        } else {
            console.log(`❌ 找不到播放器控制按鈕: ${buttonId}`);
        }
    }

    saveLyrics() {
        if (window.player && typeof window.player.saveLyrics === 'function') {
            window.player.saveLyrics();
            this.showToast('💾 歌詞已保存');
        } else {
            this.showToast('❌ 無法保存歌詞');
        }
    }

    reloadLyrics() {
        if (window.player && typeof window.player.loadLyrics === 'function') {
            window.player.loadLyrics();
            this.showToast('🔃 歌詞重新載入中...');
        } else {
            this.showToast('❌ 無法重新載入歌詞');
        }
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'mobile-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 20px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10001;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: fadeInOut 2s ease forwards;
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInOut {
                0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                15%, 85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
            style.remove();
        }, 2000);
    }

    updateLayout() {
        const wasMobile = this.isMobile;
        this.isMobile = window.innerWidth <= 767;
        
        const controls = document.getElementById('enhanced-mobile-lyrics-controls');
        if (controls) {
            controls.style.display = this.isMobile ? 'block' : 'none';
        }
        
        // 如果從手機切換到桌面，隱藏控制面板
        if (wasMobile && !this.isMobile && this.isControlsVisible) {
            this.hideControls();
        }
    }

    destroy() {
        // 移除控制項
        const controls = document.getElementById('enhanced-mobile-lyrics-controls');
        if (controls) {
            controls.remove();
        }
        
        // 移除樣式
        const styles = document.getElementById('enhanced-mobile-controls-styles');
        if (styles) {
            styles.remove();
        }
        
        // 恢復背景滾動
        document.body.style.overflow = '';
        
        console.log('📱 增強版手機歌詞控制系統已停用');
    }
}

// 全域控制
window.enhancedMobileLyricsControls = null;

// 自動初始化
document.addEventListener('DOMContentLoaded', () => {
    // 只在手機裝置上初始化
    if (window.innerWidth <= 767) {
        window.enhancedMobileLyricsControls = new EnhancedMobileLyricsControls();
    }
});

// 響應式初始化檢查
window.addEventListener('resize', () => {
    if (window.innerWidth <= 767 && !window.enhancedMobileLyricsControls) {
        window.enhancedMobileLyricsControls = new EnhancedMobileLyricsControls();
    } else if (window.innerWidth > 767 && window.enhancedMobileLyricsControls) {
        window.enhancedMobileLyricsControls.destroy();
        window.enhancedMobileLyricsControls = null;
    }
});
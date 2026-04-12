// 移動端優化模塊
const MobileOptimizer = {
    isMobile: false,
    isTablet: false,
    
    // 斷點配置
    breakpoints: {
        mobile: 768,
        tablet: 1024
    },
    
    // 初始化
    init() {
        this.detectDevice();
        this.applyOptimizations();
        this.setupEventListeners();
        
        console.log(`[Mobile] Initialized - Mobile: ${this.isMobile}, Tablet: ${this.isTablet}`);
    },
    
    // 檢測設備類型
    detectDevice() {
        const width = window.innerWidth;
        this.isMobile = width < this.breakpoints.mobile;
        this.isTablet = width >= this.breakpoints.mobile && width < this.breakpoints.tablet;
        
        // 添加設備類到 body
        document.body.classList.remove('device-mobile', 'device-tablet', 'device-desktop');
        if (this.isMobile) {
            document.body.classList.add('device-mobile');
        } else if (this.isTablet) {
            document.body.classList.add('device-tablet');
        } else {
            document.body.classList.add('device-desktop');
        }
    },
    
    // 應用優化
    applyOptimizations() {
        if (!this.isMobile && !this.isTablet) {
            return;
        }
        
        // 調整字體大小
        this.adjustFontSizes();
        
        // 優化按鈕觸控面積
        this.optimizeTouchTargets();
        
        // 優化導航欄
        this.optimizeNavbar();
        
        // 優化歌詞顯示
        this.optimizeLyricsDisplay();
        
        // 優化圖片加載
        this.optimizeImages();
    },
    
    // 調整字體大小
    adjustFontSizes() {
        const root = document.documentElement;
        
        if (this.isMobile) {
            // 移動端字體縮小
            root.style.setProperty('--font-size-base', '14px');
            root.style.setProperty('--font-size-lg', '16px');
            root.style.setProperty('--font-size-xl', '18px');
            root.style.setProperty('--font-size-xxl', '20px');
        } else if (this.isTablet) {
            // 平板字體適中
            root.style.setProperty('--font-size-base', '15px');
            root.style.setProperty('--font-size-lg', '17px');
            root.style.setProperty('--font-size-xl', '19px');
            root.style.setProperty('--font-size-xxl', '22px');
        }
    },
    
    // 優化觸控目標
    optimizeTouchTargets() {
        // 最小觸控區域 44x44px (Apple HIG 建議)
        const minTouchSize = 44;
        
        const buttons = document.querySelectorAll('button, .btn, [role="button"]');
        buttons.forEach(btn => {
            const rect = btn.getBoundingClientRect();
            
            if (rect.width < minTouchSize || rect.height < minTouchSize) {
                btn.classList.add('touch-optimized');
                
                // 設置最小尺寸
                if (rect.width < minTouchSize) {
                    btn.style.minWidth = `${minTouchSize}px`;
                }
                if (rect.height < minTouchSize) {
                    btn.style.minHeight = `${minTouchSize}px`;
                }
            }
        });
        
        // 為鏈接添加觸控優化
        const links = document.querySelectorAll('a[href]');
        links.forEach(link => {
            link.classList.add('touch-optimized');
        });
    },
    
    // 優化導航欄
    optimizeNavbar() {
        const navbar = document.querySelector('.navbar, .nav, header');
        if (!navbar) return;
        
        if (this.isMobile) {
            // 移動端：簡化導航，可能使用漢堡菜單
            navbar.classList.add('mobile-nav');
            
            // 檢查是否有漢堡菜單按鈕，沒有則創建
            let toggleBtn = navbar.querySelector('.nav-toggle, .hamburger');
            if (!toggleBtn) {
                toggleBtn = document.createElement('button');
                toggleBtn.className = 'nav-toggle';
                toggleBtn.setAttribute('aria-label', '切換導航');
                toggleBtn.innerHTML = `
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                `;
                
                toggleBtn.addEventListener('click', () => {
                    navbar.classList.toggle('nav-open');
                });
                
                navbar.insertBefore(toggleBtn, navbar.firstChild);
            }
        }
    },
    
    // 優化歌詞顯示
    optimizeLyricsDisplay() {
        const lyricsContainer = document.querySelector('.lyrics-container, #lyrics');
        if (!lyricsContainer) return;
        
        if (this.isMobile) {
            // 移動端：單列顯示，增大行距
            lyricsContainer.classList.add('mobile-lyrics');
            lyricsContainer.style.lineHeight = '1.8';
            lyricsContainer.style.padding = '10px';
            
            // 禁用懸停效果
            const lines = lyricsContainer.querySelectorAll('.lyrics-line');
            lines.forEach(line => {
                line.style.transition = 'none';
            });
        }
    },
    
    // 優化圖片加載
    optimizeImages() {
        // 實施懶加載
        const images = document.querySelectorAll('img[data-src], img.lazy');
        
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                        }
                        img.classList.add('loaded');
                        observer.unobserve(img);
                    }
                });
            });
            
            images.forEach(img => imageObserver.observe(img));
        } else {
            // 降級方案：直接加載
            images.forEach(img => {
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }
            });
        }
    },
    
    // 設置事件監聽器
    setupEventListeners() {
        // 窗口大小改變時重新檢測
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.detectDevice();
                this.applyOptimizations();
                
                // 觸發自定義事件
                window.dispatchEvent(new CustomEvent('deviceChanged', {
                    detail: {
                        isMobile: this.isMobile,
                        isTablet: this.isTablet,
                        width: window.innerWidth
                    }
                }));
            }, 250);
        });
        
        // 觸摸設備優化
        if ('ontouchstart' in window) {
            document.body.classList.add('touch-device');
            
            // 移除 hover 樣式（觸摸設備不需要）
            const style = document.createElement('style');
            style.textContent = `
                .touch-device *:hover {
                    /* 禁用 hover 效果 */
                }
                .touch-device button:active,
                .touch-device .btn:active {
                    transform: scale(0.98);
                }
            `;
            document.head.appendChild(style);
        }
    },
    
    // 獲取設備信息
    getDeviceInfo() {
        return {
            isMobile: this.isMobile,
            isTablet: this.isTablet,
            isDesktop: !this.isMobile && !this.isTablet,
            width: window.innerWidth,
            height: window.innerHeight,
            pixelRatio: window.devicePixelRatio || 1,
            isTouch: 'ontouchstart' in window
        };
    },
    
    // 檢查是否為特定設備
    isDevice(type) {
        switch(type) {
            case 'mobile':
                return this.isMobile;
            case 'tablet':
                return this.isTablet;
            case 'desktop':
                return !this.isMobile && !this.isTablet;
            default:
                return false;
        }
    }
};

// 自動初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        MobileOptimizer.init();
    });
}

// 導出模塊
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileOptimizer;
}

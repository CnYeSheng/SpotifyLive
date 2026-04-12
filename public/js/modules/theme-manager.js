// 主題切換模塊
const ThemeManager = {
    currentTheme: 'dark',
    
    themes: {
        light: {
            name: 'Light',
            variables: {
                '--bg-primary': '#ffffff',
                '--bg-secondary': '#f5f5f5',
                '--bg-tertiary': '#e0e0e0',
                '--text-primary': '#1a1a1a',
                '--text-secondary': '#4a4a4a',
                '--text-tertiary': '#6a6a6a',
                '--accent-color': '#1db954',
                '--accent-hover': '#1ed760',
                '--border-color': '#e0e0e0',
                '--shadow-color': 'rgba(0, 0, 0, 0.1)',
                '--card-bg': '#ffffff',
                '--player-bg': '#f8f8f8',
                '--lyrics-text': '#1a1a1a',
                '--lyrics-highlight': '#1db954',
                '--scrollbar-thumb': '#c0c0c0',
                '--scrollbar-track': '#f0f0f0'
            }
        },
        dark: {
            name: 'Dark',
            variables: {
                '--bg-primary': '#121212',
                '--bg-secondary': '#1a1a1a',
                '--bg-tertiary': '#282828',
                '--text-primary': '#ffffff',
                '--text-secondary': '#b3b3b3',
                '--text-tertiary': '#8a8a8a',
                '--accent-color': '#1db954',
                '--accent-hover': '#1ed760',
                '--border-color': '#333333',
                '--shadow-color': 'rgba(0, 0, 0, 0.3)',
                '--card-bg': '#181818',
                '--player-bg': '#121212',
                '--lyrics-text': '#ffffff',
                '--lyrics-highlight': '#1db954',
                '--scrollbar-thumb': '#5a5a5a',
                '--scrollbar-track': '#2a2a2a'
            }
        },
        ocean: {
            name: 'Ocean',
            variables: {
                '--bg-primary': '#0a1628',
                '--bg-secondary': '#0f2442',
                '--bg-tertiary': '#1a3a6e',
                '--text-primary': '#e0f0ff',
                '--text-secondary': '#a8c8e8',
                '--text-tertiary': '#7aa8c8',
                '--accent-color': '#00d4ff',
                '--accent-hover': '#33ddff',
                '--border-color': '#1a4a7e',
                '--shadow-color': 'rgba(0, 100, 200, 0.2)',
                '--card-bg': '#0f2a4a',
                '--player-bg': '#0a1e3a',
                '--lyrics-text': '#e0f0ff',
                '--lyrics-highlight': '#00d4ff',
                '--scrollbar-thumb': '#1a5a8a',
                '--scrollbar-track': '#0a2a4a'
            }
        },
        sunset: {
            name: 'Sunset',
            variables: {
                '--bg-primary': '#1a0a1a',
                '--bg-secondary': '#2a1a2a',
                '--bg-tertiary': '#3a2a3a',
                '--text-primary': '#ffe0f0',
                '--text-secondary': '#ffb8d8',
                '--text-tertiary': '#ff90c0',
                '--accent-color': '#ff6b9d',
                '--accent-hover': '#ff85ab',
                '--border-color': '#4a2a4a',
                '--shadow-color': 'rgba(200, 50, 100, 0.2)',
                '--card-bg': '#2a1a2a',
                '--player-bg': '#1a0a1a',
                '--lyrics-text': '#ffe0f0',
                '--lyrics-highlight': '#ff6b9d',
                '--scrollbar-thumb': '#6a3a5a',
                '--scrollbar-track': '#3a1a2a'
            }
        }
    },
    
    // 初始化
    init() {
        // 從 localStorage 讀取用戶偏好（優先使用 app_theme）
        const savedTheme = localStorage.getItem('app_theme') || localStorage.getItem('theme');
        
        if (savedTheme && this.themes[savedTheme]) {
            this.currentTheme = savedTheme;
        } else {
            // 檢測系統偏好
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.currentTheme = prefersDark ? 'dark' : 'light';
        }
        
        // 應用主題
        this.applyTheme(this.currentTheme);
        
        console.log(`[Theme] Initialized with theme: ${this.currentTheme}`);
    },
    
    // 應用主題
    applyTheme(themeName) {
        const theme = this.themes[themeName];
        if (!theme) {
            console.warn(`[Theme] Unknown theme: ${themeName}`);
            return false;
        }
        
        const root = document.documentElement;
        
        // 設置 CSS 變數
        Object.entries(theme.variables).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });
        
        // 更新 data-theme 屬性
        root.setAttribute('data-theme', themeName);
        
        // 移除所有主題類
        Object.keys(this.themes).forEach(t => {
            root.classList.remove(`theme-${t}`);
        });
        
        // 添加當前主題類
        root.classList.add(`theme-${themeName}`);
        
        console.log(`[Theme] Applied theme: ${themeName}`);
        return true;
    },
    
    // 切換主題
    setTheme(themeName) {
        if (!this.themes[themeName]) {
            console.warn(`[Theme] Unknown theme: ${themeName}`);
            return false;
        }
        
        this.currentTheme = themeName;
        localStorage.setItem('app_theme', themeName); // 使用 app_theme 作為統一存儲
        localStorage.setItem('theme', themeName); // 保持向後兼容
        this.applyTheme(themeName);
        
        // 觸發自定義事件
        window.dispatchEvent(new CustomEvent('themeChanged', {
            detail: { theme: themeName }
        }));
        
        console.log(`[Theme] Theme changed to: ${themeName}`);
        return true;
    },
    
    // 切換到下一個主題
    toggleTheme() {
        const themeKeys = Object.keys(this.themes);
        const currentIndex = themeKeys.indexOf(this.currentTheme);
        const nextIndex = (currentIndex + 1) % themeKeys.length;
        const nextTheme = themeKeys[nextIndex];
        
        this.setTheme(nextTheme);
        return nextTheme;
    },
    
    // 獲取當前主題
    getCurrentTheme() {
        return this.currentTheme;
    },
    
    // 獲取所有可用主題
    getAvailableThemes() {
        return Object.keys(this.themes).map(key => ({
            key,
            name: this.themes[key].name
        }));
    },
    
    // 獲取主題信息
    getThemeInfo(themeName) {
        return this.themes[themeName] || null;
    }
};

// 自動初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        ThemeManager.init();
    });
}

// 導出模塊
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeManager;
}

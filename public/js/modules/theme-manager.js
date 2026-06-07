// 主題切換模塊 - 已簡化為預設 Spotify 風格
const ThemeManager = {
    currentTheme: 'dark',
    
    themes: {
        dark: {
            name: 'Spotify Dark',
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
                '--shadow-color': 'rgba(0, 0, 0, 0.5)',
                '--card-bg': '#181818',
                '--player-bg': '#121212',
                '--lyrics-text': '#ffffff',
                '--lyrics-highlight': '#1db954',
                '--scrollbar-thumb': '#5a5a5a',
                '--scrollbar-track': '#2a2a2a'
            }
        }
    },
    
    // 初始化
    init() {
        // 固定使用 dark 主題
        this.currentTheme = 'dark';
        this.applyTheme(this.currentTheme);
        console.log(`[Theme] Initialized with Spotify default theme`);
    },
    
    // 應用主題
    applyTheme(themeName) {
        const theme = this.themes['dark']; // 強制使用 dark
        const root = document.documentElement;
        
        // 設置 CSS 變數
        Object.entries(theme.variables).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });
        
        // 更新 data-theme 屬性
        root.setAttribute('data-theme', 'dark');
        
        // 移除所有主題類並添加當前主題類
        root.classList.remove('theme-light', 'theme-ocean', 'theme-sunset');
        root.classList.add('theme-dark');
        
        return true;
    },
    
    // 切換主題 (此版本僅保留單一主題)
    setTheme(themeName) {
        return this.applyTheme('dark');
    },
    
    // 切換到下一個主題 (此版本僅保留單一主題)
    toggleTheme() {
        return 'dark';
    },
    
    // 獲取當前主題
    getCurrentTheme() {
        return 'dark';
    },
    
    // 獲取所有可用主題
    getAvailableThemes() {
        return [{ key: 'dark', name: 'Spotify Dark' }];
    },
    
    // 獲取主題信息
    getThemeInfo(themeName) {
        return this.themes['dark'];
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

// 多語言支持模塊
const I18nManager = {
    currentLang: 'zh-TW',
    
    translations: {
        'zh-TW': {
            // 認證區域
            'app.title': 'Spotify 即時歌詞播放器',
            'auth.connect': '連接你的 Spotify 帳戶來查看正在播放的音樂和即時歌詞',
            'auth.login': '連接 Spotify',
            
            // 播放器控制
            'player.shuffle': '隨機播放',
            'player.prev': '上一首',
            'player.play': '播放',
            'player.pause': '暫停',
            'player.next': '下一首',
            'player.repeat': '重複播放',
            'player.addPlaylist': '加入播放清單',
            'player.playlist': '播放清單',
            'player.lyrics': '歌詞',
            'player.queue': '播放佇列',
            'player.devices': '播放設備',
            'player.volume': '音量',
            
            // 下一首預覽
            'player.nextSong': '下一首',
            'player.settings': '設置',
            
            // 歌詞顯示
            'lyrics.loading': '載入歌詞中...',
            'lyrics.notFound': '暫無歌詞',
            'lyrics.syncError': '同步失敗',
            'lyrics.manual': '手動歌詞',
            'lyrics.autoScroll': '自動滾動',
            'lyrics.fontSize': '字體大小',
            'lyrics.language': '語言',
            
            // 設置
            'settings.title': '設置',
            'settings.language': '語言',
            'settings.theme': '主題',
            'settings.notifications': '通知',
            'settings.autoPlay': '自動播放',
            'settings.showCover': '顯示封面',
            'settings.save': '儲存',
            'settings.cancel': '取消',
            
            // 主題
            'theme.light': '明亮',
            'theme.dark': '深色',
            'theme.ocean': '海洋',
            'theme.sunset': '日落',
            
            // 語言
            'lang.zh-TW': '繁體中文',
            'lang.en': 'English',
            'lang.ja': '日本語',
            
            // 錯誤訊息
            'error.authFailed': '認證失敗，請重試',
            'error.networkError': '網絡錯誤，請檢查連接',
            'error.apiLimit': 'API 請求次數已達上限',
            'error.playerError': '播放器錯誤',
            'error.lyricsLoadFailed': '歌詞載入失敗',
            
            // 狀態
            'status.connected': '已連接',
            'status.disconnected': '未連接',
            'status.loading': '載入中',
            'status.playing': '播放中',
            'status.paused': '已暫停',
            
            // 其他
            'common.close': '關閉',
            'common.confirm': '確認',
            'common.delete': '刪除',
            'common.edit': '編輯',
            'common.search': '搜尋',
            'common.refresh': '重新整理'
        },
        
        'en': {
            // Auth
            'app.title': 'Spotify Real-time Lyrics Player',
            'auth.connect': 'Connect your Spotify account to view playing music and real-time lyrics',
            'auth.login': 'Connect Spotify',
            
            // Player Controls
            'player.shuffle': 'Shuffle',
            'player.prev': 'Previous',
            'player.play': 'Play',
            'player.pause': 'Pause',
            'player.next': 'Next',
            'player.repeat': 'Repeat',
            'player.addPlaylist': 'Add to Playlist',
            'player.playlist': 'Playlist',
            'player.lyrics': 'Lyrics',
            'player.queue': 'Queue',
            'player.devices': 'Devices',
            'player.volume': 'Volume',
            
            // Next Song Preview
            'player.nextSong': 'Next',
            'player.settings': 'Settings',
            
            // Lyrics
            'lyrics.loading': 'Loading lyrics...',
            'lyrics.notFound': 'No lyrics available',
            'lyrics.syncError': 'Sync failed',
            'lyrics.manual': 'Manual lyrics',
            'lyrics.autoScroll': 'Auto scroll',
            'lyrics.fontSize': 'Font size',
            'lyrics.language': 'Language',
            
            // Settings
            'settings.title': 'Settings',
            'settings.language': 'Language',
            'settings.theme': 'Theme',
            'settings.notifications': 'Notifications',
            'settings.autoPlay': 'Auto play',
            'settings.showCover': 'Show cover',
            'settings.save': 'Save',
            'settings.cancel': 'Cancel',
            
            // Themes
            'theme.light': 'Light',
            'theme.dark': 'Dark',
            'theme.ocean': 'Ocean',
            'theme.sunset': 'Sunset',
            
            // Languages
            'lang.zh-TW': 'Traditional Chinese',
            'lang.en': 'English',
            'lang.ja': 'Japanese',
            
            // Errors
            'error.authFailed': 'Authentication failed, please try again',
            'error.networkError': 'Network error, please check connection',
            'error.apiLimit': 'API rate limit exceeded',
            'error.playerError': 'Player error',
            'error.lyricsLoadFailed': 'Failed to load lyrics',
            
            // Status
            'status.connected': 'Connected',
            'status.disconnected': 'Disconnected',
            'status.loading': 'Loading',
            'status.playing': 'Playing',
            'status.paused': 'Paused',
            
            // Common
            'common.close': 'Close',
            'common.confirm': 'Confirm',
            'common.delete': 'Delete',
            'common.edit': 'Edit',
            'common.search': 'Search',
            'common.refresh': 'Refresh'
        },
        
        'ja': {
            // Auth
            'app.title': 'Spotify リアルタイム歌詞プレイヤー',
            'auth.connect': 'Spotify アカウントを接続して、再生中の音楽とリアルタイム歌詞を表示',
            'auth.login': 'Spotify に接続',
            
            // Player Controls
            'player.shuffle': 'シャッフル',
            'player.prev': '前へ',
            'player.play': '再生',
            'player.pause': '一時停止',
            'player.next': '次へ',
            'player.repeat': 'リピート',
            'player.addPlaylist': 'プレイリストに追加',
            'player.playlist': 'プレイリスト',
            'player.lyrics': '歌詞',
            'player.queue': 'キュー',
            'player.devices': 'デバイス',
            'player.volume': 'ボリューム',
            
            // Next Song Preview
            'player.nextSong': '次の曲',
            'player.settings': '設定',
            
            // Lyrics
            'lyrics.loading': '歌詞を読み込んでいます...',
            'lyrics.notFound': '歌詞がありません',
            'lyrics.syncError': '同期に失敗しました',
            'lyrics.manual': '手動歌詞',
            'lyrics.autoScroll': '自動スクロール',
            'lyrics.fontSize': 'フォントサイズ',
            'lyrics.language': '言語',
            
            // Settings
            'settings.title': '設定',
            'settings.language': '言語',
            'settings.theme': 'テーマ',
            'settings.notifications': '通知',
            'settings.autoPlay': '自動再生',
            'settings.showCover': 'カバーを表示',
            'settings.save': '保存',
            'settings.cancel': 'キャンセル',
            
            // Themes
            'theme.light': 'ライト',
            'theme.dark': 'ダーク',
            'theme.ocean': 'オーシャン',
            'theme.sunset': 'サンセット',
            
            // Languages
            'lang.zh-TW': '繁体字中国語',
            'lang.en': '英語',
            'lang.ja': '日本語',
            
            // Errors
            'error.authFailed': '認証に失敗しました。もう一度お試しください',
            'error.networkError': 'ネットワークエラー。接続を確認してください',
            'error.apiLimit': 'API レート制限を超えました',
            'error.playerError': 'プレーヤーエラー',
            'error.lyricsLoadFailed': '歌詞の読み込みに失敗しました',
            
            // Status
            'status.connected': '接続済み',
            'status.disconnected': '未接続',
            'status.loading': '読み込み中',
            'status.playing': '再生中',
            'status.paused': '一時停止中',
            
            // Common
            'common.close': '閉じる',
            'common.confirm': '確認',
            'common.delete': '削除',
            'common.edit': '編集',
            'common.search': '検索',
            'common.refresh': '更新'
        }
    },
    
    // 初始化
    init() {
        // 檢測瀏覽器語言
        const browserLang = navigator.language || navigator.userLanguage;
        const supportedLangs = ['zh-TW', 'en', 'ja'];
        
        // 嘗試匹配語言
        let detectedLang = 'zh-TW';
        if (supportedLangs.includes(browserLang)) {
            detectedLang = browserLang;
        } else {
            // 檢查語言前綴
            const langPrefix = browserLang.split('-')[0];
            const matched = supportedLangs.find(lang => lang.startsWith(langPrefix));
            if (matched) {
                detectedLang = matched;
            }
        }
        
        // 從 localStorage 讀取用戶偏好
        const savedLang = localStorage.getItem('i18n_lang');
        if (savedLang && supportedLangs.includes(savedLang)) {
            this.currentLang = savedLang;
        } else {
            this.currentLang = detectedLang;
        }
        
        // 應用翻譯
        this.applyTranslations();
        
        console.log(`[I18n] Initialized with language: ${this.currentLang}`);
    },
    
    // 獲取翻譯文本
    t(key, params = {}) {
        const langData = this.translations[this.currentLang] || this.translations['zh-TW'];
        let text = langData[key] || key;
        
        // 替換參數
        Object.keys(params).forEach(paramKey => {
            text = text.replace(`{${paramKey}}`, params[paramKey]);
        });
        
        return text;
    },
    
    // 應用翻譯到 DOM
    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const text = this.t(key);
            
            if (element.tagName === 'INPUT' || element.tagName === 'BUTTON') {
                if (element.placeholder !== undefined) {
                    element.placeholder = text;
                } else {
                    element.textContent = text;
                }
            } else {
                element.textContent = text;
            }
        });
        
        // 更新 title 屬性
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            element.setAttribute('title', this.t(key));
        });
        
        // 更新 html lang 屬性
        document.documentElement.lang = this.currentLang;
        
        // 觸發自定義事件
        window.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { lang: this.currentLang } 
        }));
    },
    
    // 切換語言
    setLanguage(lang) {
        const supportedLangs = Object.keys(this.translations);
        if (!supportedLangs.includes(lang)) {
            console.warn(`[I18n] Unsupported language: ${lang}`);
            return false;
        }
        
        this.currentLang = lang;
        localStorage.setItem('i18n_lang', lang);
        this.applyTranslations();
        
        console.log(`[I18n] Language changed to: ${lang}`);
        return true;
    },
    
    // 獲取當前語言
    getCurrentLanguage() {
        return this.currentLang;
    },
    
    // 獲取所有支持的語言
    getSupportedLanguages() {
        return Object.keys(this.translations).map(code => ({
            code,
            name: this.translations[code][`lang.${code}`] || code
        }));
    }
};

// 自動初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        I18nManager.init();
    });
}

// 導出模塊
if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18nManager;
}

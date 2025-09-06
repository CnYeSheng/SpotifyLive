// 自動更新系統配置文件
// Auto-Update System Configuration

const AutoUpdateConfig = {
    // 基本設置
    basic: {
        // 是否啟用自動更新系統
        enabled: true,
        
        // 是否在控制台顯示詳細日誌
        verboseLogging: true,
        
        // 是否顯示用戶通知
        showNotifications: true,
        
        // 是否在頁面標題顯示狀態
        showStatusInTitle: false
    },
    
    // Token 和認證設置
    authentication: {
        // Token 自動刷新
        autoRefreshToken: true,
        
        // 提前多久刷新 Token (分鐘)
        refreshBeforeExpiry: 5,
        
        // Token 檢查間隔 (分鐘)
        tokenCheckInterval: 30,
        
        // Session 心跳檢查間隔 (分鐘)
        sessionHeartbeatInterval: 10,
        
        // 認證失敗時的重試次數
        authRetryAttempts: 3,
        
        // 是否自動處理認證錯誤
        autoHandleAuthErrors: true
    },
    
    // 播放狀態更新設置
    playback: {
        // 是否啟用播放狀態自動更新
        enabled: true,
        
        // 播放時的更新間隔 (秒)
        playingUpdateInterval: 3,
        
        // 暫停時的更新間隔 (秒)
        pausedUpdateInterval: 15,
        
        // 是否在歌曲結尾加速更新
        accelerateNearEnd: true,
        
        // 歌曲結尾加速更新的時間 (秒)
        nearEndThreshold: 10,
        
        // 歌曲結尾時的更新間隔 (秒)
        nearEndUpdateInterval: 2,
        
        // 是否自動載入新歌詞
        autoLoadLyrics: true,
        
        // 歌詞載入延遲 (毫秒)
        lyricsLoadDelay: 1500
    },
    
    // 設備管理設置
    devices: {
        // 是否啟用設備列表自動更新
        enabled: true,
        
        // 設備列表更新間隔 (分鐘)
        updateInterval: 2,
        
        // 是否緩存設備列表
        cacheDevices: true,
        
        // 設備緩存有效期 (分鐘)
        cacheExpiry: 10,
        
        // 是否自動檢測活躍設備變化
        detectActiveDeviceChange: true
    },
    
    // 隊列管理設置
    queue: {
        // 是否啟用隊列自動更新
        enabled: true,
        
        // 隊列更新間隔 (秒)
        updateInterval: 30,
        
        // 是否緩存隊列
        cacheQueue: true,
        
        // 隊列緩存有效期 (分鐘)
        cacheExpiry: 5,
        
        // 隊列顯示的最大歌曲數
        maxDisplayItems: 20
    },
    
    // 用戶資料設置
    userProfile: {
        // 是否啟用用戶資料自動更新
        enabled: true,
        
        // 用戶資料更新間隔 (小時)
        updateInterval: 1,
        
        // 是否緩存用戶資料
        cacheProfile: true,
        
        // 用戶資料緩存有效期 (小時)
        cacheExpiry: 24,
        
        // 是否自動檢測 Premium 狀態變化
        detectPremiumChange: true
    },
    
    // 喜歡歌曲設置
    likedSongs: {
        // 是否啟用喜歡歌曲自動更新
        enabled: true,
        
        // 是否在歌曲變化時自動檢查喜歡狀態
        autoCheckOnTrackChange: true,
        
        // 是否緩存喜歡歌曲列表
        cacheLikedSongs: true,
        
        // 喜歡歌曲緩存有效期 (小時)
        cacheExpiry: 6,
        
        // 是否預載入喜歡歌曲列表
        preloadLikedSongs: false
    },
    
    // 網絡和錯誤處理設置
    network: {
        // 請求超時時間 (毫秒)
        requestTimeout: 10000,
        
        // 最大重試次數
        maxRetries: 3,
        
        // 重試延遲倍數
        retryBackoffMultiplier: 2,
        
        // 基礎重試延遲 (毫秒)
        baseRetryDelay: 1000,
        
        // 是否在網絡重新連接時自動更新
        updateOnReconnect: true,
        
        // 是否在頁面重新可見時自動更新
        updateOnVisibilityChange: true
    },
    
    // 性能優化設置
    performance: {
        // 是否啟用智能更新頻率調整
        adaptiveUpdateFrequency: true,
        
        // 用戶操作後的加速更新時間 (秒)
        userActionAccelerationDuration: 30,
        
        // 是否在後台標籤頁降低更新頻率
        reduceBackgroundUpdates: true,
        
        // 後台更新頻率倍數
        backgroundUpdateMultiplier: 3,
        
        // 是否啟用數據壓縮
        enableDataCompression: false,
        
        // 是否批量處理更新
        batchUpdates: true
    },
    
    // 存儲設置
    storage: {
        // 是否啟用本地存儲
        enableLocalStorage: true,
        
        // 存儲數據的前綴
        storagePrefix: 'spotify_auto_',
        
        // 是否加密存儲的敏感數據
        encryptSensitiveData: false,
        
        // 存儲清理間隔 (小時)
        cleanupInterval: 24,
        
        // 最大存儲大小 (MB)
        maxStorageSize: 10
    },
    
    // 調試和監控設置
    debug: {
        // 是否啟用調試模式
        enabled: false,
        
        // 是否記錄所有 API 調用
        logAllApiCalls: false,
        
        // 是否顯示性能指標
        showPerformanceMetrics: false,
        
        // 是否啟用錯誤追蹤
        enableErrorTracking: true,
        
        // 錯誤報告的詳細程度 (1-3)
        errorReportingLevel: 2
    },
    
    // 實驗性功能
    experimental: {
        // 是否啟用預測性更新
        predictiveUpdates: false,
        
        // 是否啟用離線模式
        offlineMode: false,
        
        // 是否啟用 WebSocket 連接
        useWebSocket: false,
        
        // 是否啟用機器學習優化
        mlOptimization: false
    }
};

// 配置驗證函數
function validateConfig(config) {
    const errors = [];
    
    // 檢查必需的配置項
    if (!config.basic || typeof config.basic.enabled !== 'boolean') {
        errors.push('basic.enabled 必須是布爾值');
    }
    
    // 檢查數值範圍
    if (config.authentication?.refreshBeforeExpiry < 1 || config.authentication?.refreshBeforeExpiry > 60) {
        errors.push('authentication.refreshBeforeExpiry 必須在 1-60 分鐘之間');
    }
    
    if (config.playback?.playingUpdateInterval < 1 || config.playback?.playingUpdateInterval > 60) {
        errors.push('playback.playingUpdateInterval 必須在 1-60 秒之間');
    }
    
    // 檢查網絡設置
    if (config.network?.maxRetries < 0 || config.network?.maxRetries > 10) {
        errors.push('network.maxRetries 必須在 0-10 之間');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// 配置合併函數
function mergeConfig(defaultConfig, userConfig) {
    function deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }
    
    return deepMerge(defaultConfig, userConfig);
}

// 配置轉換函數（將用戶友好的配置轉換為系統內部格式）
function convertToSystemConfig(userConfig) {
    return {
        token: {
            interval: userConfig.authentication.tokenCheckInterval * 60 * 1000,
            preemptiveTime: userConfig.authentication.refreshBeforeExpiry * 60 * 1000,
            enabled: userConfig.authentication.autoRefreshToken
        },
        session: {
            interval: userConfig.authentication.sessionHeartbeatInterval * 60 * 1000,
            enabled: userConfig.basic.enabled
        },
        userProfile: {
            interval: userConfig.userProfile.updateInterval * 60 * 60 * 1000,
            enabled: userConfig.userProfile.enabled
        },
        devices: {
            interval: userConfig.devices.updateInterval * 60 * 1000,
            enabled: userConfig.devices.enabled
        },
        playbackState: {
            interval: userConfig.playback.playingUpdateInterval * 1000,
            pausedInterval: userConfig.playback.pausedUpdateInterval * 1000,
            enabled: userConfig.playback.enabled
        },
        queue: {
            interval: userConfig.queue.updateInterval * 1000,
            enabled: userConfig.queue.enabled
        },
        likedSongs: {
            interval: 5 * 60 * 1000, // 固定 5 分鐘
            enabled: userConfig.likedSongs.enabled
        }
    };
}

// 預設配置組合
const ConfigPresets = {
    // 高性能模式 - 最快的更新頻率
    performance: {
        playback: {
            playingUpdateInterval: 1,
            pausedUpdateInterval: 5,
            nearEndUpdateInterval: 1
        },
        devices: {
            updateInterval: 1
        },
        queue: {
            updateInterval: 10
        }
    },
    
    // 節能模式 - 較慢的更新頻率
    battery: {
        playback: {
            playingUpdateInterval: 10,
            pausedUpdateInterval: 60,
            nearEndUpdateInterval: 5
        },
        devices: {
            updateInterval: 10
        },
        queue: {
            updateInterval: 120
        },
        authentication: {
            tokenCheckInterval: 60,
            sessionHeartbeatInterval: 30
        }
    },
    
    // 平衡模式 - 默認設置
    balanced: AutoUpdateConfig,
    
    // 最小模式 - 只更新必要的數據
    minimal: {
        basic: {
            enabled: true,
            verboseLogging: false,
            showNotifications: false
        },
        playback: {
            enabled: true,
            playingUpdateInterval: 5,
            pausedUpdateInterval: 30
        },
        devices: {
            enabled: false
        },
        queue: {
            enabled: false
        },
        userProfile: {
            enabled: false
        },
        likedSongs: {
            enabled: false
        }
    }
};

// 導出配置
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AutoUpdateConfig,
        validateConfig,
        mergeConfig,
        convertToSystemConfig,
        ConfigPresets
    };
} else if (typeof window !== 'undefined') {
    window.AutoUpdateConfig = AutoUpdateConfig;
    window.validateConfig = validateConfig;
    window.mergeConfig = mergeConfig;
    window.convertToSystemConfig = convertToSystemConfig;
    window.ConfigPresets = ConfigPresets;
    
    // 提供簡單的配置設置方法
    window.setAutoUpdateConfig = function(preset = 'balanced', customConfig = {}) {
        let baseConfig;
        
        if (typeof preset === 'string' && ConfigPresets[preset]) {
            baseConfig = ConfigPresets[preset];
        } else if (typeof preset === 'object') {
            baseConfig = preset;
            customConfig = customConfig || {};
        } else {
            baseConfig = ConfigPresets.balanced;
        }
        
        const finalConfig = mergeConfig(baseConfig, customConfig);
        const validation = validateConfig(finalConfig);
        
        if (!validation.isValid) {
            console.error('❌ 配置驗證失敗:', validation.errors);
            return false;
        }
        
        // 應用配置到自動更新系統
        if (window.spotifyPlayer && window.spotifyPlayer.autoUpdater) {
            const systemConfig = convertToSystemConfig(finalConfig);
            window.spotifyPlayer.autoUpdater.updateConfig(systemConfig);
            console.log('✅ 自動更新配置已應用');
            return true;
        } else {
            console.warn('⚠️ 播放器未初始化，配置將在初始化時應用');
            window._pendingAutoUpdateConfig = finalConfig;
            return true;
        }
    };
    
    console.log('⚙️ 自動更新配置系統已載入');
    console.log('使用 setAutoUpdateConfig("performance") 設置高性能模式');
    console.log('使用 setAutoUpdateConfig("battery") 設置節能模式');
    console.log('使用 setAutoUpdateConfig("minimal") 設置最小模式');
}
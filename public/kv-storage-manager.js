// KV 存儲管理器 - 前端
// Frontend KV Storage Manager

class KVStorageManager {
    constructor() {
        this.apiBase = window.location.origin;
        this.kvAvailable = false;
        this.userKey = '';
        this.fallbackToLocalStorage = true;
        
        // 初始化檢查 KV 狀態
        this.checkKVStatus();
    }

    // 檢查 KV 存儲狀態
    async checkKVStatus() {
    try {
        // ✨ 修复：添加完整的 URL
        const statusUrl = window.location.origin + '/api/kv/status';
        console.log(`🔍 检查 KV 状态，URL: ${statusUrl}`);
        
        const response = await fetch(statusUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin'
        });
        
        // ✨ 修复：检查响应类型
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.warn(`⚠️ KV 状态检查返回非 JSON 内容: ${contentType}`);
            console.warn(`📝 响应状态: ${response.status}`);
            
            // 尝试读取响应体以调试
            const text = await response.text();
            console.error(`📄 响应内容: ${text.substring(0, 200)}`);
            
            this.kvAvailable = false;
            return;
        }

        const data = await response.json();
        
        if (data.success) {
            this.kvAvailable = data.kvAvailable;
            this.userKey = data.userKey;
            console.log(`✅ KV 状态: ${this.kvAvailable ? 'Available' : 'Not Available'}, 用户: ${this.userKey}`);
            
            // 检查迁移状态
            const migrationCompleted = localStorage.getItem('kv_migration_completed') === 'true';
            const migrationSkipped = localStorage.getItem('kv_migration_skip') === 'true';
            
            // 如果 KV 可用但有本地数据且还未迁移过
            if (this.kvAvailable && 
                this.hasLocalStorageData() && 
                !migrationCompleted && 
                !migrationSkipped) {
                
                console.log('📄 发现未迁移的数据，提示用户迁移');
                this.promptForMigration();
            } else if (migrationCompleted) {
                console.log('✅ 已记录迁移完成，不再提示');
            }
        } else {
            console.warn('无法检查 KV 状态:', data.error);
            this.kvAvailable = false;
        }
    } catch (error) {
        console.error('❌ 检查 KV 状态失败:', error.message);
        this.kvAvailable = false;
        
        // 调试信息
        console.error('📍 错误类型:', error.constructor.name);
        console.error('📍 错误堆栈:', error.stack);
    }
}

    // 新增：检查用户是否选择永久跳过迁移
    skipMigrationPermanently() {
        localStorage.setItem('kv_migration_skip', 'true');
        console.log('⏭️ 用户选择永久跳过 KV 迁移');
    }

    // 檢查是否有 localStorage 數據
    hasLocalStorageData() {
        try {
            const customLyrics = localStorage.getItem('user_custom_lyrics');
            const providers = localStorage.getItem('user_lyrics_providers');
            return !!(customLyrics || providers);
        } catch (error) {
            return false;
        }
    }

    // 提示用戶遷移數據
    promptForMigration() {
    // 检查是否已经迁移过（使用标记）
        const migrationFlag = localStorage.getItem('kv_migration_completed');
        
        if (migrationFlag === 'true') {
            console.log('✅ 已完成 KV 迁移，跳过提示');
            return;
        }
        
        if (confirm('检测到本地存储的用户数据，是否要迁移到云端存储？这样可以在不同设备间同步您的设置。')) {
            this.migrateToKV();
        } else {
            // 用户选择不迁移，也设置标记避免重复提示
            localStorage.setItem('kv_migration_skip', 'true');
            console.log('ℹ️ 用户选择不迁移数据');
        }
    }

    // =================
    // 用戶自定義歌詞管理
    // =================

    // 保存用戶自定義歌詞 (雙存儲策略：KV + localStorage)
    async saveUserCustomLyrics(trackInfo, lyrics, lyricsType, source) {
        const data = {
            trackInfo, lyrics, lyricsType, source,
            timestamp: Date.now(), lastUsed: Date.now()
        };
        
        let kvSuccess = false;
        let localSuccess = false;

        // 1. 先嘗試保存到 KV (如果可用)
        if (this.kvAvailable) {
            try {
                const s = JSON.parse(localStorage.getItem('spotify_session_data') || '{}');
                const profile = JSON.parse(localStorage.getItem('spotify_user_profile') || '{}');
                const headers = { 'Content-Type': 'application/json' };
                if (s && s.sessionId) {
                    headers['X-Session-Id'] = s.sessionId;
                } else {
                    const sid = localStorage.getItem('spotify_session_id');
                    if (sid) headers['X-Session-Id'] = sid;
                }
                if (profile && profile.userId) headers['X-Spotify-User-Id'] = profile.userId;
                const response = await fetch(`${this.apiBase}/api/kv/user-lyrics`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                if (result.success) {
                    kvSuccess = true;
                    console.log('✅ KV: 用戶自定義歌詞已保存');
                } else {
                    console.warn('⚠️ KV 保存失敗:', result.error);
                }
            } catch (error) {
                console.error('❌ KV 保存失敗:', error);
            }
        }

        // 2. 總是保存到 localStorage 作為本地備份和快速訪問
        try {
            localSuccess = this.saveToLocalStorage('user_custom_lyrics', trackInfo, data);
            if (localSuccess) {
                console.log('💾 localStorage: 用戶自定義歌詞已保存');
            }
        } catch (error) {
            console.error('❌ localStorage 保存失敗:', error);
        }

        // 3. 只要有一個存儲成功就算成功
        const success = kvSuccess || localSuccess;
        
        if (success) {
            console.log(`📦 歌詞保存完成 - KV: ${kvSuccess}, Local: ${localSuccess}`);
        } else {
            console.error('❌ 所有存儲方式都失敗了');
        }
        
        return success;
    }

    // 獲取用戶自定義歌詞 (優先 localStorage 快速響應，然後同步 KV)
    async getUserCustomLyrics(trackInfo) {
        // 1. 首先從 localStorage 快速獲取 (即時響應)
        let localData = null;
        try {
            localData = this.getFromLocalStorage('user_custom_lyrics', trackInfo);
            if (localData) {
                console.log('🎯 localStorage: 找到用戶自定義歌詞 (快速響應)');
            }
        } catch (error) {
            console.error('❌ localStorage 獲取失敗:', error);
        }

        // 2. 如果 KV 可用，同時檢查 KV 數據 (可能更新)
        if (this.kvAvailable) {
            try {
                const artist = encodeURIComponent(trackInfo.artist || '');
                const title = encodeURIComponent(trackInfo.name || '');
                const id = trackInfo.id || '';
                
                const response = await fetch(
                    `${this.apiBase}/api/kv/user-lyrics/${artist}/${title}?id=${encodeURIComponent(id)}`
                );
                
                const data = await response.json();
                if (data.success && data.data) {
                    const kvData = data.data;
                    console.log('🎯 KV: 找到用戶自定義歌詞');
                    
                    // 3. 比較兩個數據源，使用更新的版本
                    if (!localData || kvData.lastUsed > localData.lastUsed) {
                        console.log('🔄 KV 數據較新，同步到 localStorage');
                        this.saveToLocalStorage('user_custom_lyrics', trackInfo, kvData);
                        return kvData;
                    } else if (localData.lastUsed > kvData.lastUsed) {
                        console.log('🔄 localStorage 數據較新，同步到 KV');
                        // 背景同步到 KV (不阻塞用戶)
                        this.syncToKVBackground('user_custom_lyrics', trackInfo, localData);
                    }
                }
            } catch (error) {
                console.error('❌ KV 獲取失敗:', error);
            }
        }

        // 4. 返回 localStorage 數據 (如果存在)
        return localData;
    }

    // 保存用戶歌詞供應商偏好 (雙存儲策略：KV + localStorage)
    async saveUserLyricsProvider(trackInfo, provider) {
        const data = {
            trackInfo, provider, 
            timestamp: Date.now(), lastUsed: Date.now()
        };
        
        let kvSuccess = false;
        let localSuccess = false;

        // 1. 先嘗試保存到 KV (如果可用)
        if (this.kvAvailable) {
            try {
                const s = JSON.parse(localStorage.getItem('spotify_session_data') || '{}');
                const profile = JSON.parse(localStorage.getItem('spotify_user_profile') || '{}');
                const headers = { 'Content-Type': 'application/json' };
                if (s && s.sessionId) {
                    headers['X-Session-Id'] = s.sessionId;
                } else {
                    const sid = localStorage.getItem('spotify_session_id');
                    if (sid) headers['X-Session-Id'] = sid;
                }
                if (profile && profile.userId) headers['X-Spotify-User-Id'] = profile.userId;
                const response = await fetch(`${this.apiBase}/api/kv/user-provider`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                if (result.success) {
                    kvSuccess = true;
                    console.log('✅ KV: 用戶供應商偏好已保存');
                } else {
                    console.warn('⚠️ KV 保存失敗:', result.error);
                }
            } catch (error) {
                console.error('❌ KV 保存失敗:', error);
            }
        }

        // 2. 總是保存到 localStorage 作為本地備份和快速訪問
        try {
            localSuccess = this.saveToLocalStorage('user_lyrics_providers', trackInfo, data);
            if (localSuccess) {
                console.log('💾 localStorage: 用戶供應商偏好已保存');
            }
        } catch (error) {
            console.error('❌ localStorage 保存失敗:', error);
        }

        // 3. 只要有一個存儲成功就算成功
        const success = kvSuccess || localSuccess;
        
        if (success) {
            console.log(`📦 供應商偏好保存完成 - KV: ${kvSuccess}, Local: ${localSuccess}`);
        } else {
            console.error('❌ 所有存儲方式都失敗了');
        }
        
        return success;
    }

    // 獲取用戶歌詞供應商偏好 (優先 localStorage 快速響應，然後同步 KV)
    async getUserLyricsProvider(trackInfo) {
        // 1. 首先從 localStorage 快速獲取 (即時響應)
        let localData = null;
        try {
            localData = this.getFromLocalStorage('user_lyrics_providers', trackInfo);
            if (localData) {
                console.log('🎯 localStorage: 找到用戶供應商偏好 (快速響應)');
            }
        } catch (error) {
            console.error('❌ localStorage 獲取失敗:', error);
        }

        // 2. 如果 KV 可用，同時檢查 KV 數據 (可能更新)
        if (this.kvAvailable) {
            try {
                const artist = encodeURIComponent(trackInfo.artist || '');
                const title = encodeURIComponent(trackInfo.name || '');
                const id = trackInfo.id || '';
                
                const response = await fetch(
                    `${this.apiBase}/api/kv/user-provider/${artist}/${title}?id=${encodeURIComponent(id)}`
                );
                
                const data = await response.json();
                if (data.success && data.data) {
                    const kvData = data.data;
                    console.log('🎯 KV: 找到用戶供應商偏好');
                    
                    // 3. 比較兩個數據源，使用更新的版本
                    if (!localData || kvData.lastUsed > localData.lastUsed) {
                        console.log('🔄 KV 數據較新，同步到 localStorage');
                        this.saveToLocalStorage('user_lyrics_providers', trackInfo, kvData);
                        return kvData.provider;
                    } else if (localData.lastUsed > kvData.lastUsed) {
                        console.log('🔄 localStorage 數據較新，同步到 KV');
                        // 背景同步到 KV (不阻塞用戶)
                        this.syncToKVBackground('user_lyrics_providers', trackInfo, localData);
                    }
                }
            } catch (error) {
                console.error('❌ KV 獲取失敗:', error);
            }
        }

        // 4. 返回 localStorage 數據 (如果存在)
        return localData ? localData.provider : null;
    }

    // =================
    // LocalStorage 備用方法
    // =================

    // 生成歌曲唯一標識符
    generateTrackKey(trackInfo) {
        const artist = trackInfo.artist || trackInfo.artists?.[0]?.name || '';
        const name = trackInfo.name || trackInfo.title || '';
        const id = trackInfo.id || '';
        
        return `${id}-${artist}-${name}`.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-_]/g, '');
    }

    // 保存到 localStorage
    saveToLocalStorage(storageKey, trackInfo, data) {
        try {
            const trackKey = this.generateTrackKey(trackInfo);
            const existingData = JSON.parse(localStorage.getItem(storageKey) || '{}');
            existingData[trackKey] = { ...data, trackKey };
            localStorage.setItem(storageKey, JSON.stringify(existingData));
            console.log(`💾 localStorage: 已保存 ${storageKey}`);
            return true;
        } catch (error) {
            console.error(`❌ localStorage 保存失敗:`, error);
            return false;
        }
    }

    // 從 localStorage 獲取
    getFromLocalStorage(storageKey, trackInfo) {
        try {
            const trackKey = this.generateTrackKey(trackInfo);
            const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
            const userData = data[trackKey];
            
            if (userData) {
                userData.lastUsed = Date.now();
                data[trackKey] = userData;
                localStorage.setItem(storageKey, JSON.stringify(data));
                console.log(`🎯 localStorage: 找到 ${storageKey}`);
                return userData;
            }
            return null;
        } catch (error) {
            console.error(`❌ localStorage 獲取失敗:`, error);
            return null;
        }
    }

    // 遷移數據到 KV
    async migrateToKV() {
        if (!this.kvAvailable) {
            throw new Error('KV Storage 不可用');
        }

        try {
            const localStorageData = {
                user_custom_lyrics: localStorage.getItem('user_custom_lyrics'),
                user_lyrics_providers: localStorage.getItem('user_lyrics_providers')
            };

            const response = await fetch(`${this.apiBase}/api/kv/migrate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ localStorageData })
            });

            const data = await response.json();
            if (data.success) {
                console.log(`✅ 数据迁移完成，共迁移 ${data.data.migratedCount} 条记录`);
                
                // ✨ 关键修改：设置迁移完成标记
                localStorage.setItem('kv_migration_completed', 'true');
                
                // 立即清空本地存储的数据（而不是询问用户）
                localStorage.removeItem('user_custom_lyrics');
                localStorage.removeItem('user_lyrics_providers');
                localStorage.removeItem('kv_migration_skip');
                
                console.log('🧹 已清空本地存储数据');
                
                return data.data;
            } else {
                throw new Error(data.error || '迁移失败');
            }
        } catch (error) {
            console.error('数据迁移失败:', error);
            throw error;
        }
    }

    // =================
    // 背景同步功能
    // =================

    // 背景同步到 KV (不阻塞用戶界面)
    syncToKVBackground(storageType, trackInfo, data) {
        if (!this.kvAvailable) return;

        // 使用 setTimeout 讓同步在下一個事件循環執行
        setTimeout(async () => {
            try {
                const endpoint = storageType === 'user_custom_lyrics' ? 
                    '/api/kv/user-lyrics' : '/api/kv/user-provider';
                const s = JSON.parse(localStorage.getItem('spotify_session_data') || '{}');
                const profile = JSON.parse(localStorage.getItem('spotify_user_profile') || '{}');
                const headers = { 'Content-Type': 'application/json' };
                if (s && s.sessionId) {
                    headers['X-Session-Id'] = s.sessionId;
                } else {
                    const sid = localStorage.getItem('spotify_session_id');
                    if (sid) headers['X-Session-Id'] = sid;
                }
                if (profile && profile.userId) headers['X-Spotify-User-Id'] = profile.userId;
                const body = storageType === 'user_custom_lyrics'
                    ? JSON.stringify({ trackInfo, lyrics: data.lyrics, lyricsType: data.lyricsType, source: data.source })
                    : JSON.stringify({ trackInfo, provider: data.provider });
                const response = await fetch(`${this.apiBase}${endpoint}`, {
                    method: 'POST',
                    headers,
                    body
                });

                if (response.ok) {
                    console.log(`🔄 背景同步成功: ${storageType}`);
                } else {
                    console.warn(`⚠️ 背景同步失敗: ${storageType}`);
                }
            } catch (error) {
                console.error(`❌ 背景同步錯誤: ${storageType}`, error);
            }
        }, 100);
    }

    // 批量背景同步 localStorage 到 KV
    async syncAllLocalDataToKV() {
        if (!this.kvAvailable) {
            console.log('📴 KV 不可用，跳過同步');
            return { skipped: true };
        }

        console.log('🔄 開始批量同步 localStorage 數據到 KV...');
        
        let syncedCount = 0;
        let errorCount = 0;

        try {
            // 同步自定義歌詞
            const customLyrics = this.getAllFromLocalStorage('user_custom_lyrics');
            for (const lyricData of customLyrics) {
                try {
                    await this.saveUserCustomLyrics(
                        lyricData.trackInfo, 
                        lyricData.lyrics, 
                        lyricData.lyricsType, 
                        lyricData.source
                    );
                    syncedCount++;
                } catch (error) {
                    errorCount++;
                    console.warn('同步歌詞失敗:', lyricData.trackInfo, error);
                }
            }

            // 同步供應商偏好
            const providerPrefs = this.getAllFromLocalStorage('user_lyrics_providers');
            for (const prefData of providerPrefs) {
                try {
                    await this.saveUserLyricsProvider(prefData.trackInfo, prefData.provider);
                    syncedCount++;
                } catch (error) {
                    errorCount++;
                    console.warn('同步供應商偏好失敗:', prefData.trackInfo, error);
                }
            }

            console.log(`✅ 批量同步完成 - 成功: ${syncedCount}, 失敗: ${errorCount}`);
            return { success: true, syncedCount, errorCount };

        } catch (error) {
            console.error('❌ 批量同步失敗:', error);
            return { success: false, error: error.message };
        }
    }

    // =================
    // 數據清理和維護
    // =================

    // 清理舊的 localStorage 數據 (保留最近30天)
    cleanupOldLocalData(daysToKeep = 30) {
        const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        let cleanedCount = 0;

        try {
            // 清理自定義歌詞
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            Object.keys(customLyrics).forEach(trackKey => {
                const data = customLyrics[trackKey];
                if (data.lastUsed < cutoffTime) {
                    delete customLyrics[trackKey];
                    cleanedCount++;
                }
            });
            localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));

            // 清理供應商偏好
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            Object.keys(providers).forEach(trackKey => {
                const data = providers[trackKey];
                if (data.lastUsed < cutoffTime) {
                    delete providers[trackKey];
                    cleanedCount++;
                }
            });
            localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));

            console.log(`🧹 清理了 ${cleanedCount} 條舊數據 (超過 ${daysToKeep} 天)`);
            return cleanedCount;

        } catch (error) {
            console.error('❌ 清理舊數據失敗:', error);
            return 0;
        }
    }

    // =================
    // 混合存儲策略管理
    // =================

    // 強制從 KV 刷新 localStorage 數據
    async refreshFromKV() {
        if (!this.kvAvailable) {
            console.log('📴 KV 不可用，無法刷新');
            return false;
        }

        console.log('🔄 從 KV 刷新 localStorage 數據...');
        
        try {
            // 獲取 KV 中的所有用戶數據
            const [customLyrics, providerPrefs] = await Promise.all([
                fetch(`${this.apiBase}/api/kv/user-lyrics`).then(r => r.json()),
                fetch(`${this.apiBase}/api/kv/user-providers`).then(r => r.json())
            ]);

            let refreshedCount = 0;

            // 更新自定義歌詞
            if (customLyrics.success) {
                customLyrics.data.forEach(lyricData => {
                    this.saveToLocalStorage('user_custom_lyrics', lyricData.trackInfo, lyricData);
                    refreshedCount++;
                });
            }

            // 更新供應商偏好
            if (providerPrefs.success) {
                providerPrefs.data.forEach(prefData => {
                    this.saveToLocalStorage('user_lyrics_providers', prefData.trackInfo, prefData);
                    refreshedCount++;
                });
            }

            console.log(`✅ 已從 KV 刷新 ${refreshedCount} 條數據到 localStorage`);
            return true;

        } catch (error) {
            console.error('❌ 從 KV 刷新失敗:', error);
            return false;
        }
    }

    // 檢測並解決數據衝突
    async resolveDataConflicts() {
        console.log('🔍 檢測數據衝突...');
        
        const conflicts = [];
        
        try {
            // 檢查自定義歌詞衝突
            const localLyrics = this.getAllFromLocalStorage('user_custom_lyrics');
            
            for (const localData of localLyrics) {
                const kvData = await this.getUserCustomLyrics(localData.trackInfo);
                
                if (kvData && kvData.lastUsed !== localData.lastUsed) {
                    conflicts.push({
                        type: 'custom_lyrics',
                        trackInfo: localData.trackInfo,
                        local: localData,
                        kv: kvData
                    });
                }
            }

            if (conflicts.length > 0) {
                console.log(`⚠️ 發現 ${conflicts.length} 個數據衝突`);
                // 這裡可以實現衝突解決策略，例如彈出用戶選擇界面
                return conflicts;
            } else {
                console.log('✅ 未發現數據衝突');
                return [];
            }

        } catch (error) {
            console.error('❌ 衝突檢測失敗:', error);
            return [];
        }
    }

    // =================
    // 存儲統計和監控
    // =================

    // 獲取存儲使用統計
    getStorageStats() {
        try {
            const customLyrics = this.getAllFromLocalStorage('user_custom_lyrics');
            const providers = this.getAllFromLocalStorage('user_lyrics_providers');
            
            const stats = {
                customLyricsCount: customLyrics.length,
                providerPrefsCount: providers.length,
                totalLocalStorageSize: this.calculateLocalStorageSize(),
                oldestEntry: this.getOldestEntry(),
                newestEntry: this.getNewestEntry(),
                kvAvailable: this.kvAvailable,
                userKey: this.userKey
            };

            return stats;
        } catch (error) {
            console.error('❌ 獲取存儲統計失敗:', error);
            return null;
        }
    }

    // 計算 localStorage 使用大小
    calculateLocalStorageSize() {
        try {
            const customLyrics = localStorage.getItem('user_custom_lyrics') || '';
            const providers = localStorage.getItem('user_lyrics_providers') || '';
            return new Blob([customLyrics + providers]).size;
        } catch (error) {
            return 0;
        }
    }

    // 獲取最舊的數據條目
    getOldestEntry() {
        try {
            const allData = [
                ...this.getAllFromLocalStorage('user_custom_lyrics'),
                ...this.getAllFromLocalStorage('user_lyrics_providers')
            ];
            
            if (allData.length === 0) return null;
            
            return allData.reduce((oldest, current) => 
                current.timestamp < oldest.timestamp ? current : oldest
            );
        } catch (error) {
            return null;
        }
    }

    // 獲取最新的數據條目
    getNewestEntry() {
        try {
            const allData = [
                ...this.getAllFromLocalStorage('user_custom_lyrics'),
                ...this.getAllFromLocalStorage('user_lyrics_providers')
            ];
            
            if (allData.length === 0) return null;
            
            return allData.reduce((newest, current) => 
                current.timestamp > newest.timestamp ? current : newest
            );
        } catch (error) {
            return null;
        }
    }

    // 獲取存儲狀態 (增強版)
    getStorageStatus() {
        const stats = this.getStorageStats();
        
        return {
            kvAvailable: this.kvAvailable,
            userKey: this.userKey,
            fallbackEnabled: this.fallbackToLocalStorage,
            hasLocalData: this.hasLocalStorageData(),
            stats: stats,
            version: '2.0.0' // KV + localStorage 雙存儲版本
        };
    }

    // =================
    // 用戶控制功能
    // =================

    // 切換存儲模式
    setStorageMode(mode) {
        const validModes = ['hybrid', 'kv-only', 'local-only'];
        
        if (!validModes.includes(mode)) {
            console.error('❌ 無效的存儲模式:', mode);
            return false;
        }

        switch (mode) {
            case 'hybrid':
                this.fallbackToLocalStorage = true;
                console.log('📝 存儲模式: 混合模式 (KV + localStorage)');
                break;
            case 'kv-only':
                this.fallbackToLocalStorage = false;
                console.log('📝 存儲模式: 僅 KV 模式');
                break;
            case 'local-only':
                this.kvAvailable = false;
                this.fallbackToLocalStorage = true;
                console.log('📝 存儲模式: 僅本地模式');
                break;
        }

        return true;
    }

    // 數據導出功能
    exportUserData() {
        try {
            const data = {
                customLyrics: this.getAllFromLocalStorage('user_custom_lyrics'),
                providerPrefs: this.getAllFromLocalStorage('user_lyrics_providers'),
                exportTime: Date.now(),
                userKey: this.userKey,
                version: '2.0.0'
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `spotify-lyrics-data-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            
            URL.revokeObjectURL(url);
            
            console.log('📁 用戶數據已導出');
            return true;
        } catch (error) {
            console.error('❌ 數據導出失敗:', error);
            return false;
        }
    }
}

// 🔧 修复脚本：解决歌词保存失效和时间同步问题
// 添加到 kv-storage-manager.js

class LyricsStorageManager {
    constructor() {
        this.apiBase = window.location.origin;
        this.customLyricsCache = new Map();    // 内存缓存
        this.lyricsTimeOffsets = new Map();    // 时间偏移保存
        this.initStorage();
    }

    // ==================
    // 问题1：歌词过期失效
    // ==================
    // 原因：没有设置 TTL（过期时间）
    // 解决：使用 Upstash Redis 的 EXAT 功能设置 30 天不过期

    async saveUserLyrics(trackInfo, lyrics, lyricsType, source) {
        const trackKey = this.generateTrackKey(trackInfo);
        
        try {
            const lyricsData = {
                trackKey,
                trackInfo: {
                    id: trackInfo.id,
                    name: trackInfo.name,
                    artist: trackInfo.artist
                },
                lyrics,
                lyricsType,
                source,
                timestamp: Date.now(),
                // ✨ 关键：添加更新时间
                lastModified: Date.now(),
                // ✨ 添加版本号以支持未来升级
                version: 2
            };

            // 📤 上传到 Upstash Redis
            const response = await fetch(`${this.apiBase}/api/kv/user-lyrics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lyricsData)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            // 💾 同时保存到本地 localStorage 作为备份
            this.saveToLocalStorageBackup(trackKey, lyricsData);

            console.log(`✅ 歌词已保存（30天不过期）: ${trackInfo.artist} - ${trackInfo.name}`);
            return true;
        } catch (error) {
            console.error('❌ 保存歌词失败:', error);
            // 降级：仅保存到 localStorage
            this.saveToLocalStorageBackup(trackKey, lyricsData);
            return false;
        }
    }

    async getUserLyrics(trackInfo) {
        const trackKey = this.generateTrackKey(trackInfo);

        try {
            // 1️⃣ 先查 Redis（云端）
            const response = await fetch(`${this.apiBase}/api/kv/user-lyrics/${trackKey}`, {
                headers: { 'X-Track-Info': JSON.stringify(trackInfo) }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.data) {
                    console.log(`✅ 从 Redis 读取歌词: ${trackInfo.artist} - ${trackInfo.name}`);
                    
                    // 更新最后使用时间（刷新 30 天计时器）
                    this.refreshLyricsExpiry(trackKey);
                    
                    return data.data;
                }
            }
        } catch (error) {
            console.warn('⚠️ Redis 读取失败，尝试本地:', error.message);
        }

        // 2️⃣ 再查 localStorage（本地备份）
        try {
            const backup = this.getFromLocalStorageBackup(trackKey);
            if (backup) {
                console.log(`✅ 从本地备份读取歌词: ${trackInfo.artist} - ${trackInfo.name}`);
                return backup;
            }
        } catch (error) {
            console.warn('⚠️ 本地备份读取失败:', error);
        }

        console.log(`❌ 未找到歌词: ${trackInfo.artist} - ${trackInfo.name}`);
        return null;
    }

    // ✨ 新功能：刷新歌词过期时间（防止过期）
    async refreshLyricsExpiry(trackKey) {
        try {
            await fetch(`${this.apiBase}/api/kv/refresh-expiry/${trackKey}`, {
                method: 'POST'
            });
            console.log(`🔄 已刷新歌词过期时间: ${trackKey}`);
        } catch (error) {
            console.warn('⚠️ 刷新过期时间失败:', error);
        }
    }

    // ==================
    // 问题2：时间偏移未保存
    // ==================
    // 原因：修改时间偏移后没有保存到云端
    // 解决：每次调整时间时自动保存

    async saveLyricsTimeOffset(trackInfo, offset) {
        const trackKey = this.generateTrackKey(trackInfo);

        try {
            const offsetData = {
                trackKey,
                trackInfo: {
                    id: trackInfo.id,
                    name: trackInfo.name,
                    artist: trackInfo.artist
                },
                timeOffset: offset,
                timestamp: Date.now(),
                // ✨ 添加用户操作标记
                modifiedBy: 'user_adjustment'
            };

            // 📤 上传时间偏移到 Upstash
            const response = await fetch(`${this.apiBase}/api/kv/save-time-offset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(offsetData)
            });

            if (response.ok) {
                console.log(`✅ 时间偏移已保存: ${offset}ms`);
                
                // 💾 同时保存到内存
                this.lyricsTimeOffsets.set(trackKey, offset);
                
                // 💾 保存到 localStorage 备份
                this.saveOffsetToLocalStorage(trackKey, offset);
                
                return true;
            }
        } catch (error) {
            console.error('❌ 保存时间偏移失败:', error);
            // 降级：仅保存到本地
            this.saveOffsetToLocalStorage(trackKey, offset);
            return false;
        }
    }

    async getLyricsTimeOffset(trackInfo) {
        const trackKey = this.generateTrackKey(trackInfo);

        try {
            // 1️⃣ 查 Redis
            const response = await fetch(`${this.apiBase}/api/kv/get-time-offset/${trackKey}`);
            
            if (response.ok) {
                const data = await response.json();
                if (data.timeOffset !== undefined) {
                    console.log(`✅ 读取时间偏移: ${data.timeOffset}ms`);
                    this.lyricsTimeOffsets.set(trackKey, data.timeOffset);
                    return data.timeOffset;
                }
            }
        } catch (error) {
            console.warn('⚠️ Redis 时间偏移读取失败:', error);
        }

        // 2️⃣ 查本地
        try {
            const offset = this.getOffsetFromLocalStorage(trackKey);
            if (offset !== null) {
                console.log(`✅ 从本地读取时间偏移: ${offset}ms`);
                return offset;
            }
        } catch (error) {
            console.warn('⚠️ 本地时间偏移读取失败:', error);
        }

        return 0; // 默认无偏移
    }

    // ==================
    // 本地存储备份方法
    // ==================

    saveToLocalStorageBackup(trackKey, data) {
        try {
            const backups = JSON.parse(localStorage.getItem('lyrics_backup') || '{}');
            backups[trackKey] = {
                ...data,
                backupTime: Date.now()
            };
            localStorage.setItem('lyrics_backup', JSON.stringify(backups));
            console.log(`💾 已备份到 localStorage: ${trackKey}`);
        } catch (error) {
            console.warn('⚠️ localStorage 备份失败:', error);
        }
    }

    getFromLocalStorageBackup(trackKey) {
        try {
            const backups = JSON.parse(localStorage.getItem('lyrics_backup') || '{}');
            return backups[trackKey] || null;
        } catch (error) {
            console.warn('⚠️ localStorage 读取失败:', error);
            return null;
        }
    }

    saveOffsetToLocalStorage(trackKey, offset) {
        try {
            const offsets = JSON.parse(localStorage.getItem('lyrics_offsets') || '{}');
            offsets[trackKey] = {
                offset,
                savedTime: Date.now()
            };
            localStorage.setItem('lyrics_offsets', JSON.stringify(offsets));
        } catch (error) {
            console.warn('⚠️ 本地时间偏移保存失败:', error);
        }
    }

    getOffsetFromLocalStorage(trackKey) {
        try {
            const offsets = JSON.parse(localStorage.getItem('lyrics_offsets') || '{}');
            return offsets[trackKey]?.offset ?? null;
        } catch (error) {
            console.warn('⚠️ 本地时间偏移读取失败:', error);
            return null;
        }
    }

    // ==================
    // 工具方法
    // ==================

    generateTrackKey(trackInfo) {
        const artist = trackInfo.artist || '';
        const name = trackInfo.name || '';
        const id = trackInfo.id || '';
        
        return `${id}-${artist}-${name}`.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-_]/g, '');
    }

    async initStorage() {
        console.log('🎵 歌词存储管理器已初始化');
    }

    // ✨ 新功能：检查和清理过期歌词
    async cleanupExpiredLyrics() {
        console.log('🧹 开始清理过期歌词...');
        
        try {
            const response = await fetch(`${this.apiBase}/api/kv/cleanup-expired`, {
                method: 'POST'
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`✅ 已清理 ${result.deleted} 条过期歌词`);
                return result;
            }
        } catch (error) {
            console.warn('⚠️ 清理过期歌词失败:', error);
        }
    }

    // ✨ 新功能：导出所有歌词（用于备份）
    async exportAllLyrics() {
        try {
            const response = await fetch(`${this.apiBase}/api/kv/export-all-lyrics`);
            
            if (response.ok) {
                const data = await response.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], { 
                    type: 'application/json' 
                });
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `lyrics-backup-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                
                console.log('✅ 歌词已导出');
                return true;
            }
        } catch (error) {
            console.error('❌ 导出歌词失败:', error);
        }

        return false;
    }
}

// 全局实例
window.lyricsStorageManager = new LyricsStorageManager();

// 創建全局實例
window.kvStorageManager = new KVStorageManager();

// 添加一些全局便捷方法
window.kvStorageManager.showStats = function() {
    console.table(this.getStorageStatus());
};

window.kvStorageManager.quickSync = function() {
    return this.syncAllLocalDataToKV();
};

window.kvStorageManager.quickClean = function() {
    return this.cleanupOldLocalData();
};

console.log('📦 KV 存儲管理器已載入 (雙存儲增強版)');

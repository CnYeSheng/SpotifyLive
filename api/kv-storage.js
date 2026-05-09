// api/kv-storage.js

const { Redis } = require('@upstash/redis');
const fs = require('fs');
const path = require('path');

class KVStorageManager {
    constructor() {
        // 檢查 KV 可用性
        this.isKVAvailable = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
        this.redis = null;
        this.cache = new Map();
        this.isVercel = !!process.env.VERCEL;
        this.localSessionsPath = path.join(process.cwd(), 'sessions.json');
        this.initialize();
    }
    
    async initialize() {
        // 1. 如果不在 Vercel 且 Redis 不可用，嘗試從本地文件加載
        if (!this.isKVAvailable && !this.isVercel) {
            this.loadSessionsFromLocalFile();
        }

        if (!this.isKVAvailable) {
            console.log('⚠️ KV Storage 未配置，將使用內存/本地文件存儲');
            return;
        }
        
        try {
            this.redis = new Redis({
                url: process.env.KV_REST_API_URL,
                token: process.env.KV_REST_API_TOKEN
            });
            
            // 測試連接
            await this.redis.set('init_test', 'ok');
            await this.redis.del('init_test');
            console.log('✅ KV Storage 初始化成功');
        } catch (error) {
            console.error('❌ KV Storage 初始化失敗:', error.message);
            this.isKVAvailable = false;
            // 失敗後同樣嘗試加載本地文件
            if (!this.isVercel) {
                this.loadSessionsFromLocalFile();
            }
        }
    }

    // 從本地文件加載 Session
    loadSessionsFromLocalFile() {
        try {
            if (fs.existsSync(this.localSessionsPath)) {
                const data = fs.readFileSync(this.localSessionsPath, 'utf8');
                const sessions = JSON.parse(data);
                let count = 0;
                for (const [key, value] of Object.entries(sessions)) {
                    // 只恢復未過期的 session (30天)
                    if (value.expiresAt && Date.now() < value.expiresAt + (30 * 24 * 60 * 60 * 1000)) {
                        this.cache.set(key, value);
                        count++;
                    }
                }
                console.log(`✅ 已從本地文件恢復 ${count} 個 Session`);
            }
        } catch (error) {
            console.error('⚠️ 從本地文件加載 Session 失敗:', error.message);
        }
    }

    // 保存 Session 到本地文件
    _saveSessionsToLocalFile() {
        if (this.isVercel) return;
        
        try {
            const sessions = {};
            for (const [key, value] of this.cache.entries()) {
                if (key.startsWith('session:')) {
                    sessions[key] = value;
                }
            }
            fs.writeFileSync(this.localSessionsPath, JSON.stringify(sessions, null, 2));
        } catch (error) {
            console.error('⚠️ 保存 Session 到本地文件失敗:', error.message);
        }
    }
    
    // 生成用戶專屬 key
    generateUserKey(req) {
        const userHeaderId = req.headers['x-spotify-user-id'];
        if (userHeaderId) {
            return `user:${userHeaderId}`;
        }
        const headerId = req.headers['x-session-id'];
        if (headerId) {
            return `user:${headerId}`;
        }
        const cookieHeader = req.headers.cookie || '';
        const cookies = Object.fromEntries(cookieHeader.split(';').map(v => {
            const idx = v.indexOf('=');
            if (idx === -1) return [v.trim(), ''];
            return [v.slice(0, idx).trim(), decodeURIComponent(v.slice(idx + 1))];
        }));
        const cookieId = cookies['spotify_session'];
        if (!cookieId) throw new Error('缺少 sessionId');
        return `user:${cookieId}`;
    }
    
    // 生成 track 專屬 key (不含用戶前綴，用於全局緩存)
    generateTrackKey(trackInfo) {
        if (!trackInfo || !trackInfo.id) {
            throw new Error('无效的 trackInfo，需要 track ID');
        }
        return `lyrics:${trackInfo.id}`;
    }

    // 生成用戶+軌道 專屬 key (用於個人設置)
    generateUserTrackKey(req, trackInfo) {
        const userKey = this.generateUserKey(req);
        const trackKey = this.generateTrackKey(trackInfo);
        return `${userKey}:${trackKey}`;
    }
    
    // 獲取所有 session
    async getAllSessions() {
        const allSessions = new Map();
        
        // 1. 先從內存緩存獲取
        for (const [key, value] of this.cache.entries()) {
            if (key.startsWith('session:')) {
                const sessionId = key.replace('session:', '');
                allSessions.set(sessionId, value);
            }
        }
        
        // 2. 如果 KV 可用，獲取所有 session key
        if (this.isKVAvailable && this.redis) {
            try {
                const keys = await this.redis.keys('session:*');
                for (const key of keys) {
                    const sessionId = key.replace('session:', '');
                    if (!allSessions.has(sessionId)) {
                        const data = await this.redis.get(key);
                        if (data) {
                            const sessionData = typeof data === 'string' ? JSON.parse(data) : data;
                            allSessions.set(sessionId, sessionData);
                        }
                    }
                }
            } catch (error) {
                console.error('KV 獲取所有 session 失敗:', error);
            }
        }
        
        return allSessions;
    }

    // 獲取 session
    async getSession(sessionId) {
        if (!sessionId) return null;
        
        // 1. 先檢查內存緩存
        if (this.cache.has(`session:${sessionId}`)) {
            return this.cache.get(`session:${sessionId}`);
        }
        
        // 2. 檢查 KV
        if (this.isKVAvailable && this.redis) {
            try {
                const data = await this.redis.get(`session:${sessionId}`);
                if (data) {
                    const sessionData = typeof data === 'string' ? JSON.parse(data) : data;
                    // 檢查 session 是否過期 (30天)
                    if (sessionData.expiresAt && Date.now() < sessionData.expiresAt + (30 * 24 * 60 * 60 * 1000)) {
                        this.cache.set(`session:${sessionId}`, sessionData);
                        return sessionData;
                    }
                }
            } catch (error) {
                console.error('KV 獲取 session 失敗:', error);
            }
        }
        
        return null;
    }
    
    // 保存 session
    async saveSession(sessionId, sessionData) {
        if (!sessionId || !sessionData) return false;
        
        // 1. 保存到內存緩存
        this.cache.set(`session:${sessionId}`, sessionData);
        
        // 2. 保存到 KV
        if (this.isKVAvailable && this.redis) {
            try {
                const data = {
                    ...sessionData,
                    lastUpdated: Date.now()
                };
                
                await this.redis.set(`session:${sessionId}`, JSON.stringify(data), {
                    ex: 30 * 24 * 60 * 60 // 30天過期，與 Cookie 同步
                });
            } catch (error) {
                console.error('KV 保存 session 失敗:', error);
            }
        }

        // 無論 Redis 是否可用，只要不在 Vercel，就保存到本地文件作為備份
        if (!this.isVercel) {
            this._saveSessionsToLocalFile();
        }
        
        return true;
    }
    
    // 刪除 session
    async deleteSession(sessionId) {
        if (!sessionId) return false;
        
        // 1. 從內存緩存刪除
        this.cache.delete(`session:${sessionId}`);
        
        // 2. 從 KV 刪除
        if (this.isKVAvailable && this.redis) {
            try {
                await this.redis.del(`session:${sessionId}`);
            } catch (error) {
                console.error('KV 刪除 session 失敗:', error);
            }
        }

        // 同步更新本地文件
        if (!this.isVercel) {
            this._saveSessionsToLocalFile();
        }
        
        return true;
    }
    
    // 保存用戶自定義歌詞 (用戶專屬)
    async saveUserCustomLyrics(req, trackInfo, lyrics, lyricsType, source) {
        if (!trackInfo || !lyrics) {
            return false;
        }

        const lyricsData = {
            trackInfo,
            lyrics,
            lyricsType,
            source,
            timestamp: Date.now(),
            lastModified: Date.now(),
            version: 2
        };

        try {
            const key = this.generateUserTrackKey(req, trackInfo);
            
            // 同时保存到 Redis 和内存
            if (this.isKVAvailable && this.redis) {
                await this.redis.set(key, JSON.stringify(lyricsData));
                console.log(`✅ 歌词已保存到 KV: ${key}`);
            }
            
            this.cache.set(key, lyricsData);
            return true;
        } catch (error) {
            console.error('❌ 保存歌词失败:', error.message);
            return false;
        }
    }
    
    // 獲取用戶自定義歌詞 (用戶專屬)
    async getUserCustomLyrics(req, trackInfo) {
        if (!trackInfo) return null;

        try {
            const key = this.generateUserTrackKey(req, trackInfo);
            
            // 1. 先从内存缓存查找
            if (this.cache.has(key)) {
                console.log(`✅ 从缓存获取歌词: ${key}`);
                return this.cache.get(key);
            }
            
            // 2. 再从 Redis 查找
            if (this.isKVAvailable && this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    const lyricsData = typeof data === 'string' ? JSON.parse(data) : data;
                    this.cache.set(key, lyricsData); // 缓存到内存
                    console.log(`✅ 从 KV 获取歌词: ${key}`);
                    return lyricsData;
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ 获取歌词失败:', error.message);
            return null;
        }
    }

    // ✨ 保存时间偏移（用戶專屬）
    async saveLyricsTimeOffset(req, trackInfo, timeOffset) {
        if (!trackInfo || timeOffset === undefined) {
            return false;
        }

        const offsetData = {
            trackInfo,
            timeOffset,
            timestamp: Date.now(),
            modifiedBy: 'user_adjustment'
        };

        try {
            const userKey = this.generateUserKey(req);
            const key = `offset:${userKey}:${trackInfo.id}`;
            
            // 同时保存到 Redis 和内存
            if (this.isKVAvailable && this.redis) {
                await this.redis.set(key, JSON.stringify(offsetData), { ex: 2592000 }); // 30天过期
                console.log(`✅ 時間偏移已保存到 KV: ${key}`);
            }
            
            this.cache.set(key, offsetData);
            return true;
        } catch (error) {
            console.error('❌ 保存时间偏移失败:', error.message);
            return false;
        }
    }

    // ✨ 獲取時間偏移 (用戶專屬)
    async getLyricsTimeOffset(req, trackInfo) {
        if (!trackInfo) return 0;

        try {
            const userKey = this.generateUserKey(req);
            const key = `offset:${userKey}:${trackInfo.id}`;
            
            // 1. 先从内存缓存查找
            if (this.cache.has(key)) {
                const data = this.cache.get(key);
                return data.timeOffset || 0;
            }
            
            // 2. 再从 Redis 查找
            if (this.isKVAvailable && this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    const offsetData = typeof data === 'string' ? JSON.parse(data) : data;
                    this.cache.set(key, offsetData);
                    return offsetData.timeOffset || 0;
                }
            }
            
            return 0;
        } catch (error) {
            console.error('❌ 获取时间偏移失败:', error.message);
            return 0;
        }
    }

    // ✨ 30天歌词缓存 (全局共享)
    async cacheLyricsFor30Days(trackInfo, lyrics, lyricsType, source = 'auto') {
        if (!trackInfo || !lyrics) {
            return false;
        }

        const cacheData = {
            trackInfo,
            lyrics,
            lyricsType,
            source,
            timestamp: Date.now(),
            cached_until: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30天
            version: 3
        };

        try {
            const key = `cache:${this.generateTrackKey(trackInfo)}`;
            
            // 保存到 Redis，设置30天过期
            if (this.isKVAvailable && this.redis) {
                await this.redis.set(key, JSON.stringify(cacheData), { ex: 2592000 }); // 30天
                console.log(`✅ 歌词已快取30天: ${key}`);
            }
            
            this.cache.set(key, cacheData);
            return true;
        } catch (error) {
            console.error('❌ 30天快取失敗:', error.message);
            return false;
        }
    }

    // ✨ 获取30天缓存的歌词 (全局共享)
    async get30DayCachedLyrics(trackInfo) {
        if (!trackInfo) return null;

        try {
            const key = `cache:${this.generateTrackKey(trackInfo)}`;
            
            // 1. 先从内存缓存查找
            if (this.cache.has(key)) {
                const data = this.cache.get(key);
                if (Date.now() < data.cached_until) {
                    console.log(`✅ 从30天快取获取歌词: ${key}`);
                    return data;
                }
            }
            
            // 2. 从 Redis 查找
            if (this.isKVAvailable && this.redis) {
                const data = await this.redis.get(key);
                if (data) {
                    const cacheData = typeof data === 'string' ? JSON.parse(data) : data;
                    if (Date.now() < cacheData.cached_until) {
                        this.cache.set(key, cacheData);
                        console.log(`✅ 从 KV 获取30天快取歌词: ${key}`);
                        return cacheData;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ 获取30天快取失败:', error.message);
            return null;
        }
    }

    // ✨ 数据迁移：从 localStorage 到 KV
    async migrateFromLocalStorage(req, localStorageData) {
        console.log('🔄 开始数据迁移...');
        const userKey = this.generateUserKey(req);
        let migratedCount = 0;
        
        try {
            // 迁移自定义歌词
            if (localStorageData.user_custom_lyrics) {
                const lyricsObj = JSON.parse(localStorageData.user_custom_lyrics);
                for (const [trackKey, lyricsData] of Object.entries(lyricsObj)) {
                    if (this.isKVAvailable && this.redis) {
                        const trackId = trackKey.split('--')[0];
                        const kvKey = `${userKey}:lyrics:${trackId}`;
                        await this.redis.set(kvKey, JSON.stringify(lyricsData));
                        migratedCount++;
                    }
                }
            }
            
            // 迁移时间偏移
            if (localStorageData.user_lyrics_providers) {
                const providersObj = JSON.parse(localStorageData.user_lyrics_providers);
                for (const [trackKey, providerData] of Object.entries(providersObj)) {
                    if (this.isKVAvailable && this.redis) {
                        const trackId = trackKey.split('--')[0];
                        const kvKey = `${userKey}:provider:${trackId}`;
                        await this.redis.set(kvKey, JSON.stringify(providerData));
                        migratedCount++;
                    }
                }
            }
            
            return { success: true, migratedCount };
        } catch (error) {
            console.error('❌ 数据迁移失败:', error.message);
            return { success: false, error: error.message };
        }
    }

    // ✨ 清除所有用户数据
    async clearAllUserData(req) {
        try {
            const userKey = this.generateUserKey(req);
            console.log(`🗑️ 清除用户数据: ${userKey}`);
            
            if (this.isKVAvailable && this.redis) {
                // Get all keys for this user
                const keys = await this.redis.keys(`${userKey}:*`);
                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            }
            return true;
        } catch (error) {
            return false;
    }
        }

    // ✨ 獲取用戶所有歌詞（用於管理頁面和雲端同步）
    async getAllUserLyrics(req) {
        try {
            const userKey = this.generateUserKey(req);
            const allLyrics = [];
            
            if (this.isKVAvailable && this.redis) {
                // 獲取所有用戶歌詞 key
                const keys = await this.redis.keys(`${userKey}:lyrics:*`);
                
                for (const key of keys) {
                    try {
                        const data = await this.redis.get(key);
                        if (data) {
                            const lyricsData = typeof data === 'string' ? JSON.parse(data) : data;
                            // 提取 trackId 從 key
                            const trackId = key.split(':').pop();
                            allLyrics.push({
                                trackId,
                                trackInfo: lyricsData.trackInfo,
                                lyrics: lyricsData.lyrics,
                                lyricsType: lyricsData.lyricsType,
                                source: lyricsData.source,
                                timestamp: lyricsData.timestamp,
                                lastModified: lyricsData.lastModified
                            });
                        }
                    } catch (e) {
                        console.error(`解析歌詞數據失敗 ${key}:`, e);
                    }
                }
            }
            
            return allLyrics;
        } catch (error) {
            console.error('獲取用戶所有歌詞失敗:', error.message);
            return [];
        }
    }
    
    // ✨ 批量同步歌詞到雲端（支持相同 Spotify ID 互相同步）
    async syncLyricsToCloud(req, lyricsDataArray) {
        try {
            const userKey = this.generateUserKey(req);
            let successCount = 0;
            let failedCount = 0;
            
            if (!this.isKVAvailable || !this.redis) {
                return { success: false, error: 'KV 不可用', successCount: 0, failedCount: lyricsDataArray.length };
            }
            
            for (const item of lyricsDataArray) {
                try {
                    const { trackInfo, lyrics, lyricsType, source } = item;
                    if (!trackInfo || !trackInfo.id || !lyrics) {
                        failedCount++;
                        continue;
                    }
                    
                    const key = `${userKey}:lyrics:${trackInfo.id}`;
                    const lyricsData = {
                        trackInfo,
                        lyrics,
                        lyricsType,
                        source: source || { type: 'sync', syncedAt: Date.now() },
                        timestamp: Date.now(),
                        lastModified: Date.now(),
                        version: 3
                    };
                    
                    await this.redis.set(key, JSON.stringify(lyricsData));
                    this.cache.set(key, lyricsData);
                    successCount++;
                } catch (e) {
                    console.error(`同步歌詞失敗 ${item.trackInfo?.id}:`, e);
                    failedCount++;
                }
            }
            
            return { 
                success: true, 
                successCount, 
                failedCount,
                total: lyricsDataArray.length 
            };
        } catch (error) {
            console.error('批量同步歌詞失敗:', error.message);
            return { success: false, error: error.message, successCount: 0, failedCount: lyricsDataArray.length };
        }
    }
    
    // ✨ 獲取歌詞統計信息
    async getLyricsStats(req) {
        try {
            const userKey = this.generateUserKey(req);
            const stats = {
                totalLyrics: 0,
                syncedLyrics: 0,
                plainLyrics: 0,
                withTimeOffset: 0,
                lastSyncedAt: null
            };
            
            if (this.isKVAvailable && this.redis) {
                // 獲取所有用戶歌詞 key
                const lyricsKeys = await this.redis.keys(`${userKey}:lyrics:*`);
                stats.totalLyrics = lyricsKeys.length;
                
                // 獲取時間偏移 key
                const offsetKeys = await this.redis.keys(`offset:${userKey}:*`);
                stats.withTimeOffset = offsetKeys.length;
                
                // 分析歌詞類型
                for (const key of lyricsKeys) {
                    try {
                        const data = await this.redis.get(key);
                        if (data) {
                            const lyricsData = typeof data === 'string' ? JSON.parse(data) : data;
                            if (lyricsData.lyricsType === 'synced') {
                                stats.syncedLyrics++;
                            } else {
                                stats.plainLyrics++;
                            }
                            
                            // 檢查最後同步時間
                            const lastModified = lyricsData.lastModified || lyricsData.timestamp;
                            if (lastModified && (!stats.lastSyncedAt || lastModified > stats.lastSyncedAt)) {
                                stats.lastSyncedAt = lastModified;
                            }
                        }
                    } catch (e) {
                        // 忽略解析錯誤
                    }
                }
            }
            
            return stats;
        } catch (error) {
            console.error('獲取歌詞統計失敗:', error.message);
            return null;
        }
    }
    
    // 保存用戶歌詞供應商偏好
    async saveUserLyricsProvider(req, trackInfo, provider) {
        const userKey = this.generateUserKey(req);
        const trackId = trackInfo.id;
        const providerKey = `${userKey}:provider:${trackId}`;
        
        const providerData = {
            trackInfo,
            provider,
            createdAt: Date.now()
        };
        
        if (this.isKVAvailable && this.redis) {
            try {
                await this.redis.set(providerKey, JSON.stringify(providerData));
                return true;
            } catch (error) {
                return false;
            }
        }
        return false;
    }
    
    // 獲取用戶歌詞供應商偏好
    async getUserLyricsProvider(req, trackInfo) {
        const userKey = this.generateUserKey(req);
        const trackId = trackInfo.id;
        const providerKey = `${userKey}:provider:${trackId}`;
        
        if (!this.isKVAvailable || !this.redis) return null;
        
        try {
            const data = await this.redis.get(providerKey);
            if (data) {
                const providerData = typeof data === 'string' ? JSON.parse(data) : data;
                return providerData.provider;
            }
        } catch (error) {}
        return null;
    }

    // ✨ 更新最後一條聽歌歷史的時長
    async updateLastHistoryDuration(req, durationMs) {
        try {
            const userKey = this.generateUserKey(req);
            const key = `${userKey}:history`;
            const cacheKey = `history:${userKey}`;
            
            // 1. 先獲取最新的歷史記錄
            let history = [];
            if (this.cache.has(cacheKey)) {
                history = this.cache.get(cacheKey);
            } else if (this.isKVAvailable && this.redis) {
                const data = await this.redis.lrange(key, 0, 0);
                if (data && data.length > 0) {
                    history = [typeof data[0] === 'string' ? JSON.parse(data[0]) : data[0]];
                }
            }

            if (history.length > 0) {
                history[0].durationMs = durationMs;
                
                // 2. 更新 Redis
                if (this.isKVAvailable && this.redis) {
                    // LSET 用於更新列表中指定索引的元素
                    await this.redis.lset(key, 0, JSON.stringify(history[0]));
                }
                
                // 3. 更新內存緩存
                if (this.cache.has(cacheKey)) {
                    const cachedHistory = this.cache.get(cacheKey);
                    if (cachedHistory.length > 0) {
                        cachedHistory[0].durationMs = durationMs;
                    }
                }
            }
            return true;
        } catch (error) {
            console.error('❌ 更新聽歌歷史時長失敗:', error.message);
            return false;
        }
    }

    // ✨ 保存聽歌歷史
    async saveListeningHistory(req, historyData) {
        try {
            const userKey = this.generateUserKey(req);
            const key = `${userKey}:history`;
            
            const data = {
                ...historyData,
                playedAt: historyData.playedAt || Date.now()
            };

            if (this.isKVAvailable && this.redis) {
                // 使用 LPUSH 將新記錄添加到列表開頭
                await this.redis.lpush(key, JSON.stringify(data));
                // 只保留最近 2000 條記錄
                await this.redis.ltrim(key, 0, 1999);
            }
            
            // 內存緩存也更新
            const cacheKey = `history:${userKey}`;
            const history = this.cache.get(cacheKey) || [];
            history.unshift(data);
            if (history.length > 2000) history.pop();
            this.cache.set(cacheKey, history);
            
            return true;
        } catch (error) {
            console.error('❌ 保存聽歌歷史失敗:', error.message);
            return false;
        }
    }

    // ✨ 獲取聽歌歷史
    async getListeningHistory(req, days = 30, until = null) {
        try {
            const userKey = this.generateUserKey(req);
            const key = `${userKey}:history`;
            let since;
            
            if (days === 1) {
                since = new Date();
                since.setHours(0, 0, 0, 0);
                since = since.getTime();
            } else if (days === 2) {
                // Special case for "Yesterday"
                since = new Date();
                since.setDate(since.getDate() - 1);
                since.setHours(0, 0, 0, 0);
                since = since.getTime();
                if (!until) {
                    until = new Date();
                    until.setHours(0, 0, 0, 0);
                    until = until.getTime();
                }
            } else {
                since = Date.now() - (days * 24 * 60 * 60 * 1000);
            }
            
            let history = [];
            
            // 1. 先從內存緩存獲取
            const cacheKey = `history:${userKey}`;
            if (this.cache.has(cacheKey)) {
                history = this.cache.get(cacheKey);
            } else if (this.isKVAvailable && this.redis) {
                // 2. 從 Redis 獲取
                const data = await this.redis.lrange(key, 0, -1);
                history = data.map(item => typeof item === 'string' ? JSON.parse(item) : item);
                this.cache.set(cacheKey, history);
            }
            
            // 過濾時間
            return history.filter(item => {
                const playedAt = this.getPlayedAtMs(item);
                return playedAt >= since && (!until || playedAt < until);
            });
        } catch (error) {
            console.error('❌ 獲取聽歌歷史失敗:', error.message);
            return [];
        }
    }

    // --- 分佈式鎖 (Distributed Locking) ---
    async acquireLock(lockKey, ttlSeconds = 60) {
        if (!this.isKVAvailable || !this.redis) return true; // 如果 KV 不可用，默認允許執行（放行）
        try {
            // 使用 SET NX (Not Exists) 實現簡單鎖
            const result = await this.redis.set(`lock:${lockKey}`, 'locked', {
                nx: true,
                ex: ttlSeconds
            });
            return result === 'OK';
        } catch (error) {
            console.error(`❌ 獲取鎖失敗 ${lockKey}:`, error.message);
            return true; // 出錯時放行，避免功能中斷
        }
    }

    async releaseLock(lockKey) {
        if (!this.isKVAvailable || !this.redis) return;
        try {
            await this.redis.del(`lock:${lockKey}`);
        } catch (error) {
            console.error(`❌ 釋放鎖失敗 ${lockKey}:`, error.message);
        }
    }

    getPlayedAtMs(item) {
        const value = item?.playedAt || item?.timestamp;
        if (!value) return 0;
        if (typeof value === 'number') return value;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }

    // --- 聽歌歷史去重 (History Deduplication) ---
    async deduplicateHistory(req) {
        try {
            const userKey = this.generateUserKey(req);
            const key = `${userKey}:history`;
            
            let history = [];
            if (this.isKVAvailable && this.redis) {
                const data = await this.redis.lrange(key, 0, -1);
                history = data.map(item => typeof item === 'string' ? JSON.parse(item) : item);
            } else {
                const cacheKey = `history:${userKey}`;
                history = this.cache.get(cacheKey) || [];
            }

            const originalCount = history.length;
            if (originalCount === 0) return { originalCount: 0, newCount: 0 };

            console.log(`🧹 [Deduplicate] Processing ${originalCount} records for ${userKey}`);

            const seen = new Set();
            const uniqueHistory = [];
            
            // 從新到舊遍歷 (如果是 Redis Lrange 0 -1 或者是 cache unshift 進來的)
            for (const item of history) {
                const playedAtMs = this.getPlayedAtMs(item);
                if (!playedAtMs) {
                    uniqueHistory.push(item);
                    continue;
                }
                
                // 1. 秒級精度檢查
                const ts = Math.floor(playedAtMs / 1000);
                const trackKey = item.trackId || `${item.trackName || item.name || ''}|||${item.artistName || item.artist || ''}`;
                const identifier = `${trackKey}:${ts}`;
                
                // 2. 序列檢查：如果同一首歌在 30 秒內重複出現，也視為重複
                const lastItem = uniqueHistory[uniqueHistory.length - 1];
                let isTooClose = false;
                if (lastItem) {
                    const lastTs = Math.floor(this.getPlayedAtMs(lastItem) / 1000);
                    const lastTrackKey = lastItem.trackId || `${lastItem.trackName || lastItem.name || ''}|||${lastItem.artistName || lastItem.artist || ''}`;
                    if (trackKey === lastTrackKey && Math.abs(ts - lastTs) < 30) {
                        isTooClose = true;
                    }
                }

                if (!seen.has(identifier) && !isTooClose) {
                    seen.add(identifier);
                    uniqueHistory.push(item);
                }
            }
            
            if (uniqueHistory.length < originalCount) {
                if (this.isKVAvailable && this.redis) {
                    // 重寫 Redis 數據
                    await this.redis.del(key);
                    // LPUSH 是將新元素放在列表開頭，所以要反向 push 保持最新在前的順序
                    const reversed = [...uniqueHistory].reverse();
                    for (let i = 0; i < reversed.length; i += 100) {
                        const chunk = reversed.slice(i, i + 100).map(item => JSON.stringify(item));
                        await this.redis.lpush(key, ...chunk);
                    }
                }
            }

            // 更新內存緩存
            const cacheKey = `history:${userKey}`;
            this.cache.set(cacheKey, uniqueHistory);
            
            console.log(`✅ [Deduplicate] Result: ${originalCount} -> ${uniqueHistory.length}`);
            return { originalCount, newCount: uniqueHistory.length, removedCount: originalCount - uniqueHistory.length };
        } catch (error) {
            console.error('❌ 去重聽歌歷史失敗:', error.message);
            throw error;
        }
    }
}

module.exports = KVStorageManager;

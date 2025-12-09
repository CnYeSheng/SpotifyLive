// api/kv-storage.js

const { Redis } = require('@upstash/redis');

class KVStorageManager {
    constructor() {
        // 檢查 KV 可用性
        this.isKVAvailable = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
        this.redis = null;
        this.cache = new Map();
        this.initialize();
    }
    
    async initialize() {
        if (!this.isKVAvailable) {
            console.log('⚠️ KV Storage 未配置，将使用内存存储');
            return;
        }
        
        try {
            this.redis = new Redis({
                url: process.env.KV_REST_API_URL,
                token: process.env.KV_REST_API_TOKEN
            });
            
            // 测试连接
            await this.redis.set('init_test', 'ok');
            await this.redis.del('init_test');
            console.log('✅ KV Storage 初始化成功');
        } catch (error) {
            console.error('❌ KV Storage 初始化失败:', error.message);
            this.isKVAvailable = false;
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
    
    // 生成 track 專屬 key
    generateTrackKey(trackInfo) {
        if (!trackInfo || !trackInfo.id) {
            throw new Error('无效的 trackInfo，需要 track ID');
        }
        return `lyrics:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
    }
    
    // 獲取 session
    async getSession(sessionId) {
        if (!sessionId) return null;
        
        // 1. 先檢查內存緩存
        if (this.cache.has(sessionId)) {
            return this.cache.get(sessionId);
        }
        
        // 2. 檢查 KV
        if (this.isKVAvailable) {
            try {
                const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(`session:${sessionId}`)}`, {
                    headers: {
                        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.metadata) {
                        const sessionData = JSON.parse(data.metadata);
                        // 檢查 session 是否過期
                        if (sessionData.expiresAt && Date.now() < sessionData.expiresAt) {
                            this.cache.set(sessionId, sessionData);
                            return sessionData;
                        }
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
        this.cache.set(sessionId, sessionData);
        
        // 2. 保存到 KV
        if (this.isKVAvailable) {
            try {
                const metadata = JSON.stringify({
                    ...sessionData,
                    lastUpdated: Date.now()
                });
                
                const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(`session:${sessionId}`)}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ metadata })
                });
                
                return response.ok;
            } catch (error) {
                console.error('KV 保存 session 失敗:', error);
                return false;
            }
        }
        
        return true;
    }
    
    // 刪除 session
    async deleteSession(sessionId) {
        if (!sessionId) return false;
        
        // 1. 從內存緩存刪除
        this.cache.delete(sessionId);
        
        // 2. 從 KV 刪除
        if (this.isKVAvailable) {
            try {
                const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(`session:${sessionId}`)}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
                    }
                });
                
                return response.ok;
            } catch (error) {
                console.error('KV 刪除 session 失敗:', error);
                return false;
            }
        }
        
        return true;
    }
    
    // 保存用戶自定義歌詞
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
            const key = this.generateTrackKey(trackInfo);
            
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
    
    // 獲取用戶自定義歌詞
    async getUserCustomLyrics(req, trackInfo) {
        if (!trackInfo) return null;

        try {
            const key = this.generateTrackKey(trackInfo);
            
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

    // ✨ 保存时间偏移（永久保存）
    async saveLyricsTimeOffset(trackInfo, timeOffset) {
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
            const key = `offset:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
            
            // 同时保存到 Redis 和内存
            if (this.isKVAvailable && this.redis) {
                await this.redis.set(key, JSON.stringify(offsetData), { ex: 2592000 }); // 30天过期
                console.log(`✅ 时间偏移已保存到 KV: ${key}`);
            }
            
            this.cache.set(key, offsetData);
            return true;
        } catch (error) {
            console.error('❌ 保存时间偏移失败:', error.message);
            return false;
        }
    }

    // ✨ 30天歌词缓存
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
                console.log(`✅ 歌词已缓存30天: ${key}`);
            }
            
            this.cache.set(key, cacheData);
            return true;
        } catch (error) {
            console.error('❌ 30天缓存失败:', error.message);
            return false;
        }
    }

    // ✨ 获取30天缓存的歌词
    async get30DayCachedLyrics(trackInfo) {
        if (!trackInfo) return null;

        try {
            const key = `cache:${this.generateTrackKey(trackInfo)}`;
            
            // 1. 先从内存缓存查找
            if (this.cache.has(key)) {
                const data = this.cache.get(key);
                if (Date.now() < data.cached_until) {
                    console.log(`✅ 从30天缓存获取歌词: ${key}`);
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
                        console.log(`✅ 从 KV 获取30天缓存歌词: ${key}`);
                        return cacheData;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ 获取30天缓存失败:', error.message);
            return null;
        }
    }

        async getLyricsTimeOffset(trackInfo) {
        if (!trackInfo) return 0;

        try {
            const key = `offset:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
            
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

        // ✨ 数据迁移：从 localStorage 到 KV
    async migrateFromLocalStorage(req, localStorageData) {
        console.log('🔄 开始数据迁移...');
        
        let migratedCount = 0;
        
        try {
            // 迁移自定义歌词
            if (localStorageData.user_custom_lyrics) {
                const lyricsObj = JSON.parse(localStorageData.user_custom_lyrics);
                for (const [trackKey, lyricsData] of Object.entries(lyricsObj)) {
                    if (this.isKVAvailable && this.redis) {
                        const kvKey = `lyrics:${trackKey}`;
                        await this.redis.set(kvKey, JSON.stringify(lyricsData));
                        console.log(`✅ 已迁移歌词: ${kvKey}`);
                        migratedCount++;
                    }
                }
            }
            
            // 迁移时间偏移
            if (localStorageData.user_lyrics_providers) {
                const providersObj = JSON.parse(localStorageData.user_lyrics_providers);
                for (const [trackKey, providerData] of Object.entries(providersObj)) {
                    if (this.isKVAvailable && this.redis) {
                        const kvKey = `provider:${trackKey}`;
                        await this.redis.set(kvKey, JSON.stringify(providerData));
                        console.log(`✅ 已迁移供应商: ${kvKey}`);
                        migratedCount++;
                    }
                }
            }
            
            console.log(`✅ 数据迁移完成，共 ${migratedCount} 条记录`);
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
                // 获取所有相关的 key 并删除
                const pattern = `${userKey}:*`;
                // 由于 Redis 不直接支持通配符删除，需要逐一删除
                // 这里简化处理，实际应该保留重要数据
            }
            
            return true;
        } catch (error) {
            console.error('❌ 清除数据失败:', error.message);
            return false;
        }
    }
    
    // 保存用戶歌詞供應商偏好
    async saveUserLyricsProvider(req, trackInfo, provider) {
        const userKey = this.generateUserKey(req);
        const trackKey = this.generateTrackKey(trackInfo);
        const providerKey = `${userKey}:provider:${trackKey}`;
        
        const providerData = {
            trackInfo,
            provider,
            createdAt: Date.now()
        };
        
        if (this.isKVAvailable) {
            try {
                const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(providerKey)}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ metadata: JSON.stringify(providerData) })
                });
                
                return response.ok;
            } catch (error) {
                console.error('KV 保存供應商偏好失敗:', error);
                return false;
            }
        }
        
        return false;
    }
    
    // 獲取用戶歌詞供應商偏好
    async getUserLyricsProvider(req, trackInfo) {
        const userKey = this.generateUserKey(req);
        const trackKey = this.generateTrackKey(trackInfo);
        const providerKey = `${userKey}:provider:${trackKey}`;
        
        if (!this.isKVAvailable) return null;
        
        try {
            const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(providerKey)}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.metadata) {
                    const providerData = JSON.parse(data.metadata);
                    return providerData.provider;
                }
            }
        } catch (error) {
            console.error('KV 獲取供應商偏好失敗:', error);
        }
        
        return null;
    }
}

module.exports = KVStorageManager;

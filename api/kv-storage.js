// api/kv-storage-manager.js
class KVStorageManager {
    constructor() {
        // 檢查 KV 可用性
        this.isKVAvailable = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
        this.cache = new Map();
        this.initialize();
    }
    
    async initialize() {
        if (!this.isKVAvailable) {
            console.log('⚠️ KV Storage 未配置，將使用內存存儲');
            return;
        }
        console.log('✅ KV Storage 已初始化');
    }
    
    // 生成用戶專屬 key
    generateUserKey(req) {
        const sessionId = req.headers['x-session-id'] || req.cookies?.spotify_session;
        if (!sessionId) throw new Error('缺少 sessionId');
        return `user:${sessionId}`;
    }
    
    // 生成 track 專屬 key
    generateTrackKey(trackInfo) {
        if (!trackInfo || !trackInfo.id) {
            throw new Error('無效的 trackInfo，需要 track ID');
        }
        return `track:${trackInfo.id}`;
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
        const userKey = this.generateUserKey(req);
        const trackKey = this.generateTrackKey(trackInfo);
        const customLyricsKey = `${userKey}:custom_lyrics:${trackKey}`;
        
        const lyricsData = {
            trackInfo,
            lyrics,
            lyricsType,
            source,
            createdAt: Date.now()
        };
        
        if (this.isKVAvailable) {
            try {
                const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(customLyricsKey)}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ metadata: JSON.stringify(lyricsData) })
                });
                
                return response.ok;
            } catch (error) {
                console.error('KV 保存自定義歌詞失敗:', error);
                return false;
            }
        }
        
        return false;
    }
    
    // 獲取用戶自定義歌詞
    async getUserCustomLyrics(req, trackInfo) {
        const userKey = this.generateUserKey(req);
        const trackKey = this.generateTrackKey(trackInfo);
        const customLyricsKey = `${userKey}:custom_lyrics:${trackKey}`;
        
        if (!this.isKVAvailable) return null;
        
        try {
            const response = await fetch(`${process.env.KV_REST_API_URL}/${encodeURIComponent(customLyricsKey)}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data && data.metadata) {
                    return JSON.parse(data.metadata);
                }
            }
        } catch (error) {
            console.error('KV 獲取自定義歌詞失敗:', error);
        }
        
        return null;
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
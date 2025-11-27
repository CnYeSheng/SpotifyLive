// Vercel KV 存儲管理器
// KV Storage Manager for user lyrics and preferences

const { kv } = require('@vercel/kv');

class KVStorageManager {
    constructor() {
        this.isKVAvailable = this.checkKVAvailability();
    }

    // 檢查 KV 是否可用
    checkKVAvailability() {
        try {
            return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
        } catch (error) {
            console.warn('KV Storage not available:', error.message);
            return false;
        }
    }

    // 生成用戶唯一標識符 (基於 IP 或 session)
    generateUserKey(req) {
        // 使用 IP 地址和 User-Agent 生成唯一標識
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const userAgent = req.get('user-agent') || 'unknown';
        const hash = require('crypto')
            .createHash('md5')
            .update(`${ip}-${userAgent}`)
            .digest('hex')
            .substring(0, 16);
        return `user_${hash}`;
    }

    // 生成歌曲唯一標識符
    generateTrackKey(trackInfo) {
        const artist = trackInfo.artist || trackInfo.artists?.[0]?.name || '';
        const name = trackInfo.name || trackInfo.title || '';
        const id = trackInfo.id || '';
        
        return `${id}-${artist}-${name}`.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-_]/g, '');
    }

    // =================
    // 用戶自定義歌詞管理
    // =================

    // 保存用戶自定義歌詞
    async saveUserCustomLyrics(req, trackInfo, lyrics, lyricsType, source) {
        if (!this.isKVAvailable) {
            throw new Error('KV Storage not available');
        }

        try {
            const userKey = this.generateUserKey(req);
            const trackKey = this.generateTrackKey(trackInfo);
            const storageKey = `custom_lyrics:${userKey}:${trackKey}`;

            const customLyricsData = {
                trackKey: trackKey,
                userKey: userKey,
                trackInfo: {
                    id: trackInfo.id,
                    name: trackInfo.name,
                    artist: trackInfo.artist,
                    album: trackInfo.album
                },
                lyrics: lyrics,
                lyricsType: lyricsType || 'plain',
                source: source || 'user_custom',
                timestamp: Date.now(),
                lastUsed: Date.now(),
                updatedAt: new Date().toISOString()
            };

            await kv.set(storageKey, customLyricsData);
            
            // 同時更新用戶的歌詞列表索引
            await this.updateUserLyricsIndex(userKey, trackKey, 'custom_lyrics');

            console.log(`✅ KV: 已保存用戶自定義歌詞: ${trackInfo.artist} - ${trackInfo.name}`);
            return true;
        } catch (error) {
            console.error('❌ KV: 保存用戶自定義歌詞失敗:', error);
            throw error;
        }
    }

    // 獲取用戶自定義歌詞
    async getUserCustomLyrics(req, trackInfo) {
        if (!this.isKVAvailable) {
            return null;
        }

        try {
            const userKey = this.generateUserKey(req);
            const trackKey = this.generateTrackKey(trackInfo);
            const storageKey = `custom_lyrics:${userKey}:${trackKey}`;

            const userData = await kv.get(storageKey);
            
            if (userData) {
                // 更新最後使用時間
                userData.lastUsed = Date.now();
                await kv.set(storageKey, userData);
                
                console.log(`🎯 KV: 找到用戶自定義歌詞: ${trackInfo.artist} - ${trackInfo.name}`);
                return userData;
            }
            
            return null;
        } catch (error) {
            console.error('❌ KV: 獲取用戶自定義歌詞失敗:', error);
            return null;
        }
    }

    // 刪除用戶自定義歌詞
    async deleteUserCustomLyrics(req, trackKey) {
        if (!this.isKVAvailable) {
            throw new Error('KV Storage not available');
        }

        try {
            const userKey = this.generateUserKey(req);
            const storageKey = `custom_lyrics:${userKey}:${trackKey}`;

            await kv.del(storageKey);
            
            // 更新用戶索引
            await this.removeFromUserLyricsIndex(userKey, trackKey, 'custom_lyrics');

            console.log(`🗑️ KV: 已刪除用戶自定義歌詞: ${trackKey}`);
            return true;
        } catch (error) {
            console.error('❌ KV: 刪除用戶自定義歌詞失敗:', error);
            throw error;
        }
    }

    // =================
    // 用戶歌詞供應商偏好管理
    // =================

    // 保存用戶歌詞供應商偏好
    async saveUserLyricsProvider(req, trackInfo, provider) {
        if (!this.isKVAvailable) {
            throw new Error('KV Storage not available');
        }

        try {
            const userKey = this.generateUserKey(req);
            const trackKey = this.generateTrackKey(trackInfo);
            const storageKey = `provider_pref:${userKey}:${trackKey}`;

            const providerData = {
                trackKey: trackKey,
                userKey: userKey,
                trackInfo: {
                    id: trackInfo.id,
                    name: trackInfo.name,
                    artist: trackInfo.artist
                },
                provider: provider,
                timestamp: Date.now(),
                lastUsed: Date.now(),
                updatedAt: new Date().toISOString()
            };

            await kv.set(storageKey, providerData);
            
            // 更新用戶索引
            await this.updateUserLyricsIndex(userKey, trackKey, 'provider_pref');

            console.log(`🔒 KV: 已保存用戶指定供應商: ${provider} for ${trackInfo.artist} - ${trackInfo.name}`);
            return true;
        } catch (error) {
            console.error('❌ KV: 保存用戶指定供應商失敗:', error);
            throw error;
        }
    }

    // 獲取用戶歌詞供應商偏好
    async getUserLyricsProvider(req, trackInfo) {
        if (!this.isKVAvailable) {
            return null;
        }

        try {
            const userKey = this.generateUserKey(req);
            const trackKey = this.generateTrackKey(trackInfo);
            const storageKey = `provider_pref:${userKey}:${trackKey}`;

            const userData = await kv.get(storageKey);
            
            if (userData) {
                // 更新最後使用時間
                userData.lastUsed = Date.now();
                await kv.set(storageKey, userData);
                
                console.log(`🎯 KV: 找到用戶指定供應商: ${userData.provider} for ${trackInfo.artist} - ${trackInfo.name}`);
                return userData.provider;
            }
            
            return null;
        } catch (error) {
            console.error('❌ KV: 獲取用戶指定供應商失敗:', error);
            return null;
        }
    }

    // 刪除用戶歌詞供應商偏好
    async deleteUserLyricsProvider(req, trackKey) {
        if (!this.isKVAvailable) {
            throw new Error('KV Storage not available');
        }

        try {
            const userKey = this.generateUserKey(req);
            const storageKey = `provider_pref:${userKey}:${trackKey}`;

            await kv.del(storageKey);
            
            // 更新用戶索引
            await this.removeFromUserLyricsIndex(userKey, trackKey, 'provider_pref');

            console.log(`🗑️ KV: 已刪除用戶指定供應商: ${trackKey}`);
            return true;
        } catch (error) {
            console.error('❌ KV: 刪除用戶指定供應商失敗:', error);
            throw error;
        }
    }

    // =================
    // 用戶數據管理
    // =================

    // 獲取用戶所有自定義歌詞
    async getAllUserCustomLyrics(req) {
        if (!this.isKVAvailable) {
            return [];
        }

        try {
            const userKey = this.generateUserKey(req);
            const indexKey = `user_index:${userKey}:custom_lyrics`;
            
            const trackKeys = await kv.get(indexKey) || [];
            const results = [];

            for (const trackKey of trackKeys) {
                try {
                    const storageKey = `custom_lyrics:${userKey}:${trackKey}`;
                    const data = await kv.get(storageKey);
                    if (data) {
                        results.push(data);
                    }
                } catch (error) {
                    console.warn(`跳過無效的歌詞記錄: ${trackKey}`, error);
                }
            }

            return results.sort((a, b) => b.lastUsed - a.lastUsed);
        } catch (error) {
            console.error('❌ KV: 獲取用戶所有自定義歌詞失敗:', error);
            return [];
        }
    }

    // 獲取用戶所有供應商偏好
    async getAllUserProviderPrefs(req) {
        if (!this.isKVAvailable) {
            return [];
        }

        try {
            const userKey = this.generateUserKey(req);
            const indexKey = `user_index:${userKey}:provider_pref`;
            
            const trackKeys = await kv.get(indexKey) || [];
            const results = [];

            for (const trackKey of trackKeys) {
                try {
                    const storageKey = `provider_pref:${userKey}:${trackKey}`;
                    const data = await kv.get(storageKey);
                    if (data) {
                        results.push(data);
                    }
                } catch (error) {
                    console.warn(`跳過無效的供應商記錄: ${trackKey}`, error);
                }
            }

            return results.sort((a, b) => b.lastUsed - a.lastUsed);
        } catch (error) {
            console.error('❌ KV: 獲取用戶所有供應商偏好失敗:', error);
            return [];
        }
    }

    // 清除用戶所有數據
    async clearAllUserData(req) {
        if (!this.isKVAvailable) {
            throw new Error('KV Storage not available');
        }

        try {
            const userKey = this.generateUserKey(req);
            
            // 獲取所有相關的 keys
            const customLyricsIndex = await kv.get(`user_index:${userKey}:custom_lyrics`) || [];
            const providerPrefsIndex = await kv.get(`user_index:${userKey}:provider_pref`) || [];
            
            // 刪除所有自定義歌詞
            for (const trackKey of customLyricsIndex) {
                await kv.del(`custom_lyrics:${userKey}:${trackKey}`);
            }
            
            // 刪除所有供應商偏好
            for (const trackKey of providerPrefsIndex) {
                await kv.del(`provider_pref:${userKey}:${trackKey}`);
            }
            
            // 刪除索引
            await kv.del(`user_index:${userKey}:custom_lyrics`);
            await kv.del(`user_index:${userKey}:provider_pref`);

            console.log(`🧹 KV: 已清除用戶所有數據: ${userKey}`);
            return true;
        } catch (error) {
            console.error('❌ KV: 清除用戶所有數據失敗:', error);
            throw error;
        }
    }

    // =================
    // 內部輔助方法
    // =================

    // 更新用戶歌詞索引
    async updateUserLyricsIndex(userKey, trackKey, indexType) {
        try {
            const indexKey = `user_index:${userKey}:${indexType}`;
            const existingIndex = await kv.get(indexKey) || [];
            
            if (!existingIndex.includes(trackKey)) {
                existingIndex.push(trackKey);
                await kv.set(indexKey, existingIndex);
            }
        } catch (error) {
            console.warn('更新用戶索引失敗:', error);
        }
    }

    // 從用戶歌詞索引中移除
    async removeFromUserLyricsIndex(userKey, trackKey, indexType) {
        try {
            const indexKey = `user_index:${userKey}:${indexType}`;
            const existingIndex = await kv.get(indexKey) || [];
            
            const updatedIndex = existingIndex.filter(key => key !== trackKey);
            await kv.set(indexKey, updatedIndex);
        } catch (error) {
            console.warn('從用戶索引中移除失敗:', error);
        }
    }

    // 數據遷移：從 localStorage 到 KV
    async migrateFromLocalStorage(req, localStorageData) {
        if (!this.isKVAvailable) {
            throw new Error('KV Storage not available');
        }

        try {
            const userKey = this.generateUserKey(req);
            let migratedCount = 0;

            // 遷移自定義歌詞
            if (localStorageData.user_custom_lyrics) {
                const customLyrics = JSON.parse(localStorageData.user_custom_lyrics);
                
                for (const [trackKey, data] of Object.entries(customLyrics)) {
                    try {
                        const storageKey = `custom_lyrics:${userKey}:${trackKey}`;
                        await kv.set(storageKey, {
                            ...data,
                            userKey: userKey,
                            migratedAt: Date.now()
                        });
                        
                        await this.updateUserLyricsIndex(userKey, trackKey, 'custom_lyrics');
                        migratedCount++;
                    } catch (error) {
                        console.warn(`遷移自定義歌詞失敗 ${trackKey}:`, error);
                    }
                }
            }

            // 遷移供應商偏好
            if (localStorageData.user_lyrics_providers) {
                const providers = JSON.parse(localStorageData.user_lyrics_providers);
                
                for (const [trackKey, data] of Object.entries(providers)) {
                    try {
                        const storageKey = `provider_pref:${userKey}:${trackKey}`;
                        await kv.set(storageKey, {
                            ...data,
                            userKey: userKey,
                            migratedAt: Date.now()
                        });
                        
                        await this.updateUserLyricsIndex(userKey, trackKey, 'provider_pref');
                        migratedCount++;
                    } catch (error) {
                        console.warn(`遷移供應商偏好失敗 ${trackKey}:`, error);
                    }
                }
            }

            console.log(`✅ KV: 數據遷移完成，共遷移 ${migratedCount} 條記錄`);
            return { success: true, migratedCount };
        } catch (error) {
            console.error('❌ KV: 數據遷移失敗:', error);
            throw error;
        }
    }
}

module.exports = KVStorageManager;
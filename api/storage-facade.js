// api/storage-facade.js
const KVStorageManager = require('./kv-storage');
const EnhancedStorage = require('./storage-enhanced');

class StorageFacade {
    constructor() {
        this.kvManager = new KVStorageManager();
        this.enhancedStorage = new EnhancedStorage();
        this.isVercel = !!process.env.VERCEL;
        this.initialized = false;
        this.dbType = this.enhancedStorage.dbType; // Expose dbType
    }

    async init() {
        if (this.initialized) return;
        await this.kvManager.initialize();
        await this.enhancedStorage.init();
        this.dbType = this.enhancedStorage.dbType; // Update dbType after initialization
        this.initialized = true;
        console.log(`🚀 Storage Facade Initialized (Mode: ${this.isVercel ? 'Vercel/KV' : 'Local/Redis+DB'})`);
    }

    // --- Session Management (Transient) ---
    async getSession(sessionId) {
        return await this.kvManager.getSession(sessionId);
    }

    async saveSession(sessionId, sessionData) {
        return await this.kvManager.saveSession(sessionId, sessionData);
    }

    async deleteSession(sessionId) {
        return await this.kvManager.deleteSession(sessionId);
    }

    async getAllSessions() {
        return await this.kvManager.getAllSessions();
    }

    // --- Song Settings & Lyrics (Persistent) ---
    async saveLyrics(userId, trackInfo, lyrics, lyricsType, source) {
        if (!userId) throw new Error("User ID is required to save lyrics.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveUserCustomLyrics({ headers: { 'x-spotify-user-id': userId } }, trackInfo, lyrics, lyricsType, source);
        } else {
            await this.enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                lyricsContent: lyrics,
                customLyricsMeta: {
                    type: lyricsType,
                    source: source,
                    savedAt: Date.now()
                }
            });
            return true;
        }
    }

    async getLyrics(userId, trackIdOrInfo) {
        if (!userId) throw new Error("User ID is required to get lyrics.");
        const trackInfo = typeof trackIdOrInfo === 'string' ? { id: trackIdOrInfo } : trackIdOrInfo;
        
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getUserCustomLyrics({ headers: { 'x-spotify-user-id': userId } }, trackInfo);
        } else {
            const settings = await this.enhancedStorage.getSongSettings(userId, trackInfo.id);
            if (settings && settings.lyricsContent) {
                return {
                    trackInfo,
                    lyrics: settings.lyricsContent,
                    lyricsType: settings.customLyricsMeta?.type || 'plain',
                    source: settings.customLyricsMeta?.source || 'custom',
                    lastModified: settings.updated_at || Date.now(),
                    version: 2
                };
            }
            return null;
        }
    }

    async saveOffset(userId, trackInfo, timeOffset) {
        if (!userId) throw new Error("User ID is required to save offset.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveLyricsTimeOffset({ headers: { 'x-spotify-user-id': userId } }, trackInfo, timeOffset);
        } else {
            await this.enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                offset: timeOffset
            });
            return true;
        }
    }

    async getOffset(userId, trackInfo) {
        if (!userId) throw new Error("User ID is required to get offset.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getLyricsTimeOffset({ headers: { 'x-spotify-user-id': userId } }, trackInfo);
        } else {
            const settings = await this.enhancedStorage.getSongSettings(userId, trackInfo.id);
            return settings ? (settings.offset || 0) : 0;
        }
    }

    // --- Provider Preferences ---
    async saveProvider(userId, trackInfo, provider) {
        if (!userId) throw new Error("User ID is required to save provider.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveUserLyricsProvider({ headers: { 'x-spotify-user-id': userId } }, trackInfo, provider);
        } else {
            await this.enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                manualLyrics: { source: provider } // Overload manualLyrics.source for provider pref
            });
            return true;
        }
    }

    async getProvider(userId, trackInfo) {
        if (!userId) throw new Error("User ID is required to get provider.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getUserLyricsProvider({ headers: { 'x-spotify-user-id': userId } }, trackInfo);
        } else {
            const settings = await this.enhancedStorage.getSongSettings(userId, trackInfo.id);
            return settings?.manualLyrics?.source || null;
        }
    }

    // ✨ User Provider methods with full data support
    async saveUserProvider(userId, trackInfo, providerData) {
        if (!userId) throw new Error("User ID is required to save user provider.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveUserLyricsProvider({ headers: { 'x-spotify-user-id': userId } }, trackInfo, providerData);
        } else {
            await this.enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                manualLyrics: providerData
            });
            return true;
        }
    }

    async getUserProvider(userId, trackInfo) {
        if (!userId) throw new Error("User ID is required to get user provider.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getUserLyricsProvider({ headers: { 'x-spotify-user-id': userId } }, trackInfo);
        } else {
            const settings = await this.enhancedStorage.getSongSettings(userId, trackInfo.id);
            return settings?.manualLyrics || null;
        }
    }

    // --- 30 Day Cache (Global shared) ---
    async cacheLyrics(trackInfo, lyrics, lyricsType, source) {
        return await this.kvManager.cacheLyricsFor30Days(trackInfo, lyrics, lyricsType, source);
    }

    async getCachedLyrics(trackInfo) {
        return await this.kvManager.get30DayCachedLyrics(trackInfo);
    }

    // --- Migration & Cleanup ---
    async migrate(req, localStorageData) {
        return await this.kvManager.migrateFromLocalStorage(req, localStorageData);
    }

    async getSettings(userId, trackIdOrInfo) {
        if (!userId) throw new Error("User ID is required to get settings.");
        const trackInfo = typeof trackIdOrInfo === 'string' ? { id: trackIdOrInfo } : trackIdOrInfo;

        if (this.isVercel && this.kvManager.isKVAvailable) {
            const offset = await this.kvManager.getLyricsTimeOffset({ headers: { 'x-spotify-user-id': userId } }, trackInfo);
            const provider = await this.kvManager.getUserLyricsProvider({ headers: { 'x-spotify-user-id': userId } }, trackInfo);
            return { offset, provider };
        } else {
            return await this.enhancedStorage.getSongSettings(userId, trackInfo.id);
        }
    }

    async saveSettings(userId, trackId, settings) {
        if (!userId) throw new Error("User ID is required to save settings.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            const req = { headers: { 'x-spotify-user-id': userId } };
            const trackInfo = { id: trackId };
            if (settings.offset !== undefined) {
                await this.kvManager.saveLyricsTimeOffset(req, trackInfo, settings.offset);
            }
            if (settings.manualLyrics?.source) {
                await this.kvManager.saveUserLyricsProvider(req, trackInfo, settings.manualLyrics.source);
            }
        } else {
            await this.enhancedStorage.saveSongSettings(userId, trackId, settings);
        }
    }

    async getAllLyrics(userId) {
        if (!userId) throw new Error("User ID is required to get all lyrics.");
        return await this.enhancedStorage.getAllLyrics(userId);
    }

    async deleteLyrics(userId, trackId) {
        if (!userId || !trackId) return;
        return await this.enhancedStorage.deleteSongSettings(userId, trackId);
    }
    
    // --- Listening History ---
    async saveListeningHistory(req, historyData) {
        const userId = req.headers?.['x-spotify-user-id'];
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveListeningHistory(req, historyData);
        } else if (userId) {
            return await this.enhancedStorage.saveListeningHistory(userId, historyData);
        }
    }

    async getListeningHistory(req, days = 30) {
        const userId = req.headers?.['x-spotify-user-id'];
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getListeningHistory(req, days);
        } else if (userId) {
            return await this.enhancedStorage.getListeningHistory(userId, days);
        }
        return [];
    }

    async deduplicateHistory(req) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.deduplicateHistory(req);
        }
        // Local storage deduplication could be implemented in EnhancedStorage if needed,
        // but the main issue is with Vercel/KV.
        return { success: false, error: 'Not supported in local mode' };
    }

    // --- Locking ---
    async acquireLock(lockKey, ttl) {
        return await this.kvManager.acquireLock(lockKey, ttl);
    }

    async releaseLock(lockKey) {
        return await this.kvManager.releaseLock(lockKey);
    }
    
    // ✨ 雲端同步相關方法
    async getAllUserLyrics(req) {
        if (!req) throw new Error("Request is required to get all user lyrics.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getAllUserLyrics(req);
        } else {
            // 本地模式下，從 enhancedStorage 獲取
            const userId = req.headers?.['x-spotify-user-id'];
            if (!userId) throw new Error("User ID is required");
            return await this.enhancedStorage.getAllLyrics(userId);
        }
    }
    
    async syncLyricsToCloud(req, lyricsDataArray) {
        if (!req) throw new Error("Request is required to sync lyrics.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.syncLyricsToCloud(req, lyricsDataArray);
        } else {
            // 本地模式下，逐個保存
            const userId = req.headers?.['x-spotify-user-id'];
            if (!userId) throw new Error("User ID is required");
            let successCount = 0;
            for (const item of lyricsDataArray) {
                try {
                    await this.saveLyrics(userId, item.trackInfo, item.lyrics, item.lyricsType, item.source);
                    successCount++;
                } catch (e) {
                    console.error(`同步歌詞失敗 ${item.trackInfo?.id}:`, e);
                }
            }
            return { success: true, successCount, failedCount: lyricsDataArray.length - successCount, total: lyricsDataArray.length };
        }
    }
    
    async getLyricsStats(req) {
        if (!req) throw new Error("Request is required to get lyrics stats.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getLyricsStats(req);
        } else {
            // 本地模式下，從 enhancedStorage 獲取統計
            const userId = req.headers?.['x-spotify-user-id'];
            if (!userId) throw new Error("User ID is required");
            const allLyrics = await this.enhancedStorage.getAllLyrics(userId);
            return {
                totalLyrics: allLyrics.length,
                syncedLyrics: allLyrics.filter(l => l.lyricsContent && typeof l.lyricsContent === 'object' && Array.isArray(l.lyricsContent)).length,
                plainLyrics: allLyrics.filter(l => l.lyricsContent && !(typeof l.lyricsContent === 'object' && Array.isArray(l.lyricsContent))).length,
                withTimeOffset: allLyrics.filter(l => l.offset && l.offset !== 0).length,
                lastSyncedAt: allLyrics.length > 0 ? Math.max(...allLyrics.map(l => new Date(l.updated_at).getTime())) : null
            };
        }
    }
}

module.exports = new StorageFacade();

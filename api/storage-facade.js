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

    // --- Song Settings & Lyrics (Persistent) ---
    async saveLyrics(userId, trackInfo, lyrics, lyricsType, source) {
        if (!userId) throw new Error("User ID is required to save lyrics.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            // Vercel path needs to be made user-aware too if used
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

    async getLyrics(userId, trackInfo) {
        if (!userId) throw new Error("User ID is required to get lyrics.");
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
            return await this.kvManager.saveLyricsTimeOffset(trackInfo, timeOffset); // This also needs to be user-aware
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
            return await this.kvManager.getLyricsTimeOffset(trackInfo);
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

    // --- 30 Day Cache ---
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

    async getSettings(userId, trackInfo) {
        if (!userId) throw new Error("User ID is required to get settings.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            const offset = await this.kvManager.getLyricsTimeOffset(trackInfo);
            return { offset };
        } else {
            return await this.enhancedStorage.getSongSettings(userId, trackInfo.id);
        }
    }

    async saveSettings(userId, trackInfo, settings) {
        if (!userId) throw new Error("User ID is required to save settings.");
        if (this.isVercel && this.kvManager.isKVAvailable) {
            if (settings.offset !== undefined) {
                await this.kvManager.saveLyricsTimeOffset(trackInfo, settings.offset);
            }
        } else {
            await this.enhancedStorage.saveSongSettings(userId, trackInfo.id, settings);
        }
    }

    async getAllLyrics(userId) {
        if (!userId) throw new Error("User ID is required to get all lyrics.");
        return await this.enhancedStorage.getAllLyrics(userId);
    }

    async deleteLyrics(userId, trackId) {
        if (!userId || !trackId) return;
        // For now, only implementing for the non-Vercel path
        return await this.enhancedStorage.deleteSongSettings(userId, trackId);
    }
}

module.exports = new StorageFacade();

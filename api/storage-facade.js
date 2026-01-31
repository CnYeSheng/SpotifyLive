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
    async saveLyrics(req, trackInfo, lyrics, lyricsType, source) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveUserCustomLyrics(req, trackInfo, lyrics, lyricsType, source);
        } else {
            // Local: Sync to both Redis and DB via EnhancedStorage
            await this.enhancedStorage.saveSongSettings(trackInfo.id, {
                lyricsContent: lyrics,
                customLyricsMeta: {
                    type: lyricsType,
                    source: source,
                    savedAt: Date.now()
                }
            });
            // Also update KV/Redis cache if available in KVManager
            if (this.kvManager.isKVAvailable) {
                await this.kvManager.saveUserCustomLyrics(req, trackInfo, lyrics, lyricsType, source);
            }
            return true;
        }
    }

    async getLyrics(req, trackInfo) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getUserCustomLyrics(req, trackInfo);
        } else {
            // Try EnhancedStorage (DB/Redis sync)
            const settings = await this.enhancedStorage.getSongSettings(trackInfo.id);
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

    async saveOffset(trackInfo, timeOffset) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveLyricsTimeOffset(trackInfo, timeOffset);
        } else {
            await this.enhancedStorage.saveSongSettings(trackInfo.id, {
                offset: timeOffset
            });
            if (this.kvManager.isKVAvailable) {
                await this.kvManager.saveLyricsTimeOffset(trackInfo, timeOffset);
            }
            return true;
        }
    }

    async getOffset(trackInfo) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getLyricsTimeOffset(trackInfo);
        } else {
            const settings = await this.enhancedStorage.getSongSettings(trackInfo.id);
            return settings ? (settings.offset || 0) : 0;
        }
    }

    // --- Provider Preferences ---
    async saveProvider(req, trackInfo, provider) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.saveUserLyricsProvider(req, trackInfo, provider);
        } else {
            await this.enhancedStorage.saveSongSettings(trackInfo.id, {
                manualLyrics: { source: provider } // Overload manualLyrics.source for provider pref
            });
            if (this.kvManager.isKVAvailable) {
                await this.kvManager.saveUserLyricsProvider(req, trackInfo, provider);
            }
            return true;
        }
    }

    async getProvider(req, trackInfo) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            return await this.kvManager.getUserLyricsProvider(req, trackInfo);
        } else {
            const settings = await this.enhancedStorage.getSongSettings(trackInfo.id);
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

    async getSettings(trackInfo) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            const offset = await this.kvManager.getLyricsTimeOffset(trackInfo);
            // KV currently mostly stores content, but we can expand if needed.
            // For now return offset.
            return { offset };
        } else {
            return await this.enhancedStorage.getSongSettings(trackInfo.id);
        }
    }

    async saveSettings(trackInfo, settings) {
        if (this.isVercel && this.kvManager.isKVAvailable) {
            if (settings.offset !== undefined) {
                await this.kvManager.saveLyricsTimeOffset(trackInfo, settings.offset);
            }
            // Future: Implement saving manualLyrics pointer in KV if needed
        } else {
            await this.enhancedStorage.saveSongSettings(trackInfo.id, settings);
            
            // Sync offset to KV if available (hybrid)
            if (this.kvManager.isKVAvailable && settings.offset !== undefined) {
                await this.kvManager.saveLyricsTimeOffset(trackInfo, settings.offset);
            }
        }
    }

    async getAllLyrics() {
        return await this.enhancedStorage.getAllLyrics();
    }
}

module.exports = new StorageFacade();

// 增強歌詞功能的API端點
// Enhanced Lyrics API Endpoints

const KVStorageManager = require('./kv-storage.js');
const kvManager = new KVStorageManager();

// 處理30天自動緩存
async function handleAutoCache(req, res) {
    try {
        const { trackInfo, lyrics, lyricsType, source } = req.body;
        
        if (!trackInfo || !lyrics) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少必要參數' 
            });
        }
        
        const success = await kvManager.cacheLyricsFor30Days(trackInfo, lyrics, lyricsType, source);
        
        res.json({ 
            success: success,
            message: success ? '歌詞已緩存30天' : '緩存失敗'
        });
    } catch (error) {
        console.error('自動緩存錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// 獲取30天緩存的歌詞
async function getCachedLyrics(req, res) {
    try {
        const { trackId, trackName, artist } = req.params;
        
        if (!trackId || !trackName || !artist) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少歌曲信息' 
            });
        }
        
        const trackInfo = {
            id: decodeURIComponent(trackId),
            name: decodeURIComponent(trackName),
            artist: decodeURIComponent(artist)
        };
        
        const cached = await kvManager.get30DayCachedLyrics(trackInfo);
        
        if (cached) {
            res.json({ 
                success: true,
                data: cached,
                source: 'cache_30days'
            });
        } else {
            res.json({ 
                success: false,
                message: '無緩存歌詞'
            });
        }
    } catch (error) {
        console.error('獲取緩存歌詞錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// 永久保存歌詞
async function savePermanentLyrics(req, res) {
    try {
        const { trackInfo, lyrics, lyricsType, source } = req.body;
        
        if (!trackInfo || !lyrics) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少必要參數' 
            });
        }
        
        // 同時保存到用戶自定義歌詞和30天緩存
        const permanentSuccess = await kvManager.saveUserCustomLyrics(req, trackInfo, lyrics, lyricsType, {
            ...source,
            savedAt: Date.now(),
            permanent: true
        });
        
        const cacheSuccess = await kvManager.cacheLyricsFor30Days(trackInfo, lyrics, lyricsType, source);
        
        res.json({ 
            success: permanentSuccess,
            cached: cacheSuccess,
            message: permanentSuccess ? '歌詞已永久保存' : '保存失敗'
        });
    } catch (error) {
        console.error('永久保存歌詞錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// 保存時間偏移
async function saveTimeOffset(req, res) {
    try {
        const { trackInfo, timeOffset } = req.body;
        
        if (!trackInfo || timeOffset === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少必要參數' 
            });
        }
        
        const success = await kvManager.saveLyricsTimeOffset(trackInfo, timeOffset);
        
        res.json({ 
            success: success,
            message: success ? '時間偏移已保存' : '保存失敗'
        });
    } catch (error) {
        console.error('保存時間偏移錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// 獲取時間偏移
async function getTimeOffset(req, res) {
    try {
        const { trackId, trackName, artist } = req.params;
        
        if (!trackId || !trackName || !artist) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少歌曲信息' 
            });
        }
        
        const trackInfo = {
            id: decodeURIComponent(trackId),
            name: decodeURIComponent(trackName),
            artist: decodeURIComponent(artist)
        };
        
        const timeOffset = await kvManager.getLyricsTimeOffset(trackInfo);
        
        res.json({ 
            success: true,
            timeOffset: timeOffset,
            message: timeOffset !== 0 ? `已載入時間偏移: ${timeOffset}ms` : '無時間偏移'
        });
    } catch (error) {
        console.error('獲取時間偏移錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// 清理過期緩存
async function cleanupExpiredCache(req, res) {
    try {
        // 這個功能需要在 KVStorageManager 中實現
        // 目前 Redis 會自動清理過期數據，所以主要清理內存緩存
        
        let cleanedCount = 0;
        const now = Date.now();
        
        for (const [key, value] of kvManager.cache.entries()) {
            if (key.startsWith('cache:') && value.cached_until && now > value.cached_until) {
                kvManager.cache.delete(key);
                cleanedCount++;
            }
        }
        
        res.json({ 
            success: true,
            cleanedCount: cleanedCount,
            message: `已清理 ${cleanedCount} 個過期緩存`
        });
    } catch (error) {
        console.error('清理緩存錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

// 獲取緩存統計
async function getCacheStats(req, res) {
    try {
        const stats = {
            totalCacheEntries: 0,
            permanentLyrics: 0,
            thirtyDayCache: 0,
            timeOffsets: 0,
            expiredEntries: 0
        };
        
        const now = Date.now();
        
        for (const [key, value] of kvManager.cache.entries()) {
            stats.totalCacheEntries++;
            
            if (key.startsWith('lyrics:')) {
                stats.permanentLyrics++;
            } else if (key.startsWith('cache:')) {
                stats.thirtyDayCache++;
                if (value.cached_until && now > value.cached_until) {
                    stats.expiredEntries++;
                }
            } else if (key.startsWith('offset:')) {
                stats.timeOffsets++;
            }
        }
        
        res.json({ 
            success: true,
            stats: stats
        });
    } catch (error) {
        console.error('獲取緩存統計錯誤:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

module.exports = {
    handleAutoCache,
    getCachedLyrics,
    savePermanentLyrics,
    saveTimeOffset,
    getTimeOffset,
    cleanupExpiredCache,
    getCacheStats
};
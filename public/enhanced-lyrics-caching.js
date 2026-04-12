// 增強歌詞緩存管理系統
// Enhanced Lyrics Caching Management System

document.addEventListener('DOMContentLoaded', function() {
    if (typeof SpotifyLyricsPlayer !== 'undefined') {
        initEnhancedLyricsCaching();
    } else {
        setTimeout(() => {
            if (typeof SpotifyLyricsPlayer !== 'undefined') {
                initEnhancedLyricsCaching();
            }
        }, 1000);
    }
});

function initEnhancedLyricsCaching() {
    console.log('🔥 初始化增強歌詞緩存系統');
    
    // =================
    // 歌詞緩存管理 (30天緩存期)
    // =================
    
    // 擴展緩存期為30天
    SpotifyLyricsPlayer.prototype.extendedLyricsCacheExpiry = 30 * 24 * 60 * 60 * 1000; // 30天
    
    // 初始化增強緩存系統
    SpotifyLyricsPlayer.prototype.initEnhancedLyricsCache = function() {
        try {
            // 從localStorage載入緩存
            const cached = localStorage.getItem('enhanced_lyrics_cache');
            if (cached) {
                const cacheData = JSON.parse(cached);
                const now = Date.now();
                let loadedCount = 0;
                
                for (const [key, value] of Object.entries(cacheData)) {
                    // 檢查是否在30天緩存期內
                    if (now - value.timestamp < this.extendedLyricsCacheExpiry) {
                        this.enhancedLyricsCache.set(key, value);
                        loadedCount++;
                    }
                }
                this.log(`📚 已載入 ${loadedCount} 個30天緩存的歌詞`);
            }
            
            // 從KV載入永久保存的歌詞
            this.loadPermanentLyricsFromKV();
        } catch (error) {
            this.log(`❌ 載入增強歌詞緩存失敗: ${error.message}`);
        }
    };
    
    // 新增增強緩存Map
    if (!SpotifyLyricsPlayer.prototype.enhancedLyricsCache) {
        SpotifyLyricsPlayer.prototype.enhancedLyricsCache = new Map();
    }
    
    // 每次播放歌曲時自動緩存歌詞30天
    const originalLoadLyrics = SpotifyLyricsPlayer.prototype.loadLyrics;
    SpotifyLyricsPlayer.prototype.loadLyrics = async function() {
        // 先檢查增強緩存
        const cachedLyrics = this.getEnhancedCachedLyrics(this.currentTrack);
        if (cachedLyrics) {
            // ⚠️ 重要修正：必須先設置實例屬性，因为 displayLyrics 不接受參數
            this.lyrics = cachedLyrics.lyrics;
            this.lyricsType = cachedLyrics.lyricsType;
            this.currentLyricsTrackId = this.currentTrack.id; // 確保ID匹配
            
            this.displayLyrics(); // 調用無參數版本
            this.log(`⚡ 從增強緩存載入歌詞: ${this.currentTrack.name}`);
            this.updateStatus('lyrics', true); // 更新狀態指示器
            return;
        }
        
        // 執行原始載入邏輯
        const result = await originalLoadLyrics.call(this);
        
        // 載入成功後自動緩存30天
        if (this.lyrics && this.lyrics.length > 0 && this.currentTrack) {
            this.cacheEnhancedLyrics(this.currentTrack, this.lyrics, this.lyricsType);
        }
        
        return result;
    };
    
    // =================
    // 增強歌詞緩存功能
    // =================
    
    // 獲取增強緩存的歌詞
    SpotifyLyricsPlayer.prototype.getEnhancedCachedLyrics = function(track) {
        if (!track) return null;
        
        const cacheKey = this.generateTrackCacheKey(track);
        
        // 1. 檢查永久保存的歌詞
        const permanentLyrics = this.savedLyrics.get(cacheKey);
        if (permanentLyrics && Array.isArray(permanentLyrics.lyrics) && permanentLyrics.lyrics.length > 0) {
            this.log(`💎 從永久緩存載入: ${track.name}`);
            return permanentLyrics;
        }
        
        // 2. 檢查30天緩存
        const cached = this.enhancedLyricsCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.extendedLyricsCacheExpiry) {
            // 🚨 關鍵校驗：確保緩存的歌詞有效且不為空
            if (Array.isArray(cached.lyrics) && cached.lyrics.length > 0) {
                this.log(`📚 從30天緩存載入: ${track.name}`);
                return cached;
            } else {
                this.log(`⚠️ 緩存歌詞為空，將重新抓取: ${track.name}`);
                // 可選：從緩存中移除無效條目
                this.enhancedLyricsCache.delete(cacheKey);
            }
        }
        
        return null;
    };
    
    // 緩存歌詞到增強緩存 (30天)
    SpotifyLyricsPlayer.prototype.cacheEnhancedLyrics = function(track, lyrics, lyricsType, source = 'auto') {
        // 🚨 關鍵校驗：只緩存有效的非空歌詞
        if (!track || !lyrics || !Array.isArray(lyrics) || lyrics.length === 0) return;
        
        const cacheKey = this.generateTrackCacheKey(track);
        const cacheData = {
            lyrics: lyrics,
            lyricsType: lyricsType,
            timestamp: Date.now(),
            source: source,
            trackInfo: {
                id: track.id,
                name: track.name,
                artist: track.artist
            }
        };
        
        this.enhancedLyricsCache.set(cacheKey, cacheData);
        this.saveEnhancedCacheToStorage();
        this.log(`📚 歌詞已緩存30天: ${track.name} - ${track.artist}`);
    };
    
    // 永久保存歌詞到本地和KV
    SpotifyLyricsPlayer.prototype.saveLyricsPermanently = async function(track, lyrics, lyricsType, source = 'manual') {
        if (!track || !lyrics || !Array.isArray(lyrics)) return false;
        
        try {
            // 1. 保存到本地永久存儲
            this.saveLyrics(track, lyrics, lyricsType, source);
            
            // 2. 保存到KV存儲
            if (this.sessionId) {
                const success = await this.saveToKVStorage(track, lyrics, lyricsType, source);
                if (success) {
                    this.log(`☁️ 歌詞已保存到雲端: ${track.name}`);
                } else {
                    this.log(`⚠️ 雲端保存失敗，但本地保存成功`);
                }
            }
            
            this.showSuccessMessage('✅ 歌詞已永久保存');
            return true;
        } catch (error) {
            this.log(`❌ 永久保存失敗: ${error.message}`);
            return false;
        }
    };
    
    // =================
    // .srt 歌詞支援
    // =================
    
    // 解析 .srt 格式歌詞
    SpotifyLyricsPlayer.prototype.parseSrtLyrics = function(content) {
        // 移除可能存在的 BOM 並修剪
        const cleanContent = content.replace(/^\ufeff/, '').trim();
        const lines = cleanContent.split(/\r?\n/);
        const lyrics = [];
        let currentEntry = null;
        
        const pushSrtEntry = () => {
            if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text) {
                lyrics.push({
                    time: currentEntry.startTime,
                    text: currentEntry.text.trim()
                });
            }
            currentEntry = null;
        };
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (!line) {
                pushSrtEntry();
                continue;
            }
            
            // 檢查序號行 (例如 "1", "2")
            if (/^\d+$/.test(line)) {
                if (currentEntry && currentEntry.startTime !== undefined) {
                    pushSrtEntry();
                }
                currentEntry = { index: parseInt(line) };
                continue;
            }
            
            // 檢查時間軸行 (例如 "00:00:15,300 --> 00:00:18,500")
            // 支持 , 或 . 作為毫秒分隔符，支持 2 或 3 位毫秒
            const timeMatch = line.match(/(\d{1,2}):(\d{2}):(\d{2})[,\.](\d{2,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,\.](\d{2,3})/);
            if (timeMatch) {
                if (!currentEntry) {
                    currentEntry = {};
                }
                
                const h = parseInt(timeMatch[1]);
                const m = parseInt(timeMatch[2]);
                const s = parseInt(timeMatch[3]);
                let msStr = timeMatch[4];
                let ms = parseInt(msStr);
                
                // 如果毫秒是 2 位 (例如 00:00:01,50)，通常代表 500ms 或 50ms? 
                // 在 SRT 標準中應該是 3 位。如果是 2 位，我們補 0
                if (msStr.length === 2) ms *= 10;
                
                currentEntry.startTime = (h * 3600 + m * 60 + s) * 1000 + ms;
                continue;
            }
            
            // 文本行
            if (currentEntry) {
                if (!currentEntry.text) {
                    currentEntry.text = line;
                } else {
                    currentEntry.text += ' ' + line;
                }
            }
        }
        
        pushSrtEntry();
        
        return {
            type: lyrics.length > 0 ? 'synced' : 'plain',
            lyrics: lyrics
        };
    };
    
    // =================
    // 高級字詞級歌詞支援
    // =================
    
    // 解析字詞級歌詞 [00:10.710]我[00:10.900]需[00:11.130]要
    SpotifyLyricsPlayer.prototype.parseWordLevelLyrics = function(content) {
        const lines = content.split(/\r?\n/);
        const lyrics = [];
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 檢查是否為字詞級歌詞格式
            const wordTimeRegex = /\[(\d{2}):(\d{2})\.(\d{3})\]([^\[]*)/g;
            let wordMatches = [];
            let match;
            
            while ((match = wordTimeRegex.exec(trimmedLine)) !== null) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const milliseconds = parseInt(match[3]);
                const timeMs = minutes * 60000 + seconds * 1000 + milliseconds;
                const text = match[4];
                
                if (text) {
                    wordMatches.push({
                        time: timeMs,
                        text: text,
                        isWord: true
                    });
                }
            }
            
            if (wordMatches.length > 0) {
                // 將字詞組合成行
                let lineText = '';
                let lineStartTime = wordMatches[0].time;
                
                wordMatches.forEach(word => {
                    lineText += word.text;
                });
                
                lyrics.push({
                    time: lineStartTime,
                    text: lineText,
                    words: wordMatches
                });
            } else {
                // 檢查是否為普通LRC格式
                const lrcMatch = trimmedLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
                if (lrcMatch) {
                    const minutes = parseInt(lrcMatch[1]);
                    const seconds = parseInt(lrcMatch[2]);
                    const centiseconds = lrcMatch[3] ? parseInt(lrcMatch[3].padEnd(3, '0')) : 0;
                    const timeMs = minutes * 60000 + seconds * 1000 + centiseconds;
                    const text = lrcMatch[4].trim();
                    
                    if (text) {
                        lyrics.push({
                            time: timeMs,
                            text: text
                        });
                    }
                }
            }
        }
        
        return {
            type: lyrics.length > 0 ? 'synced' : 'plain',
            lyrics: lyrics,
            hasWordTiming: lyrics.some(line => line.words)
        };
    };
    
    // =================
    // 歌詞時間調整永久保存
    // =================
    
    // 增強時間調整保存功能
    const originalSaveLyricsTimeAdjustment = SpotifyLyricsPlayer.prototype.saveLyricsTimeAdjustment;
    SpotifyLyricsPlayer.prototype.saveLyricsTimeAdjustment = async function(track, timeOffset) {
        // 調用原始保存方法
        originalSaveLyricsTimeAdjustment.call(this, track, timeOffset);
        
        // 額外保存到KV
        if (this.sessionId) {
            try {
                await this.saveTimeOffsetToKV(track, timeOffset);
            } catch (error) {
                this.log(`⚠️ 保存時間調整到KV失敗: ${error.message}`);
            }
        }
    };
    
    // 保存時間偏移到KV
    SpotifyLyricsPlayer.prototype.saveTimeOffsetToKV = async function(track, timeOffset) {
        try {
            const response = await fetch('/api/kv/save-time-offset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({
                    trackInfo: {
                        id: track.id,
                        name: track.name,
                        artist: track.artist
                    },
                    timeOffset: timeOffset
                })
            });
            
            if (response.ok) {
                this.log(`✅ 時間偏移已保存到KV: ${timeOffset}ms`);
                return true;
            } else {
                throw new Error('保存失敗');
            }
        } catch (error) {
            this.log(`❌ 保存時間偏移到KV失敗: ${error.message}`);
            return false;
        }
    };
    
    // =================
    // KV存儲功能
    // =================
    
    // 保存到KV存儲
    SpotifyLyricsPlayer.prototype.saveToKVStorage = async function(track, lyrics, lyricsType, source) {
        try {
            const response = await fetch('/api/kv/save-lyrics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({
                    trackInfo: {
                        id: track.id,
                        name: track.name,
                        artist: track.artist
                    },
                    lyrics: lyrics,
                    lyricsType: lyricsType,
                    source: source
                })
            });
            
            return response.ok;
        } catch (error) {
            this.log(`❌ KV保存失敗: ${error.message}`);
            return false;
        }
    };
    
    // 從KV載入永久歌詞
    SpotifyLyricsPlayer.prototype.loadPermanentLyricsFromKV = async function() {
        if (!this.sessionId) return;
        
        try {
            const response = await fetch('/api/kv/user-lyrics', {
                headers: { 'X-Session-Id': this.sessionId }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.data && Array.isArray(data.data)) {
                    let loadedCount = 0;
                    data.data.forEach(lyricData => {
                        const cacheKey = this.generateTrackCacheKey(lyricData.trackInfo);
                        this.savedLyrics.set(cacheKey, lyricData);
                        loadedCount++;
                    });
                    
                    if (loadedCount > 0) {
                        this.saveSavedLyricsToStorage();
                        this.log(`☁️ 已從KV載入 ${loadedCount} 個永久歌詞`);
                    }
                }
            }
        } catch (error) {
            this.log(`❌ 從KV載入失敗: ${error.message}`);
        }
    };
    
    // =================
    // 存儲管理
    // =================
    
    // 保存增強緩存到localStorage
    SpotifyLyricsPlayer.prototype.saveEnhancedCacheToStorage = function() {
        try {
            const cacheObject = {};
            for (const [key, value] of this.enhancedLyricsCache.entries()) {
                cacheObject[key] = value;
            }
            localStorage.setItem('enhanced_lyrics_cache', JSON.stringify(cacheObject));
        } catch (error) {
            this.log(`❌ 保存增強緩存失敗: ${error.message}`);
            if (error.name === 'QuotaExceededError') {
                this.cleanupEnhancedCache();
            }
        }
    };
    
    // 清理增強緩存
    SpotifyLyricsPlayer.prototype.cleanupEnhancedCache = function() {
        const entries = Array.from(this.enhancedLyricsCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = entries.slice(0, Math.floor(entries.length / 2));
        
        toDelete.forEach(([key]) => {
            this.enhancedLyricsCache.delete(key);
        });
        
        this.saveEnhancedCacheToStorage();
        this.log(`🧹 已清理 ${toDelete.length} 個舊的增強緩存`);
    };
    
    // =================
    // 文件格式增強支援
    // =================
    
    // 增強的歌詞解析功能
    const originalParseLyricsContent = SpotifyLyricsPlayer.prototype.parseLyricsContent;
    SpotifyLyricsPlayer.prototype.parseLyricsContent = function(content) {
        // 檢測文件格式
        const trimmedContent = content.trim();
        
        // 1. 檢查是否為.srt格式
        if (this.isSrtFormat(trimmedContent)) {
            this.log('🎬 偵測到SRT格式歌詞');
            return this.parseSrtLyrics(trimmedContent);
        }
        
        // 2. 檢查是否為字詞級歌詞
        if (this.isWordLevelFormat(trimmedContent)) {
            this.log('🎵 偵測到字詞級歌詞');
            return this.parseWordLevelLyrics(trimmedContent);
        }
        
        // 3. 使用原始解析器處理標準LRC格式
        return originalParseLyricsContent.call(this, content);
    };
    
    // 檢測SRT格式
    SpotifyLyricsPlayer.prototype.isSrtFormat = function(content) {
        // 先移除可能存在的 BOM 並修剪
        const cleanContent = content.replace(/^\ufeff/, '').trim();
        // 更加寬容的檢測：只要包含典型的 SRT 時間軸格式即可
        // 支持小時為 1 或 2 位數，支持點或逗號作為毫秒分隔符
        const srtTimePattern = /\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{2,3}/;
        return srtTimePattern.test(cleanContent);
    };
    
    // 檢測字詞級格式
    SpotifyLyricsPlayer.prototype.isWordLevelFormat = function(content) {
        const wordTimePattern = /\[\d{2}:\d{2}\.\d{3}\][^\[]*\[\d{2}:\d{2}\.\d{3}\]/;
        return wordTimePattern.test(content);
    };
    
    // =================
    // 初始化
    // =================
    
    // 初始化增強緩存
    if (!SpotifyLyricsPlayer.prototype.enhancedLyricsCache) {
        SpotifyLyricsPlayer.prototype.enhancedLyricsCache = new Map();
    }
    
    // 綁定到現有播放器實例
    if (window.player) {
        window.player.enhancedLyricsCache = new Map();
        window.player.extendedLyricsCacheExpiry = 30 * 24 * 60 * 60 * 1000;
        window.player.initEnhancedLyricsCache();
    }
    
    console.log('✅ 增強歌詞緩存系統已加載完成');
}
// server.js
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const KVStorageManager = require('./api/kv-storage');
const EnhancedStorage = require('./api/storage-enhanced');
const logger = require('./utils/logger');
const monitor = require('./utils/monitor');
require('dotenv').config();

const kvStorage = new KVStorageManager();
const enhancedStorage = new EnhancedStorage();

// Initialize enhanced storage
enhancedStorage.init().catch(err => console.error('Failed to init storage:', err));

// 啟動監控和日誌系統
logger.info('Server starting...', { version: '2.0.0' });
monitor.startMetricsCollection(30000); // 每 30 秒收集指標

// 註冊警報處理器（示例：控制台輸出）
monitor.registerAlertHandler((alert) => {
  console.log(`🚨 ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);
  // 可以在這裡添加郵件、Slack、Webhook 等通知
});

// Rate limiter for Spotify API
class SpotifyRateLimiter {
    constructor() {
        this.sessionCalls = new Map();
        this.globalCalls = [];
        this.maxCallsPerMinute = 180; // Increased from 30
        this.maxCallsPerSession = 300; // Increased to accommodate multiple overlays
        this.retryAfterMs = 1000;
    }

    canMakeCall(sessionId) {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        this.globalCalls = this.globalCalls.filter(time => time > oneMinuteAgo);
        
        if (sessionId) {
            const sessionCalls = this.sessionCalls.get(sessionId) || [];
            const recentSessionCalls = sessionCalls.filter(time => time > oneMinuteAgo);
            this.sessionCalls.set(sessionId, recentSessionCalls);

            if (recentSessionCalls.length >= this.maxCallsPerSession) {
                return false;
            }
        }

        if (this.globalCalls.length >= this.maxCallsPerMinute) {
            return false;
        }

        return true;
    }

    recordCall(sessionId) {
        const now = Date.now();
        this.globalCalls.push(now);
        
        if (sessionId) {
            const sessionCalls = this.sessionCalls.get(sessionId) || [];
            sessionCalls.push(now);
            this.sessionCalls.set(sessionId, sessionCalls);
        }
    }

    handleRateLimit(retryAfter) {
        if (retryAfter) {
            this.retryAfterMs = parseInt(retryAfter) * 1000;
        } else {
            this.retryAfterMs = Math.min(this.retryAfterMs * 2, 30000);
        }
        return this.retryAfterMs;
    }
}

const spotifyRateLimiter = new SpotifyRateLimiter();

// Enhanced Spotify API call wrapper
async function makeSpotifyAPICall(url, options, sessionId) {
    if (!spotifyRateLimiter.canMakeCall(sessionId)) {
        const error = new Error('Rate limited');
        error.status = 429;
        error.retryAfter = 5000;
        throw error;
    }

    try {
        spotifyRateLimiter.recordCall(sessionId);
        const response = await axios({
            ...options,
            url: url,
            timeout: 8000 // 8 second timeout
        });
        spotifyRateLimiter.retryAfterMs = 1000;
        return response;
    } catch (error) {
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['retry-after'];
            const delay = spotifyRateLimiter.handleRateLimit(retryAfter);
            
            const rateLimitError = new Error('Spotify API rate limited');
            rateLimitError.status = 429;
            rateLimitError.retryAfter = delay;
            throw rateLimitError;
        }
        throw error;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'X-Session-Id', 'X-Spotify-User-Id'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

// 添加監控中間件
app.use(monitor.createMonitoringMiddleware());

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;
const LYRICS_API_URL = process.env.LYRICS_API_URL || 'https://lyrics.cyss.us.eu.org';

// Store user sessions (in production, use a proper database)
const userSessions = new Map();

// 從存儲中恢復所有過往會話，確保背景監控能立即工作
async function loadAllSessions() {
    try {
        console.log('📂 [System] Loading all persistent sessions...');
        const allSessions = await kvStorage.getAllSessions();
        let count = 0;
        for (const [sid, session] of allSessions.entries()) {
            userSessions.set(sid, session);
            count++;
        }
        console.log(`✅ [System] Loaded ${count} sessions into memory`);
    } catch (error) {
        console.error('❌ [System] Failed to load sessions:', error);
    }
}

// 在初始化後加載
setTimeout(loadAllSessions, 2000);

// Track song changes for token refresh and history recording (keyed by userId)
const songChangeTracker = new Map();

// 暫停時間閾值（毫秒）- 超過這個時間才算新的播放
const PAUSE_THRESHOLD = 5 * 60 * 1000; // 5 分鐘

// Cache for context names (playlist/album/artist names) - expires after 1 hour
const contextNameCache = new Map();
const CONTEXT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Track song changes and refresh token every 2 songs
async function trackSongChange(sessionId, track, userId, progressMs = 0, accessToken = null, isPlaying = true) {
    try {
        if (!userId) {return;};
        const trackId = track ? (typeof track === 'string' ? track : track.id) : null;
        
        // 使用 userId 作為追蹤 Key，這樣多個會話 (sessionId) 會共享同一個追蹤器狀態
        const trackerKey = userId;

        const tracker = songChangeTracker.get(trackerKey) || {
            currentTrackId: null,
            songCount: 0,
            lastRefreshTime: Date.now(),
            startTime: Date.now(),
            trackInfo: null,
            lastProgress: 0,
            lastPauseTime: null,  // 最後暫停時間
            wasPaused: false      // 是否曾暫停
        };

        // 處理暫停狀態
        if (!isPlaying && trackId) {
            // 記錄暫停時間
            tracker.wasPaused = true;
            if (!tracker.lastPauseTime) {
                tracker.lastPauseTime = Date.now();
                console.log(`⏸️ Playback paused: ${track.name} at ${progressMs}ms for user ${userId.substring(0, 8)}`);
            }
            songChangeTracker.set(trackerKey, tracker);
            return; 
        }

        // 如果從暫停恢復
        if (tracker.wasPaused && trackId === tracker.currentTrackId) {
            const pauseDuration = tracker.lastPauseTime ? (Date.now() - tracker.lastPauseTime) : 0;
            
            if (pauseDuration < PAUSE_THRESHOLD) {
                // 短時間內恢復，不算新的播放
                console.log(`▶️ Resumed after pause (${Math.floor(pauseDuration/1000)}s), not counting as new play for user ${userId.substring(0, 8)}`);
                tracker.wasPaused = false;
                tracker.lastPauseTime = null;
                // 更新 startTime 以考慮暫停時間
                tracker.startTime += pauseDuration;
                songChangeTracker.set(trackerKey, tracker);
                return;
            } else {
                // 暫停時間過長，算作新的播放
                console.log(`▶️ Resumed after long pause (${Math.floor(pauseDuration/1000)}s), counting as new play`);
                tracker.wasPaused = false;
                tracker.lastPauseTime = null;
            }
        }

        // Detect if it's a DIFFERENT song OR if the SAME song started over (repeat/loop)
        const isDifferentSong = tracker.currentTrackId !== trackId;
        const isRepeatedSong = !isDifferentSong && trackId && progressMs < tracker.lastProgress - 5000; 

        if (isDifferentSong || isRepeatedSong) {
            tracker.currentTrackId = trackId;
            tracker.trackInfo = track;
            tracker.startTime = Date.now();
            tracker.lastProgress = progressMs;
            tracker.isInitialRecorded = false; 
            
            // 儲存 context（歌單）資訊
            if (track.context) {
                const contextType = track.context.type;
                const contextUri = track.context.uri || track.context.href;
                
                let contextName = null;
                if (contextType === 'playlist' && contextUri) {
                    const playlistId = contextUri.split(':')[2];
                    if (playlistId) {
                        if (accessToken) {
                            try {
                                contextName = await fetchPlaylistName(playlistId, accessToken, sessionId);
                            } catch (err) {
                                contextName = `Playlist:${playlistId}`;
                            }
                        } else {
                            contextName = `Playlist:${playlistId}`;
                        }
                    }
                } else if (contextType === 'album') {
                    contextName = track.album?.name || null;
                } else if (contextType === 'artist') {
                    contextName = Array.isArray(track.artists) ? track.artists[0]?.name : null;
                }
                
                tracker.context = {
                    type: contextType,
                    name: contextName,
                    uri: contextUri
                };
            } else {
                tracker.context = null;
            }

            if (trackId) {
                tracker.songCount++;
                console.log(`🎵 ${isRepeatedSong ? '🔄 Loop detected:' : 'Song changed:'} ${track.name} (User: ${userId.substring(0, 8)}...) Count: ${tracker.songCount}`);
            } else {
                // Playback stopped
                if (tracker.isInitialRecorded) {
                    const now = Date.now();
                    const listenedDuration = now - tracker.startTime;
                    const trackDuration = tracker.trackInfo?.duration_ms || tracker.trackInfo?.duration || 0;
                    const durationMs = Math.min(listenedDuration, trackDuration);
                    
                    try {
                        if (process.env.VERCEL && kvStorage.isKVAvailable) {
                            await kvStorage.updateLastHistoryDuration({ headers: { 'x-spotify-user-id': userId, 'x-session-id': sessionId } }, durationMs);
                        } else {
                            await enhancedStorage.updateListeningHistoryDuration(userId, durationMs);
                        }
                    } catch (e) {
                        console.error('Failed to update final duration on stop:', e);
                    }
                }
            }

            // Refresh token every 2 songs
            if (tracker.songCount >= 2) {
                const session = userSessions.get(sessionId);
                if (session) {
                    refreshAccessToken(session, sessionId).catch(err => {
                        console.error('❌ Error in background token refresh:', err);
                    });
                }
                tracker.songCount = 0; 
                tracker.lastRefreshTime = Date.now();
            }
        } else if (trackId) {
            // Same song, check if we should record or update
            const now = Date.now();
            const listenedDuration = now - tracker.startTime;
            const trackDuration = tracker.trackInfo.duration_ms || tracker.trackInfo.duration || 0;
            const durationMs = Math.min(listenedDuration, trackDuration);

            // If listened > 5s and NOT yet initially recorded, record now!
            if (durationMs > 5000) {
                if (!tracker.isInitialRecorded) {
                    try {
                        const historyData = {
                            trackId: tracker.currentTrackId,
                            trackName: tracker.trackInfo.name,
                            artistName: Array.isArray(tracker.trackInfo.artists) ? tracker.trackInfo.artists.map(a => a.name).join(', ') : (tracker.trackInfo.artist || tracker.trackInfo.artistName),
                            albumName: tracker.trackInfo.album?.name || tracker.trackInfo.album || tracker.trackInfo.albumName,
                            durationMs: durationMs,
                            playedAt: new Date(tracker.startTime),
                            contextType: tracker.context?.type || null,
                            contextName: tracker.context?.name || null,
                            contextUri: tracker.context?.uri || null
                        };

                        if (process.env.VERCEL && kvStorage.isKVAvailable) {
                            await kvStorage.saveListeningHistory({ headers: { 'x-spotify-user-id': userId, 'x-session-id': sessionId } }, historyData);
                        } else {
                            await enhancedStorage.saveListeningHistory(userId, historyData);
                        }
                        tracker.isInitialRecorded = true;
                        console.log(`📝 Initially recorded ${tracker.trackInfo.name} after 5s (User: ${userId.substring(0, 8)})`);
                    } catch (e) {
                        console.error('Failed to save initial listening history:', e);
                    }
                } else {
                    // Already initially recorded, just update the duration
                    try {
                        if (process.env.VERCEL && kvStorage.isKVAvailable) {
                            await kvStorage.updateLastHistoryDuration({ headers: { 'x-spotify-user-id': userId, 'x-session-id': sessionId } }, durationMs);
                        } else {
                            await enhancedStorage.updateListeningHistoryDuration(userId, durationMs);
                        }
                    } catch (e) {
                        console.error('Failed to update listening history duration:', e);
                    }
                }
            }
            tracker.lastProgress = progressMs;
        }
        songChangeTracker.set(trackerKey, tracker);
    } catch (error) {
        console.error('❌ Error inside trackSongChange:', error);
    }
}// Clean up old song change trackers (older than 1 hour)
function cleanupSongChangeTrackers() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [sessionId, tracker] of songChangeTracker.entries()) {
        if (tracker.lastRefreshTime < oneHourAgo) {
            songChangeTracker.delete(sessionId);
            console.log(`🧹 Cleaned up old song change tracker for session ${sessionId.substring(0, 8)}...`);
        }
    }
}

// Run cleanup every 30 minutes
setInterval(cleanupSongChangeTrackers, 30 * 60 * 1000);

// Generate a simple session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Get user session from request
async function getUserSession(req) {
    const headerId = req.headers['x-session-id'] || req.query.sessionId || (req.body && req.body.sessionId);
    let sessionId = headerId;
    
    if (!sessionId) {
        const cookieHeader = req.headers.cookie || '';
        const cookies = Object.fromEntries(cookieHeader.split(';').map(v => {
            const idx = v.indexOf('=');
            if (idx === -1) return [v.trim(), ''];
            return [v.slice(0, idx).trim(), decodeURIComponent(v.slice(idx + 1))];
        }));
        sessionId = cookies['spotify_session'];
    }
    
    req.sessionId = sessionId;
    if (!sessionId) return null;
    
    // 優先檢查內存緩存
    if (userSessions.has(sessionId)) {
        return userSessions.get(sessionId);
    }
    
    // 從 KV 存儲中恢復
    try {
        if (typeof kvStorage !== 'undefined' && kvStorage.getSession) {
            const session = await kvStorage.getSession(sessionId);
            if (session) {
                userSessions.set(sessionId, session);
                return session;
            }
        }
    } catch (error) {
        console.error('從 KV 恢復 Session 失敗:', error.message);
    }
    
    return null;
}

// 獲取 Spotify User ID
async function getSpotifyUserId(session, sessionId) {
    if (session.userProfile && session.userProfile.data && session.userProfile.data.id) {
        return session.userProfile.data.id;
    }

    try {
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        
        session.userProfile = {
            data: response.data,
            timestamp: Date.now()
        };
        await saveUserSession(sessionId, session);
        return response.data.id;
    } catch (error) {
        console.error('獲取 Spotify User ID 失敗:', error.message);
        return null;
    }
}

// 保存會話
async function saveUserSession(sessionId, sessionData) {
    if (!sessionId || !sessionData) {return;}
    
    // 清除该 session 的轨道缓存，强制下一次请求重新获取最新状态
    if (sessionData.currentTrackCache) {
        delete sessionData.currentTrackCache;
    }

    // 保存到內存
    userSessions.set(sessionId, sessionData);
    
    // 保存到 KV
    try {
        if (typeof kvStorage !== 'undefined' && kvStorage.saveSession) {
            await kvStorage.saveSession(sessionId, sessionData);
        }
    } catch (error) {
        console.error('保存 Session 到 KV 失敗:', error.message);
    }
}

// Proactive re-authentication endpoint
app.get('/api/force-relogin', (req, res) => {
    console.log('🔄 Force re-login requested, clearing cookies and session...');
    res.clearCookie('spotify_session');
    // Also clear from memory/KV if sessionId is known
    const sessionId = req.headers['x-session-id'] || req.query.sessionId || req.cookies?.spotify_session;
    if (sessionId) {
        userSessions.delete(sessionId);
        if (typeof kvStorage !== 'undefined') {
            kvStorage.deleteSession(sessionId).catch(() => {});
        }
    }
    res.redirect('/api/auth');
});

// Spotify authorization URL with enhanced scopes
app.get('/api/auth', async (req, res) => {
    // Try to reuse existing session ID if available to keep devices synced
    let sessionId = null;
    try {
        const session = await getUserSession(req);
        if (session) {
            sessionId = req.sessionId;
        }
    } catch (e) {
        // Ignore session retrieval errors here
    }
    
    if (!sessionId) {
        sessionId = generateSessionId();
    }
    
    const scopes = [
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-playback-position',
        'user-read-private',  // 這個權限用於檢測會員狀態
        'user-library-modify',
        'user-library-read',
        'playlist-read-private',
        'playlist-read-collaborative',
        'streaming'
    ].join(' ');
    
    const authUrl = `https://accounts.spotify.com/authorize?` +
        `response_type=code&` +
        `client_id=${CLIENT_ID}&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `state=${sessionId}`;
    
    res.redirect(authUrl);
});

// Spotify callback
app.get('/callback', async (req, res) => {
    const { code, state: sessionId } = req.query;
    
    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        const sessionData = {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        };

        // Identify user to allow session reuse for synchronization
        let finalSessionId = sessionId;
        try {
            const userProfileResponse = await axios.get('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${sessionData.accessToken}` }
            });
            const userId = userProfileResponse.data.id;
            sessionData.userProfile = {
                data: userProfileResponse.data,
                timestamp: Date.now()
            };

            // Look for existing session for this Spotify User ID
            for (const [sid, existingSession] of userSessions.entries()) {
                if (existingSession.userProfile && 
                    existingSession.userProfile.data && 
                    existingSession.userProfile.data.id === userId) {
                    console.log(`♻️ Reusing existing session ${sid} for Spotify user ${userId}`);
                    finalSessionId = sid;
                    break;
                }
            }
        } catch (profileError) {
            console.error('⚠️ Could not fetch user profile during callback:', profileError.message);
        }
        
        await saveUserSession(finalSessionId, sessionData);
        res.cookie('spotify_session', finalSessionId, {
            maxAge: 30 * 24 * 60 * 60 * 1000, // Extend to 30 days for better sync experience
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        
        res.redirect(`/?auth=success&session=${finalSessionId}`);
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// Get currently playing track with enhanced information
app.get('/api/current-track', async (req, res) => {
    // Disable browser caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;

    // Server-side caching to prevent hitting Spotify rate limits with multiple overlays
    // Cache for 800ms (reduced from 2000ms for better real-time updates)
    if (session.currentTrackCache && (Date.now() - session.currentTrackCache.timestamp < 800)) {
        // Return cached data but update the 'progress' locally to make it smoother?
        // For now, just return cached data. The client interpolates anyway.
        // We can optionally estimate progress:
        const cachedData = session.currentTrackCache.data;
        if (cachedData.isPlaying) {
             const elapsed = Date.now() - session.currentTrackCache.timestamp;
             const estimatedProgress = Math.min(cachedData.duration, cachedData.progress + elapsed);
             // Return a copy with updated progress
             return res.json({ ...cachedData, progress: estimatedProgress });
        }
        return res.json(cachedData);
    }
    
    // Check if token needs refresh (more lenient - allow 1 minute grace period)
    const oneMinuteFromNow = Date.now() + (1 * 60 * 1000);
    if (session.expiresAt <= oneMinuteFromNow) {
        console.log('🔄 Token expires soon, attempting refresh...');
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            console.log('⚠️ Token refresh failed, but allowing current request to proceed');
            // Don't immediately return 401, let the request proceed and handle errors gracefully
        }
    }
    
    try {
        // console.log(`🎵 Fetching current track for session: ${sessionId?.substring(0, 8)}...`);
        
        // Check if we have a cached user profile (valid for 1 hour)
        let userProfilePromise;
        if (session.userProfile && (Date.now() - session.userProfile.timestamp < 3600000)) {
            userProfilePromise = Promise.resolve({ data: session.userProfile.data, status: 200 });
        } else {
            userProfilePromise = makeSpotifyAPICall('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }, sessionId).then(async response => {
                session.userProfile = {
                    data: response.data,
                    timestamp: Date.now()
                };
                await saveUserSession(sessionId, session);
                return response;
            });
        }

        // Check if we have a cached queue (valid for 30 seconds)
        let queuePromise;
        if (session.playerQueue && (Date.now() - session.playerQueue.timestamp < 30000)) {
            queuePromise = Promise.resolve({ data: session.playerQueue.data, status: 200 });
        } else {
            queuePromise = makeSpotifyAPICall('https://api.spotify.com/v1/me/player/queue', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }, sessionId).then(async response => {
                session.playerQueue = {
                    data: response.data,
                    timestamp: Date.now()
                };
                // We don't necessarily need to await saveUserSession here to speed up response, 
                // but let's do it to keep session consistent in KV.
                // However, session is already in memory Map 'userSessions'.
                return response;
            }).catch((err) => {
                console.log('⚠️ Queue API failed (non-critical):', err.message);
                return null;
            });
        }

        // 一次性獲取所有需要的數據，避免分批請求
        const [playerResponse, userResponse, queueResponse] = await Promise.all([
            makeSpotifyAPICall('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }, sessionId),
            userProfilePromise,
            queuePromise
        ]);
        
        // console.log(`📊 Player API response status: ${playerResponse.status}`);
        // console.log(`👤 User API response status: ${userResponse.status}`);
        
        if (playerResponse.status === 204 || !playerResponse.data || !playerResponse.data.item) {
            // console.log('🔍 No active playback detected');
            const user = userResponse?.data;
            if (user?.id) {
                // Use trackSongChange with null to save the last song
                await trackSongChange(sessionId, null, user.id);
            }

            const responseData = { 
                isPlaying: false,
                name: null,
                message: 'No music currently playing. Please start playing music in Spotify.'
            };
            // Cache empty state too (shorter duration maybe? 2s is fine)
            session.currentTrackCache = {
                data: responseData,
                timestamp: Date.now()
            };
            return res.json(responseData);
        }
        
        const data = playerResponse.data;
        const track = data.item;
        const device = data.device;
        const user = userResponse.data;
        
        // 調試：記錄 Spotify API 返回的 context 資訊
        console.log(`🔍 Spotify API context:`, data.context ? {
            type: data.context.type,
            uri: data.context.uri,
            href: data.context.href
        } : 'null');

        // Fetch saved settings for this track (using userId for synchronization)
        const savedSettings = await enhancedStorage.getSongSettings(user.id, track.id) || {};
        
        const currentTrack = {
            isPlaying: data.is_playing,
            name: track.name,
            artist: track.artists.map(artist => artist.name).join(', '),
            album: track.album.name,
            image: track.album.images[0]?.url,
            duration: track.duration_ms,
            progress: data.progress_ms,
            timestamp: data.timestamp || Date.now(),
            id: track.id,
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
            smart_shuffle: data.smart_shuffle || false,
            is_premium: user.product === 'premium',
            user_id: user.id,
            device: device ? {
                id: device.id,
                name: device.name,
                type: device.type,
                volume: device.volume_percent
            } : null,
            // 包含隊列信息（如果可用）
            queue: queueResponse?.data?.queue?.slice(0, 5).map(queueTrack => ({
                id: queueTrack.id,
                name: queueTrack.name,
                artist: queueTrack.artists.map(a => a.name).join(', '),
                image: queueTrack.album.images[0]?.url,
                // 👇 關鍵：保留原始 artists 和 album
                artists: queueTrack.artists,
                album: queueTrack.album
            })) || [],
            nextTrack: queueResponse?.data?.queue?.[0] ? {
                id: queueResponse.data.queue[0].id,
                name: queueResponse.data.queue[0].name,
                artist: queueResponse.data.queue[0].artists.map(a => a.name).join(', ')
            } : null,
            // 包含 context（歌單）資訊
            context: data.context ? {
                type: data.context.type,
                uri: data.context.uri,
                name: data.context.name || (await getContextName(data.context, session.accessToken, sessionId))
            } : null,
            // Control state - Use saved settings or defaults
            lyricsOffset: savedSettings.offset || 0,
            manualLyrics: savedSettings.manualLyrics || null
        };
        
        // 調試：記錄 context 資訊
        if (currentTrack.context) {
            console.log(`📀 Context returned: type=${currentTrack.context.type}, name=${currentTrack.context.name}, uri=${currentTrack.context.uri}`);
        } else {
            console.log(`⚠️ No context in response`);
        }
        
        // Save to cache
        session.currentTrackCache = {
            data: currentTrack,
            timestamp: Date.now()
        };

        // Track song change for token refresh - pass track with context attached
        try {
            const trackWithContext = { ...track, context: data.context };
            trackSongChange(sessionId, trackWithContext, user.id, currentTrack.progress, session.accessToken, currentTrack.isPlaying);
        } catch (e) {
            console.error('❌ Error in trackSongChange:', e);
        }
        
        res.json(currentTrack);
    } catch (error) {
        console.error(`❌ Error in /api/current-track:`, {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
            data: error.response?.data
        });
        
        // Handle rate limiting
        if (error.status === 429) {
            console.log(`⚠️ Rate limited, retry after ${error.retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: error.retryAfter,
                message: 'API rate limit exceeded, please wait before retrying'
            });
        }
        
        if (error.response?.status === 401) {
            console.log('🔑 Authentication error detected, attempting token refresh...');
            // Ensure req exists before accessing it
            if (req && req.sessionId) {
                const refreshed = await refreshAccessToken(session, req.sessionId);
                if (!refreshed) {
                    console.log('⚠️ Token refresh failed, returning 401');
                    return res.status(401).json({ 
                        error: 'Token expired, please re-authenticate',
                        needsAuth: true 
                    });
                }
                console.log('✅ Token refreshed, retrying request...');
                // Retry the request
                return res.redirect(307, req.originalUrl);
            } else {
                 console.log('⚠️ Authentication error but req.sessionId missing');
                 return res.status(401).json({ 
                    error: 'Token expired, please re-authenticate',
                    needsAuth: true 
                });
            }
        }
        
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['retry-after'] ? 
                parseInt(error.response.headers['retry-after']) * 1000 : 5000;
            console.log(`⚠️ Spotify API rate limited, retry after ${retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: retryAfter,
                message: 'Spotify API rate limit exceeded, please wait before retrying'
            });
        }
        
        // Handle common API errors
        if (error.response?.status === 403) {
            console.log('🚫 Access forbidden - check Spotify Premium status or scopes');
            return res.status(403).json({ 
                error: 'Access forbidden',
                message: 'This feature may require Spotify Premium or additional permissions'
            });
        }
        
        if (error.response?.status >= 500) {
            console.log('🔥 Spotify server error, will retry later');
            return res.status(502).json({ 
                error: 'Spotify service unavailable',
                message: 'Spotify servers are experiencing issues, please try again later'
            });
        }
        
        console.error('❌ Unexpected error fetching current track:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Failed to fetch current track',
            details: error.message 
        });
    }
});

// 輔助函數：清除該使用者的所有會話快取
async function invalidateUserCache(userId) {
    if (!userId) {return;}
    console.log(`🧹 清除使用者 ${userId} 的所有會話快取以進行同步`);
    for (const [sid, session] of userSessions.entries()) {
        if (session.userProfile && session.userProfile.data && session.userProfile.data.id === userId) {
            delete session.currentTrackCache;
            // 如果是 KV 存儲，也一併更新
            if (typeof kvStorage !== 'undefined' && kvStorage.saveSession) {
                await kvStorage.saveSession(sid, session);
            }
        }
    }
}

// Control endpoints
app.post('/api/control/offset', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    // We need the current track ID to save settings for it.
    // Try to get it from cache first, otherwise we might need to fetch it (or frontend sends it)
    let trackId = null;
    if (session.currentTrackCache && session.currentTrackCache.data) {
        trackId = session.currentTrackCache.data.id;
    }

    // Ideally frontend should send trackId to avoid ambiguity, but for now we use cached
    if (!trackId) {
        return res.status(400).json({ error: 'No active track found to apply offset' });
    }

    const { offset } = req.body; // milliseconds
    const newOffset = parseInt(offset) || 0;
    session.lyricsOffset = newOffset; // Keep in session for backward compat/fast access if needed
    
    // Get user ID for cross-device synchronization
    const userId = await getSpotifyUserId(session, req.sessionId);
    
    // Save to persistent storage
    if (userId) {
        await enhancedStorage.saveSongSettings(userId, trackId, { offset: newOffset });
        // 清除所有相關會話的快取
        await invalidateUserCache(userId);
    }
    
    await saveUserSession(req.sessionId, session);
    res.json({ success: true, lyricsOffset: newOffset });
});

app.post('/api/control/manual-lyrics', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    let trackId = null;
    if (session.currentTrackCache && session.currentTrackCache.data) {
        trackId = session.currentTrackCache.data.id;
    }

    if (!trackId) {
        return res.status(400).json({ error: 'No active track found to apply manual lyrics' });
    }

    const { id, source, title, artist } = req.body;
    
    let manualLyricsData = null;
    if (id && source) {
        manualLyricsData = { id, source, title, artist };
    }
    
    session.manualLyrics = manualLyricsData;
    
    // Get user ID for cross-device synchronization
    const userId = await getSpotifyUserId(session, req.sessionId);
    
    // Save to persistent storage
    if (userId) {
        await enhancedStorage.saveSongSettings(userId, trackId, { manualLyrics: manualLyricsData });
        // 清除所有相關會話的快取
        await invalidateUserCache(userId);
    }
    
    await saveUserSession(req.sessionId, session);
    res.json({ success: true, manualLyrics: manualLyricsData });
});

app.post('/api/control/reset', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    let trackId = null;
    if (session.currentTrackCache && session.currentTrackCache.data) {
        trackId = session.currentTrackCache.data.id;
    }

    session.lyricsOffset = 0;
    session.manualLyrics = null;
    
    const userId = await getSpotifyUserId(session, req.sessionId);
    if (userId) {
        if (trackId) {
            await enhancedStorage.saveSongSettings(userId, trackId, { offset: 0, manualLyrics: null, lyricsContent: null });
        }
        // 清除所有相關會話的快取
        await invalidateUserCache(userId);
    }

    await saveUserSession(req.sessionId, session);
    res.json({ success: true });
});

// 靜默刷新token端點
// ===============================
// 🔄 Refresh Spotify Access Token
// ===============================
// 靜默刷新 token 端點（正確多使用者版本）
app.post('/api/refresh-token', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ error: 'No session found' });
        }
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (refreshed) {
            const sessionId = req.headers['x-session-id'] || req.query.sessionId;
            res.json({ 
                success: true, 
                sessionId: sessionId,
                message: 'Token refreshed successfully'
            });
        } else {
            res.status(401).json({ 
                error: 'Token refresh failed',
                message: 'Please re-authenticate'
            });
        }
    } catch (err) {
        console.error('❌ Failed to refresh token:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// KV Storage API Endpoints (Bridged to EnhancedStorage)

app.get('/api/kv/status', (req, res) => {
    res.json({
        success: true,
        kvAvailable: enhancedStorage.initialized,
        userKey: 'local-user', // Simplified for local mode
        storageType: enhancedStorage.dbType
    });
});

app.post('/api/kv/user-lyrics', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { trackInfo, lyrics, lyricsType, source } = req.body;
        if (!trackInfo || !trackInfo.id) {
            return res.status(400).json({ error: 'Missing trackInfo' });
        }

        await enhancedStorage.saveSongSettings(userId, trackInfo.id, {
            lyricsContent: lyrics,
            customLyricsMeta: {
                type: lyricsType,
                source: source,
                savedAt: Date.now()
            },
            trackInfo: trackInfo // Store original trackInfo for reference
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving user lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/user-lyrics/:trackKey', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { info } = req.query;
        let trackId = null;
        
        if (info) {
            try {
                const trackInfo = JSON.parse(decodeURIComponent(info));
                trackId = trackInfo.id;
            } catch (e) {
                console.error('Failed to parse track info:', e);
            }
        }

        // Fallback: try to extract from trackKey
        if (!trackId && req.params.trackKey) {
            trackId = req.params.trackKey.split('-')[0];
        }

        if (!trackId) {
            return res.status(400).json({ error: 'Could not determine track ID' });
        }

        const settings = await enhancedStorage.getSongSettings(userId, trackId);
        
        if (settings && settings.lyricsContent) {
            res.json({
                success: true,
                data: {
                    lyrics: settings.lyricsContent,
                    lyricsType: settings.customLyricsMeta?.type || 'plain',
                    source: settings.customLyricsMeta?.source || 'custom',
                    lastModified: settings.updated_at || Date.now(),
                    trackInfo: settings.trackInfo || { id: trackId }
                }
            });
        } else {
            res.json({ success: true, message: 'No custom lyrics found', data: null });
        }
    } catch (error) {
        console.error('Error getting user lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get specific user lyrics via POST
app.post('/api/kv/user-lyrics/get', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { id, trackInfo } = req.body;
        const trackId = id || trackInfo?.id;

        if (!trackId) {
            return res.status(400).json({ error: 'Missing track ID' });
        }

        const settings = await enhancedStorage.getSongSettings(userId, trackId);
        if (settings && settings.lyricsContent) {
            res.json({
                success: true,
                data: {
                    lyrics: settings.lyricsContent,
                    lyricsType: settings.customLyricsMeta?.type || 'plain',
                    source: settings.customLyricsMeta?.source || 'custom',
                    lastModified: settings.updated_at || Date.now(),
                    trackInfo: settings.trackInfo || trackInfo || { id: trackId }
                }
            });
        } else {
            res.json({ success: true, data: null });
        }
    } catch (error) {
        console.error('Error in user-lyrics/get:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get specific user provider preference via POST
app.post('/api/kv/user-provider/get', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { id, trackInfo } = req.body;
        const trackId = id || trackInfo?.id;

        if (!trackId) {
            return res.status(400).json({ error: 'Missing track ID' });
        }

        const settings = await enhancedStorage.getSongSettings(userId, trackId);
        if (settings && settings.manualLyrics?.source) {
            res.json({
                success: true,
                data: {
                    provider: settings.manualLyrics.source,
                    lastUsed: settings.updated_at || Date.now()
                }
            });
        } else {
            res.json({ success: true, data: null });
        }
    } catch (error) {
        console.error('Error in user-provider/get:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export all lyrics
app.get(['/api/export-lyrics', '/api/kv/export-all-lyrics'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userLyrics = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));
        
        if (req.path.includes('export-lyrics')) {
             res.setHeader('Content-Disposition', 'attachment; filename="lyrics-export.json"');
        }
        res.setHeader('Content-Type', 'application/json');
        res.json(userLyrics);
    } catch (error) {
        console.error('Error exporting lyrics:', error);
        res.status(500).json({ error: 'Failed to export lyrics' });
    }
});

app.post('/api/kv/save-time-offset', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { trackInfo, timeOffset } = req.body;
        if (!trackInfo || !trackInfo.id) {
            return res.status(400).json({ error: 'Missing trackInfo' });
        }

        await enhancedStorage.saveSongSettings(userId, trackInfo.id, {
            offset: timeOffset,
            trackInfo: trackInfo
        });
        await invalidateUserCache(userId);

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving time offset:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/get-time-offset/:trackKey', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { trackKey } = req.params;
        // Try to extract ID from trackKey (format: id-artist-name)
        const trackId = trackKey.split('-')[0];
        
        if (!trackId) {
            return res.json({ timeOffset: 0 });
        }

        const settings = await enhancedStorage.getSongSettings(userId, trackId);
        res.json({ timeOffset: settings?.offset || 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Batch save lyrics endpoint
app.post('/api/kv/batch-save-lyrics', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { lyrics } = req.body;
        if (!lyrics || !Array.isArray(lyrics)) {
            return res.status(400).json({ error: 'Missing or invalid lyrics array' });
        }

        let successCount = 0;
        let errorCount = 0;

        for (const lyricData of lyrics) {
            try {
                const trackInfo = lyricData.trackInfo;
                if (!trackInfo || !trackInfo.id) {
                    errorCount++;
                    continue;
                }

                await enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                    lyricsContent: lyricData.lyrics,
                    lyricsType: lyricData.lyricsType,
                    customLyricsMeta: lyricData.customLyricsMeta || {
                        type: lyricData.lyricsType || 'plain',
                        source: lyricData.source || 'manual',
                        savedAt: lyricData.lastModified || lyricData.timestamp || Date.now()
                    },
                    trackInfo: trackInfo
                });

                successCount++;
            } catch (error) {
                console.error('Error saving individual lyric:', error.message);
                errorCount++;
            }
        }
        await invalidateUserCache(userId);

        res.json({
            success: true,
            message: `Batch save completed: ${successCount} successful, ${errorCount} failed`,
            successCount,
            errorCount
        });
    } catch (error) {
        console.error('Error in batch save lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all lyrics - for Vercel/KV deployment
app.get('/api/kv/all-lyrics', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userLyrics = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));

        res.json({
            success: true,
            total: userLyrics.length,
            data: userLyrics,
            lyrics: userLyrics
        });
    } catch (error) {
        console.error('Error getting all lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get all user lyrics (alias for get-all-lyrics for frontend compatibility)
app.get('/api/kv/user-lyrics', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userLyrics = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));

        res.json({
            success: true,
            data: userLyrics
        });
    } catch (error) {
        console.error('Error getting user lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint for batch synchronization (for compatibility with KVSyncManager)
app.post('/api/kv/sync-all', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const syncData = req.body || {};
        let successCount = 0;
        let errorCount = 0;

        // 1. Sync saved lyrics
        if (syncData.savedLyrics && typeof syncData.savedLyrics === 'object') {
            for (const [key, value] of Object.entries(syncData.savedLyrics)) {
                try {
                    const trackId = key.includes('-') ? key.split('-')[0] : key;
                    await enhancedStorage.saveSongSettings(userId, trackId, {
                        lyricsContent: value.lyrics,
                        lyricsType: value.lyricsType,
                        customLyricsMeta: value.customLyricsMeta || {
                            type: value.lyricsType || 'plain',
                            source: value.source || 'manual',
                            savedAt: value.lastModified || value.timestamp || Date.now()
                        },
                        trackInfo: value.trackInfo
                    });
                    successCount++;
                } catch (e) {
                    console.error(`Failed to sync lyric ${key}:`, e.message);
                    errorCount++;
                }
            }
        }

        // 2. Sync time adjustments
        if (syncData.timeAdjustments && typeof syncData.timeAdjustments === 'object') {
            for (const [key, value] of Object.entries(syncData.timeAdjustments)) {
                try {
                    const trackId = value?.trackInfo?.id || (key.includes('-') ? key.split('-')[0] : key);
                    const offset = typeof value === 'number' ? value : value.timeOffset;
                    await enhancedStorage.saveSongSettings(userId, trackId, {
                        offset: offset || 0,
                        trackInfo: value?.trackInfo || { id: trackId }
                    });
                    successCount++;
                } catch (e) {
                    console.error(`Failed to sync offset ${key}:`, e.message);
                    errorCount++;
                }
            }
        }

        await invalidateUserCache(userId);
        res.json({
            success: errorCount === 0,
            summary: {
                synced: successCount,
                failed: errorCount,
                total: successCount + errorCount
            }
        });
    } catch (error) {
        console.error('Error in sync-all:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/get-all-lyrics', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userLyrics = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));

        res.json({
            success: true,
            total: userLyrics.length,
            data: userLyrics,
            lyrics: userLyrics
        });
    } catch (error) {
        console.error('Error getting all lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save user lyrics provider preference
app.post(['/api/kv/save-provider', '/api/kv/user-provider'], async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { trackInfo, provider } = req.body;
        if (!trackInfo || !trackInfo.id || !provider) {
            return res.status(400).json({ error: 'Missing trackInfo or provider' });
        }

        await enhancedStorage.saveSongSettings(userId, trackInfo.id, {
            manualLyrics: { source: provider },
            trackInfo: trackInfo
        });
        await invalidateUserCache(userId);

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving provider:', error);
        res.status(500).json({ error: error.message });
    }
});

// Data migration endpoint from localStorage to KV/DB
app.post('/api/kv/migrate', async (req, res) => {
    try {
        console.log('🔄 Starting data migration...');
        const { localStorageData } = req.body;
        
        if (!localStorageData) {
            return res.status(400).json({
                success: false,
                error: 'Missing localStorageData parameter'
            });
        }

        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ 
                success: false, 
                error: 'Not authenticated' 
            });
        }

        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                error: 'Could not identify user' 
            });
        }

        let migratedCount = 0;

        // Migrate custom lyrics
        if (localStorageData.user_custom_lyrics) {
            try {
                const lyricsData = JSON.parse(localStorageData.user_custom_lyrics);
                for (const [trackKey, lyricEntry] of Object.entries(lyricsData)) {
                    try {
                        const trackId = trackKey.split('--')[0] || trackKey;
                        await enhancedStorage.saveSongSettings(userId, trackId, {
                            lyricsContent: lyricEntry.lyrics,
                            customLyricsMeta: {
                                type: lyricEntry.lyricsType || 'plain',
                                source: lyricEntry.source || 'custom',
                                savedAt: Date.now()
                            },
                            trackInfo: lyricEntry.trackInfo
                        });
                        migratedCount++;
                        console.log(`✅ Migrated lyrics for track: ${trackKey}`);
                    } catch (e) {
                        console.error(`❌ Failed to migrate lyrics for ${trackKey}:`, e.message);
                    }
                }
            } catch (parseError) {
                console.error('❌ Failed to parse user_custom_lyrics:', parseError.message);
            }
        }

        // Migrate lyrics providers
        if (localStorageData.user_lyrics_providers) {
            try {
                const providersData = JSON.parse(localStorageData.user_lyrics_providers);
                for (const [trackKey, providerEntry] of Object.entries(providersData)) {
                    try {
                        const trackId = trackKey.split('--')[0] || trackKey;
                        await enhancedStorage.saveSongSettings(userId, trackId, {
                            manualLyrics: { source: providerEntry.provider || providerEntry }
                        });
                        migratedCount++;
                        console.log(`✅ Migrated provider for track: ${trackKey}`);
                    } catch (e) {
                        console.error(`❌ Failed to migrate provider for ${trackKey}:`, e.message);
                    }
                }
            } catch (parseError) {
                console.error('❌ Failed to parse user_lyrics_providers:', parseError.message);
            }
        }

        console.log(`✅ Migration completed: ${migratedCount} items migrated`);
        await invalidateUserCache(userId);
        res.json({
            success: true,
            message: 'Data migration completed',
            data: { migratedCount }
        });
    } catch (error) {
        console.error('❌ Migration error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Batch save lyrics endpoint (for compatibility with client)
app.post('/api/kv/sync-lyrics', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { lyrics } = req.body;
        if (!lyrics || !Array.isArray(lyrics)) {
            return res.status(400).json({ error: 'Missing or invalid lyrics array' });
        }

        let successCount = 0;
        let errorCount = 0;

        for (const lyricData of lyrics) {
            try {
                const trackInfo = lyricData.trackInfo;
                if (!trackInfo || !trackInfo.id) {
                    errorCount++;
                    continue;
                }

                await enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                    lyricsContent: lyricData.lyrics,
                    lyricsType: lyricData.lyricsType,
                    customLyricsMeta: lyricData.customLyricsMeta || {
                        type: lyricData.lyricsType || 'plain',
                        source: lyricData.source || 'manual',
                        savedAt: lyricData.lastModified || lyricData.timestamp || Date.now()
                    },
                    trackInfo: trackInfo
                });

                successCount++;
            } catch (error) {
                console.error('Error saving individual lyric:', error.message);
                errorCount++;
            }
        }
        await invalidateUserCache(userId);

        res.json({
            success: true,
            message: `Batch save completed: ${successCount} successful, ${errorCount} failed`,
            successCount,
            errorCount
        });
    } catch (error) {
        console.error('Error in batch save lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint for time adjustments sync (for compatibility with client)
app.post('/api/kv/sync-time-adjustments', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const { adjustments } = req.body;
        if (!adjustments || !Array.isArray(adjustments)) {
            return res.status(400).json({ error: 'Missing or invalid adjustments array' });
        }

        let successCount = 0;
        let errorCount = 0;

        for (const adjustmentData of adjustments) {
            try {
                const trackInfo = adjustmentData.trackInfo;
                const timeOffset = adjustmentData.timeOffset;

                if (!trackInfo || !trackInfo.id || timeOffset === undefined) {
                    errorCount++;
                    continue;
                }

                await enhancedStorage.saveSongSettings(userId, trackInfo.id, {
                    offset: timeOffset,
                    trackInfo: trackInfo
                });

                successCount++;
            } catch (error) {
                console.error('Error saving individual time adjustment:', error.message);
                errorCount++;
            }
        }
        await invalidateUserCache(userId);

        res.json({
            success: true,
            message: `Time adjustments sync completed: ${successCount} successful, ${errorCount} failed`,
            successCount,
            errorCount
        });
    } catch (error) {
        console.error('Error in time adjustments sync:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get all time adjustments (for compatibility with client)
app.get('/api/kv/time-adjustments', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userSettings = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));

        // Extract time offsets
        const timeAdjustments = userSettings
            .filter(item => item.offset !== undefined)
            .map(item => ({
                key: item.trackId,
                timeOffset: item.offset,
                trackInfo: item.trackInfo || { id: item.trackId }
            }));

        res.json({
            success: true,
            data: timeAdjustments
        });
    } catch (error) {
        console.error('Error getting time adjustments:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/get-time-offsets', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userSettings = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));
        const data = userSettings
            .filter(item => item.offset !== undefined && item.offset !== null)
            .map(item => ({
                key: item.trackId,
                timeOffset: item.offset,
                offset: item.offset,
                trackInfo: item.trackInfo,
                lastUpdated: item.updatedAt || item.lastModified || 0
            }));
        const offsets = {};
        data.forEach(item => {
            offsets[item.key] = item;
        });

        res.json({ success: true, data, offsets });
    } catch (error) {
        console.error('Error getting time offsets:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/user-providers', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    try {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        const userId = await getSpotifyUserId(session, req.sessionId);
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        const userSettings = normalizeStoredUserSettings(await enhancedStorage.getAllLyrics(userId));
        const data = userSettings
            .filter(item => item.manualLyrics?.source)
            .map(item => ({
                key: item.trackId,
                provider: item.manualLyrics.source,
                settings: item.manualLyrics,
                trackInfo: item.trackInfo,
                lastUsed: item.updatedAt || item.lastModified || 0
            }));

        res.json({ success: true, data });
    } catch (error) {
        console.error('Error getting user providers:', error);
        res.status(500).json({ error: error.message });
    }
});

// Authentication middleware
async function authenticateSpotify(req, res, next) {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    // Identify user and attach to request for synchronization
    const userId = await getSpotifyUserId(session, req.sessionId);
    if (userId) {
        req.userId = userId;
        req.headers['x-spotify-user-id'] = userId;
    }
    
    // Proactively refresh token if it expires within 5 minutes
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (session.expiresAt <= fiveMinutesFromNow) {
        console.log('🔄 Token expires soon, refreshing proactively...');
        try {
            const refreshed = await refreshAccessToken(session, req.sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            req.session = session;
            next();
        } catch (e) {
            return res.status(401).json({ error: 'Token refresh failed' });
        }
    } else {
        req.session = session;
        next();
    }
}

// Enhanced refresh access token with better logging
async function refreshAccessToken(session, sessionId) {
    if (!session.refreshToken) {
        console.log('ℹ️ No refresh token available');
        return false;
    }
    try {
        console.log('🔄 Refreshing access token...');
        const response = await axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: session.refreshToken,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        session.accessToken = response.data.access_token;
        if (response.data.refresh_token) {
            session.refreshToken = response.data.refresh_token;
        }
        session.expiresAt = Date.now() + (response.data.expires_in * 1000);
        
        // 同步到 KV
        if (sessionId) {
            await saveUserSession(sessionId, session);
        }
        
        console.log('✅ Token refreshed successfully...');
        return true;
    } catch (error) {
        console.error('❌ Error refreshing token:', error.response?.data || error.message);
        return false;
    }
}

// Enhanced authentication status check with proactive token refresh
app.get('/api/auth-status', async (req, res) => {
    const session = await getUserSession(req);
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    if (!session) {
        return res.json({ 
            authenticated: false,
            sessionId: null
        });
    }
    
    // Check if token needs refresh (proactive refresh)
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (session.expiresAt <= fiveMinutesFromNow) {
        console.log('🔄 Proactive token refresh triggered by auth-status check');
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            // Token refresh failed, but still return current status
            console.log('⚠️ Token refresh failed in auth-status check');
            return res.json({ 
                authenticated: false,
                sessionId: sessionId,
                error: 'Token refresh failed'
            });
        }
    }
    
    res.json({ 
        authenticated: true,
        sessionId: sessionId
    });
});

// 輔助函數：獲取歌單名稱（帶緩存）
async function fetchPlaylistName(playlistId, accessToken, sessionId) {
    const cacheKey = `playlist:${playlistId}`;
    
    // 檢查緩存
    if (contextNameCache.has(cacheKey)) {
        const cached = contextNameCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) {
            return cached.name;
        }
        // 過期，刪除
        contextNameCache.delete(cacheKey);
    }
    
    try {
        const response = await makeSpotifyAPICall(
            `https://api.spotify.com/v1/playlists/${playlistId}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            },
            sessionId
        );
        const name = response.data?.name || null;
        
        // 存入緩存
        if (name) {
            contextNameCache.set(cacheKey, {
                name,
                timestamp: Date.now()
            });
        }
        
        return name;
    } catch (error) {
        console.error(`❌ Failed to fetch playlist name for ${playlistId}:`, error.message);
        return null;
    }
}

// 獲取 context 名稱（歌單、專輯、藝術家）（帶緩存）
async function getContextName(context, accessToken, sessionId) {
    if (!context) return null;
    
    try {
        const contextType = context.type;
        const contextUri = context.uri;
        
        if (contextType === 'playlist' && contextUri) {
            const playlistId = contextUri.split(':')[2];
            if (playlistId) {
                return await fetchPlaylistName(playlistId, accessToken, sessionId);
            }
        } else if (contextType === 'album') {
            const albumId = contextUri?.split(':')[2];
            if (albumId) {
                const cacheKey = `album:${albumId}`;
                
                // 檢查緩存
                if (contextNameCache.has(cacheKey)) {
                    const cached = contextNameCache.get(cacheKey);
                    if (Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) {
                        return cached.name;
                    }
                    contextNameCache.delete(cacheKey);
                }
                
                const response = await makeSpotifyAPICall(
                    `https://api.spotify.com/v1/albums/${albumId}`,
                    {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    },
                    sessionId
                );
                const name = response.data?.name || null;
                
                if (name) {
                    contextNameCache.set(cacheKey, {
                        name,
                        timestamp: Date.now()
                    });
                }
                
                return name;
            }
        } else if (contextType === 'artist') {
            const artistId = contextUri?.split(':')[2];
            if (artistId) {
                const cacheKey = `artist:${artistId}`;
                
                // 檢查緩存
                if (contextNameCache.has(cacheKey)) {
                    const cached = contextNameCache.get(cacheKey);
                    if (Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) {
                        return cached.name;
                    }
                    contextNameCache.delete(cacheKey);
                }
                
                const response = await makeSpotifyAPICall(
                    `https://api.spotify.com/v1/artists/${artistId}`,
                    {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    },
                    sessionId
                );
                const name = response.data?.name || null;
                
                if (name) {
                    contextNameCache.set(cacheKey, {
                        name,
                        timestamp: Date.now()
                    });
                }
                
                return name;
            }
        }
    } catch (error) {
        console.error(`❌ Failed to fetch context name:`, error.message);
    }
    
    return null;
}

// 清理過期的緩存
function cleanupContextCache() {
    const now = Date.now();
    for (const [key, value] of contextNameCache.entries()) {
        if (now - value.timestamp >= CONTEXT_CACHE_TTL) {
            contextNameCache.delete(key);
        }
    }
}

// 每 30 分鐘清理一次緩存
setInterval(cleanupContextCache, 30 * 60 * 1000);

// 記錄上次同步時間，避免過於頻繁
const lastSyncTime = new Map();
const SYNC_COOLDOWN = 5 * 60 * 1000; // 5 分鐘同步一次即可

// Sync recently played tracks from Spotify to fill gaps (e.g. when server was offline)
async function syncRecentlyPlayed(sessionId, userId, accessToken) {
    if (!userId || !accessToken) return;
    
    // 1. Throttling: 檢查冷卻時間
    const now = Date.now();
    const lastSync = lastSyncTime.get(userId) || 0;
    if (now - lastSync < SYNC_COOLDOWN) {
        return;
    }

    // 2. Distributed Lock: 防止併發同步
    const lockKey = `sync:${userId}`;
    const acquired = await kvStorage.acquireLock(lockKey, 120); 
    if (!acquired) {
        console.log(`⚠️ [Sync] User ${userId.substring(0, 8)} is already syncing, skipping...`);
        return;
    }
    
    try {
        lastSyncTime.set(userId, now);
        console.log(`🔄 [Sync] Fetching recently played for user ${userId.substring(0, 8)}...`);
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }, sessionId);

        if (!response.data || !response.data.items || response.data.items.length === 0) {
            return;
        }

        // Get existing history for the last 1 day to check for duplicates
        let history = [];
        if (process.env.VERCEL && kvStorage.isKVAvailable) {
            history = await kvStorage.getListeningHistory({ headers: { 'x-spotify-user-id': userId } }, 1);
        } else {
            history = await enhancedStorage.getListeningHistory(userId, 1);
        }

        // 使用「秒」級精度和同首歌時間窗口，避免 live tracker + recently-played 雙來源重複。
        const existingTimestamps = new Set(history.map(h => Math.floor(getHistoryPlayedAtMs(h) / 1000)));
        let newRecords = 0;

        for (const item of response.data.items) {
            const playedAt = new Date(item.played_at);
            const tsSeconds = Math.floor(playedAt.getTime() / 1000);
            const track = item.track;
            const historyData = {
                trackId: track.id,
                trackName: track.name,
                artistName: Array.isArray(track.artists) ? track.artists.map(a => a.name).join(', ') : track.artistName,
                albumName: track.album?.name || track.albumName,
                durationMs: track.duration_ms,
                playedAt: playedAt,
                contextType: item.context?.type || null,
                contextName: null, 
                contextUri: item.context?.uri || null
            };

            // Only record if it doesn't already exist in our history (Check by second)
            if (!existingTimestamps.has(tsSeconds) && !hasNearbySameTrack(history, historyData)) {
                if (process.env.VERCEL && kvStorage.isKVAvailable) {
                    await kvStorage.saveListeningHistory({ headers: { 'x-spotify-user-id': userId, 'x-session-id': sessionId } }, historyData);
                } else {
                    await enhancedStorage.saveListeningHistory(userId, historyData);
                }
                
                // 內部即時去重
                existingTimestamps.add(tsSeconds);
                history.unshift(historyData);
                newRecords++;
            }
        }

        if (newRecords > 0) {
            console.log(`✅ [Sync] Added ${newRecords} missing records for user ${userId.substring(0, 8)}`);
        }
    } catch (error) {
        console.error(`❌ [Sync] Failed for ${userId.substring(0, 8)}:`, error.message);
        // 如果失敗，縮短冷卻時間以便重試
        lastSyncTime.set(userId, now - (SYNC_COOLDOWN / 2));
    } finally {
        await kvStorage.releaseLock(lockKey).catch(() => {});
    }
}

// --- History Management ---

function getHistoryPlayedAtMs(item) {
    const value = item?.playedAt || item?.timestamp;
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStoredUserSetting(item) {
    if (!item) return null;
    const trackId = item.trackId || item.track_id || item.trackInfo?.id;
    if (!trackId) return null;

    const trackInfo = item.trackInfo || {
        id: trackId,
        name: item.trackName || item.name || '',
        artist: item.artistName || item.artist || ''
    };
    const meta = item.customLyricsMeta || item.metaData || {};

    return {
        ...item,
        trackId,
        trackInfo,
        lyrics: item.lyrics || item.lyricsContent || null,
        lyricsContent: item.lyricsContent || item.lyrics || null,
        lyricsType: item.lyricsType || meta.type || 'synced',
        customLyricsMeta: meta,
        source: item.source || meta.source || 'custom',
        lastModified: item.lastModified || item.updatedAt || item.updated_at || item.timestamp || 0,
        updatedAt: item.updatedAt || item.updated_at || item.lastModified || item.timestamp || 0
    };
}

function normalizeStoredUserSettings(items) {
    return (items || []).map(normalizeStoredUserSetting).filter(Boolean);
}

function getHistoryTrackKey(item) {
    return item?.trackId || `${item?.trackName || item?.name || ''}|||${item?.artistName || item?.artist || ''}`;
}

function getSameTrackWindowSeconds(item) {
    const durationSeconds = Math.ceil((item?.durationMs || item?.duration_ms || 0) / 1000);
    return Math.max(180, Math.min(durationSeconds + 60, 600));
}

function hasNearbySameTrack(history, candidate) {
    const candidateAt = getHistoryPlayedAtMs(candidate);
    const candidateTrack = getHistoryTrackKey(candidate);
    if (!candidateAt || !candidateTrack) return false;

    return (history || []).some(item => {
        if (candidateTrack !== getHistoryTrackKey(item)) return false;
        const itemAt = getHistoryPlayedAtMs(item);
        if (!itemAt) return false;
        const windowSeconds = Math.max(getSameTrackWindowSeconds(candidate), getSameTrackWindowSeconds(item));
        return Math.abs(candidateAt - itemAt) / 1000 <= windowSeconds;
    });
}

function deduplicateListeningHistory(history, closeWindowSeconds = 30) {
    const seen = new Set();
    const unique = [];

    for (const item of history || []) {
        const playedAtMs = getHistoryPlayedAtMs(item);
        if (!playedAtMs) {
            unique.push(item);
            continue;
        }

        const ts = Math.floor(playedAtMs / 1000);
        const trackKey = getHistoryTrackKey(item);
        const identifier = `${trackKey}:${ts}`;
        const lastItem = unique[unique.length - 1];
        const lastTs = lastItem ? Math.floor(getHistoryPlayedAtMs(lastItem) / 1000) : null;
        const sameTrackWindowSeconds = Math.max(closeWindowSeconds, getSameTrackWindowSeconds(item));
        const isTooClose = lastItem &&
            trackKey === getHistoryTrackKey(lastItem) &&
            Math.abs(ts - lastTs) <= sameTrackWindowSeconds;

        if (!seen.has(identifier) && !isTooClose) {
            seen.add(identifier);
            unique.push(item);
        }
    }

    return unique;
}

app.get('/api/history/deduplicate', async (req, res) => {
    console.log('🔍 [Deduplicate] Received request in server.js');
    try {
        const session = await getUserSession(req);
        if (!session) {
            console.log('❌ [Deduplicate] Not authenticated');
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const userId = session.userProfile?.data?.id || await getSpotifyUserId(session, req.sessionId);
        if (!userId) {
            console.log('❌ [Deduplicate] User ID not found');
            return res.status(400).json({ error: 'User ID not found' });
        }
        
        console.log(`🔄 [Deduplicate] Starting for user ${userId.substring(0, 8)}`);
        let result;
        if (process.env.VERCEL && kvStorage.isKVAvailable) {
            req.headers['x-spotify-user-id'] = userId;
            result = await kvStorage.deduplicateHistory(req);
        } else {
            // 本地模式去重 (EnhancedStorage)
            console.log(`🔍 [Deduplicate] Local mode for user ${userId.substring(0, 8)}`);
            const history = await enhancedStorage.getListeningHistory(userId, 365); 
            const originalCount = history.length;
            const uniqueHistory = deduplicateListeningHistory(history);
            
            if (uniqueHistory.length < originalCount) {
                console.log(`💾 [Deduplicate] Saving cleaned history: ${originalCount} -> ${uniqueHistory.length}`);
                await enhancedStorage.saveFullListeningHistory(userId, uniqueHistory);
            }
            
            result = { originalCount, newCount: uniqueHistory.length, removedCount: originalCount - uniqueHistory.length };
        }
        
        console.log(`✅ [Deduplicate] Finished: removed ${result.removedCount} items`);
        res.json({ 
            success: true, 
            message: `清理完成，共移除 ${result.removedCount} 條重複紀錄`,
            data: result
        });
    } catch (error) {
        console.error('❌ [Deduplicate] Error:', error);
        res.status(500).json({ error: 'Failed to deduplicate history', message: error.message });
    }
});

// Get listening stats
app.get('/api/stats/listening', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        let until = null;
        if (days === 2) {
            until = new Date();
            until.setHours(0, 0, 0, 0);
        }
        
        let history = [];
        const session = await getUserSession(req);
        const userId = session ? await getSpotifyUserId(session, req.sessionId) : null;

        // Trigger sync in background if it's the first page load (usually days=1 or days=7)
        if (session && userId) {
            syncRecentlyPlayed(req.sessionId, userId, session.accessToken).catch(err => {
                console.error('Background sync failed:', err);
            });
        }

        if (process.env.VERCEL && kvStorage.isKVAvailable) {
            history = await kvStorage.getListeningHistory(req, days, until);
        } else if (userId) {
            history = await enhancedStorage.getListeningHistory(userId, days, until);
        }
        history = deduplicateListeningHistory(history);
        
        // Calculate stats
        const totalDuration = history.reduce((sum, item) => sum + (item.durationMs || 0), 0);
        
        const songCounts = {};
        history.forEach(item => {
            // 確保 trackName 和 artistName 存在，如果不存在則嘗試從其他欄位獲取
            let trackName = item.trackName || item.name || item.title || '未知歌曲';
            let artistName = item.artistName || item.artist || '未知歌手';
            
            // 如果是舊格式（name 欄位包含 " - "），則進行分割
            if (!item.trackName && item.name && item.name.includes(' - ')) {
                const parts = item.name.split(' - ');
                trackName = parts[0] || item.name;
                artistName = parts.slice(1).join(' - ') || '未知歌手';
            }
            
            const key = `${trackName}|||${artistName}`;
            if (!songCounts[key]) {
                songCounts[key] = {
                    trackName: trackName,
                    artistName: artistName,
                    count: 0
                };
            }
            songCounts[key].count += 1;
        });
        
        const topSongs = Object.values(songCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        const uniqueSongCount = Object.keys(songCounts).length;
        
        // 計算歌單統計
        const playlistCounts = {};
        
        history.forEach(item => {
            if (item.contextType === 'playlist') {
                let playlistId = null;
                let playlistUri = item.contextUri || '';
                
                // 從 URI 提取 ID (支援 spotify:playlist:ID 和 https://.../playlists/ID)
                if (playlistUri.includes('playlist:')) {
                    playlistId = playlistUri.split('playlist:')[1].split(':')[0].split('?')[0];
                } else if (playlistUri.includes('/playlists/')) {
                    playlistId = playlistUri.split('/playlists/')[1].split('?')[0].split('/')[0];
                } else if (item.contextName && item.contextName.startsWith('Playlist:')) {
                    playlistId = item.contextName.split(':')[1];
                }
                
                // 如果真的提取不到 ID，就用名稱作為 Key (但這通常不應該發生)
                const playlistKey = playlistId || item.contextName || 'Unknown Playlist';
                
                if (!playlistCounts[playlistKey]) {
                    playlistCounts[playlistKey] = {
                        id: playlistId,
                        name: item.contextName || (playlistId ? `Playlist:${playlistId}` : '未知歌單'),
                        uri: item.contextUri || (playlistId ? `spotify:playlist:${playlistId}` : ''),
                        count: 0,
                        tracks: new Set()
                    };
                }
                
                // 更新名稱：如果目前是 "Playlist:ID" 或 "未知"，且有更好的名稱，則更換
                const currentName = playlistCounts[playlistKey].name;
                const isGenericName = !currentName || currentName.startsWith('Playlist:') || currentName === '未知歌單' || currentName === '載入中...';
                if (item.contextName && !item.contextName.startsWith('Playlist:') && item.contextName !== '載入中...' && isGenericName) {
                    playlistCounts[playlistKey].name = item.contextName;
                }
                
                playlistCounts[playlistKey].count += 1;
                if (item.trackId) playlistCounts[playlistKey].tracks.add(item.trackId);
            }
        });
        
        // 再次檢查是否有 ID 相同但 Key 不同的項 (例如一個用 ID 當 Key，一個用 Name 當 Key)
        // 並進行最後合併
        const finalPlaylistCounts = {};
        Object.values(playlistCounts).forEach(p => {
            const finalKey = p.id || p.name;
            if (!finalPlaylistCounts[finalKey]) {
                finalPlaylistCounts[finalKey] = p;
            } else {
                // 合併數據
                finalPlaylistCounts[finalKey].count += p.count;
                p.tracks.forEach(t => finalPlaylistCounts[finalKey].tracks.add(t));
                // 如果目前的名稱是泛用的，則更新為更具體的
                const isGeneric = finalPlaylistCounts[finalKey].name.startsWith('Playlist:');
                if (isGeneric && !p.name.startsWith('Playlist:')) {
                    finalPlaylistCounts[finalKey].name = p.name;
                }
            }
        });
        
        // 轉換為陣列
        const topPlaylists = Object.values(finalPlaylistCounts)
            .map(playlist => ({
                name: playlist.name,
                uri: playlist.uri,
                count: playlist.count,
                uniqueTracks: playlist.tracks.size
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
            
        res.json({
            success: true,
            totalDurationMs: totalDuration,
            songCount: history.length,
            uniqueSongCount,
            topSongs,
            topPlaylists,
            history: history.slice(0, 50)
        });
    } catch (error) {
        console.error('Failed to fetch listening stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 獲獲歌單詳情（包含用戶播放過的歌曲）
app.get('/api/playlist/:id', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const playlistId = req.params.id;
        const days = parseInt(req.query.days) || 7; // 預設使用 7 天，與統計摘要一致
        const sessionId = req.headers['x-session-id'] || req.sessionId;
        const userId = session ? await getSpotifyUserId(session, sessionId) : null;
        
        // 檢查 token 是否需要刷新
        if (Date.now() >= session.expiresAt) {
            const refreshed = await refreshAccessToken(session, sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
        }
        
        // 獲取歌單基本資訊
        const playlistResponse = await makeSpotifyAPICall(
            `https://api.spotify.com/v1/playlists/${playlistId}`,
            {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            },
            sessionId
        );
        
        const playlist = playlistResponse.data;
        
        // 獲取歌單中的所有歌曲（用於匹配）
        const tracksResponse = await makeSpotifyAPICall(
            `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`,
            {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            },
            sessionId
        );
        
        const allTracks = tracksResponse.data.items.map(item => ({
            id: item.track?.id,
            name: item.track?.name,
            artist: item.track?.artists?.map(a => a.name).join(', '),
            album: item.track?.album?.name,
            image: item.track?.album?.images?.[0]?.url,
            duration_ms: item.track?.duration_ms
        })).filter(track => track.id !== null);
        
        // 獲取用戶在指定天數內的聽歌歷史
        let history = [];
        if (process.env.VERCEL && kvStorage.isKVAvailable) {
            history = await kvStorage.getListeningHistory(req, days, null);
        } else if (userId) {
            history = await enhancedStorage.getListeningHistory(userId, days, null);
        }
        history = deduplicateListeningHistory(history);
        
        // 過濾出只在這個歌單中播放的記錄
        const playlistContextUri = `spotify:playlist:${playlistId}`;
        const playlistHistory = history.filter(item => {
            // 匹配 contextUri
            const uriMatch = item.contextUri === playlistContextUri;
            // 或者匹配 contextName (作為備用方案)
            const nameMatch = item.contextName && (item.contextName === playlist.name || item.contextName === `Playlist:${playlistId}`);
            return uriMatch || nameMatch;
        });
        
        // 找出歌單中用戶實際播放過的歌曲（僅限這個歌單）
        const playedTrackIds = new Set(playlistHistory.map(item => item.trackId));
        const playedTracks = allTracks.filter(track => playedTrackIds.has(track.id));
        
        // 為每首播放過的歌曲添加播放次數（僅統計在這個歌單中的播放）
        const trackPlayCounts = {};
        playlistHistory.forEach(item => {
            if (playedTrackIds.has(item.trackId)) {
                trackPlayCounts[item.trackId] = (trackPlayCounts[item.trackId] || 0) + 1;
            }
        });
        
        // 添加播放次數到歌曲資訊
        const playedTracksWithCount = playedTracks.map(track => ({
            ...track,
            playCount: trackPlayCounts[track.id] || 0
        })).sort((a, b) => b.playCount - a.playCount);
        
        res.json({
            success: true,
            playlist: {
                id: playlist.id,
                name: playlist.name,
                description: playlist.description,
                image: playlist.images?.[0]?.url,
                total_tracks: playlist.tracks.total,
                owner: playlist.owner?.display_name,
                played_tracks_count: playedTracks.length
            },
            tracks: playedTracksWithCount
        });
    } catch (error) {
        console.error('Failed to fetch playlist details:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/devices', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/devices', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        
        res.json({ devices: response.data.devices || [] });
    } catch (error) {
        // Handle rate limiting
        if (error.status === 429) {
            console.log(`⚠️ Devices API rate limited, retry after ${error.retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: error.retryAfter,
                message: 'API rate limit exceeded, please wait before retrying'
            });
        }
        
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // 重新導向以重試請求
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error fetching devices:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to fetch devices',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// Get user playlists
app.get('/api/playlists', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const sessionId = req.headers['x-session-id'] || req.sessionId;
        const userId = await getSpotifyUserId(session, sessionId);
        
        if (!userId) {
            return res.status(500).json({ error: 'Failed to identify user' });
        }

        const response = await axios.get('https://api.spotify.com/v1/me/playlists?limit=50', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const playlists = (response.data.items || []).map(playlist => {
            if (!playlist) return null;
            
            // 權限判斷：我是擁有者，或者這是協作歌單
            const isOwner = playlist.owner?.id === userId;
            const canEdit = isOwner || playlist.collaborative === true;
            
            return {
                id: playlist.id,
                name: playlist.name || '未命名歌單',
                image: playlist.images?.[0]?.url,
                tracks: playlist.tracks?.total || 0,
                owner: playlist.owner?.id,
                collaborative: playlist.collaborative,
                canEdit: canEdit
            };
        }).filter(Boolean);
        
        res.json({ playlists });
    } catch (error) {
        console.error('Error fetching playlists:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch playlists' });
    }
});

// Add track to playlist
app.post('/api/playlists/:playlistId/tracks', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const { playlistId } = req.params;
        const { trackId } = req.body;
        
        await axios.post(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            uris: [`spotify:track:${trackId}`]
        }, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding track to playlist:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to add track to playlist' });
    }
});

// Remove track from playlist
app.delete('/api/playlists/:playlistId/tracks', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const { playlistId } = req.params;
        const { trackId } = req.body;
        
        await axios.delete(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` },
            data: {
                tracks: [{ uri: `spotify:track:${trackId}` }]
            }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing track from playlist:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to remove track from playlist' });
    }
});

// Check if track is in playlist
app.get('/api/playlists/:playlistId/tracks/:trackId', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const { playlistId, trackId } = req.params;
        
        const response = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const isInPlaylist = response.data.items.some(item => item.track?.id === trackId);
        res.json({ isInPlaylist });
    } catch (error) {
        console.error('Error checking track in playlist:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to check track in playlist' });
    }
});

// Get user's liked songs
app.get('/api/liked-songs', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/tracks?limit=50', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const tracks = response.data.items.map(item => ({
            id: item.track.id,
            name: item.track.name,
            artist: item.track.artists.map(a => a.name).join(', '),
            image: item.track.album.images[0]?.url,
            duration: item.track.duration_ms
        }));
        
        res.json({ tracks });
    } catch (error) {
        console.error('Error fetching liked songs:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch liked songs' });
    }
});

// Enhanced player control endpoints
app.post('/api/playback/play-pause', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        // Get current playback state first
        const statusResponse = await axios.get('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const isPlaying = statusResponse.data?.is_playing;
        const deviceId = req.body.deviceId;
        
        let url, method;
        if (isPlaying) {
            url = 'https://api.spotify.com/v1/me/player/pause';
            method = 'PUT';
        } else {
            url = 'https://api.spotify.com/v1/me/player/play';
            method = 'PUT';
        }
        
        await axios({
            method,
            url,
            headers: { 'Authorization': `Bearer ${session.accessToken}` },
            data: deviceId ? { device_ids: [deviceId] } : {}
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error controlling playback:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to control playback' });
    }
});

app.post('/api/playback/seek', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { position_ms } = req.body;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    try {
        await axios.put(`https://api.spotify.com/v1/me/player/seek?position_ms=${position_ms}`, {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error seeking:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to seek' });
    }
});

app.post('/api/playback/previous', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        await axios.post('https://api.spotify.com/v1/me/player/previous', {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error skipping to previous track:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to skip to previous track' });
    }
});

app.post('/api/playback/next', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        await axios.post('https://api.spotify.com/v1/me/player/next', {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error skipping to next track:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to skip to next track' });
    }
});

app.post('/api/playback/volume', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { volume, set } = req.body;
    
    try {
        await axios.put(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`, {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error setting volume:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to set volume' });
    }
});

app.post('/api/playback/shuffle', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        // Get current shuffle state first
        const statusResponse = await axios.get('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const currentState = statusResponse.data?.shuffle_state;
        const newState = !currentState;
        
        await axios.put(`https://api.spotify.com/v1/me/player/shuffle?state=${newState}`, {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error toggling shuffle:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to toggle shuffle' });
    }
});

app.post('/api/playback/repeat', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const repeatModes = ['off', 'context', 'track'];
    
    try {
        // Get current repeat state first
        const statusResponse = await axios.get('https://api.spotify.com/v1/me/player', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const currentState = statusResponse.data?.repeat_state;
        const currentIndex = repeatModes.indexOf(currentState);
        const nextIndex = (currentIndex + 1) % repeatModes.length;
        const newState = repeatModes[nextIndex];
        
        await axios.put(`https://api.spotify.com/v1/me/player/repeat?state=${newState}`, {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        res.json({ success: true, state: newState });
    } catch (error) {
        console.error('Error toggling repeat:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to toggle repeat' });
    }
});

// Library management
app.post('/api/library/add', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { trackId } = req.body;
    
    try {
        await axios.put(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {}, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error adding track to library:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to add track to library' });
    }
});

app.post('/api/library/remove', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { trackId } = req.body;
    
    try {
        await axios.delete(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error removing track from library:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to remove track from library' });
    }
});

// Check if track is in user's library
app.get('/api/library/check/:trackId', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { trackId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const response = await makeSpotifyAPICall(`https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        
        const isLiked = response.data && response.data[0] === true;
        res.json({ isLiked });
    } catch (error) {
        // Handle rate limiting
        if (error.status === 429) {
            console.log(`⚠️ Library check API rate limited, retry after ${error.retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: error.retryAfter,
                message: 'API rate limit exceeded, please wait before retrying'
            });
        }
        
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            try {
                const retry = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/queue', {
                    headers: { 'Authorization': `Bearer ${session.accessToken}` }
                }, sessionId);
                if (!retry.data || !retry.data.queue) {
                    return res.json({ queue: [], nextTrack: null });
                }
                const rawQueue = retry.data.queue.slice(0, 20);
                const queue = rawQueue.map((track) => {
                    const artists = track.artists || [];
                    const artistNames = artists.map(artist => artist.name).join(', ') || '未知歌手';
                    const album = track.album || {};
                    const images = album.images || [];
                    const imageUrl = images.length > 0 ? images[0].url : null;
                    return {
                        id: track.id,
                        name: track.name,
                        artist: artistNames,
                        image: imageUrl,
                        duration: track.duration_ms,
                        artists: artists,
                        album: album
                    };
                });
                const nextTrack = queue[0] || null;
                return res.json({ queue, nextTrack });
            } catch (e) {
                return res.status(e.response?.status || 500).json({ 
                    error: 'Failed to get queue',
                    details: e.response?.data?.error?.message || e.message
                });
            }
        }
        
        console.error('Error checking if track is liked:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to check track status',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// Get queue information
app.get('/api/player/queue', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/queue', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        
        if (!response.data || !response.data.queue) {
            return res.json({ queue: [], nextTrack: null });
        }
        
        const rawQueue = response.data.queue.slice(0, 20);
        console.log(`🎵 原始Queue數據 (${rawQueue.length}首):`, rawQueue.slice(0, 2).map(track => ({
            id: track.id,
            name: track.name, 
            hasArtists: !!track.artists,
            artistsLength: track.artists?.length,
            hasAlbum: !!track.album,
            hasImages: !!track.album?.images?.length,
            firstImage: track.album?.images?.[0]?.url
        })));
        
        const queue = rawQueue.map((track, index) => {
            // 修復：確保正確處理藝術家和封面信息
            const artists = track.artists || [];
            const artistNames = artists.map(artist => artist.name).join(', ') || '未知歌手';
            
            const album = track.album || {};
            const images = album.images || [];
            const imageUrl = images.length > 0 ? images[0].url : null;
            
            const trackData = {
                id: track.id,
                name: track.name,
                artist: artistNames,
                image: imageUrl,
                duration: track.duration_ms,
                // 添加更多詳細信息
                artists: artists,
                album: album
            };
            
            // 調試：記錄前幾首歌的處理結果
            if (index < 3) {
                console.log(`🎯 處理後的Track ${index + 1}:`, {
                    name: trackData.name,
                    artist: trackData.artist,
                    hasImage: !!trackData.image,
                    imageUrl: trackData.image?.substring(0, 60) || 'NO_IMAGE'
                });
            }
            
            return trackData;
        });
        
        // 🚨 最終數據驗證：確保發送給前端的數據完整
        console.log('🎯 即將發送到前端的Queue數據驗證:', {
            隊列長度: queue.length,
            前3首詳情: queue.slice(0, 3).map((track, i) => ({
                序號: i + 1,
                歌曲名: track.name,
                歌手: track.artist,
                有圖片: !!track.image,
                圖片預覽: track.image ? track.image.substring(0, 50) + '...' : 'NO_IMAGE'
            }))
        });
        
        const nextTrack = queue[0] || null;
        
        res.json({ queue, nextTrack });
    } catch (error) {
        // Handle rate limiting
        if (error.status === 429) {
            console.log(`⚠️ Queue API rate limited, retry after ${error.retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: error.retryAfter,
                message: 'API rate limit exceeded, please wait before retrying'
            });
        }
        
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error getting queue:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to get queue',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// Parse LRC format function
function parseLrcFormat(lrcString) {
    const lines = lrcString.split('\n');
    const lyrics = [];
    let isLrc = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        // 1. 提取 [mm:ss.xx] 標籤
        const wordLevelRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]([^\[]*)/g;
        const tagWordRegex = /<(\d+),(\d+),\d+>([^<]*)/g;
        let matches = [];
        let match;
        
        while ((match = wordLevelRegex.exec(trimmedLine)) !== null) {
            const mins = parseInt(match[1]);
            const secs = parseInt(match[2]);
            const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
            const time = (mins * 60 + secs) * 1000 + ms;
            const text = match[4];
            matches.push({ time, text });
        }

        // 2. 處理解析結果
        if (matches.length === 0 && tagWordRegex.test(trimmedLine)) {
            // 純 <off,dur,0> 格式
            let allWords = [];
            tagWordRegex.lastIndex = 0;
            while ((match = tagWordRegex.exec(trimmedLine)) !== null) {
                allWords.push({
                    time: parseInt(match[1]),
                    duration: parseInt(match[2]),
                    text: match[3]
                });
            }
            if (allWords.length > 0) {
                isLrc = true;
                lyrics.push({
                    time: allWords[0].time,
                    text: allWords.map(w => w.text).join('').trim(),
                    words: allWords
                });
                continue;
            }
        }

        if (matches.length > 0) {
            isLrc = true;
            
            // 檢查是否包含逐字標籤 <off,dur,0>
            if (tagWordRegex.test(trimmedLine)) {
                const lineStartTime = matches[0].time;
                let allWords = [];
                matches.forEach(m => {
                    let subMatch;
                    let foundSub = false;
                    tagWordRegex.lastIndex = 0;
                    while ((subMatch = tagWordRegex.exec(m.text)) !== null) {
                        allWords.push({
                            time: m.time + parseInt(subMatch[1]),
                            duration: parseInt(subMatch[2]),
                            text: subMatch[3]
                        });
                        foundSub = true;
                    }
                    if (!foundSub && m.text.trim()) {
                        allWords.push({ time: m.time, text: m.text, duration: 500 });
                    }
                });
                if (allWords.length > 0) {
                    lyrics.push({
                        time: lineStartTime,
                        text: allWords.map(w => w.text).join('').trim(),
                        words: allWords
                    });
                    continue;
                }
            }

            if (matches.length > 1) {
                // 標準 [time]A[time]B 逐字
                const lineStartTime = matches[0].time;
                                const words = matches.map((m, idx) => {
                                    const nextTime = matches[idx + 1] ? matches[idx + 1].time : m.time + 500;
                                    const cleanWordText = m.text.replace(/<[^>]*>/g, '');
                                    return {
                                        time: m.time,
                                        text: cleanWordText,
                                        duration: Math.max(0, nextTime - m.time)
                                    };
                                });
                
                                lyrics.push({
                                    time: lineStartTime,
                                    text: words.map(w => w.text).join('').trim(),
                                    words: words
                                });
            } else {
                // 單時間戳行
                const entry = matches[0];
                const cleanText = entry.text.replace(/<[^>]*>/g, '').trim();
                if (cleanText) {
                    lyrics.push({ time: entry.time, text: cleanText });
                }
            }
        } else if (!isLrc && trimmedLine) {
            // 無時間戳行
            const cleanText = trimmedLine.replace(/<[^>]*>/g, '').trim();
            if (cleanText) {
                lyrics.push({ text: cleanText });
            }
        }
    }
    
    return {
        isLrc: isLrc,
        lyrics: lyrics
    };
}

// 添加 CORS 處理中間件
app.use('/api/lyrics', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Search lyrics from multiple sources
app.get('/api/search-lyrics/:query', async (req, res) => {
    const { query } = req.params;
    
    try {
        console.log(`🔍 搜尋歌詞: ${query}`);
        
        // 嘗試多個搜尋源
        const searchSources = [
            {
                name: 'wmcc.jp.eu.org',
                url: `${LYRICS_API_URL}/api/search/${encodeURIComponent(query)}`,
                parser: (data) => {
                    if (Array.isArray(data)) {
                        return data.map(item => ({
                            title: item.title || item.name || '未知標題',
                            artist: item.artist || item.singer || '未知歌手',
                            source: 'wmcc.jp.eu.org',
                            id: item.id || `${item.title}-${item.artist}`,
                            preview: item.lyrics ? item.lyrics.substring(0, 100) + '...' : '預覽不可用'
                        }));
                    }
                    return [];
                }
            },
            {
                name: 'Lrclib',
                url: `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
                parser: (data) => {
                    if (Array.isArray(data)) {
                        return data.map(item => ({
                            title: item.name || '未知標題',
                            artist: item.artistName || '未知歌手',
                            source: 'Lrclib',
                            id: item.id ? item.id.toString() : `${item.name}-${item.artistName}`,
                            preview: item.syncedLyrics ? item.syncedLyrics.substring(0, 100) + '...' : (item.plainLyrics ? item.plainLyrics.substring(0, 100) : '無預覽')
                        }));
                    }
                    return [];
                }
            }
        ];
        
        let allResults = [];
        
        for (const source of searchSources) {
            try {
                console.log(`📡 搜尋來源: ${source.name} - ${source.url}`);
                
                const response = await axios.get(source.url, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                
                if (response.data) {
                    const results = source.parser(response.data);
                    allResults = allResults.concat(results);
                    console.log(`✅ ${source.name} 找到 ${results.length} 個結果`);
                }
            } catch (error) {
                console.error(`❌ ${source.name} 搜尋失敗:`, error.message);
            }
        }
        
        // 去重並限制結果數量
        const uniqueResults = allResults.filter((result, index, self) => 
            index === self.findIndex(r => r.title === result.title && r.artist === result.artist)
        ).slice(0, 20);
        
        res.json({
            success: true,
            results: uniqueResults,
            total: uniqueResults.length
        });
        
    } catch (error) {
        console.error('❌ 搜尋歌詞失敗:', error.message);
        res.json({
            success: false,
            error: '搜尋失敗: ' + error.message,
            results: []
        });
    }
});

// Get specific lyrics by source and ID
app.get('/api/get-lyrics/:source/:id', async (req, res) => {
    const { source, id } = req.params;
    
    try {
        console.log(`🎤 獲取歌詞: ${source} - ${id}`);
        
        let lyricsUrl;
        if (source === 'wmcc.jp.eu.org') {
            // 如果ID是title-artist格式，需要解析
            const parts = decodeURIComponent(id).split('-');
            if (parts.length >= 2) {
                const title = parts.slice(0, -1).join('-');
                const artist = parts[parts.length - 1];
                lyricsUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
            } else {
                lyricsUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(id)}`;
            }
        } else if (source === 'Lrclib') {
            lyricsUrl = `https://lrclib.net/api/get/${encodeURIComponent(id)}`;
        } else {
            throw new Error('不支援的歌詞來源');
        }
        
        console.log(`📡 請求歌詞 URL: ${lyricsUrl}`);
        
        const response = await axios.get(lyricsUrl, {
            timeout: 25000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/plain, */*'
            }
        });
        
        if (response.data) {
            let lyrics = [];
            let lyricsType = 'plain';
            
            if (source === 'Lrclib') {
                if (response.data.syncedLyrics) {
                    const lrcResult = parseLrcFormat(response.data.syncedLyrics);
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else if (response.data.plainLyrics) {
                    lyrics = response.data.plainLyrics.split('\n')
                        .filter(line => line.trim() !== '')
                        .map(line => ({ text: line.trim() }));
                }
            } else if (typeof response.data === 'string') {
                const lrcResult = parseLrcFormat(response.data);
                if (lrcResult.isLrc) {
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else {
                    lyrics = response.data.split('\n')
                        .filter(line => line.trim() !== '')
                        .map(line => ({ text: line.trim() }));
                }
            } else if (response.data.lyrics) {
                if (Array.isArray(response.data.lyrics)) {
                    lyrics = response.data.lyrics;
                    lyricsType = response.data.type || 'plain';
                } else if (typeof response.data.lyrics === 'string') {
                    const lrcResult = parseLrcFormat(response.data.lyrics);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.lyrics.split('\n')
                            .filter(line => line.trim() !== '')
                            .map(line => ({ text: line.trim() }));
                    }
                }
            }
            
            if (lyrics.length > 0) {
                res.json({
                    success: true,
                    lyrics: lyrics,
                    type: lyricsType,
                    source: source
                });
            } else {
                res.json({
                    success: false,
                    error: '歌詞內容為空'
                });
            }
        } else {
            res.json({
                success: false,
                error: 'API 響應無數據'
            });
        }
        
    } catch (error) {
        console.error('❌ 獲取歌詞失敗:', error.message);
        res.json({
            success: false,
            error: '獲取歌詞失敗: ' + error.message
        });
    }
});

// 輔助函數：清洗歌曲元數據以提高搜尋成功率
function cleanMetadata(text) {
    if (!text) return '';
    return text
        .replace(/\s*[\(\[][fF]eat\.?.*[\)\]]/g, '') // 移除 (feat. ...) 或 [feat. ...]
        .replace(/\s*[\(\[][wW]ith.*[\)\]]/g, '')    // 移除 (with ...) 或 [with ...]
        .replace(/\s*-\s*.*(?:Remix|Mix|Edit|Version)/gi, '') // 移除 - Remix, - Radio Edit 等
        .replace(/\s*[\(\[][^()]*Version[^()]*[\)\]]/gi, '') // 移除 (Special Version) 等
        .trim();
}

// 輔助函數：簡化歌手名稱 (只取第一位歌手)
function cleanArtist(text) {
    if (!text) return '';
    // 取第一個歌手 (通常在逗號、分號、斜槓、& 號、左括號之前)
    // 🚨 修正：加入 ( 以處理 WeiBird (韋禮安) 這種格式
    return text.split(/[,;/\\]|\s+&\s+|\s*\(/)[0].trim();
}

// Get lyrics with multiple providers support
app.get('/api/lyrics/:artist/:title', async (req, res) => {
    const { artist: originalArtist, title: originalTitle } = req.params;
    const provider = req.query.p; // undefined 表示自動模式
    
    // 清洗元數據
    const artist = cleanArtist(originalArtist);
    const title = cleanMetadata(originalTitle);

    try {
        console.log(`🎤 請求歌詞: ${artist} - ${title} (原始: ${originalArtist} - ${originalTitle}) (provider: ${provider || 'auto'})`);

        // ========== 自動模式：無 ?p= ==========
        if (!provider) {
            const providers = ['QQMusic', 'Kugou', 'NetEase', 'Lrclib', 'Musixmatch'];
            const isWbw = req.query.wbw !== undefined;
            console.log(`🔍 自動並行載入歌詞 (wbw=${isWbw}): ${artist} - ${title}`);
            
            const searchPromises = providers.map(async (p) => {
                try {
                    let apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${p}`;
                    
                    // 如果原請求有 wbw，且該 Provider 支持，則加上參數
                    if (isWbw && ['NetEase', 'QQMusic', 'Kugou'].includes(p)) {
                        apiUrl += '&wbw';
                    }
                    
                    const response = await axios.get(apiUrl, {
                        timeout: 55000,
                        headers: { 'User-Agent': 'Spotify-Lyrics-Player/1.0' }
                    });

                    if (response.data && (response.data.success || response.data.lyrics)) {
                        const lyricsData = Array.isArray(response.data.lyrics) ? response.data.lyrics : [];
                        if (lyricsData.length === 0) return null;

                        let score = 1;
                        let type = response.data.type || 'plain';
                        
                        // 檢查逐字歌詞特徵
                        if (lyricsData.some(line => line && line.words && line.words.length > 0)) {
                            score = 3;
                            type = 'synced';
                        } else if (type === 'synced' || (lyricsData[0] && lyricsData[0].time !== undefined)) {
                            score = 2;
                            type = 'synced';
                        }

                        return {
                            provider: p,
                            lyrics: lyricsData,
                            type: type,
                            score: score
                        };
                    }
                } catch (error) {
                    return null;
                }
                return null;
            });

            const allSettledResults = await Promise.allSettled(searchPromises);
            const validResults = allSettledResults
                .filter(r => r.status === 'fulfilled' && r.value !== null)
                .map(r => r.value)
                .sort((a, b) => b.score - a.score);

            if (validResults.length > 0) {
                const best = validResults[0];
                console.log(`✅ 自動並行載入成功：選用 ${best.provider} (品質分數: ${best.score})`);
                
                // 確保數據格式正確回傳給前端
                return res.json({
                    success: true,
                    lyrics: best.lyrics,
                    type: best.type,
                    provider: best.provider
                });
            }

            // 🚀 關鍵回退：如果直接獲取失敗，嘗試「搜尋」模式
            console.log(`🔍 所有直接獲取失敗，嘗試搜尋模式: ${artist} ${title}`);
            try {
                const searchUrl = `${LYRICS_API_URL}/api/search/${encodeURIComponent(artist + ' ' + title)}`;
                const searchResponse = await axios.get(searchUrl, { timeout: 15000 });
                
                if (searchResponse.data && Array.isArray(searchResponse.data) && searchResponse.data.length > 0) {
                    const firstResult = searchResponse.data[0];
                    console.log(`✅ 搜尋找到結果: ${firstResult.name || firstResult.title} - ${firstResult.artist || firstResult.singer}`);
                    
                    // 獲取該結果的具體歌詞
                    const lyricsUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(firstResult.name || firstResult.title)}/${encodeURIComponent(firstResult.artist || firstResult.singer)}`;
                    const lyricsResponse = await axios.get(lyricsUrl, { timeout: 15000 });
                    
                    if (lyricsResponse.data && (lyricsResponse.data.success || lyricsResponse.data.lyrics)) {
                        return res.json({
                            success: true,
                            lyrics: lyricsResponse.data.lyrics,
                            type: lyricsResponse.data.type || 'plain',
                            provider: 'SearchFallback',
                            isFallback: true
                        });
                    }
                }
            } catch (searchError) {
                console.error('❌ 搜尋回退失敗:', searchError.message);
            }

            console.log('ℹ️ 自動模式：所有來源及回退搜尋均未找到歌詞');
            return res.status(404).json({
                success: false,
                error: '未找到歌詞'
            });
        }

        // ========== 指定來源模式：有 ?p= ==========
        const validProviders = ['Musixmatch', 'Lrclib', 'NetEase', 'QQMusic', 'QM', 'Kugou'];
        const isWbw = req.query.wbw !== undefined;

        // 統一轉為規範化名稱以進行比較
        const normalizedProvider = provider.toLowerCase();
        let pParam = provider;
        
        if (normalizedProvider === 'musixmatch') pParam = 'Musixmatch';
        else if (normalizedProvider === 'lrclib') pParam = 'Lrclib';
        else if (normalizedProvider === 'netease') pParam = 'NetEase';
        else if (normalizedProvider === 'qqmusic' || normalizedProvider === 'qm') pParam = 'QQMusic';
        else if (normalizedProvider === 'kugou') pParam = 'Kugou';

        try {
            let apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${pParam}`;
            
            // 重要：如果是逐字模式，必須轉發 wbw 參數給 Python API
            if (isWbw) {
                apiUrl += '&wbw';
            }

            console.log(`📡 轉發請求給 Python API: ${apiUrl}`);
            
            const response = await axios.get(apiUrl, {
                timeout: 60000,
                headers: { 'User-Agent': 'Spotify-Lyrics-Player/1.0' }
            });

            if (response.data && (response.data.success || response.data.lyrics)) {
                // 數據清洗確保每行歌詞都是有效的，同時保留 words 數據
                const rawLyrics = Array.isArray(response.data.lyrics) ? response.data.lyrics : [];
                const safeLyrics = rawLyrics.filter(line => {
                    if (!line) return false;
                    const text = typeof line === 'string' ? line : (line.text || '');
                    return typeof text === 'string' && text.trim() !== '';
                }).map(line => {
                    if (typeof line === 'string') return { text: line };
                    return line;
                });

                if (safeLyrics.length > 0) {
                    console.log(`✅ 指定來源 ${provider} 成功取得歌詞`);
                    return res.json({
                        success: true,
                        lyrics: safeLyrics,
                        type: response.data.type || 'plain',
                        provider: provider
                    });
                }
            }
            
            console.log(`ℹ️ 指定來源 ${provider} 未找到歌詞或格式錯誤`);
            return res.status(404).json({
                success: false,
                error: `${provider} 未找到歌詞`,
                provider: provider
            });
        } catch (error) {
            console.error(`❌ 指定來源 ${provider} 請求失敗:`, error.message);
            return res.status(500).json({
                success: false,
                error: `載入 ${provider} 歌詞失敗`,
                provider: provider,
                details: error.message
            });
        }

    } catch (error) {
        console.error('🔥 /api/lyrics 路由發生未預期錯誤:', error);
        return res.status(500).json({
            success: false,
            error: '伺服器內部錯誤',
            details: error.message
        });
    }
});

// Alias route for LRC format as requested by user
app.get('/api/lyrics/lrc/:title/:artist', async (req, res) => {
    const { title, artist } = req.params;
    // 重定向或直接調用上面的處理邏輯 (反轉 artist/title)
    req.url = `/api/lyrics/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    req.params.artist = artist;
    req.params.title = title;
    return app._router.handle(req, res);
});

// New Routes for OBS/Overlay display
app.get('/lyrics-text', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'lyrics-text.html'));
});

app.get('/pre', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pre.html'));
});

app.get('/next', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'next.html'));
});

app.get('/control', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

app.get('/song', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'song.html'));
});

app.get('/image', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'image.html'));
});

app.get('/stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

// 多供應商歌詞搜尋 API（本地開發用）
app.get('/api/lyrics-search-multi/:artist/:title', async (req, res) => {
    const { artist: originalArtist, title: originalTitle } = req.params;
    
    // 清洗元數據
    const artist = cleanArtist(originalArtist);
    const title = cleanMetadata(originalTitle);
    
    try {
        console.log(`🔍 多供應商搜尋（本地）: ${artist} - ${title} (原始: ${originalArtist} - ${originalTitle})`);
        const providers = ['Musixmatch', 'Lrclib', 'NetEase', 'QQMusic', 'Kugou'];
        const isWbw = req.query.wbw !== undefined;
        const results = [];
        const promises = providers.map(async (provider) => {
            let apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}&wbw`;
            
            // 只有指定提供商支持逐字歌詞
            try {
                const response = await axios.get(apiUrl, { timeout: 60000 });
                let lyrics = [];
                if (Array.isArray(response.data)) {
                    const lrcResult = parseLrcFormat(response.data.join('\n'));
                    lyrics = lrcResult.isLrc ? lrcResult.lyrics : response.data.filter(l => l && typeof l === 'string' && l.trim());
                } else if (response.data?.lyrics) {
                    lyrics = Array.isArray(response.data.lyrics) ? response.data.lyrics : [response.data.lyrics];
                } else if (typeof response.data === 'string') {
                    const lrcResult = parseLrcFormat(response.data);
                    lyrics = lrcResult.isLrc ? lrcResult.lyrics : response.data.split('\n').filter(l => l && typeof l === 'string' && l.trim());
                }
                if (lyrics.length > 0) {
                    return {
                        provider,
                        success: true,
                        lyrics,
                        type: lyrics.some(l => l.time) ? 'synced' : 'plain',
                        artist,
                        title,
                        lyricsPreview: lyrics.slice(0, 3).map(l => typeof l === 'string' ? l : l.text || '').join(' / ')
                    };
                }
                return { provider, success: false, error: '未找到歌詞', artist, title };
            } catch (error) {
                return { provider, success: false, error: error.message, artist, title };
            }
        });
        const allResults = await Promise.all(promises);
        res.json({
            success: true,
            results: allResults,
            total: allResults.length,
            found: allResults.filter(r => r.success).length
        });
    } catch (error) {
        console.error('多供應商搜尋失敗:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 搜尋 Musixmatch 歌詞
async function searchMusixmatchLyrics(artist, title) {
    try {
        console.log(`🔍 Musixmatch 搜尋: ${artist} - ${title}`);
        
        // 使用統一的API端點格式
        const apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=Musixmatch`;
        
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.lyrics && response.data.lyrics.length > 0) {
            return {
                success: true,
                lyrics: response.data.lyrics,
                type: response.data.type || 'plain',
                source: 'musixmatch'
            };
        }
        
        return { success: false, error: 'No lyrics found in Musixmatch' };
    } catch (error) {
        console.log(`⚠️ Musixmatch API 錯誤: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 搜尋 LRCLib 歌詞
async function searchLrclibLyrics(artist, title) {
    try {
        console.log(`🔍 LRCLib 搜尋: ${artist} - ${title}`);
        
        // 使用統一的API端點格式
        const apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=Lrclib`;
        
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.lyrics && response.data.lyrics.length > 0) {
            return {
                success: true,
                lyrics: response.data.lyrics,
                type: response.data.type || 'plain',
                source: 'lrclib'
            };
        }
        
        return { success: false, error: 'No lyrics found in LRCLib' };
    } catch (error) {
        console.log(`⚠️ LRCLib API 錯誤: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 搜尋 NetEase 歌詞
async function searchNeteaseLyrics(artist, title) {
    try {
        console.log(`🔍 NetEase 搜尋: ${artist} - ${title}`);
        
        // 使用統一的API端點格式
        const apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=NetEase`;
        
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.lyrics && response.data.lyrics.length > 0) {
            return {
                success: true,
                lyrics: response.data.lyrics,
                type: response.data.type || 'plain',
                source: 'netease'
            };
        }
        
        return { success: false, error: 'No lyrics found in NetEase' };
    } catch (error) {
        console.log(`⚠️ NetEase API 錯誤: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 搜尋 Kugou 歌詞
async function searchKugouLyrics(artist, title) {
    try {
        console.log(`🔍 Kugou 搜尋: ${artist} - ${title}`);
        
        // 使用統一的API端點格式
        const apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=Kugou`;
        
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.lyrics && response.data.lyrics.length > 0) {
            return {
                success: true,
                lyrics: response.data.lyrics,
                type: response.data.type || 'plain',
                source: 'kugou'
            };
        }
        
        return { success: false, error: 'No lyrics found in Kugou' };
    } catch (error) {
        console.log(`⚠️ Kugou API 錯誤: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 搜尋 QQMusic 歌詞
async function searchQQMusicLyrics(artist, title) {
    try {
        console.log(`🔍 QQMusic 搜尋: ${artist} - ${title}`);
        
        // 使用統一的API端點格式
        const apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=QQMusic`;
        
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.lyrics && response.data.lyrics.length > 0) {
            return {
                success: true,
                lyrics: response.data.lyrics,
                type: response.data.type || 'plain',
                source: 'qqmusic'
            };
        }
        
        return { success: false, error: 'No lyrics found in QQMusic' };
    } catch (error) {
        console.log(`⚠️ QQMusic API 錯誤: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 原有的歌詞端點（保持向後兼容）
// 從特定供應商搜索歌詞 - 用於用戶自定義設置
app.get('/api/lyrics-search-provider/:provider/:artist/:title', async (req, res) => {
    const { provider, artist, title } = req.params;
    
    try {
        console.log(`🔍 從指定供應商搜索歌詞: ${provider} for ${artist} - ${title}`);
        
        // 驗證供應商名稱
        const validProviders = ['Musixmatch', 'Lrclib', 'NetEase', 'QQMusic', 'QM', 'Kugou', 'Genius'];
        const isWbw = req.query.wbw !== undefined;

        if (!validProviders.includes(provider)) {
            return res.status(400).json({
                success: false,
                error: `不支持的歌詞供應商: ${provider}`
            });
        }
        
        let apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}`;
        
        // 只有指定提供商支持逐字歌詞
        if (isWbw && ['NetEase', 'QQMusic', 'Kugou'].includes(provider)) {
            apiUrl += '&wbw';
        }

        const response = await fetch(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API 請求失敗: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.lyrics && data.lyrics.length > 0) {
            console.log(`✅ 從 ${provider} 成功獲取歌詞: ${data.lyrics.length} 行`);
            
            res.json({
                success: true,
                provider: provider,
                artist: artist,
                title: title,
                lyrics: data.lyrics,
                type: data.syncType || 'plain',
                source: `${provider} (用戶指定)`
            });
        } else {
            console.log(`ℹ️ ${provider} 未找到歌詞: ${artist} - ${title}`);
            res.json({
                success: false,
                provider: provider,
                error: `${provider} 未找到歌詞`
            });
        }
        
    } catch (error) {
        console.error(`❌ 從 ${provider} 搜索歌詞失敗:`, error.message);
        res.status(500).json({
            success: false,
            provider: provider,
            error: `從 ${provider} 搜索失敗: ${error.message}`
        });
    }
});

app.get('/api/lyrics-legacy/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    const providersParam = req.query.p || ''; // e.g. "lrclib,musixmatch,netease"
    
    try {
        console.log(`🎤 請求歌詞: ${artist} - ${title} (providers: ${providersParam || 'default'})`);

        const results = [];

        // ======================
        // 情境一：自動載入（無 ?p=）
        // ======================
        if (!providersParam) {
            try {
                const apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
                console.log(`🔍 自動載入歌詞 URL: ${apiUrl}`);
                
                const response = await axios.get(apiUrl, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json, text/plain, */*'
                    }
                });

                if (response.data && response.data.lyrics) {
                    let lyrics = [];
                    let lyricsType = 'plain';

                    if (Array.isArray(response.data.lyrics)) {
                        lyrics = response.data.lyrics;
                        lyricsType = response.data.type || 'synced';
                    } else if (typeof response.data.lyrics === 'string') {
                        const lrcResult = parseLrcFormat(response.data.lyrics);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        } else {
                            lyrics = response.data.lyrics.split('\n')
                                .filter(line => line.trim() !== '')
                                .map(line => ({ text: line.trim() }));
                        }
                    }

                    if (lyrics.length > 0) {
                        console.log(`✅ 找到自動載入歌詞 (${lyrics.length} 行)`);
                        return res.json({
                            success: true,
                            lyrics,
                            type: lyricsType,
                            provider: 'default',
                            artist,
                            title
                        });
                    }
                }

                console.log(`ℹ️ 自動載入歌詞失敗或內容為空`);
                return res.json({
                    success: false,
                    error: '查不到歌詞',
                    message: '自動載入失敗'
                });
            } catch (error) {
                console.error(`❌ 自動載入歌詞錯誤:`, error.message);
                return res.json({
                    success: false,
                    error: '載入歌詞失敗: ' + error.message
                });
            }
        }

        // ======================
        // 情境二：用戶搜尋（有 ?p=）
        // ======================
        const requestedProviders = providersParam
            .split(',')
            .map(p => p.trim().toLowerCase())
            .filter(Boolean);

        console.log(`📋 搜尋來源列表: ${requestedProviders.join(', ')}`);

        for (const provider of requestedProviders) {
            try {
                let apiUrl;
                const isWbw = req.query.wbw !== undefined;
                const wbwParam = isWbw ? '&wbw' : '';

                switch (provider) {
                    case 'musixmatch':
                        apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=Musixmatch`;
                        break;
                    case 'lrclib':
                        apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=Lrclib`;
                        break;
                    case 'netease':
                        apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=NetEase&wbw`;
                        break;
                    case 'qm':
                    case 'qqmusic':
                        apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=QQMusic&wbw`;
                        break;
                    case 'kugou':
                        apiUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=Kugou&wbw`;
                        break;
                    default:
                        console.log(`⚠️ 不支援的提供商: ${provider}`);
                        continue;
                }

                console.log(`📡 查詢 ${provider}: ${apiUrl}`);
                const response = await axios.get(apiUrl, {
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json, text/plain, */*'
                    }
                });

                if (response.data && response.data.lyrics) {
                    let lyrics = [];
                    let lyricsType = 'plain';

                    if (Array.isArray(response.data.lyrics)) {
                        lyrics = response.data.lyrics;
                        lyricsType = response.data.type || 'synced';
                    } else if (typeof response.data.lyrics === 'string') {
                        const lrcResult = parseLrcFormat(response.data.lyrics);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        } else {
                            lyrics = response.data.lyrics.split('\n')
                                .filter(line => line.trim() !== '')
                                .map(line => ({ text: line.trim() }));
                        }
                    }

                    if (lyrics.length > 0) {
                        results.push({
                            provider,
                            lyrics,
                            type: lyricsType,
                            artist,
                            title
                        });
                        console.log(`✅ ${provider} 找到歌詞 (${lyrics.length} 行)`);
                    } else {
                        console.log(`ℹ️ ${provider} 沒有內容`);
                    }
                } else {
                    console.log(`ℹ️ ${provider} 響應無歌詞資料`);
                }
            } catch (error) {
                console.error(`❌ ${provider} 搜尋失敗:`, error.message);
            }
        }

        if (results.length > 0) {
            console.log(`✅ 找到 ${results.length} 個歌詞來源`);
            return res.json({
                success: true,
                results,
                total: results.length,
                message: `找到 ${results.length} 個可用歌詞來源`
            });
        } else {
            console.log(`ℹ️ 所有來源均無歌詞`);
            return res.json({
                success: false,
                results: [],
                total: 0,
                error: '查不到歌詞'
            });
        }

    } catch (error) {
        console.error('❌ 獲取歌詞失敗:', error.message);
        return res.json({
            success: false,
            error: '載入歌詞失敗: ' + error.message
        });
    }
});

// 增強的 LRC 格式解析函數，更好的錯誤處理
function parseLrcFormat(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') {
        console.log('⚠️ LRC 解析：無效的輸入文本');
        return { isLrc: false, lyrics: [], error: '無效的輸入文本' };
    }
    
    const lines = lrcText.split('\n');
    const lyrics = [];
    let hasTimeStamps = false;
    let parseErrors = 0;
    let successfulParses = 0;
    
    console.log(`📝 開始解析 LRC 格式，共 ${lines.length} 行`);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        if (!trimmedLine) {
            continue; // 跳過空行
        }
        
        try {
            // 1. 提取 [mm:ss.xx] 標籤
            const wordLevelRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]([^\[]*)/g;
            const tagWordRegex = /<(\d+),(\d+),\d+>([^<]*)/g;
            let matches = [];
            let match;
            
            while ((match = wordLevelRegex.exec(trimmedLine)) !== null) {
                const mins = parseInt(match[1]);
                const secs = parseInt(match[2]);
                const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
                const time = (mins * 60 + secs) * 1000 + ms;
                const text = match[4];
                matches.push({ time, text });
            }

            // 2. 處理解析結果
            if (matches.length === 0 && tagWordRegex.test(trimmedLine)) {
                // 純 <off,dur,0> 格式
                let allWords = [];
                tagWordRegex.lastIndex = 0;
                while ((match = tagWordRegex.exec(trimmedLine)) !== null) {
                    allWords.push({
                        time: parseInt(match[1]),
                        duration: parseInt(match[2]),
                        text: match[3]
                    });
                }
                if (allWords.length > 0) {
                    hasTimeStamps = true;
                    lyrics.push({
                        time: allWords[0].time,
                        text: allWords.map(w => w.text).join('').trim(),
                        words: allWords,
                        originalLine: line,
                        lineNumber: i + 1
                    });
                    successfulParses++;
                    continue;
                }
            }

            if (matches.length > 0) {
                hasTimeStamps = true;
                
                // 檢查是否包含逐字標籤 <off,dur,0>
                if (tagWordRegex.test(trimmedLine)) {
                    const lineStartTime = matches[0].time;
                    let allWords = [];
                    matches.forEach(m => {
                        let subMatch;
                        let foundSub = false;
                        tagWordRegex.lastIndex = 0;
                        while ((subMatch = tagWordRegex.exec(m.text)) !== null) {
                            allWords.push({
                                time: m.time + parseInt(subMatch[1]),
                                duration: parseInt(subMatch[2]),
                                text: subMatch[3]
                            });
                            foundSub = true;
                        }
                        if (!foundSub && m.text.trim()) {
                            allWords.push({ time: m.time, text: m.text, duration: 500 });
                        }
                    });
                    if (allWords.length > 0) {
                        lyrics.push({
                            time: lineStartTime,
                            text: allWords.map(w => w.text).join('').trim(),
                            words: allWords,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                        successfulParses++;
                        continue;
                    }
                }

                if (matches.length > 1) {
                    // 標準 [time]A[time]B 逐字
                    const lineStartTime = matches[0].time;
                                        const words = matches.map((m, idx) => {
                                            const nextTime = matches[idx + 1] ? matches[idx + 1].time : m.time + 500;
                                            const cleanWordText = m.text.replace(/<[^>]*>/g, '');
                                            return {
                                                time: m.time,
                                                text: cleanWordText,
                                                duration: Math.max(0, nextTime - m.time)
                                            };
                                        });
                    
                                        lyrics.push({
                                            time: lineStartTime,
                                            text: words.map(w => w.text).join('').trim(),
                                            words: words,
                                            originalLine: line,
                                            lineNumber: i + 1
                                        });
                } else {
                    // 單時間戳行
                    const entry = matches[0];
                    const cleanText = entry.text.replace(/<[^>]*>/g, '').trim();
                    if (cleanText) {
                        lyrics.push({
                            time: entry.time,
                            text: cleanText,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                    }
                }
                successfulParses++;
            } else {
                // 非時間戳行，可能是純文本歌詞或元數據
                if (!trimmedLine.startsWith('[') || !trimmedLine.includes(']')) {
                    // 檢查是否為有效的歌詞文本
                    if (isValidLyricsText(trimmedLine)) {
                        lyrics.push({
                            text: trimmedLine,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                        successfulParses++;
                    } else {
                        console.log(`ℹ️ LRC 解析：第 ${i + 1} 行跳過元數據或無效文本: ${trimmedLine.substring(0, 50)}...`);
                    }
                } else {
                    // 可能是其他格式的元數據
                    console.log(`ℹ️ LRC 解析：第 ${i + 1} 行跳過元數據標籤: ${trimmedLine.substring(0, 50)}...`);
                }
            }
        } catch (parseError) {
            console.log(`❌ LRC 解析：第 ${i + 1} 行解析錯誤: ${parseError.message}`);
            parseErrors++;
            
            // 嘗試作為普通文本恢復
            if (trimmedLine.length > 0 && !trimmedLine.startsWith('[')) {
                lyrics.push({
                    text: trimmedLine,
                    originalLine: line,
                    lineNumber: i + 1,
                    hasError: true
                });
                successfulParses++;
            }
        }
    }
    
    // 如果有時間戳，按時間排序
    if (hasTimeStamps && lyrics.length > 0) {
        try {
            lyrics.sort((a, b) => {
                const timeA = a.time || 0;
                const timeB = b.time || 0;
                return timeA - timeB;
            });
            console.log(`✅ LRC 解析完成：${successfulParses} 行成功，${parseErrors} 行錯誤，${hasTimeStamps ? '同步' : '普通'}歌詞`);
        } catch (sortError) {
            console.log(`⚠️ LRC 解析：排序失敗，使用原始順序: ${sortError.message}`);
        }
    }
    
    // 如果沒有成功解析任何行，返回錯誤信息
    if (successfulParses === 0) {
        console.log('❌ LRC 解析：沒有成功解析任何歌詞行');
        return {
            isLrc: false,
            lyrics: [],
            error: '無法解析任何有效的歌詞行',
            parseErrors: parseErrors,
            totalLines: lines.length
        };
    }
    
    // 如果時間戳解析失敗但普通文本成功，降級為普通歌詞
    if (hasTimeStamps && lyrics.filter(line => line.time !== undefined).length === 0) {
        console.log('⚠️ LRC 解析：時間戳解析失敗，降級為普通歌詞');
        hasTimeStamps = false;
        lyrics.forEach(line => delete line.time);
    }
    
    return {
        isLrc: hasTimeStamps,
        lyrics: lyrics,
        parseErrors: parseErrors,
        successfulParses: successfulParses,
        totalLines: lines.length
    };
}

// 驗證時間數據的有效性
function isValidTimeData(minutes, seconds, milliseconds) {
    // 檢查是否為有效數字
    if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || 
        (milliseconds !== undefined && !Number.isInteger(milliseconds))) {
        return false;
    }
    
    // 檢查時間範圍是否合理
    if (minutes < 0 || minutes > 99) return false;
    if (seconds < 0 || seconds > 59) return false;
    if (milliseconds !== undefined && (milliseconds < 0 || milliseconds > 999)) return false;
    
    return true;
}

// 驗證歌詞文本的有效性
function isValidLyricsText(text) {
    if (!text || typeof text !== 'string') return false;
    if (text.length < 1) return false;
    
    // 排除明顯的元數據標籤
    const metadataPatterns = [
        /^\[.*\]$/g,  // 方括號標籤
        /^[A-Z]+:/g,  // 大寫字母開頭的標籤
        /^\d+$/g,     // 純數字
        /^[\/\[\]\(\)\{\}]+$/g  // 只有符號
    ];
    
    return !metadataPatterns.some(pattern => pattern.test(text));
}

// 測試歌詞 API 連接
app.get('/api/test-lyrics', async (req, res) => {
    try {
        const testUrl = `${LYRICS_API_URL}/api/lyrics/test/test`;
        const response = await axios.get(testUrl, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        res.json({ 
            success: true, 
            message: '歌詞 API 連接正常',
            status: response.status,
            data: response.data 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            message: '歌詞 API 連接失敗',
            error: error.message,
            status: error.response?.status 
        });
    }
});

// Extract colors from image
app.post('/api/extract-colors', async (req, res) => {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
        return res.status(400).json({ error: 'Missing imageUrl parameter' });
    }
    
    try {
        // For now, return a default color palette
        // In a production environment, you might want to implement actual color extraction
        const colors = [
            '#1db954', // Spotify green
            '#191414', // Spotify black
            '#ffffff', // White
            '#535353', // Gray
            '#1ed760'  // Lighter Spotify green
        ];
        
        res.json({ colors });
    } catch (error) {
        console.error('Error extracting colors:', error);
        res.status(500).json({ error: 'Failed to extract colors' });
    }
});

// Play specific track
app.put('/api/player/play', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { uris, device_id } = req.body;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const requestBody = {};
        if (uris) requestBody.uris = uris;
        if (device_id) requestBody.device_id = device_id;
        
        await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/play', {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            },
            data: requestBody
        }, sessionId);
        
        res.json({ success: true });
    } catch (error) {
        // Handle rate limiting
        if (error.status === 429) {
            console.log(`⚠️ Play API rate limited, retry after ${error.retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: error.retryAfter,
                message: 'API rate limit exceeded, please wait before retrying'
            });
        }
        
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error playing track:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            success: false, 
            error: 'Failed to play track',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// Transfer playback to device
app.put('/api/player/transfer', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { device_ids, play } = req.body;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        await makeSpotifyAPICall('https://api.spotify.com/v1/me/player', {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            },
            data: { device_ids, play: play !== false }
        }, sessionId);
        
        res.json({ success: true });
    } catch (error) {
        // Handle rate limiting
        if (error.status === 429) {
            console.log(`⚠️ Transfer API rate limited, retry after ${error.retryAfter}ms`);
            return res.status(429).json({ 
                error: 'Too many requests', 
                retryAfter: error.retryAfter,
                message: 'API rate limit exceeded, please wait before retrying'
            });
        }
        
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error transferring playback:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            success: false, 
            error: 'Failed to transfer playback',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// Health check endpoint
// Endpoint to clear all user data (for compatibility with client)
app.delete('/api/kv/clear-all', async (req, res) => {
    try {
        // In local mode, we might want to clear the local JSON or just a specific session
        // For now, clear all in enhancedStorage if it's JSON
        if (enhancedStorage.dbType === 'json') {
            enhancedStorage.localData = {};
            await new Promise((resolve, reject) => {
                fs.writeFile(enhancedStorage.localFilePath, JSON.stringify({}, null, 2), (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        res.json({ success: true, message: 'All data cleared' });
    } catch (error) {
        console.error('Error clearing data:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        let spotifyConnected = false;
        
        if (sessionId) {
            const session = await kvStorage.getSession(sessionId);
            if (session && session.accessToken) {
                // 簡單檢查：如果 accessToken 存在即視為已連線
                // 在實際生產環境中，可能需要進一步驗證 token 有效性
                spotifyConnected = true;
            }
        }
        
        res.json({ 
            status: 'OK', 
            spotify: spotifyConnected,
            timestamp: new Date().toISOString() 
        });
    } catch (error) {
        res.json({ 
            status: 'OK', 
            spotify: false, 
            error: error.message 
        });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 🚀 Background Player Monitor
// ==========================================
// 這個監控器會在伺服器端定時輪詢所有活動會話，
// 這樣使用者不需要開啟網頁也能記錄播放時長。

class BackgroundPlayerMonitor {
    constructor() {
        this.pollInterval = 45000; // 每 45 秒輪詢一次（平衡即時性與 API 限制）
        this.isActive = false;
        this.stats = {
            totalPolls: 0,
            activeTrackings: 0,
            lastRun: null
        };
    }

    start() {
        if (this.isActive) {return;}
        this.isActive = true;
        console.log('🚀 [BackgroundMonitor] Started');
        this.run();
    }

    stop() {
        this.isActive = false;
        console.log('⏹️ [BackgroundMonitor] Stopped');
    }

    async run() {
        if (!this.isActive) {return;}

        const startTime = Date.now();
        this.stats.lastRun = new Date();
        this.stats.totalPolls++;

        try {
            // 獲取所有目前在記憶體中的會話
            const sessions = Array.from(userSessions.entries());
            let activeCount = 0;

            // 過濾掉不活躍或已過期的會話（例如超過 6 小時沒動靜的）
            const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
            const eligibleSessions = sessions.filter(([sid, session]) => {
                // 檢查是否有必要的權限和最近活動
                const lastActivity = session.currentTrackCache?.timestamp || 0;
                return session.refreshToken && (lastActivity > sixHoursAgo || lastActivity === 0);
            });

            for (const [sessionId, session] of eligibleSessions) {
                try {
                    // 1. 檢查是否需要刷新 Token
                    const needsRefresh = session.expiresAt <= Date.now() + (5 * 60 * 1000);
                    if (needsRefresh) {
                        const refreshed = await refreshAccessToken(session, sessionId);
                        if (!refreshed) continue; // 刷新失敗，跳過此會話
                    }

                    // 2. 獲取當前播放狀態
                    const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player', {
                        headers: { 'Authorization': `Bearer ${session.accessToken}` }
                    }, sessionId);

                    if (response.status === 200 && response.data && response.data.item) {
                        const data = response.data;
                        const track = data.item;
                        const userId = session.userProfile?.data?.id || (await getSpotifyUserId(session, sessionId));
                        
                        if (userId) {
                            // 3. 呼叫現有的 trackSongChange 進行記錄
                            const trackWithContext = { ...track, context: data.context };
                            await trackSongChange(sessionId, trackWithContext, userId, data.progress_ms, session.accessToken, data.is_playing);
                            
                            if (data.is_playing) activeCount++;
                        }
                    } else if (response.status === 204 || !response.data?.item) {
                        // 沒在播放，執行一次 null 追蹤以更新最後一首歌的時長
                        const userId = session.userProfile?.data?.id;
                        if (userId) {
                            await trackSongChange(sessionId, null, userId);
                        }
                    }
                } catch (err) {
                    // 忽略靜默錯誤
                }

                // 每個會話之間稍微停頓
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            this.stats.activeTrackings = activeCount;
        } catch (error) {
            console.error('[BackgroundMonitor] Global error:', error);
        }

        // 排定下一次執行
        const nextRun = Math.max(10000, this.pollInterval - (Date.now() - startTime));
        setTimeout(() => this.run(), nextRun);
    }
}

const backgroundMonitor = new BackgroundPlayerMonitor();
backgroundMonitor.start();

// Health check endpoint for background monitor
app.get('/api/admin/monitor-status', (req, res) => {
    res.json(backgroundMonitor.stats);
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT}`, { 
          port: PORT, 
          environment: process.env.NODE_ENV || 'development' 
        });
        console.log(`Server is running on port ${PORT}`);
        console.log(`Open http://localhost:${PORT} in your browser`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
        console.log(`Metrics: http://localhost:${PORT}/api/metrics`);
        console.log(`Logs analysis: http://localhost:${PORT}/api/logs/analysis`);
    });
}

module.exports = app;

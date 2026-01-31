// server.js
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const KVStorageManager = require('./api/kv-storage');
const EnhancedStorage = require('./api/storage-enhanced');
require('dotenv').config();

const kvStorage = new KVStorageManager();
const enhancedStorage = new EnhancedStorage();

// Initialize enhanced storage
enhancedStorage.init().catch(err => console.error('Failed to init storage:', err));

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
        const response = await axios(url, options);
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

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;
const LYRICS_API_URL = process.env.LYRICS_API_URL || 'https://api.lyrics.wmcc.jp.eu.org';

// Store user sessions (in production, use a proper database)
const userSessions = new Map();

// Track song changes for token refresh
const songChangeTracker = new Map();

// Track song changes and refresh token every 2 songs
function trackSongChange(sessionId, trackId) {
    try {
        if (!sessionId || !trackId) return;
        
        const tracker = songChangeTracker.get(sessionId) || {
            currentTrackId: null,
            songCount: 0,
            lastRefreshTime: Date.now()
        };
        
        // Only count if it's a different song
        if (tracker.currentTrackId !== trackId) {
            tracker.currentTrackId = trackId;
            tracker.songCount++;
            
            console.log(`🎵 Song changed for session ${sessionId.substring(0, 8)}... Count: ${tracker.songCount}`);
            
            // Refresh token every 2 songs
            if (tracker.songCount >= 2) {
                console.log(`🔄 Refreshing token after ${tracker.songCount} songs for session ${sessionId.substring(0, 8)}...`);
                tracker.songCount = 0; // Reset counter
                tracker.lastRefreshTime = Date.now();
                
                // Trigger token refresh
                const session = userSessions.get(sessionId);
                if (session) {
                    // Use a safe wrapper or ensure refreshAccessToken handles its own errors
                    refreshAccessToken(session, sessionId).then(refreshed => {
                        if (refreshed) {
                            console.log(`✅ Token refreshed successfully after song change`);
                        } else {
                            console.log(`⚠️ Token refresh failed after song change`);
                        }
                    }).catch(err => {
                        console.error('❌ Error in background token refresh:', err);
                    });
                }
            }
            
            songChangeTracker.set(sessionId, tracker);
        }
    } catch (error) {
        console.error('❌ Error inside trackSongChange:', error);
    }
}

// Clean up old song change trackers (older than 1 hour)
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

// 保存會話
async function saveUserSession(sessionId, sessionData) {
    if (!sessionId || !sessionData) return;
    
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

// Spotify authorization URL with enhanced scopes
app.get('/api/auth', (req, res) => {
    const sessionId = generateSessionId();
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
        
        await saveUserSession(sessionId, {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        });
        res.cookie('spotify_session', sessionId, {
            maxAge: 30 * 60 * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        
        res.redirect(`/?auth=success&session=${sessionId}`);
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

        // Fetch saved settings for this track
        const savedSettings = await enhancedStorage.getSongSettings(track.id) || {};
        
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
            // Control state - Use saved settings or defaults
            lyricsOffset: savedSettings.offset || 0,
            manualLyrics: savedSettings.manualLyrics || null
        };
        
        // Save to cache
        session.currentTrackCache = {
            data: currentTrack,
            timestamp: Date.now()
        };

        // Track song change for token refresh
        try {
            trackSongChange(sessionId, track.id);
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
    
    // Save to persistent storage
    await enhancedStorage.saveSongSettings(trackId, { offset: newOffset });
    
    // Clear cache to reflect change immediately
    if (session.currentTrackCache) {
        session.currentTrackCache.data.lyricsOffset = newOffset;
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
    
    // Save to persistent storage
    await enhancedStorage.saveSongSettings(trackId, { manualLyrics: manualLyricsData });
    
    // Clear cache to reflect change immediately
    if (session.currentTrackCache) {
        session.currentTrackCache.data.manualLyrics = manualLyricsData;
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
    
    if (trackId) {
        await enhancedStorage.saveSongSettings(trackId, { offset: 0, manualLyrics: null, lyricsContent: null });
    }

    // Clear cache
    if (session.currentTrackCache) {
        session.currentTrackCache.data.lyricsOffset = 0;
        session.currentTrackCache.data.manualLyrics = null;
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
        const { trackInfo, lyrics, lyricsType, source } = req.body;
        if (!trackInfo || !trackInfo.id) {
            return res.status(400).json({ error: 'Missing trackInfo' });
        }

        await enhancedStorage.saveSongSettings(trackInfo.id, {
            lyricsContent: lyrics, // Save the actual lyrics array
            // We also save metadata about the custom lyrics
            customLyricsMeta: {
                type: lyricsType,
                source: source,
                savedAt: Date.now()
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving user lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/user-lyrics/:trackKey', async (req, res) => {
    try {
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

        // Fallback: try to extract from trackKey if possible (not reliable for ID)
        // For now, require trackId via info param which frontend sends.

        if (!trackId) {
            return res.status(400).json({ error: 'Could not determine track ID' });
        }

        const settings = await enhancedStorage.getSongSettings(trackId);
        
        if (settings && settings.lyricsContent) {
            res.json({
                success: true,
                data: {
                    lyrics: settings.lyricsContent,
                    lyricsType: settings.customLyricsMeta?.type || 'plain',
                    source: settings.customLyricsMeta?.source || 'custom',
                    lastModified: settings.updated_at || Date.now()
                }
            });
        } else {
            res.json({ success: true, message: 'No custom lyrics found' });
        }
    } catch (error) {
        console.error('Error getting user lyrics:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export all lyrics
app.get(['/api/export-lyrics', '/api/kv/export-all-lyrics'], async (req, res) => {
    try {
        const allLyrics = await enhancedStorage.getAllLyrics();
        
        if (req.path.includes('export-lyrics')) {
             res.setHeader('Content-Disposition', 'attachment; filename="lyrics-export.json"');
        }
        res.setHeader('Content-Type', 'application/json');
        
        res.json(allLyrics);
    } catch (error) {
        console.error('Error exporting lyrics:', error);
        res.status(500).json({ error: 'Failed to export lyrics' });
    }
});

app.post('/api/kv/save-time-offset', async (req, res) => {
    try {
        const { trackInfo, timeOffset } = req.body;
        if (!trackInfo || !trackInfo.id) {
            return res.status(400).json({ error: 'Missing trackInfo' });
        }

        await enhancedStorage.saveSongSettings(trackInfo.id, {
            offset: timeOffset
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving time offset:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kv/get-time-offset/:trackKey', async (req, res) => {
    // This endpoint in kv-storage-manager.js does NOT send ?info=... for GET usually?
    // Let's check kv-storage-manager.js: 
    // fetch(`${this.apiBase}/api/kv/get-time-offset/${trackKey}`);
    // It does NOT send info.
    // However, trackKey is "id-artist-name". We can try to extract ID.
    // Format: `${id}-${artist}-${name}`.
    // If ID is simple, it works. If ID contains dashes, it might be tricky.
    // Spotify IDs are alphanumeric.
    
    // Strategy: Parse trackKey.
    // But better strategy: The frontend calls this, but `server.js` /api/current-track already returns the offset!
    // The frontend `kv-storage-manager.js` is a "manager" that syncs.
    // If I implement this, I need to parse the ID.
    
    try {
        const { trackKey } = req.params;
        // Spotify ID is usually at the start.
        // But `generateTrackKey` does `replace(/\s+/g, '_')`.
        // It's not reversible reliably.
        
        // workaround: We might not be able to implement this reliable without trackId.
        // BUT, `enhancedStorage` relies on ID.
        // Let's look at `kv-storage-manager.js` again. 
        // `getLyricsTimeOffset` tries Redis, then Local.
        
        // Since we modified `/api/current-track` to return the correct offset from DB,
        // the main player `script.js` uses `trackData.lyricsOffset`.
        // `kv-storage-manager.js` is auxiliary.
        
        // I will attempt to implement it if possible, but maybe return 404 if ambiguous.
        // actually, for this specific request, I'll just return { timeOffset: 0 } or try to find by ID if I can guess it.
        // Wait, if I can't parse ID, I can't look it up in SQL.
        
        // However, looking at `kv-storage-manager.js`, it seems `saveLyricsTimeOffset` sends `trackInfo`.
        // `getLyricsTimeOffset` calls `GET .../${trackKey}`.
        
        // I will try to split by `-` and take the first part as ID?
        const potentialId = trackKey.split('-')[0];
        if (potentialId) {
             const settings = await enhancedStorage.getSongSettings(potentialId);
             if (settings) {
                 return res.json({ timeOffset: settings.offset || 0 });
             }
        }
        
        res.json({ timeOffset: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Authentication middleware
async function authenticateSpotify(req, res, next) {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
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

// Get available devices
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
        const response = await axios.get('https://api.spotify.com/v1/me/playlists?limit=50', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const playlists = response.data.items.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            image: playlist.images[0]?.url,
            tracks: playlist.tracks.total
        }));
        
        res.json({ playlists });
    } catch (error) {
        console.error('Error fetching playlists:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch playlists' });
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
    // 取第一個歌手 (通常在逗號、分號、斜槓、& 號之前)
    return text.split(/[,;/\\]|\s+&\s+/)[0].trim();
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

            console.log('ℹ️ 自動模式：所有來源均未找到歌詞');
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
        const testUrl = '${LYRICS_API_URL}/api/lyrics/test/test';
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

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Open http://localhost:${PORT} in your browser`);
    });
}

app.get('/api/kv/status', (req, res) => {
    try {
        const kvAvailable = !!process.env.KV_REST_API_URL && 
                           !!process.env.KV_REST_API_TOKEN;
        
        res.json({
            success: true,
            kvAvailable: kvAvailable,
            userKey: null,
            message: kvAvailable ? 'KV available' : 'KV not available'
        });
    } catch (error) {
        console.error('❌ KV status check error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = app;

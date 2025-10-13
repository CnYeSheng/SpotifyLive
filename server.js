const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Rate limiter for Spotify API
class SpotifyRateLimiter {
    constructor() {
        this.sessionCalls = new Map();
        this.globalCalls = [];
        this.maxCallsPerMinute = 30;
        this.maxCallsPerSession = 10;
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
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;

// Store user sessions (in production, use a proper database)
const userSessions = new Map();

// Track song changes for token refresh
const songChangeTracker = new Map();

// Track song changes and refresh token every 2 songs
function trackSongChange(sessionId, trackId) {
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
                refreshAccessToken(session).then(refreshed => {
                    if (refreshed) {
                        console.log(`✅ Token refreshed successfully after song change`);
                    } else {
                        console.log(`❌ Token refresh failed after song change`);
                    }
                });
            }
        }
        
        songChangeTracker.set(sessionId, tracker);
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
function getUserSession(req) {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    return sessionId ? userSessions.get(sessionId) : null;
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
        
        userSessions.set(sessionId, {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        });
        
        res.redirect(`/?auth=success&session=${sessionId}`);
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// Get currently playing track with enhanced information
app.get('/api/current-track', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh (more lenient - allow 1 minute grace period)
    const oneMinuteFromNow = Date.now() + (1 * 60 * 1000);
    if (session.expiresAt <= oneMinuteFromNow) {
        console.log('🔄 Token expires soon, attempting refresh...');
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log('❌ Token refresh failed, but allowing current request to proceed');
            // Don't immediately return 401, let the request proceed and handle errors gracefully
        }
    }
    
    try {
        console.log(`🎵 Fetching current track for session: ${sessionId?.substring(0, 8)}...`);
        
        // 一次性獲取所有需要的數據，避免分批請求
        const [playerResponse, userResponse, queueResponse] = await Promise.all([
            makeSpotifyAPICall('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }, sessionId),
            makeSpotifyAPICall('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }, sessionId),
            // 同時獲取播放隊列信息
            makeSpotifyAPICall('https://api.spotify.com/v1/me/player/queue', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }, sessionId).catch((err) => {
                console.log('⚠️ Queue API failed (non-critical):', err.message);
                return null;
            }) // 隊列信息失敗不影響主要功能
        ]);
        
        console.log(`📊 Player API response status: ${playerResponse.status}`);
        console.log(`👤 User API response status: ${userResponse.status}`);
        
        if (playerResponse.status === 204 || !playerResponse.data || !playerResponse.data.item) {
            console.log('🔍 No active playback detected');
            return res.json({ 
                isPlaying: false,
                name: null,
                message: 'No music currently playing. Please start playing music in Spotify.'
            });
        }
        
        const data = playerResponse.data;
        const track = data.item;
        const device = data.device;
        const user = userResponse.data;
        
        const currentTrack = {
            isPlaying: data.is_playing,
            name: track.name,
            artist: track.artists.map(artist => artist.name).join(', '),
            album: track.album.name,
            image: track.album.images[0]?.url,
            duration: track.duration_ms,
            progress: data.progress_ms,
            id: track.id,
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
            smart_shuffle: data.smart_shuffle || false,
            is_premium: user.product === 'premium',
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
                image: queueTrack.album.images[0]?.url
            })) || [],
            nextTrack: queueResponse?.data?.queue?.[0] ? {
                id: queueResponse.data.queue[0].id,
                name: queueResponse.data.queue[0].name,
                artist: queueResponse.data.queue[0].artists.map(a => a.name).join(', ')
            } : null
        };
        
        // Track song change for token refresh
        trackSongChange(sessionId, track.id);
        
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
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                console.log('❌ Token refresh failed, returning 401');
                return res.status(401).json({ 
                    error: 'Token expired, please re-authenticate',
                    needsAuth: true 
                });
            }
            console.log('✅ Token refreshed, retrying request...');
            // Retry the request
            return res.redirect(307, req.originalUrl);
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

// Authentication middleware
function authenticateSpotify(req, res, next) {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Proactively refresh token if it expires within 5 minutes
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (session.expiresAt <= fiveMinutesFromNow) {
        console.log('🔄 Token expires soon, refreshing proactively...');
        refreshAccessToken(session).then(refreshed => {
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            req.session = session;
            next();
        }).catch(() => {
            return res.status(401).json({ error: 'Token refresh failed' });
        });
    } else {
        req.session = session;
        next();
    }
}

// Enhanced refresh access token with better logging
async function refreshAccessToken(session) {
    if (!session.refreshToken) {
        console.log('❌ No refresh token available');
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
        
        console.log('✅ Token refreshed successfully, expires at:', new Date(session.expiresAt).toISOString());
        return true;
    } catch (error) {
        console.error('❌ Error refreshing token:', error.response?.data || error.message);
        return false;
    }
}

// Enhanced authentication status check with proactive token refresh
app.get('/api/auth-status', async (req, res) => {
    const session = getUserSession(req);
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
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            // Token refresh failed, but still return current status
            console.log('❌ Token refresh failed in auth-status check');
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

// 静默刷新token端点
app.post('/api/refresh-token', async (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.body.sessionId;
    
    if (!sessionId) {
        return res.status(400).json({ success: false, message: 'No session ID provided' });
    }
    
    const session = userSessions.get(sessionId);
    if (!session || !session.refreshToken) {
        return res.status(401).json({ success: false, message: 'Session not found or no refresh token' });
    }
    
    try {
        console.log(`🔄 Attempting silent token refresh for session ${sessionId.substring(0, 8)}...`);
        const refreshed = await refreshAccessToken(session);
        
        if (refreshed) {
            console.log(`✅ Silent token refresh successful`);
            return res.json({ 
                success: true, 
                sessionId: sessionId,
                message: 'Token refreshed successfully' 
            });
        } else {
            console.log(`❌ Silent token refresh failed`);
            return res.status(401).json({ 
                success: false, 
                message: 'Token refresh failed' 
            });
        }
    } catch (error) {
        console.error('❌ Silent refresh error:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error during refresh' 
        });
    }
});

// Get available devices
app.get('/api/devices', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
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
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
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
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { trackId } = req.params;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
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
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
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
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
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
        console.log(`🎵 原始Queue数据 (${rawQueue.length}首):`, rawQueue.slice(0, 2).map(track => ({
            id: track.id,
            name: track.name, 
            hasArtists: !!track.artists,
            artistsLength: track.artists?.length,
            hasAlbum: !!track.album,
            hasImages: !!track.album?.images?.length,
            firstImage: track.album?.images?.[0]?.url
        })));
        
        const queue = rawQueue.map((track, index) => {
            const trackData = {
                id: track.id,
                name: track.name,
                artist: track.artists?.map(a => a.name).join(', ') || '未知歌手',
                image: track.album?.images?.[0]?.url || null,
                duration: track.duration_ms
            };
            
            // 调试：记录前几首歌的处理结果
            if (index < 3) {
                console.log(`🎯 处理后的Track ${index + 1}:`, {
                    name: trackData.name,
                    artist: trackData.artist,
                    hasImage: !!trackData.image,
                    imageUrl: trackData.image?.substring(0, 60) || 'NO_IMAGE'
                });
            }
            
            return trackData;
        });
        
        // 🚨 最终数据验证：确保发送给前端的数据完整
        console.log('🎯 即将发送到前端的Queue数据验证:', {
            队列长度: queue.length,
            前3首详情: queue.slice(0, 3).map((track, i) => ({
                序号: i + 1,
                歌曲名: track.name,
                歌手: track.artist,
                有图片: !!track.image,
                图片预览: track.image ? track.image.substring(0, 50) + '...' : 'NO_IMAGE'
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
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error fetching queue:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to fetch queue',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

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
                url: `https://api.lyrics.wmcc.jp.eu.org/api/search/${encodeURIComponent(query)}`,
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
                lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
            } else {
                lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(id)}`;
            }
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
            
            if (typeof response.data === 'string') {
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

// Get lyrics with multiple providers support (本地代理)
app.get('/api/lyrics/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    const providers = req.query.p || 'lrclib,netease';
    
    try {
        console.log(`🎤 請求歌詞: ${artist} - ${title} (providers: ${providers})`);
        
        // 使用 Python 腳本獲取多個提供商的歌詞
        const { spawn } = require('child_process');
        const python = spawn('python', ['lyrics.py', artist, title, providers]);
        
        let output = '';
        let errorOutput = '';
        
        python.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        const result = await new Promise((resolve, reject) => {
            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const parsed = JSON.parse(output.trim());
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error('Failed to parse Python output'));
                    }
                } else {
                    reject(new Error(`Python script failed with code ${code}: ${errorOutput}`));
                }
            });
        });
        
        if (result.success && result.results && result.results.length > 0) {
            console.log(`✅ 找到 ${result.results.length} 個歌詞結果`);
            
            // 返回多個結果，讓用戶選擇
            res.json({
                success: true,
                results: result.results,
                total: result.total,
                message: `找到 ${result.total} 個歌詞版本`
            });
        } else {
            console.log(`❌ 沒有找到歌詞: ${result.error || '未知錯誤'}`);
            res.json({ 
                success: false, 
                error: result.error || '找不到歌詞',
                results: [],
                total: 0
            });
        }
                    
                    if (typeof response.data === 'string') {
                        // 如果是字符串，檢查是否為 LRC 格式
                        const lrcResult = parseLrcFormat(response.data);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        } else {
                            // 普通文本歌詞
                            lyrics = response.data.split('\n')
                                .filter(line => line.trim() !== '')
                                .map(line => ({ text: line.trim() }));
                        }
                    } else if (response.data.lyrics) {
                        // 如果有 lyrics 字段
                        if (Array.isArray(response.data.lyrics)) {
                            lyrics = response.data.lyrics;
                            lyricsType = response.data.type || 'plain';
                        } else if (typeof response.data.lyrics === 'string') {
                            // 檢查字符串是否為 LRC 格式
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
                    } else if (Array.isArray(response.data)) {
                        // 如果直接是數組
                        lyrics = response.data;
                    } else {
                        // 嘗試將整個響應作為歌詞文本
                        const textContent = JSON.stringify(response.data);
                        const lrcResult = parseLrcFormat(textContent);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        } else {
                            lyrics = textContent.split('\n')
                                .filter(line => line.trim() !== '')
                                .map(line => ({ text: line.trim() }));
                        }
                    }
                    
                    if (lyrics.length > 0) {
                        console.log(`✅ 解析歌詞成功: ${lyrics.length} 行`);
                        res.json({
                            success: true,
                            lyrics: lyrics,
                            type: lyricsType,
                            source: 'wmcc.jp.eu.org'
                        });
                        return;
                    } else {
                        console.log(`❌ 歌詞內容為空`);
                        lastError = new Error('歌詞內容為空');
                    }
                } else {
                    console.log(`❌ API 響應無數據`);
                    lastError = new Error('API 響應無數據');
                }
            } catch (error) {
                console.error(`❌ 獲取歌詞失敗 (嘗試 ${i+1}/3):`, error.message);
                lastError = error;
                
                // 如果是最后一次尝试，或者是一个明确的错误(如404)，则不重试
                if (i === 2 || (error.response && error.response.status === 404)) {
                    break;
                }
                
                // 等待一段时间再重试
                await new Promise(resolve => setTimeout(resolve, 1000 * (i+1)));
            }
        }
        
        // 所有尝试都失败了
        console.log(`❌ 獲取歌詞失敗: ${lastError.message}`);
        if (lastError.code === 'ENOTFOUND' || lastError.code === 'ECONNREFUSED') {
            res.json({ success: false, error: '歌詞服務暫時無法連接' });
        } else if (lastError.response?.status === 404) {
            res.json({ success: false, error: '找不到該歌曲的歌詞' });
        } else {
            res.json({ success: false, error: '載入歌詞失敗: ' + lastError.message });
        }
    } catch (error) {
        console.error('❌ 獲取歌詞失敗:', error.message);
        res.json({ success: false, error: '載入歌詞失敗: ' + error.message });
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
            // 檢查 LRC 時間戳格式 [mm:ss.xx] 或 [mm:ss]
            const timeMatch = trimmedLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
            
            if (timeMatch) {
                hasTimeStamps = true;
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
                const text = timeMatch[4].trim();
                
                // 驗證時間數據的有效性
                if (isValidTimeData(minutes, seconds, milliseconds)) {
                    const timeMs = (minutes * 60 + seconds) * 1000 + milliseconds;
                    
                    if (text && text.length > 0) {
                        lyrics.push({
                            time: timeMs,
                            text: text,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                        successfulParses++;
                    } else {
                        console.log(`⚠️ LRC 解析：第 ${i + 1} 行時間戳有效但文本為空`);
                        parseErrors++;
                    }
                } else {
                    console.log(`⚠️ LRC 解析：第 ${i + 1} 行無效的時間數據 [${minutes}:${seconds}.${milliseconds}]`);
                    parseErrors++;
                    // 嘗試作為普通文本處理
                    if (text && text.length > 0) {
                        lyrics.push({
                            text: text,
                            originalLine: line,
                            lineNumber: i + 1
                        });
                    }
                }
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
        const testUrl = 'https://api.lyrics.wmcc.jp.eu.org/api/lyrics/test/test';
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
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { uris, device_id } = req.body;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
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
            const refreshed = await refreshAccessToken(session);
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
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { device_ids, play } = req.body;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
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
            const refreshed = await refreshAccessToken(session);
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
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
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

module.exports = app;

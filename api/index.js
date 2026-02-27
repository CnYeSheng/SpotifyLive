// api/index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const storage = require('./storage-facade');

const app = express();
// Initialize the storage system
storage.init();

// Middleware
app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Session-Id', 'X-Spotify-User-Id']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// In-memory session cache
const userSessions = new Map();

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

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

    if (userSessions.has(sessionId)) {
        return userSessions.get(sessionId);
    }

    try {
        const session = await storage.getSession(sessionId);
        if (session) {
            userSessions.set(sessionId, session);
            return session;
        }
    } catch (error) {
        console.error('Failed to restore session from storage:', error.message);
    }
    
    return null;
}

async function saveUserSession(sessionId, sessionData) {
    if (!sessionId || !sessionData) return;
    userSessions.set(sessionId, sessionData);
    try {
        await storage.saveSession(sessionId, sessionData);
    } catch (error) {
        console.error('Failed to save session to storage:', error.message);
    }
}

async function getUserId(req) {
    const session = await getUserSession(req);
    return session?.userProfile?.data?.id || null;
}

app.get('/api/auth', (req, res) => {
    const sessionId = generateSessionId();
    const scopes = [
        'user-read-currently-playing', 'user-read-playback-state',
        'user-modify-playback-state', 'user-read-private',
        'user-read-playback-position', 'user-library-modify',
        'user-library-read', 'playlist-read-private',
        'playlist-read-collaborative', 'streaming'
    ].join(' ');
    
    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${sessionId}`;
    res.redirect(authUrl);
});

app.get('/api/callback', async (req, res) => {
    const { code, state: sessionId } = req.query;
    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', 
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        
        await saveUserSession(sessionId, {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        });
        
        res.cookie('spotify_session', sessionId, {
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        
        res.redirect(`/?auth=success&session=${sessionId}`);
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// Authentication status check
app.get('/api/auth-status', async (req, res) => {
    const session = await getUserSession(req);
    const sessionId = req.sessionId || req.headers['x-session-id'] || req.query.sessionId;
    
    if (!session) {
        return res.json({ 
            authenticated: false,
            sessionId: null
        });
    }
    
    // Proactive token refresh if needed (within 5 minutes)
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (session.expiresAt <= fiveMinutesFromNow) {
        console.log('🔄 Proactive token refresh triggered by auth-status check');
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
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

// Manual token refresh endpoint
app.post('/api/refresh-token', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ error: 'No session found' });
        }
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (refreshed) {
            res.json({ 
                success: true, 
                sessionId: req.sessionId,
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

async function checkSessionValidity(req, res, next) {
    const session = await getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired and could not be refreshed.' });
        }
    }
    next();
}

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
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        
        session.accessToken = response.data.access_token;
        if (response.data.refresh_token) {
            session.refreshToken = response.data.refresh_token;
        }
        session.expiresAt = Date.now() + (response.data.expires_in * 1000);
        
        if (sessionId) {
            await saveUserSession(sessionId, session);
        }
        
        console.log('✅ Token refreshed successfully...');
        return true;
    } catch (error) {
        console.error('❌ Token refresh failed:', error.response?.data || error.message);
        return false;
    }
}

// Get currently playing track
app.get('/api/current-track', checkSessionValidity, async (req, res) => {
    // Disable browser caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const session = await getUserSession(req);
    const sessionId = req.sessionId;

    try {
        // Parallel fetching of player status and user profile if needed
        const promises = [
            axios.get('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            })
        ];

        if (!session.userProfile || Date.now() - (session.userProfile.timestamp || 0) > 3600000) {
            promises.push(axios.get('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }).then(response => {
                session.userProfile = { data: response.data, timestamp: Date.now() };
                saveUserSession(sessionId, session);
                return response;
            }));
        } else {
            promises.push(Promise.resolve({ data: session.userProfile.data }));
        }

        // Optional: Fetch queue if possible
        promises.push(axios.get('https://api.spotify.com/v1/me/player/queue', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }).catch(() => null));

        const [playerResponse, userResponse, queueResponse] = await Promise.all(promises);

        if (playerResponse.status === 204 || !playerResponse.data || !playerResponse.data.item) {
            return res.json({ isPlaying: false });
        }
        
        const data = playerResponse.data;
        const track = data.item;
        const user = userResponse.data;
        const userId = user.id;

        const trackSettings = await storage.getSettings(userId, track.id) || {};
        
        const responseData = {
            isPlaying: data.is_playing,
            name: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album.name,
            image: track.album.images[0]?.url,
            duration: track.duration_ms,
            progress: data.progress_ms,
            timestamp: data.timestamp || Date.now(),
            id: track.id,
            user_id: userId,
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
            is_premium: user.product === 'premium',
            lyricsOffset: trackSettings.offset || 0,
            manualLyrics: trackSettings.manualLyrics || null,
            // Simple queue info
            queue: queueResponse?.data?.queue?.slice(0, 5).map(q => ({
                id: q.id,
                name: q.name,
                artist: q.artists.map(a => a.name).join(', ')
            })) || []
        };
        
        res.json(responseData);
    } catch (error) {
        if (error.response?.status === 401) {
            // If we get a 401 here, the token might have expired just now
            const refreshed = await refreshAccessToken(session, sessionId);
            if (refreshed) {
                return res.redirect(307, req.originalUrl); // Retry
            }
        }
        console.error('Error fetching current track:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch current track' });
    }
});

// =======================================================
// REFACTORED USER-AWARE SETTINGS/LYRICS ENDPOINTS
// =======================================================

// Save custom lyrics for a user
app.post('/api/lyrics/custom', checkSessionValidity, async (req, res) => {
    const userId = await getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { trackInfo, lyrics, lyricsType, source } = req.body;
    if (!trackInfo || !trackInfo.id) {
        return res.status(400).json({ success: false, error: 'Missing trackInfo' });
    }

    try {
        await storage.saveLyrics(userId, trackInfo, lyrics, lyricsType, source);
        res.json({ success: true, message: "Lyrics saved." });
    } catch (error) {
        console.error('Failed to save custom lyrics:', error);
        res.status(500).json({ success: false, error: 'Failed to save lyrics.' });
    }
});

// Delete custom lyrics for a user
app.delete('/api/lyrics/custom/:trackId', checkSessionValidity, async (req, res) => {
    const userId = await getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });
    
    const { trackId } = req.params;
    if (!trackId) {
        return res.status(400).json({ success: false, error: 'Missing trackId' });
    }

    try {
        await storage.deleteLyrics(userId, trackId);
        res.json({ success: true, message: "Lyrics deleted." });
    } catch (error) {
        console.error('Failed to delete custom lyrics:', error);
        res.status(500).json({ success: false, error: 'Failed to delete lyrics.' });
    }
});

// Save settings (like offset) for a user
app.post('/api/lyrics/settings', checkSessionValidity, async (req, res) => {
    const userId = await getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });

    const { trackId, offset, manualLyrics } = req.body;
    if (!trackId) {
        return res.status(400).json({ success: false, error: 'Missing trackId' });
    }

    try {
        await storage.saveSettings(userId, trackId, { offset, manualLyrics });
        res.json({ success: true, message: "Settings saved." });
    } catch (error) {
        console.error('Failed to save settings:', error);
        res.status(500).json({ success: false, error: 'Failed to save settings.' });
    }
});

// Get all lyrics settings for a user
app.get('/api/lyrics/all', checkSessionValidity, async (req, res) => {
    const userId = await getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: 'Not authenticated' });
    
    try {
        const allLyrics = await storage.getAllLyrics(userId);
        res.json({ success: true, lyrics: allLyrics });
    } catch (error) {
        console.error('Failed to get all lyrics:', error);
        res.status(500).json({ success: false, error: 'Failed to get lyrics.' });
    }
});

// KV Sync Endpoints
app.post('/api/kv/sync-all', checkSessionValidity, async (req, res) => {
    try {
        const userId = await getUserId(req);
        const syncData = req.body || {};
        
        // Use storage facade to sync
        const result = await storage.migrate(req, syncData);
        
        res.json({
            success: true,
            summary: result
        });
    } catch (error) {
        console.error('❌ KV sync failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const session = await getUserSession(req);
        res.json({ 
            status: 'OK', 
            spotify: !!(session && session.accessToken),
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

// Bridge to enhanced lyrics endpoints
const enhancedLyricsEndpoints = require('./enhanced-lyrics-endpoints');

app.post('/api/kv/auto-cache', enhancedLyricsEndpoints.handleAutoCache);
app.get('/api/kv/cache/:trackId/:trackName/:artist', enhancedLyricsEndpoints.getCachedLyrics);
app.post('/api/kv/save-lyrics-permanent', enhancedLyricsEndpoints.savePermanentLyrics);
app.post('/api/kv/save-time-offset', enhancedLyricsEndpoints.saveTimeOffset);
app.get('/api/kv/time-offset/:trackId/:trackName/:artist', enhancedLyricsEndpoints.getTimeOffset);
app.delete('/api/kv/cleanup-cache', enhancedLyricsEndpoints.cleanupExpiredCache);
app.get('/api/kv/cache-stats', enhancedLyricsEndpoints.getCacheStats);

module.exports = app;

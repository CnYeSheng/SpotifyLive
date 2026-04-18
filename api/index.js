// api/index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const storage = require('./storage-facade');
require('dotenv').config();

const app = express();

// Initialize the storage system
storage.init().catch(err => console.error('Failed to init storage:', err));

// Rate limiter for Spotify API
class SpotifyRateLimiter {
    constructor() {
        this.sessionCalls = new Map();
        this.globalCalls = [];
        this.maxCallsPerMinute = 180;
        this.maxCallsPerSession = 300;
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
            if (recentSessionCalls.length >= this.maxCallsPerSession) return false;
        }
        if (this.globalCalls.length >= this.maxCallsPerMinute) return false;
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
const LYRICS_API_URL = process.env.LYRICS_API_URL || 'https://api.lyrics.wmcc.jp.eu.org';

// Session tracking
const userSessions = new Map();
const songChangeTracker = new Map();

function trackSongChange(sessionId, trackId) {
    try {
        if (!sessionId || !trackId) return;
        const tracker = songChangeTracker.get(sessionId) || { currentTrackId: null, songCount: 0, lastRefreshTime: Date.now() };
        if (tracker.currentTrackId !== trackId) {
            tracker.currentTrackId = trackId;
            tracker.songCount++;
            if (tracker.songCount >= 2) {
                tracker.songCount = 0;
                tracker.lastRefreshTime = Date.now();
                const session = userSessions.get(sessionId);
                if (session) refreshAccessToken(session, sessionId).catch(() => {});
            }
            songChangeTracker.set(sessionId, tracker);
        }
    } catch (error) {}
}

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
    if (userSessions.has(sessionId)) return userSessions.get(sessionId);
    try {
        const session = await storage.getSession(sessionId);
        if (session) {
            userSessions.set(sessionId, session);
            return session;
        }
    } catch (error) {}
    return null;
}

async function getSpotifyUserId(session, sessionId) {
    if (session.userProfile?.data?.id) return session.userProfile.data.id;
    try {
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        session.userProfile = { data: response.data, timestamp: Date.now() };
        await saveUserSession(sessionId, session);
        return response.data.id;
    } catch (error) { return null; }
}

async function saveUserSession(sessionId, sessionData) {
    if (!sessionId || !sessionData) return;
    if (sessionData.currentTrackCache) delete sessionData.currentTrackCache;
    userSessions.set(sessionId, sessionData);
    try { await storage.saveSession(sessionId, sessionData); } catch (error) {}
}

async function refreshAccessToken(session, sessionId) {
    if (!session.refreshToken) return false;
    try {
        const response = await axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        session.accessToken = response.data.access_token;
        if (response.data.refresh_token) session.refreshToken = response.data.refresh_token;
        session.expiresAt = Date.now() + (response.data.expires_in * 1000);
        if (sessionId) await saveUserSession(sessionId, session);
        return true;
    } catch (error) { return false; }
}

async function invalidateUserCache(userId) {
    if (!userId) return;
    for (const [sid, session] of userSessions.entries()) {
        if (session.userProfile?.data?.id === userId) {
            delete session.currentTrackCache;
            await storage.saveSession(sid, session);
        }
    }
}

// --- Auth Endpoints ---
app.get('/api/auth', async (req, res) => {
    let sessionId = (await getUserSession(req)) ? req.sessionId : generateSessionId();
    const scopes = ['user-read-currently-playing', 'user-read-playback-state', 'user-modify-playback-state', 'user-read-playback-position', 'user-read-private', 'user-library-modify', 'user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'streaming'].join(' ');
    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${sessionId}`;
    res.redirect(authUrl);
});

app.get('/api/callback', async (req, res) => {
    const { code, state: sessionId } = req.query;
    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', 
            new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const sessionData = { accessToken: response.data.access_token, refreshToken: response.data.refresh_token, expiresAt: Date.now() + (response.data.expires_in * 1000) };
        let finalSessionId = sessionId;
        try {
            const userProfileResponse = await axios.get('https://api.spotify.com/v1/me', { headers: { 'Authorization': `Bearer ${sessionData.accessToken}` } });
            const userId = userProfileResponse.data.id;
            sessionData.userProfile = { data: userProfileResponse.data, timestamp: Date.now() };
            for (const [sid, existingSession] of userSessions.entries()) {
                if (existingSession.userProfile?.data?.id === userId) { finalSessionId = sid; break; }
            }
        } catch (e) {}
        await saveUserSession(finalSessionId, sessionData);
        res.cookie('spotify_session', finalSessionId, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.redirect(`/?auth=success&session=${finalSessionId}`);
    } catch (error) { res.status(500).send('Authentication failed'); }
});

app.get('/api/auth-status', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.json({ authenticated: false, sessionId: null });
    if (session.expiresAt <= Date.now() + (5 * 60 * 1000)) await refreshAccessToken(session, req.sessionId);
    res.json({ authenticated: true, sessionId: req.sessionId });
});

app.post('/api/refresh-token', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'No session' });
    const refreshed = await refreshAccessToken(session, req.sessionId);
    res.json({ success: refreshed });
});

app.get('/api/force-relogin', (req, res) => {
    res.clearCookie('spotify_session');
    res.redirect('/api/auth');
});

// --- Player Endpoints ---
app.get('/api/current-track', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    if (session.currentTrackCache && (Date.now() - session.currentTrackCache.timestamp < 800)) {
        const cachedData = session.currentTrackCache.data;
        if (cachedData.isPlaying) {
             const elapsed = Date.now() - session.currentTrackCache.timestamp;
             return res.json({ ...cachedData, progress: Math.min(cachedData.duration, cachedData.progress + elapsed) });
        }
        return res.json(cachedData);
    }
    if (session.expiresAt <= Date.now() + 60000) await refreshAccessToken(session, req.sessionId);
    try {
        const [playerResponse, userProfile, queueResponse] = await Promise.all([
            makeSpotifyAPICall('https://api.spotify.com/v1/me/player', { headers: { 'Authorization': `Bearer ${session.accessToken}` } }, req.sessionId),
            getSpotifyUserId(session, req.sessionId).then(id => id ? { id } : null),
            makeSpotifyAPICall('https://api.spotify.com/v1/me/player/queue', { headers: { 'Authorization': `Bearer ${session.accessToken}` } }, req.sessionId).catch(() => null)
        ]);
        if (playerResponse.status === 204 || !playerResponse.data?.item) {
            const empty = { isPlaying: false };
            session.currentTrackCache = { data: empty, timestamp: Date.now() };
            return res.json(empty);
        }
        const data = playerResponse.data;
        const track = data.item;
        const userId = userProfile?.id;
        const settings = userId ? (await storage.getSettings(userId, track.id) || {}) : {};
        const currentTrack = {
            isPlaying: data.is_playing,
            name: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            album: track.album.name,
            image: track.album.images[0]?.url,
            duration: track.duration_ms,
            progress: data.progress_ms,
            timestamp: data.timestamp || Date.now(),
            id: track.id,
            shuffle_state: data.shuffle_state,
            repeat_state: data.repeat_state,
            user_id: userId,
            device: data.device ? { id: data.device.id, name: data.device.name, type: data.device.type, volume: data.device.volume_percent } : null,
            queue: queueResponse?.data?.queue?.slice(0, 5).map(q => ({ id: q.id, name: q.name, artist: q.artists.map(a => a.name).join(', '), image: q.album.images[0]?.url })),
            lyricsOffset: settings.offset || 0,
            manualLyrics: settings.manualLyrics || null
        };
        session.currentTrackCache = { data: currentTrack, timestamp: Date.now() };
        trackSongChange(req.sessionId, track.id);
        res.json(currentTrack);
    } catch (error) { res.status(500).json({ error: 'Failed to fetch current track' }); }
});

app.get('/api/devices', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/devices', { headers: { 'Authorization': `Bearer ${session.accessToken}` } }, req.sessionId);
        res.json({ devices: response.data.devices || [] });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/playback/play-pause', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const status = await axios.get('https://api.spotify.com/v1/me/player', { headers: { 'Authorization': `Bearer ${session.accessToken}` } });
        const url = status.data?.is_playing ? 'https://api.spotify.com/v1/me/player/pause' : 'https://api.spotify.com/v1/me/player/play';
        await axios.put(url, {}, { headers: { 'Authorization': `Bearer ${session.accessToken}` } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Playback: next, previous, seek, volume, shuffle, repeat
['next', 'previous'].forEach(action => {
    app.post(`/api/playback/${action}`, async (req, res) => {
        const session = await getUserSession(req);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        try {
            await axios.post(`https://api.spotify.com/v1/me/player/${action}`, {}, { headers: { 'Authorization': `Bearer ${session.accessToken}` } });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ success: false }); }
    });
});

app.post('/api/playback/seek', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    try {
        await axios.put(`https://api.spotify.com/v1/me/player/seek?position_ms=${req.body.position_ms}`, {}, { headers: { 'Authorization': `Bearer ${session.accessToken}` } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/playback/volume', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    try {
        await axios.put(`https://api.spotify.com/v1/me/player/volume?volume_percent=${req.body.volume}`, {}, { headers: { 'Authorization': `Bearer ${session.accessToken}` } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Playback: shuffle, repeat
app.post('/api/playback/shuffle', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    try {
        // 切換 shuffle 狀態
        const newState = !session.currentTrackCache?.data?.shuffle_state;
        await axios.put(`https://api.spotify.com/v1/me/player/shuffle?state=${newState}`, {}, { 
            headers: { 'Authorization': `Bearer ${session.accessToken}` },
            params: { state: newState }
        });
        res.json({ success: true });
    } catch (e) { 
        console.error('Shuffle toggle error:', e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

app.post('/api/playback/repeat', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    try {
        // 循環切換重複模式：off -> context -> track -> off
        const repeatModes = ['off', 'context', 'track'];
        const currentState = session.currentTrackCache?.data?.repeat_state || 'off';
        const currentIndex = repeatModes.indexOf(currentState);
        const nextState = repeatModes[(currentIndex + 1) % repeatModes.length];
        
        await axios.put(`https://api.spotify.com/v1/me/player/repeat`, {}, { 
            headers: { 'Authorization': `Bearer ${session.accessToken}` },
            params: { state: nextState }
        });
        res.json({ success: true });
    } catch (e) { 
        console.error('Repeat toggle error:', e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.message }); 
    }
});

// Control endpoints
app.post('/api/control/offset', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const trackId = session.currentTrackCache?.data?.id;
    if (userId && trackId) {
        await storage.saveSettings(userId, trackId, { offset: parseInt(req.body.offset) || 0 });
        await invalidateUserCache(userId);
    }
    res.json({ success: true });
});

app.post('/api/control/manual-lyrics', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const trackId = session.currentTrackCache?.data?.id;
    if (userId && trackId) {
        const { id, source, title, artist } = req.body;
        await storage.saveSettings(userId, trackId, { manualLyrics: { id, source, title, artist } });
        await invalidateUserCache(userId);
    }
    res.json({ success: true });
});

app.post('/api/control/reset', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const trackId = session.currentTrackCache?.data?.id;
    if (userId && trackId) {
        await storage.saveSettings(userId, trackId, { offset: 0, manualLyrics: null });
        await invalidateUserCache(userId);
    }
    res.json({ success: true });
});

// --- KV Endpoints (Bridged to Storage Facade) ---
app.get('/api/kv/status', (req, res) => res.json({ success: true, kvAvailable: storage.initialized, storageType: storage.dbType }));

app.post('/api/kv/user-lyrics', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const { trackInfo, lyrics, lyricsType, source } = req.body;
    if (userId) await storage.saveLyrics(userId, trackInfo, lyrics, lyricsType, source);
    res.json({ success: true });
});

app.get('/api/kv/user-lyrics/:trackKey', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const trackId = req.params.trackKey.split('-')[0];
    const data = userId ? await storage.getLyrics(userId, { id: trackId }) : null;
    res.json({ success: true, data });
});

app.post('/api/kv/user-lyrics/get', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const trackId = req.body.id || req.body.trackInfo?.id;
    const data = userId ? await storage.getLyrics(userId, { id: trackId }) : null;
    res.json({ success: true, data });
});

app.post('/api/kv/save-time-offset', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const { trackInfo, timeOffset } = req.body;
    if (userId) await storage.saveOffset(userId, trackInfo, timeOffset);
    res.json({ success: true });
});

app.post('/api/kv/migrate', async (req, res) => {
    const result = await storage.migrate(req, req.body.localStorageData);
    res.json({ success: true, data: result });
});

// ✨ 雲端同步 endpoints
app.get('/api/kv/all-lyrics', async (req, res) => {
    try {
        const allLyrics = await storage.getAllUserLyrics(req);
        res.json({ success: true, data: allLyrics, count: allLyrics.length });
    } catch (error) {
        console.error('獲取所有歌詞失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/kv/sync-to-cloud', async (req, res) => {
    try {
        const { lyricsData } = req.body;
        if (!Array.isArray(lyricsData)) {
            return res.status(400).json({ success: false, error: 'lyricsData 必須是數組' });
        }
        const result = await storage.syncLyricsToCloud(req, lyricsData);
        res.json(result);
    } catch (error) {
        console.error('同步歌詞到雲端失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/kv/lyrics-stats', async (req, res) => {
    try {
        const stats = await storage.getLyricsStats(req);
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('獲取歌詞統計失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- Lyrics Logic ---
function cleanMetadata(t) { return t?.replace(/\s*[\(\[][fF]eat\.?.*[\)\]]/g, '').replace(/\s*[\(\[][wW]ith.*[\)\]]/g, '').replace(/\s*-\s*.*(?:Remix|Mix|Edit|Version)/gi, '').trim(); }
function cleanArtist(t) { return t?.split(/[,;/\\]|\s+&\s+/)[0].trim(); }

app.get('/api/search-lyrics/:query', async (req, res) => {
    const { query } = req.params;
    try {
        const sources = [
            { name: 'wmcc', url: `${LYRICS_API_URL}/api/search/${encodeURIComponent(query)}` },
            { name: 'lrclib', url: `https://lrclib.net/api/search?q=${encodeURIComponent(query)}` }
        ];
        let results = [];
        for (const s of sources) {
            try {
                const r = await axios.get(s.url, { timeout: 8000 });
                if (r.data) results = results.concat(Array.isArray(r.data) ? r.data : []);
            } catch (e) {}
        }
        res.json({ success: true, results });
    } catch (e) { res.json({ success: false, results: [] }); }
});

app.get('/api/lyrics/:artist/:title', async (req, res) => {
    const artist = cleanArtist(req.params.artist);
    const title = cleanMetadata(req.params.title);
    const p = req.query.p;
    let url = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
    if (p) url += `?p=${p}`;
    if (req.query.wbw !== undefined) url += (p ? '&wbw' : '?wbw');
    try {
        const r = await axios.get(url, { timeout: 30000 });
        if (r.data?.lyrics) res.json({ success: true, lyrics: r.data.lyrics, type: r.data.type, provider: p || r.data.provider });
        else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 健康檢查端點（增強版）
app.get('/api/health', (req, res) => {
  const monitor = require('../utils/monitor');
  const metrics = monitor.getMetrics();
  
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: metrics.uptimeFormatted,
    memory: metrics.memory,
    requests: {
      total: metrics.requests.total,
      failed: metrics.requests.failed,
      avgResponseTime: Math.round(metrics.requests.avgResponseTime) + 'ms'
    }
  });
});

// 監控指標端點
app.get('/api/metrics', (req, res) => {
  const monitor = require('../utils/monitor');
  res.json(monitor.getMetrics());
});

// 日誌分析端點
app.get('/api/logs/analysis', (req, res) => {
  const logger = require('../utils/logger');
  const timeRange = req.query.range || '1h';
  res.json(logger.analyzeLogs(timeRange));
});

module.exports = app;

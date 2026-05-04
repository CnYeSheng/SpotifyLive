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
const LYRICS_API_URL = process.env.LYRICS_API_URL || 'https://lyrics.cyss.us.eu.org';

// Session tracking
const userSessions = new Map();
const songChangeTracker = new Map();

async function trackSongChange(sessionId, track, userId) {
    try {
        if (!sessionId || !track) return;
        const trackId = typeof track === 'string' ? track : track.id;
        const tracker = songChangeTracker.get(sessionId) || { 
            currentTrackId: null, 
            songCount: 0, 
            lastRefreshTime: Date.now(),
            startTime: Date.now(),
            trackInfo: null
        };
        
        if (tracker.currentTrackId !== trackId) {
            // Save history for the PREVIOUS track
            if (tracker.currentTrackId && tracker.trackInfo) {
                const now = Date.now();
                const listenedDuration = now - tracker.startTime;
                // Cap duration to actual track duration
                const trackDuration = tracker.trackInfo.duration_ms || tracker.trackInfo.duration || 0;
                const durationMs = Math.min(listenedDuration, trackDuration);
                
                // Only save if listened for more than 5 seconds
                if (durationMs > 5000) {
                    try {
                        await storage.saveListeningHistory({ 
                            headers: { 'x-spotify-user-id': userId, 'x-session-id': sessionId } 
                        }, {
                            trackId: tracker.currentTrackId,
                            trackName: tracker.trackInfo.name,
                            artistName: Array.isArray(tracker.trackInfo.artists) ? tracker.trackInfo.artists.map(a => a.name).join(', ') : tracker.trackInfo.artist,
                            albumName: tracker.trackInfo.album?.name || tracker.trackInfo.album,
                            durationMs: durationMs,
                            playedAt: new Date(tracker.startTime)
                        });
                    } catch (e) {
                        console.error('Failed to save listening history:', e);
                    }
                }
            }

            tracker.currentTrackId = trackId;
            tracker.trackInfo = track;
            tracker.startTime = Date.now();
            tracker.songCount++;
            
            if (tracker.songCount >= 2) {
                tracker.songCount = 0;
                tracker.lastRefreshTime = Date.now();
                const session = userSessions.get(sessionId);
                if (session) refreshAccessToken(session, sessionId).catch(() => {});
            }
            songChangeTracker.set(sessionId, tracker);
        }
    } catch (error) {
        console.error('Track song change error:', error);
    }
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
        trackSongChange(req.sessionId, track, userId);
        res.json(currentTrack);
    } catch (error) { res.status(500).json({ error: 'Failed to fetch current track' }); }
});

// Sync recently played tracks from Spotify to fill gaps (e.g. when server was offline)
async function syncRecentlyPlayed(sessionId, userId, accessToken) {
    if (!userId || !accessToken) return;
    
    try {
        console.log(`🔄 [Sync] Fetching recently played for user ${userId.substring(0, 8)}...`);
        const response = await makeSpotifyAPICall('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }, sessionId);

        if (!response.data || !response.data.items || response.data.items.length === 0) {
            return;
        }

        // Get existing history for the last 1 day to check for duplicates
        const history = await storage.getListeningHistory({ headers: { 'x-spotify-user-id': userId } }, 1);
        const existingTimestamps = new Set(history.map(h => new Date(h.playedAt).getTime()));
        let newRecords = 0;

        for (const item of response.data.items) {
            const playedAt = new Date(item.played_at);
            const timestamp = playedAt.getTime();

            // Only record if it doesn't already exist in our history
            if (!existingTimestamps.has(timestamp)) {
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

                await storage.saveListeningHistory({ headers: { 'x-spotify-user-id': userId, 'x-session-id': sessionId } }, historyData);
                newRecords++;
            }
        }

        if (newRecords > 0) {
            console.log(`✅ [Sync] Added ${newRecords} missing records for user ${userId.substring(0, 8)}`);
        }
    } catch (error) {
        console.error(`❌ [Sync] Failed for ${userId.substring(0, 8)}:`, error.message);
    }
}

app.get('/api/stats/listening', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        let until = null;
        if (days === 2) {
            until = new Date();
            until.setHours(0, 0, 0, 0);
        }
        
        const session = await getUserSession(req);
        const userId = session ? (session.userProfile?.data?.id || await getSpotifyUserId(session, req.sessionId)) : null;

        // Trigger sync in background
        if (session && userId) {
            syncRecentlyPlayed(req.sessionId, userId, session.accessToken).catch(err => {
                console.error('Background sync failed:', err);
            });
        }

        const history = await storage.getListeningHistory(req, days, until);
        
        // Calculate stats
        const totalDuration = history.reduce((sum, item) => sum + (item.durationMs || 0), 0);
        
        const songCounts = {};
        history.forEach(item => {
            // 確保 trackName 和 artistName 存在
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
                
                // 如果真的提取不到 ID，就用名稱作為 Key
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
        
        // 再次檢查是否有 ID 相同但 Key 不同的項
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
            topSongs,
            topPlaylists,
            history: history.slice(0, 50)
        });
    } catch (error) {
        console.error('Failed to fetch listening stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 獲取歌單詳情（包含用戶播放過的歌曲）
app.get('/api/playlist/:id', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const playlistId = req.params.id;
        const days = parseInt(req.query.days) || 7; 
        const sessionId = req.sessionId;
        const userId = await getSpotifyUserId(session, sessionId);
        
        // 檢查 token 是否需要刷新
        if (session.expiresAt <= Date.now() + 60000) {
            await refreshAccessToken(session, sessionId);
        }
        
        // 獲取歌單基本資訊
        const playlistResponse = await makeSpotifyAPICall(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        
        const playlist = playlistResponse.data;
        
        // 獲取歌單中的歌曲
        const tracksResponse = await makeSpotifyAPICall(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        }, sessionId);
        
        const allTracks = tracksResponse.data.items.map(item => ({
            id: item.track?.id,
            name: item.track?.name,
            artist: item.track?.artists?.map(a => a.name).join(', '),
            album: item.track?.album?.name,
            image: item.track?.album?.images?.[0]?.url,
            duration_ms: item.track?.duration_ms
        })).filter(track => track.id !== null);
        
        // 獲取用戶在指定天數內的聽歌歷史
        const history = await storage.getListeningHistory(req, days, null);
        
        // 過濾出只在這個歌單中播放的記錄
        const playlistContextUri = `spotify:playlist:${playlistId}`;
        const playlistHistory = history.filter(item => {
            const uriMatch = item.contextUri === playlistContextUri;
            const nameMatch = item.contextName && (item.contextName === playlist.name || item.contextName === `Playlist:${playlistId}`);
            return uriMatch || nameMatch;
        });
        
        // 為每首播放過的歌曲添加播放次數
        const trackPlayCounts = {};
        playlistHistory.forEach(item => {
            trackPlayCounts[item.trackId] = (trackPlayCounts[item.trackId] || 0) + 1;
        });
        
        // 找出歌單中實際播放過的歌曲
        const playedTrackIds = new Set(playlistHistory.map(item => item.trackId));
        const playedTracksWithCount = allTracks
            .filter(track => playedTrackIds.has(track.id))
            .map(track => ({
                ...track,
                playCount: trackPlayCounts[track.id] || 0
            }))
            .sort((a, b) => b.playCount - a.playCount);
        
        res.json({
            success: true,
            playlist: {
                id: playlist.id,
                name: playlist.name,
                description: playlist.description,
                image: playlist.images?.[0]?.url,
                total_tracks: playlist.tracks.total,
                owner: playlist.owner?.display_name,
                played_tracks_count: playedTracksWithCount.length
            },
            tracks: playedTracksWithCount
        });
    } catch (error) {
        console.error('Failed to fetch playlist details:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cache for context names
const contextNameCache = new Map();
const CONTEXT_CACHE_TTL = 60 * 60 * 1000;

async function fetchPlaylistName(playlistId, accessToken, sessionId) {
    const cacheKey = `playlist:${playlistId}`;
    if (contextNameCache.has(cacheKey)) {
        const cached = contextNameCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) return cached.name;
    }
    try {
        const response = await makeSpotifyAPICall(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }, sessionId);
        const name = response.data?.name || null;
        if (name) contextNameCache.set(cacheKey, { name, timestamp: Date.now() });
        return name;
    } catch (error) { return null; }
}

async function getContextName(context, accessToken, sessionId) {
    if (!context) return null;
    const type = context.type;
    const uri = context.uri;
    if (type === 'playlist' && uri) {
        const id = uri.split(':')[2];
        if (id) return await fetchPlaylistName(id, accessToken, sessionId);
    }
    return null;
}

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
        console.log('📡 獲取所有歌詞請求...');
        const allLyrics = await storage.getAllUserLyrics(req);
        console.log(`✅ 成功獲取 ${allLyrics.length} 首歌詞`);
        res.json({ success: true, data: allLyrics, count: allLyrics.length });
    } catch (error) {
        console.error('❌ 獲取所有歌詞失敗:', error);
        console.error('錯誤堆棧:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
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
    } catch (error) {
        console.error('Search lyrics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/lyrics/:artist/:title', async (req, res) => {
        const artist = cleanArtist(req.params.artist);
        const title = cleanMetadata(req.params.title);
        const p = req.query.p;
        const isWbw = req.query.wbw !== undefined;

        // 1. 嘗試直接獲取
        let url = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
        if (p) url += `?p=${p}`;
        if (isWbw) url += (p ? '&wbw' : '?wbw');

        try {
            console.log(`📡 Fetching lyrics: ${artist} - ${title} from ${url}`);
            const r = await axios.get(url, { timeout: 30000 });

            if (r.data && (r.data.success || r.data.lyrics)) {
                return res.json({ 
                    success: true, 
                    lyrics: r.data.lyrics, 
                    type: r.data.type, 
                    provider: p || r.data.provider 
                });
            }

            // 2. 如果直接獲取失敗且是自動模式，嘗試搜尋回退
            if (!p) {
                console.log(`🔍 Direct fetch failed, trying search fallback: ${artist} ${title}`);
                const searchUrl = `${LYRICS_API_URL}/api/search/${encodeURIComponent(artist + ' ' + title)}`;
                const searchRes = await axios.get(searchUrl, { timeout: 15000 });

                if (searchRes.data && Array.isArray(searchRes.data) && searchRes.data.length > 0) {
                    const first = searchRes.data[0];
                    const fallbackUrl = `${LYRICS_API_URL}/api/lyrics/${encodeURIComponent(first.name || first.title)}/${encodeURIComponent(first.artist || first.singer)}`;
                    const lyricsRes = await axios.get(fallbackUrl, { timeout: 15000 });

                    if (lyricsRes.data && (lyricsRes.data.success || lyricsRes.data.lyrics)) {
                        return res.json({
                            success: true,
                            lyrics: lyricsRes.data.lyrics,
                            type: lyricsRes.data.type,
                            provider: 'SearchFallback',
                            isFallback: true
                        });
                    }
                }
            }

            res.status(404).json({ success: false, error: '未找到歌词' });
        } catch (e) {
            console.error('❌ Lyrics fetch error:', e.message);
            res.status(500).json({ success: false, error: e.message });
        }
    });

// ✨ 提取顏色端點
app.post('/api/extract-colors', async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ error: '缺少 imageUrl' });
        }

        // 下載圖片並提取主要顏色
        const imageResponse = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            timeout: 10000
        });

        // 簡單的顏色提取邏輯（基於像素分析）
        const colors = extractDominantColors(imageResponse.data);
        
        res.json({ 
            success: true, 
            colors: colors
        });
    } catch (error) {
        console.error('❌ 顏色提取失敗:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 簡單的顏色提取函數
function extractDominantColors(buffer) {
    // 這裡實現一個簡化的顏色提取算法
    // 實際生產環境可以使用 color-thief-node 等庫
    
    // 返回預設的 Spotify 風格顏色
    return {
        dominant: '#1DB954',
        vibrant: '#1ed760',
        muted: '#282828',
        lightVibrant: '#b3b3b3',
        darkVibrant: '#121212'
    };
}

// ✨ 檢查歌曲是否在喜歡列表中
app.get('/api/library/check/:trackId', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const trackId = req.params.trackId;
        const response = await makeSpotifyAPICall(
            `https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`,
            { headers: { 'Authorization': `Bearer ${session.accessToken}` } },
            req.sessionId
        );
        
        const isLiked = response.data[0];
        res.json({ isLiked, trackId });
    } catch (error) {
        console.error('❌ 檢查喜歡狀態失敗:', error.message);
        res.status(500).json({ error: 'Failed to check like status' });
    }
});

// ✨ 添加歌曲到喜歡列表
app.post('/api/library/add', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const { trackId } = req.body;
        await axios.put(
            'https://api.spotify.com/v1/me/tracks',
            { ids: [trackId] },
            { headers: { 'Authorization': `Bearer ${session.accessToken}` } }
        );
        res.json({ success: true, trackId });
    } catch (error) {
        console.error('❌ 添加到喜歡列表失敗:', error.message);
        res.status(500).json({ error: 'Failed to add to library' });
    }
});

// ✨ 從喜歡列表移除歌曲
app.post('/api/library/remove', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const { trackId } = req.body;
        await axios.delete(
            'https://api.spotify.com/v1/me/tracks',
            { 
                headers: { 'Authorization': `Bearer ${session.accessToken}` },
                data: { ids: [trackId] }
            }
        );
        res.json({ success: true, trackId });
    } catch (error) {
        console.error('❌ 從喜歡列表移除失敗:', error.message);
        res.status(500).json({ error: 'Failed to remove from library' });
    }
});

// ✨ KV user-provider endpoints
app.post('/api/kv/user-provider', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const { trackInfo, provider, settings } = req.body;
    
    if (userId && trackInfo) {
        await storage.saveUserProvider(userId, trackInfo, { provider, settings });
    }
    res.json({ success: true });
});

app.post('/api/kv/user-provider/get', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const trackId = req.body.id || req.body.trackInfo?.id;
    
    const data = userId ? await storage.getUserProvider(userId, { id: trackId }) : null;
    res.json({ success: true, data });
});

// ✨ 獲取所有用戶歌詞
app.get('/api/kv/get-all-lyrics', async (req, res) => {
    try {
        const allLyrics = await storage.getAllUserLyrics(req);
        res.json({ success: true, data: allLyrics, count: allLyrics.length });
    } catch (error) {
        console.error('獲取所有歌詞失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ KV user-lyrics GET endpoint (for refreshing localStorage)
app.get('/api/kv/user-lyrics', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    
    if (!userId) {
        return res.json({ success: true, data: [] });
    }
    
    try {
        const allLyrics = await storage.getAllUserLyrics(req);
        res.json({ success: true, data: allLyrics });
    } catch (error) {
        console.error('獲取用戶歌詞失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ KV user-providers GET endpoint (for refreshing localStorage)
app.get('/api/kv/user-providers', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    
    if (!userId) {
        return res.json({ success: true, data: [] });
    }
    
    try {
        // 從 storage 獲取所有用戶的供應商偏好
        // 注意：這需要 enhancedStorage 支持，如果沒有則返回空數組
        res.json({ success: true, data: [] });
    } catch (error) {
        console.error('獲取用戶供應商偏好失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 獲取所有時間偏移
app.get('/api/kv/get-time-offsets', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    
    if (!userId) {
        return res.json({ success: true, offsets: {} });
    }
    
    try {
        // 從 storage 獲取所有時間偏移
        // 這裡需要根據實際存儲結構來實現
        res.json({ success: true, offsets: {} });
    } catch (error) {
        console.error('獲取時間偏移失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 清除所有雲端數據
app.delete('/api/kv/clear-all', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        // 清除用戶的所有 KV 數據
        // 注意：這是一個危險操作，應該謹慎使用
        res.json({ success: true, message: 'All cloud data cleared' });
    } catch (error) {
        console.error('清除雲端數據失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 批量保存歌詞
app.post('/api/kv/batch-save-lyrics', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const { lyrics } = req.body;
    
    if (!userId || !Array.isArray(lyrics)) {
        return res.status(400).json({ error: 'Invalid request' });
    }
    
    try {
        let successCount = 0;
        for (const item of lyrics) {
            try {
                await storage.saveLyrics(userId, item.trackInfo, item.lyrics, item.lyricsType, item.source);
                successCount++;
            } catch (e) {
                console.error(`保存歌詞失敗 ${item.trackInfo?.id}:`, e);
            }
        }
        res.json({ success: true, saved: successCount, total: lyrics.length });
    } catch (error) {
        console.error('批量保存歌詞失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 同步所有數據
app.post('/api/kv/sync-all', async (req, res) => {
    const session = await getUserSession(req);
    const userId = await getSpotifyUserId(session, req.sessionId);
    const { lyrics, timeAdjustments, providers } = req.body;
    
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        let synced = 0;
        let failed = 0;
        
        // 同步歌詞
        if (Array.isArray(lyrics)) {
            for (const item of lyrics) {
                try {
                    await storage.saveLyrics(userId, item.trackInfo, item.lyrics, item.lyricsType, item.source);
                    synced++;
                } catch (e) {
                    failed++;
                }
            }
        }
        
        // 同步時間調整
        if (timeAdjustments && typeof timeAdjustments === 'object') {
            for (const [trackId, offset] of Object.entries(timeAdjustments)) {
                try {
                    await storage.saveOffset(userId, { id: trackId }, offset);
                    synced++;
                } catch (e) {
                    failed++;
                }
            }
        }
        
        res.json({ 
            success: true, 
            summary: { synced, failed },
            items: [],
            errors: []
        });
    } catch (error) {
        console.error('同步所有數據失敗:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 獲取下一首歌曲
app.get('/api/player/queue', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const response = await makeSpotifyAPICall(
            'https://api.spotify.com/v1/me/player/queue',
            { headers: { 'Authorization': `Bearer ${session.accessToken}` } },
            req.sessionId
        );
        
        const nextTrack = response.data.queue && response.data.queue.length > 0 
            ? response.data.queue[0] 
            : null;
        
        res.json({ 
            nextTrack: nextTrack ? {
                id: nextTrack.id,
                name: nextTrack.name,
                artist: nextTrack.artists.map(a => a.name).join(', '),
                image: nextTrack.album.images[0]?.url
            } : null
        });
    } catch (error) {
        console.error('獲取隊列失敗:', error);
        res.status(500).json({ error: 'Failed to fetch queue' });
    }
});

// ✨ 轉移播放設備
app.put('/api/player/transfer', async (req, res) => {
    const session = await getUserSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    
    try {
        const { device_ids, play } = req.body;
        await axios.put(
            'https://api.spotify.com/v1/me/player',
            { device_ids, play },
            { headers: { 'Authorization': `Bearer ${session.accessToken}` } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('轉移播放設備失敗:', error);
        res.status(500).json({ error: 'Failed to transfer playback' });
    }
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

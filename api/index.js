// api/index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const KVStorageManager = require('./kv-storage');

const app = express();
const kvStorage = new KVStorageManager();
const { Redis } = require('@upstash/redis');

// ✨ 新增：初始化 Redis 连接
const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
});

// ✨ 新增：测试 Redis 连接
async function initializeRedis() {
    try {
        await redis.set('test_connection', 'success');
        const value = await redis.get('test_connection');
        console.log('✅ Redis 连接成功，读写正常:', value);
        await redis.del('test_connection');
    } catch (error) {
        console.error('❌ Redis 连接失败:', error.message);
        console.error('请检查 .env 文件中的 KV_REST_API_URL 和 KV_REST_API_TOKEN');
    }
}

// Middleware
app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Session-Id', 'X-Spotify-User-Id']
}));
app.use(express.json());

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// Store user sessions (in production, use a proper database)
const userSessions = new Map();

// Generate a simple session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Get user session from request
function getUserSession(req) {
    const headerId = req.headers['x-session-id'] || req.query.sessionId;
    if (headerId) {
        return userSessions.get(headerId) || null;
    }
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(cookieHeader.split(';').map(v => {
        const idx = v.indexOf('=');
        if (idx === -1) return [v.trim(), ''];
        return [v.slice(0, idx).trim(), decodeURIComponent(v.slice(idx + 1))];
    }));
    const cookieId = cookies['spotify_session'];
    return cookieId ? userSessions.get(cookieId) || null : null;
}

// Spotify authorization URL with enhanced scopes
app.get('/api/auth', (req, res) => {
    const sessionId = generateSessionId();
    const scopes = [
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-private',
        'user-read-playback-position',
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
app.get('/api/callback', async (req, res) => {
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
        
        // 存储会话信息到内存中
        userSessions.set(sessionId, {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        });
        
        // 设置一个长时间的cookie来保持会话
        res.cookie('spotify_session', sessionId, {
            maxAge: 30 * 60 * 1000, // 30分钟
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        
        res.redirect(`/?auth=success&session=${sessionId}`);
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// 中间件：检查会话有效性
function checkSessionValidity(req, res, next) {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // 检查token是否即将过期（提前5分钟）
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (fiveMinutesFromNow >= session.expiresAt) {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Token 即將過期，主動刷新...`);
        // 不在这里刷新，而是在实际需要时刷新
    }
    
    next();
}

// Refresh access token
async function refreshAccessToken(session) {
    if (!session.refreshToken) {
        console.log('ℹ️ 沒有 refresh token，無法刷新');
        return false;
    }
    
    try {
        console.log('🔄 嘗試刷新 access token...');
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
        console.log('✅ Token refreshed');
        return true;
    } catch (error) {
        console.error('❌ Token 刷新失敗:', error.response?.data || error.message);
        return false;
    }
}

// Check authentication status
app.get('/api/auth-status', async (req, res) => {
    const session = getUserSession(req);
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    if (!session) {
        return res.json({ authenticated: false, sessionId: null });
    }
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (session.expiresAt <= fiveMinutesFromNow) {
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            return res.json({ authenticated: false, sessionId: sessionId, error: 'Token refresh failed' });
        }
    }
    res.json({ authenticated: true, sessionId: sessionId });
});

// Get currently playing track with enhanced information
app.get('/api/current-track', checkSessionValidity, async (req, res) => {
    const session = getUserSession(req);
    
    // Check if token needs refresh (提前 5 分鐘檢查)
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (fiveMinutesFromNow >= session.expiresAt) {
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 Current-track - Token 即將過期，主動刷新...`);
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Current-track - Token 刷新失敗，要求重新認證`);
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const [playerResponse, userResponse] = await Promise.all([
            axios.get('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }),
            axios.get('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            })
        ]);
        
        if (playerResponse.status === 204 || !playerResponse.data || !playerResponse.data.item) {
            return res.json({ isPlaying: false });
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
            user_id: user.id,
            device: device ? {
                id: device.id,
                name: device.name,
                type: device.type,
                volume: device.volume_percent
            } : null
        };
        
        res.json(currentTrack);
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        console.error('Error fetching current track:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch current track' });
    }
});

// Get available devices
app.get('/api/devices', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/devices', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        res.json({ devices: response.data.devices });
    } catch (error) {
        console.error('Error fetching devices:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch devices' });
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
            image: playlist.images && playlist.images.length > 0 ? playlist.images[0].url : null,
            tracks: playlist.tracks.total,
            owner: playlist.owner.display_name || playlist.owner.id
        }));
        
        res.json({ playlists });
    } catch (error) {
        console.error('Error fetching playlists:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch playlists' });
    }
});

// Get playlist items
app.get('/api/playlists/:playlistId', async (req, res) => {
    const session = getUserSession(req);
    const { playlistId } = req.params;
    
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const response = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const playlist = response.data;
        const tracks = playlist.tracks.items.map(item => ({
            ...item,
            // 确保每个曲目都有完整的信息
            track: {
                ...item.track,
                artists: item.track.artists || [],
                album: item.track.album || {},
                // 添加歌手和封面信息
                artist: item.track.artists?.map(a => a.name).join(', ') || '未知歌手',
                image: item.track.album?.images?.[0]?.url || null
            }
        }));
        
        res.json({
            id: playlist.id,
            name: playlist.name,
            description: playlist.description || '',
            owner: playlist.owner?.display_name || playlist.owner?.id || '未知',
            image: playlist.images && playlist.images.length > 0 ? playlist.images[0].url : null,
            total: playlist.tracks.total || 0,
            tracks: tracks
        });
    } catch (error) {
        console.error('Error fetching playlist items:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch playlist items' });
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
    
    const { volume } = req.body;
    
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
    
    try {
        const response = await axios.get(`https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const isLiked = response.data && response.data[0] === true;
        res.json({ isLiked });
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            try {
                const retry = await axios.get(`https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`, {
                    headers: { 'Authorization': `Bearer ${session.accessToken}` }
                });
                const isLiked = retry.data && retry.data[0] === true;
                return res.json({ isLiked });
            } catch (e) {
                return res.status(e.response?.status || 500).json({ 
                    error: 'Failed to check track status',
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

// Get user's queue
app.get('/api/player/queue', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/queue', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        // 格式化 queue 數據，確保前端能正確顯示
        if (response.data && response.data.queue) {
            const queue = response.data.queue.map(track => ({
                id: track.id,
                name: track.name,
                artists: track.artists || [],
                artist: track.artists?.map(a => a.name).join(', ') || '未知歌手',
                album: track.album || {},
                image: track.album?.images?.[0]?.url || null,
                duration_ms: track.duration_ms || 0
            }));
            const nextTrack = queue[0] || null;
            
            // 為下一首歌曲獲取歌詞預覽
            if (nextTrack) {
                try {
                    const lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(nextTrack.name)}/${encodeURIComponent(nextTrack.artist)}`;
                    const lyricsResponse = await axios.get(lyricsUrl, {
                        timeout: 5000,
                        headers: {
                            'User-Agent': 'Spotify-Lyrics-Player/1.0',
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (lyricsResponse.data && !lyricsResponse.headers['content-type']?.includes('text/html')) {
                        let lyricsPreview = '';
                        if (Array.isArray(lyricsResponse.data)) {
                            lyricsPreview = lyricsResponse.data.slice(0, 2).join(' / ');
                        } else if (typeof lyricsResponse.data === 'string') {
                            lyricsPreview = lyricsResponse.data.split('\n').slice(0, 2).join(' / ');
                        } else if (lyricsResponse.data.lyrics) {
                            if (Array.isArray(lyricsResponse.data.lyrics)) {
                                lyricsPreview = lyricsResponse.data.lyrics.slice(0, 2).map(line => 
                                    typeof line === 'string' ? line : line.text || ''
                                ).join(' / ');
                            } else if (typeof lyricsResponse.data.lyrics === 'string') {
                                lyricsPreview = lyricsResponse.data.lyrics.split('\n').slice(0, 2).join(' / ');
                            }
                        }
                        nextTrack.lyricsPreview = lyricsPreview;
                    }
                } catch (lyricsError) {
                    console.log('Failed to fetch lyrics preview for next track:', lyricsError.message);
                    nextTrack.lyricsPreview = null;
                }
            }
            
            res.json({ queue, nextTrack });
        } else {
            res.json({ queue: [], nextTrack: null });
        }
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            try {
                const retry = await axios.get('https://api.spotify.com/v1/me/player/queue', {
                    headers: { 'Authorization': `Bearer ${session.accessToken}` }
                });
                if (retry.data && retry.data.queue) {
                    const queue = retry.data.queue.map(track => ({
                        id: track.id,
                        name: track.name,
                        artists: track.artists || [],
                        artist: track.artists?.map(a => a.name).join(', ') || '未知歌手',
                        album: track.album || {},
                        image: track.album?.images?.[0]?.url || null,
                        duration_ms: track.duration_ms || 0
                    }));
                    const nextTrack = queue[0] || null;
                    return res.json({ queue, nextTrack });
                } else {
                    return res.json({ queue: [], nextTrack: null });
                }
            } catch (e) {
                return res.status(e.response?.status || 500).json({ 
                    error: 'Failed to get queue',
                    details: e.response?.data?.error?.message || e.message
                });
            }
        }
        
        console.error('Error getting queue:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to get queue',
            details: error.response?.data?.error?.message || error.message
        });
    }
});

// Play specific track
app.put('/api/player/play', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { uris, device_id } = req.body;
    
    try {
        const data = {};
        if (uris) data.uris = uris;
        if (device_id) data.device_id = device_id;
        
        await axios.put('https://api.spotify.com/v1/me/player/play', data, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error playing track:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: '播放失敗' });
    }
});

// Transfer playback to device
app.put('/api/player/transfer', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { device_ids, play } = req.body;
    
    try {
        await axios.put('https://api.spotify.com/v1/me/player', {
            device_ids,
            play: play !== false
        }, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        res.json({ success: true });
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error transferring playback:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to transfer playback',
            details: error.response?.data?.error?.message || error.message
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
        const colors = [
            { r: 29, g: 185, b: 84 },
            { r: 25, g: 20, b: 20 },
            { r: 255, g: 255, b: 255 },
            { r: 83, g: 83, b: 83 },
            { r: 30, g: 215, b: 96 }
        ];
        
        res.json({ colors });
    } catch (error) {
        console.error('Error extracting colors:', error);
        res.status(500).json({ error: 'Failed to extract colors' });
    }
});

// LRC 格式解析函數
function parseLrcFormat(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') {
        return { isLrc: false, lyrics: [] };
    }
    const lines = lrcText.split('\n');
    const lyrics = [];
    let hasTimeStamps = false;
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const timeMatch = trimmedLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
        if (timeMatch) {
            hasTimeStamps = true;
            const minutes = parseInt(timeMatch[1]);
            const seconds = parseInt(timeMatch[2]);
            const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
            const text = timeMatch[4].trim();
            const timeMs = (minutes * 60 + seconds) * 1000 + milliseconds;
            if (text) {
                lyrics.push({
                    time: timeMs,
                    text: text
                });
            }
        } else {
            if (!trimmedLine.startsWith('[') || !trimmedLine.includes(']')) {
                lyrics.push({
                    text: trimmedLine
                });
            }
        }
    }
    if (hasTimeStamps) {
        lyrics.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
    return {
        isLrc: hasTimeStamps,
        lyrics: lyrics
    };
}

// Search lyrics API endpoint
app.get('/api/search-lyrics/:query', async (req, res) => {
    const { query } = req.params;
    
    try {
        console.log(`🔍 歌詞搜尋請求: ${query}`);
        
        // 解析查詢字符串，嘗試提取歌手和歌曲名
        const parts = query.split(/[-–\s]+/);
        let artist = '', title = '';
        
        if (parts.length >= 2) {
            artist = parts[0].trim();
            title = parts.slice(1).join(' ').trim();
        } else {
            // 如果無法分離，就把整個查詢當作歌曲名
            title = query.trim();
        }
        
        console.log(`📝 解析結果 - 歌手: "${artist}", 歌曲: "${title}"`);
        
        // 構建搜尋URL
        const lyricsUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
        console.log(`📡 請求 URL: ${lyricsUrl}`);
        
        const response = await axios.get(lyricsUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Spotify-Lyrics-Player/1.0',
                'Accept': 'application/json'
            }
        });
        
        console.log(`📥 歌詞 API 回應狀態: ${response.status}`);
        console.log(`📥 歌詞 API 回應類型: ${response.headers['content-type']}`);
        
        // 檢查回應是否為HTML而不是JSON
        if (response.headers['content-type'] && response.headers['content-type'].includes('text/html')) {
            console.log('⚠️ API 返回 HTML 而非 JSON');
            return res.json({
                success: false,
                total: 0,
                results: [],
                error: '歌詞服務暫時無法使用，請稍後重試'
            });
        }
        
        if (response.data) {
            let lyrics = [];
            let lyricsType = 'plain';
            
            // 解析歌詞數據
            if (Array.isArray(response.data)) {
                const lrcResult = parseLrcFormat(response.data.join('\n'));
                if (lrcResult.isLrc) {
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else {
                    lyrics = response.data.filter(line => line && line.trim() !== '');
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
                        lyrics = response.data.lyrics.split('\n').filter(line => line && line.trim() !== '');
                    }
                }
            } else if (typeof response.data === 'string') {
                const lrcResult = parseLrcFormat(response.data);
                if (lrcResult.isLrc) {
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else {
                    lyrics = response.data.split('\n').filter(line => line && line.trim() !== '');
                }
            } else {
                // 尝试其他可能的结构
                if (response.data.syncedLyrics) {
                    const lrcResult = parseLrcFormat(response.data.syncedLyrics);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    }
                } else if (response.data.plainLyrics) {
                    lyrics = response.data.plainLyrics.split('\n').filter(line => line && line.trim() !== '');
                }
            }
            
            if (lyrics && lyrics.length > 0) {
                console.log(`✅ 搜尋成功: ${lyrics.length} 行歌詞`);
                res.json({
                    success: true,
                    total: 1,
                    results: [{
                        artist: artist || '未知歌手',
                        title: title || query,
                        lyrics: lyrics,
                        type: lyricsType,
                        source: 'wmcc'
                    }]
                });
            } else {
                console.log('ℹ️ 沒有找到歌詞內容');
                res.json({
                    success: false,
                    total: 0,
                    results: [],
                    error: '沒有找到歌詞'
                });
            }
        } else {
            console.log('ℹ️ API 返回空數據');
            res.json({
                success: false,
                total: 0,
                results: [],
                error: 'API 返回空數據'
            });
        }
    } catch (error) {
        console.error(`❌ 搜尋歌詞失敗: ${error.message}`);
        
        // 更好的錯誤處理
        let errorMessage = '搜尋失敗，請稍後重試';
        if (error.code === 'ENOTFOUND') {
            errorMessage = '無法連接到歌詞服務';
        } else if (error.code === 'ECONNRESET') {
            errorMessage = '連接被重置，請重試';
        } else if (error.message.includes('JSON')) {
            errorMessage = '歌詞服務回應格式錯誤';
        }
        
        res.json({
            success: false,
            total: 0,
            results: [],
            error: errorMessage
        });
    }
});

// Get lyrics with multiple providers support
app.get('/api/lyrics/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    const providersParam = req.query.p; // e.g. "lrclib", "netease", etc.

    try {
        console.log(`🎤 請求歌詞: ${artist} - ${title} (provider: ${providersParam || 'default'})`);

        // ======================
        // 情境一：自動載入（無 ?p=）
        // ======================
        if (!providersParam) {
            const apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
            console.log(`🔍 自動載入歌詞 URL: ${apiUrl}`);
            
            try {
                const response = await axios.get(apiUrl, { 
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Spotify-Lyrics-Player/1.0'
                    }
                });
                
                // 检查响应数据
                if (!response.data) {
                    throw new Error('API 返回空數據');
                }
                
                // 解析歌词数据
                let lyrics = [];
                let lyricsType = 'plain';
                
                if (Array.isArray(response.data)) {
                    const lrcResult = parseLrcFormat(response.data.join('\n'));
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.filter(line => line && line.trim() !== '');
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
                            lyrics = response.data.lyrics.split('\n').filter(line => line && line.trim() !== '');
                        }
                    }
                } else if (typeof response.data === 'string') {
                    const lrcResult = parseLrcFormat(response.data);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.split('\n').filter(line => line && line.trim() !== '');
                    }
                } else {
                    // 尝试其他可能的结构
                    if (response.data.syncedLyrics) {
                        const lrcResult = parseLrcFormat(response.data.syncedLyrics);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        }
                    } else if (response.data.plainLyrics) {
                        lyrics = response.data.plainLyrics.split('\n').filter(line => line && line.trim() !== '');
                    }
                }
                
                if (lyrics && lyrics.length > 0) {
                    console.log(`✅ 自動載入成功: ${lyrics.length} 行歌詞`);
                    return res.json({ 
                        success: true, 
                        lyrics, 
                        type: lyricsType,
                        source: 'wmcc'
                    });
                } else {
                    throw new Error('沒有找到歌詞');
                }
            } catch (apiError) {
                console.error('❌ 歌詞 API 請求失敗:', apiError.message);
                // 返回错误信息而不是抛出异常
                return res.status(200).json({
                    success: false,
                    error: apiError.message
                });
            }
        }

        // ======================
        // 情境二：用戶搜尋（有 ?p=）
        // ======================
        const results = [];
        const requestedProviders = Array.isArray(providersParam) ? providersParam : [providersParam];
        
        for (const provider of requestedProviders) {
            let pParam;
            switch (provider.toLowerCase()) {
                case 'musixmatch': pParam = 'Musixmatch'; break;
                case 'lrclib': pParam = 'Lrclib'; break;
                case 'netease': pParam = 'NetEase'; break;
                case 'kugou': pParam = 'Kugou'; break;
                default: continue;
            }

            const apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${pParam}`;
            console.log(`📡 查詢 ${provider}: ${apiUrl}`);

            try {
                const response = await axios.get(apiUrl, { 
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Spotify-Lyrics-Player/1.0'
                    }
                });
                
                // 解析歌詞數據
                let lyrics = [];
                let lyricsType = 'plain';
                
                if (Array.isArray(response.data)) {
                    const lrcResult = parseLrcFormat(response.data.join('\n'));
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.filter(line => line && line.trim() !== '');
                    }
                } else if (response.data && response.data.lyrics) {
                    if (Array.isArray(response.data.lyrics)) {
                        lyrics = response.data.lyrics;
                        lyricsType = response.data.type || 'plain';
                    } else if (typeof response.data.lyrics === 'string') {
                        const lrcResult = parseLrcFormat(response.data.lyrics);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        } else {
                            lyrics = response.data.lyrics.split('\n').filter(line => line && line.trim() !== '');
                        }
                    }
                } else if (typeof response.data === 'string') {
                    const lrcResult = parseLrcFormat(response.data);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.split('\n').filter(line => line && line.trim() !== '');
                    }
                }
                
                if (lyrics && lyrics.length > 0) {
                    console.log(`✅ ${provider} 搜尋成功: ${lyrics.length} 行歌詞`);
                    results.push({ 
                        provider: provider,
                        providerName: pParam,
                        lyrics: lyrics, 
                        type: lyricsType, 
                        artist: artist, 
                        title: title,
                        source: provider.toLowerCase()
                    });
                } else {
                    console.log(`ℹ️ ${provider} 未找到歌詞`);
                }
            } catch (error) {
                console.error(`❌ ${provider} 搜尋失敗:`, error.message);
                results.push({
                    provider: provider,
                    providerName: pParam,
                    error: error.message,
                    artist: artist,
                    title: title
                });
            }
        }

        return res.json({
            success: results.length > 0,
            results,
            total: results.length
        });

    } catch (error) {
        console.error('❌ 獲取歌詞失敗:', error.message);
        res.status(200).json({ success: false, error: '載入失敗: ' + error.message });
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

// 多供應商歌詞搜尋 API
app.get('/api/lyrics-search-multi/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    
    try {
        console.log(`🔍 多供應商搜尋: ${artist} - ${title}`);
        
        const providers = ['Musixmatch', 'Lrclib', 'NetEase', 'Kugou'];
        const results = [];
        
        // 並行請求所有供應商
        const promises = providers.map(async (provider) => {
            const apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}`;
            console.log(`📡 請求 ${provider}: ${apiUrl}`);
            
            try {
                const response = await axios.get(apiUrl, { 
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Spotify-Lyrics-Player/1.0',
                        'Accept': 'application/json'
                    }
                });
                
                // 解析歌詞數據
                let lyrics = [];
                let lyricsType = 'plain';
                
                if (Array.isArray(response.data)) {
                    const lrcResult = parseLrcFormat(response.data.join('\n'));
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.filter(line => line && line.trim() !== '');
                    }
                } else if (response.data && response.data.lyrics) {
                    if (Array.isArray(response.data.lyrics)) {
                        lyrics = response.data.lyrics;
                        lyricsType = response.data.type || 'plain';
                    } else if (typeof response.data.lyrics === 'string') {
                        const lrcResult = parseLrcFormat(response.data.lyrics);
                        if (lrcResult.isLrc) {
                            lyrics = lrcResult.lyrics;
                            lyricsType = 'synced';
                        } else {
                            lyrics = response.data.lyrics.split('\n').filter(line => line && line.trim() !== '');
                        }
                    }
                } else if (typeof response.data === 'string') {
                    const lrcResult = parseLrcFormat(response.data);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.split('\n').filter(line => line && line.trim() !== '');
                    }
                }
                
                if (lyrics && lyrics.length > 0) {
                    console.log(`✅ ${provider} 成功: ${lyrics.length} 行`);
                    return {
                        provider: provider,
                        success: true,
                        lyrics: lyrics,
                        type: lyricsType,
                        artist: artist,
                        title: title,
                        lyricsPreview: lyrics.slice(0, 3).map(line => 
                            typeof line === 'string' ? line : line.text || ''
                        ).join(' / ')
                    };
                } else {
                    console.log(`ℹ️ ${provider} 無歌詞`);
                    return {
                        provider: provider,
                        success: false,
                        error: '未找到歌詞',
                        artist: artist,
                        title: title
                    };
                }
            } catch (error) {
                console.error(`❌ ${provider} 失敗:`, error.message);
                return {
                    provider: provider,
                    success: false,
                    error: error.message,
                    artist: artist,
                    title: title
                };
            }
        });
        
        const allResults = await Promise.allSettled(promises);
        
        // 處理結果
        allResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                results.push({
                    provider: providers[index],
                    success: false,
                    error: result.reason?.message || '請求失敗',
                    artist: artist,
                    title: title
                });
            }
        });
        
        const successfulResults = results.filter(r => r.success);
        
        res.json({
            success: true,
            results: results,
            total: results.length,
            found: successfulResults.length,
            artist: artist,
            title: title
        });
        
    } catch (error) {
        console.error('多供應商搜尋失敗:', error.message);
        res.json({
            success: false,
            error: error.message,
            results: [],
            total: 0
        });
    }
});

// 靜默刷新 token 端點（Vercel 版）
app.post('/api/refresh-token', async (req, res) => {
    try {
        const session = getUserSession(req);
        if (!session) {
            return res.status(401).json({ error: 'No session found' });
        }
        const refreshed = await refreshAccessToken(session);
        if (refreshed) {
            const sessionId = req.headers['x-session-id'] || req.query.sessionId;
            res.json({ 
                success: true, 
                sessionId: sessionId
            });
        } else {
            res.status(401).json({ error: 'Token refresh failed' });
        }
    } catch (err) {
        console.error('❌ Failed to refresh token:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Export for Vercel
// =================
// KV 存儲 API 端點
// =================

// ✨ 新增：保存用户自定义歌词到 KV
app.post('/api/kv/user-lyrics', async (req, res) => {
    try {
        const session = getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        const { trackInfo, lyrics, lyricsType, source } = req.body;
        
        if (!trackInfo || !lyrics) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少必要参数' 
            });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.status(503).json({
                success: false,
                error: 'KV 存储未配置'
            });
        }

        // ✨ 使用 Upstash Redis 保存
        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        const key = `lyrics:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
        const data = {
            trackInfo,
            lyrics,
            lyricsType,
            source,
            timestamp: Date.now(),
            lastModified: Date.now(),
            version: 2
        };

        await redis.set(key, JSON.stringify(data), {
            ex: 30 * 24 * 60 * 60  // 30天过期
        });

        console.log(`✅ 歌词已保存到 KV: ${key}`);

        res.json({
            success: true,
            message: '歌词已保存',
            data: { key }
        });
    } catch (error) {
        console.error('❌ 保存歌词失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// 2. 保存时间偏移（永不过期）
app.post('/api/kv/save-time-offset', async (req, res) => {
    try {
        const session = getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        const { trackInfo, timeOffset } = req.body;

        if (!trackInfo || timeOffset === undefined) {
            return res.status(400).json({
                success: false,
                error: '缺少必要参数'
            });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({ success: true, message: 'KV 不可用，使用本地存储' });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        const key = `offset:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
        const data = {
            trackInfo,
            timeOffset,
            timestamp: Date.now(),
            modifiedBy: 'user_adjustment'
        };

        await redis.set(key, JSON.stringify(data), {
            ex: 30 * 24 * 60 * 60  // 30天过期
        });

        console.log(`✅ 时间偏移已保存: ${key}`);

        res.json({
            success: true,
            message: '时间偏移已保存'
        });
    } catch (error) {
        console.error('❌ 保存时间偏移失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


app.get('/api/kv/user-lyrics/:trackKey', async (req, res) => {
    try {
        const { trackKey } = req.params;
        const trackInfo = req.headers['x-track-info'] ? 
            JSON.parse(req.headers['x-track-info']) : null;

        if (!trackInfo) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少歌曲信息' 
            });
        }

        const key = `lyrics:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
        const data = await redis.get(key);

        if (data) {
            console.log(`✅ 读取歌词: ${key}`);
            res.json({ 
                success: true, 
                data: JSON.parse(data),
                expiry: 'never'
            });
        } else {
            res.json({ 
                success: false, 
                message: '未找到歌词' 
            });
        }

    } catch (error) {
        console.error('❌ 获取歌词失败:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 获取歌词时间偏移
app.get('/api/kv/get-time-offset/:trackKey', async (req, res) => {
    try {
        const { trackKey } = req.params;
        const session = getUserSession(req);
        
        if (!session) {
            return res.json({ success: true, timeOffset: 0 });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({ success: true, timeOffset: 0 });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        const key = `offset:${trackKey}`;
        const data = await redis.get(key);

        if (data) {
            const offsetData = typeof data === 'string' ? JSON.parse(data) : data;
            return res.json({
                success: true,
                timeOffset: offsetData.timeOffset || 0
            });
        }

        res.json({ success: true, timeOffset: 0 });
    } catch (error) {
        console.error('❌ 获取时间偏移失败:', error.message);
        res.json({ success: true, timeOffset: 0 });
    }
});



// 刷新歌词过期时间
app.post('/api/kv/refresh-expiry/:trackKey', async (req, res) => {
    try {
        const { trackKey } = req.params;
        const trackInfo = req.headers['x-track-info'] ? 
            JSON.parse(req.headers['x-track-info']) : null;

        if (!trackInfo) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少歌曲信息' 
            });
        }

        const key = `lyrics:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
        
        // ✨ 刷新 30 天过期时间
        const expiresIn = 30 * 24 * 60 * 60;
        const refreshed = await redis.expire(key, expiresIn);

        if (refreshed) {
            res.json({ 
                success: true, 
                message: '过期时间已刷新'
            });
        } else {
            res.json({ 
                success: false, 
                message: '歌词不存在' 
            });
        }

    } catch (error) {
        console.error('刷新过期时间失败:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 清理过期歌词
app.post('/api/kv/cleanup-expired', async (req, res) => {
    try {
        // Redis 会自动清理过期数据，但你可以手动触发
        res.json({ 
            success: true, 
            message: '过期歌词自动清理已触发',
            deleted: 0 // Redis 自动处理
        });

    } catch (error) {
        console.error('清理过期歌词失败:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 导出所有歌词（备份用）
app.get('/api/kv/export-all-lyrics', async (req, res) => {
    try {
        // 注意：这个操作可能比较耗时
        const allLyrics = [];
        
        // 扫描所有 lyrics: 开头的 key
        let cursor = '0';
        const pattern = 'lyrics:*';

        do {
            const result = await redis.scan(cursor, { 
                match: pattern, 
                count: 100 
            });
            
            cursor = result[0];
            const keys = result[1];

            for (const key of keys) {
                const data = await redis.get(key);
                if (data) {
                    allLyrics.push(JSON.parse(data));
                }
            }
        } while (cursor !== '0');

        res.json({ 
            success: true, 
            totalLyrics: allLyrics.length,
            lyrics: allLyrics,
            exportedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('导出歌词失败:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 獲取用戶自定義歌詞
app.get('/api/kv/user-lyrics/:artist/:title', async (req, res) => {
    try {
        const { artist, title } = req.params;
        const { id } = req.query;
        
        const trackInfo = {
            id: id || '',
            artist: decodeURIComponent(artist),
            name: decodeURIComponent(title)
        };

        const userData = await kvStorage.getUserCustomLyrics(req, trackInfo);
        
        if (userData) {
            res.json({
                success: true,
                data: userData
            });
        } else {
            res.json({
                success: false,
                message: '未找到用戶自定義歌詞'
            });
        }
    } catch (error) {
        console.error('獲取用戶自定義歌詞失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 保存用戶歌詞供應商偏好
app.post('/api/kv/user-provider', async (req, res) => {
    try {
        const { trackInfo, provider } = req.body;
        
        if (!trackInfo || !provider) {
            return res.status(400).json({
                success: false,
                error: '缺少必要參數：trackInfo 和 provider'
            });
        }

        const success = await kvStorage.saveUserLyricsProvider(req, trackInfo, provider);
        
        res.json({
            success: true,
            message: '用戶供應商偏好已保存',
            data: { trackKey: kvStorage.generateTrackKey(trackInfo), provider }
        });
    } catch (error) {
        console.error('保存用戶供應商偏好失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 獲取用戶歌詞供應商偏好
app.get('/api/kv/user-provider/:artist/:title', async (req, res) => {
    try {
        const { artist, title } = req.params;
        const { id } = req.query;
        
        const trackInfo = {
            id: id || '',
            artist: decodeURIComponent(artist),
            name: decodeURIComponent(title)
        };

        const provider = await kvStorage.getUserLyricsProvider(req, trackInfo);
        
        if (provider) {
            res.json({
                success: true,
                data: { provider }
            });
        } else {
            res.json({
                success: false,
                message: '未找到用戶供應商偏好'
            });
        }
    } catch (error) {
        console.error('獲取用戶供應商偏好失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 獲取用戶所有自定義歌詞
app.get('/api/kv/user-lyrics', async (req, res) => {
    try {
        const session = getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({ success: true, data: [] });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        // 这里可以获取所有用户的歌词（需要扫描 key）
        // 简化版就直接返回空
        
        res.json({
            success: true,
            data: [],
            message: '获取用户歌词'
        });
    } catch (error) {
        console.error('❌ 获取歌词失败:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// 獲取用戶所有供應商偏好
app.get('/api/kv/user-providers', async (req, res) => {
    try {
        const providerPrefs = await kvStorage.getAllUserProviderPrefs(req);
        
        res.json({
            success: true,
            data: providerPrefs
        });
    } catch (error) {
        console.error('獲取用戶所有供應商偏好失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 刪除特定的用戶自定義歌詞
app.delete('/api/kv/user-lyrics/:trackKey', async (req, res) => {
    try {
        const { trackKey } = req.params;
        const trackInfo = req.headers['x-track-info'] ? 
            JSON.parse(req.headers['x-track-info']) : null;

        if (!trackInfo) {
            return res.status(400).json({ 
                success: false, 
                error: '缺少歌曲信息' 
            });
        }

        const key = `lyrics:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
        
        await redis.del(key);

        console.log(`🗑️ 已删除歌词: ${key}`);

        res.json({ 
            success: true, 
            message: '歌词已删除'
        });

    } catch (error) {
        console.error('❌ 删除歌词失败:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});


// 刪除特定的用戶供應商偏好
app.delete('/api/kv/user-provider/:trackKey', async (req, res) => {
    try {
        const { trackKey } = req.params;
        
        const success = await kvStorage.deleteUserLyricsProvider(req, trackKey);
        
        res.json({
            success: true,
            message: '用戶供應商偏好已刪除'
        });
    } catch (error) {
        console.error('刪除用戶供應商偏好失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 清除用戶所有數據
app.delete('/api/kv/user-data', async (req, res) => {
    try {
        const success = await kvStorage.clearAllUserData(req);
        
        res.json({
            success: true,
            message: '用戶所有數據已清除'
        });
    } catch (error) {
        console.error('清除用戶所有數據失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 數據遷移：從 localStorage 到 KV
app.post('/api/kv/migrate', async (req, res) => {
    try {
        const { localStorageData } = req.body;
        
        if (!localStorageData) {
            return res.status(400).json({
                success: false,
                error: '缺少 localStorageData 參數'
            });
        }

        const result = await kvStorage.migrateFromLocalStorage(req, localStorageData);
        
        res.json({
            success: true,
            message: '數據遷移完成',
            data: result
        });
    } catch (error) {
        console.error('數據遷移失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 檢查 KV 存儲狀態
// ✨ 新增：检查 KV 存储状态
app.get('/api/kv/status', async (req, res) => {
    try {
        const session = getUserSession(req);
        
        if (!session) {
            return res.json({
                success: true,
                kvAvailable: false,
                userKey: null,
                message: '未认证'
            });
        }
        
        // 检查 KV 环境变量
        const kvAvailable = !!process.env.KV_REST_API_URL && 
                           !!process.env.KV_REST_API_TOKEN;
        
        // 生成用户 key（简化版）
        const sessionId = req.headers['x-session-id'] || '';
        const userKey = sessionId ? `user:${sessionId}` : null;
        
        res.json({
            success: true,
            kvAvailable: kvAvailable,
            userKey: userKey,
            message: kvAvailable ? 'KV 存储可用' : 'KV 存储不可用'
        });
    } catch (error) {
        console.error('❌ KV 状态检查错误:', error.message);
        res.status(500).json({
            success: false,
            kvAvailable: false,
            error: error.message
        });
    }
});

app.post('/api/kv/sync-all', async (req, res) => {
    try {
        const session = getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未認證' });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({
                success: false,
                error: 'KV 存儲未配置',
                message: '請在環境變數中設置 KV_REST_API_URL 和 KV_REST_API_TOKEN'
            });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        const syncData = req.body || {};
        const results = {
            synced: 0,
            failed: 0,
            items: [],
            errors: []
        };

        // 1. 同步保存的歌詞
        if (syncData.savedLyrics && typeof syncData.savedLyrics === 'object') {
            for (const [key, value] of Object.entries(syncData.savedLyrics)) {
                try {
                    await redis.set(
                        `lyrics:${key}`,
                        JSON.stringify(value),
                        { ex: 30 * 24 * 60 * 60 } // 30天過期
                    );
                    results.synced++;
                    results.items.push({ type: 'lyrics', key: key, status: 'success' });
                } catch (error) {
                    results.failed++;
                    results.errors.push({ type: 'lyrics', key: key, error: error.message });
                }
            }
        }

        // 2. 同步時間調整
        if (syncData.timeAdjustments && typeof syncData.timeAdjustments === 'object') {
            for (const [key, value] of Object.entries(syncData.timeAdjustments)) {
                try {
                    await redis.set(
                        `offset:${key}`,
                        JSON.stringify(value),
                        { ex: 30 * 24 * 60 * 60 } // 30天過期
                    );
                    results.synced++;
                    results.items.push({ type: 'offset', key: key, status: 'success' });
                } catch (error) {
                    results.failed++;
                    results.errors.push({ type: 'offset', key: key, error: error.message });
                }
            }
        }

        // 3. 同步播放器偏好設置
        if (syncData.playerPreferences) {
            try {
                await redis.set(
                    `user:${session.userId}:preferences`,
                    JSON.stringify(syncData.playerPreferences),
                    { ex: 90 * 24 * 60 * 60 } // 90天過期
                );
                results.synced++;
                results.items.push({ type: 'preferences', status: 'success' });
            } catch (error) {
                results.failed++;
                results.errors.push({ type: 'preferences', error: error.message });
            }
        }

        console.log(`✅ KV 同步完成: ${results.synced} 項成功，${results.failed} 項失敗`);

        res.json({
            success: results.failed === 0,
            summary: {
                synced: results.synced,
                failed: results.failed,
                total: results.synced + results.failed
            },
            items: results.items,
            errors: results.errors.length > 0 ? results.errors : undefined
        });

    } catch (error) {
        console.error('❌ KV 同步失敗:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/kv/sync-status', async (req, res) => {
    try {
        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({
                kvConfigured: false,
                message: 'KV 存儲未配置'
            });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        // 測試連接
        await redis.set('sync_test', 'ok');
        const testValue = await redis.get('sync_test');
        await redis.del('sync_test');

        res.json({
            kvConfigured: true,
            kvConnected: testValue === 'ok',
            message: 'KV 存儲已配置且可連接'
        });

    } catch (error) {
        res.json({
            kvConfigured: true,
            kvConnected: false,
            error: error.message,
            message: 'KV 連接失敗'
        });
    }
});

(async () => {
    try {
        await initializeRedis();
        console.log('✅ Redis 初始化完成');
    } catch (error) {
        console.error('❌ Redis 初始化失敗:', error);
        // 不要退出進程，允許應用繼續運行而不使用 KV 存儲
    }
})();
module.exports = app;

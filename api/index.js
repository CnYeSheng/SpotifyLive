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
async function getUserSession(req) {
    const headerId = req.headers['x-session-id'] || req.query.sessionId;
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
    
    // 優先檢查內存緩存 (效能優化)
    if (userSessions.has(sessionId)) {
        return userSessions.get(sessionId);
    }
    
    // 從 KV 存儲中恢復
    try {
        const session = await kvStorage.getSession(sessionId);
        if (session) {
            userSessions.set(sessionId, session);
            return session;
        }
    } catch (error) {
        console.error('從 KV 恢復 Session 失敗:', error.message);
    }
    
    return null;
}

// 保存會話
async function saveUserSession(sessionId, sessionData) {
    if (!sessionId || !sessionData) return;
    
    // 保存到內存
    userSessions.set(sessionId, sessionData);
    
    // 保存到 KV
    try {
        await kvStorage.saveSession(sessionId, sessionData);
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
        
        // 存储会话信息
        await saveUserSession(sessionId, {
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
async function checkSessionValidity(req, res, next) {
    const session = await getUserSession(req);
    if (!session) {
        console.log('❌ 會話檢查失敗：無會話');
        return res.status(401).json({ 
            error: 'Not authenticated',
            message: '請重新登錄 Spotify'
        });
    }
    
    // 检查token是否即将过期（提前5分钟）
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (fiveMinutesFromNow >= session.expiresAt) {
        console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Token 即將過期，標記需要刷新...`);
        req.needsTokenRefresh = true;
    }
    
    next();
}

// Refresh access token
async function refreshAccessToken(session, sessionId) {
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
                },
                timeout: 10000 // Add timeout
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
        
        console.log('✅ Token refreshed successfully');
        return true;
    } catch (error) {
        console.error('❌ Token 刷新失敗:', error.response?.data || error.message);
        if (error.response?.data?.error === 'invalid_grant') {
            console.log('🔄 Refresh token 已失效，需要重新認證');
        }
        return false;
    }
}

// Check authentication status
app.get('/api/auth-status', async (req, res) => {
    const session = await getUserSession(req);
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    if (!session) {
        return res.json({ authenticated: false, sessionId: null });
    }
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (session.expiresAt <= fiveMinutesFromNow) {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            return res.json({ authenticated: false, sessionId: sessionId, error: 'Token refresh failed' });
        }
    }
    res.json({ authenticated: true, sessionId: sessionId });
});

// Refresh token endpoint
app.post('/api/refresh-token', async (req, res) => {
    const session = await getUserSession(req);
    
    if (!session) {
        console.log('❌ 刷新Token失敗：無會話');
        return res.status(401).json({ 
            error: 'Not authenticated',
            message: '請重新登錄 Spotify'
        });
    }
    
    if (!session.refreshToken) {
        console.log('❌ 刷新Token失敗：無Refresh Token');
        return res.status(401).json({ 
            error: 'No refresh token',
            message: '請重新登錄 Spotify'
        });
    }
    
    try {
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (refreshed) {
            console.log('✅ Token 刷新成功');
            res.json({ 
                success: true, 
                message: 'Token refreshed successfully',
                expiresAt: session.expiresAt
            });
        } else {
            console.log('❌ Token 刷新失敗');
            res.status(401).json({ 
                error: 'Token refresh failed',
                message: '請重新登錄 Spotify'
            });
        }
    } catch (error) {
        console.error('❌ 刷新Token異常:', error.message);
        res.status(500).json({ 
            error: 'Internal error',
            message: '服務器內部錯誤'
        });
    }
});

// Get currently playing track with enhanced information
app.get('/api/current-track', checkSessionValidity, async (req, res) => {
    const session = await getUserSession(req);
    
    // Check if token needs refresh (提前 5 分鐘檢查)
    const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
    if (fiveMinutesFromNow >= session.expiresAt) {
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 Current-track - Token 即將過期，主動刷新...`);
        const refreshed = await refreshAccessToken(session, req.sessionId);
        if (!refreshed) {
            console.log(`[${new Date().toLocaleTimeString()}] ⚠️ Current-track - Token 刷新失敗，要求重新認證`);
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        // Check if we have a cached user profile (valid for 1 hour)
        let userProfilePromise;
        if (session.userProfile && (Date.now() - session.userProfile.timestamp < 3600000)) {
            userProfilePromise = Promise.resolve({ data: session.userProfile.data, status: 200 });
        } else {
            userProfilePromise = axios.get('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }).then(async response => {
                session.userProfile = {
                    data: response.data,
                    timestamp: Date.now()
                };
                await saveUserSession(req.sessionId, session);
                return response;
            });
        }

        // Check if we have a cached queue (valid for 30 seconds)
        let queuePromise;
        if (session.playerQueue && (Date.now() - session.playerQueue.timestamp < 30000)) {
            queuePromise = Promise.resolve({ data: session.playerQueue.data, status: 200 });
        } else {
            queuePromise = axios.get('https://api.spotify.com/v1/me/player/queue', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }).then(async response => {
                session.playerQueue = {
                    data: response.data,
                    timestamp: Date.now()
                };
                return response;
            }).catch(err => {
                console.log('⚠️ Queue API failed (non-critical):', err.message);
                return null;
            });
        }

        // 一次性獲取所有需要的數據，包括播放隊列
        const [playerResponse, userResponse, queueResponse] = await Promise.all([
            axios.get('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${session.accessToken}` }
            }),
            userProfilePromise,
            queuePromise
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
            // 包含隊列信息
            queue: queueResponse?.data?.queue?.slice(0, 10).map(qTrack => ({
                id: qTrack.id,
                name: qTrack.name,
                artist: qTrack.artists.map(a => a.name).join(', '),
                image: qTrack.album.images[0]?.url
            })) || [],
            nextTrack: queueResponse?.data?.queue?.[0] ? {
                id: queueResponse.data.queue[0].id,
                name: queueResponse.data.queue[0].name,
                artist: queueResponse.data.queue[0].artists.map(a => a.name).join(', ')
            } : null
        };
        
        res.json(currentTrack);
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
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
    const session = await getUserSession(req);
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
    const session = await getUserSession(req);
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
    const session = await getUserSession(req);
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
    const session = await getUserSession(req);
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
    
    try {
        const response = await axios.get(`https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`, {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const isLiked = response.data && response.data[0] === true;
        res.json({ isLiked });
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session, req.sessionId);
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
    const session = await getUserSession(req);
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
            const refreshed = await refreshAccessToken(session, req.sessionId);
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
    const session = await getUserSession(req);
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
    const session = await getUserSession(req);
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
            const refreshed = await refreshAccessToken(session, req.sessionId);
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
                    words: allWords
                });
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
        } else {
            // 無時間戳行
            const cleanText = trimmedLine.replace(/<[^>]*>/g, '').trim();
            if (cleanText && !trimmedLine.startsWith('[')) {
                lyrics.push({ text: cleanText });
            }
        }
    }
    
    if (hasTimeStamps) {
        lyrics.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
    return { isLrc: hasTimeStamps, lyrics: lyrics };
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
                    lyrics = response.data.filter(line => line && typeof line === 'string' && line.trim() !== '');
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
                        lyrics = response.data.lyrics.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
                    }
                }
            } else if (typeof response.data === 'string') {
                const lrcResult = parseLrcFormat(response.data);
                if (lrcResult.isLrc) {
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else {
                    lyrics = response.data.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
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
                    lyrics = response.data.plainLyrics.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
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
    const providersParam = req.query.p; // e.g. "lrclib", "netease", etc.
    
    // 清洗元數據
    const artist = cleanArtist(originalArtist);
    const title = cleanMetadata(originalTitle);

    try {
        console.log(`🎤 請求歌詞: ${artist} - ${title} (原始: ${originalArtist} - ${originalTitle}) (provider: ${providersParam || 'default'})`);

        // ======================
        // 情境一：自動載入（無 ?p=）
        // ======================
        if (!providersParam) {
            const providers = ['QQMusic', 'Kugou', 'NetEase', 'Lrclib', 'Musixmatch'];
            console.log(`🔍 自動並行載入歌詞: ${artist} - ${title}`);
            
            const searchPromises = providers.map(async (provider) => {
                try {
                    let apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}`;
                    
                    // 對支援逐字的供應商添加 wbw 參數
                    if (['NetEase', 'QQMusic', 'Kugou'].includes(provider)) {
                        apiUrl += '&wbw';
                    }
                    
                    const response = await axios.get(apiUrl, { 
                        timeout: 55000, // 給予各供應商充裕時間，但略低於全域 60s
                        headers: { 'User-Agent': 'Spotify-Lyrics-Player/1.0' }
                    });
                    
                    if (!response.data) return null;

                    let lyrics = [];
                    let lyricsType = 'plain';
                    
                    // 解析邏輯 (同前)
                    if (Array.isArray(response.data)) {
                        const lrcResult = parseLrcFormat(response.data.join('\n'));
                        lyrics = lrcResult.lyrics;
                        lyricsType = lrcResult.isLrc ? 'synced' : 'plain';
                    } else if (response.data.lyrics) {
                        if (Array.isArray(response.data.lyrics)) {
                            lyrics = response.data.lyrics;
                            lyricsType = response.data.type || 'plain';
                        } else if (typeof response.data.lyrics === 'string') {
                            const lrcResult = parseLrcFormat(response.data.lyrics);
                            lyrics = lrcResult.lyrics;
                            lyricsType = lrcResult.isLrc ? 'synced' : 'plain';
                        }
                    } else if (typeof response.data === 'string') {
                        const lrcResult = parseLrcFormat(response.data);
                        lyrics = lrcResult.lyrics;
                        lyricsType = lrcResult.isLrc ? 'synced' : 'plain';
                    }

                    if (lyrics && lyrics.length > 0) {
                        // 計算「品質分數」：逐字(3) > 同步(2) > 純文字(1)
                        let score = 1;
                        if (lyrics.some(line => line.words && line.words.length > 0)) {
                            score = 3;
                            lyricsType = 'synced'; // 標記為同步以便前端處理
                        } else if (lyricsType === 'synced') {
                            score = 2;
                        }

                        return {
                            provider,
                            lyrics,
                            type: lyricsType,
                            score,
                            source: provider.toLowerCase()
                        };
                    }
                } catch (err) {
                    return null;
                }
                return null;
            });

            // 等待所有請求，或至少等到超時
            const results = await Promise.allSettled(searchPromises);
            const validResults = results
                .filter(r => r.status === 'fulfilled' && r.value !== null)
                .map(r => r.value)
                .sort((a, b) => b.score - a.score); // 分數高的排前面

            if (validResults.length > 0) {
                const best = validResults[0];
                console.log(`✅ 自動載入成功：選用 ${best.provider} (品質分數: ${best.score})`);
                return res.json({ 
                    success: true, 
                    lyrics: best.lyrics, 
                    type: best.type, 
                    source: best.source
                });
            }

            console.log('ℹ️ 自動模式：所有來源均未找到歌詞');
            return res.status(200).json({
                success: false,
                error: '沒有找到歌詞'
            });
        }

        // ======================
        // 情境二：用戶搜尋（有 ?p=）
        // ======================
        const results = [];
        const requestedProviders = Array.isArray(providersParam) ? providersParam : [providersParam];
        const isWbw = req.query.wbw !== undefined;
        
        for (const provider of requestedProviders) {
            let pParam;
            switch (provider.toLowerCase()) {
                case 'musixmatch': pParam = 'Musixmatch'; break;
                case 'lrclib': pParam = 'Lrclib'; break;
                case 'netease': pParam = 'NetEase'; break;
                case 'qm':
                case 'qqmusic': pParam = 'QQMusic'; break;
                case 'kugou': pParam = 'Kugou'; break;
                default: continue;
            }

            let apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${pParam}`;
            
            // 只有指定提供商支持逐字歌詞
            if (isWbw && ['NetEase', 'QQMusic', 'Kugou'].includes(pParam)) {
                apiUrl += '&wbw';
            }
            
            console.log(`📡 查詢 ${provider}: ${apiUrl}`);

            try {
                const response = await axios.get(apiUrl, { 
                    timeout: 60000,
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
                        lyrics = response.data.filter(line => line && typeof line === 'string' && line.trim() !== '');
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
                            lyrics = response.data.lyrics.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
                        }
                    }
                } else if (typeof response.data === 'string') {
                    const lrcResult = parseLrcFormat(response.data);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
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
        
        let apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}`;
        
        // 只有指定提供商支持逐字歌詞
        if (isWbw && ['NetEase', 'QQMusic', 'Kugou'].includes(provider)) {
            apiUrl += '&wbw';
        }

        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const data = response.data;
        
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

// Alias route for LRC format as requested by user
app.get('/api/lyrics/lrc/:title/:artist', async (req, res) => {
    const { title, artist } = req.params;
    // 重定向或直接調用上面的處理邏輯 (反轉 artist/title)
    req.url = `/api/lyrics/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    req.params.artist = artist;
    req.params.title = title;
    return app._router.handle(req, res);
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
    const { artist: originalArtist, title: originalTitle } = req.params;
    
    // 清洗元數據
    const artist = cleanArtist(originalArtist);
    const title = cleanMetadata(originalTitle);
    
    try {
        console.log(`🔍 多供應商搜尋: ${artist} - ${title} (原始: ${originalArtist} - ${originalTitle})`);
        
        const providers = ['Musixmatch', 'Lrclib', 'NetEase', 'QQMusic', 'Kugou'];
        const isWbw = req.query.wbw !== undefined;
        const results = [];
        
        // 並行請求所有供應商
        const promises = providers.map(async (provider) => {
            let apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${provider}&wbw`;
            
            console.log(`📡 請求 ${provider}: ${apiUrl}`);
            
            try {
                const response = await axios.get(apiUrl, { 
                    timeout: 60000,
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
                        lyrics = response.data.filter(line => line && typeof line === 'string' && line.trim() !== '');
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
                            lyrics = response.data.lyrics.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
                        }
                    }
                } else if (typeof response.data === 'string') {
                    const lrcResult = parseLrcFormat(response.data);
                    if (lrcResult.isLrc) {
                        lyrics = lrcResult.lyrics;
                        lyricsType = 'synced';
                    } else {
                        lyrics = response.data.split('\n').filter(line => line && typeof line === 'string' && line.trim() !== '');
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
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ error: 'No session found' });
        }
        const refreshed = await refreshAccessToken(session, req.sessionId);
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
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        const { trackInfo, lyrics, lyricsType, source, trackKey } = req.body;
        
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

        // ⚠️ 关键修正：优先使用客户端提供的标准化 trackKey
        // 如果没有提供 trackKey (旧版客户端)，则回退到 raw key 生成
        const keySuffix = trackKey || `${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
        const key = `lyrics:${keySuffix}`;
        
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


// ✨ 新增：批量同步歌词 (从客户端上传)
app.post('/api/kv/sync-lyrics', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        const { lyrics } = req.body;
        if (!lyrics || !Array.isArray(lyrics)) {
            return res.status(400).json({ success: false, error: '无效的数据格式' });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({ success: true, message: 'KV 不可用' });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        let savedCount = 0;
        const pipeline = redis.pipeline();

        for (const item of lyrics) {
            if (item.trackInfo && item.lyrics) {
                const key = `lyrics:${item.trackInfo.id}:${item.trackInfo.name}:${item.trackInfo.artist}`;
                const data = {
                    ...item,
                    timestamp: Date.now(),
                    lastModified: Date.now(),
                    syncedBy: session.id || 'user'
                };
                // 30天过期
                pipeline.set(key, JSON.stringify(data), { ex: 30 * 24 * 60 * 60 });
                savedCount++;
            }
        }

        if (savedCount > 0) {
            await pipeline.exec();
        }

        console.log(`✅ 批量同步歌词: ${savedCount} 首`);
        res.json({ success: true, count: savedCount });

    } catch (error) {
        console.error('❌ 同步歌词失败:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 新增：批量同步时间偏移 (从客户端上传)
app.post('/api/kv/sync-time-adjustments', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        const { adjustments } = req.body;
        if (!adjustments || !Array.isArray(adjustments)) {
            return res.status(400).json({ success: false, error: '无效的数据格式' });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            return res.json({ success: true, message: 'KV 不可用' });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        let savedCount = 0;
        const pipeline = redis.pipeline();

        for (const item of adjustments) {
            if (item.trackInfo && item.timeOffset !== undefined) {
                const key = `offset:${item.trackInfo.id}:${item.trackInfo.name}:${item.trackInfo.artist}`;
                const data = {
                    ...item,
                    timestamp: Date.now(),
                    syncedBy: session.id || 'user'
                };
                // 30天过期
                pipeline.set(key, JSON.stringify(data), { ex: 30 * 24 * 60 * 60 });
                savedCount++;
            }
        }

        if (savedCount > 0) {
            await pipeline.exec();
        }

        console.log(`✅ 批量同步时间偏移: ${savedCount} 个`);
        res.json({ success: true, count: savedCount });

    } catch (error) {
        console.error('❌ 同步时间偏移失败:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ✨ 新增：获取时间偏移列表 (目前返回空，因为数据是全局的)
app.get('/api/kv/time-adjustments', async (req, res) => {
    res.json({ success: true, data: [] });
});

// ✨ 新增：清除所有云端数据 (仅限当前用户的 session 数据)
app.delete('/api/kv/clear-all', async (req, res) => {
    try {
        const session = await getUserSession(req);
        if (!session) {
            return res.status(401).json({ success: false, error: '未认证' });
        }

        // 调用 kvStorage 的清理方法 (只清理 user:...)
        await kvStorage.clearAllUserData(req);
        
        console.log('🗑️ 用户请求清除云端数据 (User-scoped)');
        res.json({ success: true, message: '用户数据已清除' });

    } catch (error) {
        console.error('❌ 清除数据失败:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. 保存时间偏移（永不过期）
app.post('/api/kv/save-time-offset', async (req, res) => {
    try {
        const session = await getUserSession(req);
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
        // 從查詢參數中讀取 trackInfo，避免 headers 中文字符編碼問題
        let trackInfo = null;
        if (req.query.info) {
            try {
                trackInfo = JSON.parse(decodeURIComponent(req.query.info));
            } catch (e) {
                console.warn('查詢參數 trackInfo 解析失敗');
            }
        }
        // 回退到 headers（用於向後相容性）
        if (!trackInfo && req.headers['x-track-info']) {
            try {
                trackInfo = JSON.parse(req.headers['x-track-info']);
            } catch (e) {
                console.warn('Headers trackInfo 解析失敗');
            }
        }

        // 如果没有 trackInfo，我们仍然可以使用 trackKey 尝试获取
        // if (!trackInfo) { ... } // 移除强制检查，让 trackKey 单独也能工作

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
             return res.json({ success: false, message: 'KV 未配置' });
        }

        const { Redis } = require('@upstash/redis');
        const redis = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN
        });

        // ⚠️ 关键修正：直接使用客户端传来的 trackKey
        const key = `lyrics:${trackKey}`;
        const data = await redis.get(key);

        if (data) {
            console.log(`✅ 读取歌词: ${key}`);
            res.json({ 
                success: true, 
                data: typeof data === 'string' ? JSON.parse(data) : data,
                expiry: 'never'
            });
        } else {
            // 兼容性尝试：如果没有找到，尝试旧的 key 格式 (如果有 trackInfo)
            if (trackInfo) {
                const oldKey = `lyrics:${trackInfo.id}:${trackInfo.name}:${trackInfo.artist}`;
                const oldData = await redis.get(oldKey);
                if (oldData) {
                    console.log(`⚠️ 使用旧 Key 格式读取成功: ${oldKey}`);
                     res.json({ 
                        success: true, 
                        data: typeof oldData === 'string' ? JSON.parse(oldData) : oldData,
                        expiry: 'never'
                    });
                    return;
                }
            }

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
        const session = await getUserSession(req);
        
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



// 更新歌詞過期時間
app.post('/api/kv/refresh-expiry/:trackKey', async (req, res) => {
    try {
        const { trackKey } = req.params;
        // 從查詢參數或 body 中讀取 trackInfo，避免 headers 中文字符編碼問題
        let trackInfo = null;
        if (req.query.info) {
            try {
                trackInfo = JSON.parse(decodeURIComponent(req.query.info));
            } catch (e) {}
        }
        if (!trackInfo && req.body && req.body.trackInfo) {
            trackInfo = req.body.trackInfo;
        }
        if (!trackInfo && req.headers['x-track-info']) {
            try {
                trackInfo = JSON.parse(req.headers['x-track-info']);
            } catch (e) {}
        }

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
        const session = await getUserSession(req);
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
        // 從查詢參數或 body 中讀取 trackInfo，避免 headers 中文字符編碼問題
        let trackInfo = null;
        if (req.query.info) {
            try {
                trackInfo = JSON.parse(decodeURIComponent(req.query.info));
            } catch (e) {}
        }
        if (!trackInfo && req.body && req.body.trackInfo) {
            trackInfo = req.body.trackInfo;
        }
        if (!trackInfo && req.headers['x-track-info']) {
            try {
                trackInfo = JSON.parse(req.headers['x-track-info']);
            } catch (e) {}
        }

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
        const session = await getUserSession(req);
        
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
    console.log('🔄 收到 KV 同步請求');
    
    try {
        const session = await getUserSession(req);
        if (!session) {
            console.log('❌ 未認證');
            return res.status(401).json({ success: false, error: '未認證' });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            console.log('⚠️ KV 未配置');
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

        console.log('📦 開始同步數據...');

        // 1. 同步保存的歌詞
        if (syncData.savedLyrics && typeof syncData.savedLyrics === 'object') {
            console.log(`📝 同步 ${Object.keys(syncData.savedLyrics).length} 個保存的歌詞...`);
            for (const [key, value] of Object.entries(syncData.savedLyrics)) {
                try {
                    await redis.set(
                        `lyrics:${key}`,
                        JSON.stringify(value),
                        { ex: 30 * 24 * 60 * 60 }
                    );
                    results.synced++;
                    results.items.push({ type: 'lyrics', key: key, status: 'success' });
                } catch (error) {
                    console.error(`❌ 歌詞同步失敗 (${key}):`, error.message);
                    results.failed++;
                    results.errors.push({ type: 'lyrics', key: key, error: error.message });
                }
            }
        }

        // 2. 同步時間調整
        if (syncData.timeAdjustments && typeof syncData.timeAdjustments === 'object') {
            console.log(`⏰ 同步 ${Object.keys(syncData.timeAdjustments).length} 個時間調整...`);
            for (const [key, value] of Object.entries(syncData.timeAdjustments)) {
                try {
                    await redis.set(
                        `offset:${key}`,
                        JSON.stringify(value),
                        { ex: 30 * 24 * 60 * 60 }
                    );
                    results.synced++;
                    results.items.push({ type: 'offset', key: key, status: 'success' });
                } catch (error) {
                    console.error(`❌ 時間調整同步失敗 (${key}):`, error.message);
                    results.failed++;
                    results.errors.push({ type: 'offset', key: key, error: error.message });
                }
            }
        }

        // 3. 同步播放器偏好設置
        if (syncData.playerPreferences) {
            console.log('⚙️ 同步播放器偏好設置...');
            try {
                await redis.set(
                    `user:preferences`,
                    JSON.stringify(syncData.playerPreferences),
                    { ex: 90 * 24 * 60 * 60 }
                );
                results.synced++;
                results.items.push({ type: 'preferences', status: 'success' });
            } catch (error) {
                console.error('❌ 偏好設置同步失敗:', error.message);
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
        console.error('❌ KV 同步異常:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            type: 'exception'
        });
    }
});


// ============================================
// api/index.js 中新增的 KV 同步端點 (修復版)
// ============================================

// 一鍵同步所有本地數據到 KV
app.post('/api/kv/sync-all', async (req, res) => {
    console.log('🔄 收到 KV 同步請求');
    
    try {
        const session = await getUserSession(req);
        if (!session) {
            console.log('❌ 未認證');
            return res.status(401).json({ success: false, error: '未認證' });
        }

        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            console.log('⚠️ KV 未配置');
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

        console.log('📦 開始同步數據...');

        // 1. 同步保存的歌詞
        if (syncData.savedLyrics && typeof syncData.savedLyrics === 'object') {
            console.log(`📝 同步 ${Object.keys(syncData.savedLyrics).length} 個保存的歌詞...`);
            for (const [key, value] of Object.entries(syncData.savedLyrics)) {
                try {
                    await redis.set(
                        `lyrics:${key}`,
                        JSON.stringify(value),
                        { ex: 30 * 24 * 60 * 60 }
                    );
                    results.synced++;
                    results.items.push({ type: 'lyrics', key: key, status: 'success' });
                } catch (error) {
                    console.error(`❌ 歌詞同步失敗 (${key}):`, error.message);
                    results.failed++;
                    results.errors.push({ type: 'lyrics', key: key, error: error.message });
                }
            }
        }

        // 2. 同步時間調整
        if (syncData.timeAdjustments && typeof syncData.timeAdjustments === 'object') {
            console.log(`⏰ 同步 ${Object.keys(syncData.timeAdjustments).length} 個時間調整...`);
            for (const [key, value] of Object.entries(syncData.timeAdjustments)) {
                try {
                    await redis.set(
                        `offset:${key}`,
                        JSON.stringify(value),
                        { ex: 30 * 24 * 60 * 60 }
                    );
                    results.synced++;
                    results.items.push({ type: 'offset', key: key, status: 'success' });
                } catch (error) {
                    console.error(`❌ 時間調整同步失敗 (${key}):`, error.message);
                    results.failed++;
                    results.errors.push({ type: 'offset', key: key, error: error.message });
                }
            }
        }

        // 3. 同步播放器偏好設置
        if (syncData.playerPreferences) {
            console.log('⚙️ 同步播放器偏好設置...');
            try {
                await redis.set(
                    `user:preferences`,
                    JSON.stringify(syncData.playerPreferences),
                    { ex: 90 * 24 * 60 * 60 }
                );
                results.synced++;
                results.items.push({ type: 'preferences', status: 'success' });
            } catch (error) {
                console.error('❌ 偏好設置同步失敗:', error.message);
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
        console.error('❌ KV 同步異常:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            type: 'exception'
        });
    }
});

// 檢查 KV 同步狀態
app.get('/api/kv/sync-status', async (req, res) => {
    try {
        console.log('🔍 檢查 KV 狀態...');
        
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

        try {
            // 測試連接
            await redis.set('sync_test', 'ok');
            const testValue = await redis.get('sync_test');
            await redis.del('sync_test');

            console.log('✅ KV 連接成功');
            res.json({
                kvConfigured: true,
                kvConnected: testValue === 'ok',
                message: 'KV 存儲已配置且可連接'
            });
        } catch (testError) {
            console.error('❌ KV 測試失敗:', testError.message);
            res.json({
                kvConfigured: true,
                kvConnected: false,
                error: testError.message,
                message: 'KV 連接失敗'
            });
        }

    } catch (error) {
        console.error('❌ 檢查 KV 狀態異常:', error);
        res.status(500).json({
            kvConfigured: false,
            error: error.message
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
// =============================
// 增強歌詞緩存功能端點
// =============================
const enhancedLyricsEndpoints = require('./enhanced-lyrics-endpoints');

// 30天自動緩存
app.post('/api/kv/auto-cache', enhancedLyricsEndpoints.handleAutoCache);

// 獲取30天緩存歌詞
app.get('/api/kv/cache/:trackId/:trackName/:artist', enhancedLyricsEndpoints.getCachedLyrics);

// 永久保存歌詞 (本地+KV)
app.post('/api/kv/save-lyrics-permanent', enhancedLyricsEndpoints.savePermanentLyrics);

// 保存時間偏移 (增強版)
app.post('/api/kv/save-time-offset', enhancedLyricsEndpoints.saveTimeOffset);

// 獲取時間偏移
app.get('/api/kv/time-offset/:trackId/:trackName/:artist', enhancedLyricsEndpoints.getTimeOffset);

// 清理過期緩存
app.delete('/api/kv/cleanup-cache', enhancedLyricsEndpoints.cleanupExpiredCache);

// 獲取緩存統計
// 導出之前添加健康檢查端點
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

app.get('/api/kv/cache-stats', enhancedLyricsEndpoints.getCacheStats);

module.exports = app;

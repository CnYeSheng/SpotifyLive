const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();


// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// Store user sessions (in production, use a proper database)
// const userSessions = new Map();

// 引入 KV
const { kv } = require('@vercel/kv');

// 取代 userSessions = new Map()
// Get user session from request
function getUserSession(req) {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    return sessionId ? userSessions.get(sessionId) : null;
}

// 儲存 session
async function setSession(sessionId, session) {
  await kv.set(`session:${sessionId}`, JSON.stringify(session), {
    ex: 3600 // 1 小時過期
  });
}

// 在 /callback 中儲存
await setSession(sessionId, {
  accessToken: response.data.access_token,
  refreshToken: response.data.refresh_token,
  expiresAt: Date.now() + (response.data.expires_in * 1000)
});

// 在 refreshAccessToken 中更新
await setSession(sessionId, session);

// Generate a simple session ID
function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Spotify authorization URL with enhanced scopes
app.get('/api/auth', (req, res) => {
    const sessionId = generateSessionId();
    const scopes = [
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-private',  // 這個權限用於檢測會員狀態
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
    
    // Check if token needs refresh (提前 25 分鐘檢查)
    const twentyFiveMinutesFromNow = Date.now() + (25 * 60 * 1000);
    if (twentyFiveMinutesFromNow >= session.expiresAt) {
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 Current-track - Token 即將過期，主動刷新...`);
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log(`[${new Date().toLocaleTimeString()}] ❌ Current-track - Token 刷新失敗，要求重新認證`);
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

// Refresh access token
async function refreshAccessToken(session) {
    if (!session.refreshToken) {
        console.log('❌ 沒有 refresh token，無法刷新');
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
        console.error(`[${new Date().toLocaleTimeString()}] ❌ Token 刷新失敗:`, error.response?.data || error.message);
        // 如果 refresh token 也過期了，清除會話
        if (error.response?.status === 400) {
            console.log(`[${new Date().toLocaleTimeString()}] 🗑️ Refresh token 已過期，清除會話`);
            // 這裡可以添加清除會話的邏輯
        }
        return false;
    }
}

// Check authentication status
app.get('/api/auth-status', (req, res) => {
    const session = getUserSession(req);
    res.json({ 
        authenticated: !!session,
        sessionId: session ? req.headers['x-session-id'] || req.query.sessionId : null
    });
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
                'User-Agent': 'Spotify-Lyrics-Player/1.0'
            }
        });
        
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
                lyrics = response.data;
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
                console.log('❌ 沒有找到歌詞內容');
                res.json({
                    success: false,
                    total: 0,
                    results: [],
                    error: '沒有找到歌詞'
                });
            }
        } else {
            console.log('❌ API 返回空數據');
            res.json({
                success: false,
                total: 0,
                results: [],
                error: 'API 返回空數據'
            });
        }
    } catch (error) {
        console.error(`❌ 搜尋歌詞失敗: ${error.message}`);
        res.status(500).json({
            success: false,
            total: 0,
            results: [],
            error: error.message
        });
    }
});

// Get lyrics with multiple providers support
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
            const response = await axios.get(apiUrl, { timeout: 15000 });
            // ... (same as your existing parsing logic)
            return res.json({ success: true, lyrics, type: lyricsType, provider: 'default' });
        }

        // ======================
        // 情境二：用戶搜尋（有 ?p=）
        // ======================
        const results = [];
        const requestedProviders = providersParam.split(',').map(p => p.trim().toLowerCase());

        for (const provider of requestedProviders) {
            let pParam;
            switch (provider) {
                case 'musixmatch': pParam = 'Musixmatch'; break;
                case 'lrclib': pParam = 'Lrclib'; break;
                case 'netease': pParam = 'NetEase'; break;
                default: continue;
            }

            const apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}?p=${pParam}`;
            console.log(`📡 查詢 ${provider}: ${apiUrl}`);

            try {
                const response = await axios.get(apiUrl, { timeout: 15000 });
                // ... parse lyrics ...
                if (lyrics.length > 0) {
                    results.push({ provider, lyrics, type: lyricsType, artist, title });
                }
            } catch (error) {
                console.error(`❌ ${provider} 搜尋失敗:`, error.message);
            }
        }

        return res.json({
            success: true,
            results,
            total: results.length
        });
    } catch (error) {
        console.error('❌ 獲取歌詞失敗:', error.message);
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            res.json({ success: false, error: '歌詞服務暫時無法連接' });
        } else if (error.response?.status === 404) {
            res.json({ success: false, error: '找不到該歌曲的歌詞' });
        } else {
            res.json({ success: false, error: '載入歌詞失敗: ' + error.message });
        }
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
        
        // 檢查 LRC 時間戳格式 [mm:ss.xx] 或 [mm:ss]
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
            // 非時間戳行，可能是純文本歌詞或元數據
            if (!trimmedLine.startsWith('[') || !trimmedLine.includes(']')) {
                lyrics.push({
                    text: trimmedLine
                });
            }
        }
    }
    
    // 如果有時間戳，按時間排序
    if (hasTimeStamps) {
        lyrics.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
    
    return {
        isLrc: hasTimeStamps,
        lyrics: lyrics
    };
}

// Check if track is in user's library
app.get('/api/library/check/:trackId', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { trackId } = req.params;
    
    // Check if token needs refresh (提前 25 分鐘檢查)
    const twentyFiveMinutesFromNow = Date.now() + (25 * 60 * 1000);
    if (twentyFiveMinutesFromNow >= session.expiresAt) {
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 Library check - Token 即將過期，主動刷新...`);
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log(`[${new Date().toLocaleTimeString()}] ❌ Library check - Token 刷新失敗，要求重新認證`);
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
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

// ==============================
// 🎵 歌詞相關 API（解決問題 1 & 2）
// ==============================

// 搜尋歌詞
app.get('/api/search-lyrics/:query', async (req, res) => {
    const { query } = req.params;
    try {
        console.log(`🔍 搜尋歌詞: ${query}`);
        const apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(query)}`;
        const response = await axios.get(apiUrl, { timeout: 15000 });
        if (response.data) {
            let lyrics = [];
            let lyricsType = 'plain';
            if (Array.isArray(response.data)) {
                lyrics = response.data;
            } else if (typeof response.data === 'string') {
                const lrcResult = parseLrcFormat(response.data);
                if (lrcResult.isLrc) {
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else {
                    lyrics = response.data.split('\n').filter(line => line.trim() !== '');
                }
            } else if (response.data.lyrics) {
                lyrics = Array.isArray(response.data.lyrics) ? response.data.lyrics : [response.data.lyrics];
                lyricsType = response.data.type || 'plain';
            }
            if (lyrics.length > 0) {
                res.json({
                    success: true,
                    results: [{
                        artist: '未知歌手',
                        title: query,
                        lyrics,
                        type: lyricsType,
                        source: 'wmcc'
                    }],
                    total: 1
                });
            } else {
                res.json({ success: false, error: '無歌詞內容', results: [], total: 0 });
            }
        } else {
            res.json({ success: false, error: 'API 無回應', results: [], total: 0 });
        }
    } catch (error) {
        console.error('❌ 搜尋歌詞失敗:', error.message);
        res.status(500).json({ success: false, error: '搜尋失敗', results: [], total: 0 });
    }
});

// 獲取歌詞（自動載入用）
app.get('/api/lyrics/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    try {
        const apiUrl = `https://api.lyrics.wmcc.jp.eu.org/api/lyrics/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`;
        console.log(`🎤 請求歌詞: ${apiUrl}`);
        const response = await axios.get(apiUrl, { timeout: 15000 });
        if (response.data) {
            let lyrics = [];
            let lyricsType = 'plain';
            if (Array.isArray(response.data)) {
                lyrics = response.data;
            } else if (typeof response.data === 'string') {
                const lrcResult = parseLrcFormat(response.data);
                if (lrcResult.isLrc) {
                    lyrics = lrcResult.lyrics;
                    lyricsType = 'synced';
                } else {
                    lyrics = response.data.split('\n').filter(line => line.trim() !== '');
                }
            } else if (response.data.lyrics) {
                lyrics = Array.isArray(response.data.lyrics) ? response.data.lyrics : [response.data.lyrics];
                lyricsType = response.data.type || 'plain';
            }
            if (lyrics.length > 0) {
                res.json({ success: true, lyrics, type: lyricsType });
            } else {
                res.json({ success: false, error: '無歌詞內容' });
            }
        } else {
            res.json({ success: false, error: 'API 無回應' });
        }
    } catch (error) {
        console.error('❌ 獲取歌詞失敗:', error.message);
        res.status(500).json({ success: false, error: '載入失敗' });
    }
});

// LRC 解析函數（複製到 api/index.js）
function parseLrcFormat(lrcText) {
    if (!lrcText || typeof lrcText !== 'string') return { isLrc: false, lyrics: [] };
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
                lyrics.push({ time: timeMs, text });
            }
        } else {
            if (!trimmedLine.startsWith('[') || !trimmedLine.includes(']')) {
                lyrics.push({ text: trimmedLine });
            }
        }
    }
    if (hasTimeStamps) {
        lyrics.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
    return { isLrc: hasTimeStamps, lyrics };
}

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
            { r: 29, g: 185, b: 84 },   // Spotify green
            { r: 25, g: 20, b: 20 },    // Spotify black
            { r: 255, g: 255, b: 255 }, // White
            { r: 83, g: 83, b: 83 },    // Gray
            { r: 30, g: 215, b: 96 }    // Lighter Spotify green
        ];
        
        res.json({ colors });
    } catch (error) {
        console.error('Error extracting colors:', error);
        res.status(500).json({ error: 'Failed to extract colors' });
    }
});

// Get user's available devices
app.get('/api/devices', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Check if token needs refresh
    const tenMinutesFromNow = Date.now() + (10 * 60 * 1000);
    if (tenMinutesFromNow >= session.expiresAt) {
        console.log('🔄 Devices - Token 即將過期，主動刷新...');
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log('❌ Devices - Token 刷新失敗，要求重新認證');
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/devices', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
            if (!refreshed) {
                return res.status(401).json({ error: 'Token expired, please re-authenticate' });
            }
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error getting devices:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to get devices',
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
    
    // Check if token needs refresh
    const tenMinutesFromNow = Date.now() + (10 * 60 * 1000);
    if (tenMinutesFromNow >= session.expiresAt) {
        console.log('🔄 Queue - Token 即將過期，主動刷新...');
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log('❌ Queue - Token 刷新失敗，要求重新認證');
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/queue', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
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

// ==============================
// ▶️ 播放控制 API（解決問題 3）
// ==============================

// 播放指定歌曲
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
    
    // Check if token needs refresh
    const tenMinutesFromNow = Date.now() + (10 * 60 * 1000);
    if (tenMinutesFromNow >= session.expiresAt) {
        console.log('🔄 Transfer - Token 即將過期，主動刷新...');
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            console.log('❌ Transfer - Token 刷新失敗，要求重新認證');
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        await axios.put('https://api.spotify.com/v1/me/player', {
            device_ids,
            play: play || false
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
            // Retry the request
            return res.redirect(307, req.originalUrl);
        }
        
        console.error('Error transferring playback:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: 'Failed to transfer playback',
            details: error.response?.data?.error?.message || error.message
        });
    }

    // 靜默刷新 token（不推薦，但可臨時用）
    app.post('/api/refresh-token', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ success: false });
    }
    const refreshed = await refreshAccessToken(session);
    if (refreshed) {
        // 如果你用 KV，這裡要更新
        res.json({ success: true, sessionId: req.headers['x-session-id'] });
    } else {
        res.status(401).json({ success: false });
    }
    });
});

// Export for Vercel
module.exports = app;
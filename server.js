const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

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
app.get('/auth', (req, res) => {
    const sessionId = generateSessionId();
    const scopes = [
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-modify-playback-state',
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
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
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
    if (!session.refreshToken) return false;
    
    try {
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
        return true;
    } catch (error) {
        console.error('Error refreshing token:', error.response?.data || error.message);
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

// Get queue information
app.get('/api/player/queue', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/queue', {
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        });
        
        const queue = response.data.queue?.slice(0, 20).map(track => ({
            id: track.id,
            name: track.name,
            artist: track.artists.map(a => a.name).join(', '),
            image: track.album.images[0]?.url
        })) || [];
        
        const nextTrack = queue[0] || null;
        
        res.json({ queue, nextTrack });
    } catch (error) {
        console.error('Error fetching queue:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch queue' });
    }
});

// Get lyrics (enhanced with multiple sources and syncedlyrics support)
app.get('/api/lyrics/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    
    try {
        // Try multiple lyrics sources
        const sources = [
            () => getLyricsFromSyncedLyrics(artist, title),
            () => getLyricsFromOvh(artist, title)
        ];
        
        for (const getSource of sources) {
            try {
                const result = await getSource();
                if (result.success) {
                    return res.json(result);
                }
            } catch (error) {
                console.log(`Lyrics source failed: ${error.message}`);
                continue;
            }
        }
        
        res.json({ success: false, error: '找不到歌詞' });
    } catch (error) {
        console.error('Error fetching lyrics:', error);
        res.json({ success: false, error: '載入歌詞失敗' });
    }
});

// Lyrics source implementations
async function getLyricsFromSyncedLyrics(artist, title) {
    try {
        // 使用 syncedlyrics Python 包的 API (需要先安裝)
        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            const python = spawn('python', ['-c', `
import syncedlyrics
import json
import sys

try:
    lyrics = syncedlyrics.search("${artist.replace(/"/g, '\\"')} ${title.replace(/"/g, '\\"')}")
    if lyrics:
        # 解析同步歌詞
        lines = []
        for line in lyrics.split('\\n'):
            if line.strip():
                if line.startswith('[') and ']' in line:
                    # 時間戳格式: [mm:ss.xx]
                    time_end = line.find(']')
                    if time_end > 0:
                        time_str = line[1:time_end]
                        text = line[time_end+1:].strip()
                        if text:
                            try:
                                # 解析時間
                                if ':' in time_str:
                                    parts = time_str.split(':')
                                    minutes = int(parts[0])
                                    seconds = float(parts[1])
                                    time_ms = (minutes * 60 + seconds) * 1000
                                    lines.append({"time": int(time_ms), "text": text})
                                else:
                                    lines.append({"text": text})
                            except:
                                lines.append({"text": text})
                else:
                    lines.append({"text": line.strip()})
        
        print(json.dumps({"success": True, "lyrics": lines, "type": "synced", "source": "syncedlyrics"}))
    else:
        print(json.dumps({"success": False, "error": "找不到歌詞"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`]);
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code !== 0) {
                    return reject(new Error(`Python script exited with code ${code}: ${stderr}`));
                }
                
                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(result);
                } catch (parseError) {
                    reject(new Error(`Failed to parse Python output: ${parseError.message}`));
                }
            });
        });
    } catch (error) {
        console.error('Error in getLyricsFromSyncedLyrics:', error);
        throw error;
    }
}

async function getLyricsFromOvh(artist, title) {
    try {
        const response = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (response.data && response.data.lyrics) {
            // 將普通歌詞轉換為統一格式
            const lines = response.data.lyrics.split('\n')
                .filter(line => line.trim() !== '')
                .map(line => ({ text: line.trim() }));
            
            return {
                success: true,
                lyrics: lines,
                type: 'plain',
                source: 'lyrics.ovh'
            };
        } else {
            return { success: false, error: '找不到歌詞' };
        }
    } catch (error) {
        console.error('Error fetching lyrics from lyrics.ovh:', error.message);
        return { success: false, error: '獲取歌詞失敗' };
    }
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
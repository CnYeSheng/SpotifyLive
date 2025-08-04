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
app.get('/api/auth', (req, res) => {
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

// Enhanced player control
app.put('/api/player/:action', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { action } = req.params;
    const { device_id, volume_percent, state, trackId, uris, device_ids, play, isPlaying } = req.body;
    
    try {
        let url = `https://api.spotify.com/v1/me/player/${action}`;
        let method = 'PUT';
        let data = {};
        
        switch (action) {
            case 'play-pause':
                url = isPlaying ? 
                    'https://api.spotify.com/v1/me/player/pause' : 
                    'https://api.spotify.com/v1/me/player/play';
                if (device_id) data.device_ids = [device_id];
                if (uris) data.uris = uris;
                break;
            case 'play':
                url = 'https://api.spotify.com/v1/me/player/play';
                if (device_id) data.device_ids = [device_id];
                if (uris) data.uris = uris;
                break;
            case 'pause':
                url = 'https://api.spotify.com/v1/me/player/pause';
                break;
            case 'next':
                method = 'POST';
                break;
            case 'previous':
                method = 'POST';
                break;
            case 'volume':
                url = `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume_percent}`;
                if (device_id) url += `&device_id=${device_id}`;
                break;
            case 'shuffle':
                url = `https://api.spotify.com/v1/me/player/shuffle?state=${state}`;
                if (device_id) url += `&device_id=${device_id}`;
                break;
            case 'repeat':
                url = `https://api.spotify.com/v1/me/player/repeat?state=${state}`;
                if (device_id) url += `&device_id=${device_id}`;
                break;
            case 'transfer':
                url = 'https://api.spotify.com/v1/me/player';
                data = { device_ids, play: play || false };
                break;
            case 'save-track':
                url = `https://api.spotify.com/v1/me/tracks?ids=${trackId}`;
                method = 'PUT';
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
        
        const config = {
            method,
            url,
            headers: { 'Authorization': `Bearer ${session.accessToken}` }
        };
        
        if (Object.keys(data).length > 0) {
            config.data = data;
            config.headers['Content-Type'] = 'application/json';
        }
        
        await axios(config);
        res.json({ success: true });
    } catch (error) {
        console.error(`Error with ${action}:`, error.response?.data || error.message);
        res.status(500).json({ error: `Failed to ${action}` });
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
        
        result = {
            "success": True,
            "lyrics": lines,
            "type": "synced" if any("time" in line for line in lines) else "plain",
            "source": "syncedlyrics"
        }
        print(json.dumps(result))
    else:
        print(json.dumps({"success": False, "error": "No lyrics found"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
            `]);
            
            let output = '';
            let error = '';
            
            python.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                error += data.toString();
            });
            
            python.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        const result = JSON.parse(output.trim());
                        if (result.success) {
                            resolve(result);
                        } else {
                            reject(new Error(result.error || 'No lyrics found'));
                        }
                    } catch (e) {
                        reject(new Error('Failed to parse syncedlyrics output'));
                    }
                } else {
                    reject(new Error(`syncedlyrics failed: ${error || 'Unknown error'}`));
                }
            });
        });
    } catch (error) {
        throw new Error(`syncedlyrics error: ${error.message}`);
    }
}

async function getLyricsFromOvh(artist, title) {
    const response = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    
    if (response.data.lyrics) {
        const lines = response.data.lyrics.split('\n').filter(line => line.trim() !== '');
        return {
            success: true,
            lyrics: lines.map(text => ({ text })),
            type: 'plain',
            source: 'lyrics.ovh'
        };
    }
    
    throw new Error('No lyrics found');
}

// Color extraction endpoint
app.post('/api/extract-colors', async (req, res) => {
    const { imageUrl } = req.body;
    
    try {
        // Simple color extraction (in production, use a proper image processing library)
        const colors = [
            { r: 102, g: 126, b: 234 },
            { r: 118, g: 75, b: 162 },
            { r: 240, g: 147, b: 251 }
        ];
        
        res.json({ colors });
    } catch (error) {
        console.error('Error extracting colors:', error);
        res.status(500).json({ error: 'Failed to extract colors' });
    }
});

// Export for Vercel
module.exports = app;
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
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

// Spotify authorization URL
app.get('/auth', (req, res) => {
    const sessionId = generateSessionId();
    const scopes = 'user-read-currently-playing user-read-playback-state user-modify-playback-state user-read-playback-position';
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
        
        // Store tokens with session ID
        userSessions.set(sessionId, {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000)
        });
        
        res.redirect(`/?session=${sessionId}&auth=success`);
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
    }
});

// Get user session
function getUserSession(req) {
    const sessionId = req.query.session || req.headers['x-session-id'];
    return sessionId ? userSessions.get(sessionId) : null;
}

// Refresh access token
async function refreshAccessToken(sessionId, session) {
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
        session.expiresAt = Date.now() + (response.data.expires_in * 1000);
        if (response.data.refresh_token) {
            session.refreshToken = response.data.refresh_token;
        }
        
        userSessions.set(sessionId, session);
        return true;
    } catch (error) {
        console.error('Error refreshing token:', error.response?.data || error.message);
        return false;
    }
}

// Get currently playing track
app.get('/api/current-track', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Check if token needs refresh
    if (Date.now() >= session.expiresAt) {
        const sessionId = req.query.session || req.headers['x-session-id'];
        const refreshed = await refreshAccessToken(sessionId, session);
        if (!refreshed) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: {
                'Authorization': `Bearer ${session.accessToken}`
            }
        });
        
        if (response.status === 204 || !response.data || !response.data.item) {
            return res.json({ isPlaying: false });
        }
        
        const track = response.data.item;
        const device = response.data.device;
        
        const currentTrack = {
            isPlaying: response.data.is_playing,
            name: track.name,
            artist: track.artists.map(artist => artist.name).join(', '),
            album: track.album.name,
            image: track.album.images[0]?.url,
            duration: track.duration_ms,
            progress: response.data.progress_ms,
            id: track.id,
            device: device ? {
                id: device.id,
                name: device.name,
                type: device.type,
                volume: device.volume_percent
            } : null,
            // Calculate time remaining for next track preview
            timeRemaining: track.duration_ms - response.data.progress_ms
        };
        
        res.json(currentTrack);
    } catch (error) {
        if (error.response?.status === 401) {
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
        console.error('Error fetching current track:', error.response?.data || error.message);
        res.status(500).json({ error: { status: 500, message: 'Server error.' } });
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
            headers: {
                'Authorization': `Bearer ${session.accessToken}`
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching devices:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch devices' });
    }
});

// Playback control endpoints
app.post('/api/player/:action', async (req, res) => {
    const session = getUserSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { action } = req.params;
    const { device_id, volume_percent } = req.body;
    
    try {
        let url = `https://api.spotify.com/v1/me/player/${action}`;
        let method = 'PUT';
        let data = {};
        
        switch (action) {
            case 'play':
                method = 'PUT';
                if (device_id) data.device_ids = [device_id];
                break;
            case 'pause':
                method = 'PUT';
                break;
            case 'next':
                method = 'POST';
                break;
            case 'previous':
                method = 'POST';
                break;
            case 'volume':
                url = `https://api.spotify.com/v1/me/player/volume?volume_percent=${volume_percent}`;
                method = 'PUT';
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
        
        const response = await axios({
            method,
            url,
            headers: {
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            },
            data: Object.keys(data).length > 0 ? data : undefined
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error(`Error ${action}:`, error.response?.data || error.message);
        res.status(500).json({ error: `Failed to ${action}` });
    }
});

// Get lyrics using Python script
app.get('https://lyric.wmcc.jp.eu.org/api/lyrics/:artist/:title', async (req, res) => {
    const { artist, title } = req.params;
    
    try {
        console.log(`Fetching lyrics for: ${artist} - ${title}`);
        
        const pythonProcess = spawn('python', [
            path.join(__dirname, 'lyrics.py'),
            encodeURIComponent(artist),
            encodeURIComponent(title)
        ]);
        
        let output = '';
        let errorOutput = '';
        
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
            if (errorOutput) {
                console.log('Python stderr:', errorOutput);
            }
            
            try {
                const result = JSON.parse(output.trim());
                res.json(result);
            } catch (parseError) {
                console.error('Failed to parse Python output:', output);
                res.json({ success: false, error: 'Failed to parse lyrics' });
            }
        });
        
        pythonProcess.on('error', (error) => {
            console.error('Python process error:', error);
            res.json({ success: false, error: 'Python script failed' });
        });
        
    } catch (error) {
        console.error('Error fetching lyrics:', error);
        res.json({ success: false, error: 'Failed to fetch lyrics' });
    }
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
    const session = getUserSession(req);
    res.json({ 
        authenticated: !!session,
        sessionId: req.query.session || req.headers['x-session-id']
    });
});

// Start HTTP server (no certificates needed)
app.listen(PORT, () => {
    console.log(`🎵 Spotify 歌詞播放器已啟動！`);
    console.log(`🌐 HTTP 伺服器運行於: http://localhost:${PORT}`);
    console.log(`📱 請在瀏覽器中開啟: http://localhost:${PORT}`);
    console.log(`🔗 Spotify 回調: ${REDIRECT_URI}`);
    console.log(`👥 支援多用戶同時使用`);
    console.log(`🛑 按 Ctrl+C 停止伺服器`);
});
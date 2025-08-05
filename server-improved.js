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

// Get user session from request
function getUserSession(req) {
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    return sessionId ? userSessions.get(sessionId) : null;
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
        
        // Store user session
        userSessions.set(sessionId, {
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token,
            expiresAt: Date.now() + (response.data.expires_in * 1000),
            lastActivity: Date.now()
        });
        
        res.redirect(`/?sessionId=${sessionId}&auth=success`);
    } catch (error) {
        console.error('Error getting access token:', error.response?.data || error.message);
        res.status(500).send('Authentication failed');
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
        session.lastActivity = Date.now();
        
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
    
    // Check if token is expired
    if (Date.now() >= session.expiresAt) {
        const refreshed = await refreshAccessToken(session);
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
        
        session.lastActivity = Date.now();
        
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
                name: device.name,
                type: device.type,
                volume: device.volume_percent
            } : null,
            // Calculate time remaining for next track preview
            timeRemaining: track.duration_ms - response.data.progress_ms
        };
        
        res.json(currentTrack);
    } catch (error) {
        console.error('Error fetching current track:', error.response?.data || error.message);
        if (error.response?.status === 401) {
            const refreshed = await refreshAccessToken(session);
            if (refreshed) {
                return res.status(401).json({ error: 'Token refreshed, please retry' });
            }
            return res.status(401).json({ error: 'Token expired, please re-authenticate' });
        }
        res.status(500).json({ error: 'Server error.' });
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
        
        session.lastActivity = Date.now();
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching devices:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch devices' });
    }
});

// Player control actions
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
                if (device_id) data.device_ids = [device_id];
                break;
            case 'pause':
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
        
        const config = {
            method,
            url,
            headers: {
                'Authorization': `Bearer ${session.accessToken}`,
                'Content-Type': 'application/json'
            }
        };
        
        if (Object.keys(data).length > 0) {
            config.data = data;
        }
        
        await axios(config);
        session.lastActivity = Date.now();
        
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
        console.log(`🎤 請求歌詞: ${artist} - ${title}`);
        
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
            
            if (code !== 0) {
                console.error(`Python process exited with code ${code}`);
                return res.json({ success: false, error: '歌詞服務暫時不可用' });
            }
            
            try {
                const result = JSON.parse(output.trim());
                res.json(result);
            } catch (parseError) {
                console.error('Failed to parse Python output:', parseError);
                console.error('Raw output:', output);
                res.json({ success: false, error: '歌詞解析失敗' });
            }
        });
        
        pythonProcess.on('error', (error) => {
            console.error('Failed to start Python process:', error);
            res.json({ success: false, error: '歌詞服務啟動失敗' });
        });
        
    } catch (error) {
        console.error('Error in lyrics endpoint:', error);
        res.json({ success: false, error: '歌詞載入失敗' });
    }
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
    const session = getUserSession(req);
    res.json({ 
        authenticated: !!session,
        sessionId: session ? req.headers['x-session-id'] || req.query.sessionId : null
    });
});

// Clean up expired sessions periodically
setInterval(() => {
    const now = Date.now();
    const expiredSessions = [];
    
    for (const [sessionId, session] of userSessions.entries()) {
        // Remove sessions that are expired or inactive for more than 24 hours
        if (now >= session.expiresAt || (now - session.lastActivity) > 24 * 60 * 60 * 1000) {
            expiredSessions.push(sessionId);
        }
    }
    
    expiredSessions.forEach(sessionId => {
        userSessions.delete(sessionId);
        console.log(`Cleaned up expired session: ${sessionId}`);
    });
}, 60 * 60 * 1000); // Check every hour

// Start HTTP server (no certificates needed)
app.listen(PORT, () => {
    console.log(`🎵 Spotify 歌詞播放器已啟動！`);
    console.log(`🌐 HTTP 伺服器運行於: http://localhost:${PORT}`);
    console.log(`📱 請在瀏覽器中開啟: http://localhost:${PORT}`);
    console.log(`🔗 Spotify 回調: ${REDIRECT_URI}`);
    console.log(`👥 支援多用戶同時使用`);
    console.log(`🎮 支援播放控制: 播放/暫停、上一首/下一首、音量調整`);
    console.log(`🛑 按 Ctrl+C 停止伺服器`);
});
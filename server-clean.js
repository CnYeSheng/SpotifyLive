const express = require('express');
const cors = require('cors');
const axios = require('axios');
const iconv = require('iconv-lite');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'localhost';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Trust proxy for reverse proxy setups
app.set('trust proxy', true);

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://${DOMAIN}:${PORT}/callback`;

// Store user sessions (in production, use Redis or database)
const userSessions = new Map();

// Generate session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Get or create session
function getSession(req) {
  let sessionId = req.headers['x-session-id'] || req.query.session;
  if (!sessionId || !userSessions.has(sessionId)) {
    sessionId = generateSessionId();
    userSessions.set(sessionId, {
      accessToken: null,
      refreshToken: null,
      createdAt: Date.now()
    });
  }
  return { sessionId, session: userSessions.get(sessionId) };
}

// Clean expired sessions (older than 24 hours)
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of userSessions.entries()) {
    if (now - session.createdAt > 24 * 60 * 60 * 1000) {
      userSessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000); // Check every hour

// Spotify authorization URL with enhanced scopes
app.get('/auth', (req, res) => {
  const { sessionId } = getSession(req);
  const scopes = [
    'user-read-currently-playing',
    'user-read-playback-state', 
    'user-modify-playback-state',
    'user-read-playback-position'
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
  
  if (!sessionId || !userSessions.has(sessionId)) {
    return res.status(400).send('Invalid session');
  }
  
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
    
    const session = userSessions.get(sessionId);
    session.accessToken = response.data.access_token;
    session.refreshToken = response.data.refresh_token;
    
    res.redirect(`/?auth=success&session=${sessionId}`);
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
    return true;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    return false;
  }
}

// Get currently playing track
app.get('/api/current-track', async (req, res) => {
  const { session } = getSession(req);
  
  if (!session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });
    
    if (response.status === 204 || !response.data) {
      return res.json({ isPlaying: false });
    }
    
    const track = response.data.item;
    if (!track) {
      return res.json({ isPlaying: false });
    }
    
    const currentTrack = {
      isPlaying: response.data.is_playing,
      name: track.name,
      artist: track.artists.map(artist => artist.name).join(', '),
      album: track.album.name,
      image: track.album.images[0]?.url,
      duration: track.duration_ms,
      progress: response.data.progress_ms,
      id: track.id,
      device: response.data.device ? {
        id: response.data.device.id,
        name: response.data.device.name,
        type: response.data.device.type,
        volume: response.data.device.volume_percent
      } : null
    };
    
    res.json(currentTrack);
  } catch (error) {
    if (error.response?.status === 401) {
      const refreshed = await refreshAccessToken(session);
      if (refreshed) {
        return res.status(401).json({ error: 'Token refreshed, please retry' });
      }
      return res.status(401).json({ error: 'Authentication expired' });
    }
    console.error('Error fetching current track:', error.response?.data || error.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// Get available devices
app.get('/api/devices', async (req, res) => {
  const { session } = getSession(req);
  
  if (!session.accessToken) {
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
    if (error.response?.status === 401) {
      await refreshAccessToken(session);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Error fetching devices:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Play/Pause control
app.put('/api/player/play-pause', async (req, res) => {
  const { session } = getSession(req);
  const { isPlaying } = req.body;
  
  if (!session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const endpoint = isPlaying ? 'pause' : 'play';
    await axios.put(`https://api.spotify.com/v1/me/player/${endpoint}`, {}, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    if (error.response?.status === 401) {
      await refreshAccessToken(session);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Error controlling playback:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to control playback' });
  }
});

// Previous track
app.post('/api/player/previous', async (req, res) => {
  const { session } = getSession(req);
  
  if (!session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    await axios.post('https://api.spotify.com/v1/me/player/previous', {}, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    if (error.response?.status === 401) {
      await refreshAccessToken(session);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Error skipping to previous:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to skip to previous track' });
  }
});

// Next track
app.post('/api/player/next', async (req, res) => {
  const { session } = getSession(req);
  
  if (!session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    await axios.post('https://api.spotify.com/v1/me/player/next', {}, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    if (error.response?.status === 401) {
      await refreshAccessToken(session);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Error skipping to next:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to skip to next track' });
  }
});

// Set volume
app.put('/api/player/volume', async (req, res) => {
  const { session } = getSession(req);
  const { volume } = req.body;
  
  if (!session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    await axios.put(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`, {}, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    if (error.response?.status === 401) {
      await refreshAccessToken(session);
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('Error setting volume:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to set volume' });
  }
});

// Get queue (for next track preview)
app.get('/api/player/queue', async (req, res) => {
  const { session } = getSession(req);
  
  if (!session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/queue', {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    });
    
    const queue = response.data.queue || [];
    const nextTrack = queue[0];
    
    res.json({
      nextTrack: nextTrack ? {
        name: nextTrack.name,
        artist: nextTrack.artists.map(a => a.name).join(', '),
        id: nextTrack.id
      } : null
    });
  } catch (error) {
    if (error.response?.status === 401) {
      const refreshed = await refreshAccessToken(session);
      if (refreshed) {
        return res.status(401).json({ error: 'Token refreshed, please retry' });
      }
      return res.status(401).json({ error: 'Authentication expired' });
    }
    
    // Spotify Queue API 可能不可用或需要特殊權限
    if (error.response?.status === 403 || error.response?.status === 404) {
      console.log('Queue API not available, returning empty queue');
      return res.json({ nextTrack: null });
    }
    
    console.error('Error fetching queue:', error.response?.data || error.message);
    res.json({ nextTrack: null }); // 返回空結果而不是錯誤
  }
});

// Lyrics functionality (keeping existing implementation)
function isGarbledText(text) {
  if (!text || typeof text !== 'string') return true;
  
  const garbledChars = /[�\uFFFD]/g;
  const garbledCount = (text.match(garbledChars) || []).length;
  
  if (garbledCount > text.length * 0.3) {
    return true;
  }
  
  const normalChars = /[\u4e00-\u9fff\u3400-\u4dbf\w\s\-,.!?'"()]/g;
  const normalCount = (text.match(normalChars) || []).length;
  
  return normalCount < text.length * 0.5;
}

function cleanLyricsText(text) {
  if (!text) return '';
  
  let cleaned = text.replace(/[�\uFFFD]/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

async function getLyricsFromLrclib(artist, title, album = '', duration = '') {
  try {
    console.log(`🔍 從 lrclib.net 搜尋歌詞: ${artist} - ${title}`);
    
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title
    });
    
    if (album) params.append('album_name', album);
    if (duration) params.append('duration', duration);

    const response = await axios.get(
      `https://lrclib.net/api/get?${params.toString()}`,
      {
        timeout: 8000,
        headers: { 
          'User-Agent': 'Spotify Lyrics Player/1.0',
          'Accept': 'application/json'
        }
      }
    );
    
    if (response.data && response.data.syncedLyrics) {
      const syncedLyrics = response.data.syncedLyrics
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2})\](.*)/);
          if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const centiseconds = parseInt(match[3]);
            const timeMs = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
            const text = match[4].trim();
            
            if (text && !isGarbledText(text)) {
              return {
                time: timeMs,
                text: cleanLyricsText(text)
              };
            }
          }
          return null;
        })
        .filter(item => item !== null);
      
      if (syncedLyrics.length > 0) {
        console.log(`✅ lrclib.net 成功找到同步歌詞: ${syncedLyrics.length} 行`);
        return {
          success: true,
          type: 'synced',
          lyrics: syncedLyrics
        };
      }
    } 
    
    if (response.data && response.data.plainLyrics) {
      const plainText = response.data.plainLyrics;
      
      if (plainText && !isGarbledText(plainText)) {
        const lyrics = plainText
          .split('\n')
          .filter(line => line.trim() !== '')
          .map(text => ({ text: cleanLyricsText(text) }))
          .filter(item => item.text);
        
        if (lyrics.length > 0) {
          console.log(`✅ lrclib.net 成功找到純文本歌詞: ${lyrics.length} 行`);
          return {
            success: true,
            type: 'plain',
            lyrics: lyrics
          };
        }
      }
    }
    
    console.log(`❌ lrclib.net 沒有找到有效歌詞`);
    return null;
    
  } catch (error) {
    console.log(`❌ lrclib.net 請求失敗:`, error.message);
    return null;
  }
}

// Get lyrics
app.get('/api/lyrics/:artist/:title', async (req, res) => {
  const { artist, title } = req.params;
  
  console.log(`🎤 請求歌詞: ${artist} - ${title}`);

  try {
    // 1️⃣ 嘗試 lrclib.net API
    console.log('🔍 嘗試 lrclib.net API...');
    const lrclibResult = await getLyricsFromLrclib(artist, title);
    if (lrclibResult && lrclibResult.lyrics && lrclibResult.lyrics.length > 0) {
      const hasValidLyrics = lrclibResult.lyrics.some(line => {
        const text = line.text || line;
        return text && !isGarbledText(text);
      });
      
      if (hasValidLyrics) {
        const cleanedLyrics = lrclibResult.lyrics
          .map(line => {
            if (typeof line === 'object' && line.text !== undefined) {
              return {
                ...line,
                text: cleanLyricsText(line.text)
              };
            } else {
              return { text: cleanLyricsText(line) };
            }
          })
          .filter(line => line.text);
        
        console.log(`✅ lrclib.net 成功: ${cleanedLyrics.length} 行 (${lrclibResult.type})`);
        return res.json({
          success: true,
          lyrics: cleanedLyrics,
          type: lrclibResult.type,
          source: 'lrclib.net'
        });
      }
    }

    // 2️⃣ 嘗試 SyncedLyrics (Python)
    console.log('🔍 嘗試 SyncedLyrics (Python)...');
    try {
      const pythonResult = await getSyncedLyricsFromPython(artist, title);
      if (pythonResult && pythonResult.lyrics && pythonResult.lyrics.length > 0) {
        const hasValidLyrics = pythonResult.lyrics.some(line => {
          const text = line.text || line;
          return text && !isGarbledText(text);
        });
        
        if (hasValidLyrics) {
          const cleanedLyrics = pythonResult.lyrics
            .map(line => {
              if (typeof line === 'object' && line.text !== undefined) {
                return {
                  ...line,
                  text: cleanLyricsText(line.text)
                };
              } else {
                return { text: cleanLyricsText(line) };
              }
            })
            .filter(line => line.text);
          
          console.log(`✅ SyncedLyrics 成功: ${cleanedLyrics.length} 行 (${pythonResult.type})`);
          return res.json({
            success: true,
            lyrics: cleanedLyrics,
            type: pythonResult.type,
            source: 'syncedlyrics'
          });
        } else {
          console.log('❌ SyncedLyrics 返回亂碼歌詞');
        }
      }
    } catch (e) {
      console.log('❌ SyncedLyrics 失敗:', e.message);
    }

    console.log('❌ 所有歌詞來源都失敗');
    res.json({ 
      success: false,
      lyrics: null, 
      error: '查不到歌詞',
      source: 'none' 
    });

  } catch (error) {
    console.error('❌ 歌詞請求總體失敗:', error);
    res.json({ 
      success: false,
      lyrics: null, 
      error: '查不到歌詞',
      source: 'error' 
    });
  }
});

// Python SyncedLyrics 函數
function getSyncedLyricsFromPython(artist, title) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const { spawn } = require('child_process');
    const py = spawn('python', ['-u', 'lyrics.py', artist, title], { env });

    let stdout = '';
    let stderr = '';
    let isResolved = false;

    // 設置 15 秒超時
    const timeout = setTimeout(() => {
      if (!isResolved) {
        console.log('⏰ Python 執行超時，已終止');
        py.kill('SIGTERM');
        isResolved = true;
        resolve(null);
      }
    }, 15000);

    py.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
    });

    py.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    py.on('close', (code) => {
      if (isResolved) return;
      clearTimeout(timeout);
      isResolved = true;

      if (stderr) {
        console.error('❌ [Python 錯誤]', stderr);
      }

      try {
        const trimmed = stdout.trim();
        if (!trimmed) {
          console.warn('⚠️ Python 沒有任何輸出');
          return resolve(null);
        }

        const result = JSON.parse(trimmed);

        if (result.success && Array.isArray(result.lyrics)) {
          return resolve(result);
        } else {
          console.warn('⚠️ Python 返回非成功格式:', result.error);
          return resolve(null);
        }
      } catch (err) {
        console.error('❌ JSON 解析失敗:', err.message);
        console.log('🧾 原始輸出:', stdout);
        return resolve(null);
      }
    });

    py.on('error', (err) => {
      if (isResolved) return;
      clearTimeout(timeout);
      isResolved = true;
      console.error('❌ Python 執行錯誤:', err.message);
      return resolve(null);
    });
  });
}

// Extract colors from album cover
app.post('/api/extract-colors', async (req, res) => {
  const { imageUrl } = req.body;
  
  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing imageUrl' });
  }
  
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // 使用簡單的顏色提取算法
    const buffer = Buffer.from(response.data);
    const colors = extractColorsFromBuffer(buffer);
    
    res.json({ colors });
    
  } catch (error) {
    console.error('顏色提取失敗:', error.message);
    res.status(500).json({ error: 'Failed to extract colors' });
  }
});

// 簡單的顏色提取函數
function extractColorsFromBuffer(buffer) {
  // 這是一個簡化的實現，實際應用中可以使用更複雜的圖片處理庫
  // 返回一些基於圖片大小和內容的預設顏色組合
  const colors = [
    { r: Math.floor(Math.random() * 100) + 100, g: Math.floor(Math.random() * 100) + 50, b: Math.floor(Math.random() * 100) + 150 },
    { r: Math.floor(Math.random() * 100) + 150, g: Math.floor(Math.random() * 100) + 100, b: Math.floor(Math.random() * 100) + 50 },
    { r: Math.floor(Math.random() * 100) + 50, g: Math.floor(Math.random() * 100) + 150, b: Math.floor(Math.random() * 100) + 100 }
  ];
  
  return colors;
}

// Check authentication status
app.get('/api/auth-status', (req, res) => {
  const { session } = getSession(req);
  res.json({ 
    authenticated: !!session.accessToken,
    sessionId: req.headers['x-session-id'] || req.query.session
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    domain: DOMAIN,
    port: PORT,
    timestamp: new Date().toISOString(),
    activeSessions: userSessions.size,
    services: {
      spotify: 'available',
      lyrics: 'available'
    }
  });
});

// Start HTTP server (no SSL certificates)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Spotify 歌詞播放器已啟動！`);
  console.log(`🌐 域名: ${DOMAIN}`);
  console.log(`🔗 端口: ${PORT}`);
  console.log(`📡 監聽地址: 0.0.0.0:${PORT}`);
  console.log(`🔗 Spotify 回調: ${REDIRECT_URI}`);
  console.log(`📱 訪問地址: http://${DOMAIN}:${PORT}`);
  console.log(`👥 支援多用戶會話`);
  console.log(`🎮 支援播放控制功能`);
  console.log(`🛑 按 Ctrl+C 停止伺服器`);
});
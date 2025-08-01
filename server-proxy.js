const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'live.cyss.us.eu.org';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Trust proxy (重要：用於反向代理)
app.set('trust proxy', true);

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `https://${DOMAIN}/callback`;

// Store access tokens (in production, use a proper database)
let accessToken = null;
let refreshToken = null;

// Spotify authorization URL
app.get('/auth', (req, res) => {
  const scopes = 'user-read-currently-playing user-read-playback-state';
  const authUrl = `https://accounts.spotify.com/authorize?` +
    `response_type=code&` +
    `client_id=${CLIENT_ID}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  
  res.redirect(authUrl);
});

// Spotify callback
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  
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
    
    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    
    res.redirect('/?auth=success');
  } catch (error) {
    console.error('Error getting access token:', error.response?.data || error.message);
    res.status(500).send('Authentication failed');
  }
});

// Get currently playing track
app.get('/api/current-track', async (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (response.status === 204 || !response.data) {
      return res.json({ isPlaying: false });
    }
    
    const track = response.data.item;
    const currentTrack = {
      isPlaying: response.data.is_playing,
      name: track.name,
      artist: track.artists.map(artist => artist.name).join(', '),
      album: track.album.name,
      image: track.album.images[0]?.url,
      duration: track.duration_ms,
      progress: response.data.progress_ms,
      id: track.id
    };
    
    res.json(currentTrack);
  } catch (error) {
    if (error.response?.status === 401) {
      // Token expired, try to refresh
      await refreshAccessToken();
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }
    console.error('Error fetching current track:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch current track' });
  }
});

// Refresh access token
async function refreshAccessToken() {
  if (!refreshToken) return;
  
  try {
    const response = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    accessToken = response.data.access_token;
    if (response.data.refresh_token) {
      refreshToken = response.data.refresh_token;
    }
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
  }
}

// Get lyrics (using multiple lyrics API services)
app.get('/api/lyrics/:artist/:title', async (req, res) => {
  const { artist, title } = req.params;
  
  console.log(`🎤 請求歌詞: ${artist} - ${title}`);
  
  try {
    // 使用 lrclib.net API 獲取歌詞
    const lyrics = await getLyricsFromLrclib(artist, title);
    
    if (lyrics && lyrics.lyrics && lyrics.lyrics.length > 0) {
      console.log(`✅ 找到歌詞: ${lyrics.lyrics.length} 行 (${lyrics.type})`);
      res.json({ 
        lyrics: lyrics.lyrics,
        type: lyrics.type,
        source: 'lrclib.net',
        success: true 
      });
    } else {
      console.log(`❌ 未找到歌詞: ${artist} - ${title}`);
      res.json({ 
        lyrics: ['找不到歌詞'],
        error: 'No lyrics found',
        success: false 
      });
    }
  } catch (error) {
    console.error('❌ 歌詞服務錯誤:', error.message);
    res.json({ 
      lyrics: null,
      error: error.message,
      success: false 
    });
  }
});

// 使用 lrclib.net API 獲取歌詞
async function getLyricsFromLrclib(artist, title, album = '', duration = '') {
  try {
    console.log(`🔍 從 lrclib.net 搜尋歌詞: ${artist} - ${title}`);
    
    // 構建查詢參數
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title
    });
    
    if (album) {
      params.append('album_name', album);
    }
    
    if (duration) {
      params.append('duration', duration);
    }
    
    const response = await axios.get(`https://lrclib.net/api/get?${params.toString()}`, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Spotify Lyrics Player/1.0'
      }
    });
    
    if (response.data && response.data.syncedLyrics) {
      // 優先使用同步歌詞 (LRC 格式)
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
            return {
              time: timeMs,
              text: match[4].trim()
            };
          }
          return null;
        })
        .filter(item => item !== null);
      
      console.log(`✅ lrclib.net 成功找到同步歌詞: ${syncedLyrics.length} 行`);
      return {
        type: 'synced',
        lyrics: syncedLyrics
      };
    } else if (response.data && response.data.plainLyrics) {
      // 備用：使用純文本歌詞
      const lyrics = response.data.plainLyrics
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(text => ({ text }));
      
      console.log(`✅ lrclib.net 成功找到純文本歌詞: ${lyrics.length} 行`);
      return {
        type: 'plain',
        lyrics: lyrics
      };
    }
    
    console.log(`❌ lrclib.net 沒有找到歌詞`);
    return null;
    
  } catch (error) {
    console.log(`❌ lrclib.net 請求失敗:`, error.message);
    throw error;
  }
}

// 移除舊的歌詞來源 - 現在只使用 lrclib.net

// Check authentication status
app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!accessToken });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    domain: DOMAIN,
    port: PORT,
    timestamp: new Date().toISOString(),
    proxy: 'enabled',
    services: {
      spotify: !!accessToken ? 'connected' : 'disconnected',
      lyrics: 'available'
    },
    headers: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-forwarded-proto': req.headers['x-forwarded-proto'],
      'host': req.headers.host
    }
  });
});

// 測試歌詞服務端點
app.get('/api/test-lyrics', async (req, res) => {
  console.log('🧪 測試歌詞服務...');
  
  const testCases = [
    { artist: 'Ed Sheeran', title: 'Shape of You' },
    { artist: 'The Weeknd', title: 'Blinding Lights' },
    { artist: 'Test Artist', title: 'Test Song' }
  ];
  
  const results = [];
  
  for (const testCase of testCases) {
    try {
      const lyrics = await getLyricsFromLrclib(testCase.artist, testCase.title);
      results.push({
        artist: testCase.artist,
        title: testCase.title,
        success: !!(lyrics && lyrics.lyrics),
        lyricsCount: lyrics && lyrics.lyrics ? lyrics.lyrics.length : 0,
        type: lyrics ? lyrics.type : 'none',
        source: lyrics ? 'lrclib.net' : 'none'
      });
    } catch (error) {
      results.push({
        artist: testCase.artist,
        title: testCase.title,
        success: false,
        error: error.message,
        source: 'error'
      });
    }
  }
  
  // 測試 lrclib.net API 可用性
  let lrclibStatus = 'unknown';
  try {
    const testResponse = await axios.get('https://lrclib.net/api/get?artist_name=Test&track_name=Test', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Spotify Lyrics Player/1.0'
      }
    });
    lrclibStatus = 'available';
  } catch (error) {
    if (error.response?.status === 404) {
      lrclibStatus = 'available'; // 404 表示 API 可用但沒找到歌詞
    } else {
      lrclibStatus = 'unavailable';
    }
  }
  
  res.json({
    service: 'lyrics',
    status: 'tested',
    results: results,
    lrclib_status: lrclibStatus,
    timestamp: new Date().toISOString()
  });
});

// 啟動 HTTP 伺服器 (用於反向代理)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Spotify 歌詞播放器已啟動！`);
  console.log(`🌐 域名: ${DOMAIN}`);
  console.log(`🔗 內部端口: ${PORT}`);
  console.log(`📡 監聽地址: 0.0.0.0:${PORT}`);
  console.log(`🔗 Spotify 回調: ${REDIRECT_URI}`);
  console.log(`📱 外部訪問: https://${DOMAIN}`);
  console.log(`💡 請確保反向代理已設定: ${DOMAIN} -> 0.0.0.0:${PORT}`);
  console.log(`🛑 按 Ctrl+C 停止伺服器`);
});
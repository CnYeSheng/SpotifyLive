const express = require('express');
const cors = require('cors');
const axios = require('axios');
const iconv = require('iconv-lite');
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

// 檢查文本是否為亂碼
function isGarbledText(text) {
  if (!text || typeof text !== 'string') return true;
  
  // 檢查是否包含大量亂碼字符
  const garbledChars = /[�\uFFFD]/g;
  const garbledCount = (text.match(garbledChars) || []).length;
  
  // 如果亂碼字符超過文本長度的30%，視為亂碼
  if (garbledCount > text.length * 0.3) {
    return true;
  }
  
  // 檢查是否包含正常的中文、英文或數字字符
  const normalChars = /[\u4e00-\u9fff\u3400-\u4dbf\w\s\-,.!?'"()]/g;
  const normalCount = (text.match(normalChars) || []).length;
  
  // 如果正常字符少於50%，可能是亂碼
  return normalCount < text.length * 0.5;
}

// 清理和驗證歌詞文本
function cleanLyricsText(text) {
  if (!text) return '';
  
  // 移除常見的亂碼字符
  let cleaned = text.replace(/[�\uFFFD]/g, '');
  
  // 移除過多的空白字符
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

// Get lyrics (using multiple lyrics API services)
const { spawn } = require('child_process');

app.get('/api/lyrics/:artist/:title', async (req, res) => {
  const { artist, title } = req.params;
  
  console.log(`🎤 請求歌詞: ${artist} - ${title}`);

  try {
    // 1️⃣ 先走原本的 lyrics.ovh
    console.log('🔍 嘗試 lyrics.ovh API...');
    const ovhUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    
    try {
      const ovhRes = await axios.get(ovhUrl, { 
        timeout: 4000,
        headers: {
          'User-Agent': 'Spotify Lyrics Player/1.0'
        }
      });

      if (ovhRes.data.lyrics && !isGarbledText(ovhRes.data.lyrics)) {
        // 轉成前端吃的格式：每行文字
        const lines = ovhRes.data.lyrics
          .split('\n')
          .filter(l => l.trim() !== '')
          .map(text => ({ text: cleanLyricsText(text) }))
          .filter(item => item.text); // 過濾空行
        
        if (lines.length > 0) {
          console.log(`✅ lyrics.ovh 成功: ${lines.length} 行`);
          return res.json({ 
            success: true,
            lyrics: lines, 
            type: 'plain', 
            source: 'lyrics.ovh' 
          });
        }
      }
    } catch (e) {
      console.log('❌ lyrics.ovh 失敗:', e.message);
    }

    // 2️⃣ 嘗試 lrclib.net API
    console.log('🔍 嘗試 lrclib.net API...');
    try {
      const lrclibResult = await getLyricsFromLrclib(artist, title);
      if (lrclibResult && lrclibResult.lyrics && lrclibResult.lyrics.length > 0) {
        // 檢查歌詞是否為亂碼
        const hasValidLyrics = lrclibResult.lyrics.some(line => {
          const text = line.text || line;
          return text && !isGarbledText(text);
        });
        
        if (hasValidLyrics) {
          // 清理歌詞文本
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
            .filter(line => line.text); // 過濾空行
          
          console.log(`✅ lrclib.net 成功: ${cleanedLyrics.length} 行 (${lrclibResult.type})`);
          return res.json({
            success: true,
            lyrics: cleanedLyrics,
            type: lrclibResult.type,
            source: 'lrclib.net'
          });
        }
      }
    } catch (e) {
      console.log('❌ lrclib.net 失敗:', e.message);
    }

    // 3️⃣ 走 SyncedLyrics（Python）
    console.log('🔍 嘗試 SyncedLyrics (Python)...');
    try {
      const pythonResult = await getSyncedLyricsFromPython(artist, title);
      if (pythonResult && pythonResult.lyrics && pythonResult.lyrics.length > 0) {
        // 檢查歌詞是否為亂碼
        const hasValidLyrics = pythonResult.lyrics.some(line => {
          const text = line.text || line;
          return text && !isGarbledText(text);
        });
        
        if (hasValidLyrics) {
          // 清理歌詞文本
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
            .filter(line => line.text); // 過濾空行
          
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

    // 所有方法都失敗
    console.log('❌ 所有歌詞來源都失敗');
    res.json({ 
      success: false,
      lyrics: null, 
      error: '找不到歌詞或歌詞格式錯誤',
      source: 'none' 
    });

  } catch (error) {
    console.error('❌ 歌詞請求總體失敗:', error);
    res.json({ 
      success: false,
      lyrics: null, 
      error: '歌詞服務暫時不可用',
      source: 'error' 
    });
  }
});

// Python SyncedLyrics 函數
function getSyncedLyricsFromPython(artist, title) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const { spawn } = require('child_process');
    const py = spawn('python', ['-u', 'lyrics.py', artist, title]);

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => {
      stdout += data.toString('utf8'); // 保證以 UTF-8 解讀
    });

    py.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    py.on('close', (code) => {
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
      console.error('❌ Python 執行錯誤:', err.message);
      return resolve(null);
    });

    // 超時機制（10秒）
    setTimeout(() => {
      py.kill();
      console.warn('⚠️ Python 執行超時，已終止');
      resolve(null);
    }, 10000);
  });
}

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
            const text = match[4].trim();
            
            // 檢查文本是否有效
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
      // 備用：使用純文本歌詞
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
    { artist: '頑童MJ116', title: 'Here We Are' },
    { artist: 'Jay Chou', title: '青花瓷' }
  ];
  
  const results = [];
  
  for (const testCase of testCases) {
    try {
      const lrclibResult = await getLyricsFromLrclib(testCase.artist, testCase.title);
      results.push({
        artist: testCase.artist,
        title: testCase.title,
        success: !!(lrclibResult && lrclibResult.lyrics && lrclibResult.lyrics.length > 0),
        lyricsCount: lrclibResult && lrclibResult.lyrics ? lrclibResult.lyrics.length : 0,
        type: lrclibResult ? lrclibResult.type : 'none',
        source: lrclibResult ? 'lrclib.net' : 'none',
        hasGarbledText: lrclibResult && lrclibResult.lyrics ? 
          lrclibResult.lyrics.some(line => {
            const text = line.text || line;
            return isGarbledText(text);
          }) : false
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
    encoding_check: {
      garbled_detection: 'enabled',
      text_cleaning: 'enabled'
    },
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
  console.log(`🔧 新增功能: 亂碼檢測與文本清理`);
  console.log(`🛑 按 Ctrl+C 停止伺服器`);
});
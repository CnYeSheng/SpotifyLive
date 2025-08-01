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
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://localhost:3000/callback';

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
    
    res.redirect('/');
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

// Get lyrics (using a lyrics API service)
app.get('/api/lyrics/:artist/:title', async (req, res) => {
  const { artist, title } = req.params;
  
  try {
    // Using lyrics.ovh API as an example (free but basic)
    const response = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    
    if (response.data.lyrics) {
      // Simple lyrics parsing - split by lines
      const lines = response.data.lyrics.split('\n').filter(line => line.trim() !== '');
      res.json({ lyrics: lines });
    } else {
      res.json({ lyrics: null });
    }
  } catch (error) {
    console.error('Error fetching lyrics:', error.response?.data || error.message);
    res.json({ lyrics: null });
  }
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!accessToken });
});

// 創建自簽名證書的函數
function createSelfSignedCert() {
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  // 檢查證書是否已存在
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { keyPath, certPath };
  }

  // 創建證書目錄
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  // 生成自簽名證書的命令
  const { execSync } = require('child_process');
  
  try {
    console.log('正在生成自簽名 SSL 證書...');
    
    // 使用 OpenSSL 生成私鑰和證書
    execSync(`openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/C=TW/ST=Taiwan/L=Taipei/O=SpotifyLyricsPlayer/CN=localhost"`, {
      stdio: 'inherit'
    });
    
    console.log('SSL 證書生成成功！');
    return { keyPath, certPath };
  } catch (error) {
    console.warn('無法生成 SSL 證書，將使用預設證書');
    
    // 如果 OpenSSL 不可用，創建簡單的自簽名證書
    const forge = require('node-forge');
    const pki = forge.pki;
    
    // 生成密鑰對
    const keys = pki.rsa.generateKeyPair(2048);
    
    // 創建證書
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    
    const attrs = [{
      name: 'commonName',
      value: 'localhost'
    }, {
      name: 'countryName',
      value: 'TW'
    }, {
      shortName: 'ST',
      value: 'Taiwan'
    }, {
      name: 'localityName',
      value: 'Taipei'
    }, {
      name: 'organizationName',
      value: 'SpotifyLyricsPlayer'
    }];
    
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey);
    
    // 保存證書和私鑰
    const certPem = pki.certificateToPem(cert);
    const keyPem = pki.privateKeyToPem(keys.privateKey);
    
    fs.writeFileSync(certPath, certPem);
    fs.writeFileSync(keyPath, keyPem);
    
    console.log('使用 Node.js 生成的自簽名證書');
    return { keyPath, certPath };
  }
}

// 啟動 HTTPS 伺服器
function startServer() {
  try {
    const { keyPath, certPath } = createSelfSignedCert();
    
    const httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };

    const server = https.createServer(httpsOptions, app);
    
    server.listen(PORT, () => {
      console.log(`🎵 Spotify 歌詞播放器已啟動！`);
      console.log(`🔒 HTTPS 伺服器運行於: https://localhost:${PORT}`);
      console.log(`📱 請在瀏覽器中開啟: https://localhost:${PORT}`);
      console.log(`⚠️  首次訪問時，瀏覽器會警告證書不受信任，請點擊「繼續前往」`);
      console.log(`🛑 按 Ctrl+C 停止伺服器`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 已被使用，請嘗試其他端口`);
      } else {
        console.error('❌ 伺服器啟動失敗:', err.message);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ 無法啟動 HTTPS 伺服器:', error.message);
    console.log('💡 請確保已安裝必要的依賴或檢查證書配置');
    process.exit(1);
  }
}

startServer();
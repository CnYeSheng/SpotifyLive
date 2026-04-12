// config/app.js
// 應用程序配置中心

require('dotenv').config();

module.exports = {
    // 服務器配置
    server: {
        port: process.env.PORT || 3000,
        nodeEnv: process.env.NODE_ENV || 'development'
    },

    // Spotify API 配置
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/callback`
    },

    // 歌詞 API 配置
    lyrics: {
        apiUrl: process.env.LYRICS_API_URL || 'https://api.lyrics.wmcc.jp.eu.org'
    },

    // 速率限制配置
    rateLimit: {
        maxCallsPerMinute: 180,
        maxCallsPerSession: 300,
        windowMs: 60000
    },

    // 會話配置
    session: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        cleanupInterval: 5 * 60 * 1000,    // 5 minutes
        cookieName: 'spotify_session',
        cookieOptions: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax'
        }
    },

    // 緩存配置
    cache: {
        trackCacheTTL: 800, // ms
        userProfileTTL: 5 * 60 * 1000 // 5 minutes
    },

    // 日誌配置
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        sanitizeSensitiveData: true
    },

    // 安全配置
    security: {
        hideStackTraceInProduction: true,
        validateInput: true,
        corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true
    }
};

const fs = require('fs');
const path = require('path');

class EnhancedStorage {

    constructor() {

        this.redis = null;

        this.db = null;

        this.dbType = process.env.DB_TYPE || 'none'; // 'postgres', 'mysql', 'mongo', 'none'

        this.useRedis = process.env.USE_REDIS === 'true';

        this.initialized = false;

    }



    async init() {

        if (this.initialized) return;



        // Initialize Redis

        if (this.useRedis) {

            try {

                const Redis = require('redis');

                this.redis = Redis.createClient({

                    url: process.env.REDIS_URL || 'redis://localhost:6379'

                });

                this.redis.on('error', (err) => console.error('Redis Client Error', err));

                await this.redis.connect();

                console.log('✅ Redis connected');

            } catch (e) {

                console.error('❌ Failed to connect to Redis:', e.message);

                this.useRedis = false;

            }

        }



        // Initialize Database

        try {

            switch (this.dbType.toLowerCase()) {

                case 'postgres':

                case 'postgresql':

                    const { Pool } = require('pg');

                    this.db = new Pool({

                        connectionString: process.env.DATABASE_URL

                    });

                    // Create table if not exists
                    await this.db.query(`
                        CREATE TABLE IF NOT EXISTS song_settings (
                            id SERIAL PRIMARY KEY,
                            user_id TEXT NOT NULL,
                            track_id TEXT NOT NULL,
                            offset_ms INTEGER DEFAULT 0,
                            manual_lyrics_id TEXT,
                            manual_lyrics_source VARCHAR(50),
                            manual_lyrics_title TEXT,
                            manual_lyrics_artist TEXT,
                            lyrics_content TEXT,
                            meta_data TEXT,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    await this.db.query(`
                        CREATE TABLE IF NOT EXISTS listening_history (
                            id SERIAL PRIMARY KEY,
                            user_id TEXT NOT NULL,
                            track_id TEXT NOT NULL,
                            track_name TEXT,
                            artist_name TEXT,
                            album_name TEXT,
                            duration_ms INTEGER,
                            played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    // Create unique index using hash to avoid size limits
                    await this.db.query(`
                        CREATE UNIQUE INDEX IF NOT EXISTS song_settings_user_track_unique 
                        ON song_settings (MD5(user_id || '::' || track_id))
                    `);
                    // Create hash-based lookup index for queries (avoids size limits)
                    await this.db.query(`
                        CREATE INDEX IF NOT EXISTS song_settings_user_track_lookup_hash 
                        ON song_settings (MD5(user_id), MD5(track_id))
                    `);

                    await this.db.query(`
                        CREATE INDEX IF NOT EXISTS listening_history_user_played_at 
                        ON listening_history (user_id, played_at)
                    `);
                    console.log('✅ PostgreSQL connected');
                    break;

                    case 'mysql':
                    case 'mariadb':
                    const mysql = require('mysql2/promise');
                    this.db = await mysql.createPool(process.env.DATABASE_URL);
                    await this.db.execute(`
                        CREATE TABLE IF NOT EXISTS song_settings (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            user_id TEXT NOT NULL,
                            track_id TEXT NOT NULL,
                            offset_ms INTEGER DEFAULT 0,
                            manual_lyrics_id TEXT,
                            manual_lyrics_source VARCHAR(50),
                            manual_lyrics_title TEXT,
                            manual_lyrics_artist TEXT,
                            lyrics_content TEXT,
                            meta_data TEXT,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE KEY song_settings_user_track_unique (user_id(255), track_id(255)),
                            KEY song_settings_user_track_lookup (user_id(255), track_id(255))
                        )
                    `);
                    await this.db.execute(`
                        CREATE TABLE IF NOT EXISTS listening_history (
                            id INT AUTO_INCREMENT PRIMARY KEY,
                            user_id VARCHAR(255) NOT NULL,
                            track_id VARCHAR(255) NOT NULL,
                            track_name TEXT,
                            artist_name TEXT,
                            album_name TEXT,
                            duration_ms INT,
                            played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            INDEX (user_id),
                            INDEX (played_at)
                        )
                    `);
                    console.log('✅ MySQL/MariaDB connected');
                    break;

                    case 'mongo':
                    case 'mongodb':
                    const mongoose = require('mongoose');
                    await mongoose.connect(process.env.DATABASE_URL);
                    const schema = new mongoose.Schema({
                        userId: { type: String, required: true },
                        trackId: { type: String, required: true },
                        offset: { type: Number, default: 0 },
                        manualLyricsId: String,
                        manualLyricsSource: String,
                        manualLyricsTitle: String,
                        manualLyricsArtist: String,
                        lyricsContent: String, // JSON string or text
                        metaData: String,
                        updatedAt: { type: Date, default: Date.now }
                    });
                    schema.index({ userId: 1, trackId: 1 }, { unique: true });
                    this.db = mongoose.model('SongSetting', schema);

                    const historySchema = new mongoose.Schema({
                        userId: { type: String, required: true },
                        trackId: { type: String, required: true },
                        trackName: String,
                        artistName: String,
                        albumName: String,
                        durationMs: Number,
                        playedAt: { type: Date, default: Date.now }
                    });
                    historySchema.index({ userId: 1, playedAt: -1 });
                    this.historyModel = mongoose.model('ListeningHistory', historySchema);
                    console.log('✅ MongoDB connected');
                    break;


                

                default:

                    console.log('ℹ️ No persistent database configured (DB_TYPE not set or invalid)');

                    // Fallback to local file storage

                    this.dbType = 'json';

                    this.localFilePath = path.join(__dirname, '..', 'lyrics-storage.json');

                    try {

                        if (fs.existsSync(this.localFilePath)) {

                            const data = fs.readFileSync(this.localFilePath, 'utf8');

                            this.localData = JSON.parse(data);

                        } else {

                            this.localData = {};

                            fs.writeFileSync(this.localFilePath, JSON.stringify({}, null, 2));

                        }

                        console.log('✅ Local JSON storage initialized');

                    } catch (err) {

                        console.error('❌ Failed to init local JSON storage:', err);

                        this.localData = {};

                    }

            }

        } catch (e) {

            console.error(`❌ Failed to connect to ${this.dbType}:`, e.message);

            console.log('⚠️ Falling back to in-memory/file storage only');

            this.dbType = 'json';

            this.localFilePath = path.join(__dirname, '..', 'lyrics-storage.json');

            this.localData = {};

        }



        this.initialized = true;

    }



    // Key for Redis

    getCacheKey(userId, trackId) {

        return `user:${userId}:song:${trackId}:settings`;

    }



    async getSongSettings(userId, trackId) {

        if (!userId || !trackId) return null;



        // 1. Try Redis

        if (this.useRedis && this.redis) {

            try {

                const cached = await this.redis.get(this.getCacheKey(userId, trackId));

                if (cached) return JSON.parse(cached);

            } catch (e) {

                console.error('Redis read error:', e.message);

            }

        }



        // 2. Try DB

        let settings = null;

        try {

            if (this.dbType === 'postgres') {

                const res = await this.db.query('SELECT * FROM song_settings WHERE user_id = $1 AND track_id = $2', [userId, trackId]);

                if (res.rows.length > 0) {

                    const row = res.rows[0];

                    settings = {

                        offset: row.offset_ms,

                        manualLyrics: row.manual_lyrics_id ? {

                            id: row.manual_lyrics_id,

                            source: row.manual_lyrics_source,

                            title: row.manual_lyrics_title,

                            artist: row.manual_lyrics_artist

                        } : null,

                        lyricsContent: row.lyrics_content ? JSON.parse(row.lyrics_content) : null,

                        customLyricsMeta: row.meta_data ? JSON.parse(row.meta_data) : null,

                        updated_at: row.updated_at

                    };

                }

            } else if (this.dbType === 'mysql' || this.dbType === 'mariadb') {

                const [rows] = await this.db.execute('SELECT * FROM song_settings WHERE user_id = ? AND track_id = ?', [userId, trackId]);

                if (rows.length > 0) {

                    const row = rows[0];

                    settings = {

                        offset: row.offset_ms,

                        manualLyrics: row.manual_lyrics_id ? {

                            id: row.manual_lyrics_id,

                            source: row.manual_lyrics_source,

                            title: row.manual_lyrics_title,

                            artist: row.manual_lyrics_artist

                        } : null,

                        lyricsContent: row.lyrics_content ? JSON.parse(row.lyrics_content) : null,

                        customLyricsMeta: row.meta_data ? JSON.parse(row.meta_data) : null,

                        updated_at: row.updated_at

                    };

                }

            } else if (this.dbType === 'mongo') {

                const doc = await this.db.findOne({ userId, trackId });

                if (doc) {

                    settings = {

                        offset: doc.offset,

                        manualLyrics: doc.manualLyricsId ? {

                            id: doc.manualLyricsId,

                            source: doc.manualLyricsSource,

                            title: doc.manualLyricsTitle,

                            artist: doc.manualLyricsArtist

                        } : null,

                        lyricsContent: doc.lyricsContent ? JSON.parse(doc.lyricsContent) : null,

                        customLyricsMeta: doc.metaData ? JSON.parse(doc.metaData) : null,

                        updated_at: doc.updatedAt

                    };

                }

            } else if (this.dbType === 'json') {

                const userKey = `user_${userId}`;

                if (this.localData && this.localData[userKey] && this.localData[userKey][trackId]) {

                    settings = this.localData[userKey][trackId];

                }

            }

        } catch (e) {

            console.error('DB read error:', e.message);

        }



        // 3. Populate Redis if found in DB

        if (settings && this.useRedis && this.redis) {

            try {

                await this.redis.set(this.getCacheKey(userId, trackId), JSON.stringify(settings), {

                    EX: 60 * 60 * 24 * 7 // Cache for 7 days

                });

            } catch (e) {

                console.error('Redis write error:', e.message);

            }

        }



        return settings || { offset: 0, manualLyrics: null, lyricsContent: null };

    }



    async saveSongSettings(userId, trackId, settings) {

        if (!userId || !trackId) return;



        // Current settings to merge updates

        const current = await this.getSongSettings(userId, trackId);

        const updated = { ...current, ...settings, updated_at: new Date() };



        // 1. Write to Redis

        if (this.useRedis && this.redis) {

            try {

                await this.redis.set(this.getCacheKey(userId, trackId), JSON.stringify(updated), {

                    EX: 60 * 60 * 24 * 7

                });

            } catch (e) {

                console.error('Redis write error:', e.message);

            }

        }



        // 2. Write to DB

        try {

            const manualLyrics = updated.manualLyrics || {};

            const lyricsContentStr = updated.lyricsContent ? JSON.stringify(updated.lyricsContent) : null;

            const metaDataStr = updated.customLyricsMeta ? JSON.stringify(updated.customLyricsMeta) : null;



            if (this.dbType === 'postgres') {
                const lyricsContentStr = updated.lyricsContent ? JSON.stringify(updated.lyricsContent) : null;
                const metaDataStr = updated.customLyricsMeta ? JSON.stringify(updated.customLyricsMeta) : null;
                const manualLyrics = updated.manualLyrics || {};

                // Use ON CONFLICT for atomic upsert to avoid race conditions and duplicate key errors
                await this.db.query(`
                    INSERT INTO song_settings (
                        user_id, track_id, offset_ms, manual_lyrics_id, 
                        manual_lyrics_source, manual_lyrics_title, manual_lyrics_artist, 
                        lyrics_content, meta_data, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                    ON CONFLICT ((MD5(user_id || '::' || track_id))) DO UPDATE 
                    SET offset_ms = EXCLUDED.offset_ms,
                        manual_lyrics_id = EXCLUDED.manual_lyrics_id,
                        manual_lyrics_source = EXCLUDED.manual_lyrics_source,
                        manual_lyrics_title = EXCLUDED.manual_lyrics_title,
                        manual_lyrics_artist = EXCLUDED.manual_lyrics_artist,
                        lyrics_content = EXCLUDED.lyrics_content,
                        meta_data = EXCLUDED.meta_data,
                        updated_at = NOW()
                `, [
                    userId,
                    trackId,
                    updated.offset || 0,
                    manualLyrics.id || null,
                    manualLyrics.source || null,
                    manualLyrics.title || null,
                    manualLyrics.artist || null,
                    lyricsContentStr,
                    metaDataStr
                ]);
            } else if (this.dbType === 'mysql' || this.dbType === 'mariadb') {

                await this.db.execute(`

                    INSERT INTO song_settings (user_id, track_id, offset_ms, manual_lyrics_id, manual_lyrics_source, manual_lyrics_title, manual_lyrics_artist, lyrics_content, meta_data, updated_at)

                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())

                    ON DUPLICATE KEY UPDATE 

                        offset_ms = VALUES(offset_ms),

                        manual_lyrics_id = VALUES(manual_lyrics_id),

                        manual_lyrics_source = VALUES(manual_lyrics_source),

                        manual_lyrics_title = VALUES(manual_lyrics_title),

                        manual_lyrics_artist = VALUES(manual_lyrics_artist),

                        lyrics_content = VALUES(lyrics_content),

                        meta_data = VALUES(meta_data),

                        updated_at = NOW()

                `, [

                    userId,

                    trackId, 

                    updated.offset || 0, 

                    manualLyrics.id || null, 

                    manualLyrics.source || null,

                    manualLyrics.title || null,

                    manualLyrics.artist || null,

                    lyricsContentStr,

                    metaDataStr

                ]);

            } else if (this.dbType === 'mongo') {

                await this.db.findOneAndUpdate(

                    { userId, trackId },

                    {

                        userId,

                        trackId,

                        offset: updated.offset || 0,

                        manualLyricsId: manualLyrics.id || null,

                        manualLyricsSource: manualLyrics.source || null,

                        manualLyricsTitle: manualLyrics.title || null,

                        manualLyricsArtist: manualLyrics.artist || null,

                        lyricsContent: lyricsContentStr,

                        metaData: metaDataStr,

                        updatedAt: new Date()

                    },

                    { upsert: true, new: true }

                );

            } else if (this.dbType === 'json') {

                const userKey = `user_${userId}`;

                if (!this.localData) this.localData = {};

                if (!this.localData[userKey]) this.localData[userKey] = {};

                this.localData[userKey][trackId] = updated;

                // Async save to file

                fs.writeFile(this.localFilePath, JSON.stringify(this.localData, null, 2), (err) => {

                    if (err) console.error('❌ Failed to save to local JSON:', err);

                });

            }

        } catch (e) {

            console.error('DB write error:', e.message);

        }

    }



    async getAllLyrics(userId) {

        if (!userId) return [];

        let allData = [];

        try {

            if (this.dbType === 'postgres') {

                const res = await this.db.query('SELECT * FROM song_settings WHERE user_id = $1', [userId]);

                allData = res.rows.map(row => ({

                    trackId: row.track_id,

                    offset: row.offset_ms,

                    manualLyrics: row.manual_lyrics_id ? {

                        id: row.manual_lyrics_id,

                        source: row.manual_lyrics_source,

                        title: row.manual_lyrics_title,

                        artist: row.manual_lyrics_artist

                    } : null,

                    lyricsContent: row.lyrics_content ? JSON.parse(row.lyrics_content) : null,

                    customLyricsMeta: row.meta_data ? JSON.parse(row.meta_data) : null,

                    updatedAt: row.updated_at

                }));

            } else if (this.dbType === 'mysql' || this.dbType === 'mariadb') {

                const [rows] = await this.db.execute('SELECT * FROM song_settings WHERE user_id = ?', [userId]);

                allData = rows.map(row => ({

                    trackId: row.track_id,

                    offset: row.offset_ms,

                    manualLyrics: row.manual_lyrics_id ? {

                        id: row.manual_lyrics_id,

                        source: row.manual_lyrics_source,

                        title: row.manual_lyrics_title,

                        artist: row.manual_lyrics_artist

                    } : null,

                    lyricsContent: row.lyrics_content ? JSON.parse(row.lyrics_content) : null,

                    customLyricsMeta: row.meta_data ? JSON.parse(row.meta_data) : null,

                    updatedAt: row.updated_at

                }));

            } else if (this.dbType === 'mongo') {

                const docs = await this.db.find({ userId });

                allData = docs.map(doc => ({

                    trackId: doc.trackId,

                    offset: doc.offset,

                    manualLyrics: doc.manualLyricsId ? {

                        id: doc.manualLyricsId,

                        source: doc.manualLyricsSource,

                        title: doc.manualLyricsTitle,

                        artist: doc.manualLyricsArtist

                    } : null,

                    lyricsContent: doc.lyricsContent ? JSON.parse(doc.lyricsContent) : null,

                    customLyricsMeta: doc.metaData ? JSON.parse(doc.metaData) : null,

                    updatedAt: doc.updatedAt

                }));

            } else if (this.dbType === 'json') {

                const userKey = `user_${userId}`;

                if (this.localData && this.localData[userKey]) {

                    allData = Object.entries(this.localData[userKey]).map(([key, value]) => ({

                        trackId: key,

                        ...value

                    }));

                }

            }

        } catch (e) {

            console.error('Get all lyrics error:', e.message);

        }

        return allData;

    }

    async updateListeningHistoryDuration(userId, durationMs) {
        if (!userId || !durationMs) return;
        try {
            if (this.dbType === 'postgres') {
                await this.db.query(`
                    UPDATE listening_history 
                    SET duration_ms = $1 
                    WHERE id = (SELECT id FROM listening_history WHERE user_id = $2 ORDER BY played_at DESC LIMIT 1)
                `, [durationMs, userId]);
            } else if (this.dbType === 'mysql' || this.dbType === 'mariadb') {
                await this.db.execute(`
                    UPDATE listening_history 
                    SET duration_ms = ? 
                    WHERE user_id = ? 
                    ORDER BY played_at DESC LIMIT 1
                `, [durationMs, userId]);
            } else if (this.dbType === 'json') {
                const historyKey = `history_${userId}`;
                if (this.localData[historyKey] && this.localData[historyKey].length > 0) {
                    const lastIndex = this.localData[historyKey].length - 1;
                    this.localData[historyKey][lastIndex].durationMs = durationMs;
                    fs.writeFile(this.localFilePath, JSON.stringify(this.localData, null, 2), (err) => {
                        if (err) console.error('Update history JSON error:', err);
                    });
                }
            }
        } catch (e) {
            console.error('Update history duration error:', e.message);
        }
    }

    async saveListeningHistory(userId, historyData) {
        if (!userId || !historyData) return;
        try {
            if (this.dbType === 'postgres') {
                await this.db.query(`
                    INSERT INTO listening_history (user_id, track_id, track_name, artist_name, album_name, duration_ms, played_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    userId,
                    historyData.trackId,
                    historyData.trackName,
                    historyData.artistName,
                    historyData.albumName,
                    historyData.durationMs,
                    historyData.playedAt || new Date()
                ]);
            } else if (this.dbType === 'mysql' || this.dbType === 'mariadb') {
                await this.db.execute(`
                    INSERT INTO listening_history (user_id, track_id, track_name, artist_name, album_name, duration_ms, played_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    userId,
                    historyData.trackId,
                    historyData.trackName,
                    historyData.artistName,
                    historyData.albumName,
                    historyData.durationMs,
                    historyData.playedAt || new Date()
                ]);
            } else if (this.dbType === 'mongo') {
                await this.historyModel.create({
                    userId,
                    trackId: historyData.trackId,
                    trackName: historyData.trackName,
                    artistName: historyData.artistName,
                    albumName: historyData.albumName,
                    durationMs: historyData.durationMs,
                    playedAt: historyData.playedAt || new Date()
                });
            } else if (this.dbType === 'json') {
                const historyKey = `history_${userId}`;
                if (!this.localData[historyKey]) this.localData[historyKey] = [];
                this.localData[historyKey].push({
                    ...historyData,
                    playedAt: historyData.playedAt || new Date().toISOString()
                });
                // Keep only last 1000 items in JSON for performance
                if (this.localData[historyKey].length > 1000) {
                    this.localData[historyKey] = this.localData[historyKey].slice(-1000);
                }
                fs.writeFile(this.localFilePath, JSON.stringify(this.localData, null, 2), (err) => {
                    if (err) console.error('❌ Failed to save history to local JSON:', err);
                });
            }
        } catch (e) {
            console.error('Save history error:', e.message);
        }
    }

    async getListeningHistory(userId, days = 30, until = null) {
        if (!userId) return [];
        const since = new Date();
        if (days === 1) {
            since.setHours(0, 0, 0, 0);
        } else if (days === 2) {
            // Special case for "Yesterday"
            since.setDate(since.getDate() - 1);
            since.setHours(0, 0, 0, 0);
            if (!until) {
                until = new Date();
                until.setHours(0, 0, 0, 0);
            }
        } else {
            since.setDate(since.getDate() - days);
        }
        
        try {
            if (this.dbType === 'postgres') {
                let query = 'SELECT * FROM listening_history WHERE user_id = $1 AND played_at >= $2';
                const params = [userId, since];
                if (until) {
                    query += ' AND played_at < $3';
                    params.push(until);
                }
                query += ' ORDER BY played_at DESC';
                const res = await this.db.query(query, params);
                return res.rows.map(row => ({
                    trackId: row.track_id,
                    trackName: row.track_name,
                    artistName: row.artist_name,
                    albumName: row.album_name,
                    durationMs: row.duration_ms,
                    playedAt: row.played_at
                }));
            } else if (this.dbType === 'mysql' || this.dbType === 'mariadb') {
                let query = 'SELECT * FROM listening_history WHERE user_id = ? AND played_at >= ?';
                const params = [userId, since];
                if (until) {
                    query += ' AND played_at < ?';
                    params.push(until);
                }
                query += ' ORDER BY played_at DESC';
                const [rows] = await this.db.execute(query, params);
                return rows.map(row => ({
                    trackId: row.track_id,
                    trackName: row.track_name,
                    artistName: row.artist_name,
                    albumName: row.album_name,
                    durationMs: row.duration_ms,
                    playedAt: row.played_at
                }));
            } else if (this.dbType === 'mongo') {
                const query = {
                    userId,
                    playedAt: { $gte: since }
                };
                if (until) query.playedAt.$lt = until;
                const docs = await this.historyModel.find(query).sort({ playedAt: -1 });
                return docs.map(doc => ({
                    trackId: doc.trackId,
                    trackName: doc.trackName,
                    artistName: doc.artistName,
                    albumName: doc.albumName,
                    durationMs: doc.durationMs,
                    playedAt: doc.playedAt
                }));
            } else if (this.dbType === 'json') {
                const historyKey = `history_${userId}`;
                if (this.localData[historyKey]) {
                    return this.localData[historyKey]
                        .filter(item => {
                            const d = new Date(item.playedAt);
                            return d >= since && (!until || d < until);
                        })
                        .reverse();
                }
            }
        } catch (e) {
            console.error('Get history error:', e.message);
        }
        return [];
    }
}

module.exports = EnhancedStorage;

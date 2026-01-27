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
                            track_id VARCHAR(255) PRIMARY KEY,
                            offset INTEGER DEFAULT 0,
                            manual_lyrics_id VARCHAR(255),
                            manual_lyrics_source VARCHAR(50),
                            manual_lyrics_title VARCHAR(255),
                                                        manual_lyrics_artist VARCHAR(255),
                                                        lyrics_content TEXT,
                                                        meta_data TEXT,
                                                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                    )
                                                `);
                                                console.log('✅ PostgreSQL connected');
                                                break;
                            
                                            case 'mysql':
                                            case 'mariadb':
                                                const mysql = require('mysql2/promise');
                                                this.db = await mysql.createPool(process.env.DATABASE_URL);
                                                await this.db.execute(`
                                                    CREATE TABLE IF NOT EXISTS song_settings (
                                                        track_id VARCHAR(255) PRIMARY KEY,
                                                        offset_ms INTEGER DEFAULT 0,
                                                        manual_lyrics_id VARCHAR(255),
                                                        manual_lyrics_source VARCHAR(50),
                                                        manual_lyrics_title VARCHAR(255),
                                                        manual_lyrics_artist VARCHAR(255),
                                                        lyrics_content TEXT,
                                                        meta_data TEXT,
                                                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                                    )
                                                `);
                                                console.log('✅ MySQL/MariaDB connected');
                                                break;
                            
                                            case 'mongo':
                                            case 'mongodb':
                                                const mongoose = require('mongoose');
                                                await mongoose.connect(process.env.DATABASE_URL);
                                                const schema = new mongoose.Schema({
                                                    trackId: { type: String, required: true, unique: true },
                                                    offset: { type: Number, default: 0 },
                                                    manualLyricsId: String,
                                                    manualLyricsSource: String,
                                                    manualLyricsTitle: String,
                                                    manualLyricsArtist: String,
                                                    lyricsContent: String, // JSON string or text
                                                    metaData: String,
                                                    updatedAt: { type: Date, default: Date.now }
                                                });
                                                this.db = mongoose.model('SongSetting', schema);
                                                console.log('✅ MongoDB connected');
                                                break;
                                            
                                            default:
                                                console.log('ℹ️ No persistent database configured (DB_TYPE not set or invalid)');
                                        }
                                    } catch (e) {
                                        console.error(`❌ Failed to connect to ${this.dbType}:`, e.message);
                                        console.log('⚠️ Falling back to in-memory/file storage only');
                                        this.dbType = 'none';
                                    }
                            
                                    this.initialized = true;
                                }
                            
                                // Key for Redis
                                getCacheKey(trackId) {
                                    return `song:${trackId}:settings`;
                                }
                            
                                async getSongSettings(trackId) {
                                    if (!trackId) return null;
                            
                                    // 1. Try Redis
                                    if (this.useRedis && this.redis) {
                                        try {
                                            const cached = await this.redis.get(this.getCacheKey(trackId));
                                            if (cached) return JSON.parse(cached);
                                        } catch (e) {
                                            console.error('Redis read error:', e.message);
                                        }
                                    }
                            
                                    // 2. Try DB
                                    let settings = null;
                                    try {
                                        if (this.dbType === 'postgres') {
                                            const res = await this.db.query('SELECT * FROM song_settings WHERE track_id = $1', [trackId]);
                                            if (res.rows.length > 0) {
                                                const row = res.rows[0];
                                                settings = {
                                                    offset: row.offset,
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
                                            const [rows] = await this.db.execute('SELECT * FROM song_settings WHERE track_id = ?', [trackId]);
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
                                            const doc = await this.db.findOne({ trackId });
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
                                        }
                                    } catch (e) {
                                        console.error('DB read error:', e.message);
                                    }
                            
                                    // 3. Populate Redis if found in DB
                                    if (settings && this.useRedis && this.redis) {
                                        try {
                                            await this.redis.set(this.getCacheKey(trackId), JSON.stringify(settings), {
                                                EX: 60 * 60 * 24 * 7 // Cache for 7 days
                                            });
                                        } catch (e) {
                                            console.error('Redis write error:', e.message);
                                        }
                                    }
                            
                                    return settings || { offset: 0, manualLyrics: null, lyricsContent: null };
                                }
                            
                                async saveSongSettings(trackId, settings) {
                                    if (!trackId) return;
                            
                                    // Current settings to merge updates
                                    const current = await this.getSongSettings(trackId);
                                    const updated = { ...current, ...settings };
                            
                                    // 1. Write to Redis
                                    if (this.useRedis && this.redis) {
                                        try {
                                            await this.redis.set(this.getCacheKey(trackId), JSON.stringify(updated), {
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
                                            await this.db.query(`
                                                INSERT INTO song_settings (track_id, offset, manual_lyrics_id, manual_lyrics_source, manual_lyrics_title, manual_lyrics_artist, lyrics_content, meta_data, updated_at)
                                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                                                ON CONFLICT (track_id) 
                                                DO UPDATE SET 
                                                    offset = EXCLUDED.offset,
                                                    manual_lyrics_id = EXCLUDED.manual_lyrics_id,
                                                    manual_lyrics_source = EXCLUDED.manual_lyrics_source,
                                                    manual_lyrics_title = EXCLUDED.manual_lyrics_title,
                                                    manual_lyrics_artist = EXCLUDED.manual_lyrics_artist,
                                                    lyrics_content = EXCLUDED.lyrics_content,
                                                    meta_data = EXCLUDED.meta_data,
                                                    updated_at = NOW()
                                            `, [
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
                                                INSERT INTO song_settings (track_id, offset_ms, manual_lyrics_id, manual_lyrics_source, manual_lyrics_title, manual_lyrics_artist, lyrics_content, meta_data, updated_at)
                                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
                                                { trackId },
                                                {
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
                                        }
                                    } catch (e) {
                                        console.error('DB write error:', e.message);
                                    }
                                }}

module.exports = EnhancedStorage;

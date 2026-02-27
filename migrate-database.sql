-- Database Migration Script
-- Purpose: Fix "value too long for type character varying" error
-- This script changes user_id, track_id, manual_lyrics_id, title and artist to TEXT (unlimited length)

-- ==========================================
-- PostgreSQL Migration
-- ==========================================
-- Run this if you are using PostgreSQL:

-- Alter user_id column to TEXT
ALTER TABLE song_settings ALTER COLUMN user_id TYPE TEXT;

-- Alter track_id column to TEXT
ALTER TABLE song_settings ALTER COLUMN track_id TYPE TEXT;

-- Alter manual_lyrics_id column to TEXT
ALTER TABLE song_settings ALTER COLUMN manual_lyrics_id TYPE TEXT;

-- Alter title and artist columns to TEXT (optional but recommended)
ALTER TABLE song_settings ALTER COLUMN manual_lyrics_title TYPE TEXT;
ALTER TABLE song_settings ALTER COLUMN manual_lyrics_artist TYPE TEXT;

-- ==========================================
-- MySQL/MariaDB Migration
-- ==========================================
-- Run this if you are using MySQL or MariaDB:

-- Alter user_id column to TEXT
-- ALTER TABLE song_settings MODIFY COLUMN user_id TEXT NOT NULL;

-- Alter track_id column to TEXT
-- ALTER TABLE song_settings MODIFY COLUMN track_id TEXT NOT NULL;

-- Alter manual_lyrics_id column to TEXT
-- ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_id TEXT;

-- Alter title and artist columns to TEXT (optional but recommended)
-- ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_title TEXT;
-- ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_artist TEXT;

-- ==========================================
-- Verification Queries
-- ==========================================
-- PostgreSQL: Check column types
-- SELECT column_name, data_type, character_maximum_length 
-- FROM information_schema.columns 
-- WHERE table_name = 'song_settings' 
-- AND column_name IN ('user_id', 'track_id', 'manual_lyrics_id');

-- MySQL/MariaDB: Check column types
-- DESCRIBE song_settings;

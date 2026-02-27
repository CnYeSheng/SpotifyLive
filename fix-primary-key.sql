-- Fix for "index row size exceeds btree version 4 maximum" error
-- This script restructures the song_settings table to use a numeric primary key
-- instead of a composite TEXT primary key

-- ==========================================
-- PostgreSQL Fix
-- ==========================================

-- Step 1: Drop the existing primary key constraint
ALTER TABLE song_settings DROP CONSTRAINT song_settings_pkey;

-- Step 2: Add a new numeric ID column as primary key
ALTER TABLE song_settings ADD COLUMN id SERIAL PRIMARY KEY;

-- Step 3: Create a unique index on (user_id, track_id) using hash for long values
-- Using MD5 hash of the combined user_id + track_id to ensure uniqueness without size limits
CREATE UNIQUE INDEX song_settings_user_track_unique 
ON song_settings (MD5(user_id || '::' || track_id));

-- Step 4: Create a regular index for faster lookups (using hash for long values)
CREATE INDEX song_settings_user_track_lookup 
ON song_settings (user_id, track_id);

-- Verification: Check the table structure
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'song_settings'
ORDER BY ordinal_position;

-- ==========================================
-- Alternative Approach (if the above doesn't work)
-- ==========================================
-- If you still have issues, you can limit the indexed portion of the text fields:

-- DROP INDEX IF EXISTS song_settings_user_track_unique;
-- DROP INDEX IF EXISTS song_settings_user_track_lookup;

-- CREATE UNIQUE INDEX song_settings_user_track_unique 
-- ON song_settings (LEFT(user_id, 255), LEFT(track_id, 255));

-- CREATE INDEX song_settings_user_track_lookup 
-- ON song_settings (LEFT(user_id, 255), LEFT(track_id, 255));

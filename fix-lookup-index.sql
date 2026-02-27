-- Fix the lookup index that causes "index row size exceeds" errors
-- The lookup index was trying to index full TEXT columns which exceed size limits

-- Drop the problematic lookup index
DROP INDEX IF EXISTS song_settings_user_track_lookup;

-- Create hash-based lookup index instead
-- This uses MD5 hashes which are always 32 characters, avoiding size limits
CREATE INDEX IF NOT EXISTS song_settings_user_track_lookup_hash 
ON song_settings (MD5(user_id), MD5(track_id));

-- Verify indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'song_settings'
ORDER BY indexname;

-- Expected result: 3 indexes
-- 1. song_settings_pkey (numeric id)
-- 2. song_settings_user_track_unique (MD5 hash for uniqueness)
-- 3. song_settings_user_track_lookup_hash (MD5 hashes for lookups)

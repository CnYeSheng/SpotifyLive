-- Drop old indexes that cause "index row size exceeds" errors
-- These indexes were created before the schema fix and index full TEXT columns

-- Drop individual TEXT column indexes
DROP INDEX IF EXISTS idx_song_settings_user_id;
DROP INDEX IF EXISTS idx_song_settings_track_id;

-- The new indexes (already created) handle lookups efficiently:
-- 1. song_settings_user_track_unique: MD5 hash for uniqueness
-- 2. song_settings_user_track_lookup: Composite index for queries

-- Verify remaining indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'song_settings'
ORDER BY indexname;

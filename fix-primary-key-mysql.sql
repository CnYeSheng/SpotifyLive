-- Fix for MySQL/MariaDB primary key issues with TEXT columns
-- This script restructures the song_settings table to use a numeric primary key

-- ==========================================
-- MySQL/MariaDB Fix
-- ==========================================

-- Step 1: Drop the existing primary key constraint
ALTER TABLE song_settings DROP PRIMARY KEY;

-- Step 2: Add a new numeric ID column as primary key
ALTER TABLE song_settings ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY;

-- Step 3: Create a unique index on (user_id, track_id) using limited length
-- MySQL TEXT columns can't be fully indexed, so we use a prefix
CREATE UNIQUE INDEX song_settings_user_track_unique 
ON song_settings (user_id(255), track_id(255));

-- Step 4: Create a regular index for faster lookups
CREATE INDEX song_settings_user_track_lookup 
ON song_settings (user_id(255), track_id(255));

-- Verification: Check the table structure
DESCRIBE song_settings;

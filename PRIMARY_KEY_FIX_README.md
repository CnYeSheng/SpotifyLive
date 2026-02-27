# Database Primary Key Fix

## Problem

You're experiencing this error:
```
DB write error: index row size 4088 exceeds btree version 4 maximum 2704 for index "song_settings_pkey"
DB write error: index row requires 19488 bytes, maximum size is 8191
```

### Root Cause
The `song_settings` table uses a composite primary key of `(user_id, track_id)`, both of which are TEXT columns. When Apple Music track IDs or user IDs are very long, the combined size exceeds PostgreSQL's btree index size limit:
- **Btree v4 maximum**: 2704 bytes per index entry
- **Absolute maximum**: 8191 bytes per row

## Solution

We've restructured the table to use a numeric `id` as the primary key, and created separate indexes for the `(user_id, track_id)` combination using:
- **PostgreSQL**: MD5 hash to handle unlimited text length
- **MySQL/MariaDB**: Prefix indexing (first 255 characters)

## How to Fix

### Option 1: Automatic Migration (Recommended)

Run the automated migration scripts in order:

```bash
# Step 1: Fix the primary key structure
node fix-db-schema.js

# Step 2: Remove old problematic indexes
node fix-old-indexes.js
```

**Step 1** (`fix-db-schema.js`) will:
1. Check if migration is needed
2. Drop the old composite primary key
3. Add a new numeric `id` column as primary key
4. Create unique and lookup indexes that handle long text values
5. Preserve all existing data

**Step 2** (`fix-old-indexes.js`) will:
1. Drop `idx_song_settings_user_id` (causes index size errors)
2. Drop `idx_song_settings_track_id` (causes index size errors)
3. Verify remaining indexes are correct

### Option 2: Manual SQL Migration

#### For PostgreSQL:
```bash
psql $DATABASE_URL -f fix-primary-key.sql
```

Or run the SQL manually:
```sql
-- Drop old primary key
ALTER TABLE song_settings DROP CONSTRAINT song_settings_pkey;

-- Add new numeric primary key
ALTER TABLE song_settings ADD COLUMN id SERIAL PRIMARY KEY;

-- Create unique index using hash (handles unlimited length)
CREATE UNIQUE INDEX song_settings_user_track_unique 
ON song_settings (MD5(user_id || '::' || track_id));

-- Create lookup index for queries
CREATE INDEX song_settings_user_track_lookup 
ON song_settings (user_id, track_id);

-- Drop old problematic indexes
DROP INDEX IF EXISTS idx_song_settings_user_id;
DROP INDEX IF EXISTS idx_song_settings_track_id;
```

#### For MySQL/MariaDB:
```bash
mysql -u username -p database_name < fix-primary-key-mysql.sql
```

Or run the SQL manually:
```sql
-- Drop old primary key
ALTER TABLE song_settings DROP PRIMARY KEY;

-- Add new numeric primary key
ALTER TABLE song_settings ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY;

-- Create unique index with prefix (handles TEXT columns)
CREATE UNIQUE INDEX song_settings_user_track_unique 
ON song_settings (user_id(255), track_id(255));

-- Create lookup index
CREATE INDEX song_settings_user_track_lookup 
ON song_settings (user_id(255), track_id(255));

-- Drop old problematic indexes (if they exist)
DROP INDEX IF EXISTS idx_song_settings_user_id;
DROP INDEX IF EXISTS idx_song_settings_track_id;
```

## Application Code Changes

The application code in `api/storage-enhanced.js` has been updated to:
1. Create tables with the new schema automatically
2. Use the hash-based or prefix-based unique indexes
3. Maintain backward compatibility with existing queries

**No changes needed to your application code** - the queries still use `user_id` and `track_id` for lookups.

## Verification

After migration, verify the changes:

### PostgreSQL:
```sql
-- Check table structure
\d song_settings

-- Check indexes
\di song_settings*

-- Verify data integrity
SELECT COUNT(*) FROM song_settings;
```

### MySQL/MariaDB:
```sql
-- Check table structure
DESCRIBE song_settings;

-- Check indexes
SHOW INDEXES FROM song_settings;

-- Verify data integrity
SELECT COUNT(*) FROM song_settings;
```

## Testing

After migration, test with a long track ID:
```javascript
// This should now work without errors
await storage.saveSongSettings(
    'user-with-very-long-id-' + 'x'.repeat(1000),
    'track-with-very-long-id-' + 'y'.repeat(1000),
    { offset: 100 }
);
```

## Rollback (if needed)

If you need to rollback (⚠️ **destructive**):

### PostgreSQL:
```sql
-- Backup first!
CREATE TABLE song_settings_backup AS SELECT * FROM song_settings;

-- Rollback
DROP TABLE song_settings;
-- Then recreate with old schema
```

### MySQL/MariaDB:
```sql
-- Backup first!
CREATE TABLE song_settings_backup AS SELECT * FROM song_settings;

-- Rollback
DROP TABLE song_settings;
-- Then recreate with old schema
```

## Why This Fix Works

1. **Numeric Primary Key**: A `SERIAL` (PostgreSQL) or `AUTO_INCREMENT` (MySQL) integer is always small (4-8 bytes)
2. **Hash-based Uniqueness** (PostgreSQL): MD5 hash is always 32 characters, regardless of input length
3. **Prefix Index** (MySQL): Only indexes first 255 characters, which is sufficient for uniqueness in most cases
4. **Separate Lookup Index**: Maintains query performance for `WHERE user_id = ? AND track_id = ?`

## Prevention

To prevent this in the future:
- Avoid using TEXT/VARCHAR columns in composite primary keys
- Use numeric IDs as primary keys
- Create separate unique constraints/indexes for business keys
- Consider using UUIDs with proper indexing if needed

## Support

If you encounter any issues:
1. Check the error logs: `DB write error: ...`
2. Verify your database type: `echo $DB_TYPE`
3. Check connection: `echo $DATABASE_URL`
4. Review migration logs from `fix-db-schema.js`

## Additional Resources

- [PostgreSQL Index Size Limits](https://www.postgresql.org/docs/current/btree-implementation.html)
- [MySQL Index Prefix Limits](https://dev.mysql.com/doc/refman/8.0/en/column-indexes.html)

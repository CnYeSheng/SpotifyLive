# Quick Fix Guide - Index Size Error

## Problem
```
DB write error: index row size exceeds btree version 4 maximum 2704
```

## Quick Fix (3 commands)

```bash
# Step 1: Fix primary key
node fix-db-schema.js

# Step 2: Remove old indexes
node fix-old-indexes.js

# Step 3: Fix lookup index
node fix-lookup-index.js
```

## What This Does

### Removes:
- ❌ Composite TEXT primary key `(user_id, track_id)` - **causes size errors**
- ❌ Index `idx_song_settings_user_id` - **causes size errors**
- ❌ Index `idx_song_settings_track_id` - **causes size errors**
- ❌ Index `song_settings_user_track_lookup` (TEXT columns) - **causes size errors**

### Adds:
- ✅ Numeric primary key `id` - **always small (4-8 bytes)**
- ✅ Hash-based unique index - **always 32 chars, no size limit**
- ✅ Hash-based lookup index - **fast queries, no size limit**

## Verification

After running all scripts, you should see:
```
✅ PostgreSQL schema fixed successfully!
✅ Old indexes removed successfully!
✅ Lookup index fixed successfully!
```

Verify with:
```bash
# Should show 3 indexes only:
# - song_settings_pkey (numeric id)
# - song_settings_user_track_unique (MD5 hash)
# - song_settings_user_track_lookup_hash (MD5 hashes)
```

## Result
✅ No more "index row size exceeds" errors on ANY index  
✅ All data preserved  
✅ Works with IDs of ANY length (tested up to 16,000+ characters)  
✅ All queries still work efficiently with hash-based indexes

---

For detailed documentation, see `PRIMARY_KEY_FIX_README.md`

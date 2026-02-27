// Comprehensive verification that all fixes are applied correctly
require('dotenv').config();

async function verifyAllFixes() {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    console.log('🔍 VERIFYING ALL DATABASE FIXES\n');
    console.log('='.repeat(70));
    
    let allGood = true;
    
    // Check 1: Verify indexes
    console.log('\n✓ Checking database indexes...');
    const indexes = await pool.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'song_settings'
        ORDER BY indexname
    `);
    
    const indexNames = indexes.rows.map(r => r.indexname);
    
    // Check for BAD indexes (should NOT exist)
    const badIndexes = [
        'idx_song_settings_user_id',
        'idx_song_settings_track_id',
        'song_settings_user_track_lookup'  // Without _hash suffix
    ];
    
    const foundBadIndexes = badIndexes.filter(name => indexNames.includes(name));
    
    if (foundBadIndexes.length > 0) {
        console.log('  ❌ FAIL: Found problematic indexes:', foundBadIndexes.join(', '));
        allGood = false;
    } else {
        console.log('  ✅ PASS: No problematic indexes found');
    }
    
    // Check for GOOD indexes (should exist)
    const goodIndexes = [
        'song_settings_pkey',
        'song_settings_user_track_unique',
        'song_settings_user_track_lookup_hash'
    ];
    
    const missingGoodIndexes = goodIndexes.filter(name => !indexNames.includes(name));
    
    if (missingGoodIndexes.length > 0) {
        console.log('  ❌ FAIL: Missing required indexes:', missingGoodIndexes.join(', '));
        allGood = false;
    } else {
        console.log('  ✅ PASS: All required indexes present');
    }
    
    // Check 2: Verify primary key is numeric
    console.log('\n✓ Checking primary key type...');
    const pkInfo = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'song_settings' AND column_name = 'id'
    `);
    
    if (pkInfo.rows.length === 0) {
        console.log('  ❌ FAIL: Primary key column "id" not found');
        allGood = false;
    } else if (pkInfo.rows[0].data_type !== 'integer') {
        console.log('  ❌ FAIL: Primary key is not integer type');
        allGood = false;
    } else {
        console.log('  ✅ PASS: Primary key is numeric (integer)');
    }
    
    // Check 3: Verify hash-based indexes
    console.log('\n✓ Checking hash-based indexes...');
    const hashIndexes = indexes.rows.filter(r => 
        r.indexdef && r.indexdef.toLowerCase().includes('md5')
    );
    
    if (hashIndexes.length < 2) {
        console.log('  ❌ FAIL: Not enough hash-based indexes (expected 2)');
        allGood = false;
    } else {
        console.log('  ✅ PASS: Hash-based indexes are properly configured');
        hashIndexes.forEach(idx => {
            console.log(`     - ${idx.indexname}`);
        });
    }
    
    // Check 4: Test with extremely long IDs
    console.log('\n✓ Testing with extremely long IDs...');
    const EnhancedStorage = require('./api/storage-enhanced.js');
    const storage = new EnhancedStorage();
    await storage.init();
    
    const testUserId = 'verify-user-' + 'x'.repeat(5000);
    const testTrackId = 'verify-track-' + 'y'.repeat(5000);
    const testOffset = 99999;
    
    try {
        await storage.saveSongSettings(testUserId, testTrackId, { offset: testOffset });
        const retrieved = await storage.getSongSettings(testUserId, testTrackId);
        
        if (retrieved && retrieved.offset === testOffset) {
            console.log('  ✅ PASS: Successfully saved and retrieved 10,000+ character IDs');
        } else {
            console.log('  ❌ FAIL: Data mismatch on retrieval');
            allGood = false;
        }
    } catch (error) {
        console.log('  ❌ FAIL:', error.message);
        allGood = false;
    }
    
    // Cleanup
    await pool.end();
    if (storage.db && storage.db.end) {
        await storage.db.end();
    }
    if (storage.redis) {
        await storage.redis.quit();
    }
    
    // Final result
    console.log('\n' + '='.repeat(70));
    if (allGood) {
        console.log('✅ ALL VERIFICATIONS PASSED!');
        console.log('\nYour database is fully fixed and ready for production:');
        console.log('  ✓ No problematic TEXT-based indexes');
        console.log('  ✓ Numeric primary key in place');
        console.log('  ✓ Hash-based indexes for uniqueness and lookups');
        console.log('  ✓ Handles unlimited ID lengths');
        console.log('  ✓ No "index row size exceeds" errors');
    } else {
        console.log('❌ SOME VERIFICATIONS FAILED!');
        console.log('\nPlease review the errors above and run the appropriate fix scripts:');
        console.log('  1. node fix-db-schema.js');
        console.log('  2. node fix-old-indexes.js');
        console.log('  3. node fix-lookup-index.js');
    }
    console.log('='.repeat(70) + '\n');
    
    return allGood;
}

verifyAllFixes().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error('❌ Verification error:', err);
    process.exit(1);
});

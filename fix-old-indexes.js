// Fix old indexes that cause "index row size exceeds" errors
require('dotenv').config();

async function fixIndexes() {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('🔧 Dropping old problematic indexes...');
        
        // Drop old individual TEXT column indexes
        console.log('  → Dropping idx_song_settings_user_id...');
        await pool.query('DROP INDEX IF EXISTS idx_song_settings_user_id');
        
        console.log('  → Dropping idx_song_settings_track_id...');
        await pool.query('DROP INDEX IF EXISTS idx_song_settings_track_id');
        
        console.log('\n✅ Old indexes removed successfully!');
        
        // Show remaining indexes
        console.log('\n📋 Remaining indexes:');
        const result = await pool.query(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'song_settings'
            ORDER BY indexname
        `);
        
        result.rows.forEach(row => {
            console.log(`  ✓ ${row.indexname}`);
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        pool.end();
    }
}

fixIndexes().then(() => {
    console.log('\n✅ Index fix complete!');
    process.exit(0);
}).catch(err => {
    console.error('\n❌ Fix failed:', err);
    process.exit(1);
});

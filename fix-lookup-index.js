// Fix the lookup index that's causing size errors
require('dotenv').config();

async function fixLookupIndex() {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('🔧 Fixing song_settings_user_track_lookup index...\n');
        
        // Drop the problematic lookup index
        console.log('  → Dropping song_settings_user_track_lookup (causes size errors)...');
        await pool.query('DROP INDEX IF EXISTS song_settings_user_track_lookup');
        
        // Create hash-based lookup index instead
        console.log('  → Creating hash-based lookup index...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS song_settings_user_track_lookup_hash 
            ON song_settings (MD5(user_id), MD5(track_id))
        `);
        
        console.log('\n✅ Lookup index fixed successfully!');
        
        // Show remaining indexes
        console.log('\n📋 Current indexes:');
        const result = await pool.query(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'song_settings'
            ORDER BY indexname
        `);
        
        result.rows.forEach(row => {
            console.log(`  ✓ ${row.indexname}`);
        });
        
        console.log('\n💡 Note: Queries will now use the hash-based index.');
        console.log('   WHERE user_id = ? AND track_id = ? will still work efficiently.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        pool.end();
    }
}

fixLookupIndex().then(() => {
    console.log('\n✅ Fix complete!');
    process.exit(0);
}).catch(err => {
    console.error('\n❌ Fix failed:', err);
    process.exit(1);
});

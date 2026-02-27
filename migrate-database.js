// migrate-database.js
// Automated database migration script for fixing VARCHAR(255) length issues

require('dotenv').config();

async function migrateDatabase() {
    const dbType = (process.env.DB_TYPE || 'none').toLowerCase();
    
    console.log(`🔧 Starting database migration for ${dbType}...`);

    try {
        switch (dbType) {
            case 'postgres':
            case 'postgresql': {
                const { Pool } = require('pg');
                const pool = new Pool({
                    connectionString: process.env.DATABASE_URL
                });

                console.log('📊 Checking current column types...');
                const checkQuery = `
                    SELECT column_name, data_type, character_maximum_length 
                    FROM information_schema.columns 
                    WHERE table_name = 'song_settings' 
                    AND column_name IN ('user_id', 'track_id', 'manual_lyrics_id')
                    ORDER BY ordinal_position;
                `;
                
                const currentState = await pool.query(checkQuery);
                console.log('Current state:', currentState.rows);

                console.log('🔄 Migrating columns to TEXT (unlimited length)...');
                
                await pool.query('ALTER TABLE song_settings ALTER COLUMN user_id TYPE TEXT;');
                console.log('✅ user_id migrated');
                
                await pool.query('ALTER TABLE song_settings ALTER COLUMN track_id TYPE TEXT;');
                console.log('✅ track_id migrated');
                
                await pool.query('ALTER TABLE song_settings ALTER COLUMN manual_lyrics_id TYPE TEXT;');
                console.log('✅ manual_lyrics_id migrated');
                
                await pool.query('ALTER TABLE song_settings ALTER COLUMN manual_lyrics_title TYPE TEXT;');
                console.log('✅ manual_lyrics_title migrated');
                
                await pool.query('ALTER TABLE song_settings ALTER COLUMN manual_lyrics_artist TYPE TEXT;');
                console.log('✅ manual_lyrics_artist migrated');

                console.log('📊 Verifying migration...');
                const verifyResult = await pool.query(checkQuery);
                console.log('New state:', verifyResult.rows);

                await pool.end();
                console.log('✅ PostgreSQL migration completed successfully!');
                break;
            }

            case 'mysql':
            case 'mariadb': {
                const mysql = require('mysql2/promise');
                const connection = await mysql.createConnection(process.env.DATABASE_URL);

                console.log('📊 Checking current column types...');
                const [columns] = await connection.execute(`
                    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = 'song_settings'
                    AND COLUMN_NAME IN ('user_id', 'track_id', 'manual_lyrics_id')
                `);
                console.log('Current state:', columns);

                console.log('🔄 Migrating columns to TEXT (unlimited length)...');
                
                await connection.execute('ALTER TABLE song_settings MODIFY COLUMN user_id TEXT NOT NULL;');
                console.log('✅ user_id migrated');
                
                await connection.execute('ALTER TABLE song_settings MODIFY COLUMN track_id TEXT NOT NULL;');
                console.log('✅ track_id migrated');
                
                await connection.execute('ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_id TEXT;');
                console.log('✅ manual_lyrics_id migrated');
                
                await connection.execute('ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_title TEXT;');
                console.log('✅ manual_lyrics_title migrated');
                
                await connection.execute('ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_artist TEXT;');
                console.log('✅ manual_lyrics_artist migrated');

                console.log('📊 Verifying migration...');
                const [newColumns] = await connection.execute(`
                    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = 'song_settings'
                    AND COLUMN_NAME IN ('user_id', 'track_id', 'manual_lyrics_id')
                `);
                console.log('New state:', newColumns);

                await connection.end();
                console.log('✅ MySQL/MariaDB migration completed successfully!');
                break;
            }

            case 'mongo':
            case 'mongodb':
                console.log('ℹ️ MongoDB does not have fixed varchar limits. No migration needed.');
                break;

            case 'json':
                console.log('ℹ️ Using JSON file storage. No migration needed.');
                break;

            default:
                console.log('⚠️ No database configured (DB_TYPE not set or invalid)');
                console.log('   Please set DB_TYPE in your .env file to one of: postgres, mysql, mariadb, mongo');
                process.exit(1);
        }

        console.log('\n✨ Migration completed! Your database can now handle longer IDs.');
        console.log('   The app will automatically use the new schema on restart.');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('   Full error:', error);
        process.exit(1);
    }
}

// Run migration
migrateDatabase().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('❌ Unexpected error:', err);
    process.exit(1);
});

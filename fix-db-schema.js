// fix-db-schema.js
// Script to fix the "index row size exceeds btree maximum" error
// Run this script to migrate existing data to the new schema

require('dotenv').config();

async function fixPostgres() {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log('🔧 Fixing PostgreSQL schema...');
        
        // Check if table exists and has the old schema
        const checkTable = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'song_settings' AND column_name = 'id'
        `);

        if (checkTable.rows.length > 0) {
            console.log('✅ Schema already updated (id column exists)');
            pool.end();
            return;
        }

        // Begin transaction
        await pool.query('BEGIN');

        console.log('  → Dropping old primary key constraint...');
        await pool.query('ALTER TABLE song_settings DROP CONSTRAINT IF EXISTS song_settings_pkey');

        console.log('  → Adding new id column...');
        await pool.query('ALTER TABLE song_settings ADD COLUMN id SERIAL PRIMARY KEY');

        console.log('  → Creating unique index with hash...');
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS song_settings_user_track_unique 
            ON song_settings (MD5(user_id || '::' || track_id))
        `);

        console.log('  → Creating lookup index...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS song_settings_user_track_lookup 
            ON song_settings (user_id, track_id)
        `);

        // Commit transaction
        await pool.query('COMMIT');

        console.log('✅ PostgreSQL schema fixed successfully!');
        
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('❌ Error fixing PostgreSQL schema:', error.message);
        throw error;
    } finally {
        pool.end();
    }
}

async function fixMySQL() {
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection(process.env.DATABASE_URL);

    try {
        console.log('🔧 Fixing MySQL/MariaDB schema...');
        
        // Check if table exists and has the old schema
        const [columns] = await connection.execute(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'song_settings' 
            AND COLUMN_NAME = 'id'
        `);

        if (columns.length > 0) {
            console.log('✅ Schema already updated (id column exists)');
            connection.end();
            return;
        }

        // Begin transaction
        await connection.beginTransaction();

        console.log('  → Dropping old primary key...');
        await connection.execute('ALTER TABLE song_settings DROP PRIMARY KEY');

        console.log('  → Adding new id column...');
        await connection.execute('ALTER TABLE song_settings ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY');

        console.log('  → Creating unique index with prefix...');
        await connection.execute(`
            CREATE UNIQUE INDEX song_settings_user_track_unique 
            ON song_settings (user_id(255), track_id(255))
        `);

        console.log('  → Creating lookup index...');
        await connection.execute(`
            CREATE INDEX song_settings_user_track_lookup 
            ON song_settings (user_id(255), track_id(255))
        `);

        // Commit transaction
        await connection.commit();

        console.log('✅ MySQL/MariaDB schema fixed successfully!');
        
    } catch (error) {
        await connection.rollback();
        console.error('❌ Error fixing MySQL/MariaDB schema:', error.message);
        throw error;
    } finally {
        connection.end();
    }
}

async function main() {
    const dbType = (process.env.DB_TYPE || '').toLowerCase();

    if (!dbType || dbType === 'none' || dbType === 'json') {
        console.log('ℹ️ No database configured. Skipping migration.');
        return;
    }

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set in environment variables');
        process.exit(1);
    }

    try {
        switch (dbType) {
            case 'postgres':
            case 'postgresql':
                await fixPostgres();
                break;
            
            case 'mysql':
            case 'mariadb':
                await fixMySQL();
                break;
            
            default:
                console.log(`ℹ️ Database type "${dbType}" doesn't need this fix (or not supported)`);
        }
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main().then(() => {
        console.log('\n✅ Migration complete!');
        process.exit(0);
    }).catch(err => {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    });
}

module.exports = { fixPostgres, fixMySQL };

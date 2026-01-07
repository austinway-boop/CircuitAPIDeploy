#!/usr/bin/env node
/**
 * Setup PostgreSQL database for Circuit API
 * Run this once to create tables and migrate existing words
 */

const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com',
    port: process.env.DB_PORT || 25060,
    user: process.env.DB_USER || 'db',
    password: process.env.DB_PASSWORD, // Set via environment variable
    database: process.env.DB_NAME || 'db',
    ssl: {
        rejectUnauthorized: false
    }
});

async function setupDatabase() {
    console.log('🚀 Setting up Circuit API database\n');
    
    try {
        // Test connection
        console.log('1️⃣  Testing database connection...');
        const client = await pool.connect();
        console.log('   ✅ Connected to PostgreSQL\n');
        client.release();
        
        // Read and execute schema
        console.log('2️⃣  Creating database schema...');
        const schema = fs.readFileSync(__dirname + '/db-schema.sql', 'utf8');
        
        // Split by semicolons and execute each statement
        const statements = schema.split(';').filter(s => s.trim());
        
        for (const statement of statements) {
            if (statement.trim()) {
                try {
                    await pool.query(statement);
                } catch (err) {
                    // Ignore "already exists" errors
                    if (!err.message.includes('already exists')) {
                        throw err;
                    }
                }
            }
        }
        console.log('   ✅ Schema created successfully\n');
        
        // Check if words table is empty
        console.log('3️⃣  Checking for existing words...');
        const countResult = await pool.query('SELECT COUNT(*) FROM words');
        const wordCount = parseInt(countResult.rows[0].count);
        console.log(`   📊 Database contains ${wordCount} words\n`);
        
        if (wordCount === 0) {
            console.log('4️⃣  Database is empty. Run migration to import words:');
            console.log('   npm run migrate-words\n');
        } else {
            console.log('4️⃣  ✅ Database already contains words\n');
        }
        
        // Test queries
        console.log('5️⃣  Testing database queries...');
        const testWord = await pool.query(
            'SELECT * FROM words ORDER BY created_at DESC LIMIT 1'
        );
        if (testWord.rows.length > 0) {
            console.log(`   ✅ Sample word: "${testWord.rows[0].word}"`);
        }
        console.log();
        
        console.log('✅ Database setup complete!\n');
        console.log('📝 Next steps:');
        if (wordCount === 0) {
            console.log('   1. Run: npm run migrate-words');
            console.log('   2. Update server to use emotion-engine-db.js');
            console.log('   3. Deploy to DigitalOcean');
        } else {
            console.log('   1. Update server to use emotion-engine-db.js');
            console.log('   2. Deploy to DigitalOcean');
        }
        console.log();
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

setupDatabase();


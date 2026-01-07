#!/usr/bin/env node
/**
 * Migrate all words from JSON files to PostgreSQL database
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Database connection
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

async function migrateWords() {
    console.log('🚀 Starting word migration from JSON to PostgreSQL\n');
    
    const wordsDir = path.join(__dirname, 'words');
    const jsonFiles = fs.readdirSync(wordsDir).filter(f => f.endsWith('.json'));
    
    let totalWords = 0;
    let insertedWords = 0;
    let skippedWords = 0;
    let errors = 0;
    
    // Test database connection
    try {
        const client = await pool.connect();
        console.log('✅ Connected to PostgreSQL database\n');
        client.release();
    } catch (err) {
        console.error('❌ Failed to connect to database:', err.message);
        process.exit(1);
    }
    
    for (const file of jsonFiles) {
        console.log(`📂 Processing ${file}...`);
        
        try {
            const filePath = path.join(wordsDir, file);
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const data = JSON.parse(fileContent);
            
            if (!data.words || !Array.isArray(data.words)) {
                console.log(`   ⚠️  No words array found in ${file}, skipping`);
                continue;
            }
            
            for (const entry of data.words) {
                totalWords++;
                
                if (!entry.word || !entry.stats) {
                    console.log(`   ⚠️  Invalid word entry, skipping`);
                    skippedWords++;
                    continue;
                }
                
                const word = entry.word;
                const stats = entry.stats;
                
                try {
                    // Insert word into database
                    await pool.query(`
                        INSERT INTO words (
                            word,
                            pos,
                            valence, arousal, dominance,
                            emotion_joy, emotion_trust, emotion_anticipation, emotion_surprise,
                            emotion_anger, emotion_fear, emotion_sadness, emotion_disgust,
                            sentiment_polarity, sentiment_strength,
                            good_bad, warmth_cold, competence_incompetence, active_passive,
                            toxicity,
                            negation_flip_probability, sarcasm_flip_probability
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                            $14, $15, $16, $17, $18, $19, $20, $21, $22
                        )
                        ON CONFLICT (word) DO NOTHING
                    `, [
                        word,
                        stats.pos || ['noun'],
                        stats.vad?.valence || 0.5,
                        stats.vad?.arousal || 0.5,
                        stats.vad?.dominance || 0.5,
                        stats.emotion_probs?.joy || 0.125,
                        stats.emotion_probs?.trust || 0.125,
                        stats.emotion_probs?.anticipation || 0.125,
                        stats.emotion_probs?.surprise || 0.125,
                        stats.emotion_probs?.anger || 0.125,
                        stats.emotion_probs?.fear || 0.125,
                        stats.emotion_probs?.sadness || 0.125,
                        stats.emotion_probs?.disgust || 0.125,
                        stats.sentiment?.polarity || 'neutral',
                        stats.sentiment?.strength || 0.5,
                        stats.social_axes?.good_bad || 0.0,
                        stats.social_axes?.warmth_cold || 0.0,
                        stats.social_axes?.competence_incompetence || 0.0,
                        stats.social_axes?.active_passive || 0.0,
                        stats.toxicity || 0.0,
                        stats.dynamics?.negation_flip_probability || 0.0,
                        stats.dynamics?.sarcasm_flip_probability || 0.0
                    ]);
                    
                    insertedWords++;
                    
                    if (insertedWords % 100 === 0) {
                        process.stdout.write(`   ${insertedWords} words inserted...\r`);
                    }
                    
                } catch (err) {
                    if (err.code === '23505') {
                        // Duplicate word, skip
                        skippedWords++;
                    } else {
                        console.error(`   ❌ Error inserting word "${word}":`, err.message);
                        errors++;
                    }
                }
            }
            
            console.log(`   ✅ ${file} complete`);
            
        } catch (err) {
            console.error(`   ❌ Error processing ${file}:`, err.message);
            errors++;
        }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`   Total words processed: ${totalWords}`);
    console.log(`   Successfully inserted: ${insertedWords}`);
    console.log(`   Skipped (duplicates): ${skippedWords}`);
    console.log(`   Errors: ${errors}`);
    
    // Verify migration
    try {
        const result = await pool.query('SELECT COUNT(*) FROM words');
        console.log(`\n✅ Database now contains ${result.rows[0].count} words`);
    } catch (err) {
        console.error('❌ Error verifying migration:', err.message);
    }
    
    await pool.end();
    console.log('\n🎉 Migration complete!\n');
}

// Run migration
migrateWords().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});


// PostgreSQL-based Emotion Analysis Engine
// Uses PostgreSQL database instead of JSON files for persistence
// WITH FULL DEBUG OUTPUT IN RESPONSE

const { Pool } = require('pg');

class EmotionEngine {
    constructor() {
        this.wordCache = new Map();
        this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
        this.dbConnected = false;
        this.dbError = null;
        this.dbWordCount = 0;
        this.initAttempted = false;
        
        // PostgreSQL connection pool
        this.pool = new Pool({
            host: process.env.DB_HOST || 'app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com',
            port: process.env.DB_PORT || 25060,
            user: process.env.DB_USER || 'db',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME || 'db',
            ssl: { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });
        
        // Test connection AND auto-setup on startup
        this.initializeDatabase();
    }
    
    async initializeDatabase() {
        if (this.initAttempted) return;
        this.initAttempted = true;
        
        console.log('🗄️  Initializing database connection...');
        console.log(`   Host: ${process.env.DB_HOST || 'default'}`);
        console.log(`   User: ${process.env.DB_USER || 'db'}`);
        console.log(`   Password set: ${!!process.env.DB_PASSWORD}`);
        
        try {
            // Try to create tables (will be skipped if they exist)
            await this.ensureTablesExist();
            
            // Test connection and count words
            const result = await this.pool.query('SELECT COUNT(*) as count FROM words');
            this.dbConnected = true;
            this.dbWordCount = parseInt(result.rows[0].count);
            this.dbError = null;
            console.log(`✅ Database connected! ${this.dbWordCount} words in database`);
            
            if (this.dbWordCount === 0) {
                console.log('⚠️  Database is empty! Run: npm run migrate-words');
            }
        } catch (error) {
            this.dbConnected = false;
            this.dbError = error.message;
            console.error(`❌ Database connection FAILED:`, error.message);
            console.error('   Make sure DB_PASSWORD environment variable is set!');
        }
    }
    
    async ensureTablesExist() {
        // Create tables if they don't exist
        const createWordsTable = `
            CREATE TABLE IF NOT EXISTS words (
                id SERIAL PRIMARY KEY,
                word VARCHAR(255) UNIQUE NOT NULL,
                pos TEXT[],
                valence DECIMAL(5,4) NOT NULL DEFAULT 0.5,
                arousal DECIMAL(5,4) NOT NULL DEFAULT 0.5,
                dominance DECIMAL(5,4) NOT NULL DEFAULT 0.5,
                emotion_joy DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_trust DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_anticipation DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_surprise DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_anger DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_fear DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_sadness DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                emotion_disgust DECIMAL(5,4) NOT NULL DEFAULT 0.125,
                sentiment_polarity VARCHAR(20) DEFAULT 'neutral',
                sentiment_strength DECIMAL(5,4) DEFAULT 0.5,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        const createLogsTable = `
            CREATE TABLE IF NOT EXISTS api_processing_logs (
                id SERIAL PRIMARY KEY,
                api_key_hash VARCHAR(64),
                input_text TEXT NOT NULL,
                word_count INTEGER,
                analyzed_words INTEGER,
                overall_emotion VARCHAR(50),
                confidence DECIMAL(5,4),
                emotions JSONB,
                word_analysis JSONB,
                vad JSONB,
                sentiment JSONB,
                processing_time_ms INTEGER,
                deepseek_calls INTEGER DEFAULT 0,
                new_words_added INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        try {
            await this.pool.query(createWordsTable);
            await this.pool.query(createLogsTable);
            console.log('   ✅ Database tables verified/created');
        } catch (error) {
            console.error('   ⚠️  Could not create tables:', error.message);
        }
    }
    
    async getWordData(word) {
        const cleanWord = word.toLowerCase();
        
        // Check memory cache first
        if (this.wordCache.has(cleanWord)) {
            return { data: this.wordCache.get(cleanWord), source: 'memory_cache' };
        }
        
        // Try database
        try {
            const result = await this.pool.query(
                'SELECT * FROM words WHERE LOWER(word) = $1',
                [cleanWord]
            );
            
            if (result.rows.length > 0) {
                const row = result.rows[0];
                const emotionData = {
                    vad: {
                        valence: parseFloat(row.valence),
                        arousal: parseFloat(row.arousal),
                        dominance: parseFloat(row.dominance)
                    },
                    emotion_probs: {
                        joy: parseFloat(row.emotion_joy),
                        trust: parseFloat(row.emotion_trust),
                        anticipation: parseFloat(row.emotion_anticipation),
                        surprise: parseFloat(row.emotion_surprise),
                        anger: parseFloat(row.emotion_anger),
                        fear: parseFloat(row.emotion_fear),
                        sadness: parseFloat(row.emotion_sadness),
                        disgust: parseFloat(row.emotion_disgust)
                    },
                    sentiment: {
                        polarity: row.sentiment_polarity,
                        strength: parseFloat(row.sentiment_strength)
                    }
                };
                
                // Add to memory cache
                this.wordCache.set(cleanWord, emotionData);
                return { data: emotionData, source: 'database' };
            }
            
            return { data: null, source: 'not_found' };
        } catch (error) {
            console.error(`DB Error for "${cleanWord}":`, error.message);
            return { data: null, source: 'db_error', error: error.message };
        }
    }
    
    async analyzeText(text) {
        const startTime = Date.now();
        const debugLog = [];
        
        // Debug: Database status
        debugLog.push(`Database connected: ${this.dbConnected}`);
        if (this.dbError) debugLog.push(`Database error: ${this.dbError}`);
        debugLog.push(`DeepSeek API key: ${this.deepseekApiKey ? 'SET' : 'NOT SET'}`);
        
        // Check DB word count
        try {
            const countResult = await this.pool.query('SELECT COUNT(*) as count FROM words');
            debugLog.push(`Words in database: ${countResult.rows[0].count}`);
        } catch (e) {
            debugLog.push(`Failed to count words: ${e.message}`);
        }
        
        const words = text.toLowerCase().split(/\s+/);
        const cleanWords = words.map(word => word.replace(/[^a-zA-Z0-9]/g, ''));
        
        const wordAnalyses = [];
        const unknownWords = [];
        let wordsFromDatabase = 0;
        let wordsFromCache = 0;
        let wordsFromDeepSeek = 0;
        let wordsNotFound = 0;
        
        // Analyze each word
        for (let i = 0; i < cleanWords.length; i++) {
            const originalWord = words[i];
            const cleanWord = cleanWords[i];
            
            if (!cleanWord || cleanWord.length < 1) continue;
            
            const { data: emotionData, source, error } = await this.getWordData(cleanWord);
            
            if (emotionData) {
                if (source === 'memory_cache') {
                    wordsFromCache++;
                    debugLog.push(`✓ "${cleanWord}" from MEMORY CACHE`);
                } else {
                    wordsFromDatabase++;
                    debugLog.push(`✓ "${cleanWord}" from DATABASE`);
                }
                
                const dominantEmotion = this.getDominantEmotion(emotionData.emotion_probs);
                
                wordAnalyses.push({
                    word: originalWord,
                    clean_word: cleanWord,
                    emotion: dominantEmotion.emotion,
                    confidence: dominantEmotion.confidence,
                    valence: emotionData.vad.valence,
                    arousal: emotionData.vad.arousal,
                    sentiment: emotionData.sentiment.polarity,
                    found: true,
                    source: source,
                    emotion_probs: emotionData.emotion_probs
                });
            } else {
                wordsNotFound++;
                debugLog.push(`✗ "${cleanWord}" NOT FOUND (${source}${error ? ': ' + error : ''})`);
                
                unknownWords.push({
                    word: originalWord,
                    clean_word: cleanWord,
                    index: i
                });
                
                wordAnalyses.push({
                    word: originalWord,
                    clean_word: cleanWord,
                    emotion: 'neutral',
                    confidence: 0.125,
                    valence: 0.5,
                    arousal: 0.5,
                    sentiment: 'neutral',
                    found: false,
                    source: 'not_found'
                });
            }
        }
        
        // Process unknown words with DeepSeek
        if (unknownWords.length > 0 && this.deepseekApiKey) {
            debugLog.push(`Processing ${unknownWords.length} unknown words with DeepSeek...`);
            
            const emotionalWords = unknownWords.filter(w => this.isEmotionallySignificant(w.clean_word));
            const wordsToProcess = emotionalWords.length > 0 ? emotionalWords : unknownWords.slice(0, 1);
            
            for (const unknownWord of wordsToProcess.slice(0, 3)) {
                try {
                    debugLog.push(`🤖 Calling DeepSeek for "${unknownWord.clean_word}"...`);
                    const deepseekResult = await this.analyzeWordWithDeepSeek(unknownWord.clean_word);
                    
                    if (deepseekResult) {
                        wordsFromDeepSeek++;
                        debugLog.push(`✓ DeepSeek returned data for "${unknownWord.clean_word}"`);
                        
                        // Cache it
                        this.wordCache.set(unknownWord.clean_word, deepseekResult);
                        
                        // Save to database
                        const saved = await this.saveWordToDatabase(unknownWord.clean_word, deepseekResult);
                        debugLog.push(saved ? 
                            `✓ Saved "${unknownWord.clean_word}" to database` :
                            `✗ FAILED to save "${unknownWord.clean_word}" to database`
                        );
                        
                        // Update word analysis
                        const wordIndex = wordAnalyses.findIndex(w => w.clean_word === unknownWord.clean_word);
                        if (wordIndex !== -1) {
                            const dominantEmotion = this.getDominantEmotion(deepseekResult.emotion_probs);
                            wordAnalyses[wordIndex] = {
                                ...wordAnalyses[wordIndex],
                                emotion: dominantEmotion.emotion,
                                confidence: dominantEmotion.confidence,
                                valence: deepseekResult.vad.valence,
                                arousal: deepseekResult.vad.arousal,
                                sentiment: deepseekResult.sentiment.polarity,
                                found: true,
                                source: 'deepseek',
                                emotion_probs: deepseekResult.emotion_probs
                            };
                        }
                    } else {
                        debugLog.push(`✗ DeepSeek returned NO DATA for "${unknownWord.clean_word}"`);
                    }
                } catch (error) {
                    debugLog.push(`✗ DeepSeek ERROR for "${unknownWord.clean_word}": ${error.message}`);
                }
            }
        } else if (unknownWords.length > 0) {
            debugLog.push(`⚠ ${unknownWords.length} unknown words but no DeepSeek API key!`);
        }
        
        // Calculate result
        const result = this.calculateOverallEmotion(wordAnalyses, text);
        const processingTime = Date.now() - startTime;
        
        // Add debug info to result
        result.debug = {
            database_connected: this.dbConnected,
            database_error: this.dbError,
            deepseek_available: !!this.deepseekApiKey,
            words_from_database: wordsFromDatabase,
            words_from_cache: wordsFromCache,
            words_from_deepseek: wordsFromDeepSeek,
            words_not_found: wordsNotFound,
            total_words_processed: cleanWords.filter(w => w.length > 0).length,
            processing_time_ms: processingTime,
            log: debugLog
        };
        
        // Log to database (async)
        this.logProcessing(text, result, processingTime, wordsFromDeepSeek, wordsFromDeepSeek).catch(() => {});
        
        return result;
    }
    
    async saveWordToDatabase(word, emotionData) {
        try {
            await this.pool.query(`
                INSERT INTO words (
                    word, valence, arousal, dominance,
                    emotion_joy, emotion_trust, emotion_anticipation, emotion_surprise,
                    emotion_anger, emotion_fear, emotion_sadness, emotion_disgust,
                    sentiment_polarity, sentiment_strength
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (word) DO UPDATE SET
                    valence = $2, arousal = $3, dominance = $4,
                    emotion_joy = $5, emotion_trust = $6, emotion_anticipation = $7, emotion_surprise = $8,
                    emotion_anger = $9, emotion_fear = $10, emotion_sadness = $11, emotion_disgust = $12,
                    sentiment_polarity = $13, sentiment_strength = $14,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                word,
                emotionData.vad?.valence || 0.5,
                emotionData.vad?.arousal || 0.5,
                emotionData.vad?.dominance || 0.5,
                emotionData.emotion_probs?.joy || 0.125,
                emotionData.emotion_probs?.trust || 0.125,
                emotionData.emotion_probs?.anticipation || 0.125,
                emotionData.emotion_probs?.surprise || 0.125,
                emotionData.emotion_probs?.anger || 0.125,
                emotionData.emotion_probs?.fear || 0.125,
                emotionData.emotion_probs?.sadness || 0.125,
                emotionData.emotion_probs?.disgust || 0.125,
                emotionData.sentiment?.polarity || 'neutral',
                emotionData.sentiment?.strength || 0.5
            ]);
            return true;
        } catch (error) {
            console.error(`Save error for "${word}":`, error.message);
            return false;
        }
    }
    
    async logProcessing(text, result, processingTime, deepseekCalls, newWordsAdded) {
        try {
            await this.pool.query(`
                INSERT INTO api_processing_logs (
                    input_text, word_count, analyzed_words, overall_emotion, confidence,
                    emotions, word_analysis, vad, sentiment,
                    processing_time_ms, deepseek_calls, new_words_added
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                text, result.word_count, result.analyzed_words, result.overall_emotion, result.confidence,
                JSON.stringify(result.emotions), JSON.stringify(result.word_analysis),
                JSON.stringify(result.vad), JSON.stringify(result.sentiment),
                processingTime, deepseekCalls, newWordsAdded
            ]);
        } catch (error) {
            // Silent fail
        }
    }
    
    getDominantEmotion(emotionProbs) {
        let maxEmotion = 'neutral';
        let maxConfidence = 0;
        for (const [emotion, probability] of Object.entries(emotionProbs)) {
            if (probability > maxConfidence) {
                maxConfidence = probability;
                maxEmotion = emotion;
            }
        }
        return { emotion: maxEmotion, confidence: maxConfidence };
    }
    
    isEmotionallySignificant(word) {
        const neutralWords = new Set([
            'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself',
            'he', 'she', 'it', 'his', 'her', 'its', 'him', 'we', 'us', 'our',
            'they', 'them', 'their', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
            'this', 'that', 'what', 'where', 'when', 'why', 'how', 'who', 'which'
        ]);
        return !neutralWords.has(word.toLowerCase()) && word.length >= 3 && !/^\d+$/.test(word);
    }
    
    async analyzeWordWithDeepSeek(word) {
        if (!this.deepseekApiKey) return null;
        
        const prompt = `Analyze the word "${word}" for emotions. Return ONLY this JSON:
{
  "emotion_probs": {"joy": 0.125, "trust": 0.125, "anticipation": 0.125, "surprise": 0.125, "anger": 0.125, "fear": 0.125, "sadness": 0.125, "disgust": 0.125},
  "vad": {"valence": 0.5, "arousal": 0.5, "dominance": 0.5},
  "sentiment": {"polarity": "neutral", "strength": 0.5}
}
For emotional words, give primary emotion 0.4-0.7. emotion_probs must sum to 1.0.`;

        try {
            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.deepseekApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.0,
                    max_tokens: 500
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                let content = result.choices[0].message.content.trim();
                content = content.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(content);
            }
            return null;
        } catch (error) {
            console.error(`DeepSeek error for "${word}":`, error.message);
            return null;
        }
    }
    
    calculateOverallEmotion(wordAnalyses, text) {
        const confidentWords = wordAnalyses.filter(w => w.found && w.confidence > 0.25);
        
        if (confidentWords.length === 0) {
            return {
                overall_emotion: 'neutral',
                confidence: 0.125,
                emotions: { joy: 0.125, trust: 0.125, anticipation: 0.125, surprise: 0.125, anger: 0.125, fear: 0.125, sadness: 0.125, disgust: 0.125 },
                word_analysis: wordAnalyses,
                word_count: wordAnalyses.length,
                analyzed_words: 0,
                coverage: 0.0,
                vad: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                sentiment: { polarity: 'neutral', strength: 0.5 }
            };
        }
        
        const emotionWeights = { joy: 0, trust: 0, anticipation: 0, surprise: 0, anger: 0, fear: 0, sadness: 0, disgust: 0 };
        
        for (const wordData of confidentWords) {
            const probs = wordData.emotion_probs || {};
            const amp = wordData.confidence > 0.5 ? 3.0 : wordData.confidence > 0.3 ? 2.5 : 2.0;
            for (const emotion of Object.keys(emotionWeights)) {
                const base = probs[emotion] || 0.125;
                emotionWeights[emotion] += emotion === wordData.emotion ? base * amp : base;
            }
        }
        
        const total = Object.values(emotionWeights).reduce((a, b) => a + b, 0);
        const emotions = {};
        for (const e of Object.keys(emotionWeights)) {
            emotions[e] = total > 0 ? emotionWeights[e] / total : 0.125;
        }
        
        const dominantEmotion = Object.keys(emotions).reduce((a, b) => emotions[a] > emotions[b] ? a : b);
        
        const vad = {
            valence: confidentWords.reduce((s, w) => s + w.valence, 0) / confidentWords.length,
            arousal: confidentWords.reduce((s, w) => s + w.arousal, 0) / confidentWords.length,
            dominance: 0.5
        };
        
        const pos = confidentWords.filter(w => w.sentiment === 'positive').length;
        const neg = confidentWords.filter(w => w.sentiment === 'negative').length;
        
        return {
            overall_emotion: dominantEmotion,
            confidence: emotions[dominantEmotion],
            emotions,
            word_analysis: wordAnalyses,
            word_count: wordAnalyses.length,
            analyzed_words: confidentWords.length,
            coverage: confidentWords.length / wordAnalyses.length,
            vad,
            sentiment: { polarity: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral', strength: 0.5 }
        };
    }
    
    async getDatabaseStats() {
        try {
            const result = await this.pool.query('SELECT COUNT(*) FROM words');
            return {
                total_words: parseInt(result.rows[0].count),
                database_type: 'PostgreSQL',
                database_connected: this.dbConnected,
                deepseek_available: !!this.deepseekApiKey
            };
        } catch (error) {
            return {
                total_words: 0,
                database_type: 'PostgreSQL',
                database_connected: false,
                deepseek_available: !!this.deepseekApiKey,
                error: error.message
            };
        }
    }
}

const emotionEngine = new EmotionEngine();
module.exports = { emotionEngine };

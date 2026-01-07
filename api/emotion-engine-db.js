// PostgreSQL-based Emotion Analysis Engine
// Uses PostgreSQL database instead of JSON files for persistence

const { Pool } = require('pg');

class EmotionEngine {
    constructor() {
        this.wordCache = new Map();
        this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
        this.initialized = false;
        
        // PostgreSQL connection pool
        this.pool = new Pool({
            host: process.env.DB_HOST || 'app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com',
            port: process.env.DB_PORT || 25060,
            user: process.env.DB_USER || 'db',
            password: process.env.DB_PASSWORD, // Set via environment variable
            database: process.env.DB_NAME || 'db',
            ssl: {
                rejectUnauthorized: false
            },
            max: 20, // maximum pool size
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
        
        console.log('🗄️  PostgreSQL Emotion Engine initialized');
    }
    
    // Load word data from database
    async getWordData(word) {
        const cleanWord = word.toLowerCase();
        
        // Check cache first
        if (this.wordCache.has(cleanWord)) {
            return this.wordCache.get(cleanWord);
        }
        
        try {
            const result = await this.pool.query(
                'SELECT * FROM words WHERE LOWER(word) = $1',
                [cleanWord]
            );
            
            if (result.rows.length > 0) {
                const row = result.rows[0];
                
                // Convert database row to emotion data format
                const emotionData = {
                    pos: row.pos || ['noun'],
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
                    },
                    social_axes: {
                        good_bad: parseFloat(row.good_bad),
                        warmth_cold: parseFloat(row.warmth_cold),
                        competence_incompetence: parseFloat(row.competence_incompetence),
                        active_passive: parseFloat(row.active_passive)
                    },
                    toxicity: parseFloat(row.toxicity),
                    dynamics: {
                        negation_flip_probability: parseFloat(row.negation_flip_probability),
                        sarcasm_flip_probability: parseFloat(row.sarcasm_flip_probability)
                    }
                };
                
                // Cache for future use
                this.wordCache.set(cleanWord, emotionData);
                
                return emotionData;
            }
            
            return null;
        } catch (error) {
            console.error(`Error fetching word "${cleanWord}" from database:`, error.message);
            return null;
        }
    }
    
    async analyzeText(text) {
        const startTime = Date.now();
        const words = text.toLowerCase().split(/\s+/);
        const cleanWords = words.map(word => word.replace(/[^a-zA-Z0-9]/g, ''));
        
        // Analyze each word
        const wordAnalyses = [];
        const unknownWords = [];
        let deepseekCalls = 0;
        let newWordsAdded = 0;
        
        for (let i = 0; i < cleanWords.length; i++) {
            const originalWord = words[i];
            const cleanWord = cleanWords[i];
            
            if (!cleanWord || cleanWord.length < 1) {
                continue;
            }
            
            // Get word data from database
            const emotionData = await this.getWordData(cleanWord);
            
            if (emotionData) {
                // Use real emotion data from database
                console.log(`✓ Word "${cleanWord}" found in database (source: database)`);
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
                    source: 'database',
                    emotion_probs: emotionData.emotion_probs
                });
            } else {
                // Word not in database - will need DeepSeek
                console.log(`✗ Word "${cleanWord}" NOT in database - will process with DeepSeek`);
                unknownWords.push({
                    word: originalWord,
                    clean_word: cleanWord,
                    index: i
                });
                
                // Add placeholder for now
                wordAnalyses.push({
                    word: originalWord,
                    clean_word: cleanWord,
                    emotion: 'neutral',
                    confidence: 0.125,
                    valence: 0.5,
                    arousal: 0.5,
                    sentiment: 'neutral',
                    found: false,
                    source: 'unknown'
                });
            }
        }
        
        // Process unknown words with DeepSeek if we have an API key
        if (unknownWords.length > 0 && this.deepseekApiKey) {
            // Prioritize emotionally significant words for DeepSeek processing
            const emotionalWords = unknownWords.filter(word => this.isEmotionallySignificant(word.clean_word));
            const wordsToProcess = emotionalWords.length > 0 ? emotionalWords : unknownWords.slice(0, 1);
            
            // Process up to 3 words efficiently
            const processPromises = wordsToProcess.slice(0, 3).map(async (unknownWord) => {
                try {
                    const deepseekResult = await this.analyzeWordWithDeepSeek(unknownWord.clean_word);
                    if (deepseekResult) {
                        deepseekCalls++;
                        
                        console.log(`🤖 DeepSeek analyzed word: "${unknownWord.clean_word}"`);
                        
                        // Cache this result
                        this.wordCache.set(unknownWord.clean_word, deepseekResult);
                        
                        // Save to database
                        const saved = await this.saveWordToDatabase(unknownWord.clean_word, deepseekResult);
                        if (saved) {
                            newWordsAdded++;
                            console.log(`✅ Saved word "${unknownWord.clean_word}" to database`);
                        } else {
                            console.error(`❌ Failed to save word "${unknownWord.clean_word}" to database`);
                        }
                        
                        return { word: unknownWord.clean_word, result: deepseekResult };
                    }
                } catch (error) {
                    console.error(`Error processing word "${unknownWord.clean_word}":`, error.message);
                }
                return null;
            });
            
            // Wait for all DeepSeek calls in parallel
            const results = await Promise.all(processPromises);
            
            // Update word analyses with results
            for (const result of results) {
                if (result) {
                    const wordIndex = wordAnalyses.findIndex(w => w.clean_word === result.word);
                    if (wordIndex !== -1) {
                        const dominantEmotion = this.getDominantEmotion(result.result.emotion_probs);
                        wordAnalyses[wordIndex] = {
                            ...wordAnalyses[wordIndex],
                            emotion: dominantEmotion.emotion,
                            confidence: dominantEmotion.confidence,
                            valence: result.result.vad.valence,
                            arousal: result.result.vad.arousal,
                            sentiment: result.result.sentiment.polarity,
                            found: true,
                            source: 'deepseek',
                            emotion_probs: result.result.emotion_probs
                        };
                    }
                }
            }
        }
        
        // Calculate overall emotion from word analyses
        const result = this.calculateOverallEmotion(wordAnalyses, text);
        
        // Log to database (async, don't wait)
        const processingTime = Date.now() - startTime;
        this.logProcessing(text, result, processingTime, deepseekCalls, newWordsAdded).catch(err => {
            console.error('Error logging to database:', err.message);
        });
        
        return result;
    }
    
    async saveWordToDatabase(word, emotionData) {
        try {
            await this.pool.query(`
                INSERT INTO words (
                    word,
                    valence, arousal, dominance,
                    emotion_joy, emotion_trust, emotion_anticipation, emotion_surprise,
                    emotion_anger, emotion_fear, emotion_sadness, emotion_disgust,
                    sentiment_polarity, sentiment_strength
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
                )
                ON CONFLICT (word) DO NOTHING
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
            
            console.log(`✅ Saved word "${word}" to database`);
            return true;
        } catch (error) {
            console.error(`Error saving word "${word}" to database:`, error.message);
            return false;
        }
    }
    
    async logProcessing(text, result, processingTime, deepseekCalls, newWordsAdded) {
        try {
            await this.pool.query(`
                INSERT INTO api_processing_logs (
                    input_text,
                    word_count,
                    analyzed_words,
                    overall_emotion,
                    confidence,
                    emotions,
                    word_analysis,
                    vad,
                    sentiment,
                    processing_time_ms,
                    deepseek_calls,
                    new_words_added
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                )
            `, [
                text,
                result.word_count,
                result.analyzed_words,
                result.overall_emotion,
                result.confidence,
                JSON.stringify(result.emotions),
                JSON.stringify(result.word_analysis),
                JSON.stringify(result.vad),
                JSON.stringify(result.sentiment),
                processingTime,
                deepseekCalls,
                newWordsAdded
            ]);
        } catch (error) {
            // Don't throw, just log - we don't want logging to break the API
            console.error('Error logging processing:', error.message);
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
        // Skip common neutral words that are unlikely to be emotional
        const neutralWords = new Set([
            'i', 'me', 'my', 'mine', 'myself',
            'you', 'your', 'yours', 'yourself',
            'he', 'she', 'it', 'his', 'her', 'its', 'him', 'himself', 'herself', 'itself',
            'we', 'us', 'our', 'ours', 'ourselves',
            'they', 'them', 'their', 'theirs', 'themselves',
            'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'having',
            'do', 'does', 'did', 'doing',
            'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'this', 'that', 'these', 'those',
            'what', 'where', 'when', 'why', 'how', 'who', 'which'
        ]);
        
        if (neutralWords.has(word.toLowerCase())) {
            return false;
        }
        
        if (word.length < 3) {
            return false;
        }
        
        if (/^\d+$/.test(word)) {
            return false;
        }
        
        return true;
    }
    
    async analyzeWordWithDeepSeek(word) {
        if (!this.deepseekApiKey) {
            return null;
        }
        
        const prompt = `Analyze the word "${word}" for its emotional connotations and psychological impact.

GOAL: Create ACCURATE and DISTINCTIVE emotion predictions that clearly differentiate between emotions.

Think deeply about:
1. What emotions does this word typically evoke in people?
2. Is it positive, negative, or neutral in feeling (valence)?
3. How energetic or calm does it make people feel (arousal)?
4. Does it convey power/control or submission (dominance)?
5. What is the overall sentiment and strength?

EMOTION ASSIGNMENT RULES:
- BE DECISIVE: If a word has emotional content, make it CLEAR in the probabilities
- NEUTRAL words (pronouns, articles, prepositions): Use equal probabilities (0.125 each)
- EMOTIONAL words: Give the primary emotion 0.4-0.7, secondary 0.1-0.3, others 0.01-0.05
- STRONG emotional words: Primary emotion should be 0.6+
- MODERATE emotional words: Primary emotion should be 0.4-0.6
- WEAK emotional words: Primary emotion should be 0.25-0.4

Based on your analysis, provide the emotion data in this exact JSON format:

{
  "emotion_probs": {
    "joy": 0.125,
    "trust": 0.125,
    "anticipation": 0.125,
    "surprise": 0.125,
    "anger": 0.125,
    "fear": 0.125,
    "sadness": 0.125,
    "disgust": 0.125
  },
  "vad": {
    "valence": 0.5,
    "arousal": 0.5,
    "dominance": 0.5
  },
  "sentiment": {
    "polarity": "neutral",
    "strength": 0.5
  }
}

Rules:
- emotion_probs must sum to 1.0
- vad values: 0.0 to 1.0 (valence: negative to positive, arousal: calm to energetic, dominance: submissive to dominant)
- Return ONLY the JSON, no explanation`;

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
                    temperature: 0.0, // CRITICAL: 0 for deterministic results
                    max_tokens: 800
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                let content = result.choices[0].message.content.trim();
                
                // Clean response
                if (content.startsWith('```json')) {
                    content = content.replace('```json', '').replace('```', '').trim();
                } else if (content.startsWith('```')) {
                    const lines = content.split('\n');
                    for (const line of lines) {
                        if (line.trim().startsWith('{"emotion_probs"')) {
                            content = line.trim();
                            break;
                        }
                    }
                }
                
                return JSON.parse(content);
                
            } else {
                return null;
            }
            
        } catch (error) {
            console.error(`Error analyzing word "${word}" with DeepSeek:`, error.message);
            return null;
        }
    }
    
    calculateOverallEmotion(wordAnalyses, text) {
        // Filter to only confident words
        const CONFIDENCE_THRESHOLD = 0.25;
        const confidentWords = wordAnalyses.filter(w => w.found && w.confidence > CONFIDENCE_THRESHOLD);
        
        if (confidentWords.length === 0) {
            return this.getNeutralResult(wordAnalyses, text);
        }
        
        // Weighted emotion calculation
        const emotionWeights = {
            joy: 0, trust: 0, anticipation: 0, surprise: 0,
            anger: 0, fear: 0, sadness: 0, disgust: 0
        };
        
        for (const wordData of confidentWords) {
            const emotionProbs = wordData.emotion_probs || this.getDefaultEmotionProbs(wordData.emotion);
            
            // Apply amplification for strong emotions
            let amplification = 1.0;
            if (wordData.confidence > 0.5) {
                amplification = 3.0;
            } else if (wordData.confidence > 0.3) {
                amplification = 2.5;
            } else {
                amplification = 2.0;
            }
            
            // Add weighted scores
            for (const emotion of Object.keys(emotionWeights)) {
                const baseScore = emotionProbs[emotion] || 0.125;
                const weightedScore = emotion === wordData.emotion ? 
                    baseScore * amplification : baseScore;
                emotionWeights[emotion] += weightedScore;
            }
        }
        
        // Normalize
        const totalWeight = Object.values(emotionWeights).reduce((a, b) => a + b, 0);
        const emotions = {};
        
        if (totalWeight > 0) {
            for (const emotion of Object.keys(emotionWeights)) {
                emotions[emotion] = emotionWeights[emotion] / totalWeight;
            }
        } else {
            for (const emotion of Object.keys(emotionWeights)) {
                emotions[emotion] = 0.125;
            }
        }
        
        // Get dominant emotion
        const dominantEmotion = Object.keys(emotions).reduce((a, b) => 
            emotions[a] > emotions[b] ? a : b
        );
        
        // Calculate VAD
        const vad = {
            valence: 0.5,
            arousal: 0.5,
            dominance: 0.5
        };
        
        if (confidentWords.length > 0) {
            vad.valence = confidentWords.reduce((sum, w) => sum + w.valence, 0) / confidentWords.length;
            vad.arousal = confidentWords.reduce((sum, w) => sum + w.arousal, 0) / confidentWords.length;
        }
        
        // Determine sentiment
        const positiveWords = confidentWords.filter(w => w.sentiment === 'positive').length;
        const negativeWords = confidentWords.filter(w => w.sentiment === 'negative').length;
        
        let sentimentPolarity = 'neutral';
        if (positiveWords > negativeWords) sentimentPolarity = 'positive';
        else if (negativeWords > positiveWords) sentimentPolarity = 'negative';
        
        return {
            overall_emotion: dominantEmotion,
            confidence: emotions[dominantEmotion],
            emotions: emotions,
            word_analysis: wordAnalyses,
            word_count: wordAnalyses.length,
            analyzed_words: confidentWords.length,
            coverage: confidentWords.length / wordAnalyses.length,
            vad: vad,
            sentiment: { polarity: sentimentPolarity, strength: 0.5 },
            processing_method: 'database'
        };
    }
    
    getNeutralResult(wordAnalyses, text) {
        return {
            overall_emotion: 'neutral',
            confidence: 0.125,
            emotions: {
                joy: 0.125, trust: 0.125, anticipation: 0.125, surprise: 0.125,
                anger: 0.125, fear: 0.125, sadness: 0.125, disgust: 0.125
            },
            word_analysis: wordAnalyses,
            word_count: wordAnalyses.length,
            analyzed_words: 0,
            coverage: 0.0,
            vad: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
            sentiment: { polarity: 'neutral', strength: 0.5 },
            processing_method: 'neutral_fallback'
        };
    }
    
    getDefaultEmotionProbs(emotion) {
        const defaultProbs = {
            joy: 0.125, trust: 0.125, anticipation: 0.125, surprise: 0.125,
            anger: 0.125, fear: 0.125, sadness: 0.125, disgust: 0.125
        };
        return defaultProbs;
    }
    
    async getDatabaseStats() {
        try {
            const result = await this.pool.query('SELECT COUNT(*) FROM words');
            return {
                total_words: parseInt(result.rows[0].count),
                database_type: 'PostgreSQL',
                deepseek_available: !!this.deepseekApiKey
            };
        } catch (error) {
            console.error('Error getting database stats:', error.message);
            return {
                total_words: 0,
                database_type: 'PostgreSQL',
                deepseek_available: !!this.deepseekApiKey,
                error: error.message
            };
        }
    }
}

// Global instance
const emotionEngine = new EmotionEngine();

module.exports = { emotionEngine };


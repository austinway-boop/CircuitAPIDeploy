// Real Emotion Analysis Engine for JavaScript
// Converts the Python word database system to pure JavaScript

const fs = require('fs');
const path = require('path');

class EmotionEngine {
    constructor() {
        this.wordCache = new Map();
        this.fileCache = new Map(); // Lazy load word files
        this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
        this.wordsDir = path.join(process.cwd(), 'words');
        this.initialized = false;
    }
    
    // Lazy initialization - only load when needed
    ensureInitialized() {
        if (this.initialized) return;
        
        try {
            const files = fs.readdirSync(this.wordsDir).filter(f => f.endsWith('.json'));
            // Store file list for lazy loading
            for (const file of files) {
                const letter = file.replace('.json', '');
                this.fileCache.set(letter, path.join(this.wordsDir, file));
            }
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing word database:', error.message);
            this.initialized = true; // Mark as initialized even on error
        }
    }
    
    // Load word data on-demand
    getWordData(word) {
        this.ensureInitialized();
        
        const cleanWord = word.toLowerCase();
        
        // Check cache first
        if (this.wordCache.has(cleanWord)) {
            return this.wordCache.get(cleanWord);
        }
        
        // Determine which file to load
        const firstChar = cleanWord[0];
        let fileName = firstChar;
        
        // Handle special cases
        if (/\d/.test(firstChar)) {
            fileName = 'numbers';
        } else if (!/[a-z]/.test(firstChar)) {
            fileName = 'symbols';
        }
        
        const filePath = this.fileCache.get(fileName);
        if (!filePath) return null;
        
        // Load file if not in cache
        if (!this.fileCache.has(fileName + '_loaded')) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (data.words && Array.isArray(data.words)) {
                    for (const wordEntry of data.words) {
                        if (wordEntry.word && wordEntry.stats) {
                            this.wordCache.set(wordEntry.word.toLowerCase(), wordEntry.stats);
                        }
                    }
                }
                this.fileCache.set(fileName + '_loaded', true);
            } catch (error) {
                return null;
            }
        }
        
        return this.wordCache.get(cleanWord) || null;
    }
    
    async analyzeText(text) {
        const words = text.toLowerCase().split(/\s+/);
        const cleanWords = words.map(word => word.replace(/[^a-zA-Z0-9]/g, ''));
        
        // Analyze each word
        const wordAnalyses = [];
        const unknownWords = [];
        
        for (let i = 0; i < cleanWords.length; i++) {
            const originalWord = words[i];
            const cleanWord = cleanWords[i];
            
            if (!cleanWord || cleanWord.length < 1) {
                continue;
            }
            
            // Get word data using lazy loading
            const emotionData = this.getWordData(cleanWord);
            
            if (emotionData) {
                // Use real emotion data from database
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
                        // Cache this result for future use
                        this.wordCache.set(unknownWord.clean_word, deepseekResult);
                        
                        // Save to disk for persistence
                        await this.saveWordToFile(unknownWord.clean_word, deepseekResult);
                        
                        return { word: unknownWord.clean_word, result: deepseekResult };
                    }
                } catch (error) {
                    // Silent fail for optimization
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
        
        // Calculate overall emotion from word analyses (like original system)
        return this.calculateOverallEmotion(wordAnalyses, text);
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
            'what', 'where', 'when', 'why', 'how', 'who', 'which',
            'some', 'any', 'all', 'every', 'each', 'many', 'much', 'few', 'little',
            'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'first', 'second', 'third', 'last', 'next', 'previous',
            'here', 'there', 'now', 'then', 'today', 'yesterday', 'tomorrow',
            'up', 'down', 'left', 'right', 'over', 'under', 'above', 'below',
            'get', 'got', 'getting', 'go', 'going', 'went', 'gone',
            'come', 'coming', 'came', 'take', 'taking', 'took', 'taken',
            'make', 'making', 'made', 'give', 'giving', 'gave', 'given',
            'see', 'seeing', 'saw', 'seen', 'look', 'looking', 'looked',
            'know', 'knowing', 'knew', 'known', 'think', 'thinking', 'thought',
            'say', 'saying', 'said', 'tell', 'telling', 'told',
            'find', 'finding', 'found', 'work', 'working', 'worked',
            'use', 'using', 'used', 'try', 'trying', 'tried'
        ]);
        
        // Skip if it's a common neutral word
        if (neutralWords.has(word.toLowerCase())) {
            return false;
        }
        
        // Skip very short words (likely not emotionally significant)
        if (word.length < 3) {
            return false;
        }
        
        // Skip numbers
        if (/^\d+$/.test(word)) {
            return false;
        }
        
        // Process words that are likely to be emotionally significant
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
                    temperature: 0.1,
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
            return null;
        }
    }
    
    calculateOverallEmotion(wordAnalyses, text) {
        // Filter to only confident words (like original system)
        const CONFIDENCE_THRESHOLD = 0.25;
        const confidentWords = wordAnalyses.filter(w => w.found && w.confidence > CONFIDENCE_THRESHOLD);
        
        if (confidentWords.length === 0) {
            // No confident words - return neutral (like original)
            return this.getNeutralResult(wordAnalyses, text);
        }
        
        // Weighted emotion calculation (like original system)
        const emotionWeights = {
            joy: 0, trust: 0, anticipation: 0, surprise: 0,
            anger: 0, fear: 0, sadness: 0, disgust: 0
        };
        
        for (const wordData of confidentWords) {
            const emotionProbs = wordData.emotion_probs || this.getDefaultEmotionProbs(wordData.emotion);
            
            // Apply amplification for strong emotions (like original)
            let amplification = 1.0;
            if (wordData.confidence > 0.5) {
                amplification = 3.0; // Very strong emotional word
            } else if (wordData.confidence > 0.3) {
                amplification = 2.5; // Strong emotional word
            } else {
                amplification = 2.0; // Moderate emotional word
            }
            
            // Add weighted scores
            for (const emotion of Object.keys(emotionWeights)) {
                const baseScore = emotionProbs[emotion] || 0.125;
                const weightedScore = emotion === wordData.emotion ? 
                    baseScore * amplification : baseScore;
                emotionWeights[emotion] += weightedScore;
            }
        }
        
        // Normalize the weighted scores
        const totalWeight = Object.values(emotionWeights).reduce((a, b) => a + b, 0);
        const emotions = {};
        
        if (totalWeight > 0) {
            for (const emotion of Object.keys(emotionWeights)) {
                emotions[emotion] = emotionWeights[emotion] / totalWeight;
            }
        } else {
            // Fallback to neutral
            for (const emotion of Object.keys(emotionWeights)) {
                emotions[emotion] = 0.125;
            }
        }
        
        // Apply context adjustments (like original system)
        const adjustedEmotions = this.applyContextAdjustments(emotions, confidentWords, text);
        
        // Get dominant emotion
        const dominantEmotion = Object.keys(adjustedEmotions).reduce((a, b) => 
            adjustedEmotions[a] > adjustedEmotions[b] ? a : b
        );
        
        // Calculate aggregate VAD
        const vad = this.calculateAggregateVAD(confidentWords);
        
        // Calculate sentiment
        const sentiment = this.calculateSentiment(confidentWords);
        
        return {
            overall_emotion: dominantEmotion,
            confidence: adjustedEmotions[dominantEmotion],
            emotions: adjustedEmotions,
            word_analysis: wordAnalyses,
            word_count: wordAnalyses.length,
            analyzed_words: confidentWords.length,
            coverage: confidentWords.length / wordAnalyses.length,
            vad: vad,
            sentiment: sentiment,
            processing_method: 'javascript_with_real_database'
        };
    }
    
    getDefaultEmotionProbs(emotion) {
        const defaultProbs = {
            joy: 0.125, trust: 0.125, anticipation: 0.125, surprise: 0.125,
            anger: 0.125, fear: 0.125, sadness: 0.125, disgust: 0.125
        };
        
        if (emotion && emotion !== 'neutral') {
            defaultProbs[emotion] = 0.8;
            const remaining = 0.2 / 7;
            for (const emo of Object.keys(defaultProbs)) {
                if (emo !== emotion) {
                    defaultProbs[emo] = remaining;
                }
            }
        }
        
        return defaultProbs;
    }
    
    applyContextAdjustments(emotions, confidentWords, text) {
        // Apply context patterns (like original system)
        const textLower = text.toLowerCase();
        const adjustedEmotions = { ...emotions };
        
        // Context patterns that boost specific emotions
        const contextPatterns = {
            anger: [['hate', 'angry', 'mad', 'furious'], ['damn', 'shit', 'stupid']],
            joy: [['love', 'happy', 'excited', 'amazing'], ['yes', 'awesome', 'fantastic']],
            sadness: [['sad', 'cry', 'tears', 'depressed'], ['sorry', 'disappointed']],
            fear: [['scared', 'afraid', 'worried', 'anxious'], ['danger', 'threat']],
            surprise: [['wow', 'omg', 'incredible', 'shocking'], ['sudden', 'unexpected']],
            disgust: [['gross', 'disgusting', 'nasty', 'awful'], ['sick', 'yuck']],
            trust: [['trust', 'reliable', 'honest', 'faithful'], ['sure', 'certain']],
            anticipation: [['excited', 'can\'t wait', 'looking forward'], ['hope', 'expect']]
        };
        
        // Apply pattern-based boosts
        for (const [emotion, patternGroups] of Object.entries(contextPatterns)) {
            let boostFactor = 0.0;
            
            for (const patterns of patternGroups) {
                const matches = patterns.filter(pattern => textLower.includes(pattern)).length;
                if (matches > 0) {
                    boostFactor += matches * 0.15;
                }
            }
            
            if (boostFactor > 0) {
                adjustedEmotions[emotion] = Math.min(adjustedEmotions[emotion] + boostFactor, 0.8);
            }
        }
        
        // Normalize after adjustments
        const total = Object.values(adjustedEmotions).reduce((a, b) => a + b, 0);
        if (total > 0) {
            for (const emotion of Object.keys(adjustedEmotions)) {
                adjustedEmotions[emotion] = adjustedEmotions[emotion] / total;
            }
        }
        
        return adjustedEmotions;
    }
    
    calculateAggregateVAD(confidentWords) {
        if (confidentWords.length === 0) {
            return { valence: 0.5, arousal: 0.5, dominance: 0.5 };
        }
        
        const vad = { valence: 0, arousal: 0, dominance: 0 };
        
        for (const word of confidentWords) {
            vad.valence += word.valence || 0.5;
            vad.arousal += word.arousal || 0.5;
            vad.dominance += (word.dominance || 0.5);
        }
        
        return {
            valence: vad.valence / confidentWords.length,
            arousal: vad.arousal / confidentWords.length,
            dominance: vad.dominance / confidentWords.length
        };
    }
    
    calculateSentiment(confidentWords) {
        if (confidentWords.length === 0) {
            return { polarity: 'neutral', strength: 0.5 };
        }
        
        let positiveCount = 0;
        let negativeCount = 0;
        let strengthSum = 0;
        
        for (const word of confidentWords) {
            if (word.sentiment === 'positive') positiveCount++;
            else if (word.sentiment === 'negative') negativeCount++;
            
            strengthSum += word.confidence || 0.5;
        }
        
        let polarity = 'neutral';
        if (positiveCount > negativeCount) polarity = 'positive';
        else if (negativeCount > positiveCount) polarity = 'negative';
        
        return {
            polarity: polarity,
            strength: strengthSum / confidentWords.length
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
    
    getDatabaseStats() {
        this.ensureInitialized();
        return {
            total_words: this.wordCache.size,
            available_files: this.fileCache.size,
            deepseek_available: !!this.deepseekApiKey
        };
    }
    
    getFilenameForWord(word) {
        const firstChar = word[0].toLowerCase();
        if (/[a-z]/.test(firstChar)) {
            return `${firstChar}.json`;
        } else if (/\d/.test(firstChar)) {
            return 'numbers.json';
        } else {
            return 'symbols.json';
        }
    }
    
    async saveWordToFile(word, emotionData) {
        try {
            const filename = this.getFilenameForWord(word);
            const filepath = path.join(this.wordsDir, filename);
            
            // Read existing data
            let data = { words: [] };
            if (fs.existsSync(filepath)) {
                try {
                    const fileContent = fs.readFileSync(filepath, 'utf8');
                    data = JSON.parse(fileContent);
                } catch (readError) {
                    console.warn(`Error reading ${filename}, creating new file:`, readError.message);
                }
            }
            
            // Check if word already exists
            const existingIndex = data.words.findIndex(entry => 
                entry.word && entry.word.toLowerCase() === word.toLowerCase()
            );
            
            if (existingIndex !== -1) {
                // Word already exists, skip
                console.log(`Word "${word}" already exists in database`);
                return true;
            }
            
            // Add new word with full structure matching the database format
            const newWordEntry = {
                word: word,
                stats: {
                    pos: ["noun"], // Default part of speech
                    vad: emotionData.vad || { valence: 0.5, arousal: 0.5, dominance: 0.5 },
                    emotion_probs: emotionData.emotion_probs,
                    sentiment: emotionData.sentiment || { polarity: "neutral", strength: 0.5 },
                    social_axes: {
                        good_bad: 0.0,
                        warmth_cold: 0.0,
                        competence_incompetence: 0.0,
                        active_passive: 0.0
                    },
                    toxicity: 0.0,
                    dynamics: {
                        negation_flip_probability: 0.0,
                        sarcasm_flip_probability: 0.0
                    }
                }
            };
            
            data.words.push(newWordEntry);
            
            // Sort words alphabetically
            data.words.sort((a, b) => {
                const wordA = (a.word || '').toLowerCase();
                const wordB = (b.word || '').toLowerCase();
                return wordA.localeCompare(wordB);
            });
            
            // Write back to file
            fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`✅ Saved word "${word}" to ${filename}`);
            
            return true;
        } catch (error) {
            console.error(`Error saving word "${word}" to file:`, error.message);
            return false;
        }
    }
}

// Global instance
const emotionEngine = new EmotionEngine();

module.exports = { emotionEngine };

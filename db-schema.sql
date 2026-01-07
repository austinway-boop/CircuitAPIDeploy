-- Circuit Emotion Analysis Database Schema
-- PostgreSQL database for word emotion data and API processing logs

-- Words table: stores emotion data for each word
CREATE TABLE IF NOT EXISTS words (
    id SERIAL PRIMARY KEY,
    word VARCHAR(255) UNIQUE NOT NULL,
    pos TEXT[], -- part of speech tags
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
    good_bad DECIMAL(5,4) DEFAULT 0.0,
    warmth_cold DECIMAL(5,4) DEFAULT 0.0,
    competence_incompetence DECIMAL(5,4) DEFAULT 0.0,
    active_passive DECIMAL(5,4) DEFAULT 0.0,
    toxicity DECIMAL(5,4) DEFAULT 0.0,
    negation_flip_probability DECIMAL(5,4) DEFAULT 0.0,
    sarcasm_flip_probability DECIMAL(5,4) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast word lookups
CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
CREATE INDEX IF NOT EXISTS idx_words_lowercase ON words(LOWER(word));

-- API processing logs table: stores all text analysis requests
CREATE TABLE IF NOT EXISTS api_processing_logs (
    id SERIAL PRIMARY KEY,
    request_id VARCHAR(100),
    api_key_hash VARCHAR(64), -- hashed for privacy
    input_text TEXT NOT NULL,
    word_count INTEGER,
    analyzed_words INTEGER,
    overall_emotion VARCHAR(50),
    confidence DECIMAL(5,4),
    emotions JSONB, -- full emotion breakdown
    word_analysis JSONB, -- per-word analysis
    vad JSONB, -- valence-arousal-dominance
    sentiment JSONB,
    processing_time_ms INTEGER,
    deepseek_calls INTEGER DEFAULT 0,
    new_words_added INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON api_processing_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_emotion ON api_processing_logs(overall_emotion);
CREATE INDEX IF NOT EXISTS idx_logs_api_key ON api_processing_logs(api_key_hash);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_words_updated_at BEFORE UPDATE ON words
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for word statistics
CREATE OR REPLACE VIEW word_stats AS
SELECT 
    COUNT(*) as total_words,
    COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as words_added_last_7_days,
    COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as words_added_last_30_days,
    AVG(valence) as avg_valence,
    AVG(arousal) as avg_arousal,
    AVG(dominance) as avg_dominance
FROM words;

-- View for API usage statistics
CREATE OR REPLACE VIEW api_usage_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_requests,
    AVG(processing_time_ms) as avg_processing_time_ms,
    SUM(deepseek_calls) as total_deepseek_calls,
    SUM(new_words_added) as total_new_words,
    COUNT(DISTINCT api_key_hash) as unique_users
FROM api_processing_logs
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Grant permissions (adjust username as needed)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO db;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO db;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO db;


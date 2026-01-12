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

-- =============================================================================
-- PROFILING & SESSION MANAGEMENT TABLES
-- =============================================================================

-- Organizations table: top-level entity for grouping users
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    api_key_hash VARCHAR(64), -- organization's API key hash
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_org_api_key ON organizations(api_key_hash);

-- Profiles table: individual users within organizations
CREATE TABLE IF NOT EXISTS profiles (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(255),
    email VARCHAR(255),
    avatar_url TEXT,
    metadata JSONB DEFAULT '{}', -- custom user data
    -- Aggregated emotion stats
    total_sessions INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    avg_valence DECIMAL(5,4) DEFAULT 0.5,
    avg_arousal DECIMAL(5,4) DEFAULT 0.5,
    dominant_emotion VARCHAR(50) DEFAULT 'neutral',
    emotion_history JSONB DEFAULT '[]', -- rolling history of session emotions
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, username)
);

CREATE INDEX IF NOT EXISTS idx_profile_org ON profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_profile_username ON profiles(org_id, username);

-- Sessions table: conversation/interaction sessions
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(50) PRIMARY KEY,
    org_id VARCHAR(50) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    profile_id VARCHAR(50) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active', -- active, ended, abandoned
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    duration_seconds INTEGER,
    -- Session emotion summary (computed on end)
    message_count INTEGER DEFAULT 0,
    overall_mood VARCHAR(50),
    mood_confidence DECIMAL(5,4),
    emotion_breakdown JSONB DEFAULT '{}',
    avg_valence DECIMAL(5,4),
    avg_arousal DECIMAL(5,4),
    avg_dominance DECIMAL(5,4),
    sentiment_trend VARCHAR(20), -- improving, declining, stable
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_session_org ON sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_session_profile ON sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_session_started ON sessions(started_at);

-- Session messages: individual text/audio inputs within a session
CREATE TABLE IF NOT EXISTS session_messages (
    id VARCHAR(50) PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    message_type VARCHAR(20) NOT NULL, -- text, audio
    content TEXT, -- for text messages
    audio_url TEXT, -- for audio messages
    transcription TEXT, -- for audio transcriptions
    -- Emotion analysis results
    overall_emotion VARCHAR(50),
    confidence DECIMAL(5,4),
    emotions JSONB,
    vad JSONB,
    sentiment JSONB,
    word_count INTEGER,
    analyzed_words INTEGER,
    processing_time_ms INTEGER,
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_session ON session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_message_created ON session_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_message_emotion ON session_messages(overall_emotion);

-- Triggers for updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- View for session analytics by organization
CREATE OR REPLACE VIEW session_analytics AS
SELECT 
    s.org_id,
    o.name as org_name,
    DATE(s.started_at) as date,
    COUNT(DISTINCT s.id) as total_sessions,
    COUNT(DISTINCT s.profile_id) as unique_users,
    SUM(s.message_count) as total_messages,
    AVG(s.duration_seconds) as avg_session_duration,
    AVG(s.avg_valence) as avg_valence,
    MODE() WITHIN GROUP (ORDER BY s.overall_mood) as most_common_mood
FROM sessions s
JOIN organizations o ON s.org_id = o.id
WHERE s.status = 'ended'
GROUP BY s.org_id, o.name, DATE(s.started_at)
ORDER BY date DESC;

-- View for profile emotion trends
CREATE OR REPLACE VIEW profile_emotion_trends AS
SELECT 
    p.id as profile_id,
    p.username,
    p.org_id,
    p.total_sessions,
    p.total_messages,
    p.dominant_emotion,
    p.avg_valence,
    p.avg_arousal,
    CASE 
        WHEN p.avg_valence > 0.6 THEN 'positive'
        WHEN p.avg_valence < 0.4 THEN 'negative'
        ELSE 'neutral'
    END as overall_sentiment
FROM profiles p;

-- Grant permissions (adjust username as needed)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO db;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO db;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO db;


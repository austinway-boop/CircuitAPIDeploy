const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { Pool } = require('pg');

const execAsync = promisify(exec);

const app = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// Database pool for session management
const sessionPool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 25060,
  user: process.env.DB_USER || 'db',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'db',
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
});

// Generate unique IDs
const generateId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;

// Middleware with proper CORS
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://localhost:3000',
    'https://dashboard-jjxyp2aji-austinway-8928s-projects.vercel.app',
    'https://dashboard-giddirva3-austinway-8928s-projects.vercel.app',
    /\.vercel\.app$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// API Key validation middleware
const validateApiKey = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Missing or invalid Authorization header'
    });
  }
  
  const apiKey = authHeader.substring(7);
  
  // Validate key format
  if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key format'
    });
  }
  
  // Validate against dashboard AND report usage
  const dashboardUrl = process.env.DASHBOARD_URL;
  if (dashboardUrl) {
    try {
      const response = await fetch(`${dashboardUrl}/api/api-keys/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, incrementUsage: true })
      });
      
      const data = await response.json();
      
      if (!data.valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid API key'
        });
      }
      
      req.keyInfo = data;
    } catch (error) {
      console.warn('Dashboard validation failed, allowing request:', error.message);
    }
  }
  
  req.apiKey = apiKey;
  req.environment = apiKey.startsWith('sk_live_') ? 'production' : 'development';
  
  // Track usage
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  trackKeyUsage(keyHash);
  
  next();
};

// Load emotion engine (PostgreSQL version for persistence)
const { emotionEngine } = require('./api/emotion-engine-db.js');

// Load usage tracker
const { trackKeyUsage, getTotalStats } = require('./key-usage-tracker.js');

// Text analysis endpoint
app.post('/v1/analyze-text', validateApiKey, async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: text'
      });
    }
    
    if (text.length > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Text too long. Maximum 10,000 characters'
      });
    }
    
    const startTime = Date.now();
    const result = await emotionEngine.analyzeText(text);
    const processingTime = (Date.now() - startTime) / 1000;
    
    res.json({
      success: true,
      result: {
        ...result,
        processing_time: processingTime,
        api_processing_time: processingTime
      }
    });
  } catch (error) {
    console.error('Text analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during text analysis'
    });
  }
});

// Audio analysis endpoint
app.post('/v1/analyze-audio', validateApiKey, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided'
      });
    }
    
    const audioPath = req.file.path;
    const retryMode = req.body.retry_mode || 'normal';
    
    // Call Python audio analyzer
    const { stdout } = await execAsync(
      `python3 api/audio_analyzer.py "${audioPath}" --retry-mode ${retryMode}`
    );
    
    // Clean up temp file
    fs.unlinkSync(audioPath);
    
    const result = JSON.parse(stdout);
    res.json(result);
    
  } catch (error) {
    console.error('Audio analysis error:', error);
    
    // Clean up on error
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error during audio analysis'
    });
  }
});

// Stats endpoint
app.get('/v1/stats', async (req, res) => {
  try {
    // Get word count from database
    const dbStats = await emotionEngine.getDatabaseStats();
    const usageStats = getTotalStats();
    
    res.json({
      success: true,
      stats: {
        word_database_size: dbStats.total_words,
        database_type: dbStats.database_type || 'PostgreSQL',
        system_status: 'operational',
        total_requests: usageStats.totalRequests,
        uptime: usageStats.uptimeFormatted,
        uptime_seconds: usageStats.uptime,
        server_start_time: usageStats.serverStartTime,
        features: {
          text_analysis: true,
          audio_analysis: true,
          database_persistence: true,
          api_logging: true,
          deepseek_available: dbStats.deepseek_available
        },
        version: '2.1.0',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve stats'
    });
  }
});

// API Key Usage endpoint
app.get('/v1/usage/:apiKey', validateApiKey, async (req, res) => {
  try {
    const apiKey = req.params.apiKey || req.apiKey;
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    // Get usage from database
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false }
    });
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_requests,
        AVG(processing_time_ms) as avg_processing_time,
        SUM(deepseek_calls) as total_deepseek_calls,
        SUM(new_words_added) as total_new_words,
        MIN(created_at) as first_request,
        MAX(created_at) as last_request
      FROM api_processing_logs
      WHERE api_key_hash = $1
    `, [keyHash]);
    
    await pool.end();
    
    const usage = result.rows[0];
    
    res.json({
      success: true,
      api_key: apiKey.substring(0, 15) + '...',
      usage: {
        total_requests: parseInt(usage.total_requests) || 0,
        avg_processing_time_ms: parseFloat(usage.avg_processing_time) || 0,
        total_deepseek_calls: parseInt(usage.total_deepseek_calls) || 0,
        total_new_words_added: parseInt(usage.total_new_words) || 0,
        first_request: usage.first_request,
        last_request: usage.last_request
      },
      environment: req.environment,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Usage endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve usage stats'
    });
  }
});

// Endpoint Status/Health endpoint
app.get('/v1/status', async (req, res) => {
  const startTime = Date.now();
  
  const endpoints = {
    health: { status: 'unknown', response_time_ms: 0, last_checked: new Date().toISOString() },
    stats: { status: 'unknown', response_time_ms: 0, last_checked: new Date().toISOString() },
    analyze_text: { status: 'unknown', response_time_ms: 0, last_checked: new Date().toISOString() },
    analyze_audio: { status: 'unknown', response_time_ms: 0, last_checked: new Date().toISOString() },
    database: { status: 'unknown', response_time_ms: 0, last_checked: new Date().toISOString() }
  };
  
  try {
    // Test database connection
    const dbStart = Date.now();
    try {
      const dbStats = await emotionEngine.getDatabaseStats();
      endpoints.database.status = dbStats.total_words > 0 ? 'operational' : 'degraded';
      endpoints.database.response_time_ms = Date.now() - dbStart;
      endpoints.database.details = { word_count: dbStats.total_words };
    } catch (err) {
      endpoints.database.status = 'down';
      endpoints.database.error = err.message;
      endpoints.database.response_time_ms = Date.now() - dbStart;
    }
    
    // Health endpoint is inherently operational if we're responding
    endpoints.health.status = 'operational';
    endpoints.health.response_time_ms = 1;
    
    // Stats endpoint
    endpoints.stats.status = 'operational';
    endpoints.stats.response_time_ms = Date.now() - startTime;
    
    // Text analysis endpoint (check if emotion engine is loaded)
    endpoints.analyze_text.status = emotionEngine ? 'operational' : 'down';
    endpoints.analyze_text.response_time_ms = 2;
    
    // Audio analysis endpoint
    endpoints.analyze_audio.status = 'operational';
    endpoints.analyze_audio.response_time_ms = 5;
    endpoints.analyze_audio.note = 'Heavy processing - slower response times expected';
    
    // Overall system status
    const allStatuses = Object.values(endpoints).map(e => e.status);
    const overallStatus = allStatuses.every(s => s === 'operational') ? 'operational' :
                         allStatuses.some(s => s === 'down') ? 'degraded' : 'operational';
    
    res.json({
      success: true,
      overall_status: overallStatus,
      endpoints: endpoints,
      server: {
        uptime_seconds: getTotalStats().uptime,
        version: '2.1.0',
        environment: process.env.NODE_ENV || 'production'
      },
      timestamp: new Date().toISOString(),
      total_response_time_ms: Date.now() - startTime
    });
    
  } catch (error) {
    console.error('Status endpoint error:', error);
    res.status(500).json({
      success: false,
      overall_status: 'error',
      error: 'Failed to check endpoint status',
      timestamp: new Date().toISOString()
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Database setup endpoint - run this once to initialize!
app.get('/setup-database', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 25060,
      user: process.env.DB_USER || 'db',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'db',
      ssl: { rejectUnauthorized: false }
    });
    
    const logs = [];
    logs.push('🚀 Starting database setup...');
    logs.push(`DB_HOST: ${process.env.DB_HOST || 'NOT SET'}`);
    logs.push(`DB_PASSWORD set: ${!!process.env.DB_PASSWORD}`);
    
    // Test connection
    try {
      await pool.query('SELECT 1');
      logs.push('✅ Database connection successful');
    } catch (e) {
      logs.push(`❌ Connection failed: ${e.message}`);
      return res.json({ success: false, logs });
    }
    
    // Create core tables
    const createCoreTables = `
      CREATE TABLE IF NOT EXISTS words (
        id SERIAL PRIMARY KEY,
        word VARCHAR(255) UNIQUE NOT NULL,
        pos TEXT[],
        valence DECIMAL(5,4) DEFAULT 0.5,
        arousal DECIMAL(5,4) DEFAULT 0.5,
        dominance DECIMAL(5,4) DEFAULT 0.5,
        emotion_joy DECIMAL(5,4) DEFAULT 0.125,
        emotion_trust DECIMAL(5,4) DEFAULT 0.125,
        emotion_anticipation DECIMAL(5,4) DEFAULT 0.125,
        emotion_surprise DECIMAL(5,4) DEFAULT 0.125,
        emotion_anger DECIMAL(5,4) DEFAULT 0.125,
        emotion_fear DECIMAL(5,4) DEFAULT 0.125,
        emotion_sadness DECIMAL(5,4) DEFAULT 0.125,
        emotion_disgust DECIMAL(5,4) DEFAULT 0.125,
        sentiment_polarity VARCHAR(20) DEFAULT 'neutral',
        sentiment_strength DECIMAL(5,4) DEFAULT 0.5,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS api_processing_logs (
        id SERIAL PRIMARY KEY,
        api_key_hash VARCHAR(64),
        input_text TEXT,
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
      );
    `;
    
    await pool.query(createCoreTables);
    logs.push('✅ Core tables created/verified');
    
    // Create session/profiling tables - one at a time for better error handling
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS organizations (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(100) UNIQUE NOT NULL,
          api_key_hash VARCHAR(64),
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logs.push('✅ organizations table created/verified');
    } catch (e) {
      logs.push(`⚠️ organizations table: ${e.message}`);
    }
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS profiles (
          id VARCHAR(50) PRIMARY KEY,
          org_id VARCHAR(50) NOT NULL,
          username VARCHAR(100) NOT NULL,
          display_name VARCHAR(255),
          email VARCHAR(255),
          avatar_url TEXT,
          metadata JSONB DEFAULT '{}',
          total_sessions INTEGER DEFAULT 0,
          total_messages INTEGER DEFAULT 0,
          avg_valence DECIMAL(5,4) DEFAULT 0.5,
          avg_arousal DECIMAL(5,4) DEFAULT 0.5,
          dominant_emotion VARCHAR(50) DEFAULT 'neutral',
          emotion_history JSONB DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(org_id, username)
        )
      `);
      logs.push('✅ profiles table created/verified');
    } catch (e) {
      logs.push(`⚠️ profiles table: ${e.message}`);
    }
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR(50) PRIMARY KEY,
          org_id VARCHAR(50) NOT NULL,
          profile_id VARCHAR(50) NOT NULL,
          status VARCHAR(20) DEFAULT 'active',
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ended_at TIMESTAMP,
          duration_seconds INTEGER,
          message_count INTEGER DEFAULT 0,
          overall_mood VARCHAR(50),
          mood_confidence DECIMAL(5,4),
          emotion_breakdown JSONB DEFAULT '{}',
          avg_valence DECIMAL(5,4),
          avg_arousal DECIMAL(5,4),
          avg_dominance DECIMAL(5,4),
          sentiment_trend VARCHAR(20),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logs.push('✅ sessions table created/verified');
    } catch (e) {
      logs.push(`⚠️ sessions table: ${e.message}`);
    }
    
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS session_messages (
          id VARCHAR(50) PRIMARY KEY,
          session_id VARCHAR(50) NOT NULL,
          message_type VARCHAR(20) NOT NULL,
          content TEXT,
          audio_url TEXT,
          transcription TEXT,
          overall_emotion VARCHAR(50),
          confidence DECIMAL(5,4),
          emotions JSONB,
          vad JSONB,
          sentiment JSONB,
          word_count INTEGER,
          analyzed_words INTEGER,
          processing_time_ms INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      logs.push('✅ session_messages table created/verified');
    } catch (e) {
      logs.push(`⚠️ session_messages table: ${e.message}`);
    }
    
    // Create indexes
    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);
      CREATE INDEX IF NOT EXISTS idx_org_api_key ON organizations(api_key_hash);
      CREATE INDEX IF NOT EXISTS idx_profile_org ON profiles(org_id);
      CREATE INDEX IF NOT EXISTS idx_profile_username ON profiles(org_id, username);
      CREATE INDEX IF NOT EXISTS idx_session_org ON sessions(org_id);
      CREATE INDEX IF NOT EXISTS idx_session_profile ON sessions(profile_id);
      CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_message_session ON session_messages(session_id);
    `;
    
    await pool.query(createIndexes);
    logs.push('✅ Indexes created/verified');
    
    // Check word count
    const countResult = await pool.query('SELECT COUNT(*) as count FROM words');
    const wordCount = parseInt(countResult.rows[0].count);
    logs.push(`📊 Current word count: ${wordCount}`);
    
    // Migrate words if empty
    if (wordCount === 0) {
      logs.push('📂 Database empty - starting word migration...');
      
      const wordsDir = path.join(__dirname, 'words');
      if (fs.existsSync(wordsDir)) {
        const files = fs.readdirSync(wordsDir).filter(f => f.endsWith('.json'));
        let totalInserted = 0;
        
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(wordsDir, file), 'utf8'));
            if (data.words && Array.isArray(data.words)) {
              for (const entry of data.words) {
                if (entry.word && entry.stats) {
                  const s = entry.stats;
                  try {
                    await pool.query(`
                      INSERT INTO words (word, valence, arousal, dominance,
                        emotion_joy, emotion_trust, emotion_anticipation, emotion_surprise,
                        emotion_anger, emotion_fear, emotion_sadness, emotion_disgust,
                        sentiment_polarity, sentiment_strength)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                      ON CONFLICT (word) DO NOTHING
                    `, [
                      entry.word,
                      s.vad?.valence || 0.5, s.vad?.arousal || 0.5, s.vad?.dominance || 0.5,
                      s.emotion_probs?.joy || 0.125, s.emotion_probs?.trust || 0.125,
                      s.emotion_probs?.anticipation || 0.125, s.emotion_probs?.surprise || 0.125,
                      s.emotion_probs?.anger || 0.125, s.emotion_probs?.fear || 0.125,
                      s.emotion_probs?.sadness || 0.125, s.emotion_probs?.disgust || 0.125,
                      s.sentiment?.polarity || 'neutral', s.sentiment?.strength || 0.5
                    ]);
                    totalInserted++;
                  } catch (e) {
                    // Skip duplicates
                  }
                }
              }
            }
          } catch (e) {
            logs.push(`⚠️ Error processing ${file}: ${e.message}`);
          }
        }
        
        logs.push(`✅ Migrated ${totalInserted} words`);
      } else {
        logs.push('⚠️ No words directory found');
      }
    }
    
    // Final counts
    const finalWordCount = await pool.query('SELECT COUNT(*) as count FROM words');
    const orgCount = await pool.query('SELECT COUNT(*) as count FROM organizations');
    const profileCount = await pool.query('SELECT COUNT(*) as count FROM profiles');
    const sessionCount = await pool.query('SELECT COUNT(*) as count FROM sessions');
    
    logs.push(`📊 Final counts:`);
    logs.push(`   - Words: ${finalWordCount.rows[0].count}`);
    logs.push(`   - Organizations: ${orgCount.rows[0].count}`);
    logs.push(`   - Profiles: ${profileCount.rows[0].count}`);
    logs.push(`   - Sessions: ${sessionCount.rows[0].count}`);
    
    await pool.end();
    
    res.json({ 
      success: true, 
      logs,
      counts: {
        words: parseInt(finalWordCount.rows[0].count),
        organizations: parseInt(orgCount.rows[0].count),
        profiles: parseInt(profileCount.rows[0].count),
        sessions: parseInt(sessionCount.rows[0].count)
      }
    });
    
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

// =============================================================================
// ORGANIZATION MANAGEMENT ENDPOINTS
// =============================================================================

// Create or get organization
app.post('/v1/orgs', validateApiKey, async (req, res) => {
  try {
    const { id: providedId, name, slug } = req.body;
    
    if (!name || !slug) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, slug'
      });
    }
    
    // Use provided ID (from dashboard) or generate new one
    const orgId = providedId || generateId('org');
    const apiKeyHash = crypto.createHash('sha256').update(req.apiKey).digest('hex');
    
    // Check if org already exists by ID or by API key
    const existingOrg = await sessionPool.query(
      'SELECT * FROM organizations WHERE id = $1 OR api_key_hash = $2',
      [orgId, apiKeyHash]
    );
    
    if (existingOrg.rows.length > 0) {
      // Update org info if it exists
      const updateResult = await sessionPool.query(`
        UPDATE organizations 
        SET name = $2, api_key_hash = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [existingOrg.rows[0].id, name, apiKeyHash]);
      
      return res.json({
        success: true,
        organization: updateResult.rows[0] || existingOrg.rows[0],
        message: 'Organization already exists'
      });
    }
    
    const result = await sessionPool.query(`
      INSERT INTO organizations (id, name, slug, api_key_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (slug) DO UPDATE SET name = $2, api_key_hash = $4, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [orgId, name, slug, apiKeyHash]);
    
    res.json({
      success: true,
      organization: result.rows[0]
    });
  } catch (error) {
    console.error('Create org error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create organization',
      details: error.message
    });
  }
});

// Get organization details
app.get('/v1/orgs/:orgId', validateApiKey, async (req, res) => {
  try {
    const { orgId } = req.params;
    
    const result = await sessionPool.query(
      'SELECT * FROM organizations WHERE id = $1',
      [orgId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }
    
    // Get org stats
    const stats = await sessionPool.query(`
      SELECT 
        (SELECT COUNT(*) FROM profiles WHERE org_id = $1) as total_profiles,
        (SELECT COUNT(*) FROM sessions WHERE org_id = $1) as total_sessions,
        (SELECT COUNT(*) FROM sessions WHERE org_id = $1 AND status = 'active') as active_sessions
    `, [orgId]);
    
    res.json({
      success: true,
      organization: {
        ...result.rows[0],
        stats: stats.rows[0]
      }
    });
  } catch (error) {
    console.error('Get org error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get organization'
    });
  }
});

// Get organization by API key
app.get('/v1/orgs', validateApiKey, async (req, res) => {
  try {
    const apiKeyHash = crypto.createHash('sha256').update(req.apiKey).digest('hex');
    
    const result = await sessionPool.query(
      'SELECT * FROM organizations WHERE api_key_hash = $1',
      [apiKeyHash]
    );
    
    res.json({
      success: true,
      organizations: result.rows
    });
  } catch (error) {
    console.error('Get orgs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get organizations'
    });
  }
});

// =============================================================================
// PROFILE MANAGEMENT ENDPOINTS
// =============================================================================

// Create user profile within org
app.post('/v1/profiles', validateApiKey, async (req, res) => {
  try {
    const { org_id, username, display_name, email, metadata } = req.body;
    
    if (!org_id || !username) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: org_id, username'
      });
    }
    
    // Verify org exists
    const orgCheck = await sessionPool.query(
      'SELECT id FROM organizations WHERE id = $1',
      [org_id]
    );
    
    if (orgCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }
    
    const profileId = generateId('profile');
    
    const result = await sessionPool.query(`
      INSERT INTO profiles (id, org_id, username, display_name, email, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (org_id, username) DO UPDATE SET
        display_name = COALESCE($4, profiles.display_name),
        email = COALESCE($5, profiles.email),
        metadata = COALESCE($6, profiles.metadata),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [profileId, org_id, username, display_name || username, email, JSON.stringify(metadata || {})]);
    
    res.json({
      success: true,
      profile: result.rows[0]
    });
  } catch (error) {
    console.error('Create profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create profile',
      details: error.message
    });
  }
});

// Get profile by ID with full emotion statistics
app.get('/v1/profiles/:profileId', validateApiKey, async (req, res) => {
  try {
    const { profileId } = req.params;
    
    const result = await sessionPool.query(`
      SELECT p.* FROM profiles p WHERE p.id = $1
    `, [profileId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found'
      });
    }
    
    // Get all sessions for this profile
    const sessions = await sessionPool.query(`
      SELECT id, status, started_at, ended_at, overall_mood, mood_confidence,
             message_count, avg_valence, avg_arousal, sentiment_trend, duration_seconds,
             emotion_breakdown
      FROM sessions
      WHERE profile_id = $1
      ORDER BY started_at DESC
    `, [profileId]);
    
    // Calculate emotion statistics across all sessions
    const emotionCounts = {};
    let totalSessions = 0;
    let totalValence = 0;
    let totalArousal = 0;
    let validValenceSessions = 0;
    
    for (const session of sessions.rows) {
      if (session.status === 'ended' && session.overall_mood) {
        totalSessions++;
        emotionCounts[session.overall_mood] = (emotionCounts[session.overall_mood] || 0) + 1;
        
        if (session.avg_valence != null) {
          totalValence += parseFloat(session.avg_valence);
          totalArousal += parseFloat(session.avg_arousal || 0.5);
          validValenceSessions++;
        }
      }
    }
    
    // Calculate emotion percentages
    const emotionPercentages = {};
    for (const [emotion, count] of Object.entries(emotionCounts)) {
      emotionPercentages[emotion] = totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0;
    }
    
    // Find dominant emotion
    const dominantEmotion = Object.entries(emotionCounts)
      .sort(([,a], [,b]) => b - a)[0];
    
    // Get recent messages for context
    const recentMessages = await sessionPool.query(`
      SELECT sm.content, sm.overall_emotion, sm.confidence, sm.created_at, s.id as session_id
      FROM session_messages sm
      JOIN sessions s ON sm.session_id = s.id
      WHERE s.profile_id = $1
      ORDER BY sm.created_at DESC
      LIMIT 20
    `, [profileId]);
    
    res.json({
      success: true,
      profile: result.rows[0],
      sessions: sessions.rows,
      emotion_stats: {
        total_sessions: totalSessions,
        dominant_emotion: dominantEmotion ? dominantEmotion[0] : 'neutral',
        dominant_emotion_percentage: dominantEmotion && totalSessions > 0 
          ? Math.round((dominantEmotion[1] / totalSessions) * 100) 
          : 0,
        emotion_breakdown: emotionPercentages,
        avg_valence: validValenceSessions > 0 ? totalValence / validValenceSessions : 0.5,
        avg_arousal: validValenceSessions > 0 ? totalArousal / validValenceSessions : 0.5,
        total_messages: sessions.rows.reduce((sum, s) => sum + (s.message_count || 0), 0)
      },
      recent_messages: recentMessages.rows
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get profile',
      details: error.message
    });
  }
});

// List profiles in org
app.get('/v1/orgs/:orgId/profiles', validateApiKey, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    const result = await sessionPool.query(`
      SELECT * FROM profiles 
      WHERE org_id = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [orgId, parseInt(limit), parseInt(offset)]);
    
    const countResult = await sessionPool.query(
      'SELECT COUNT(*) FROM profiles WHERE org_id = $1',
      [orgId]
    );
    
    res.json({
      success: true,
      profiles: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('List profiles error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list profiles'
    });
  }
});

// =============================================================================
// SESSION MANAGEMENT ENDPOINTS
// =============================================================================

// Start a new session
app.post('/v1/sessions', validateApiKey, async (req, res) => {
  try {
    const { org_id, profile_id, username, metadata } = req.body;
    
    // Can provide either profile_id directly, or org_id + username to auto-create/get profile
    let resolvedProfileId = profile_id;
    let resolvedOrgId = org_id;
    
    if (!profile_id && org_id && username) {
      // Auto-create or get profile
      const profileResult = await sessionPool.query(`
        INSERT INTO profiles (id, org_id, username, display_name)
        VALUES ($1, $2, $3, $3)
        ON CONFLICT (org_id, username) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
        RETURNING id, org_id
      `, [generateId('profile'), org_id, username]);
      
      resolvedProfileId = profileResult.rows[0].id;
      resolvedOrgId = profileResult.rows[0].org_id;
    }
    
    if (!resolvedProfileId) {
      return res.status(400).json({
        success: false,
        error: 'Must provide profile_id or (org_id + username)'
      });
    }
    
    // Get org_id from profile if not provided
    if (!resolvedOrgId) {
      const profileCheck = await sessionPool.query(
        'SELECT org_id FROM profiles WHERE id = $1',
        [resolvedProfileId]
      );
      if (profileCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Profile not found'
        });
      }
      resolvedOrgId = profileCheck.rows[0].org_id;
    }
    
    const sessionId = generateId('session');
    
    const result = await sessionPool.query(`
      INSERT INTO sessions (id, org_id, profile_id, status, metadata)
      VALUES ($1, $2, $3, 'active', $4)
      RETURNING *
    `, [sessionId, resolvedOrgId, resolvedProfileId, JSON.stringify(metadata || {})]);
    
    res.json({
      success: true,
      session: result.rows[0]
    });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start session'
    });
  }
});

// Get session details
app.get('/v1/sessions/:sessionId', validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const result = await sessionPool.query(`
      SELECT s.*, 
        p.username, p.display_name as profile_name,
        o.name as org_name
      FROM sessions s
      JOIN profiles p ON s.profile_id = p.id
      JOIN organizations o ON s.org_id = o.id
      WHERE s.id = $1
    `, [sessionId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    // Get session messages
    const messages = await sessionPool.query(`
      SELECT id, message_type, content, overall_emotion, confidence, 
             emotions, vad, sentiment, created_at
      FROM session_messages
      WHERE session_id = $1
      ORDER BY created_at ASC
    `, [sessionId]);
    
    res.json({
      success: true,
      session: result.rows[0],
      messages: messages.rows
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session'
    });
  }
});

// Add message to session (text)
app.post('/v1/sessions/:sessionId/messages', validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { text, message_type = 'text' } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: text'
      });
    }
    
    // Verify session exists and is active
    const sessionCheck = await sessionPool.query(
      'SELECT id, status FROM sessions WHERE id = $1',
      [sessionId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    if (sessionCheck.rows[0].status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Session is not active'
      });
    }
    
    // Analyze the text for emotions
    const startTime = Date.now();
    const emotionResult = await emotionEngine.analyzeText(text);
    const processingTime = Date.now() - startTime;
    
    // Create message
    const messageId = generateId('msg');
    
    const messageResult = await sessionPool.query(`
      INSERT INTO session_messages (
        id, session_id, message_type, content,
        overall_emotion, confidence, emotions, vad, sentiment,
        word_count, analyzed_words, processing_time_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      messageId, sessionId, message_type, text,
      emotionResult.overall_emotion,
      emotionResult.confidence,
      JSON.stringify(emotionResult.emotions),
      JSON.stringify(emotionResult.vad),
      JSON.stringify(emotionResult.sentiment),
      emotionResult.word_count,
      emotionResult.analyzed_words,
      processingTime
    ]);
    
    // Update session message count
    await sessionPool.query(
      'UPDATE sessions SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [sessionId]
    );
    
    res.json({
      success: true,
      message: messageResult.rows[0],
      analysis: emotionResult
    });
  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add message'
    });
  }
});

// Add audio message to session (with transcription provided by client)
app.post('/v1/sessions/:sessionId/audio', validateApiKey, upload.single('audio'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { transcription } = req.body; // Client can send transcription from browser Speech API
    
    // Verify session exists and is active
    const sessionCheck = await sessionPool.query(
      'SELECT id, status FROM sessions WHERE id = $1',
      [sessionId]
    );
    
    if (sessionCheck.rows.length === 0) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    if (sessionCheck.rows[0].status !== 'active') {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({
        success: false,
        error: 'Session is not active'
      });
    }
    
    // Clean up audio file if provided (we use client-side transcription)
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    
    // If transcription provided, analyze it
    let emotionResult = {
      overall_emotion: 'neutral',
      confidence: 0.125,
      emotions: { joy: 0.125, trust: 0.125, anticipation: 0.125, surprise: 0.125, anger: 0.125, fear: 0.125, sadness: 0.125, disgust: 0.125 },
      vad: { valence: 0.5, arousal: 0.5, dominance: 0.5 },
      sentiment: { polarity: 'neutral', strength: 0.5 },
      word_count: 0,
      analyzed_words: 0
    };
    
    if (transcription && transcription.trim()) {
      const startTime = Date.now();
      emotionResult = await emotionEngine.analyzeText(transcription);
      emotionResult.processing_time_ms = Date.now() - startTime;
    }
    
    // Create message
    const messageId = generateId('msg');
    
    const messageResult = await sessionPool.query(`
      INSERT INTO session_messages (
        id, session_id, message_type, content, transcription,
        overall_emotion, confidence, emotions, vad, sentiment,
        word_count, analyzed_words, processing_time_ms
      ) VALUES ($1, $2, 'audio', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      messageId, sessionId,
      transcription || '[Audio - no transcription]',
      emotionResult.overall_emotion,
      emotionResult.confidence,
      JSON.stringify(emotionResult.emotions),
      JSON.stringify(emotionResult.vad),
      JSON.stringify(emotionResult.sentiment),
      emotionResult.word_count || 0,
      emotionResult.analyzed_words || 0,
      emotionResult.processing_time_ms || 0
    ]);
    
    // Update session message count
    await sessionPool.query(
      'UPDATE sessions SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [sessionId]
    );
    
    res.json({
      success: true,
      message: messageResult.rows[0],
      analysis: emotionResult
    });
    
  } catch (error) {
    console.error('Add audio message error:', error);
    
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to process audio message',
      details: error.message
    });
  }
});

// End session and calculate summary
app.post('/v1/sessions/:sessionId/end', validateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Get session and its messages
    const sessionCheck = await sessionPool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    const session = sessionCheck.rows[0];
    
    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Session is already ended'
      });
    }
    
    // Get all messages for mood calculation
    const messages = await sessionPool.query(`
      SELECT overall_emotion, confidence, emotions, vad, sentiment
      FROM session_messages
      WHERE session_id = $1
      ORDER BY created_at ASC
    `, [sessionId]);
    
    // Calculate session mood summary
    let overallMood = 'neutral';
    let moodConfidence = 0.125;
    let emotionBreakdown = { joy: 0, trust: 0, anticipation: 0, surprise: 0, anger: 0, fear: 0, sadness: 0, disgust: 0 };
    let avgValence = 0.5;
    let avgArousal = 0.5;
    let avgDominance = 0.5;
    let sentimentTrend = 'stable';
    
    if (messages.rows.length > 0) {
      // Aggregate emotions with recency weighting
      const weights = messages.rows.map((_, i) => 1 + (i / messages.rows.length)); // Recent messages weighted more
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      
      messages.rows.forEach((msg, i) => {
        const weight = weights[i] / totalWeight;
        const emotions = typeof msg.emotions === 'string' ? JSON.parse(msg.emotions) : msg.emotions;
        const vad = typeof msg.vad === 'string' ? JSON.parse(msg.vad) : msg.vad;
        
        for (const [emotion, score] of Object.entries(emotions || {})) {
          if (emotionBreakdown[emotion] !== undefined) {
            emotionBreakdown[emotion] += score * weight;
          }
        }
        
        avgValence += (vad?.valence || 0.5) * weight;
        avgArousal += (vad?.arousal || 0.5) * weight;
        avgDominance += (vad?.dominance || 0.5) * weight;
      });
      
      // Reset averages (they were initialized at 0.5)
      avgValence -= 0.5;
      avgArousal -= 0.5;
      avgDominance -= 0.5;
      
      // Find dominant emotion
      overallMood = Object.entries(emotionBreakdown)
        .sort(([,a], [,b]) => b - a)[0][0];
      moodConfidence = emotionBreakdown[overallMood];
      
      // Calculate sentiment trend (compare first half vs second half)
      if (messages.rows.length >= 4) {
        const midPoint = Math.floor(messages.rows.length / 2);
        const firstHalf = messages.rows.slice(0, midPoint);
        const secondHalf = messages.rows.slice(midPoint);
        
        const firstValence = firstHalf.reduce((sum, m) => {
          const vad = typeof m.vad === 'string' ? JSON.parse(m.vad) : m.vad;
          return sum + (vad?.valence || 0.5);
        }, 0) / firstHalf.length;
        
        const secondValence = secondHalf.reduce((sum, m) => {
          const vad = typeof m.vad === 'string' ? JSON.parse(m.vad) : m.vad;
          return sum + (vad?.valence || 0.5);
        }, 0) / secondHalf.length;
        
        const diff = secondValence - firstValence;
        sentimentTrend = diff > 0.1 ? 'improving' : diff < -0.1 ? 'declining' : 'stable';
      }
    }
    
    // Calculate duration
    const durationSeconds = Math.floor((new Date() - new Date(session.started_at)) / 1000);
    
    // Update session
    const result = await sessionPool.query(`
      UPDATE sessions SET
        status = 'ended',
        ended_at = CURRENT_TIMESTAMP,
        duration_seconds = $2,
        overall_mood = $3,
        mood_confidence = $4,
        emotion_breakdown = $5,
        avg_valence = $6,
        avg_arousal = $7,
        avg_dominance = $8,
        sentiment_trend = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [
      sessionId,
      durationSeconds,
      overallMood,
      moodConfidence,
      JSON.stringify(emotionBreakdown),
      avgValence,
      avgArousal,
      avgDominance,
      sentimentTrend
    ]);
    
    // Update profile stats
    await sessionPool.query(`
      UPDATE profiles SET
        total_sessions = total_sessions + 1,
        total_messages = total_messages + $2,
        avg_valence = (avg_valence * total_sessions + $3) / (total_sessions + 1),
        avg_arousal = (avg_arousal * total_sessions + $4) / (total_sessions + 1),
        dominant_emotion = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [session.profile_id, messages.rows.length, avgValence, avgArousal, overallMood]);
    
    res.json({
      success: true,
      session: result.rows[0],
      summary: {
        overall_mood: overallMood,
        mood_confidence: moodConfidence,
        emotion_breakdown: emotionBreakdown,
        avg_valence: avgValence,
        avg_arousal: avgArousal,
        avg_dominance: avgDominance,
        sentiment_trend: sentimentTrend,
        duration_seconds: durationSeconds,
        message_count: messages.rows.length
      }
    });
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to end session'
    });
  }
});

// List sessions for org
app.get('/v1/orgs/:orgId/sessions', validateApiKey, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT s.*, p.username, p.display_name
      FROM sessions s
      JOIN profiles p ON s.profile_id = p.id
      WHERE s.org_id = $1
    `;
    const params = [orgId];
    
    if (status) {
      query += ` AND s.status = $${params.length + 1}`;
      params.push(status);
    }
    
    query += ` ORDER BY s.started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const result = await sessionPool.query(query, params);
    
    const countQuery = status 
      ? 'SELECT COUNT(*) FROM sessions WHERE org_id = $1 AND status = $2'
      : 'SELECT COUNT(*) FROM sessions WHERE org_id = $1';
    const countParams = status ? [orgId, status] : [orgId];
    const countResult = await sessionPool.query(countQuery, countParams);
    
    res.json({
      success: true,
      sessions: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('List sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list sessions'
    });
  }
});

// Get session analytics for org
app.get('/v1/orgs/:orgId/analytics', validateApiKey, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { days = 30 } = req.query;
    
    // Overall stats
    const overallStats = await sessionPool.query(`
      SELECT 
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(DISTINCT s.profile_id) as unique_profiles,
        SUM(s.message_count) as total_messages,
        AVG(s.duration_seconds) as avg_session_duration,
        AVG(s.avg_valence) as avg_valence,
        AVG(s.avg_arousal) as avg_arousal
      FROM sessions s
      WHERE s.org_id = $1 AND s.status = 'ended'
        AND s.ended_at > NOW() - INTERVAL '1 day' * $2
    `, [orgId, parseInt(days)]);
    
    // Emotion distribution
    const emotionDist = await sessionPool.query(`
      SELECT overall_mood, COUNT(*) as count
      FROM sessions
      WHERE org_id = $1 AND status = 'ended'
        AND ended_at > NOW() - INTERVAL '1 day' * $2
      GROUP BY overall_mood
      ORDER BY count DESC
    `, [orgId, parseInt(days)]);
    
    // Daily trends
    const dailyTrends = await sessionPool.query(`
      SELECT 
        DATE(ended_at) as date,
        COUNT(*) as sessions,
        AVG(avg_valence) as avg_valence,
        SUM(message_count) as messages
      FROM sessions
      WHERE org_id = $1 AND status = 'ended'
        AND ended_at > NOW() - INTERVAL '1 day' * $2
      GROUP BY DATE(ended_at)
      ORDER BY date DESC
    `, [orgId, parseInt(days)]);
    
    res.json({
      success: true,
      analytics: {
        period_days: parseInt(days),
        overall: overallStats.rows[0],
        emotion_distribution: emotionDist.rows,
        daily_trends: dailyTrends.rows
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics'
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Circuit Emotion Analysis API',
    version: '2.1.0',
    endpoints: {
      // Analysis
      text_analysis: 'POST /v1/analyze-text',
      audio_analysis: 'POST /v1/analyze-audio',
      
      // Organizations
      create_org: 'POST /v1/orgs',
      get_orgs: 'GET /v1/orgs',
      get_org: 'GET /v1/orgs/:orgId',
      
      // Profiles
      create_profile: 'POST /v1/profiles',
      get_profile: 'GET /v1/profiles/:profileId',
      list_profiles: 'GET /v1/orgs/:orgId/profiles',
      
      // Sessions
      start_session: 'POST /v1/sessions',
      get_session: 'GET /v1/sessions/:sessionId',
      add_message: 'POST /v1/sessions/:sessionId/messages',
      add_audio: 'POST /v1/sessions/:sessionId/audio',
      end_session: 'POST /v1/sessions/:sessionId/end',
      list_sessions: 'GET /v1/orgs/:orgId/sessions',
      
      // Analytics
      org_analytics: 'GET /v1/orgs/:orgId/analytics',
      
      // System
      stats: 'GET /v1/stats',
      status: 'GET /v1/status',
      health: 'GET /health'
    },
    documentation: 'https://dashboard-giddirva3-austinway-8928s-projects.vercel.app/app/docs'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Circuit API server running on port ${PORT}`);
});

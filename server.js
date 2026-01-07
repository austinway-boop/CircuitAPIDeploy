const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execAsync = promisify(exec);

const app = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

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
    const { Pool } = require('pg');
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
    
    // Create tables
    const createTables = `
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
    
    await pool.query(createTables);
    logs.push('✅ Tables created/verified');
    
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
    
    // Final count
    const finalCount = await pool.query('SELECT COUNT(*) as count FROM words');
    logs.push(`✅ Final word count: ${finalCount.rows[0].count}`);
    
    await pool.end();
    
    res.json({ 
      success: true, 
      logs,
      word_count: parseInt(finalCount.rows[0].count)
    });
    
  } catch (error) {
    res.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Circuit Emotion Analysis API',
    version: '2.0.0',
    endpoints: {
      text_analysis: 'POST /v1/analyze-text',
      audio_analysis: 'POST /v1/analyze-audio',
      stats: 'GET /v1/stats',
      health: 'GET /health'
    },
    documentation: 'https://dashboard-giddirva3-austinway-8928s-projects.vercel.app/app/docs'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Circuit API server running on port ${PORT}`);
});

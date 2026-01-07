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

// Middleware
app.use(cors());
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
  
  // Validate against dashboard (if DASHBOARD_URL is set)
  const dashboardUrl = process.env.DASHBOARD_URL;
  if (dashboardUrl) {
    try {
      const response = await fetch(`${dashboardUrl}/api/api-keys/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
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
  
  next();
};

// Load emotion engine
const { emotionEngine } = require('./api/emotion-engine.js');

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
app.get('/v1/stats', (req, res) => {
  try {
    const wordsDir = path.join(__dirname, 'words');
    const wordFiles = fs.readdirSync(wordsDir).filter(f => f.endsWith('.json'));
    
    let totalWords = 0;
    wordFiles.forEach(file => {
      const data = JSON.parse(fs.readFileSync(path.join(wordsDir, file), 'utf-8'));
      totalWords += Object.keys(data).length;
    });
    
    res.json({
      success: true,
      stats: {
        word_database_size: totalWords,
        system_status: 'operational',
        features: {
          text_analysis: true,
          audio_analysis: true,
          laughter_detection: true,
          music_detection: true,
          confidence_scoring: true
        },
        version: '2.0.0',
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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
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

// Vercel Serverless Function for System Statistics
// Returns information about the emotion analysis system

const { emotionEngine } = require('./emotion-engine');
const { authenticate } = require('./auth-middleware');

// Simple in-memory counter (resets on function restart)
let callCounts = {
  stats: 0,
  text_analysis: 0,
  audio_analysis: 0,
  total: 0
};

module.exports = async function handler(req, res) {
  callCounts.stats++;
  callCounts.total++;
  
  // CORS headers handled by vercel.json
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET to retrieve system statistics.'
    });
  }
  
  // Authenticate the request
  const authResult = await new Promise((resolve) => {
    authenticate(req, res, (err) => {
      resolve(err || null);
    });
  });
  
  if (authResult) {
    return; // Authentication failed, response already sent
  }
  
  try {
    const dbStats = emotionEngine.getDatabaseStats();
    
    return res.status(200).json({
      success: true,
      stats: {
        word_database_size: dbStats.total_words,
        system_status: "operational_real_analysis",
        api_calls: {
          stats_calls: callCounts.stats,
          text_analysis_calls: callCounts.text_analysis,
          audio_analysis_calls: callCounts.audio_analysis,
          total_calls: callCounts.total,
          last_reset: "function_restart"
        },
        features: {
          speech_recognition: false,
          emotion_analysis: true,
          real_word_database: true,
          deepseek_integration: dbStats.deepseek_available,
          text_analysis: true,
          laughter_detection: false,
          music_detection: false,
          confidence_scoring: true,
          serverless_mode: true
        },
        capabilities: {
          supported_audio_formats: ["Use text analysis instead"],
          supported_languages: ["en"],
          max_audio_size_mb: "N/A - use text analysis",
          max_text_length: 10000,
          confidence_threshold: 0.7
        },
        api_info: {
          timestamp: new Date().toISOString(),
          version: '2.0.0',
          mode: 'serverless'
        }
      }
    });
    
  } catch (error) {
    // Return basic fallback stats on error
    return res.status(200).json({
      success: true,
      stats: {
        word_database_size: 0,
        system_status: 'limited',
        api_info: {
          timestamp: new Date().toISOString(),
          version: '2.0.0',
          fallback: true
        }
      }
    });
  }
}

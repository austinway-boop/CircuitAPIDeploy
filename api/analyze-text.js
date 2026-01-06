// Vercel Serverless Function for Text Emotion Analysis
// Uses REAL emotion analysis with word database + DeepSeek API

const { emotionEngine } = require('./emotion-engine');
const { authenticate } = require('./auth-middleware');

// Simple in-memory counter (resets on function restart)
let textAnalysisCalls = 0;

module.exports = async function handler(req, res) {
  // CORS headers handled by vercel.json
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST to analyze text.'
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
    textAnalysisCalls++;
    
    const { text } = req.body;
    
    // Validate input
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid input. Please provide text in the "text" field.'
      });
    }
    
    const trimmedText = text.trim();
    if (!trimmedText) {
      return res.status(400).json({
        success: false,
        error: 'Empty text provided. Please provide some text to analyze.'
      });
    }
    
    if (trimmedText.length > 10000) {
      return res.status(400).json({
        success: false,
        error: 'Text too long. Maximum length is 10,000 characters.'
      });
    }
    
    // Run the emotion analysis
    const startTime = Date.now();
    const emotionAnalysis = await emotionEngine.analyzeText(trimmedText);
    const processingTime = (Date.now() - startTime) / 1000;
    
    const wordCount = trimmedText.split(/\s+/).length;
    
    // Return successful result
    return res.status(200).json({
      success: true,
      result: {
        transcription: trimmedText,
        confidence: 1.0,
        emotion_analysis: emotionAnalysis,
        processing_time: processingTime,
        needs_review: false,
        success: true,
        error: null,
        input_stats: {
          character_count: trimmedText.length,
          word_count: wordCount,
          sentence_count: trimmedText.split(/[.!?]+/).filter(s => s.trim().length > 0).length
        },
        api_calls: {
          text_analysis_calls: textAnalysisCalls,
          this_session: textAnalysisCalls
        }
      }
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error during text analysis',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

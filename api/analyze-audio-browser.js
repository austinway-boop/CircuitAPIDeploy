// Vercel Serverless Function for Audio Analysis
// Uses browser-based speech recognition + emotion analysis

const { authenticate } = require('./auth-middleware');

// Simple in-memory counter
let audioCalls = 0;

module.exports = async (req, res) => {
  // Increment counter
  audioCalls++;
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST to analyze audio.'
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
    console.log(`🎯 Browser-based audio analysis called (${audioCalls} times total)`);
    
    // Return instructions for browser-based audio processing
    return res.status(200).json({
      success: true,
      method: 'browser_speech_recognition',
      instructions: {
        step1: 'Use browser Web Speech API for transcription',
        step2: 'Send transcribed text to /api/analyze-text for emotion analysis',
        step3: 'Combine results for complete audio emotion analysis'
      },
      browser_implementation: {
        javascript_code: `
// In your frontend JavaScript:
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.lang = 'en-US';
recognition.continuous = false;
recognition.interimResults = false;

recognition.onresult = async (event) => {
  const transcript = event.results[0][0].transcript;
  console.log('Transcribed:', transcript);
  
  // Send to emotion analysis API
  const response = await fetch('https://vdp-peach.vercel.app/api/analyze-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: transcript })
  });
  
  const result = await response.json();
  if (result.success) {
    displayEmotionResults(result.result);
  }
};

// Start recognition
recognition.start();
        `,
        example_usage: 'Use the above code in your frontend to enable real audio processing'
      },
      alternative_endpoints: {
        text_analysis: '/api/analyze-text',
        description: 'Send transcribed text here for emotion analysis'
      },
      api_calls: {
        audio_calls: audioCalls,
        this_session: audioCalls
      }
    });
    
  } catch (error) {
    console.error('❌ Audio endpoint error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Audio endpoint error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

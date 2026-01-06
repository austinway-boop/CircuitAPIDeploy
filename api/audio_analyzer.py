#!/usr/bin/env python3
"""
Vercel-compatible Audio Analyzer
Wrapper for the enhanced speech analysis system
"""

import sys
import json
import os
import argparse
from pathlib import Path

# Add the enhanced_system directory to the Python path
current_dir = Path(__file__).parent
enhanced_dir = current_dir.parent / "enhanced_system"
sys.path.insert(0, str(enhanced_dir))

try:
    from enhanced_speech_analyzer import EnhancedSpeechAnalyzer
except ImportError as e:
    # Fallback for serverless environment - return basic response
    print(json.dumps({
        "success": False,
        "error": "Speech analysis not available in serverless environment. Please use text analysis instead.",
        "transcription": "",
        "confidence": 0.0,
        "fallback": True
    }))
    sys.exit(0)  # Exit successfully with fallback message

def main():
    parser = argparse.ArgumentParser(description='Analyze audio file for speech and emotions')
    parser.add_argument('audio_file', help='Path to audio file')
    parser.add_argument('--retry-mode', choices=['normal', 'aggressive'], default='normal',
                       help='Retry mode for transcription')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.audio_file):
        print(json.dumps({
            "success": False,
            "error": f"Audio file not found: {args.audio_file}",
            "transcription": "",
            "confidence": 0.0
        }))
        sys.exit(1)
    
    try:
        # Initialize the analyzer
        analyzer = EnhancedSpeechAnalyzer(confidence_threshold=0.7)
        
        # Analyze the audio file
        if args.retry_mode == 'aggressive':
            # Try aggressive retry first
            text, confidence, metadata = analyzer.aggressive_retry_transcription(args.audio_file)
            if text and text.strip():
                # Create result with aggressive retry
                result = {
                    "transcription": text,
                    "confidence": confidence,
                    "metadata": metadata,
                    "emotion_analysis": analyzer.analyze_phrase_emotion(text),
                    "laughter_analysis": {"error": "Not analyzed in retry mode"},
                    "music_analysis": {"error": "Not analyzed in retry mode"},
                    "processing_time": 0,
                    "success": True,
                    "error": None,
                    "needs_review": confidence < 0.7,
                    "unknown_words": 0,
                    "unknown_word_ids": []
                }
            else:
                # Fall back to normal analysis
                result = analyzer.analyze_audio_file_with_training(args.audio_file)
        else:
            # Normal analysis
            result = analyzer.analyze_audio_file_with_training(args.audio_file)
        
        # Ensure we have a valid result structure
        if not isinstance(result, dict):
            result = {
                "success": False,
                "error": "Invalid result from analyzer",
                "transcription": "",
                "confidence": 0.0
            }
        
        # Add some additional metadata for API usage
        result["analyzer_version"] = "2.0.0"
        result["python_version"] = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        
        # Print result as JSON
        print(json.dumps(result, ensure_ascii=False, indent=None))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": f"Analysis failed: {str(e)}",
            "transcription": "",
            "confidence": 0.0,
            "emotion_analysis": {
                "overall_emotion": "neutral",
                "emotions": {"neutral": 1.0},
                "word_count": 0,
                "analyzed_words": 0
            }
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Vercel-compatible Text Analyzer
Wrapper for the batch word processor emotion analysis
"""

import sys
import json
import time
from pathlib import Path

# Add the enhanced_system directory to the Python path
current_dir = Path(__file__).parent
enhanced_dir = current_dir.parent / "enhanced_system"
sys.path.insert(0, str(enhanced_dir))

try:
    from batch_word_processor import process_text_batch
except ImportError as e:
    # Fallback for serverless environment - return basic neutral analysis
    def process_text_batch(text):
        words = text.split()
        return {
            "overall_emotion": "neutral",
            "confidence": 0.5,
            "emotions": {
                "joy": 0.125, "trust": 0.125, "anticipation": 0.125, "surprise": 0.125,
                "anger": 0.125, "fear": 0.125, "sadness": 0.125, "disgust": 0.125
            },
            "word_analysis": [{"word": word, "emotion": "neutral", "confidence": 0.125, "found": False} for word in words],
            "word_count": len(words),
            "analyzed_words": 0,
            "coverage": 0.0,
            "vad": {"valence": 0.5, "arousal": 0.5, "dominance": 0.5},
            "sentiment": {"polarity": "neutral", "strength": 0.5}
        }

def main():
    try:
        # Read text from stdin
        text = sys.stdin.read().strip()
        
        if not text:
            print(json.dumps({
                "success": False,
                "error": "No text provided",
                "emotion_analysis": {
                    "overall_emotion": "neutral",
                    "emotions": {"neutral": 1.0},
                    "word_count": 0,
                    "analyzed_words": 0
                }
            }))
            sys.exit(1)
        
        # Analyze the text
        start_time = time.time()
        emotion_analysis = process_text_batch(text)
        processing_time = time.time() - start_time
        
        # Create the result
        result = {
            "success": True,
            "emotion_analysis": emotion_analysis,
            "processing_time": processing_time,
            "analyzer_version": "2.0.0",
            "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        }
        
        # Print result as JSON
        print(json.dumps(result, ensure_ascii=False, indent=None))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": f"Text analysis failed: {str(e)}",
            "emotion_analysis": {
                "overall_emotion": "neutral",
                "emotions": {
                    "joy": 0.125, "trust": 0.125, "anticipation": 0.125, "surprise": 0.125,
                    "anger": 0.125, "fear": 0.125, "sadness": 0.125, "disgust": 0.125
                },
                "word_count": len(text.split()) if 'text' in locals() else 0,
                "analyzed_words": 0,
                "coverage": 0.0
            },
            "processing_time": 0
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()

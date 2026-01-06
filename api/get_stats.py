#!/usr/bin/env python3
"""
Vercel-compatible Stats Retriever
Gets system statistics from the enhanced speech analysis system
"""

import sys
import json
import os
from pathlib import Path

# Add the enhanced_system directory to the Python path
current_dir = Path(__file__).parent
enhanced_dir = current_dir.parent / "enhanced_system"
sys.path.insert(0, str(enhanced_dir))

try:
    from enhanced_speech_analyzer import EnhancedSpeechAnalyzer
    from batch_word_processor import get_batch_stats
    COMPONENTS_AVAILABLE = True
except ImportError as e:
    # Fallback for serverless environment
    COMPONENTS_AVAILABLE = False

def main():
    try:
        if COMPONENTS_AVAILABLE:
            # Initialize the analyzer to get training stats
            analyzer = EnhancedSpeechAnalyzer()
            
            # Get training statistics
            training_stats = analyzer.get_training_stats()
            
            # Get batch processor statistics
            batch_stats = get_batch_stats()
            
            # Get word database size
            word_count = len(analyzer.word_cache)
            
            # Create comprehensive stats
            stats = {
                "word_database_size": word_count,
                "training_stats": training_stats,
                "batch_processor": batch_stats,
                "system_status": "operational",
                "features": {
                    "speech_recognition": True,
                    "emotion_analysis": True,
                    "laughter_detection": True,
                    "music_detection": True,
                    "confidence_scoring": True,
                    "training_data_collection": True,
                    "local_speech_model": hasattr(analyzer, 'local_model') and analyzer.local_model is not None
                },
                "capabilities": {
                    "supported_audio_formats": ["WAV", "FLAC", "AIFF", "MP3", "WebM"],
                    "supported_languages": ["en-US", "en-GB", "en"],
                    "max_audio_size_mb": 50,
                    "max_text_length": 10000,
                    "confidence_threshold": analyzer.confidence_threshold
                }
            }
        else:
            # Fallback stats for serverless environment
            stats = {
                "word_database_size": "unavailable",
                "system_status": "limited_serverless",
                "training_stats": {
                    "pending_reviews": "unavailable",
                    "completed_corrections": "unavailable",
                    "total_corrections": "unavailable"
                },
                "features": {
                    "speech_recognition": False,
                    "emotion_analysis": False,
                    "laughter_detection": False,
                    "music_detection": False,
                    "confidence_scoring": False,
                    "training_data_collection": False,
                    "local_speech_model": False
                },
                "capabilities": {
                    "supported_audio_formats": [],
                    "supported_languages": ["en"],
                    "max_audio_size_mb": 50,
                    "max_text_length": 10000,
                    "confidence_threshold": 0.7
                },
                "note": "Running in serverless mode with limited functionality"
            }
        
        # Print result as JSON
        print(json.dumps(stats, ensure_ascii=False, indent=None))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": f"Stats retrieval failed: {str(e)}",
            "word_database_size": 0,
            "system_status": "error",
            "training_stats": {
                "pending_reviews": 0,
                "completed_corrections": 0,
                "total_corrections": 0
            }
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    main()

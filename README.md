# Circuit Emotion Analysis API

Real-time emotion analysis for voice and text using advanced AI.

## Features

- Text emotion analysis with 25,000+ word database
- Audio transcription and emotion detection
- Laughter detection
- Music filtering
- Multi-engine speech recognition
- VAD (Valence-Arousal-Dominance) scoring
- 8-category emotion classification

## Deployment to DigitalOcean

### Option 1: App Platform (Recommended)

1. Push this repo to GitHub
2. Go to DigitalOcean App Platform
3. Create new app from GitHub repo
4. Set environment variables (see below)
5. Deploy

### Option 2: Droplet

1. Create Ubuntu droplet
2. SSH into server
3. Clone this repo
4. Run setup script:

```bash
# Install dependencies
sudo apt update
sudo apt install -y python3 python3-pip nodejs npm ffmpeg

# Install Python packages
pip3 install -r requirements.txt

# Install Node packages
npm install

# Start server
npm start
```

## Environment Variables

```bash
PORT=3000
DEEPSEEK_API_KEY=your_key_here
NODE_ENV=production
```

## API Endpoints

- `POST /v1/analyze-text` - Analyze text emotions
- `POST /v1/analyze-audio` - Analyze audio emotions  
- `GET /v1/stats` - System statistics
- `GET /health` - Health check

## Local Development

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`

## Testing

```bash
# Test text analysis
curl -X POST http://localhost:3000/v1/analyze-text \
  -H "Authorization: Bearer sk_test_demo" \
  -H "Content-Type: application/json" \
  -d '{"text": "I am feeling great!"}'

# Test stats
curl http://localhost:3000/v1/stats
```

## Documentation

Full API documentation: https://circuit-console.vercel.app/app/docs


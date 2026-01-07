# API Status Monitoring

Complete monitoring and health check system for the Circuit Emotion Analysis API.

## 🎯 Overview

The API now includes comprehensive status monitoring with three new endpoints:

1. **`/v1/status`** - Real-time health checks for all endpoints
2. **`/v1/usage/:apiKey`** - Per-API-key usage statistics
3. **`/v1/stats`** - Updated to use PostgreSQL database

Plus a developer-friendly **Status Dashboard** in the web console.

---

## 📊 Endpoints

### 1. `/v1/status` - Endpoint Health Checks

**GET** `https://your-api.ondigitalocean.app/v1/status`

**No authentication required** - Public status endpoint

**Response:**
```json
{
  "success": true,
  "overall_status": "operational",
  "endpoints": {
    "health": {
      "status": "operational",
      "response_time_ms": 1,
      "last_checked": "2026-01-07T20:00:00.000Z"
    },
    "stats": {
      "status": "operational",
      "response_time_ms": 45,
      "last_checked": "2026-01-07T20:00:00.000Z"
    },
    "analyze_text": {
      "status": "operational",
      "response_time_ms": 2,
      "last_checked": "2026-01-07T20:00:00.000Z"
    },
    "analyze_audio": {
      "status": "operational",
      "response_time_ms": 5,
      "last_checked": "2026-01-07T20:00:00.000Z",
      "note": "Heavy processing - slower response times expected"
    },
    "database": {
      "status": "operational",
      "response_time_ms": 38,
      "last_checked": "2026-01-07T20:00:00.000Z",
      "details": {
        "word_count": 5234
      }
    }
  },
  "server": {
    "uptime_seconds": 3600,
    "version": "2.1.0",
    "environment": "production"
  },
  "timestamp": "2026-01-07T20:00:00.000Z",
  "total_response_time_ms": 52
}
```

**Status Values:**
- `operational` - Endpoint is working normally
- `degraded` - Endpoint is slow or partially working
- `down` - Endpoint is not responding
- `unknown` - Status could not be determined

**Use Cases:**
- Uptime monitoring services (Pingdom, UptimeRobot, etc.)
- Status page displays
- Health checks in CI/CD pipelines
- Developer debugging

---

### 2. `/v1/usage/:apiKey` - API Key Usage Stats

**GET** `https://your-api.ondigitalocean.app/v1/usage/sk_live_abc123...`

**Authentication required** - Must provide valid API key in Authorization header

**Request:**
```bash
curl https://your-api.ondigitalocean.app/v1/usage/sk_live_abc123 \
  -H "Authorization: Bearer sk_live_abc123"
```

**Response:**
```json
{
  "success": true,
  "api_key": "sk_live_abc123...",
  "usage": {
    "total_requests": 1543,
    "avg_processing_time_ms": 234.5,
    "total_deepseek_calls": 87,
    "total_new_words_added": 42,
    "first_request": "2026-01-01T00:00:00.000Z",
    "last_request": "2026-01-07T20:00:00.000Z"
  },
  "environment": "production",
  "timestamp": "2026-01-07T20:00:00.000Z"
}
```

**Use Cases:**
- Track API usage per customer
- Billing and metering
- Rate limit monitoring
- Performance analytics
- Cost attribution

---

### 3. `/v1/stats` - System Statistics (Updated)

**GET** `https://your-api.ondigitalocean.app/v1/stats`

**No authentication required** - Public stats endpoint

**Response:**
```json
{
  "success": true,
  "stats": {
    "word_database_size": 5234,
    "database_type": "PostgreSQL",
    "system_status": "operational",
    "total_requests": 15430,
    "uptime": "2d 5h 30m",
    "uptime_seconds": 192600,
    "server_start_time": "2026-01-05T14:30:00.000Z",
    "features": {
      "text_analysis": true,
      "audio_analysis": true,
      "database_persistence": true,
      "api_logging": true,
      "deepseek_available": true
    },
    "version": "2.1.0",
    "timestamp": "2026-01-07T20:00:00.000Z"
  }
}
```

**Changes from v2.0:**
- Now pulls word count from PostgreSQL database
- Added `database_type` field
- Added `database_persistence` and `api_logging` features
- Added `deepseek_available` status

---

## 🖥️ Status Dashboard

### Accessing the Dashboard

**URL:** `https://your-dashboard.vercel.app/app/status`

### Features

1. **Real-Time Monitoring**
   - Auto-refresh every 30 seconds
   - Manual refresh button
   - Last updated timestamp

2. **Overall System Status**
   - Visual status indicators (✓ operational, ⚠ degraded, ✗ down)
   - Server uptime
   - API response time
   - Current version
   - Environment (production/development)

3. **Per-Endpoint Status Cards**
   - Individual status for each endpoint
   - Response time tracking
   - Last checked timestamp
   - Error messages (if any)
   - Additional details (e.g., database word count)

4. **API Information Panel**
   - Base URL with copy button
   - All endpoint URLs
   - Quick reference for developers

### Screenshots

#### Overall Status
```
┌─────────────────────────────────────────┐
│ ✓ Overall System Status    [Operational]│
│                                          │
│  🕐 2d 5h 30m    ⚡ 52ms    📊 v2.1.0   │
│  Uptime         Response   Version      │
└─────────────────────────────────────────┘
```

#### Endpoint Cards
```
┌──────────────────┐  ┌──────────────────┐
│ ✓ Health         │  │ ✓ Analyze Text   │
│ [Operational]    │  │ [Operational]    │
│                  │  │                  │
│ Response: 1ms    │  │ Response: 2ms    │
│ Updated: 8:00 PM │  │ Updated: 8:00 PM │
└──────────────────┘  └──────────────────┘
```

---

## 🔧 Integration Examples

### 1. Uptime Monitoring (Pingdom, UptimeRobot)

**Monitor URL:** `https://your-api.ondigitalocean.app/v1/status`

**Check Interval:** 1 minute

**Success Criteria:**
- HTTP Status: 200
- Response contains: `"overall_status": "operational"`

### 2. CI/CD Health Check

```bash
#!/bin/bash
# health-check.sh

API_URL="https://your-api.ondigitalocean.app"

# Check status
STATUS=$(curl -s "$API_URL/v1/status" | jq -r '.overall_status')

if [ "$STATUS" = "operational" ]; then
  echo "✓ API is operational"
  exit 0
else
  echo "✗ API status: $STATUS"
  exit 1
fi
```

### 3. JavaScript/TypeScript Client

```typescript
interface StatusResponse {
  success: boolean;
  overall_status: 'operational' | 'degraded' | 'down';
  endpoints: Record<string, {
    status: string;
    response_time_ms: number;
    last_checked: string;
  }>;
  server: {
    uptime_seconds: number;
    version: string;
    environment: string;
  };
}

async function checkAPIStatus(): Promise<StatusResponse> {
  const response = await fetch('https://your-api.ondigitalocean.app/v1/status');
  return response.json();
}

// Usage
const status = await checkAPIStatus();
console.log(`API Status: ${status.overall_status}`);
console.log(`Uptime: ${status.server.uptime_seconds}s`);
```

### 4. Python Monitoring Script

```python
import requests
import time

API_URL = "https://your-api.ondigitalocean.app"

def monitor_api():
    while True:
        try:
            response = requests.get(f"{API_URL}/v1/status")
            data = response.json()
            
            status = data['overall_status']
            uptime = data['server']['uptime_seconds']
            
            print(f"[{time.strftime('%H:%M:%S')}] Status: {status}, Uptime: {uptime}s")
            
            # Alert if not operational
            if status != 'operational':
                send_alert(f"API status: {status}")
                
        except Exception as e:
            print(f"Error checking status: {e}")
        
        time.sleep(60)  # Check every minute

monitor_api()
```

### 5. Slack/Discord Webhook Integration

```javascript
const fetch = require('node-fetch');

async function sendStatusToSlack() {
  const status = await fetch('https://your-api.ondigitalocean.app/v1/status')
    .then(r => r.json());
  
  const color = status.overall_status === 'operational' ? 'good' : 'danger';
  
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachments: [{
        color: color,
        title: 'Circuit API Status',
        fields: [
          { title: 'Status', value: status.overall_status, short: true },
          { title: 'Version', value: status.server.version, short: true },
          { title: 'Uptime', value: `${status.server.uptime_seconds}s`, short: true },
          { title: 'Response Time', value: `${status.total_response_time_ms}ms`, short: true }
        ],
        timestamp: status.timestamp
      }]
    })
  });
}

// Run every 5 minutes
setInterval(sendStatusToSlack, 5 * 60 * 1000);
```

---

## 📈 Monitoring Best Practices

### 1. Set Up Alerts

Monitor these key metrics:
- Overall status changes from `operational`
- Response time > 1000ms
- Database connection failures
- Server restarts (uptime resets)

### 2. Track Trends

Log status data over time to identify:
- Performance degradation
- Peak usage times
- Deployment impact
- Database growth rate

### 3. Dashboard Placement

Add status page link to:
- API documentation
- Developer portal
- Support tickets
- Email signatures

### 4. Status Page URL

Make it memorable:
- `https://status.yourdomain.com`
- `https://api.yourdomain.com/status`
- `https://yourdomain.com/api-status`

---

## 🔍 Troubleshooting

### Status shows "degraded"

**Possible causes:**
- Database connection slow
- High server load
- Network latency
- Recent deployment

**Actions:**
1. Check individual endpoint statuses
2. Review server logs
3. Check database performance
4. Monitor response times

### Status shows "down"

**Possible causes:**
- Server crashed
- Database unavailable
- Deployment in progress
- Network outage

**Actions:**
1. Check DigitalOcean dashboard
2. Review deployment logs
3. Verify environment variables
4. Check database connection

### Usage endpoint returns 0 requests

**Possible causes:**
- New API key (no history yet)
- Database not logging requests
- API key hash mismatch

**Actions:**
1. Verify API key is correct
2. Check database logs table exists
3. Make a test request
4. Check server logs for errors

---

## 🎯 Next Steps

1. **Set up monitoring:**
   - Add `/v1/status` to your uptime monitor
   - Configure alerts for status changes

2. **Track usage:**
   - Use `/v1/usage/:apiKey` for billing
   - Monitor per-customer usage

3. **Share status page:**
   - Add link to documentation
   - Share with developers
   - Include in support responses

4. **Customize dashboard:**
   - Add your branding
   - Customize refresh interval
   - Add additional metrics

---

## 📚 Related Documentation

- **API Documentation:** See `API_DOCUMENTATION.md`
- **Database Setup:** See `DEPLOY_TO_DIGITALOCEAN.md`
- **Deployment Guide:** See `QUICK_DEPLOY_GUIDE.md`

---

**Version:** 2.1.0  
**Last Updated:** January 2026


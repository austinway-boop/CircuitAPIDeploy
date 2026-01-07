# Deploying Circuit API to DigitalOcean

Complete guide for deploying the Circuit emotion analysis API to DigitalOcean App Platform.

## Prerequisites

- GitHub account
- DigitalOcean account
- DeepSeek API key (for emotion analysis)

## Step 1: Push Code to GitHub

If you haven't already pushed this repository:

```bash
cd /path/to/api-deploy
git init
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/CircuitAPIDeploy.git
git push -u origin main
```

## Step 2: Setup Database (One-Time)

**Before deploying the app, setup the PostgreSQL database:**

```bash
cd api-deploy

# Install dependencies
npm install

# Create database tables
npm run setup-db

# Migrate existing words from JSON to PostgreSQL
npm run migrate-words
```

This will:
- Create the `words` table for emotion data
- Create the `api_processing_logs` table for analytics
- Migrate all existing words from JSON files to PostgreSQL

**Expected output:**
```
✅ Connected to PostgreSQL database
✅ Schema created successfully
📊 Database contains 0 words
🚀 Starting word migration...
✅ Migration complete! Database now contains 5000+ words
```

## Step 3: Create App in DigitalOcean

1. Go to https://cloud.digitalocean.com/apps
2. Click **"Create App"**
3. Choose **"GitHub"** as source
4. Authorize DigitalOcean to access your GitHub
5. Select repository: **CircuitAPIDeploy**
6. Select branch: **main**
7. Enable **"Autodeploy"** (deploys automatically when you push to GitHub)
8. Click **"Next"**

## Step 4: Configure App Settings

### Resource Configuration

**Type:** Web Service (already detected)

**Name:** circuit-emotion-api (or your preferred name)

**Region:** Choose closest to your users
- New York (NYC1)
- San Francisco (SFO3)
- London (LON1)
- etc.

**Instance Size:**
- Basic: 512MB RAM, $5/month (good for testing)
- Professional: 1GB RAM, $12/month (recommended for production)

### Build & Run Settings

**Build Command:** Leave empty (auto-detected from package.json)

**Run Command:** `npm start` (already correct)

**HTTP Port:** 8080 (already correct)

### Environment Variables

Click **"Edit"** next to "Environment variables" and add:

| Key | Value | Notes |
|-----|-------|-------|
| `DEEPSEEK_API_KEY` | your_deepseek_key_here | **REQUIRED** - Get from DeepSeek |
| `DASHBOARD_URL` | https://your-dashboard.vercel.app | **REQUIRED** - Your Vercel dashboard URL |
| `NODE_ENV` | production | Optional |
| `PORT` | 8080 | Auto-set by DigitalOcean |

**Important:** Click **"Encrypt"** for DEEPSEEK_API_KEY to keep it secure!

### Database

**PostgreSQL Database Required** - The word emotion database uses PostgreSQL for persistence across deployments.

**Database Connection Info:**
- **ID:** 2c69acd5-7c22-41b0-aea2-a943caf2e6b9
- **Host:** app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com
- **Port:** 25060
- **Username:** db
- **Password:** (see DigitalOcean database settings)
- **Database:** db
- **SSL Mode:** require

**Environment Variables for Database (REQUIRED!):**

| Key | Value |
|-----|-------|
| `DB_HOST` | `app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com` |
| `DB_PORT` | `25060` |
| `DB_USER` | `db` |
| `DB_PASSWORD` | (get from DigitalOcean database settings - **ENCRYPT THIS!**) |
| `DB_NAME` | `db` |

**⚠️ IMPORTANT:** The `DB_PASSWORD` MUST be set or the API will use DeepSeek for every word!

**After setting environment variables**, visit this URL to setup and migrate words:
```
https://your-app.ondigitalocean.app/setup-database
```

**Note:** The database stores both the word emotion data AND API processing logs for analytics.

## Step 5: Finalize and Deploy

1. Review all settings
2. Click **"Next"**
3. Review the summary
4. Click **"Create Resources"**

DigitalOcean will now:
- Clone your repository
- Install dependencies (npm install)
- Build your app
- Start the server
- Assign a URL

**Deployment takes 3-5 minutes.**

## Step 6: Get Your API URL

After deployment succeeds, find your URL:

**Location:** Top of the app page in DigitalOcean dashboard

**Format:** `https://your-app-name-xxxxx.ondigitalocean.app`

**Example:** `https://circuit-68ald.ondigitalocean.app`

## Step 7: Test Your Deployment

### Test health endpoint:

```bash
curl https://your-app.ondigitalocean.app/health
```

**Expected response:**
```json
{"status":"healthy","timestamp":"2026-01-07T00:00:00.000Z"}
```

### Test text analysis:

```bash
curl -X POST https://your-app.ondigitalocean.app/v1/analyze-text \
  -H "Authorization: Bearer sk_test_demo" \
  -H "Content-Type: application/json" \
  -d '{"text": "I am feeling really happy today!"}'
```

**Expected response:**
```json
{
  "success": true,
  "result": {
    "overall_emotion": "joy",
    "confidence": 0.85,
    "emotions": { ... },
    ...
  }
}
```

### Test stats endpoint:

```bash
curl https://your-app.ondigitalocean.app/v1/stats
```

## Step 8: Connect to Dashboard

1. Go to your Circuit Console dashboard
2. Navigate to **API Keys** page
3. Create a new API key
4. Copy the key when shown
5. Go to **Playground** page
6. Paste your API key
7. Test emotion analysis live!

## Auto-Deployment

Your app is now connected to GitHub. Any time you push to the main branch:

```bash
git add -A
git commit -m "Update API"
git push origin main
```

DigitalOcean will automatically:
1. Detect the push
2. Pull the latest code
3. Rebuild the app
4. Deploy the new version
5. Zero downtime!

## Monitoring

### View Logs

In DigitalOcean dashboard:
1. Click on your app
2. Click **"Runtime Logs"** tab
3. See real-time server logs

### Check Metrics

Click **"Insights"** tab to see:
- Request volume
- Response times
- Memory usage
- CPU usage

### View Deployments

Click **"Deployments"** tab to see:
- All deployments
- Build logs
- Rollback to previous versions

## Environment Variables Management

### To add/update environment variables:

1. Go to app **Settings** tab
2. Scroll to **"Environment Variables"**
3. Click **"Edit"**
4. Add or modify variables
5. Click **"Save"**
6. App will automatically redeploy

### To add Dashboard URL later:

```bash
# In DigitalOcean dashboard settings, add:
DASHBOARD_URL=https://your-new-dashboard-url.vercel.app
```

## Troubleshooting

### Build Fails

**Error:** "package-lock.json not found"

**Solution:**
```bash
cd api-deploy
npm install
git add package-lock.json
git commit -m "Add package-lock.json"
git push origin main
```

### Server Won't Start

**Error:** "TypeError: X is not a constructor"

**Solution:** Check that all require() statements match the module.exports format

**Check logs:** Runtime Logs tab in DigitalOcean

### API Returns 401

**Error:** "Invalid API key"

**Solution:** 
- Verify DASHBOARD_URL is set correctly
- Check that API key exists in dashboard
- Ensure key format is correct (sk_test_ or sk_live_)

### CORS Errors

**Error:** "blocked by CORS policy"

**Solution:** Verify your dashboard URL is in the CORS allowed origins list in server.js

### Timeout Errors

**Error:** "Function timeout"

**Solution:**
- Increase instance size
- Audio files may be too large
- Check processing time in logs

## Scaling

### Increase Performance

1. Go to app **Settings**
2. Scroll to **"Resources"**
3. Click **"Edit Plan"**
4. Choose larger instance:
   - Professional: 1GB RAM ($12/month)
   - Professional Plus: 2GB RAM ($24/month)

### Add More Containers

For high traffic:
1. Go to **"Resources"**
2. Increase **"Container Count"**
3. DigitalOcean will load balance automatically

## Costs

### App Platform Pricing

- **Basic:** 512MB RAM - $5/month
- **Professional:** 1GB RAM - $12/month  
- **Professional Plus:** 2GB RAM - $24/month

**No additional costs for:**
- Bandwidth (included)
- SSL certificates (free)
- Auto-scaling within plan

### Optional Add-ons

- **Managed Redis:** $15/month (for word database caching)
- **Dedicated Egress IP:** $25/month (not needed for most use cases)

## Production Checklist

Before going live:

- [ ] Set production environment variables
- [ ] Use production API keys (sk_live_)
- [ ] Test all endpoints thoroughly
- [ ] Set up monitoring/alerts
- [ ] Configure custom domain (optional)
- [ ] Review and optimize instance size
- [ ] Enable error tracking
- [ ] Document API for your team

## Custom Domain (Optional)

To use your own domain (e.g., api.yourdomain.com):

1. Go to app **Settings**
2. Scroll to **"Domains"**
3. Click **"Add Domain"**
4. Enter your domain
5. Add the DNS records DigitalOcean provides
6. Wait for DNS propagation (5-60 minutes)
7. SSL certificate is automatically provisioned

## Rollback

If a deployment breaks:

1. Go to **"Deployments"** tab
2. Find the last working deployment
3. Click the **"..." menu**
4. Select **"Redeploy"**
5. Confirm rollback

## Support

### DigitalOcean Support

- Documentation: https://docs.digitalocean.com/products/app-platform/
- Community: https://www.digitalocean.com/community
- Support tickets: https://cloud.digitalocean.com/support

### Circuit API Issues

- Check Runtime Logs in DigitalOcean
- Test endpoints with cURL
- Verify environment variables are set
- Check GitHub repo for latest code

## Quick Reference

### Useful Commands

```bash
# Test API health
curl https://your-app.ondigitalocean.app/health

# Test text analysis
curl -X POST https://your-app.ondigitalocean.app/v1/analyze-text \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "I am happy"}'

# View stats
curl https://your-app.ondigitalocean.app/v1/stats

# Push updates
git add -A
git commit -m "Update message"
git push origin main
# DigitalOcean auto-deploys!
```

### Important URLs

- **DigitalOcean Dashboard:** https://cloud.digitalocean.com/apps
- **Your API:** https://your-app.ondigitalocean.app
- **GitHub Repo:** https://github.com/austinway-boop/CircuitAPIDeploy
- **Dashboard:** https://dashboard-64ujb5r1k-austinway-8928s-projects.vercel.app

## Next Steps

After deployment:

1. Test all endpoints
2. Create API keys in dashboard
3. Use playground to verify functionality
4. Share API documentation with your team
5. Monitor usage and performance
6. Scale as needed

---

**Last updated:** January 2026

**Questions?** Check DigitalOcean docs or contact support.


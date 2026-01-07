# 🚀 Deploy Word Database Fix to DigitalOcean

## The Problem & Solution

**Problem:** DigitalOcean App Platform has an ephemeral filesystem - files reset on every deployment.  
**Solution:** Use PostgreSQL database for persistent word storage instead of JSON files.

## ✅ What's Been Done

1. ✅ Created PostgreSQL database schema (`db-schema.sql`)
2. ✅ Created database-backed emotion engine (`emotion-engine-db.js`)
3. ✅ Created migration script (`migrate-words-to-db.js`)
4. ✅ Created setup script (`setup-database.js`)
5. ✅ Updated `package.json` with new dependencies and scripts
6. ✅ Updated `server.js` to use database version
7. ✅ Updated deployment documentation

## 🎯 Deployment Steps

### Step 1: Install Dependencies Locally

```bash
cd /Users/austinway/Desktop/CircuitAlg/api-deploy
npm install
```

This installs the `pg` (PostgreSQL) package.

### Step 2: Setup Database (One-Time)

```bash
# Create tables in PostgreSQL
npm run setup-db

# Migrate all words from JSON to database
npm run migrate-words
```

**Expected output:**
```
✅ Connected to PostgreSQL database
✅ Schema created successfully
📊 Database contains 0 words

🚀 Starting word migration...
📂 Processing a.json...
📂 Processing b.json...
...
✅ Migration complete! Database now contains 5000+ words
```

### Step 3: Test Locally (Optional)

```bash
# Start the server locally to test database connection
npm start

# In another terminal, test:
curl http://localhost:8080/v1/stats
```

You should see the word count from the database.

### Step 4: Commit and Push to GitHub

```bash
git add -A
git commit -m "Add PostgreSQL database support for word persistence"
git push origin main
```

### Step 5: Update DigitalOcean Environment Variables

Go to your app in DigitalOcean dashboard and add these environment variables:

| Variable | Value |
|----------|-------|
| `DB_HOST` | app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com |
| `DB_PORT` | 25060 |
| `DB_USER` | db |
| `DB_PASSWORD` | (get from DigitalOcean database settings - encrypt this!) |
| `DB_NAME` | db |
| `DEEPSEEK_API_KEY` | your-deepseek-key (if not already set) |
| `DASHBOARD_URL` | your-dashboard-url (if not already set) |

**Important:** Click "Encrypt" on sensitive values like `DB_PASSWORD` and `DEEPSEEK_API_KEY`!

### Step 6: Deploy

DigitalOcean will automatically deploy when you push to GitHub. Or manually trigger:

1. Go to your app in DigitalOcean
2. Click "Deployments" tab
3. Click "Create Deployment"

### Step 7: Verify It's Working

After deployment completes:

```bash
# Test the API
curl https://your-app.ondigitalocean.app/v1/stats

# You should see:
{
  "success": true,
  "stats": {
    "word_database_size": 5000+,
    "system_status": "operational",
    ...
  }
}
```

```bash
# Test with a new word
curl -X POST https://your-app.ondigitalocean.app/v1/analyze-text \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "I feel supercalifragilisticexpialidocious today!"}'
```

Check the logs - you should see:
```
✅ Saved word "supercalifragilisticexpialidocious" to database
```

## 🎉 What This Fixes

### Before (File-Based)
- ❌ Words saved to JSON files
- ❌ Files reset on every deployment
- ❌ Words lost, reprocessed repeatedly
- ❌ Wasted DeepSeek API credits

### After (Database-Based)
- ✅ Words saved to PostgreSQL
- ✅ Words persist across deployments
- ✅ Each word processed once
- ✅ Massive cost savings
- ✅ API processing logs saved for analytics

## 📊 Database Tables

### `words` Table
Stores emotion data for each word:
- Word text
- Emotion probabilities (joy, trust, anger, etc.)
- VAD scores (valence, arousal, dominance)
- Sentiment data
- Social axes
- Timestamps

### `api_processing_logs` Table
Stores all API requests for analytics:
- Input text
- Results (emotions, confidence, etc.)
- Processing time
- DeepSeek API calls made
- New words added
- Timestamps

## 🔍 Monitoring

### Check Word Count
```bash
# SSH or use DigitalOcean console
psql "postgresql://db:YOUR_PASSWORD@app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com:25060/db?sslmode=require"

# Run query:
SELECT COUNT(*) FROM words;
```

### View Recent Words
```sql
SELECT word, created_at 
FROM words 
ORDER BY created_at DESC 
LIMIT 10;
```

### View API Usage Stats
```sql
SELECT * FROM api_usage_stats;
```

## 🆘 Troubleshooting

### Database Connection Fails

**Error:** "Connection refused" or "timeout"

**Solution:**
1. Check environment variables are set correctly
2. Verify database is running in DigitalOcean
3. Check SSL mode is set to `require`

### Words Not Being Saved

**Error:** No "✅ Saved word" messages in logs

**Solution:**
1. Check `DEEPSEEK_API_KEY` is set
2. Verify database connection is working
3. Check logs for SQL errors

### Migration Fails

**Error:** "Table already exists" or "duplicate key"

**Solution:**
- This is normal if running migration twice
- Words are skipped if they already exist (ON CONFLICT DO NOTHING)
- Check final count to verify all words migrated

## 📝 Files Created/Modified

### New Files
- ✅ `db-schema.sql` - Database schema
- ✅ `api/emotion-engine-db.js` - PostgreSQL-backed engine
- ✅ `migrate-words-to-db.js` - Migration script
- ✅ `setup-database.js` - Setup script
- ✅ `DEPLOY_TO_DIGITALOCEAN.md` - This file

### Modified Files
- ✅ `package.json` - Added `pg` dependency and scripts
- ✅ `server.js` - Uses `emotion-engine-db.js` instead of `emotion-engine.js`
- ✅ `DIGITALOCEAN_DEPLOYMENT.md` - Updated with database info

## 🎯 Next Steps

1. ✅ Run database setup locally
2. ✅ Run migration to import words
3. ✅ Test locally (optional)
4. ✅ Commit and push to GitHub
5. ✅ Add environment variables in DigitalOcean
6. ✅ Deploy (automatic or manual)
7. ✅ Verify word persistence is working
8. ✅ Monitor logs and database

## 💡 Benefits

- **Persistence:** Words survive deployments
- **Analytics:** Full API usage tracking
- **Scalability:** PostgreSQL handles millions of words
- **Performance:** Database queries are fast
- **Cost Savings:** No repeated DeepSeek calls
- **Reliability:** Professional database infrastructure

---

**Database ID:** 2c69acd5-7c22-41b0-aea2-a943caf2e6b9  
**Ready to deploy!** 🚀


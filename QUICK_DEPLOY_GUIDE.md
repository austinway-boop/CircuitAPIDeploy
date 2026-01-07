# ⚡ Quick Deploy Guide - Word Database Fix

## 🎯 The Fix

Your API now uses **PostgreSQL** instead of JSON files, so words persist across deployments on DigitalOcean App Platform.

## 🚀 Deploy in 3 Steps

### Step 1: Push Code to GitHub

```bash
cd /Users/austinway/Desktop/CircuitAlg/api-deploy

# Add all changes
git add -A

# Commit
git commit -m "Add PostgreSQL database support for word persistence"

# Push
git push origin main
```

### Step 2: Add Environment Variables in DigitalOcean

1. Go to https://cloud.digitalocean.com/apps
2. Click on your app
3. Go to **Settings** tab
4. Scroll to **Environment Variables**
5. Click **Edit**
6. Add these variables:

```
DB_HOST=app-59535ad6-9e8f-47d9-aa79-b99f9a3d9ca9-do-user-31625626-0.g.db.ondigitalocean.com
DB_PORT=25060
DB_USER=db
DB_PASSWORD=<your-database-password-from-digitalocean>
DB_NAME=db
```

**Important:** Click "Encrypt" on `DB_PASSWORD`!

7. Click **Save**

### Step 3: Setup Database (One-Time, from DigitalOcean Console)

The database setup needs to run from DigitalOcean (not your local machine) because the database only accepts connections from trusted sources.

**Option A: Use DigitalOcean Console (Easiest)**

1. Go to your app in DigitalOcean
2. Click **Console** tab
3. Run these commands:

```bash
# Setup database tables
npm run setup-db

# Migrate words from JSON to database
npm run migrate-words
```

**Option B: SSH into a DigitalOcean Droplet**

If you have a droplet:

```bash
ssh root@your-droplet-ip
cd /path/to/api-deploy
npm run setup-db
npm run migrate-words
```

**Option C: Run After First Deployment**

1. Deploy the app first (it will work but with empty database)
2. Use DigitalOcean's console to run migration
3. Redeploy if needed

## ✅ Verify It's Working

After deployment:

```bash
# Check word count
curl https://your-app.ondigitalocean.app/v1/stats

# Should show:
{
  "word_database_size": 5000+,
  ...
}
```

```bash
# Test with new word
curl -X POST https://your-app.ondigitalocean.app/v1/analyze-text \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "I feel wonderfabulastic!"}'
```

Check logs for:
```
✅ Saved word "wonderfabulastic" to database
```

## 🎉 What's Fixed

- ✅ Words now persist across deployments
- ✅ Each word only processed once
- ✅ Massive cost savings (no repeated DeepSeek calls)
- ✅ API processing logs saved for analytics

## 📝 Files Changed

- ✅ `api/emotion-engine-db.js` - New PostgreSQL-backed engine
- ✅ `server.js` - Uses database version
- ✅ `package.json` - Added `pg` dependency
- ✅ `db-schema.sql` - Database schema
- ✅ `setup-database.js` - Setup script
- ✅ `migrate-words-to-db.js` - Migration script

## 🆘 Troubleshooting

### Can't connect to database locally?

**This is normal!** The database only accepts connections from:
- DigitalOcean App Platform
- DigitalOcean Console
- Trusted IPs (if configured)

Run the setup from DigitalOcean Console instead.

### Words not being saved?

1. Check environment variables are set
2. Check `DEEPSEEK_API_KEY` is configured
3. Verify database migration ran successfully
4. Check logs for errors

### Migration shows 0 words?

Run the migration script:
```bash
# From DigitalOcean Console
npm run migrate-words
```

## 📚 More Info

- **Full Details:** See `DEPLOY_TO_DIGITALOCEAN.md`
- **Database Schema:** See `db-schema.sql`
- **Original Deployment:** See `DIGITALOCEAN_DEPLOYMENT.md`

---

**Database ID:** 2c69acd5-7c22-41b0-aea2-a943caf2e6b9  
**Ready to deploy!** 🚀


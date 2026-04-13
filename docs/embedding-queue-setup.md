# Queue-Based Embedding Update Setup

This document outlines the new queue-based embedding update system.

## 🎯 How It Works

```
User updates product
         ↓
Database trigger adds to queue (instant)
         ↓
Supabase pg_cron checks queue every 15 min
         ↓
If queue has items → Triggers GitHub Actions
         ↓
GitHub processes queue (5-10 min)
         ↓
Products searchable again (~15-20 min max delay)
         ↓
Daily 2 AM run catches anything missed
```

## 📦 Files Created

1. **Migrations:**
   - `20251217000000_add_embedding_queue.sql` - Creates queue table
   - `20251217000001_update_triggers_with_queue.sql` - Updates triggers to use queue
   - `20251217000002_setup_cron_for_queue.sql` - Sets up pg_cron schedule

2. **Scripts:**
   - `scripts/embedding-update-queue.js` - Processes queue items

3. **Workflows:**
   - `.github/workflows/embedding-update-queue.yml` - Updated workflow

## 🚀 Setup Steps

### 1. Run Migrations

```bash
cd /Users/sharvil/Desktop/query-your-helper
supabase db push
```

### 2. Setup GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token with `repo` scope
3. Copy the token

### 3. Configure Supabase Vault

In Supabase Dashboard → Project Settings → Vault:

```sql
-- Add GitHub PAT to database config
ALTER DATABASE postgres SET app.github_pat TO 'your_github_token_here';

-- Reload config
SELECT pg_reload_conf();
```

### 4. Verify pg_cron Schedule

```sql
-- Check scheduled jobs
SELECT * FROM cron.job;

-- Check cron logs
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### 5. Update GitHub Secrets

Ensure these secrets exist in GitHub repo settings:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_SERVICE_ROLE_KEY`

### 6. Test the System

```bash
# Test queue script locally
bun run scripts/embedding-update-queue.js

# Trigger GitHub Action manually
# Go to: GitHub Actions → Embedding Update (Queue-Based) → Run workflow
```

## ⚙️ Configuration

### Adjust Cron Frequency

Edit in `20251217000002_setup_cron_for_queue.sql`:

```sql
'*/15 * * * *'  -- Every 15 minutes (current)
'*/30 * * * *'  -- Every 30 minutes
'0 * * * *'     -- Every hour
```

Then re-run:
```sql
SELECT cron.unschedule('trigger-embedding-workflow-on-queue');
-- Then run the cron.schedule command again with new frequency
```

## 🔍 Monitoring

### Check Queue Status

```sql
-- Current queue
SELECT COUNT(*) as queue_count FROM embedding_queue;

-- Recent queue items
SELECT 
  p.product_name,
  eq.needs_text_embedding,
  eq.needs_image_embedding,
  eq.queued_at
FROM embedding_queue eq
JOIN products p ON eq.product_id = p.id
ORDER BY eq.queued_at DESC;
```

### Check Cron Execution

```sql
-- Recent cron runs
SELECT 
  jobid,
  runid, 
  job_pid, 
  database, 
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;
```

### Check GitHub Actions

Go to: `https://github.com/aak-ash/query-your-helper/actions`

## 🛠️ Troubleshooting

### Cron Not Triggering

```sql
-- Check if extension is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Check if job exists
SELECT * FROM cron.job WHERE jobname = 'trigger-embedding-workflow-on-queue';

-- Check for errors
SELECT * FROM cron.job_run_details 
WHERE status = 'failed' 
ORDER BY start_time DESC;
```

### GitHub Actions Not Starting

1. Verify GitHub PAT has `repo` scope
2. Check token is set correctly in Supabase
3. Verify repository name is correct in SQL

### Queue Items Not Processing

```bash
# Test locally
bun run scripts/embedding-update-queue.js

# Check for errors in GitHub Actions logs
```

## 📊 Benefits

- ⚡ **Near real-time**: 15-20 min max delay (vs 24 hours)
- 💰 **Cost-effective**: Only runs when needed
- 🛡️ **Safety net**: Daily full scan at 2 AM
- 🔒 **No Modal costs**: Uses free GitHub Actions
- ☁️ **Fully cloud-based**: No local machine needed

## 🔄 Rollback

If you need to revert:

```sql
-- Disable cron
SELECT cron.unschedule('trigger-embedding-workflow-on-queue');

-- Drop queue table
DROP TABLE IF EXISTS embedding_queue CASCADE;

-- Revert to old triggers (from 20251207040000_add_vector_versioning.sql)
```

Then use old workflow: `.github/workflows/daily-embedding-update.yml`

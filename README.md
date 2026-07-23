# RTD Transit Schedule App

Real-time transit tracking application for RTD (Regional Transportation District) rail lines, featuring live GTFS-RT updates and smart trip matching.

## Features

- 📍 **Real-time tracking** - Live train positions and arrival times via GTFS-RT
- 🚆 **All rail lines** - N, A, B, G, H, L, R, W, and E lines
- 🎯 **Smart matching** - Multi-tier trip matching with route+direction+time fallback
- ⏰ **Weekly updates** - Automated GTFS data sync every Sunday evening
- 📊 **Version tracking** - Monitor GTFS feed versions and data freshness

## Architecture

### Frontend (`index.html`)
- Real-time transit visualization
- GTFS-RT integration via Supabase Edge Function proxy
- Smart trip matching algorithm:
  - **Tier 1**: Exact trip_id match (fast path)
  - **Tier 2**: Route + direction + time match (±10 min window)
  - **Tier 3**: Fallback to scheduled data

### Backend (Supabase)
- PostgreSQL database with GTFS static data
- Edge Function proxy for GTFS-RT feeds (avoids CORS)
- Tables: `rtd_routes`, `rtd_stops`, `rtd_trips`, `rtd_stop_times`, `rtd_calendar`, `rtd_calendar_dates`, `rtd_feed_info`

### Data Pipeline (`scripts/rtd_import.py`)
- Downloads RTD GTFS feed weekly
- Filters to rail routes only (route_type 0, 1, 2)
- Imports to Supabase with version tracking
- Runs via GitHub Actions every Sunday at 10 PM MT

## Setup

### Prerequisites
- Supabase project with RTD tables
- GitHub repository secret: `SUPABASE_DB_URL` (direct Postgres connection string)
- Python 3.10+ for local testing

### 1. Create Supabase Tables

Run the SQL in `sql/create_feed_info_table.sql` in your Supabase SQL Editor:

```bash
# In Supabase dashboard → SQL Editor → New Query
# Paste contents of sql/create_feed_info_table.sql
# Click "Run"
```

This creates the `rtd_feed_info` table for tracking GTFS versions.

### 2. Set GitHub Secrets

In your GitHub repo:
1. Go to **Settings → Secrets and variables → Actions**
2. Add one secret:
   - `SUPABASE_DB_URL`: Your Supabase direct Postgres connection string
     (Project Settings → Database → Connection string → URI — use the
     direct or session-pooler URL, not the transaction-mode pooler on
     port 6543)

### 3. Trigger Initial Import

The GitHub Action runs automatically every Sunday, but you can trigger it manually:

1. Go to **Actions** tab in GitHub
2. Select **Update RTD GTFS Data** workflow
3. Click **Run workflow**
4. Wait for completion (~2-5 minutes)

## GTFS Data Management

### Weekly Sync Schedule

The GitHub Action (`.github/workflows/update-gtfs.yml`) runs:
- **When**: Every Sunday at 10 PM Mountain Time (5 AM UTC Monday)
- **What**: Downloads latest GTFS from RTD, imports rail data to Supabase
- **Logs**: Check Actions tab for import status and statistics

### Check GTFS Version

To see the current GTFS version in Supabase:

```sql
SELECT
    feed_version,
    feed_start_date,
    feed_end_date,
    last_updated
FROM rtd_feed_info
ORDER BY last_updated DESC
LIMIT 1;
```

### Check Data Freshness

To verify if data is stale (> 7 days old):

```sql
SELECT
    feed_version,
    last_updated,
    NOW() - last_updated AS age,
    CASE
        WHEN NOW() - last_updated > INTERVAL '7 days' THEN 'STALE ⚠️'
        ELSE 'FRESH ✅'
    END AS status
FROM rtd_feed_info
ORDER BY last_updated DESC
LIMIT 1;
```

### Manual Import (Local Testing)

To run the import script locally:

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres"

# Run import
python scripts/rtd_import.py
```

## Development

### Project Structure

```
/
├── index.html                      # Main application
├── .github/
│   └── workflows/
│       └── update-gtfs.yml        # Weekly GTFS sync automation
├── scripts/
│   └── rtd_import.py              # GTFS import script
├── sql/
│   └── create_feed_info_table.sql # Feed version tracking table
├── supabase/
│   └── functions/
│       └── gtfs-rt-proxy/         # GTFS-RT Edge Function
└── README.md                       # This file
```

### Key Files

- **`index.html`**: Frontend with real-time tracking and smart matching
- **`scripts/rtd_import.py`**: Python script for GTFS data import
- **`.github/workflows/update-gtfs.yml`**: GitHub Action for weekly sync
- **`sql/create_feed_info_table.sql`**: SQL schema for version tracking

## Troubleshooting

### No Live Data Showing

1. **Check GTFS-RT feeds are working**:
   - Open browser console
   - Look for "✅ GTFS-RT TripUpdates loaded: X entities"
   - If 0, check Supabase Edge Function logs

2. **Check trip matching**:
   - Console should show "✅ Matched by trip_id" or "✅ Matched by route+time"
   - If no matches, GTFS data may be stale

3. **Check data freshness**:
   - Run the freshness query (see above)
   - If STALE, manually trigger GitHub Action

### GitHub Action Failing

1. **Check secrets are set**:
   - Settings → Secrets → SUPABASE_DB_URL exists

2. **Check Supabase tables exist**:
   - Verify `rtd_feed_info` table created
   - Verify other RTD tables exist

3. **Check logs**:
   - Actions tab → Latest workflow run → View logs
   - Look for error messages in Python output

### Import Script Errors

Common issues:
- **"Missing required environment variable"**: Set SUPABASE_DB_URL
- **"Table does not exist"**: Run SQL scripts to create tables
- **"Failed to insert"**: Check column names match GTFS spec

## GTFS Data Sources

- **Static GTFS**: https://www.rtd-denver.com/files/gtfs/google_transit.zip
- **GTFS-RT Feeds**:
  - TripUpdates: https://www.rtd-denver.com/files/gtfs-rt/TripUpdate.pb
  - VehiclePositions: https://www.rtd-denver.com/files/gtfs-rt/VehiclePosition.pb
  - Alerts: https://www.rtd-denver.com/files/gtfs-rt/Alerts.pb

## License

MIT

#!/usr/bin/env python3
"""
RTD GTFS to Supabase Importer
Downloads RTD's GTFS feed and replaces the rtd_* tables in Supabase.

Every run is a full replace: all rtd_* tables are TRUNCATEd and reloaded
inside a single Postgres transaction (via a direct connection + COPY), so a
mid-import failure rolls back to the previous good data instead of leaving
the app with a half-loaded schedule or, worse, accumulating duplicate rows
on top of the old data.

Requirements:
    pip install requests psycopg2-binary python-dotenv

Usage:
    python rtd_import.py

Environment variables:
    SUPABASE_DB_URL   Direct Postgres connection string, e.g.
                       postgresql://postgres:PASSWORD@db.<project>.supabase.co:5432/postgres
                       (Supabase dashboard → Project Settings → Database →
                       Connection string → URI. Either the direct connection
                       or the session-mode pooler works; do NOT use the
                       transaction-mode pooler on port 6543 for this script,
                       since it can route different statements within the
                       same transaction to different backends.)
"""

import os
import sys
import csv
import io
import zipfile
import traceback
from datetime import datetime, timezone

import requests

try:
    import psycopg2
    import psycopg2.extras
except ImportError as e:
    print(f"❌ Failed to import psycopg2: {e}")
    print("Please install it with: pip install psycopg2-binary")
    sys.exit(1)

# ============================================
# Configuration
# ============================================

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")

if not SUPABASE_DB_URL:
    print("❌ ERROR: Missing required environment variable SUPABASE_DB_URL!")
    print("   Get it from: Supabase dashboard → Project Settings → Database")
    print("   → Connection string → URI (use the direct or session-pooler URL,")
    print("   NOT the transaction-mode pooler on port 6543).")
    print("\nFor local testing:")
    print("   export SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres")
    print("\nFor GitHub Actions, set it as a repository secret.")
    sys.exit(1)

RTD_GTFS_URL = "https://www.rtd-denver.com/files/gtfs/google_transit.zip"

# GTFS route_type: 0 = Light rail, 1 = Subway, 2 = Commuter rail, 3 = Bus
TARGET_ROUTE_TYPES = [0, 1, 2, 3]  # Rail + bus

# Every rtd_* table the loader manages, in an order that satisfies foreign
# keys for plain DELETE/INSERT statement ordering (not required for TRUNCATE,
# since all tables are truncated together in one statement, but kept explicit
# for clarity and so nothing is forgotten).
ALL_RTD_TABLES = [
    'rtd_feed_info',
    'rtd_stop_times',
    'rtd_frequencies',
    'rtd_fare_rules',
    'rtd_fare_attributes',
    'rtd_transfers',
    'rtd_trips',
    'rtd_calendar_dates',
    'rtd_calendar',
    'rtd_shapes',
    'rtd_stops',
    'rtd_routes',
]

# Column order to COPY for each table. Must match the columns actually
# present in the Supabase schema (auto-generated id/timestamp columns are
# omitted — Postgres fills those in via DEFAULT).
TABLE_COLUMNS = {
    'rtd_routes': [
        'route_id', 'route_short_name', 'route_long_name', 'route_type',
        'route_color', 'route_text_color', 'route_desc', 'route_sort_order',
    ],
    'rtd_stops': [
        'stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon',
        'zone_id', 'stop_url', 'location_type', 'parent_station',
        'wheelchair_boarding', 'platform_code',
    ],
    'rtd_trips': [
        'route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name',
        'direction_id', 'block_id', 'shape_id', 'wheelchair_accessible',
        'bikes_allowed',
    ],
    'rtd_stop_times': [
        'trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence',
        'stop_headsign', 'pickup_type', 'drop_off_type', 'timepoint',
    ],
    'rtd_calendar': [
        'service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
        'saturday', 'sunday', 'start_date', 'end_date',
    ],
    'rtd_calendar_dates': [
        'service_id', 'date', 'exception_type',
    ],
    'rtd_feed_info': [
        'feed_publisher_name', 'feed_publisher_url', 'feed_lang',
        'feed_start_date', 'feed_end_date', 'feed_version',
        'feed_contact_email', 'feed_contact_url', 'default_lang', 'feed_id',
        'last_updated',
    ],
    'rtd_shapes': [
        'shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled',
    ],
    'rtd_transfers': [
        'from_stop_id', 'to_stop_id', 'transfer_type', 'min_transfer_time',
    ],
    'rtd_frequencies': [
        'trip_id', 'start_time', 'end_time', 'headway_secs', 'exact_times',
    ],
    'rtd_fare_attributes': [
        'fare_id', 'price', 'currency_type', 'payment_method', 'transfers', 'transfer_duration',
    ],
    'rtd_fare_rules': [
        'fare_id', 'route_id', 'origin_id', 'destination_id', 'contains_id',
    ],
}

# ============================================
# Download + parse (unchanged logic, still pure Python / no DB access)
# ============================================

def download_gtfs():
    """Download and extract RTD GTFS ZIP file"""
    print("📥 Downloading RTD GTFS feed...")
    response = requests.get(RTD_GTFS_URL, timeout=120)
    response.raise_for_status()
    print(f"  Downloaded {len(response.content) / 1_000_000:.1f} MB")

    print("📦 Extracting GTFS files...")
    zip_file = zipfile.ZipFile(io.BytesIO(response.content))

    gtfs_data = {}
    files_to_extract = [
        'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt',
        'calendar.txt', 'calendar_dates.txt', 'feed_info.txt', 'shapes.txt',
        'transfers.txt', 'frequencies.txt', 'fare_attributes.txt', 'fare_rules.txt',
    ]
    OPTIONAL_FILES = ('feed_info.txt', 'shapes.txt', 'transfers.txt', 'frequencies.txt', 'fare_attributes.txt', 'fare_rules.txt')

    for filename in files_to_extract:
        if filename in zip_file.namelist():
            gtfs_data[filename] = zip_file.read(filename).decode('utf-8-sig')
        else:
            if filename in OPTIONAL_FILES:
                print(f"⚠️  Warning: {filename} not found (optional)")
            else:
                print(f"⚠️  Warning: {filename} not found in GTFS feed")

    return gtfs_data


def parse_csv(csv_text):
    if not csv_text:
        return []
    return list(csv.DictReader(io.StringIO(csv_text)))


def filter_routes(routes):
    filtered = []
    for r in routes:
        try:
            route_type = int(r.get('route_type', -1))
            if route_type in TARGET_ROUTE_TYPES:
                filtered.append(r)
        except (ValueError, TypeError):
            continue
    return filtered


def filter_trips(trips, route_ids):
    return [t for t in trips if t.get('route_id') in route_ids]


def filter_stop_times(stop_times, trip_ids):
    return [st for st in stop_times if st.get('trip_id') in trip_ids]


def filter_stops(stops, stop_times):
    stop_ids = set(st.get('stop_id') for st in stop_times)
    return [s for s in stops if s.get('stop_id') in stop_ids]


def filter_shapes(shapes, trips):
    shape_ids = set(t.get('shape_id') for t in trips if t.get('shape_id'))
    return [s for s in shapes if s.get('shape_id') in shape_ids]


def filter_transfers(transfers, stop_ids):
    return [t for t in transfers if t.get('from_stop_id') in stop_ids and t.get('to_stop_id') in stop_ids]


def filter_frequencies(frequencies, trip_ids):
    return [f for f in frequencies if f.get('trip_id') in trip_ids]


def filter_fare_rules(fare_rules, route_ids):
    return [fr for fr in fare_rules if fr.get('route_id') in route_ids]


def filter_fare_attributes(fare_attributes, fare_ids):
    return [fa for fa in fare_attributes if fa.get('fare_id') in fare_ids]


# ============================================
# Postgres load: TRUNCATE + COPY, one transaction
# ============================================

def get_stored_feed_version(cur):
    cur.execute("SELECT feed_version FROM rtd_feed_info ORDER BY last_updated DESC NULLS LAST LIMIT 1")
    row = cur.fetchone()
    return row[0] if row else None


def copy_records(cur, table: str, records: list):
    """COPY a list of dict records into `table` using TABLE_COLUMNS[table] as
    the column order. Missing/empty fields become NULL."""
    columns = TABLE_COLUMNS[table]
    if not records:
        print(f"  (no rows for {table})")
        return 0

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter='\t', lineterminator='\n')
    for record in records:
        row = []
        for col in columns:
            value = record.get(col)
            if value is None or value == '':
                row.append('\\N')  # Postgres COPY NULL marker
            else:
                # Escape characters that are meaningful to COPY's text format
                row.append(str(value).replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', ''))
        writer.writerow(row)
    buf.seek(0)

    col_list = ', '.join(columns)
    cur.copy_expert(f"COPY {table} ({col_list}) FROM STDIN WITH (FORMAT text, NULL '\\N')", buf)
    print(f"  ✓ Loaded {len(records)} rows into {table}")
    return len(records)


def run_import(conn, feed_info, filtered_routes, filtered_stops, filtered_trips,
                filtered_stop_times, filtered_shapes, filtered_calendar,
                filtered_calendar_dates, filtered_transfers, filtered_frequencies,
                filtered_fare_rules, filtered_fare_attributes):
    with conn.cursor() as cur:
        print("\n🗑️  Truncating all rtd_* tables (single statement, respects FKs automatically)...")
        cur.execute(f"TRUNCATE TABLE {', '.join(ALL_RTD_TABLES)} RESTART IDENTITY")

        print("\n💾 Loading fresh data via COPY...")

        total = 0
        # Order doesn't matter for FK validity here since FK checks are
        # deferred to end-of-transaction by default in Postgres only if
        # constraints are declared DEFERRABLE; to be safe we still load in
        # dependency order (parents before children).
        print("\n1️⃣ Routes")
        total += copy_records(cur, 'rtd_routes', filtered_routes)

        print("\n2️⃣ Stops")
        total += copy_records(cur, 'rtd_stops', filtered_stops)

        print("\n3️⃣ Calendar")
        total += copy_records(cur, 'rtd_calendar', filtered_calendar)

        print("\n4️⃣ Calendar Dates")
        total += copy_records(cur, 'rtd_calendar_dates', filtered_calendar_dates)

        print("\n5️⃣ Trips")
        total += copy_records(cur, 'rtd_trips', filtered_trips)

        print("\n6️⃣ Stop Times")
        total += copy_records(cur, 'rtd_stop_times', filtered_stop_times)

        print("\n7️⃣ Shapes")
        total += copy_records(cur, 'rtd_shapes', filtered_shapes)

        print("\n8️⃣ Transfers")
        total += copy_records(cur, 'rtd_transfers', filtered_transfers)

        print("\n9️⃣ Frequencies")
        total += copy_records(cur, 'rtd_frequencies', filtered_frequencies)

        print("\n🔟 Fare Attributes")
        total += copy_records(cur, 'rtd_fare_attributes', filtered_fare_attributes)

        print("\n1️⃣1️⃣ Fare Rules")
        total += copy_records(cur, 'rtd_fare_rules', filtered_fare_rules)

        print("\n1️⃣2️⃣ Feed Info")
        total += copy_records(cur, 'rtd_feed_info', feed_info)

        return total


# ============================================
# Main
# ============================================

def main():
    print("=" * 60)
    print("RTD GTFS → Supabase Importer (transactional full replace)")
    print("Routes: All Rail Lines (Light Rail + Commuter Rail) + Bus")
    print("=" * 60)
    print()

    print("🔌 Connecting to Supabase Postgres...")
    try:
        conn = psycopg2.connect(SUPABASE_DB_URL)
        conn.autocommit = False
        print("✓ Connected!\n")
    except Exception as e:
        print(f"❌ Failed to connect to Supabase Postgres: {e}")
        traceback.print_exc()
        sys.exit(1)

    try:
        gtfs_data = download_gtfs()
        print("✓ GTFS data downloaded!\n")

        print("📊 Parsing GTFS files...")
        routes = parse_csv(gtfs_data.get('routes.txt', ''))
        stops = parse_csv(gtfs_data.get('stops.txt', ''))
        trips = parse_csv(gtfs_data.get('trips.txt', ''))
        stop_times = parse_csv(gtfs_data.get('stop_times.txt', ''))
        calendar = parse_csv(gtfs_data.get('calendar.txt', ''))
        calendar_dates = parse_csv(gtfs_data.get('calendar_dates.txt', ''))
        feed_info = parse_csv(gtfs_data.get('feed_info.txt', ''))
        shapes = parse_csv(gtfs_data.get('shapes.txt', ''))
        transfers = parse_csv(gtfs_data.get('transfers.txt', ''))
        frequencies = parse_csv(gtfs_data.get('frequencies.txt', ''))
        fare_attributes = parse_csv(gtfs_data.get('fare_attributes.txt', ''))
        fare_rules = parse_csv(gtfs_data.get('fare_rules.txt', ''))
        print("✓ Parsing complete!\n")

        print(f"  Parsed: {len(routes)} routes, {len(stops)} stops, {len(trips)} trips, {len(stop_times)} stop_times\n")

        # Skip the reload entirely if the feed hasn't changed since last run.
        new_feed_version = feed_info[0].get('feed_version') if feed_info else None
        with conn.cursor() as cur:
            stored_feed_version = get_stored_feed_version(cur)
        if new_feed_version and stored_feed_version and new_feed_version == stored_feed_version:
            print(f"⏭️  Feed version unchanged ({new_feed_version}) — skipping reload.")
            conn.close()
            return

        print("🔍 Filtering to rail + bus routes...")
        filtered_routes = filter_routes(routes)
        route_ids = set(r['route_id'] for r in filtered_routes)
        route_names = ', '.join(sorted(r.get('route_short_name', 'Unknown') for r in filtered_routes))
        print(f"  Found {len(filtered_routes)} rail routes: {route_names}")

        filtered_trips = filter_trips(trips, route_ids)
        trip_ids = set(t['trip_id'] for t in filtered_trips)
        print(f"  Importing all {len(filtered_trips)} trips (full schedule, no sampling)")

        filtered_stop_times = filter_stop_times(stop_times, trip_ids)
        print(f"  Found {len(filtered_stop_times)} stop times")

        filtered_shapes = filter_shapes(shapes, filtered_trips)
        print(f"  Found {len(filtered_shapes)} shape points")

        filtered_stops = filter_stops(stops, filtered_stop_times)
        print(f"  Found {len(filtered_stops)} unique stops")

        service_ids = set(t['service_id'] for t in filtered_trips)
        filtered_calendar = [c for c in calendar if c.get('service_id') in service_ids]
        filtered_calendar_dates = [d for d in calendar_dates if d.get('service_id') in service_ids]

        stop_ids = set(s['stop_id'] for s in filtered_stops)
        filtered_transfers = filter_transfers(transfers, stop_ids)
        print(f"  Found {len(filtered_transfers)} transfers")

        filtered_frequencies = filter_frequencies(frequencies, trip_ids)
        print(f"  Found {len(filtered_frequencies)} frequency entries")

        filtered_fare_rules = filter_fare_rules(fare_rules, route_ids)
        fare_ids = set(fr['fare_id'] for fr in filtered_fare_rules if fr.get('fare_id'))
        filtered_fare_attributes = filter_fare_attributes(fare_attributes, fare_ids)
        print(f"  Found {len(filtered_fare_rules)} fare rules, {len(filtered_fare_attributes)} fare attributes")

        if feed_info:
            for record in feed_info:
                record['last_updated'] = datetime.now(timezone.utc).isoformat()
            print(f"  Feed version: {feed_info[0].get('feed_version', 'unknown')}\n")
        else:
            print("  No feed_info found (version tracking unavailable)\n")

        total = run_import(
            conn, feed_info, filtered_routes, filtered_stops, filtered_trips,
            filtered_stop_times, filtered_shapes, filtered_calendar,
            filtered_calendar_dates, filtered_transfers, filtered_frequencies,
            filtered_fare_rules, filtered_fare_attributes,
        )

        conn.commit()
        print("\n✅ Transaction committed — full replace successful.")

        print("\n" + "=" * 60)
        print(f"Import Summary: {total} total rows loaded")
        print(f"  • Feed version: {feed_info[0].get('feed_version', 'unknown') if feed_info else 'unknown'}")
        print(f"  • {len(filtered_routes)} routes (rail + bus)")
        print(f"  • {len(filtered_stops)} stops")
        print(f"  • {len(filtered_trips)} trips")
        print(f"  • {len(filtered_stop_times)} stop times")
        print(f"  • {len(filtered_shapes)} shape points")
        print(f"  • {len(filtered_calendar)} calendar entries")
        print(f"  • {len(filtered_calendar_dates)} calendar exceptions")
        print(f"  • {len(filtered_transfers)} transfers")
        print(f"  • {len(filtered_frequencies)} frequency entries")
        print(f"  • {len(filtered_fare_rules)} fare rules")
        print(f"  • {len(filtered_fare_attributes)} fare attributes")
        print(f"\nLast updated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("\n🎉 Ready to use! Your schedule app can now query Supabase.")

    except Exception:
        conn.rollback()
        print("\n❌ Import failed — transaction rolled back, previous data is intact.")
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Import cancelled by user")

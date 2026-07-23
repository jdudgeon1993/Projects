-- Deduplicate rtd_shapes and add a guard constraint so the weekly loader
-- can never silently accumulate duplicate shape points again.
--
-- Run this once to clean up existing duplication before the new loader
-- (which uses TRUNCATE + COPY) takes over. Safe to re-run.

-- 1. Remove duplicate (shape_id, shape_pt_sequence) rows, keeping the
--    lowest-id copy of each.
DELETE FROM rtd_shapes a
USING rtd_shapes b
WHERE a.id > b.id
  AND a.shape_id = b.shape_id
  AND a.shape_pt_sequence = b.shape_pt_sequence;

-- 2. Guard: prevent this from ever recurring. Any future loader run that
--    tries to insert a duplicate (shape_id, shape_pt_sequence) pair will now
--    fail loudly instead of silently ballooning the table.
ALTER TABLE rtd_shapes
  ADD CONSTRAINT rtd_shapes_shape_id_seq_key UNIQUE (shape_id, shape_pt_sequence);

-- 3. Reclaim disk space from the deleted rows (VACUUM FULL requires an
--    exclusive lock — run during a maintenance window, not automatically
--    from the loader).
-- VACUUM FULL rtd_shapes;

-- ---------------------------------------------------------------------------
-- One-time cleanup: rtd_feed_info has accumulated one row per weekly run
-- since the loader never truncated it. Keep only the most recent row; the
-- new loader truncates this table on every run going forward.
-- ---------------------------------------------------------------------------
DELETE FROM rtd_feed_info
WHERE id NOT IN (
  SELECT id FROM rtd_feed_info ORDER BY last_updated DESC NULLS LAST, id DESC LIMIT 1
);


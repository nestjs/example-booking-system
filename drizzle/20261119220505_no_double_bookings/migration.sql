-- btree_gist lets a GiST index compare uuid columns with =.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- No two confirmed bookings of one resource may overlap. tstzrange() builds
-- half-open ranges, [starts_at, ends_at), so back-to-back bookings don't.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status = 'confirmed');

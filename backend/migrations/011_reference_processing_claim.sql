-- Manual transactional prerequisite for processing after migration 010; deployed state is unknown.
-- Run with stop-on-error enabled after inspecting the target deployment.
-- This source does not establish ACL/RLS or concurrency acceptance.

BEGIN;

DO $processing_claim_preflight$
DECLARE
    reference_table_oid oid;
    status_type text;
    status_not_null boolean;
BEGIN
    reference_table_oid := to_regclass('public.label_reference_tracks');
    IF reference_table_oid IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE oid = reference_table_oid AND relkind = 'r'
    ) THEN
        RAISE EXCEPTION 'migration 011 requires public.label_reference_tracks';
    END IF;

    EXECUTE 'LOCK TABLE public.label_reference_tracks IN ACCESS EXCLUSIVE MODE';

    IF EXISTS (
        SELECT 1 FROM pg_attribute
         WHERE attrelid = reference_table_oid
           AND attname = 'processing_claim_token'
           AND attnum > 0 AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION 'processing_claim_token already exists; inspect migration history';
    END IF;

    SELECT format_type(atttypid, atttypmod), attnotnull
      INTO status_type, status_not_null
      FROM pg_attribute
     WHERE attrelid = reference_table_oid AND attname = 'status'
       AND attnum > 0 AND NOT attisdropped;
    IF status_type IS DISTINCT FROM 'character varying'
       OR status_not_null IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'label_reference_tracks has an unexpected status column shape';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = reference_table_oid
           AND conname = 'ck_label_reference_tracks_processing_final_identity'
           AND contype = 'c' AND convalidated
    ) THEN
        RAISE EXCEPTION 'migration 011 requires the migration 010 reference schema';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint AS constraint_row
        JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
        JOIN pg_namespace AS schema_row ON schema_row.oid = relation.relnamespace
        WHERE schema_row.nspname = 'public'
          AND constraint_row.conname = 'ck_label_reference_tracks_processing_claim_token_nonempty'
    ) OR EXISTS (
        SELECT 1 FROM pg_class AS relation
        JOIN pg_namespace AS schema_row ON schema_row.oid = relation.relnamespace
        WHERE schema_row.nspname = 'public'
          AND relation.relname = 'ck_label_reference_tracks_processing_claim_token_nonempty'
    ) THEN
        RAISE EXCEPTION 'processing claim constraint name already exists in public';
    END IF;
END;
$processing_claim_preflight$;

ALTER TABLE public.label_reference_tracks
    ADD COLUMN processing_claim_token TEXT,
    ADD CONSTRAINT ck_label_reference_tracks_processing_claim_token_nonempty
        CHECK (
            processing_claim_token IS NULL OR length(trim(processing_claim_token)) > 0
        );

COMMIT;

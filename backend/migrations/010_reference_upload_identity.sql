-- Manual, one-shot additive migration. Requires migration 009 to have been
-- successfully applied and reviewed first. The deployed state is unknown; do
-- not infer it from this source file. Run in one session with stop-on-error
-- enabled (for example, psql ON_ERROR_STOP=1) and require manual operator review.
-- ETags are opaque validators, not MD5 checksums or content-verification proofs.
-- Rollback is a separate manual review; never delete stored data as rollback.
-- This migration adds row-shape checks only; it does not implement history,
-- immutability, compare-and-swap, leases, promotion, or upload finalization.

BEGIN;

DO $reference_upload_identity_preflight$
DECLARE
    reference_table_oid oid;
    expected_column record;
    actual_type text;
    actual_not_null boolean;
    new_column_names text[] := ARRAY[
        'upload_idempotency_key', 'upload_filename', 'upload_size_bytes',
        'upload_limit_bytes', 'staging_key', 'staging_etag', 'final_etag'
    ];
    new_object_names text[] := ARRAY[
        'uq_label_reference_tracks_label_upload_key',
        'ck_label_reference_tracks_upload_reservation_shape',
        'ck_label_reference_tracks_upload_size_bounds',
        'ck_label_reference_tracks_upload_text_nonempty',
        'ck_label_reference_tracks_upload_filename_suffix',
        'ck_label_reference_tracks_staging_key_identity',
        'ck_label_reference_tracks_staging_etag_reservation',
        'ck_label_reference_tracks_final_identity_pair',
        'ck_label_reference_tracks_processing_final_identity'
    ];
BEGIN
    reference_table_oid := to_regclass('public.label_reference_tracks');
    IF reference_table_oid IS NULL THEN
        RAISE EXCEPTION
            'migration 010 requires public.label_reference_tracks from migration 009';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_class AS relation
         WHERE relation.oid = reference_table_oid
           AND relation.relkind = 'r'
    ) THEN
        RAISE EXCEPTION
            'public.label_reference_tracks is not the expected ordinary table shape';
    END IF;

    -- Hold the target table against concurrent DDL through COMMIT. All schema
    -- and name checks below occur only after this lock has been acquired.
    EXECUTE 'LOCK TABLE public.label_reference_tracks IN ACCESS EXCLUSIVE MODE';

    IF EXISTS (
        SELECT 1
          FROM pg_attribute
         WHERE attrelid = reference_table_oid
           AND attname::text = ANY (new_column_names)
           AND attnum > 0
           AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION
            'public.label_reference_tracks already has upload identity columns; inspect migration history';
    END IF;

    FOR expected_column IN
        SELECT *
          FROM (VALUES
              ('id', 'character varying', TRUE),
              ('label_id', 'character varying', TRUE),
              ('title', 'character varying', TRUE),
              ('artist', 'character varying', FALSE),
              ('storage_key', 'character varying', FALSE),
              ('duration_seconds', 'double precision', FALSE),
              ('status', 'character varying', TRUE),
              ('is_active', 'boolean', TRUE),
              ('created_at', 'timestamp with time zone', TRUE),
              ('updated_at', 'timestamp with time zone', TRUE)
          ) AS required(column_name, formatted_type, required_not_null)
    LOOP
        SELECT format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull
          INTO actual_type, actual_not_null
          FROM pg_attribute AS attribute
         WHERE attribute.attrelid = reference_table_oid
           AND attribute.attname = expected_column.column_name
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped;

        IF actual_type IS DISTINCT FROM expected_column.formatted_type
           OR actual_not_null IS DISTINCT FROM expected_column.required_not_null THEN
            RAISE EXCEPTION
                'public.label_reference_tracks has an unexpected base column shape at %',
                expected_column.column_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS ownership_fk
         WHERE ownership_fk.conrelid = reference_table_oid
           AND ownership_fk.conname = 'fk_label_reference_tracks_label'
           AND ownership_fk.contype = 'f'
           AND ownership_fk.convalidated
           AND ownership_fk.confrelid = to_regclass('public.label')
           AND ownership_fk.confdeltype = 'c'
           AND ownership_fk.conkey = ARRAY[(
               SELECT attribute.attnum::smallint
                 FROM pg_attribute AS attribute
                WHERE attribute.attrelid = reference_table_oid
                  AND attribute.attname = 'label_id'
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped
           )]::smallint[]
    ) THEN
        RAISE EXCEPTION
            'public.label_reference_tracks is missing the migration 009 label ownership foreign key';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint AS status_check
         WHERE status_check.conrelid = reference_table_oid
           AND status_check.conname = 'ck_label_reference_tracks_status'
           AND status_check.contype = 'c'
           AND status_check.convalidated
    ) THEN
        RAISE EXCEPTION
            'public.label_reference_tracks is missing its migration 009 status constraint';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_constraint AS existing_constraint
          JOIN pg_class AS constrained_table
            ON constrained_table.oid = existing_constraint.conrelid
          JOIN pg_namespace AS schema_row
            ON schema_row.oid = constrained_table.relnamespace
         WHERE schema_row.nspname = 'public'
           AND existing_constraint.conname = ANY (new_object_names)
    ) OR EXISTS (
        SELECT 1
          FROM pg_class AS existing_relation
          JOIN pg_namespace AS schema_row
            ON schema_row.oid = existing_relation.relnamespace
         WHERE schema_row.nspname = 'public'
           AND existing_relation.relname = ANY (new_object_names)
    ) THEN
        RAISE EXCEPTION
            'a conflicting upload identity constraint or index name already exists in public';
    END IF;
END;
$reference_upload_identity_preflight$;

ALTER TABLE public.label_reference_tracks
    ADD COLUMN upload_idempotency_key VARCHAR,
    ADD COLUMN upload_filename VARCHAR,
    ADD COLUMN upload_size_bytes INTEGER,
    ADD COLUMN upload_limit_bytes INTEGER,
    ADD COLUMN staging_key VARCHAR,
    ADD COLUMN staging_etag VARCHAR,
    ADD COLUMN final_etag VARCHAR;

ALTER TABLE public.label_reference_tracks
    ADD CONSTRAINT uq_label_reference_tracks_label_upload_key
        UNIQUE (label_id, upload_idempotency_key),
    ADD CONSTRAINT ck_label_reference_tracks_upload_reservation_shape
        CHECK (
            (upload_idempotency_key IS NOT NULL AND upload_filename IS NOT NULL AND
             upload_size_bytes IS NOT NULL AND upload_limit_bytes IS NOT NULL AND
             staging_key IS NOT NULL) OR
            (upload_idempotency_key IS NULL AND upload_filename IS NULL AND
             upload_size_bytes IS NULL AND upload_limit_bytes IS NULL AND
             staging_key IS NULL)
        ),
    ADD CONSTRAINT ck_label_reference_tracks_upload_size_bounds
        CHECK (
            upload_size_bytes IS NULL OR
            (upload_size_bytes IS NOT NULL AND upload_limit_bytes IS NOT NULL AND
             upload_size_bytes > 0 AND upload_size_bytes <= upload_limit_bytes AND
             upload_limit_bytes <= 209715200 AND
             upload_size_bytes = CAST(upload_size_bytes AS INTEGER) AND
             upload_limit_bytes = CAST(upload_limit_bytes AS INTEGER))
        ),
    ADD CONSTRAINT ck_label_reference_tracks_upload_text_nonempty
        CHECK (
            (upload_idempotency_key IS NULL OR length(trim(upload_idempotency_key)) > 0) AND
            (upload_filename IS NULL OR length(trim(upload_filename)) > 0) AND
            (staging_etag IS NULL OR length(trim(staging_etag)) > 0) AND
            (final_etag IS NULL OR length(trim(final_etag)) > 0)
        ),
    ADD CONSTRAINT ck_label_reference_tracks_upload_filename_suffix
        CHECK (
            upload_filename IS NULL OR
            (CASE
                WHEN length(upload_filename) > 4 THEN CASE
                    WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.wav' THEN '.wav'
                    WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.aif' THEN '.aiff'
                    WHEN length(upload_filename) > 5 THEN CASE
                        WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.flac' THEN '.flac'
                        WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.aiff' THEN '.aiff'
                        ELSE NULL
                    END
                    ELSE NULL
                END
                ELSE NULL
            END) IS NOT NULL
        ),
    ADD CONSTRAINT ck_label_reference_tracks_staging_key_identity
        CHECK (
            CASE
                WHEN staging_key IS NULL AND upload_filename IS NULL THEN TRUE
                WHEN staging_key IS NOT NULL AND upload_filename IS NOT NULL AND
                     (CASE
                         WHEN length(upload_filename) > 4 THEN CASE
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.wav' THEN '.wav'
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.aif' THEN '.aiff'
                             WHEN length(upload_filename) > 5 THEN CASE
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.flac' THEN '.flac'
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.aiff' THEN '.aiff'
                                 ELSE NULL
                             END
                             ELSE NULL
                         END
                         ELSE NULL
                     END) IS NOT NULL
                THEN staging_key =
                     'label-references/' || label_id || '/' || id || '/staging/original' ||
                     (CASE
                         WHEN length(upload_filename) > 4 THEN CASE
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.wav' THEN '.wav'
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.aif' THEN '.aiff'
                             WHEN length(upload_filename) > 5 THEN CASE
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.flac' THEN '.flac'
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.aiff' THEN '.aiff'
                                 ELSE NULL
                             END
                             ELSE NULL
                         END
                         ELSE NULL
                     END)
                ELSE FALSE
            END
        ),
    ADD CONSTRAINT ck_label_reference_tracks_staging_etag_reservation
        CHECK (
            staging_etag IS NULL OR
            (upload_idempotency_key IS NOT NULL AND upload_filename IS NOT NULL AND
             upload_size_bytes IS NOT NULL AND upload_limit_bytes IS NOT NULL AND
             staging_key IS NOT NULL)
        ),
    ADD CONSTRAINT ck_label_reference_tracks_final_identity_pair
        CHECK (
            CASE
                WHEN upload_idempotency_key IS NULL AND upload_filename IS NULL AND
                     upload_size_bytes IS NULL AND upload_limit_bytes IS NULL AND
                     staging_key IS NULL AND staging_etag IS NULL AND final_etag IS NULL THEN TRUE
                WHEN storage_key IS NULL AND final_etag IS NULL THEN TRUE
                WHEN storage_key IS NOT NULL AND final_etag IS NOT NULL AND
                     staging_etag IS NOT NULL AND upload_filename IS NOT NULL AND
                     (CASE
                         WHEN length(upload_filename) > 4 THEN CASE
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.wav' THEN '.wav'
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.aif' THEN '.aiff'
                             WHEN length(upload_filename) > 5 THEN CASE
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.flac' THEN '.flac'
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.aiff' THEN '.aiff'
                                 ELSE NULL
                             END
                             ELSE NULL
                         END
                         ELSE NULL
                     END) IS NOT NULL
                THEN storage_key =
                     'label-references/' || label_id || '/' || id || '/original' ||
                     (CASE
                         WHEN length(upload_filename) > 4 THEN CASE
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.wav' THEN '.wav'
                             WHEN lower(substr(upload_filename, length(upload_filename) - 3, 4)) = '.aif' THEN '.aiff'
                             WHEN length(upload_filename) > 5 THEN CASE
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.flac' THEN '.flac'
                                 WHEN lower(substr(upload_filename, length(upload_filename) - 4, 5)) = '.aiff' THEN '.aiff'
                                 ELSE NULL
                             END
                             ELSE NULL
                         END
                         ELSE NULL
                     END)
                ELSE FALSE
            END
        ),
    ADD CONSTRAINT ck_label_reference_tracks_processing_final_identity
        CHECK (
            CASE
                WHEN upload_idempotency_key IS NULL AND upload_filename IS NULL AND
                     upload_size_bytes IS NULL AND upload_limit_bytes IS NULL AND
                     staging_key IS NULL AND staging_etag IS NULL AND final_etag IS NULL THEN TRUE
                ELSE status NOT IN ('processing', 'ready') OR
                     (storage_key IS NOT NULL AND final_etag IS NOT NULL AND
                      staging_etag IS NOT NULL)
            END
        );

COMMIT;

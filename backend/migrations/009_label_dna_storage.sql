-- Additive, one-shot storage migration for label-owned references and embeddings.
-- Execute this entire file in one session with stop-on-error enabled. It owns its
-- transaction and rejects pre-existing private tables rather than reusing them.
-- Prerequisites: public.label, public.submission, auth.uid(), anon, authenticated.

BEGIN;

-- This preflight must stay first: failed retries against partially deployed or
-- pre-existing private objects need human review, never permissive reuse.
DO $private_tables_preflight$
DECLARE
    label_table_oid oid;
    submission_table_oid oid;
    id_attnum smallint;
    label_id_attnum smallint;
    has_composite_unique boolean;
BEGIN
    IF to_regclass('public.label_reference_tracks') IS NOT NULL THEN
        RAISE EXCEPTION
            'public.label_reference_tracks already exists; inspect migration history before retrying';
    END IF;
    IF to_regclass('public.music_embeddings') IS NOT NULL THEN
        RAISE EXCEPTION
            'public.music_embeddings already exists; inspect migration history before retrying';
    END IF;

    label_table_oid := to_regclass('public.label');
    submission_table_oid := to_regclass('public.submission');
    IF label_table_oid IS NULL OR submission_table_oid IS NULL THEN
        RAISE EXCEPTION 'migration 009 requires public.label and public.submission';
    END IF;
    IF to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'migration 009 requires Supabase auth.uid()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION 'migration 009 requires Supabase anon and authenticated roles';
    END IF;

    SELECT attnum INTO id_attnum
      FROM pg_attribute
     WHERE attrelid = submission_table_oid
       AND attname = 'id'
       AND attnum > 0
       AND NOT attisdropped;
    SELECT attnum INTO label_id_attnum
      FROM pg_attribute
     WHERE attrelid = submission_table_oid
       AND attname = 'label_id'
       AND attnum > 0
       AND NOT attisdropped;
    IF id_attnum IS NULL OR label_id_attnum IS NULL THEN
        RAISE EXCEPTION 'public.submission must have id and label_id columns';
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM pg_index AS index_row
         WHERE index_row.indrelid = submission_table_oid
           AND index_row.indisunique
           AND index_row.indisvalid
           AND index_row.indisready
           AND index_row.indpred IS NULL
           AND index_row.indexprs IS NULL
           AND index_row.indnkeyatts = 2
           AND index_row.indnatts = 2
           AND index_row.indkey[0] = id_attnum
           AND index_row.indkey[1] = label_id_attnum
           AND NOT EXISTS (
               SELECT 1
                 FROM pg_constraint AS unique_constraint
                WHERE unique_constraint.conindid = index_row.indexrelid
                  AND unique_constraint.condeferrable
           )
    ) INTO has_composite_unique;

    IF EXISTS (
        SELECT 1
          FROM pg_constraint AS named_constraint
         WHERE named_constraint.conrelid = submission_table_oid
           AND named_constraint.conname = 'uq_submission_id_label_id'
           AND NOT (
               named_constraint.contype = 'u'
               AND named_constraint.conkey = ARRAY[id_attnum, label_id_attnum]::smallint[]
               AND NOT named_constraint.condeferrable
           )
    ) THEN
        RAISE EXCEPTION
            'public.submission has a conflicting uq_submission_id_label_id constraint; inspect it without replacing it';
    END IF;

    IF to_regclass('public.uq_submission_id_label_id') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM pg_index AS named_index
            WHERE named_index.indexrelid = to_regclass('public.uq_submission_id_label_id')
              AND named_index.indrelid = submission_table_oid
              AND named_index.indisunique
              AND named_index.indisvalid
              AND named_index.indisready
              AND named_index.indpred IS NULL
              AND named_index.indexprs IS NULL
              AND named_index.indnkeyatts = 2
              AND named_index.indnatts = 2
              AND named_index.indkey[0] = id_attnum
              AND named_index.indkey[1] = label_id_attnum
              AND NOT EXISTS (
                  SELECT 1
                    FROM pg_constraint AS unique_constraint
                   WHERE unique_constraint.conindid = named_index.indexrelid
                     AND unique_constraint.condeferrable
              )
       ) THEN
        RAISE EXCEPTION
            'public submission relation uq_submission_id_label_id conflicts; inspect it without replacing it';
    END IF;

    IF NOT has_composite_unique THEN
        ALTER TABLE public.submission
            ADD CONSTRAINT uq_submission_id_label_id UNIQUE (id, label_id);
    END IF;
END;
$private_tables_preflight$;

-- Reuse the installed vector extension schema; otherwise prefer Supabase's
-- extensions schema and fall back to public. Never move an existing extension.
DO $vector_extension$
DECLARE
    vector_schema text;
BEGIN
    SELECT namespace.nspname
      INTO vector_schema
      FROM pg_extension AS extension
      JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
     WHERE extension.extname = 'vector';

    IF vector_schema IS NULL THEN
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
            EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions';
        ELSE
            EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public';
        END IF;

        SELECT namespace.nspname
          INTO vector_schema
          FROM pg_extension AS extension
          JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
         WHERE extension.extname = 'vector';
    END IF;

    IF vector_schema IS NULL OR NOT EXISTS (
        SELECT 1
          FROM pg_type AS type
          JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
         WHERE type.typname = 'vector'
           AND namespace.nspname = vector_schema
    ) THEN
        RAISE EXCEPTION 'pgvector extension is installed without its vector type';
    END IF;
END;
$vector_extension$;

CREATE TABLE public.label_reference_tracks (
    id VARCHAR NOT NULL,
    label_id VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    artist VARCHAR,
    storage_key VARCHAR,
    duration_seconds DOUBLE PRECISION,
    status VARCHAR NOT NULL DEFAULT 'uploaded',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_label_reference_tracks PRIMARY KEY (id),
    CONSTRAINT uq_label_reference_tracks_id_label_id UNIQUE (id, label_id),
    CONSTRAINT fk_label_reference_tracks_label
        FOREIGN KEY (label_id) REFERENCES public.label (id) ON DELETE CASCADE,
    CONSTRAINT ck_label_reference_tracks_title_nonempty
        CHECK (length(trim(title)) > 0),
    CONSTRAINT ck_label_reference_tracks_status
        CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
    CONSTRAINT ck_label_reference_tracks_duration
        CHECK (duration_seconds IS NULL OR (duration_seconds >= 0 AND
               duration_seconds <= 1.7976931348623157e308)),
    CONSTRAINT ck_label_reference_tracks_storage_key
        CHECK (storage_key IS NULL OR length(trim(storage_key)) > 0)
);

-- Dynamic qualification avoids dependence on search_path for the vector type.
DO $music_embeddings_table$
DECLARE
    vector_schema text;
BEGIN
    SELECT namespace.nspname
      INTO vector_schema
      FROM pg_extension AS extension
      JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
     WHERE extension.extname = 'vector';

    IF vector_schema IS NULL THEN
        RAISE EXCEPTION 'pgvector extension is unavailable while creating music_embeddings';
    END IF;

    EXECUTE format($create_table$
        CREATE TABLE public.music_embeddings (
            id VARCHAR NOT NULL,
            label_id VARCHAR NOT NULL,
            reference_track_id VARCHAR,
            submission_id VARCHAR,
            embedding %I.vector(512) NOT NULL,
            provider VARCHAR NOT NULL,
            model VARCHAR NOT NULL,
            version VARCHAR NOT NULL,
            dimension INTEGER NOT NULL,
            pipeline_version VARCHAR NOT NULL,
            segment_index INTEGER NOT NULL DEFAULT -1,
            start_seconds DOUBLE PRECISION,
            end_seconds DOUBLE PRECISION,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT pk_music_embeddings PRIMARY KEY (id),
            CONSTRAINT fk_music_embeddings_label
                FOREIGN KEY (label_id) REFERENCES public.label (id) ON DELETE CASCADE,
            CONSTRAINT fk_music_embeddings_reference_track_label
                FOREIGN KEY (reference_track_id, label_id)
                REFERENCES public.label_reference_tracks (id, label_id) ON DELETE CASCADE,
            CONSTRAINT fk_music_embeddings_submission_label
                FOREIGN KEY (submission_id, label_id)
                REFERENCES public.submission (id, label_id) ON DELETE CASCADE,
            CONSTRAINT ck_music_embeddings_exactly_one_owner
                CHECK ((reference_track_id IS NOT NULL) <> (submission_id IS NOT NULL)),
            CONSTRAINT ck_music_embeddings_identity_nonempty
                CHECK (length(trim(provider)) > 0 AND length(trim(model)) > 0 AND
                       length(trim(version)) > 0 AND length(trim(pipeline_version)) > 0),
            CONSTRAINT ck_music_embeddings_dimension CHECK (dimension = 512),
            CONSTRAINT ck_music_embeddings_segment_bounds
                CHECK (segment_index >= -1 AND
                       ((segment_index = -1 AND start_seconds IS NULL AND end_seconds IS NULL) OR
                        (segment_index >= 0 AND start_seconds IS NOT NULL AND
                         end_seconds IS NOT NULL AND start_seconds >= 0 AND
                         start_seconds <= 1.7976931348623157e308 AND
                         end_seconds > start_seconds AND
                         end_seconds <= 1.7976931348623157e308))
        )
    $create_table$, vector_schema);
END;
$music_embeddings_table$;

-- Re-embedding at another provider/model/version/pipeline may coexist, but an
-- exact owner + segment + identity tuple is unique.
CREATE UNIQUE INDEX uq_music_embeddings_reference_identity
    ON public.music_embeddings
       (label_id, reference_track_id, segment_index, provider, model, version,
        dimension, pipeline_version)
    WHERE reference_track_id IS NOT NULL;
CREATE UNIQUE INDEX uq_music_embeddings_submission_identity
    ON public.music_embeddings
       (label_id, submission_id, segment_index, provider, model, version,
        dimension, pipeline_version)
    WHERE submission_id IS NOT NULL;
CREATE INDEX ix_label_reference_tracks_label_id
    ON public.label_reference_tracks (label_id);
CREATE INDEX ix_music_embeddings_label_id
    ON public.music_embeddings (label_id);

ALTER TABLE public.label_reference_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.music_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY label_reference_tracks_owner_access
    ON public.label_reference_tracks
    FOR ALL TO authenticated
    USING (label_id = auth.uid()::text)
    WITH CHECK (label_id = auth.uid()::text);
CREATE POLICY music_embeddings_owner_access
    ON public.music_embeddings
    FOR ALL TO authenticated
    USING (label_id = auth.uid()::text)
    WITH CHECK (label_id = auth.uid()::text);

-- Catch unexpected explicit default ACL grants to other roles before narrowing
-- grants on these new tables. Migration-owned access is expected; role alignment
-- and inherited privileges still require isolated rollout review.
DO $default_acl_preflight$
DECLARE
    unexpected_grantee text;
BEGIN
    SELECT DISTINCT COALESCE(role.rolname, 'unknown role')
      INTO unexpected_grantee
      FROM pg_class AS relation
      CROSS JOIN LATERAL aclexplode(
          COALESCE(relation.relacl, acldefault('r', relation.relowner))
      ) AS acl
      LEFT JOIN pg_roles AS role ON role.oid = acl.grantee
     WHERE relation.oid IN (
               'public.label_reference_tracks'::regclass,
               'public.music_embeddings'::regclass
           )
       AND acl.grantee <> relation.relowner
       AND acl.grantee <> 0::oid
       AND (role.rolname IS NULL OR role.rolname NOT IN ('anon', 'authenticated'))
     LIMIT 1;

    IF unexpected_grantee IS NOT NULL THEN
        RAISE EXCEPTION
            'unexpected default privilege for role % on new Label DNA tables; inspect default ACLs before retrying',
            unexpected_grantee;
    END IF;
END;
$default_acl_preflight$;

REVOKE ALL ON TABLE public.label_reference_tracks, public.music_embeddings
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.label_reference_tracks, public.music_embeddings TO authenticated;

COMMIT;

-- Manual transactional prerequisite for the catalog fit scores cache;
-- run only after migration 011; deployed state is unknown. Run with
-- stop-on-error enabled after inspecting the target deployment.

BEGIN;
-- The preflight must stay first: fail closed on partial or repeated deployment.
DO $label_catalog_fit_scores_preflight$
DECLARE
    reference_table_oid oid := to_regclass('public.label_reference_tracks');
BEGIN
    IF to_regclass('public.label_catalog_fit_scores') IS NOT NULL THEN
        RAISE EXCEPTION
            'public.label_catalog_fit_scores already exists; inspect migration history before retrying';
    END IF;
    IF reference_table_oid IS NULL
       OR to_regclass('public.submission') IS NULL
       OR to_regclass('public.label') IS NULL THEN
        RAISE EXCEPTION
            'migration 012 requires public.label, public.submission, and public.label_reference_tracks';
    END IF;
    IF to_regprocedure('auth.uid()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION
            'migration 012 requires Supabase auth.uid() and anon/authenticated roles';
    END IF;
    -- Migration 011 marker: refuse unless the claim-token constraint exists.
    IF (
        SELECT count(*)
          FROM pg_constraint
         WHERE conrelid = reference_table_oid
           AND conname = 'ck_label_reference_tracks_processing_claim_token_nonempty'
           AND contype = 'c' AND convalidated
    ) = 0 THEN
        RAISE EXCEPTION
            'migration 012 requires the migration 011 claim-token schema; inspect migration history before retrying';
    END IF;
END;
$label_catalog_fit_scores_preflight$;
-- Identifier columns are UUID-format VARCHAR strings matching the 009 parent
-- key types. Eligible fingerprint derivation (cache-fill path, never this
-- migration): sorted eligible reference ids joined with newlines plus the max
-- music_embeddings created_at (ISO-8601 UTC), hashed with SHA-256 into an opaque digest.
CREATE TABLE public.label_catalog_fit_scores (
    id VARCHAR NOT NULL,
    label_id VARCHAR NOT NULL,
    query_submission_id VARCHAR NOT NULL,
    reference_track_id VARCHAR,
    provider VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    version VARCHAR NOT NULL,
    dimension INTEGER NOT NULL,
    pipeline_version VARCHAR NOT NULL,
    k INTEGER NOT NULL,
    score DOUBLE PRECISION NOT NULL,
    eligible_count INTEGER NOT NULL,
    eligible_fingerprint VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_label_catalog_fit_scores PRIMARY KEY (id),
    CONSTRAINT fk_label_catalog_fit_scores_reference_track_label
        FOREIGN KEY (reference_track_id, label_id)
        REFERENCES public.label_reference_tracks (id, label_id) ON DELETE CASCADE,
    CONSTRAINT fk_label_catalog_fit_scores_submission_label
        FOREIGN KEY (query_submission_id, label_id)
        REFERENCES public.submission (id, label_id) ON DELETE CASCADE,
    CONSTRAINT ck_label_catalog_fit_scores_aggregate_xor
        CHECK ((reference_track_id IS NULL) <> (reference_track_id IS NOT NULL)),
    CONSTRAINT ck_label_catalog_fit_scores_identity_nonempty
        CHECK (length(trim(provider)) > 0 AND length(trim(model)) > 0 AND length(trim(version)) > 0
               AND length(trim(pipeline_version)) > 0),
    CONSTRAINT ck_label_catalog_fit_scores_fingerprint_nonempty
        CHECK (length(trim(eligible_fingerprint)) > 0),
    CONSTRAINT ck_label_catalog_fit_scores_dimension CHECK (dimension = 512),
    CONSTRAINT ck_label_catalog_fit_scores_k_positive CHECK (k > 0),
    CONSTRAINT ck_label_catalog_fit_scores_eligible_count CHECK (eligible_count >= 0),
    CONSTRAINT ck_label_catalog_fit_scores_score_finite
        CHECK (score = score AND score >= -1.7976931348623157e308 AND score <= 1.7976931348623157e308)
);
-- Each row shape has its own exact-identity uniqueness; re-scoring coexists.
CREATE UNIQUE INDEX uq_label_catalog_fit_scores_reference_identity
    ON public.label_catalog_fit_scores
       (label_id, query_submission_id, reference_track_id, provider, model,
        version, dimension, pipeline_version, k)
    WHERE reference_track_id IS NOT NULL;
CREATE UNIQUE INDEX uq_label_catalog_fit_scores_aggregate_identity
    ON public.label_catalog_fit_scores
       (label_id, query_submission_id, provider, model, version, dimension,
        pipeline_version, k)
    WHERE reference_track_id IS NULL;
CREATE INDEX ix_label_catalog_fit_scores_label_id
    ON public.label_catalog_fit_scores (label_id, query_submission_id);
ALTER TABLE public.label_catalog_fit_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY label_catalog_fit_scores_owner_access
    ON public.label_catalog_fit_scores
    FOR ALL TO authenticated
    USING (label_id = auth.uid()::text)
    WITH CHECK (label_id = auth.uid()::text);
-- Catch unexpected default ACL grants on the new table before narrowing grants.
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
     WHERE relation.oid = 'public.label_catalog_fit_scores'::regclass
       AND acl.grantee <> relation.relowner
       AND acl.grantee <> 0::oid
       AND (role.rolname IS NULL OR role.rolname NOT IN ('anon', 'authenticated'))
     LIMIT 1;
    IF unexpected_grantee IS NOT NULL THEN
        RAISE EXCEPTION
            'unexpected default privilege for role % on the new catalog fit scores table; inspect default ACLs before retrying',
            unexpected_grantee;
    END IF;
END;
$default_acl_preflight$;

REVOKE ALL ON TABLE public.label_catalog_fit_scores
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.label_catalog_fit_scores TO authenticated;
COMMIT;

-- Manual transactional prerequisite for the label A&R decision history;
-- run only after migration 012; deployed state is unknown. Run with
-- stop-on-error enabled after inspecting the target deployment.

BEGIN;
-- The preflight must stay first: fail closed on partial or repeated deployment.
DO $label_ar_decisions_preflight$
DECLARE
    submission_table_oid oid := to_regclass('public.submission');
BEGIN
    IF to_regclass('public.label_ar_decisions') IS NOT NULL THEN
        RAISE EXCEPTION
            'public.label_ar_decisions already exists; inspect migration history before retrying';
    END IF;
    IF submission_table_oid IS NULL
       OR to_regclass('public.label') IS NULL THEN
        RAISE EXCEPTION
            'migration 013 requires public.label and public.submission';
    END IF;
    IF to_regprocedure('auth.uid()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
       OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION
            'migration 013 requires Supabase auth.uid() and anon/authenticated roles';
    END IF;
    -- Migration 012 marker: refuse unless the catalog fit scores table exists
    -- with its validated aggregate-xor check constraint.
    IF to_regclass('public.label_catalog_fit_scores') IS NULL
       OR (
           SELECT count(*)
             FROM pg_constraint
            WHERE conrelid = to_regclass('public.label_catalog_fit_scores')
              AND conname = 'ck_label_catalog_fit_scores_aggregate_xor'
              AND contype = 'c' AND convalidated
       ) = 0 THEN
        RAISE EXCEPTION
            'migration 013 requires the migration 012 catalog fit scores schema; inspect migration history before retrying';
    END IF;
END;
$label_ar_decisions_preflight$;
-- Append-only A&R decision history: one immutable row per review action; there
-- is no mutable-timestamp column and no update path, and the current decision
-- derives on read from the latest decided_at per (label_id, submission_id).
-- 'inbox' is not a decision and auto-rejection is forbidden, so the vocabulary
-- reuses the Submission states limited to 'shortlist' / 'rejected'.
-- note mirrors the Submission.notes precedent: nullable VARCHAR, no length cap.
CREATE TABLE public.label_ar_decisions (
    id VARCHAR NOT NULL,
    label_id VARCHAR NOT NULL,
    submission_id VARCHAR NOT NULL,
    decision VARCHAR NOT NULL,
    decided_by VARCHAR NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL,
    note VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_label_ar_decisions PRIMARY KEY (id),
    CONSTRAINT fk_label_ar_decisions_label
        FOREIGN KEY (label_id) REFERENCES public.label (id) ON DELETE CASCADE,
    CONSTRAINT fk_label_ar_decisions_submission_label
        FOREIGN KEY (submission_id, label_id)
        REFERENCES public.submission (id, label_id) ON DELETE CASCADE,
    CONSTRAINT ck_label_ar_decisions_decision_allowed
        CHECK (decision IN ('shortlist', 'rejected')),
    CONSTRAINT ck_label_ar_decisions_decided_by_nonempty
        CHECK (length(trim(decided_by)) > 0)
);
-- Latest-wins reads per (label, submission) scan decided_at in order.
CREATE INDEX ix_label_ar_decisions_label_submission
    ON public.label_ar_decisions (label_id, submission_id, decided_at);
ALTER TABLE public.label_ar_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY label_ar_decisions_owner_access
    ON public.label_ar_decisions
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
     WHERE relation.oid = 'public.label_ar_decisions'::regclass
       AND acl.grantee <> relation.relowner
       AND acl.grantee <> 0::oid
       AND (role.rolname IS NULL OR role.rolname NOT IN ('anon', 'authenticated'))
     LIMIT 1;
    IF unexpected_grantee IS NOT NULL THEN
        RAISE EXCEPTION
            'unexpected default privilege for role % on the new label ar decisions table; inspect default ACLs before retrying',
            unexpected_grantee;
    END IF;
END;
$default_acl_preflight$;

REVOKE ALL ON TABLE public.label_ar_decisions
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.label_ar_decisions TO authenticated;
COMMIT;

# Label DNA storage: unused foundation

**This is an unused, not-deployed storage unit.** The new SQLModel tables are not registered by API or database startup, no API or processing path writes them, and migration `009_label_dna_storage.sql` has not been executed. Existing demo intake remains unchanged.

## Before any rollout

- [ ] Confirm the production database's `label.id` and `submission.id` / `label_id` values match verified Supabase Auth user UUIDs.
- [ ] Confirm the actual application role, ownership, inherited privileges, table grants, and RLS behavior. Do not infer role ownership or `BYPASSRLS` from SQLite.
- [ ] Confirm default privileges for new tables. The migration fails closed if fresh-table ACLs grant unexpected roles; owner and inherited role privileges still need review.
- [ ] Apply migration 009 once, to an isolated Supabase-compatible PostgreSQL environment first. It requires `public.label`, `public.submission`, `auth.uid()`, and Supabase `anon` / `authenticated` roles.
- [ ] Run the migration through a client configured to stop on the first SQL error (for `psql`, `-v ON_ERROR_STOP=1`) and check its exit status. The file owns an explicit transaction; do not use an autocommit-per-statement runner.
- [ ] Complete the PostgreSQL checks below before any runtime wiring or production rollout.

## Storage contract

| Table | Purpose and boundary |
|---|---|
| `public.label_reference_tracks` | Label-owned reference metadata and explicit `uploaded`, `processing`, `ready`, or `failed` state. `storage_key` is metadata only; this schema does not delete, retain, or otherwise manage audio. |
| `public.music_embeddings` | Versioned 512D vectors for exactly one reference track or demo submission, with pipeline identity and either aggregate segment `-1` or a bounded numbered segment. |

Composite `(owner id, label_id)` foreign keys prevent an embedding from claiming a different label than its reference/demo. Hard owner deletion cascades to embeddings; soft deletion is not modeled. A unique owner/segment/full-identity index allows another provider, model, model version, or pipeline version to coexist.

The migration is intentionally **one-shot**, not rerunnable: it begins a transaction, refuses either pre-existing private table before changes, and creates fresh constraints, indexes, and owner policies. If either table exists, inspect migration history and state; do not retry by reusing or replacing it. Existing `public.submission` uniqueness is reused only when a valid, non-partial, non-expression unique index has exactly the ordered key `(id, label_id)` and is not backed by a deferrable constraint; otherwise the migration adds the named composite unique constraint unless that name conflicts. It never rewrites submissions or existing grants.

PostgreSQL uses the official pgvector `VECTOR(512)` adapter, imported lazily. If pgvector is unavailable, PostgreSQL type loading fails closed. SQLite uses JSON only in the explicit in-memory test fixture; that representation is not a PostgreSQL fallback. The migration qualifies the vector type with the installed extension's schema and does not move an existing extension.

RLS is enabled on both new tables with fresh authenticated owner policies using `auth.uid()::text = label_id`. Direct `PUBLIC`, `anon`, and `authenticated` table grants are revoked before only authenticated DML is granted. The migration rejects explicit default ACL grants to other roles. This does not establish effective privileges inherited through memberships, table-owner behavior, production role configuration, historical ID alignment, or Supabase Auth claim behavior.

## Verification evidence and limits

The focused SQLite tests use `StaticPool` and enable `PRAGMA foreign_keys=ON`. They exercise composite ownership on insert/update, database checks, cascades, identity uniqueness, and normalized vector binding. Migration-source tests are **structural assertions only**; they verify transaction/refusal/policy intent in text and do not prove PostgreSQL syntax, atomic rollback, ACL behavior, or RLS isolation. SQLite does **not** prove extension installation/schema resolution or pgvector driver binding.

**PostgreSQL/RLS evidence is pending.** The implementation environment has no `psql`, PostgreSQL server, or Docker, and the Python pgvector adapter is not installed. No migration was run and no remote database was contacted.

Before rollout, use a disposable Supabase-compatible PostgreSQL database and a non-owner application-equivalent role with no assumed `BYPASSRLS`:

1. Apply migration 009 once with stop-on-error enabled; verify the vector extension remains in its original schema and `music_embeddings.embedding` is `vector(512)`. Confirm a second attempt is rejected at the preflight and rolls back; do not treat repeat execution as supported idempotence.
2. In a separate disposable database, introduce a pre-existing private table and verify the migration fails before changing the extension or submission key. Also verify a wrong same-name submission key fails without replacing it, while an exact `(id, label_id)` unique index is accepted.
3. Inspect `pg_constraint`, `pg_indexes`, `pg_class.relrowsecurity`, `pg_policies`, and `information_schema.role_table_grants` for both new tables and the composite owner constraints. Confirm existing `label` / `submission` grants and rows were not changed.
4. With two distinct authenticated label UUID claims, prove own-row access and rejection of cross-label reads/writes; as `anon`, prove no table privileges. Verify policy behavior using the actual non-owner role and Supabase `auth.uid()` claim path, not a superuser or SQLite. Inspect role memberships, owner privileges, and effective/default grants for the configured application role.
5. Exercise valid reference and demo embeddings; wrong-label insert and update; hard-delete cascades; owner/segment duplicate rejection; version coexistence; invalid owner/dimension/status/segment checks; and a real pgvector bind/result round trip with finite normalized 512D input.

## Runtime boundary and rollback

No API, startup registration, background work, profile, score, or provider-specific inference is part of this unit. A future additive rollback may remove only this unused model/migration/dependency footprint and the new composite submission uniqueness if independently shown safe. It must never delete or rewrite existing submission records. Do not roll back by implicitly deleting audio or assuming a retention policy.

# Performance baseline — 20k dataset (WP-32)

Measured 2026-08-24 on the development scratch cluster (Postgres 17 and
the API on one host, no network hop — read these as *shape* numbers and
regressions guards, not production SLOs). Dataset: the synthetic `perf`
profile — **20,000 patients, 800 staff, 40 teams, 23,631 treatments,
254,441 care relationships**, plus 5,000 injected open alerts. Every
request goes through the real stack: session guard, Cedar, RLS,
same-transaction audit write.

Method: HTTP against the API, N requests per endpoint after warm-up,
p50/p95 wall time (session scratch `wp32-bench.mjs`).

## The finding, and the fix that ships with this baseline

The roster and the triage queue each ran a **per-row Cedar spot-check**:
after the care-scoped SQL, every returned row was re-authorized in a
loop. The resource is built identically per row — the decision depends
on role and membership, never the id — so the loop re-proved one
decision hundreds of times. For a busy lead (~600 patients in care) that
was ~0.5 s per roster call. The tripwire is now **sampled (first 25
rows)**, which preserves the fail-loud property exactly: any
policy/scoping disagreement is systemic and trips immediately.

| endpoint | before (p50) | after (p50) |
|---|---|---|
| C3 roster | 538 ms | **36 ms** |
| C1 triage queue | 167 ms | **42 ms** |

## Baseline (after the fix)

| endpoint | n | p50 | p95 | payload |
|---|---|---|---|---|
| C3 roster (care-scoped list) | 25 | 36 ms | 44 ms | 79 kB |
| PP profile (Cedar + audit + slice) | 25 | 7 ms | 9 ms | — |
| C1 triage queue (alerts join) | 25 | 42 ms | 44 ms | 72 kB |
| C4 message inbox (threads join) | 25 | 37 ms | 43 ms | 247 kB |
| C1 overdue worklist | 25 | 9 ms | 14 ms | — |
| C1 agenda worklist | 25 | 8 ms | 9 ms | — |
| A1 admin user list (20.8k accounts) | 10 | 86 ms | 101 ms | 3.4 MB |
| A3 audit view (200 rows + name maps) | 10 | 8 ms | 21 ms | 38 kB |
| PP5 export (full assembly + 2 audits) | 5 | 65 ms | 72 ms | — |

Authz decisions themselves are benchmarked separately in `@mio/authz`
(the 20k baseline test): sub-millisecond per decision, which the PP
profile's 7 ms round trip (two decisions + audit insert + reads)
corroborates end to end.

Notes for later work, none urgent at pilot scale:
- A1 returns all 20.8k accounts (3.4 MB); pagination is the obvious cut
  when a real deployment approaches this size.
- C4's 247 kB payload is preview text; trim if inbox p95 grows.
- Indexes were NOT added by this pass — every plan already uses the
  existing ones (`care_relationship_staff_idx` et al.).

## Restore rehearsal evidence (E7, same day, same dataset)

Logical dump + restore on the scratch cluster
(`wp32-restore.sh`; the production procedure is in
[runbooks.md](runbooks.md#restore-from-backup-e7--rehearsed-see-evidence-below)):

```
pg_dump  --format=custom  : 1.4 s, 14 MB
pg_restore into fresh db  : 3.0 s
row counts (patients 20000, staff 800, treatments 23631,
  care_relationships 254441, alerts 5000, access_events 405): ALL MATCH
RLS + grants survived: as mio_app with a lead's context,
  1,468 care-scoped treatments visible (their slice, nothing more)
append-only survived: DELETE on audit.access_event as mio_app
  -> "permission denied" (twice, by design)
```

The 20k dataset is small on disk (14 MB custom format) because the perf
profile is graph-only; production dumps grow with histories, but the
procedure and the validation checklist are what the rehearsal proves.

# Release checklist — pilot (M5)

The WP-33 gate: what must be TRUE before real patients touch the
system. Each line names its evidence. Engineering lines are done and
re-verifiable; register lines (R*) wait on their owners and BLOCK
release while open. This list is walked, checked and signed per release
— it is not a one-time document.

## Blocked on register owners (no release while open)

- [ ] **R1** MDR classification opinion received and folded in — if
      Class IIa, this checklist is superseded by the QMS release process.
- [ ] **R2** Finnish Class B registration (THL) filed; Swedish
      equivalent assessed.
- [ ] **R4** DPIA performed by the DPO (engineering input:
      [`dpia-support.md`](dpia-support.md)); controller/processor
      contracts signed per hospital.
- [ ] **R5** Statutory retention periods entered in
      `audit.retention_policy` (one row per class; NULL = still open).
- [ ] **R12** External penetration test performed against the threat
      model; findings closed or accepted with owners.
- [ ] **R7** Assistive-technology audit session done; accessibility
      statement published in-product in EN/FI/SV.
- [ ] Final terms of use and privacy notice content approved
      (`CURRENT_TERMS_VERSION` bumped; re-acceptance flow fires).
- [ ] **R11** only if QLQ-C30 ships: EORTC agreement signed, official
      FI/SV forms loaded read-only.

## Engineering — done, re-verify per release

- [x] `pnpm check` green: lint, format, typecheck, every test suite,
      dependency-cruiser boundaries. **Evidence:** CI on the release
      commit.
- [x] Capability matrix artifacts fresh (`generate:check` in CI);
      access-rule changes and matrix moved together in every PR.
- [x] Migrations forward-only and gated: deploy stops before traffic
      if a migration cannot apply. **Evidence:** `deploy.yml` migration
      gate.
- [x] Security headers + CSP live; SPA served same-origin; auth surface
      rate-limited. **Evidence:** `hardening.e2e.test.ts`, WP-30 browser
      check (zero CSP violations).
- [x] Attachment pipeline: quarantine → sniff → scan → promote; only
      clean bytes served, sandboxed. **Evidence:** `attachments.e2e`,
      worker scan test.
- [x] Audit: same-transaction access events on every patient-scoped
      read incl. refusals; append-only proven (owner included); daily
      export to versioned object storage with watermark. **Evidence:**
      db tests, `retention.test.ts`, restore rehearsal.
- [x] Patient rights live: access history, self-export with history and
      attachment metadata, per-kind email opt-outs, contentless email
      only. **Evidence:** `selfservice.e2e`, `retention.e2e`,
      `notifications.e2e`.
- [x] Deceased handling: care-side flag stops all outbound automation;
      record retained. **Evidence:** `retention.e2e`, sweep guards.
- [x] Admin plane identity-only; step-up on credential resets; A3
      X4-minimised. **Evidence:** `admin.e2e`.
- [x] Performance baseline at 20k patients recorded; hot paths under
      ~100 ms p95 on the baseline rig. **Evidence:**
      [`../ops/performance-baseline.md`](../ops/performance-baseline.md).
- [x] Restore rehearsed with evidence (E7); runbooks written; alerts
      declared (uptime, 5xx, p95). **Evidence:** `../ops/`.
- [x] Keyboard/ARIA contract verified (dialog focus management, deep
      passes on body map and recurrence editor). **Evidence:**
      [`../accessibility/keyboard-pass-2026-08.md`](../accessibility/keyboard-pass-2026-08.md).
- [x] SOUP inventory complete (18 runtime dependencies, each justified);
      `pnpm audit --prod` green in CI. **Evidence:**
      [`../security/soup-inventory.md`](../security/soup-inventory.md).
- [x] Synthetic data only in every non-production environment; no
      patient data in logs, fixtures or tests. **Evidence:** synthetic
      PII-discipline tests; log shapes reviewed in WP-30 threat model.

## Release mechanics (walk per release)

1. Tag the commit; CI green on the tag.
2. Staging deploy through the migration gate; smoke: sign-in both
   realms, one patient-scoped read (audit row lands), one alert
   acknowledged, attachment upload→scan→serve.
3. Backup taken and RESTORE VERIFIED on a scratch instance per the
   runbook (not just "backup exists").
4. Register walked: every R-line above still closed; new open items
   added with owners before, not after.
5. Sign-off recorded (who, when, commit) appended to this file's
   release log below.

## Release log

| date | commit | signed by | notes |
|---|---|---|---|
| — | — | — | no production release yet |

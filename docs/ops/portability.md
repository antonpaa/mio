# Portability spot-check — Azure (ADR-0010, WP-32)

D1 chose GCP with the owner's note that a swap to Azure remains
theoretically open. ADR-0010's claim is that the swap cost is confined
to seams. This document is the spot-check: where GCP actually appears,
what the Azure counterpart is, and what the honest effort estimate is.

## Where GCP appears in the codebase (verified by search, 2026-08-24)

```
apps/api/src/shared/config.ts        - reads MIO_GCS_* env (adapter selection)
apps/api/src/shared/storage.module.ts- selects fs vs GCS adapter
apps/worker/src/main.ts              - same selection for the worker
packages/storage/src/gcs.ts          - the GCS adapter itself
infra/**                             - Terraform, entirely provider-specific by design
.github/workflows/deploy.yml         - gcloud build/deploy pipeline
```

No domain module, no migration, no test and no web code references a
cloud API. Everything else speaks Postgres, SMTP and the two ports in
`@mio/storage`.

## The swap, seam by seam

| GCP | Azure counterpart | Work |
|---|---|---|
| Cloud Run (api, worker) | Container Apps | Same containers, same env vars; Terraform rewrite of the runtime module |
| Cloud SQL Postgres 17 + private VPC | Database for PostgreSQL Flexible Server + VNet | Connection string in a secret either way; migrations unchanged (plain SQL, forward-only) |
| Cloud Storage bucket | Blob Storage container | **One new adapter** implementing `ObjectStorage` (`put/get/delete`) against the Blob REST API with shared-key or SAS auth — the same shape as `gcs.ts` (~150 lines, hand-rolled, no SDK); versioning/immutability via Blob versioning + immutability policy |
| Secret Manager | Key Vault | Terraform + the deploy pipeline read step |
| Workload Identity Federation (deploys) | GitHub OIDC federation to Entra | Pipeline auth steps |
| Cloud Monitoring alerts (WP-32) | Azure Monitor alert rules | Terraform rewrite of the monitoring module, same three judgements |
| Artifact Registry | Container Registry (ACR) | Pipeline push targets |

## Estimate

- `packages/storage` Azure Blob adapter + tests: **days, not weeks** —
  the port is three methods and the GCS adapter is the template.
- `infra/` rewrite: the larger half; the modules are small and the
  boundaries (network / database / storage / runtime / monitoring) map
  one-to-one to Azure resources.
- Application code: **zero changes** outside the two composition points
  that select the storage adapter by env.

## Standing rule that keeps this true

Anything cloud-specific enters ONLY behind a port in `@mio/storage` or
inside `infra/`. A PR that imports a cloud SDK into an app or another
package is the moment this document stops being true - review for it.

# Mio infrastructure — GCP (WP-09)

Gate **D1** chose GCP (2026-08-24, recorded in
[ADR-0010](../docs/adr/0010-cloud-agnostic-container-platform.md)). The
swap to Azure remains possible, which is why everything here stays
inside the portable subset the ADR prescribes: containers on a managed
runtime, managed Postgres, object storage behind `@mio/storage`'s port,
secrets in a manager, OTel for telemetry. **The Terraform module
boundary is the swap seam** — an Azure port replaces the modules, not
the application.

## Layout

```
modules/network    VPC, subnet, private services access, serverless connector
modules/database   Cloud SQL Postgres 17 (private IP, PITR), mio database,
                   owner login, DATABASE_URL secret
modules/storage    attachment bucket - uniform access, public access
                   prevention enforced, optional CMEK
modules/runtime    Artifact Registry, per-service accounts, Cloud Run v2
                   api (public ingress) + worker (internal, exactly one
                   instance - it is a poller, not a request server)
envs/dev           composed environment
envs/staging       composed environment (min 1 API instance)
```

## One-time bootstrap (per project)

1. Create the state bucket:
   `gsutil mb -l europe-north1 gs://<project>-mio-tfstate`
2. Enable APIs: `run.googleapis.com`, `sqladmin.googleapis.com`,
   `servicenetworking.googleapis.com`, `vpcaccess.googleapis.com`,
   `secretmanager.googleapis.com`, `artifactregistry.googleapis.com`.
3. Create the OTP pepper secret (never in Terraform state):
   `printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create mio-<env>-otp-pepper --data-file=-`
4. Set up Workload Identity Federation for GitHub Actions and grant the
   deploy service account: Artifact Registry writer, Cloud Run admin,
   Cloud SQL client, secret accessor on the two secrets, and
   `iam.serviceAccountUser` on the runtime service accounts.

## Plan / apply

```bash
cd infra/envs/staging
terraform init -backend-config="bucket=<project>-mio-tfstate" -backend-config="prefix=staging"
cp terraform.tfvars.example terraform.tfvars   # edit
terraform plan
terraform apply
```

## Deploys

`.github/workflows/deploy.yml`: build both images → push to Artifact
Registry → **migration gate** (`pnpm migrate` through the Cloud SQL
Auth Proxy as `mio_owner`; a failed migration stops the deploy cold) →
roll the Cloud Run services to the new image. Staging deploys from
`main`; dev by manual dispatch. Seeding staging uses the WP-05
generator (`pnpm --filter @mio/synthetic seed`) — synthetic data only,
enforced by the seeder's own non-`.example`-account refusal (E8).

## Not here on purpose

- **Production** arrives with the compliance closure (WP-33) — same
  modules, a third env directory, plus CMEK and access approvals.
- **The separate attachment serving origin** (WP-24's note): topology
  for a later hardening pass — v1 serves through the API with
  hostile-content headers.
- **Portability spot-check** on the non-chosen cloud: WP-32's line item,
  scheduled once staging is live.

# 0010. Cloud-agnostic container platform

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

The hosting cloud — Azure or GCP — is deliberately undecided. It may be decided
by procurement, by a hospital customer's existing agreements, or by data
residency requirements that are not yet fixed. Architecture must not force the
decision, and must not make it expensive to make later.

Data residency itself is not optional: patient data stays in the EU.

## Decision

Package everything as **containers**, and depend only on the four managed
services both clouds provide equivalently:

| Need | Azure | GCP |
|---|---|---|
| Compute | Container Apps | Cloud Run |
| Database | Database for PostgreSQL Flexible Server | Cloud SQL for PostgreSQL |
| Object storage | Blob Storage | Cloud Storage |
| Secrets | Key Vault | Secret Manager |

Rules that keep the choice open:

- No cloud-proprietary runtime, queue, or data service. The job queue is in
  PostgreSQL (ADR-0008) partly for this reason.
- **Terraform** for infrastructure, split into cloud-agnostic application
  configuration and a thin cloud-specific layer.
- **OpenTelemetry** with OTLP export, so the observability backend is
  configuration rather than code.
- Encryption at rest uses customer-managed keys via the cloud's key service.
- Transactional email via an EU-hosted provider, contracted with a DPA and
  listed in the subprocessor register. Email never carries clinical content, so
  the exposure is contact data only — but that is still personal data.

No Kubernetes in v1. At this scale it is operational cost without benefit.

## Consequences

- Choosing Azure or GCP later is a Terraform module swap, not a re-architecture.
- Deployment is reproducible and identical across environments.
- We forgo genuinely useful managed services on both platforms, and accept
  slightly more work in the application in exchange for portability.
- Portability is a claim until it is exercised. It should be validated once, by
  standing up a throwaway environment on the non-chosen cloud, before the
  decision is final.
- The abstraction is not total: identity, networking and key management differ
  meaningfully between the two, and that thin layer is where the real porting
  work would sit.

## Alternatives considered

**Commit to one cloud now and use its full service catalogue.** Simpler and
cheaper to operate, and a legitimate choice — but it forecloses a decision that
external parties may end up making for us.

**Kubernetes (AKS/GKE Autopilot).** Maximum portability, disproportionate
operational cost for a system of this size and team.

**Self-hosted / on-premise in a hospital data centre.** Not a v1 requirement.
The container-based approach does not preclude it later.

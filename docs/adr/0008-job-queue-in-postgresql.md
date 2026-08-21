# 0008. Job queue in PostgreSQL

- **Date:** 2026-08-21
- **Status:** Accepted

## Context

Mio needs asynchronous work: notification emails, survey reminders, escalation
on non-response, recurrence materialisation, attachment virus scanning, GDPR
data exports, and audit archival.

The critical path is alerting. When a survey response raises an alert, the alert
record and the notification that tells a clinician about it must both happen.
With a queue outside the database this is a dual-write: the transaction commits
and the enqueue fails, or the reverse. Losing an alert notification is a patient
safety issue, not an operational annoyance.

## Decision

The job queue lives in **PostgreSQL**, consumed with
`SELECT … FOR UPDATE SKIP LOCKED`, using `pg-boss`.

Jobs are enqueued **in the same transaction as the state change that causes
them** — a transactional outbox with no extra machinery, because the queue and
the domain data share a database.

A single worker deployable (ADR-0002) consumes the queue. Scheduled and
recurring work is driven by the same mechanism.

## Consequences

- "Alert raised" and "clinician notified" are atomic. The dual-write problem is
  eliminated rather than mitigated.
- No broker to run, secure, monitor or pay for. One less stateful component and
  one less SOUP entry.
- Job state is queryable with SQL, which makes operational questions ("what is
  stuck, and why") answerable with the tools already in use.
- Queue load lands on the primary database. At the stated scale — thousands of
  jobs per day, not millions per hour — this is comfortably within budget, but
  it is a shared resource and long-running jobs must not hold transactions open.
- Throughput ceiling is far lower than a dedicated broker's. If Mio ever
  approaches it, that is the signal to reconsider, and the outbox pattern is
  already in place to migrate onto.

## Alternatives considered

**Azure Service Bus / Google Pub/Sub.** Rejected: reintroduces the dual-write
problem on the alert path, and binds to a cloud (ADR-0010).

**Redis-backed queue (BullMQ).** Rejected: another stateful service, and Redis
persistence semantics are a poor foundation for jobs that must not be lost.

**Kafka.** Rejected outright. Nothing about this system's scale or shape
justifies it.

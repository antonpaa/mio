# Messaging and attachments

Messaging is in-app only. Message content never leaves Mio by email — email
notifications say only that something is waiting.

Threads are per treatment programme and shared across the care team. A patient
enrolled in several treatments has several threads. There are no reply
templates and no drafts on the clinician side; absence coverage is handled
outside the system, per the brief.

**Internal notes are a distinct entity**, not a visibility flag on a message.
This is deliberate: a flag is one serialisation mistake away from disclosure,
and disclosing a care team's internal note to a cancer patient is the worst
single failure this system could produce. Separate entity, separate table,
separate endpoint, and a dedicated invariant in the capability matrix.

## Rich text

Messages are stored as a **structured document** — ProseMirror/TipTap JSON —
never as HTML from an editor.

Supported: bold, italics, bulleted and numbered lists, automatic hyperlinking,
pasted or attached images.

Storing editor HTML means storing markup a user controls, which makes every
future render a potential stored cross-site-scripting vector. A structured
document is parsed against a schema on the way in; anything not in the schema
does not survive. Rendering is a controlled transformation, and sanitisation on
output is the second layer rather than the only one.

Pasted images upload to object storage and become references in the document.
Images are never stored inline as data URIs.

## Attachment pipeline

```
  upload
    │
    ▼
  quarantine bucket ─── not reachable by any read path
    │
    ▼
  worker: sniff content type, enforce size, virus scan (ClamAV)
    │
    ├── fail ──► rejected, uploader notified, event audited
    │
    ▼
  promote to attachment store
    │
    ▼
  available for download
```

- **Content type is determined by sniffing, never by file extension or by the
  client-supplied `Content-Type`.** Both are attacker-controlled.
- Allowlist of permitted types, not a blocklist of forbidden ones.
- Size limits enforced at the edge and again in the worker.
- Nothing is readable until it has been scanned and promoted.

## Serving

User-uploaded content is served from a **separate origin** from the application.

Same-origin user content means an uploaded file that a browser decides to render
executes in Mio's origin, with access to Mio's session. A separate origin
contains that entirely.

Additionally:

- `Content-Disposition: attachment`, always.
- Strict `Content-Security-Policy` on the application origin.
- Downloads are authorized per request through Cedar and audited
  (`attachment.download`, `audit: always`).
- Signed URLs are short-lived and issued only after an authorization decision —
  never handed out at list time.

## Notification boundary

The notification payload type is:

```ts
{ recipient, notificationType, deepLink }
```

and nothing else. The email templating layer has no type-level access to
clinical fields, so "the email contained clinical content" is a compile error
rather than something a reviewer must catch.

This applies to every email Mio sends: new message, survey due, survey overdue,
welcome, password reset. Each says that something is waiting, and links to Mio.

## Storage

Attachment bytes live in object storage with customer-managed encryption keys
([ADR-0010](../adr/0010-cloud-agnostic-container-platform.md)). Metadata —
filename, type, size, uploader, thread — lives in `clinical.attachment`.

Filenames are treated as untrusted user content: displayed escaped, never used
to construct a storage path.

Attachments are retained with their treatment and follow the same retention
classification ([`data-model.md`](data-model.md)).

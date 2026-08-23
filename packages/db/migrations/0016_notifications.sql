-- 0016 Notifications (WP-25): the in-app centre rows, per recipient.
-- The IN-APP layer is the content-bearing layer; EMAIL stays contentless
-- (docs/architecture/messaging-and-attachments.md). Rows are written
-- only by the system dispatch - it consumes the notification outbox and
-- the rule notifications and fans out one row per recipient. Nobody but
-- the recipient can read a row: the decision subject IS the recipient.

CREATE TABLE clinical.notification (
  id              uuid PRIMARY KEY,
  recipient_id    uuid NOT NULL,
  recipient_realm text NOT NULL CHECK (recipient_realm IN ('patient', 'staff')),
  kind            text NOT NULL,
  patient_id      uuid NOT NULL,
  treatment_id    uuid REFERENCES clinical.treatment (id),
  -- references for the deep link (threadId, alertId, triggerId, ...)
  ref             jsonb NOT NULL DEFAULT '{}',
  -- rule-authored localized text for kind 'rule.notify'; other kinds
  -- render from their references
  body            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX notification_recipient_idx
  ON clinical.notification (recipient_id, created_at DESC);
CREATE INDEX notification_unread_idx
  ON clinical.notification (recipient_id) WHERE read_at IS NULL;
REVOKE DELETE ON clinical.notification FROM mio_app, mio_worker;

ALTER TABLE clinical.notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON clinical.notification FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient'
        AND recipient_realm = 'patient' AND recipient_id = app.current_user_id())
    OR (app.current_realm() = 'staff'
        AND recipient_realm = 'staff' AND recipient_id = app.current_user_id())
  );
CREATE POLICY notification_write ON clinical.notification FOR INSERT
  WITH CHECK (app.current_realm() = 'system');
-- the recipient may move their own read marker; nothing else changes
CREATE POLICY notification_mark ON clinical.notification FOR UPDATE
  USING (
    (app.current_realm() = 'patient'
      AND recipient_realm = 'patient' AND recipient_id = app.current_user_id())
    OR (app.current_realm() = 'staff'
      AND recipient_realm = 'staff' AND recipient_id = app.current_user_id())
  )
  WITH CHECK (
    (app.current_realm() = 'patient'
      AND recipient_realm = 'patient' AND recipient_id = app.current_user_id())
    OR (app.current_realm() = 'staff'
      AND recipient_realm = 'staff' AND recipient_id = app.current_user_id())
  );

-- P8: per-type EMAIL toggles, all on by default - absent key = on,
-- {"message.new": false} switches that type off. In-app delivery is not
-- optional; only the email nudge is.
ALTER TABLE identity.patient_account
  ADD COLUMN email_prefs jsonb NOT NULL DEFAULT '{}';

-- The dispatch marks rule notifications it has fanned out. The table
-- stays append-only for content - the worker may touch ONLY this column.
ALTER TABLE clinical.rule_notification ADD COLUMN dispatched_at timestamptz;
GRANT UPDATE (dispatched_at) ON clinical.rule_notification TO mio_worker;
CREATE POLICY rule_notification_dispatch ON clinical.rule_notification FOR UPDATE
  USING (app.current_realm() = 'system')
  WITH CHECK (app.current_realm() = 'system');
CREATE INDEX rule_notification_pending_idx
  ON clinical.rule_notification (created_at) WHERE dispatched_at IS NULL;

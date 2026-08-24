-- 0017 Attachments (WP-24): quarantine -> sniff -> scan -> promote.
-- Bytes live in object storage under an opaque key; this table is the
-- authority on WHAT the bytes are (sniffed, never declared), WHO put
-- them there, and WHETHER they may be served. Nothing is served until
-- the scanner promotes it to clean, and nobody deletes - retention is
-- WP-29's to decide.

CREATE TABLE clinical.attachment (
  id             uuid PRIMARY KEY,
  patient_id     uuid NOT NULL,
  treatment_id   uuid NOT NULL REFERENCES clinical.treatment (id),
  -- set when a sent message references it; a note never carries one
  message_id     uuid REFERENCES clinical.message (id),
  filename       text NOT NULL,
  declared_mime  text NOT NULL,
  sniffed_mime   text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  state          text NOT NULL DEFAULT 'quarantined'
                 CHECK (state IN ('quarantined', 'clean', 'rejected')),
  storage_key    text NOT NULL UNIQUE,
  uploaded_by    uuid NOT NULL,
  uploaded_realm text NOT NULL CHECK (uploaded_realm IN ('patient', 'staff')),
  scan_detail    text,
  scanned_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachment_message_idx ON clinical.attachment (message_id)
  WHERE message_id IS NOT NULL;
CREATE INDEX attachment_pending_idx ON clinical.attachment (created_at)
  WHERE state = 'quarantined';
REVOKE DELETE ON clinical.attachment FROM mio_app, mio_worker;

ALTER TABLE clinical.attachment ENABLE ROW LEVEL SECURITY;

-- Readers: the uploader always sees their own rows (they need the scan
-- state); a patient additionally sees CLEAN rows attached to messages
-- in their threads - never note-side or unattached strangers; staff see
-- clean rows for care patients. System sees all.
CREATE POLICY attachment_read ON clinical.attachment FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND uploaded_by = app.current_user_id())
    OR (app.current_realm() = 'patient'
        AND patient_id = app.current_user_id()
        AND state = 'clean'
        AND message_id IS NOT NULL)
    OR (app.current_realm() = 'staff' AND uploaded_by = app.current_user_id())
    OR (app.current_realm() = 'staff' AND state = 'clean' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.attachment.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );

CREATE POLICY attachment_write ON clinical.attachment FOR INSERT
  WITH CHECK (
    (app.current_realm() = 'patient'
      AND patient_id = app.current_user_id()
      AND uploaded_by = app.current_user_id())
    OR (app.current_realm() = 'staff'
      AND uploaded_by = app.current_user_id()
      AND EXISTS (
        SELECT 1 FROM clinical.care_relationship cr
         WHERE cr.patient_id = clinical.attachment.patient_id
           AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
      ))
  );

-- The uploader links their own attachment to the message being sent;
-- the system writes scan outcomes. Nothing else changes rows.
CREATE POLICY attachment_link ON clinical.attachment FOR UPDATE
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() IN ('patient', 'staff')
        AND uploaded_by = app.current_user_id())
  )
  WITH CHECK (
    app.current_realm() = 'system'
    OR (app.current_realm() IN ('patient', 'staff')
        AND uploaded_by = app.current_user_id())
  );

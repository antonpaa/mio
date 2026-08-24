-- 0015 Messaging (WP-23): one thread per treatment programme, shared
-- across the care team (docs/architecture/messaging-and-attachments.md).
-- Messages are append-only structured documents - never HTML from an
-- editor. Internal notes are a SEPARATE ENTITY, not a visibility flag,
-- and the patient realm has NO POLICY on their table at all: even a
-- serialisation mistake in the app cannot disclose one, because the row
-- never leaves Postgres under a patient session.

CREATE TABLE clinical.message_thread (
  id           uuid PRIMARY KEY,
  treatment_id uuid NOT NULL UNIQUE REFERENCES clinical.treatment (id),
  patient_id   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_thread_patient_idx ON clinical.message_thread (patient_id);

CREATE TABLE clinical.message (
  id           uuid PRIMARY KEY,
  thread_id    uuid NOT NULL REFERENCES clinical.message_thread (id),
  patient_id   uuid NOT NULL,
  author_id    uuid NOT NULL,
  author_realm text NOT NULL CHECK (author_realm IN ('patient', 'staff')),
  body         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_thread_idx ON clinical.message (thread_id, created_at);
REVOKE UPDATE, DELETE ON clinical.message FROM mio_app, mio_worker;

CREATE TABLE clinical.internal_note (
  id         uuid PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES clinical.message_thread (id),
  patient_id uuid NOT NULL,
  author_id  uuid NOT NULL,
  body       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX internal_note_thread_idx ON clinical.internal_note (thread_id, created_at);
REVOKE UPDATE, DELETE ON clinical.internal_note FROM mio_app, mio_worker;

-- Read watermarks per user for unread counts. The one messaging table
-- that updates in place - it records attention, not content.
CREATE TABLE clinical.thread_read (
  thread_id    uuid NOT NULL REFERENCES clinical.message_thread (id),
  user_id      uuid NOT NULL,
  patient_id   uuid NOT NULL,
  last_read_at timestamptz NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

ALTER TABLE clinical.message_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical.message        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical.internal_note  ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical.thread_read    ENABLE ROW LEVEL SECURITY;

-- Threads: the patient sees their own, staff see care patients',
-- system may read for notification dispatch (WP-25). Created lazily by
-- whichever side posts first, inside the same scope.
CREATE POLICY message_thread_read ON clinical.message_thread FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.message_thread.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY message_thread_write ON clinical.message_thread FOR INSERT
  WITH CHECK (
    (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.message_thread.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );

CREATE POLICY message_read ON clinical.message FOR SELECT
  USING (
    app.current_realm() = 'system'
    OR (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
    OR (app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.message.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    ))
  );
CREATE POLICY message_write ON clinical.message FOR INSERT
  WITH CHECK (
    (app.current_realm() = 'patient'
      AND patient_id = app.current_user_id() AND author_id = app.current_user_id()
      AND author_realm = 'patient')
    OR (app.current_realm() = 'staff'
      AND author_id = app.current_user_id() AND author_realm = 'staff'
      AND EXISTS (
        SELECT 1 FROM clinical.care_relationship cr
         WHERE cr.patient_id = clinical.message.patient_id
           AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
      ))
  );

-- Internal notes: staff-only by construction - the invariant
-- internal_notes_never_patient from the capability matrix, enforced in
-- depth. There is deliberately no patient clause to get wrong.
CREATE POLICY internal_note_read ON clinical.internal_note FOR SELECT
  USING (
    app.current_realm() = 'staff' AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.internal_note.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );
CREATE POLICY internal_note_write ON clinical.internal_note FOR INSERT
  WITH CHECK (
    app.current_realm() = 'staff' AND author_id = app.current_user_id() AND EXISTS (
      SELECT 1 FROM clinical.care_relationship cr
       WHERE cr.patient_id = clinical.internal_note.patient_id
         AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
    )
  );

-- Watermarks: each user touches only their own row, within their scope.
CREATE POLICY thread_read_own ON clinical.thread_read FOR SELECT
  USING (
    user_id = app.current_user_id()
    AND (
      (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
      OR app.current_realm() = 'staff'
    )
  );
CREATE POLICY thread_read_insert ON clinical.thread_read FOR INSERT
  WITH CHECK (
    user_id = app.current_user_id()
    AND (
      (app.current_realm() = 'patient' AND patient_id = app.current_user_id())
      OR (app.current_realm() = 'staff' AND EXISTS (
        SELECT 1 FROM clinical.care_relationship cr
         WHERE cr.patient_id = clinical.thread_read.patient_id
           AND cr.staff_id = app.current_user_id() AND cr.ended_at IS NULL
      ))
    )
  );
CREATE POLICY thread_read_update ON clinical.thread_read FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

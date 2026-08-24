-- P2 (decided 2026-08-24): the dedicated auditor role. Oversight of the
-- full audit log moves off the administrator plane onto a role that
-- exists for exactly that - full identities included, because audit
-- metadata reveals which patients have treatments and the reader of
-- that fact should be the one whose job it is. The role is another
-- staff account value; database-level access still flows through the
-- mio_audit_reader carrier the API already uses.
ALTER TABLE identity.staff_account DROP CONSTRAINT staff_account_role_check;
ALTER TABLE identity.staff_account ADD CONSTRAINT staff_account_role_check
  CHECK (role IN ('treatment_member', 'treatment_lead', 'administrator', 'auditor'));

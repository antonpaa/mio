-- 0014 Program rules (WP-22): the override layer on a survey attachment
-- (docs/architecture/surveys-and-alerts.md). Template rules are defaults;
-- these per-treatment overrides tighten thresholds, swap option targets,
-- re-time trend windows, disable rules or replace the critical body-map
-- set. The EFFECTIVE rule set every evaluation runs against is
-- template + overrides, resolved in the shared package.
ALTER TABLE clinical.treatment_survey
  ADD COLUMN rule_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

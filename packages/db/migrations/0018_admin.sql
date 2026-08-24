-- WP-28: the administration plane needs to remove team members. Team
-- membership is an association row, not a record with retention needs -
-- deleting it is precisely what revokes care-team access everywhere the
-- RLS policies join it. A soft-delete column would instead demand a
-- filter in every one of those policies, and a single missed filter is
-- a standing access hole. The grant stays exactly this narrow: no other
-- identity table gains DELETE, and the change event records the removal.
GRANT DELETE ON identity.team_membership TO mio_app;

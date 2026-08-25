// Mio authorization policies (ADR-0006).
//
// HAND-WRITTEN and reviewed: these encode what each SCOPE of the capability
// matrix means as a condition over the entity slice. Which actions carry
// which (role, scope) pair is generated INTO THE SCHEMA as action-group
// membership (see cedar.ts) - so this file stays stable while the matrix
// evolves, and the exhaustive test suite proves the two agree on all grants.
//
// The file is the FULL roles x scopes grid, in exactly the ROLES x SCOPES
// order engine.ts's POLICY_ORDER assumes - Cedar names policies
// positionally, and validatePolicies() excuses the groups the matrix
// leaves empty (EMPTY_GROUPS) by that position. A principal holding
// several roles is a member of several role groups; the union of their
// permits is the decision.
//
// Default deny: a (role, action) pair matched by no group here is denied.

// --- patient ---------------------------------------------------------------
// self: the principal is the subject of the resource
permit (
  principal in Mio::Role::"patient",
  action in Mio::Action::"grp:patient:self",
  resource
) when { resource has subjectUser && resource.subjectUser == principal };

// own: the resource is assigned to / created by the principal
permit (
  principal in Mio::Role::"patient",
  action in Mio::Action::"grp:patient:own",
  resource
) when { resource has ownerUser && resource.ownerUser == principal };

// care_relationship: an active care relationship exists (materialised team-x-enrolment)
permit (
  principal in Mio::Role::"patient",
  action in Mio::Action::"grp:patient:care_relationship",
  resource
) when { resource has careTeam && resource.careTeam.contains(principal) };

// team_member: the principal is on the treatment's care team
permit (
  principal in Mio::Role::"patient",
  action in Mio::Action::"grp:patient:team_member",
  resource
) when { resource has team && resource.team.contains(principal) };

// team_lead: the principal is a lead of the treatment's care team
permit (
  principal in Mio::Role::"patient",
  action in Mio::Action::"grp:patient:team_lead",
  resource
) when { resource has leads && resource.leads.contains(principal) };

// any: permitted unconditionally within the role (never for patient-scoped clinical data)
permit (
  principal in Mio::Role::"patient",
  action in Mio::Action::"grp:patient:any",
  resource
);

// --- clinician -------------------------------------------------------------
// self: the principal is the subject of the resource
permit (
  principal in Mio::Role::"clinician",
  action in Mio::Action::"grp:clinician:self",
  resource
) when { resource has subjectUser && resource.subjectUser == principal };

// own: the resource is assigned to / created by the principal
permit (
  principal in Mio::Role::"clinician",
  action in Mio::Action::"grp:clinician:own",
  resource
) when { resource has ownerUser && resource.ownerUser == principal };

// care_relationship: an active care relationship exists (materialised team-x-enrolment)
permit (
  principal in Mio::Role::"clinician",
  action in Mio::Action::"grp:clinician:care_relationship",
  resource
) when { resource has careTeam && resource.careTeam.contains(principal) };

// team_member: the principal is on the treatment's care team
permit (
  principal in Mio::Role::"clinician",
  action in Mio::Action::"grp:clinician:team_member",
  resource
) when { resource has team && resource.team.contains(principal) };

// team_lead: the principal is a lead of the treatment's care team
permit (
  principal in Mio::Role::"clinician",
  action in Mio::Action::"grp:clinician:team_lead",
  resource
) when { resource has leads && resource.leads.contains(principal) };

// any: permitted unconditionally within the role (never for patient-scoped clinical data)
permit (
  principal in Mio::Role::"clinician",
  action in Mio::Action::"grp:clinician:any",
  resource
);

// --- author ----------------------------------------------------------------
// self: the principal is the subject of the resource
permit (
  principal in Mio::Role::"author",
  action in Mio::Action::"grp:author:self",
  resource
) when { resource has subjectUser && resource.subjectUser == principal };

// own: the resource is assigned to / created by the principal
permit (
  principal in Mio::Role::"author",
  action in Mio::Action::"grp:author:own",
  resource
) when { resource has ownerUser && resource.ownerUser == principal };

// care_relationship: an active care relationship exists (materialised team-x-enrolment)
permit (
  principal in Mio::Role::"author",
  action in Mio::Action::"grp:author:care_relationship",
  resource
) when { resource has careTeam && resource.careTeam.contains(principal) };

// team_member: the principal is on the treatment's care team
permit (
  principal in Mio::Role::"author",
  action in Mio::Action::"grp:author:team_member",
  resource
) when { resource has team && resource.team.contains(principal) };

// team_lead: the principal is a lead of the treatment's care team
permit (
  principal in Mio::Role::"author",
  action in Mio::Action::"grp:author:team_lead",
  resource
) when { resource has leads && resource.leads.contains(principal) };

// any: permitted unconditionally within the role (never for patient-scoped clinical data)
permit (
  principal in Mio::Role::"author",
  action in Mio::Action::"grp:author:any",
  resource
);

// --- administrator ---------------------------------------------------------
// self: the principal is the subject of the resource
permit (
  principal in Mio::Role::"administrator",
  action in Mio::Action::"grp:administrator:self",
  resource
) when { resource has subjectUser && resource.subjectUser == principal };

// own: the resource is assigned to / created by the principal
permit (
  principal in Mio::Role::"administrator",
  action in Mio::Action::"grp:administrator:own",
  resource
) when { resource has ownerUser && resource.ownerUser == principal };

// care_relationship: an active care relationship exists (materialised team-x-enrolment)
permit (
  principal in Mio::Role::"administrator",
  action in Mio::Action::"grp:administrator:care_relationship",
  resource
) when { resource has careTeam && resource.careTeam.contains(principal) };

// team_member: the principal is on the treatment's care team
permit (
  principal in Mio::Role::"administrator",
  action in Mio::Action::"grp:administrator:team_member",
  resource
) when { resource has team && resource.team.contains(principal) };

// team_lead: the principal is a lead of the treatment's care team
permit (
  principal in Mio::Role::"administrator",
  action in Mio::Action::"grp:administrator:team_lead",
  resource
) when { resource has leads && resource.leads.contains(principal) };

// any: permitted unconditionally within the role (never for patient-scoped clinical data)
permit (
  principal in Mio::Role::"administrator",
  action in Mio::Action::"grp:administrator:any",
  resource
);

// --- auditor ---------------------------------------------------------------
// self: the principal is the subject of the resource
permit (
  principal in Mio::Role::"auditor",
  action in Mio::Action::"grp:auditor:self",
  resource
) when { resource has subjectUser && resource.subjectUser == principal };

// own: the resource is assigned to / created by the principal
permit (
  principal in Mio::Role::"auditor",
  action in Mio::Action::"grp:auditor:own",
  resource
) when { resource has ownerUser && resource.ownerUser == principal };

// care_relationship: an active care relationship exists (materialised team-x-enrolment)
permit (
  principal in Mio::Role::"auditor",
  action in Mio::Action::"grp:auditor:care_relationship",
  resource
) when { resource has careTeam && resource.careTeam.contains(principal) };

// team_member: the principal is on the treatment's care team
permit (
  principal in Mio::Role::"auditor",
  action in Mio::Action::"grp:auditor:team_member",
  resource
) when { resource has team && resource.team.contains(principal) };

// team_lead: the principal is a lead of the treatment's care team
permit (
  principal in Mio::Role::"auditor",
  action in Mio::Action::"grp:auditor:team_lead",
  resource
) when { resource has leads && resource.leads.contains(principal) };

// any: permitted unconditionally within the role (never for patient-scoped clinical data)
permit (
  principal in Mio::Role::"auditor",
  action in Mio::Action::"grp:auditor:any",
  resource
);

#!/usr/bin/env python3
"""Validate capability-matrix.yaml against the invariants it declares.

Run:  python3 docs/authz/validate_matrix.py

This exists so the invariants in the matrix are executable from day one rather
than aspirational. It is deliberately dependency-light and standalone: there is
no application codebase yet. When the API exists, this logic moves into the
generator that produces the Cedar policy test suite (ADR-0006) and this script
goes away.
"""
import sys, pathlib, yaml

MATRIX = pathlib.Path(__file__).parent / "capability-matrix.yaml"

# Scope strength, used only to check that treatment_lead is never narrower than
# treatment_member. Not a general ordering of privilege.
STRENGTH = {"deny": 0, "self": 1, "own": 1,
            "care_relationship": 2, "team_member": 2, "team_lead": 3, "any": 4}

READ_ACTIONS = {"view", "download", "view_trend"}


def main() -> int:
    doc = yaml.safe_load(MATRIX.read_text())
    roles = [r["id"] for r in doc["roles"]]
    resources = doc["resources"]
    failures = {}

    def record(name, items):
        if items:
            failures[name] = items

    record("exhaustive", [
        f"{r['id']}.{a['id']} :: {role}"
        for r in resources for a in r["actions"]
        for role in roles if role not in a["grants"]
    ])

    record("superset_lead_member", [
        f"{r['id']}.{a['id']}: member={a['grants']['treatment_member']} "
        f"lead={a['grants']['treatment_lead']}"
        for r in resources for a in r["actions"]
        if STRENGTH[a["grants"]["treatment_lead"]]
        < STRENGTH[a["grants"]["treatment_member"]]
    ])

    record("administrator_no_clinical", [
        f"{r['id']}.{a['id']} = {a['grants']['administrator']}"
        for r in resources if r["schema"] == "clinical"
        for a in r["actions"] if a["grants"]["administrator"] != "deny"
    ])

    record("patient_self_only", [
        f"{r['id']}.{a['id']} = {a['grants']['patient']}"
        for r in resources for a in r["actions"]
        if a["grants"]["patient"] not in ("deny", "self")
    ])

    record("internal_notes_never_patient", [
        a["id"] for r in resources if r["id"] == "internal_note"
        for a in r["actions"] if a["grants"]["patient"] != "deny"
    ])

    record("patient_scoped_reads_are_audited", [
        f"{r['id']}.{a['id']}"
        for r in resources if r.get("patient_scoped")
        for a in r["actions"]
        if a["id"] in READ_ACTIONS and a["audit"] != "always"
    ])

    declared = {i["id"] for i in doc["invariants"]}
    checked = {"exhaustive", "superset_lead_member", "administrator_no_clinical",
               "patient_self_only", "internal_notes_never_patient",
               "patient_scoped_reads_are_audited"}
    if declared != checked:
        failures["invariant_coverage"] = [
            f"declared but unchecked: {sorted(declared - checked)}",
            f"checked but undeclared: {sorted(checked - declared)}",
        ]

    if failures:
        for name, items in failures.items():
            print(f"\nVIOLATION: {name} ({len(items)})", file=sys.stderr)
            for item in items:
                print(f"   - {item}", file=sys.stderr)
        return 1

    grants = len(roles) * sum(len(r["actions"]) for r in resources)
    print(f"OK - {len(declared)} invariants hold across {grants} "
          f"role x action grants "
          f"({len(roles)} roles, {len(resources)} resources)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

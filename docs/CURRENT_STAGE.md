# Forever Current Stage

Status: Canonical active-stage document
Last updated: 2026-07-17

## Stage name

RC5.5 Coralina safe execution, post-RC5.5D canonical-application closure and preparation for one supervised first Coralina import.

## Current milestone

RC5.5D is completed, reviewed, integrated, canonically applied, and verified. Migration `20260715120000` is recorded exactly once in the canonical migration history; the history contains 12 rows in total.

Canonical verification passed for the complete RC5.5D boundary:

- 2 RC5.5D roles;
- 2 schemas;
- 2 boundary tables;
- 6 routines;
- 10 dedicated policies;
- ownership, grants, role attributes, and exact policy definitions; and
- effective `postgres` membership in `forever_import_execution_owner`, with `MEMBER=true`, `USAGE=true`, and `SET=true`.

The apparent membership-verifier failure was a temporary untracked verifier defect: PostgreSQL 17 legitimately retained two distinguishable owner-to-postgres membership rows. No migration retry, repair, `GRANT`, or `REVOKE` is required. The manual logical backup was completed and verified before canonical application.

## Current authorization and safety state

RC5.5D closure does not authorize an import. Current state remains:

- live capability is disabled;
- no executor credential has been provisioned for live use;
- no real approval has been issued;
- Coralina has not been imported;
- RC5.5E has not started;
- production and staging execution remain blocked; and
- Factory autonomy remains A0 - Propose only.

Approval issuance remains a separate Owner checkpoint. Actual live execution is another separate Owner checkpoint and is not implied by approval issuance.

## Active tasks

| Task | Owner | Status |
| --- | --- | --- |
| RC5.5D implementation, review, integration, canonical application, and verification | Owner / Architect | Completed |
| Fresh read-only Coralina collision inspection against the canonical target | Owner | Next checkpoint - not started |
| Prepare the exact short-lived approval payload from the fresh inspection | Owner / Architect | Next checkpoint - not issued |
| Issue a real approval | Owner | Pending separate authorization |
| Provision isolated executor credentials for live use | Owner | Pending separate authorization |
| Enable and perform one supervised first Coralina import | Owner | Pending separate authorization |
| Staging rehearsal | Owner | Later checkpoint |
| RC5.5E | Owner / Architect | Later checkpoint - not started |

## Next checkpoint

Prepare for one supervised first Coralina import by beginning with a fresh read-only collision inspection of the canonical target, then prepare the exact approval payload from that fresh evidence. This preparation does not issue an approval, provision a credential, enable live capability, or execute the import.

After preparation, the Owner must authorize each consequential step separately:

1. issuance of the real short-lived approval;
2. isolated executor credential provisioning and actual live execution of the one supervised import.

A staging rehearsal and RC5.5E remain later checkpoints.

## Acceptance criteria for the next checkpoint

- The collision inspection is fresh, read-only, complete, and bound to the current plan and target identity.
- Coralina remains absent or any changed target state is classified explicitly; no partial result is treated as approval-ready.
- The approval payload is prepared from the fresh inspection and exact approved request, but is not issued.
- No credential is provisioned and live capability remains disabled.
- No database mutation, Coralina import, staging rehearsal, or RC5.5E work occurs without its separate Owner authorization.
- Factory autonomy remains A0.

## Out of scope

- Issuing a real approval under the preparation checkpoint.
- Provisioning executor credentials under the preparation checkpoint.
- Enabling live capability or performing the supervised import without separate Owner authorization.
- Staging rehearsal, production execution, RC5.5E, update/upsert behavior, automatic retries, or disaster-recovery automation.

## Definition of done

The next preparation checkpoint is complete when a fresh read-only collision report and an exact approval payload are ready for Owner review, while approval issuance, credential provisioning, live execution, staging rehearsal, and RC5.5E remain unperformed and separately gated.

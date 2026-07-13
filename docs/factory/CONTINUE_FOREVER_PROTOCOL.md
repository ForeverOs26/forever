# Continue Forever Protocol

Status: Ratified A0 protocol
Current autonomy: A0 — Propose only

The commands **Continue Forever** and **Продолжай Forever** invoke the same protocol. They do not grant new authority or silently approve execution.

## A0 sequence

1. Reconcile Git and Ledger state: read the Factory Index, current stage/status, Task Packet, and relevant routing and gate sections; fetch authorized repository state where permitted; and inspect active branches, PRs, run reports, and parked work. Read the complete Factory Constitution when required by the Factory Index full-reading policy.
2. Inspect `docs/factory/OWNER_QUEUE.md`.
3. Identify the single highest-priority action already authorized by the current stage, roadmap, decision, or explicit Owner instruction.
4. Produce exactly one proposed Task Packet, or exactly one Owner request when progress depends on Owner-only action.
5. Show the exact **Derives From** authority.
6. Classify risk, ambiguity, evidence sensitivity, and gate blindness.
7. Propose an author tier and an independent reviewer where required.
8. Wait for the Owner to approve the packet.
9. Execute only after approval and only within the approved packet, branch, paths, budget, and gates.
10. Return one concise final report and stop.

At A0 this protocol is proposal-first, not fully autonomous. The true one-command execution experience begins at A1, after promotion criteria are earned and recorded. A0 never originates unattended work, invokes models automatically, runs at night, controls a browser, or merges automatically.

## Non-invention and stops

The protocol never invents product priority, evidence, facts, authority, acceptance criteria, or a missing business decision. It parks or creates one Owner request when required information is absent.

Stop for any business, evidence, legal, financial, production, constitutional, security, credential, external-publication, client-communication, paid-service, or scope-escalation decision. Also stop for conflicts, unavailable required gates, unauthorized paths, or R2/R3 merge authority.

Only unavailable gates already declared required and active are gate failures. Unimplemented or inactive gates are labelled `PLANNED`, never passed. Until approved repository CI workflows are active, bootstrap uses local Operator validation, manual diff review, and Owner merge authorization.

## Standard final report

```text
Result: <completed | parked | owner action required>
Task Packet: <ID and path, or none>
Derives From: <exact authority>
Risk / ambiguity: <classification>
Artifacts: <branch, commit, PR, reports>
Gates: <pass/fail/not available>
Ledger updates: <paths>
Decision required: <none or exact Owner decision>
Next action: <one recommendation>
```

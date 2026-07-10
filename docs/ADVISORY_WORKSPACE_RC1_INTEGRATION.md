# Forever Advisory Workspace RC1 — Integration Guide

> Isolated delivery package. Not yet wired into the Forever repository.
> This document tells Codex exactly how to integrate it and what to verify.

---

## 1. Module purpose

The Advisory Workspace is the **advisor-facing** preparation surface for a
consultation. Its single job: let an advisor understand a client, the best
project matches, private strategy, key risks, and the next action **in under
60 seconds**.

It is **not** the buyer experience, **not** a CRM, and **not** a decision
engine. It is a controlled, presentational React module driven entirely by
props and deterministic mock data.

Scope boundaries honoured in RC1:

- No backend, API calls, `fetch`, AI, Supabase, migrations, CRM, or routing.
- Navigator is untouched.
- No new brand accents — only the frozen Forever palette.

---

## 2. Component structure

```
src/features/advisory/
  index.ts                     # public API (import from here)
  types.ts                     # all public types
  mock.ts                      # ADVISORY_ACTIONS + DEMO_SESSION (demo data)
  AdvisoryWorkspace.tsx        # root, composes the five sections
  components/
    index.ts                   # sub-component barrel
    ClientSnapshot.tsx         # section 1
    RecommendedProjects.tsx    # section 2 (exactly three matches)
    AdvisorStrategy.tsx        # section 3 (private, advisor-only)
    RiskPanel.tsx              # section 4 (max three risks)
    NextAction.tsx             # section 5 (five actions, emits callback)
  tests/
    AdvisoryWorkspace.test.tsx # Vitest + Testing Library
```

`AdvisoryWorkspace` renders the five sections top-to-bottom in reading order.
Every child is pure and presentational; the root holds no state.

---

## 3. Public exports

Import everything from the package root: `src/features/advisory`.

**Components**

- `AdvisoryWorkspace` — the root component.
- `ClientSnapshot`, `RecommendedProjects`, `AdvisorStrategy`, `RiskPanel`,
  `NextAction` — sub-components for advanced composition.

**Component prop types**

- `ClientSnapshotProps`, `RecommendedProjectsProps`, `AdvisorStrategyProps`,
  `RiskPanelProps`, `NextActionProps`.

**Data**

- `ADVISORY_ACTIONS` — the five-action catalogue (readonly).
- `DEMO_SESSION` — a complete, deterministic sample session.

**Types** — enumerations (`BuyerType`, `ClientTimeline`, `RiskProfile`,
`ConfidenceLevel`, `RiskSeverity`, `RiskScope`, `AdvisoryActionId`), data
shapes (`ClientSnapshotData`, `RecommendedProject`, `AdvisorStrategyData`,
`AdvisoryRisk`, `AdvisoryAction`, `AdvisorySession`), and
`AdvisoryWorkspaceProps`.

There are **no default exports** and **no name collisions**: components are
named for their concept; data types carry `Data` / domain suffixes.

---

## 4. Required props

`AdvisoryWorkspace` (`AdvisoryWorkspaceProps`):

| Prop        | Type                             | Required | Default                |
| ----------- | -------------------------------- | -------- | ---------------------- |
| `session`   | `AdvisorySession`                | **yes**  | —                      |
| `actions`   | `AdvisoryAction[]`               | no       | `ADVISORY_ACTIONS`     |
| `onAction`  | `(id: AdvisoryActionId) => void` | no       | no-op                  |
| `title`     | `string`                         | no       | `"Advisory Workspace"` |
| `className` | `string`                         | no       | `""`                   |

Minimal usage:

```tsx
import { AdvisoryWorkspace, DEMO_SESSION } from "@/features/advisory";

<AdvisoryWorkspace session={DEMO_SESSION} onAction={(id) => console.log("advisor chose", id)} />;
```

---

## 5. Mock-data structure

`mock.ts` exports two deterministic values:

- **`ADVISORY_ACTIONS`** — the five `AdvisoryAction`s, in intended display
  order: `send-passport`, `book-viewing`, `compare-projects`,
  `request-missing-info`, `schedule-follow-up`.
- **`DEMO_SESSION`** — one `AdvisorySession`:
  - `client: ClientSnapshotData`
  - `recommendations: RecommendedProject[]` — **exactly three**: `Modeva`,
    `Coralina`, and one clearly-marked placeholder (`isPlaceholder: true`).
  - `strategy: AdvisorStrategyData` — `showFirstProjectId` references a
    recommendation `id`.
  - `risks: AdvisoryRisk[]` — three risks spanning `client` / `project` /
    `data` scopes.

All values are labelled demo data. No factual claims about real projects are
made beyond the names already present in the Forever pipeline.

---

## 6. Action callback contract

`NextAction` renders each action as a `<button type="button">`. On click it
calls `onAction(action.id)` where `id` is a stable `AdvisoryActionId`.

- Exactly one id is emitted per click.
- No navigation, no side effects, no real integration occurs in RC1.
- The host owns what each id does (see connection points below).

```ts
type AdvisoryActionId =
  | "send-passport"
  | "book-viewing"
  | "compare-projects"
  | "request-missing-info"
  | "schedule-follow-up";
```

---

## 7. Future connection points

These are **intentionally not implemented** in RC1. Each is a clean seam.

- **Navigator** — Navigator RC1 selects a client/context. Feed its output into
  a mapper that produces an `AdvisorySession`, then pass as `session`. Do not
  modify Navigator to accommodate this module.
- **Decision Engine** — replace `DEMO_SESSION.recommendations` and
  `matchScore` / `confidence` with engine output mapped to `RecommendedProject`.
- **Project Intelligence** — source `primaryReason`, `tradeOff`, and risk
  explanations from project intelligence, mapped to `RecommendedProject` /
  `AdvisoryRisk`.
- **Passport** — wire the `send-passport` action id to the Passport module.
- **Supabase** — persistence/session storage attaches at the host layer that
  _builds_ the `AdvisorySession`; this module never talks to Supabase directly.

The integration pattern is always the same: **external source → mapper →
`AdvisorySession` → `<AdvisoryWorkspace session={…} />`**.

---

## 8. Codex integration checklist

1. Copy `src/features/advisory/**` into the Forever repo at the same path.
2. Copy `docs/ADVISORY_WORKSPACE_RC1_INTEGRATION.md` into the repo `docs/`.
3. Confirm the repo has React 18+, TypeScript, and TailwindCSS configured.
4. Ensure the repo's path alias (e.g. `@/`) resolves `src/features/advisory`,
   or import via relative path.
5. Verify the frozen palette hex values match the repo's Tailwind theme; the
   module uses arbitrary values (`#17150F`, `#F3EFE7`, `#FFFFFF`, `#9C7B4C`,
   `#EAE6DE`, `#9A958A`) so it works even without theme tokens.
6. Confirm the `Newsreader` and `Hanken Grotesk` fonts are loaded globally
   (the module names them in `font-family`; it does not import them).
7. Render `<AdvisoryWorkspace session={DEMO_SESSION} />` on a scratch route to
   smoke-test visually. **Do not add this route to production routing.**
8. Run `vitest run` for `AdvisoryWorkspace.test.tsx` inside the repo toolchain.
9. Replace `DEMO_SESSION` with a real `AdvisorySession` mapper when the
   upstream sources (above) are ready.
10. Wire `onAction` to the host's action handlers.

---

## 9. Items that require repository verification

Verified in this isolated package (React + TS + Vitest toolchain):

- Type-check passes (`tsc --noEmit`, strict).
- All 8 tests pass (`vitest run`).
- No `supabase` / `fetch(` / real `api` call / `migration` / `crm` /
  `navigator` references in source.

**Cannot be verified in isolation — Codex must confirm in-repo:**

- Path-alias resolution (`@/features/advisory`) against the repo config.
- Global availability of the `Newsreader` and `Hanken Grotesk` fonts.
- TailwindCSS version and whether arbitrary-value classes are enabled
  (they are by default in Tailwind 3+).
- That the repo's own lint / CI rules pass on these files.
- That no existing symbol names in the repo collide with this module's
  exports at the import site.
- Visual parity with Navigator RC1 in the live app shell.

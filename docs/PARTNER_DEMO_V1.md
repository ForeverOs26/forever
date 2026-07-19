# Forever Partner Demo v1 — Presentation Runbook

Status: Canonical presentation runbook
Last updated: 2026-07-19

## Objective

Present Forever to a business partner in 7–10 minutes, on the Owner's laptop,
without explaining the repository, database architecture, PowerShell, import
internals, or test infrastructure.

The single business statement the presentation must land:

> Forever exists to reduce uncertainty in real estate decisions.

## Audience

A business partner evaluating Forever as a product and a commercial
opportunity. Assume no technical background. Use "guest" (not "customer")
whenever a person label is needed.

## Local startup

1. Open the repository folder in Explorer.
2. Double-click `scripts/demo/Start-Forever-Partner-Demo.cmd`.
   - It verifies Node/npm, checks that dependencies are installed (and tells
     you to run `npm install` once if they are not), prints the presentation
     routes, starts the existing development server, and opens the first
     route.
3. Wait for the browser to open `http://localhost:5173/`.

Demo lead mode is ON by default in local development: every lead form
(Booth contact details, Request Private Advisory) completes normally but
writes nothing and makes no network call. A small "Local demo mode" note is
visible on those screens so you always know no real lead is created. To
restore real lead writes during ordinary local work, set
`VITE_DEMO_LEAD_MODE=false` in `.env`.

First route: `http://localhost:5173/` (Home).

## Demo persona

"An investment-minded second-home guest."

Exact NAV-001 answers (same answers in Navigator and Booth — the results are
deterministic and identical in both):

| Screen | Question | Select |
| ------ | -------- | ------ |
| 01 | Why are you considering Phuket? | "A second home by the sea" + "Investment & rental yield" |
| 02 | What would success look like for you? | "Steady rental income" + "Financial security" |
| 03 | What feels comfortable, and when? | Budget "$500k–1M", Timeline "3–6 months" |
| 04 | What's your biggest concern right now? | "Trusting the developer" + "Rental returns" |

## Expected Navigator result behavior

- The Forever Story reflects the answers back in calm language, then the
  Decision Profile drives the recommendation guidance (rental/investment
  profile).
- Project matching is deliberately honest. With the current catalogue, expect
  the line: **"No exact match found — showing available projects for
  discussion"**, with the full real catalogue still shown. This is a feature,
  not a failure — say so out loud: Forever only claims a match when the
  guest's confirmed profile and the project's recorded evidence both support
  it.
- If the production Modeva record has been enriched with a quantified rental
  yield since this runbook was written, an evidence chip ("Purchase goal
  supported by available project evidence") may appear instead. Both outcomes
  are correct.

## 7–10 minute timed script

**1. Forever purpose and the problem — 45–60 seconds** (Home, `/`)

Buying property in Phuket is a high-uncertainty decision: unfamiliar law,
unfamiliar developers, sales pressure. Forever reduces that uncertainty with
structured project records, transparent analysis, and a guided first
conversation. Point at the hero line and the "Start the Forever Navigator"
button.

**2. Website Navigator — 2–3 minutes** (`/navigator`)

Click "Start the Forever Navigator". Walk the persona answers above at a
guest's pace. Pause on the Forever Story screen: "Forever first proves it
understood the guest, before showing a single property." Confirm the story.

**3. Recommendation results — 1 minute**

Show the recommendation guidance and the honest matching line. Key message:
no fake scores, no fake rankings — recommendations only claim what the data
supports, and the guest always keeps access to the full catalogue.

**4. Project Detail and Forever Passport — 2 minutes**

From the results, open **Modeva** (the published project,
`/projects/modeva`). Scroll the Forever Passport, evidence scores,
strengths/risks, and the "Not recorded" honesty. Then open **Coralina**
(`/projects/coralina`) — a real newly onboarded project, still an unpublished
draft, previewed locally: same Project Detail engine, structured inventory of
8 buildings and 198 residences, and neutral "Not available" wherever
source-backed data does not exist yet. Key message: this is what onboarding a
new project into Forever looks like — structure first, enrichment before
publication.

**5. Booth Mode — 1–2 minutes** (`/booth`)

Open Booth Mode: "the same Navigator, presented as a staff-guided tablet
experience for in-person consultations." Show the staff bar, run one or two
questions (or reuse the same persona quickly), show the guest's story ledger
with per-answer Edit, select a project for the guest, and complete contact
details — the demo-mode note shows that nothing is written. Show "Start new
guest" and its guarded reset.

**6. Database and onboarding capability — max 45 seconds** (talk only)

Business-level Fast Intake explanation — use exactly this level of detail:

> Forever now has a safe, repeatable way to prepare new projects for the
> platform. The current version is fastest when structured project facts and
> price data already exist. Raw-document automation is the next separate
> stage.

**7. Close and partner discussion — remaining time**

Restate the one-line purpose. Ask what the partner would need to see next.

## Booth Mode sequence (reference)

Welcome → Questions 01–04 → Guest story (confirm) → Matching projects →
Select for guest → Contact details (demo mode, nothing saved) → Complete →
"Start new guest" (guarded reset).

## Published project and Coralina preview

- Published project to open: **Modeva** — click its card from the results or
  the catalogue (`/projects/modeva`). It is served by the normal
  production-backed ProjectService path.
- Coralina local preview route: **`/projects/coralina`** — available only in
  local development; it appears in the local catalogue with an unpublished
  draft badge and is excluded from production builds. Coralina remains an
  unpublished draft; do not imply it is published.

## Where the demo stops before any real write

Nowhere — by design. With demo lead mode ON (the local default), both lead
forms can be completed live: they validate, show the normal confirmation, and
write nothing. If you have set `VITE_DEMO_LEAD_MODE=false` for other local
work, either set it back or stop at the lead form without submitting.

## What not to discuss unless the partner asks

- Repository, Git, PowerShell, import internals, or test infrastructure.
- Database schema, migrations, RLS, or credentials.
- Fast Intake implementation detail beyond the business statement above.
- Factory autonomy levels (if asked: analysis tooling only proposes; a person
  approves everything).
- The static illustrative sections on the home page (offers, reviews, areas)
  — see honest limitations below.

## Fallbacks if a screen or data source fails

- Home or catalogue fails to load (data source unreachable): use the shown
  "Try again", or continue the story directly at `/navigator` — the Navigator
  and Booth work without the catalogue, and results degrade to their built-in
  error state with a retry.
- A project page fails: use the other project (`/projects/modeva` ↔
  `/projects/coralina`).
- Coralina preview unavailable: fall back to Modeva only and describe
  onboarding verbally with the Fast Intake statement.
- Navigator state looks stale mid-demo: website — "Start Again" on the final
  screen or reload the page; Booth — "Start new guest".
- Whole dev server fails: Ctrl+C in the launcher window, close it, and
  double-click the launcher again (about 30 seconds).

## Pre-presentation checklist

- [ ] Laptop on power, notifications/do-not-disturb on.
- [ ] `scripts/demo/Start-Forever-Partner-Demo.cmd` started; browser opened
      Home.
- [ ] `.env` present so the catalogue shows published projects.
- [ ] Home, `/navigator`, `/projects/modeva`, `/projects/coralina`, `/booth`
      each opened once and rendering.
- [ ] "Local demo mode" note visible on the Booth contact screen.
- [ ] Booth reset to Welcome ("Start new guest").
- [ ] Browser zoom at 100%; close extra tabs.

## Shutdown

1. Press Ctrl+C in the launcher's PowerShell window.
2. Close the window.
3. Nothing else runs in the background and nothing was written anywhere.

## Known honest limitations

- The current published catalogue is small, and the Modeva record is still
  sparse ("Awaiting full Forever inspection data", low evidence scores,
  "Price on request"). The scores are honest, not broken — say so if asked.
- Expect "No exact match found" for most personas today; matching only lights
  up dimensions the recorded data supports (for example, budget matching
  stays off until project prices and budget bands share a currency).
- The home page "Verified Offers", "Reviews", and "Areas" sections are static
  illustrative content from the early product foundation, not database-backed
  records. Do not present them as live data; the Navigator → Project Detail →
  Booth path is the real system.
- Coralina has no public media in the preview — its gallery is intentionally
  empty rather than filled with unverified images.
- The browser dev console in local development shows warnings from local dev
  tooling. Partners never see this; do not open the console during the demo.

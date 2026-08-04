# Forever Studio — stale client asset recovery

Task: `FOREVER-STUDIO-STALE-ASSET-RECOVERY-001`
Incident this answers: `FOREVER-PR134-AUTHENTICATED-STUDIO-INCIDENT-001`

This document is the contract for what happens when a browser is still running
an older build of Forever than the one the origin is serving. It is deliberately
narrow: almost everything here is a reason **not** to act.

---

## 1. The incident, and the exact root cause

After the PR #134 release reached 100%, the Owner's already-open, signed-in
Studio page failed with the application's generic root error screen:

> This page didn't load
> Something went wrong on our end. You can try refreshing or head back home.

Public routes stayed healthy. No Worker exception was raised. The database, the
bindings and the migration were all fine.

**Root cause.** Cloudflare Workers Static Assets serves only the **active**
Worker version's asset set. A release replaces the entire content-hashed asset
set atomically, so a browser still executing the previous client build requests
chunk URLs that no longer exist. The origin answers `404` with an HTML document,
the dynamic `import()` rejects, the route load throws, and the root error
boundary renders. Nothing reaches Worker code in a way that raises an exception,
which is why the server side looked healthy throughout.

Cloudflare documents this directly, for gradual rollouts with static assets:

> Without version affinity, a user can receive HTML from version A, but when
> their browser requests `index-a1b2c3d4.js`, that request may be routed to
> version B — which does not have that file — resulting in a 404 error and a
> broken page.

The same mechanism applies to an **atomic** cutover for any client that was
already loaded when the cutover happened. Version affinity does not help there:
affinity pins a user to a version for the duration of a rollout, but the
previous version's assets still cease to be served once the rollout completes.

### 1a. What the independent reproduction added

Reproduced against the real routing and error-boundary code with two real
production builds and a real browser (see `scripts/studio/stale-asset-harness/`).

TanStack Router already contains its **own** unconditional one-shot reload for
lazy route component failures: it writes
`sessionStorage["tanstack_router_reload:<raw error message>"]` and calls
`location.reload()` if that key was absent. That guard:

- has **no build-identity check** — it reloads even when the origin is
  unchanged, so an ordinary network blip can reload the page;
- has **no write-action safety** — it can reload while a consequential action's
  outcome is unproven;
- is keyed on unbounded raw error text, and persists the **complete asset URL**
  in `sessionStorage`;
- covers only lazy route components — not `vite:preloadError` in general, not
  module script element failures, not other dynamic imports;
- is **never cleared on success**.

It fires at most once per distinct error message per tab. The Owner reached the
root error boundary because that single allowance had already been spent for the
same message. This was reproduced deterministically.

### 1b. That mechanism no longer ships (independent-review P1-5)

An earlier revision of this work COEXISTED with the framework reload, cancelling
`vite:preloadError` only when the Forever classifier confirmed. The independent
review then measured six real error shapes where `isModuleNotFoundError` is true
while the classifier correctly returns `not_stale_asset` — a message naming a
foreign URL, an asset on a sibling host, an unhashed asset path, an asset outside
`/assets/`, a relative specifier, and a hash shorter than eight characters. On
every one of those the framework reloaded anyway: identity-blind, write-unsafe,
including on `/studio/reset-password`, and persisting the complete asset URL.

Two independent recovery systems is not a design, it is a race. The pinned
version offers no supported way to disable the built-in reload, so
`scripts/build/tanstack-reload-ownership.mjs` substitutes a
repository-controlled loader (`scripts/build/forever-lazy-route-component.js`)
that preserves `preload()`, memoisation, the recorded error and `React.use`, and
removes only the storage write and the reload. A fingerprint check FAILS THE
BUILD if the upstream module is not the pinned shape it was written against, and
a built-output scan asserts `tanstack_router_reload` is absent from every
emitted file. There is now exactly one recovery authority.

---

## 2. What the recovery does

```
stale hashed chunk detected
  → classify it narrowly
  → confirm recovery is safe
  → confirm the origin really is on a different build
  → record a deny-only one-attempt marker
  → replace the page once, on the same route and safe query
  → keep the Auth session exactly where it is
  → clear the marker only after the intended route graph has loaded
```

At most **one** automatic reload per version transition per tab. Never a loop.
Never a resubmission.

### 2.1 Classifier — `src/lib/stale-asset/stale-asset-contract.ts`

Output is a closed enum and nothing else:

| Verdict                     | Meaning                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `stale_dynamic_import`      | a rejected dynamic import / module preload for a same-origin content-hashed chunk |
| `stale_module_script`       | a `<script type="module">` or `<link rel="modulepreload">` element failed for one |
| `stale_asset_html_fallback` | a same-origin content-hashed JS asset answered 404, or answered with HTML         |
| `not_stale_asset`           | everything else                                                                   |

A stale verdict requires **positive asset evidence**: a URL that is same-origin,
inside the generated `/assets/` directory, and content-hashed. In addition:

- a message naming **any** foreign URL is refused outright, even if it also
  names one of ours;
- an unhashed asset is refused — an unhashed file is not immutable, so its
  absence proves nothing about a version transition;
- a message naming a non-asset failure (Supabase, PostgREST, JWT, permission,
  R2, database, RPC, Studio function) is refused, checked against the message
  with recognised asset URLs removed first, so a chunk named `studio-auth-…`
  cannot be mistaken for an auth error;
- an exception reaching a React boundary needs **both** the module-load
  vocabulary and the asset evidence.

Never classified as stale: arbitrary React render exceptions, Supabase errors,
Studio RPC errors, authentication errors, permission errors, R2 processing
errors, database errors, a generic `TypeError` without asset evidence, and user
or extension network failures unrelated to a versioned asset.

**Nothing is retained.** The classifier returns one enum member. It never
returns, stores, logs or renders the complete asset URL, a query string, a stack
trace, an error message, a JWT, an access token, a user id, an email, a job id,
an object key, a filename, a Supabase project ref or a credential.

### 2.2 Build/release identity — `src/lib/stale-asset/client-asset-identity.ts`

`FOREVER_CLIENT_ASSET_ID` is a bounded identifier — lowercase alphanumerics, at most 32
characters — inlined into **both** the client and the server output of the same
build. It is never a timestamp and never random.

**It is derived from the EMITTED OUTPUT, not from a list of presumed inputs**
(independent-review P1-4). The previous design hashed `src/**` plus four files and
hashed no `VITE_*` value, nothing in `public/` and nothing in `scripts/`. The
review built this repository five times and measured two builds emitting **50
different content-hashed chunks — including the `StudioDashboard` chunk from the
incident — under the SAME identifier**. In production that means the chunk 404s,
the probe returns the same identifier, the decision reaches `same_client_assets`, and
automatic recovery silently does not fire.

`npm run build` (`scripts/build/build-forever.mjs`) therefore:

1. emits the runtime graph with a fixed canonical placeholder identity;
2. hashes the emitted graph in deterministic sorted order, normalising the
   placeholder bytes and the content-hash segments they would move;
3. derives the identity as **128 bits** of SHA-256 of that digest;
4. seals the identity over the placeholder IN PLACE — same length, same
   positions, so no filename and no other byte can move;
5. recomputes the digest over the sealed output and REQUIRES exact equality, an
   unchanged file count, at least one client and one server occurrence, and no
   surviving placeholder. Otherwise the build fails.

**What the digest covers, and the measured reason for what it does not.**
`npm run build:determinism` runs two builds of identical source and reports what
differs. Measured in this repository: the whole client runtime graph is
byte-identical, the generated Worker configuration is byte-identical, and the
server JavaScript bundle is NOT — 17 files differed, from Rolldown identifier
deconfliction and an mtime-bearing public-asset manifest. The digest therefore
covers `.output/public/**` and `.output/server/wrangler.json`. The exclusions are
enumerated with reasons in `scripts/build/forever-client-asset-id.ts` and a test fails
if that list grows.

This is a deliberate deviation from "exclude only generated non-runtime
metadata", taken because an identity computed over non-reproducible bytes is not
an identity: the same artefact could not be re-derived and the runbook's "record
the identity" step would be meaningless. It is safe for THIS mechanism because a
stale-asset failure is by construction a browser failing to fetch a CLIENT
chunk, and every input that can change the client graph is inside the digest.
**What is lost, stated plainly:** a release that changes only server code ships
the same identity, and a page from the previous build correctly reads
`same_client_assets` — its chunks all still exist.

**A manual `FOREVER_CLIENT_ASSET_ID` is REFUSED for a production build**
(independent-review P3-3): it could pin a previously deployed identifier and
make every page from that build refuse recovery. It is honoured only behind an
explicitly non-production guard, which the two-version harness sets and
`npm run build` never does. A bare `vite build` with no identity throws rather
than shipping a placeholder.

`GET /forever-client-assets.json` returns `{"build": "<id>"}` with `no-store`, `nosniff`
and `noindex`. The handler takes no argument and reads nothing at request time.

The comparison is therefore: _the constant compiled into this page_ versus _the
constant the origin is serving now_. Equal → not a version problem → no reload.

**Deliberately NOT used.** No Cloudflare `version_metadata` binding, no service
binding, no upstream Worker, no custom domain. The compile-time constant already
distinguishes builds, and adding a binding would change the deploy binding set
for no gain. The generated Worker configuration is unchanged apart from
`observability`.

### 2.3 The recovery LEDGER — `sessionStorage`

An earlier revision stored ONE slot holding one ordered `from → to` transition,
overwritten on every write. That bounds reloads per transition and bounds
nothing else: a tab can observe an unbounded number of distinct transitions.
The independent review measured **12 automatic reloads** on one tab; driving the
same machine against a strictly alternating edge produced **40 from 40 signals**.
A plain release-then-rollback — the runbook's own step — granted a second
automatic reload to a tab that had already recovered (independent-review P1-1).

Key `forever.app.stale-asset.recovery`, value:

```json
{
  "v": 2,
  "pending": {
    "from": "<public build id>",
    "to": "<public build id>",
    "at": 1785774137088,
    "route": "studio_dashboard"
  },
  "history": [{ "from": "<public build id>", "to": "<public build id>", "at": 1785774137088 }]
}
```

Two separate concepts:

- **pending** — the one transition this tab issued a reload for and has not yet
  proved successful. Zero or one, with its own 10-minute TTL.
- **history** — the transitions this tab has already spent an attempt on. It
  survives success, navigation, Back, "Go to site" and redirects, and is erased
  by nothing except its own 12-hour TTL.

`route` is a **closed-vocabulary route KIND**, never a pathname: `public`,
`studio_dashboard`, `studio_upload`, `studio_members`, `studio_project`,
`studio_resale`, `studio_reset_password`, `studio_forgot_password`,
`studio_other`. A pathname would be stored route data, and
`/studio/project/<slug>` carries a private identifier.

Those fields are the **entire** permitted content. The validator refuses the
WHOLE ledger — never partially salvages it — on an unknown key, a wrong schema
version, an unbounded identifier, a route outside the vocabulary, a history
longer than the strict maximum of 8, a non-integer timestamp, or an oversized
value. So "no token, no email, no user id, no job id, no filename, no asset URL,
no query, no stack, no error message, no route path" is enforced rather than
intended. A malformed value produces the `malformed_state` refusal — it never
silently becomes a fresh reload budget. A future timestamp is **clamped, never
dropped**, so a backwards clock shift cannot erase history and re-arm a
transition.

The ledger is **deny-only**: its only power is to refuse an automatic reload. A
forged ledger costs the visitor one button press, and every reload still
additionally requires a proven build difference, a permitted route and no
unproven write.

### 2.4 The bounded-attempt rule

Two explicit policy bounds, and the maximum is set by policy — never by how long
the origin flaps:

- **one automatic reload per ordered `from → to` transition, ever**;
- **at most three automatic reloads per tab per TTL window**, which is what makes
  an endlessly progressing sequence of releases (`A → B → C → D …`) finite.

Therefore:

- A ↔ B alternating for ever costs at most **two** automatic reloads. Measured
  after the correction: 40 rounds → 2 reloads; 400 rounds → 2 reloads.
- release then rollback does not re-arm the original pair;
- a fourth genuinely different transition returns `recovery_budget_spent`;
- a second classified failure shows the specific recovery screen with a manual
  `Reload current version` and a `Go to site`;
- a history entry older than 12 hours expires, so a long-open tab is never
  permanently barred;
- no storage, unreadable storage or unwritable storage → **no automatic reload
  at all**.

A single missing chunk surfaces on more than one channel at once, so an
in-flight gate ensures one failure produces one decision, one build probe and
one reload.

### 2.5 Success attestation — the ONLY thing that clears anything

The earlier revision cleared its marker whenever any non-Studio route resolved.
The recovery screen's own **"Go to site"** control (`<a href="/">`) walked the
visitor straight through that path, so the screen reset the guard it exists to
enforce and re-armed the identical broken transition. Measured before the
correction: `reload_issued`, clear, `reload_issued` again
(independent-review P1-2).

Generic clearing is **deleted**. A pending recovery clears only through an
explicit exact-route attestation that proves ALL of:

1. the build this page is running equals the recovery target build;
2. the live pathname normalises to the recovery target's route kind, or to the
   one documented safe redirect (`studio_other → studio_dashboard`);
3. the intended leaf route module loaded;
4. every nested module in the match chain loaded;
5. no match settled into an error boundary;
6. for an authenticated Studio route, the route reached a genuinely usable
   authenticated state;
7. no further stale-asset signal arrived during a bounded stabilization window.

For authenticated Studio, explicitly: a shell mount is **not** proof and no
longer clears anything; a root mount is not proof; navigating to `/` is not
proof and is actively refused; the sign-in screen is not proof; the
password-recovery interstitial is not proof; an error boundary mounting is not
proof. The **dashboard** is proved by a signed-in session plus a resolved
overview; the **upload** route by the uploader leaf reaching a usable state; the
**members** route by its leaf AND its data boundary resolving.

**Only the pending recovery clears. The history is never erased** — not by
success, not by "Go to site", not by Back, not by a redirect, not by ordinary
public navigation.

---

## 3. Write-action safety

An automatic reload must never create a second consequential action.

Registered consequential actions (`src/lib/stale-asset/write-safety.ts`), each
registered **before** the request leaves and released on every terminal path:

| Action                | Site                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `upload_start`        | `StudioUploader.runJob` — job creation through the processing confirmation |
| `upload_confirm`      | reserved by the same registration; the confirmation is inside `runJob`     |
| `publication`         | `studioSetProjectPublication`, `studioSetListingPublication`               |
| `owner_retry_submit`  | `StudioDashboard.startOwnerRetry`, armed with the absolute deadline        |
| `owner_retry_observe` | `StudioDashboard.observeOwnerRetry`                                        |
| `password_update`     | `StudioResetPassword.submit`                                               |
| `member_change`       | `studioInviteMember`, `studioSetMemberActive`                              |

Contract:

- a confirmed stale error **before** any consequential action began → bounded
  automatic reload allowed;
- if the application cannot prove whether a write was submitted or is still in
  flight → **no automatic reload at all**, and nothing is resubmitted;
- after a manual reload, recovery is through **read-only status observation**
  only: the dashboard overview and the Owner Retry refresh path;
- no mutation, no Retry, no upload and no publication ever restarts on its own.

`/studio/reset-password` is on a hard deny list: an automatic reload there is
refused regardless of evidence, because it is the only route in this application
that carries authentication material in the URL fragment. The recovery target is
built from path and query only — **the fragment is dropped**.

**Owner Retry is not weakened.** The single absolute deadline
(`STUDIO_OWNER_RETRY_OBSERVATION.totalTimeoutMs`, 14 minutes, armed
synchronously before the mutation is sent), the per-job lock, and the `timeout`
phase that refuses to resubmit are all unchanged. A reload can never become a
second Retry: while a Retry is unproven the reload is refused, and after a manual
reload nothing resubmits.

---

## 4. Root error boundary — three honest outcomes

|       | Condition                                | Behaviour                                                                           |
| ----- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| **A** | confirmed stale asset, attempt available | bounded automatic recovery; no generic failure screen; no raw error                 |
| **B** | confirmed stale asset, attempt spent     | the specific update screen with a manual reload; never a second automatic reload    |
| **C** | anything else                            | the existing generic error screen, unchanged; no automatic reload; no raw exception |

The boundary classifies through the same narrow classifier — there is no second,
looser notion of "looks like a chunk problem". It never reloads by itself, never
renders `error.message` or a stack, and the recovery screen mentions no Studio,
Owner, upload or job vocabulary, so it stays safe on public routes.

The recovery screen says the application was updated and could not finish loading
the latest version. It is deliberately **not** presented as a failed upload, an
Auth failure, a database failure or a Coralina failure — naming the wrong cause
is how someone is led to press Retry, sign out, or re-upload when none of those
is the problem. It imports no UI-kit component and no router API, because it has
to render on a page whose chunks are missing.

---

## 5. Global capture

`installStaleAssetCapture()` registers exactly one listener per event type:

- `vite:preloadError` — the build's own preload helper dispatches this for every
  failed route chunk import and module preload. It is `cancelable` and fires
  before the router sees the rejection.
- `error`, capture phase — script and modulepreload element failures do not
  bubble.
- `unhandledrejection` — the backstop.

Registration is idempotent (a remount, a hot update or a second import changes
nothing), and `uninstallStaleAssetCapture()` removes precisely what was added.

It is installed from `getRouter()` in `src/router.tsx`. **Not** from a bare
side-effect import: this package declares `"sideEffects": false` and the bundler
drops such imports — measured against a real production build, where exactly that
happened and the listeners never shipped.

`preventDefault()` is called **only** for a confirmed stale asset on the
cancelable preload channel, because at that point this layer owns the outcome and
the framework's unconditional reload must not also fire. There is no blanket
`preventDefault`: ordinary preload failures, all rejections and all resource
errors propagate exactly as before, and the root boundary stays authoritative for
everything non-stale.

---

## 6. Observability, and its honest limit

`wrangler.jsonc` enables Workers Logs:

```jsonc
"observability": { "enabled": true, "head_sampling_rate": 1 }
```

Full invocation sampling for the corrective release. No new third-party logging
service, no Logpush dependency, no tail consumer required.

**Server-side logging boundary.** Server logs may carry closed event codes and
bounded fields only. Never an `Authorization` header, a cookie, a token, an
email, a user id, a complete route query, a job id, an object key, a filename, a
raw exception, or private document data.

**The limit, stated plainly.** Workers Logs record Worker **invocations**. The
failure this release addresses happens inside the browser, and a 404 for a
missing asset is answered by the asset handler without raising a Worker
exception. **Workers Logs cannot, on their own, prove a browser-only dynamic
import failure when no request reaches Worker code.** They close the server-side
blind spot found during the incident; they do not observe the client.

No public browser-error collection endpoint is introduced. One would require a
strict allowlisted schema, an abuse and rate-limit boundary, zero identifiers, no
raw URL or stack, and a demonstration of no new privacy risk. None of that is
needed to fix this defect, so it is out of scope.

---

## 7. Deferred: true version affinity

Recorded as `FOREVER-CLOUDFLARE-VERSION-AFFINITY-001`, **documentation only** in
this task.

Cloudflare's version affinity is configured by setting the
`Cloudflare-Workers-Version-Key` request header, which can be derived
automatically **by a Ruleset Engine rule on your zone**. The production origin is
a `workers.dev` subdomain, which is not a zone under this account's control, so:

- **a zone Transform Rule does not protect this deployment** — do not claim it
  does;
- **version affinity is not active** here, and must not be claimed as active
  unless it is actually configured and proven;
- no upstream Worker, service binding, custom domain or Transform Rule is
  introduced by this task.

A later, separately authorized task may obtain true version affinity through a
custom domain plus a Transform Rule, or through an approved upstream router.
Until then, the release sequence in
`docs/FOREVER_PRODUCTION_RELEASE_RUNBOOK.md` is the protection.

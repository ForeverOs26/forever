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

### 2.2 Build/release identity — `src/lib/stale-asset/build-identity.ts`

`FOREVER_BUILD_ID` is a bounded identifier — lowercase alphanumerics, at most 32
characters — inlined by the bundler into **both** the client and the server
output of the same build. A release may pin it with `FOREVER_BUILD_ID`;
otherwise it is a deterministic 12-character digest of the repository's build
inputs (`src/**`, `package.json`, `package-lock.json`, `vite.config.ts`,
`tsconfig.json`). It is never a timestamp and never random, because a build this
repository cannot reproduce is already treated as a defect.

`GET /forever-build.json` returns `{"build": "<id>"}` with `no-store`, `nosniff`
and `noindex`. The handler takes no argument and reads nothing at request time.

The comparison is therefore: _the constant compiled into this page_ versus _the
constant the origin is serving now_. Equal → not a version problem → no reload.

**Deliberately NOT used.** No Cloudflare `version_metadata` binding, no service
binding, no upstream Worker, no custom domain. The compile-time constant already
distinguishes builds, and adding a binding would change the deploy binding set
for no gain. The generated Worker configuration is unchanged apart from
`observability`.

### 2.3 One-attempt marker — `sessionStorage`

Key `forever.app.stale-asset.recovery`, value:

```json
{
  "v": 1,
  "from": "<public build id>",
  "to": "<public build id>",
  "attempt": 1,
  "at": 1785774137088
}
```

Those five fields are the **entire** permitted content. The validator refuses any
object carrying an unknown key, a wrong schema version, an unbounded identifier,
an attempt count above 1, or a timestamp in the future — so "no token, no email,
no user id, no job id, no filename, no asset URL, no stack, no error message, no
route" is enforced rather than intended. An invalid marker is deleted and treated
as absent.

The marker is **deny-only**: its only power is to refuse a second automatic
reload. A forged marker costs the visitor one button press.

### 2.4 The one-attempt rule

For the same `from → to` transition in the same tab:

- at most one automatic reload;
- a second classified failure does **not** reload — it shows the specific
  recovery screen with a manual `Reload current version` and a `Go to site`;
- a genuinely different later transition earns its own single attempt;
- a marker older than 12 hours expires, so a long-open tab is never permanently
  barred.

A single missing chunk surfaces on more than one channel at once, so an
in-flight gate ensures one failure produces one decision, one build probe and
one reload.

### 2.5 Success clearing

The marker is **not** cleared because the root component mounted. It is cleared
only when the intended route graph has loaded:

- ordinary routes — the router resolving the match (`onResolved`);
- **Studio routes — only when `StudioShell` mounts**, because the authenticated
  shell and its dashboard chunk graph are precisely what failed.

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

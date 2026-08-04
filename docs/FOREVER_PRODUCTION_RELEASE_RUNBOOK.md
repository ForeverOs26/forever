# Forever — production release runbook

Canonical sequence for releasing the Forever Worker to
`https://forever.phuketre22.workers.dev`.

Corrected by `FOREVER-STUDIO-STALE-ASSET-RECOVERY-001` after
`FOREVER-PR134-AUTHENTICATED-STUDIO-INCIDENT-001`.

Deployment itself is a separately authorized action. This document says **how**
a release is performed when it is authorized; it does not authorize one.

---

## 0. The rule that changed, and why

> **Until true version affinity exists, a percentage rollout is PROHIBITED for
> any version that carries a different content-hashed asset set.**

That means the previously used sequence

```
5% → 25% → 100%
```

**must not be used.** It is replaced by the atomic cutover in §2.

**Why.** Cloudflare Workers Static Assets serves only the active version's asset
set. During a percentage rollout two versions are simultaneously active, and
consecutive requests from the same browser — including asset fetches — can be
answered by different versions. Cloudflare states the consequence directly:

> Without version affinity, a user can receive HTML from version A, but when
> their browser requests `index-a1b2c3d4.js`, that request may be routed to
> version B — which does not have that file — resulting in a 404 error and a
> broken page.

Version affinity is the documented fix, and it is configured by setting the
`Cloudflare-Workers-Version-Key` header — derivable automatically only through a
**Ruleset Engine rule on a zone**. The production origin is a `workers.dev`
subdomain, which is **not a zone under this account's control**.

Therefore, truthfully, for this deployment today:

- **No zone Transform Rule protects this deployment.** Do not claim one does.
- **Version affinity is NOT active.** Do not claim it is unless it has actually
  been configured and proven.
- A percentage rollout here is a randomised, per-request mix of two asset sets —
  the exact condition Cloudflare warns produces a broken page.

The follow-up that would make percentage rollout safe is recorded as
`FOREVER-CLOUDFLARE-VERSION-AFFINITY-001` and is **not** implemented here.

---

## 1. What an atomic cutover does and does not fix

An atomic cutover (old 100% → new 100%, in one step) removes the _mid-rollout_
mixing. It does **not** help a browser that was already running the old build
when the cutover happened: the old version's immutable hashed chunks stop being
served the moment the new version takes 100%.

That remaining case is what the shipped stale-asset recovery handles — see
`docs/FOREVER_STUDIO_STALE_ASSET_RECOVERY.md`. Read §4 below before the first
release that carries it.

---

## 2. The release sequence

1. **Build the candidate with `npm run build`.** That is the output-derived build,
   not a bare `vite build`: it emits the runtime graph with a placeholder identity,
   derives `FOREVER_BUILD_ID` from a digest of the emitted client graph plus the
   generated Worker configuration, seals the identity in place, and then
   RE-VERIFIES that the sealed output reproduces that digest. A build that does
   not self-verify fails and must not ship. Record the identity it prints — it
   is what the recovery path compares, and it is also written to
   `.forever-build/identity.json`.

   **`FOREVER_BUILD_ID` may NOT be pinned for a production release.** A manual
   override can reuse a previously deployed identifier, which makes every page
   from that build read `same_build` and refuse the recovery this identity
   exists to enable. The build refuses it outright.
2. **Upload the candidate at 0% traffic.** `wrangler versions upload`. No traffic
   moves. Nothing about the live site changes.
3. **Verify the candidate on its own version preview URL.** The preview URL
   (`<version-prefix>-<worker-name>.<subdomain>.workers.dev`) exercises that
   specific version, including its own asset set.
4. **Validate the full transitive route-chunk graph** on the candidate: crawl the
   documents, collect every `/assets/*` reference transitively, and require
   HTTP 200 for all of them. A single 404 here is a stop.
5. **Validate stale VERSION_A → VERSION_B recovery locally** with the two-version
   harness (`scripts/studio/stale-asset-harness/`): baseline, one automatic
   reload, no loop when the new version is still broken, no reload for ordinary
   errors, and no mutation resubmission.
6. **Enable and verify Workers Logs.** `observability.enabled` is `true` with
   `head_sampling_rate: 1` in `wrangler.jsonc`; confirm it survived into
   `.output/server/wrangler.json` and that logs appear for the candidate. The
   sampling rate is a PERMANENT setting, not a temporary elevation — see §7.
7. **Obtain an explicit, short Owner Studio hold.** Required for the first
   bootstrap release — see §4. The Owner is told the window and told to take no
   Studio action during it.
8. **The Owner closes or refreshes the existing Studio tab and performs no
   action.** No upload, no publication, no Retry, no member change, no password
   change.
9. **Atomic cutover.** Move from old 100% / new 0% to old 0% / new 100% in ONE
   `wrangler versions deploy` invocation. No intermediate percentage. Run
   `--dry-run` first and confirm the exact source and target version ids.
9a. **Watch the asset-404 rate for the first minutes after cutover.**
    Cloudflare's own gradual-rollout guidance names an increased 404 rate on
    asset files as the signal that clients are requesting assets the active
    version does not have. It is the one cheap server-side signal that would
    have surfaced the PR #134 incident, and it is checked here, on the Worker's
    analytics, before the acceptance gate. A rising asset-404 rate is a
    rollback trigger, not a curiosity.

10. **Verify public routes.** The full public probe set: `/`, `/projects`,
    `/sitemap.xml`, `/robots.txt`, the deleted-legacy-route 404 contract and the
    `/media/*` generic 404 contract. Zero 5xx.
11. **Verify the full current asset graph** on the live origin, transitively,
    including the authenticated Studio chunk graph reachable from `/studio`.
    Also confirm `/forever-build.json` reports the new build id.
12. **The Owner opens Studio fresh and confirms the authenticated dashboard
    renders.** This is the acceptance gate. Asset-level checks cannot replace it.
13. **Roll back immediately if the authenticated check fails.** Reallocate
    traffic to the previous version at 100% — an existing immutable version, no
    rebuild, no new version. Verify public routes and the asset graph again
    afterwards.

**Do not begin Coralina repair or any Retry in the release task.** Both require
their own Owner authorization and their own task.

---

## 3. What must never be part of a release step

- No percentage rollout while version affinity is absent (§0).
- No migration applied or reverted as part of a cutover.
- No `retryable` change, no Coralina row repair, no Retry, no re-upload.
- No credential rotation, no R2 or Supabase Storage mutation.
- No binding removed. The deployed Worker carries twelve bindings; four are
  declared by this repository (`ASSETS`, `R2_PRIVATE_SOURCES`, `R2_PUBLIC_MEDIA`,
  `R2_PROJECT_ARCHIVES`) and the rest are deployment-plane secrets plus
  `STUDIO_STORAGE_WRITE_PROVIDER`. `wrangler.jsonc` declares **no** `vars` block
  on purpose: declaring one would replace the deployment-set provider variable
  and silently break R2 job creation.

---

## 4. FIRST-BOOTSTRAP LIMITATION — read before the first release of this fix

**The currently deployed Worker does not contain stale-chunk recovery.**

A tab that is already executing the old client code cannot be protected by code
that only exists in the new build. The recovery listeners, the build-identity
comparison and the one-attempt marker all live in the **new** bundle, and the old
page will never load it on its own.

Therefore:

- **This first hotfix deployment cannot protect a tab that is already open on the
  old build.** It will behave exactly as the PR #134 release did for such a tab.
- The first release therefore requires **one explicit Owner tab refresh or
  closure hold** (steps 7–8), or a separately approved compatibility bridge.
- This limitation is not hidden, not worked around, and not softened.

**After** this hotfix is successfully deployed, a client running this recovery
code may self-recover **once** from a future stale-asset transition, without an
Owner hold, on the terms in §2.4 of
`docs/FOREVER_STUDIO_STALE_ASSET_RECOVERY.md`.

---

## 5. Rollback

**A rollback is a release in the other direction, and it gets the SAME holds.**

This corrects a real asymmetry: the forward cutover had a strong Owner hold and
the rollback had none — while a rollback is exactly the case that sends an
already-recovered tab back to the version it came from. Stale-asset recovery
does not make an uncontrolled rollback safe; it bounds the damage, it does not
remove it. The recovery ledger deliberately remembers the forward transition, so
a tab that already spent its attempt on A → B gets one attempt for B → A and
then nothing at all. A rollback performed while the Owner is mid-action is still
a rollback performed under a live mutation.

Rollback is a traffic reallocation between existing immutable versions: no code
upload, no new version, no rebuild.

**Before the rollback — every one of these, in order:**

1. **The Owner is told to stop and take no Studio action.** Explicitly, before
   anything moves. Same wording as the forward hold.
2. **No mutation is in progress.** No upload, no publication, no Retry, no
   member change, no password change, no facts or amenity save. If one is in
   flight, the rollback WAITS for it to settle — a lost response leaves the page
   unable to prove what the server did.
3. **Every current-version Studio tab is closed or refreshed as directed**, and
   the Owner confirms it.
4. **The rollback target is verified**: an existing immutable version, the
   intended one, and **not** the invalid pre-R2 Worker `9919f28c`.

```
wrangler versions deploy --name forever --version-id <previous> --percentage 100
```

Run `--dry-run` first and confirm the exact source and target version ids.

**The rollback itself is ATOMIC.** One invocation, old 0% / previous 100%. No
intermediate percentage, no partial rollback, no 5% → 25% step — the
version-affinity prohibition in §0 applies identically in this direction.

**After the rollback:**

5. **Verify the full old asset graph** on the live origin, transitively,
   including the authenticated Studio chunk graph reachable from `/studio`, and
   confirm `/forever-build.json` reports the previous build identity.
6. **Verify public routes**, the migration ledger and Coralina containment.
7. **The Owner opens Studio FRESH and confirms the authenticated dashboard
   renders.** This is the rollback acceptance gate, exactly as it is the forward
   one. Asset-level checks cannot replace it.

**Never during a rollback:** no Coralina repair, no Retry, no re-upload, no
migration, no `retryable` change, no credential rotation.

The R2 rollback boundary in `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md` still applies:
once an R2 job exists, the pre-R2 Worker is not a valid rollback target.

---

## 7. Observability lifecycle — the decision, not an implication

`head_sampling_rate: 1` is **PERMANENT**, and this section exists so that is
written down rather than implied.

The earlier framing — "deliberate for a corrective release" — read as a
temporary elevation that would later be reduced. It is not, on two counts.
First, `1` is Cloudflare's documented DEFAULT for Workers Logs, and
observability is enabled by default on new Workers, so there is nothing elevated
about it. Second, reducing it would require **another deployment**, and a
deployment that changes the asset graph is precisely the event this release
exists to make safe. Trading a real risk for a logging saving is a poor bargain.

- **Chosen setting:** `observability.enabled = true`,
  `head_sampling_rate = 1`, indefinitely.
- **Owner of the decision:** the release Owner.
- **Volume and cost bound:** this Worker serves a single-Owner internal tool plus
  a small public site. Cloudflare includes 20M log events per month on paid
  plans and charges $0.60 per million beyond that, with 7-day retention. Full
  sampling for this traffic profile stays inside the included allowance.
- **Trigger to revisit:** sustained monthly log volume approaching the included
  allowance, or a change in traffic profile that makes it plausible. Reducing
  the rate is then a separately authorized configuration change with its own
  deployment, planned as a release in its own right — never bundled into a
  release that changes assets.
- **Temporary deeper observation** during a release uses `wrangler tail`, which
  needs no deployment and no configuration change.

**Honest limit, restated:** Workers Logs record Worker INVOCATIONS. A 404 for a
missing static asset is answered by the asset handler without raising a Worker
exception, so Workers Logs cannot, on their own, prove a browser-only
dynamic-import failure. Step 9a's asset-404 rate on Worker analytics is the
signal that covers that gap.

---

## 8. Deferred follow-up

`FOREVER-CLOUDFLARE-VERSION-AFFINITY-001` — obtain true version affinity through
a custom domain plus a Transform Rule setting `Cloudflare-Workers-Version-Key`,
or through an approved upstream router. Only after that is configured **and
proven** may a percentage rollout be reconsidered, and this runbook must be
updated in the same task that proves it.

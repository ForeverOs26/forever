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

1. **Build the candidate.** Pin `FOREVER_BUILD_ID` for the release, or accept the
   deterministic digest. Record the value — it is what the recovery path compares.
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
   `.output/server/wrangler.json` and that logs appear for the candidate.
7. **Obtain an explicit, short Owner Studio hold.** Required for the first
   bootstrap release — see §4. The Owner is told the window and told to take no
   Studio action during it.
8. **The Owner closes or refreshes the existing Studio tab and performs no
   action.** No upload, no publication, no Retry, no member change, no password
   change.
9. **Atomic cutover.** Move from old 100% / new 0% to old 0% / new 100% in ONE
   `wrangler versions deploy` invocation. No intermediate percentage. Run
   `--dry-run` first and confirm the exact source and target version ids.
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

Rollback is a traffic reallocation between existing immutable versions: no code
upload, no new version, no rebuild.

```
wrangler versions deploy --name forever --version-id <previous> --percentage 100
```

Run `--dry-run` first. Assert the target is the intended previous version and is
**not** the invalid pre-R2 Worker. Re-verify public routes, the asset graph, the
migration ledger and Coralina containment afterwards.

The R2 rollback boundary in `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md` still applies:
once an R2 job exists, the pre-R2 Worker is not a valid rollback target.

---

## 6. Deferred follow-up

`FOREVER-CLOUDFLARE-VERSION-AFFINITY-001` — obtain true version affinity through
a custom domain plus a Transform Rule setting `Cloudflare-Workers-Version-Key`,
or through an approved upstream router. Only after that is configured **and
proven** may a percentage rollout be reconsidered, and this runbook must be
updated in the same task that proves it.

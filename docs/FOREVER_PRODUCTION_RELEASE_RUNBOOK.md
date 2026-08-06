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

## 1a. TWO IDENTITIES, AND WHAT EACH ONE IS ALLOWED TO PROVE

This release depends on two different identifiers. They answer different
questions, and the earlier revision of this runbook conflated them. That
conflation was measured, so it is written down here before the sequence rather
than as a footnote inside it.

|                             | `CLIENT_ASSET_ID`                                                                        | `WORKER_RELEASE_ID`                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| What it is                  | 128-bit digest of the emitted client asset graph plus the generated Worker configuration | The immutable Cloudflare Worker **version UUID**                                         |
| Assigned by                 | this repository's build (`npm run build`)                                                | **Cloudflare**, on `wrangler versions upload`                                            |
| Where it is readable        | `/forever-client-assets.json`, and inside the client bundle                              | `wrangler versions upload` output, `wrangler versions list`, `wrangler deployments list` |
| Proves                      | that an already-running page's content-hashed chunks still exist at the origin           | **which Worker artefact is deployed**                                                    |
| Changes when                | any emitted client byte or the generated Worker configuration changes                    | **every** upload, without exception                                                      |
| May legitimately NOT change | for a **server-only** release                                                            | never                                                                                    |

**The measured reason this table exists.** Appending one executable statement to
a Nitro server plugin — server code that never reaches a browser — produced a
different deployable Worker with a **byte-identical client asset graph** and
therefore an identical `CLIENT_ASSET_ID`. The previous steps 11 and 5 spent that
identifier as the verification gate for the cutover and for the rollback. For a
server-only release both were satisfied before the change, by the change, and by
its reversal. Neither could distinguish the deployment it existed to verify.

Therefore, and without exception:

- **`CLIENT_ASSET_ID` proves client asset compatibility only.** It may never be
  used to prove the exact Worker release, the server runtime identity, the
  production traffic allocation, the rollback target, or complete release
  equality.
- **The Cloudflare Worker version UUID proves the immutable deployed Worker.**
  Every uploaded candidate has a new one. A release step that needs to know
  _which Worker_ asks that, and only that.
- **The Worker version UUID is never manufactured locally.** No build computes
  it, no bundle carries it, no public endpoint serves it. It enters the release
  evidence only by being read back from an authorized upload or listing.

### The release provenance record

One release is described by all of the following, recorded **together**. Any one
of them alone has been shown capable of proving the wrong thing.

1. exact Git commit SHA;
2. exact Git tree SHA;
3. `CLIENT_ASSET_ID`;
4. immutable candidate Worker version UUID;
5. immutable previous Worker version UUID (the rollback target);
6. compatibility date;
7. canonical binding/config fingerprint;
8. migration ledger state.

`npm run build` writes the LOCAL, sanitized half of this to
`.forever-build/release-manifest.json`: source commit, source tree,
`CLIENT_ASSET_ID`, compatibility date and the non-secret config digest. Its
`workerVersionId` is **always `null`**, and it says so in the document itself,
because no local process can know that value. Fields 4 and 5 are added to the
release evidence **after** the authorized upload, from Cloudflare's own output.

A server-only source change may keep the same `CLIENT_ASSET_ID`; it always moves
the Git tree SHA, and it always produces a new Worker version UUID when
uploaded. Those are the two facts that make such a release verifiable at all.

---

## 2. The release sequence

1. **Build the candidate with `npm run build`.** That is the output-derived build,
   not a bare `vite build`: it emits the runtime graph with a placeholder identity,
   derives `FOREVER_CLIENT_ASSET_ID` from a digest of the emitted client graph plus the
   generated Worker configuration, seals the identity in place, and then
   RE-VERIFIES that the sealed output reproduces that digest. A build that does
   not self-verify fails and must not ship. Record the identity it prints — it
   is what the recovery path compares, and it is also written to
   `.forever-build/identity.json` and `.forever-build/release-manifest.json`.

   **This identity is client asset compatibility, not a release identity.** It
   may be **identical** to the previously deployed one for a server-only change,
   and that is correct rather than a fault. It is never a substitute for the
   Worker version UUID — see §1a.

   **`FOREVER_CLIENT_ASSET_ID` may NOT be pinned for a production release.** A manual
   override can reuse a previously deployed identifier, which makes every page
   from that build read `same_client_assets` and refuse the recovery this identity
   exists to enable. The build refuses it outright.

2. **Discover and capture the LIVE Worker UUID, mechanically, before anything
   is uploaded.** Use the authorized read-only deployment discovery result as
   the exact previous Worker UUID, then capture only that immutable version:

   ```
   npm run release:capture-bindings -- --authorize-release \
     --worker forever --live-version-id <exact-discovered-live-worker-version-uuid> \
     --out .forever-build/live-bindings.json
   ```

   This calls exactly one documented endpoint —
   `GET /accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}`
   — requires the returned `result.id` to equal the version you asked for, reads
   `result.resources.bindings`, and writes **only** `{ name, type }` per binding.

   **Do not hand-write this file.** Cloudflare returns a `plain_text` binding as
   `{ name, text, type }`, and `text` is the production value of `SUPABASE_URL`.
   The capture tool never writes, logs or quotes the raw response; a
   hand-transcribed file, by contrast, is a record of what the operator EXPECTED
   and makes the comparison in step 6 confirm itself.

3. **Prove the local upload contract before spawning anything.** The wrapper in
   step 4 runs `npm run release:verify-bindings -- --preupload` for you: the live
   snapshot must satisfy the closed schema, `.output/server/wrangler.json` must
   carry `keep_vars: true` and must declare **no** `vars` block, and the upload
   specification must be canonical. It also requires
   `--expected-live-version <exact-discovered-live-worker-version-uuid>` and
   refuses unless `liveSnapshot.workerVersionId` equals that exact discovery
   result. An omitted, malformed, older or substituted UUID is a named STOP.
   Anything else STOPS before Wrangler starts.

   **PREUPLOAD additionally proves the EXPLICIT BINDING SET — see §2c.** The
   supplied live version must carry exactly the twelve-binding contract
   including both plain-text names; the projected upload must carry **zero**
   `inherit` records; both `SUPABASE_URL` and `STUDIO_STORAGE_WRITE_PROVIDER`
   must be present as `plain_text`; all ten bindings that survive without
   explicit records must still be present; no binding name may be duplicated;
   there must be no `vars` block; and the total must be exactly twelve. The
   success marker is `PREUPLOAD_EXPLICIT_BINDINGS_OK`. The superseded
   `PREUPLOAD_CONTRACT_OK` and `PREUPLOAD_PINNED_INHERITANCE_OK` are never
   emitted again.

   **PREUPLOAD IS NEVER GIVEN A BINDING VALUE.** It runs in its own process and
   reads a VALUE-FREE projection — names and classes only — produced by the
   upload wrapper, which is the sole process that holds the two values. The
   specification digest it reports is an opaque integrity token carried through
   from the wrapper, salted per release, and re-proved by the wrapper against
   the real bytes immediately before the spawn.

4. **Upload the candidate at 0% traffic, through the structured wrapper**, which
   preserves deployment-managed variables. "At 0% traffic" here means **§6 state
   1**: the upload creates an immutable version that is ABSENT from the active
   deployment and therefore serves nothing. It does not place the candidate in
   the deployment at a 0% share — that is state 2, a separate authorized
   mutation described in step 11b:

   ```
   npm run release:upload-version -- \
     --live .forever-build/live-bindings.json \
     --expected-live-version <exact-discovered-live-worker-version-uuid> \
     --receipt .forever-build/worker-version-provenance.json \
     --authorize-upload
   ```

   The wrapper first proves the Wrangler it will run is the **exact
   repository-locked entry point** — `node_modules/wrangler/bin/wrangler.js`,
   by canonical real-path comparison, with both the installed package manifest
   and the CLI required to report the supported version. An external
   installation is refused even when it reports that same version, and
   `WRANGLER_BIN` cannot select one; see §2c.1. It then spawns — with **no
   shell** — exactly this and nothing else:

   ```
   wrangler versions upload --keep-vars --config .output/server/wrangler.upload.json
   ```

   **`--config` names the ephemeral upload specification, not the build
   output.** `.output/server/wrangler.upload.json` is generated per release by
   the wrapper: it is `.output/server/wrangler.json` byte-for-byte plus exactly
   two EXPLICIT `plain_text` bindings. The build output is never modified, and
   the specification is written into the same directory so `main` and the
   relative `assets.directory` resolve to the identical Worker bundle and asset
   set. It is untracked, hashed at verification, and re-hashed **and re-parsed**
   immediately before the spawn — if it changed in between, the wrapper STOPS
   rather than uploading bytes nobody verified.

   **THIS FILE CARRIES VALUES, so its lifetime is the spawn and nothing more.**
   It is created immediately before Wrangler is spawned, with exclusive-create
   and the most restrictive mode the platform honours, and deleted in a
   `finally` that covers success, refusal and exception alike. A specification
   already present when a release starts is a STOP, never something to
   overwrite: it belongs to a crashed or concurrent run and is evidence.

   **Honest limit on Windows.** Node maps only the read-only attribute, so the
   file otherwise inherits the parent directory's ACL. What is actually
   guaranteed there is exclusive creation, the requested mode, and prompt
   deletion on every path — see
   `src/lib/stale-asset/ephemeral-upload-specification.ts`.

   **`--keep-vars` is not optional and not a convenience.** See §2a — omitting
   it deletes every deployment-managed variable. But it is **no longer
   sufficient on its own**; see §2c. That argument vector is
   compared token by token against the canonical one, so `--keep-vars=false`,
   `--keep-vars false`, `--no-keep-vars`, `--keep-vars-disabled`, a duplicated
   flag, a flag after a `--` terminator, a `#` comment, a decoy argument
   containing the substring, `deploy`, a wrong `--config` path and a missing
   `--config` are each REFUSED by name. **A substring test is not proof**: the
   earlier contract used one and accepted every command in that list. No traffic
   moves. Nothing about the live site changes.

   **The wrapper records the immutable Worker version UUID mechanically and
   requires it to be NEW.** Wrangler's documented structured `version-upload`
   result is consumed in memory; only `version_id` is retained. The wrapper
   writes exactly the five sanitized fields `schemaVersion`,
   `previousWorkerVersionId`, `candidateWorkerVersionId`,
   `uploadSpecificationSha256` and `releaseManifestSha256` to the immutable
   receipt path, never stdout, stderr, a preview URL, a credential or any raw
   Wrangler result.

   **Receipt schema 2.** The previous three-field receipt recorded which version
   was live and which version the upload produced — and nothing about **what was
   uploaded**. It could not say which inheritance source was pinned, nor whether
   the artefact uploaded was the artefact that was verified, so it could not
   distinguish a correct release from the one that produced `3540bc64`. Schema 2
   adds the two digests that close that gap, so a receipt mechanically
   correlates all four facts: expected former live UUID, the
   upload-specification **verification digest**, the immutable release-manifest
   SHA-256, and the resulting candidate UUID. **Migration-free**: schema-1
   receipts remain readable exactly as written — no rewrite, no backfill — and
   only schema 2 is ever produced. It is still value-free: two UUIDs and two
   digests.

   **The two digests are not the same kind of thing.** `releaseManifestSha256`
   is an ordinary, reproducible SHA-256 of a value-free file; anyone holding
   that file can recompute it. `uploadSpecificationSha256` is a **salted
   verification digest** — SHA-256 over a per-release random salt followed by
   the normalized specification — and it is therefore **not a content address**,
   **not reproducible** by a later reader, and **not comparable across
   releases**. Its only job is to bind "verified" to "consumed" inside one
   release. It is salted because `STUDIO_STORAGE_WRITE_PROVIDER` has two
   possible values, so a bare SHA-256 of a document whose every other byte is
   knowable would be a two-guess oracle. The field name is fixed by the schema;
   the meaning is this paragraph, not the name.

   It refuses
   an existing receipt rather than overwriting it. If the candidate UUID equals
   the discovered currently deployed UUID, `candidate_worker_version_not_new`
   STOPS the release. An operator never retypes the candidate UUID.

5. **Capture the CANDIDATE's binding snapshot the same mechanical way**, from
   the Worker version UUID the upload just returned:

   ```
   npm run release:capture-bindings -- --authorize-release \
     --worker forever \
     --candidate-release-provenance .forever-build/worker-version-provenance.json \
     --out .forever-build/candidate-bindings.json
   ```

6. **Run the strict EXACT-fingerprint preflight, before anything else is
   checked:**

   ```
   npm run release:verify-bindings -- \
     --live .forever-build/live-bindings.json \
     --candidate .forever-build/candidate-bindings.json \
     --release-provenance .forever-build/worker-version-provenance.json
   ```

   It passes only when both snapshots satisfy the closed schema, the live
   snapshot UUID equals `previousWorkerVersionId`, the candidate snapshot UUID
   equals `candidateWorkerVersionId`, the canonical release-identity validator
   proves the candidate differs from the previous Worker, every live binding is
   present, no binding was added, no class changed, no name is duplicated, the
   counts are equal, and **the two fingerprints are EQUAL** — name and class for
   every binding, values never read.

7. **Reject any identity or binding mismatch.** A reused snapshot, a retained
   older Worker, a candidate missing any binding, carrying any extra binding,
   or whose fingerprint differs by a single name or class is REJECTED here, at
   0%, and the release STOPS. Surviving secrets do not prove the plain-text
   variables survived; see §2a. Only when step 6 reports both
   `workerVersionIdentityOk: true` and `BINDINGS_PRESERVED` does preview
   acceptance begin.

8. **Verify the candidate on its own version preview URL.** The preview URL
   (`<version-prefix>-<worker-name>.<subdomain>.workers.dev`) exercises that
   specific version, including its own asset set. Confirm the version-prefix in
   that URL belongs to the candidate UUID recorded in step 4. **Any 5xx on a
   public route is a stop** — a candidate that returns 500 is never cut over.
9. **Validate the full transitive route-chunk graph** on the candidate: crawl the
   documents, collect every `/assets/*` reference transitively, and require
   HTTP 200 for all of them. A single 404 here is a stop.
10. **Validate stale VERSION_A → VERSION_B recovery locally** with the two-version
    harness (`scripts/studio/stale-asset-harness/`): baseline, one automatic
    reload, no loop when the new version is still broken, no reload for ordinary
    errors, and no mutation resubmission.
11. **Confirm the observability CONFIGURATION. Candidate logs are N/A at this
    stage — see §6.** `observability.enabled` is `true` with
    `head_sampling_rate: 1` in `wrangler.jsonc`; confirm it survived into
    `.output/server/wrangler.json`. **That configuration check is the whole of
    what this stage can prove.** Workers Logs, `wrangler tail` and Logpush are
    ALL unavailable for a versioned Preview URL — Cloudflare documents this, and
    no token, permission, binding or setting changes it.

    **THE ABSENCE OF CANDIDATE LOG EVIDENCE IS NOT EVIDENCE THAT THE CANDIDATE
    RAN CLEANLY.** No release report may record "no errors in logs", "logs
    clean", or any equivalent, for a candidate at this stage. The only honest
    record is `preview logs: UNSUPPORTED (N/A — platform limitation)`.

    Log verification is possible EARLIER than the cutover, at step 11b, using
    Cloudflare's documented Version Overrides mechanism — see §6. Step 16b
    remains a required post-cutover acceptance check but is NOT the first
    possible candidate-log stage.

    The sampling rate is a PERMANENT setting, not a temporary elevation — see §7.

    11b. **Pre-cutover version-override smoke and log gate — SEPARATELY
    AUTHORIZED (§6 A1–A3), AND MANDATORY BEFORE A4.** The A1–A3 mutations each
    require their own Owner authorization and are never implied by this
    document. What is NOT discretionary is the consequence: **step 11b must
    reach the exact final status `PASS` before the A4 cutover may be
    requested.** Include the candidate in the active deployment at **0% while
    the previous version stays at 100%** (A1), re-verify bindings AND deployment
    membership against the live Worker afterwards, re-read `script-settings` to
    confirm observability is actually live, then send the COMPLETE named,
    non-mutating `GET`/`HEAD` probe set with
    `Cloudflare-Workers-Version-Overrides: forever="<candidate-uuid>"` on every
    request (A2), and read the resulting logs attributed to that exact UUID
    (A3). **Normal production traffic stays entirely on the previous version
    throughout.** A 5xx or a candidate release error here is a STOP, not a
    rollback — traffic has not moved.

    **Every non-`PASS` outcome blocks A4.** If the gate is not authorized, or
    observability is not live, or the logs cannot be read, or no log event
    carries the candidate UUID, the honest status is `DECLINED BY OWNER` or
    `NOT VERIFIED` — and either one means
    `GATE DECLINED — RELEASE REMAINS BLOCKED BEFORE CUTOVER`. Neither is a
    waiver, neither may be carried into an A4 authorization as an accepted
    risk, and no Owner decision converts either into permission to cut over.
    The release halts and the state-2 deployment is reverted to the previous
    version alone at 100%. The full blocking list is in §6.

    **Do not perform A1 until A2 and A3 are proven operationally available and
    separately authorized** — §6 states the pre-A1 evidence required. Creating
    the state-2 deployment while already knowing the candidate's logs cannot be
    read produces a deployment mutation that can only ever end in
    `NOT VERIFIED`, and is forbidden.

    **A browser session against the candidate is NOT part of this step.** It is
    unavailable for the ordinary Owner browser acceptance session under
    Forever's current workers.dev-only architecture, because normal navigation
    and automatically requested subresources do not carry the override header —
    §6 proves the mechanism and states the scope of that claim.

12. **Obtain an explicit, short Owner Studio hold.** Required for the first
    bootstrap release — see §4. The Owner is told the window and told to take no
    Studio action during it.
13. **The Owner closes or refreshes the existing Studio tab and performs no
    action.** No upload, no publication, no Retry, no member change, no password
    change.
14. **Atomic cutover.** Move to old 0% / new 100% in ONE `wrangler versions
deploy` invocation. No intermediate percentage. **The starting point is §6
    state 2 — the candidate present in the deployment at 0% with step 11b
    recorded as `PASS`.** Cutting over from §6 state 1 is out of contract: the
    hard gate in §6 requires A1, A2 and A3 to have completed and step 11b to
    read `PASS` before A4 exists as an option, and a candidate that was never in
    the deployment cannot have produced that evidence. The invocation itself is
    a single step and is not a gradual rollout. Run `--dry-run` first and
    confirm the exact source and
    target **Worker version UUIDs** — the target must be the candidate UUID
    recorded in step 4, and the source must be the previous UUID recorded in
    step 4.
    14a. **Watch the asset-404 rate for the first minutes after cutover.**
    Cloudflare's own gradual-rollout guidance names an increased 404 rate on
    asset files as the signal that clients are requesting assets the active
    version does not have. It is the one cheap server-side signal that would
    have surfaced the PR #134 incident, and it is checked here, on the Worker's
    analytics, before the acceptance gate. A rising asset-404 rate is a
    rollback trigger, not a curiosity.

15. **Verify public routes.** The full public probe set: `/`, `/projects`,
    `/sitemap.xml`, `/robots.txt`, the deleted-legacy-route 404 contract and the
    `/media/*` generic 404 contract. Zero 5xx.
16. **Verify the deployed WORKER VERSION, by UUID.** `wrangler deployments list`
    must show the candidate Worker version UUID recorded in step 4 holding 100%
    of traffic. **This is the release gate.** It is the only step that proves
    which Worker is deployed, and no client-side value can stand in for it.
    16a. **Verify the full current asset graph** on the live origin, transitively,
    including the authenticated Studio chunk graph reachable from `/studio`.
    Also confirm `/forever-client-assets.json` reports the `CLIENT_ASSET_ID`
    this candidate was built with. **This checks client asset compatibility, not
    the release.** For a server-only release it will report the SAME value as
    before the cutover, and that is the expected, correct answer — it is
    therefore never treated as evidence that the cutover happened. Step 16 is.
    16b. **Verify Workers Logs after the cutover. REQUIRED.**
    This is the stage at which the candidate's REAL production traffic is
    logged. It is **not** the first stage at which candidate logs can exist —
    step 11b is (§6) — and it is required IN ADDITION to step 11b, which must
    already have been recorded as `PASS` for this step to be reachable at all.
    Confirm `observability` is live on the Worker, then read
    the Worker's logs for the cutover window — dashboard Workers Logs, or
    `wrangler tail --version-id <candidate-uuid>` against the deployed Worker.
    Require: logs are ACTUALLY RETURNED (an empty result is "not verified", not
    "clean"), and no candidate release error appears — in particular no
    `Missing Supabase environment variable(s)` and no unhandled exception.
    **A failure here is a rollback trigger under §5, not a note.** If logs
    cannot be read at all, the release is NOT accepted: hold at §5 rollback
    readiness and obtain an Owner decision before proceeding to step 17.
17. **The Owner opens Studio fresh and confirms the authenticated dashboard
    renders.** This is the acceptance gate. Asset-level checks cannot replace it.
18. **Roll back immediately if the authenticated check fails.** Reallocate
    traffic to the previous Worker version UUID recorded in step 4 at 100% — an
    existing immutable version, no rebuild, no new version. Verify public routes
    and the asset graph again afterwards.

**Do not begin Coralina repair or any Retry in the release task.** Both require
their own Owner authorization and their own task.

---

## 2a. `--keep-vars`, AND WHY SURVIVING SECRETS PROVE NOTHING

Corrected by `FOREVER-WRANGLER-KEEP-VARS-CORRECTION-001` after a candidate
uploaded from exact merged main lost two production bindings.

### What happened

Candidate `ae4cae19` was built from exact merged main `bbf698d2`, self-verified,
and passed every local gate. Cloudflare returned it carrying **10 bindings where
the live Worker `fb4bf6d7` carried 12**. The two missing were the
deployment-managed plain-text variables:

- `SUPABASE_URL`
- `STUDIO_STORAGE_WRITE_PROVIDER`

Its preview returned **HTTP 500** on `/` and `/projects`:
`Missing Supabase environment variable(s): SUPABASE_URL`.

**This was a safe pre-cutover finding, not a production incident.** The
candidate was held at 0%, the preview check caught it before any Owner hold was
requested, production traffic never moved, the live Worker stayed at 100%, and
Coralina remained contained. The 0%-candidate discipline in §2 is what turned a
site-wide outage into a rejected artefact.

### Why Wrangler removed them

Cloudflare documents `--keep-vars` identically for `versions upload` and
`deploy`:

> When not used (or set to false), Wrangler will delete all vars before setting
> those found in the Wrangler configuration. When used (and set to true), the
> environment variables are not deleted before the deployment. If you set
> variables via the dashboard you probably want to use this flag. Note that
> secrets are never deleted by deployments.

**The default is `false`.** `wrangler.jsonc` declares no `vars` block — so the
effective instruction was "delete all vars, then apply the none I declared".

`wrangler.jsonc`'s own schema states the same: "If you change your vars in the
dashboard, wrangler _will_ override/delete them on its next deploy."

### Two halves, both required

§3 has always forbidden a `vars` block, because declaring one would **replace**
the deployment-managed values. That is correct and it was never sufficient:

| Failure mode                       | What prevents it        |
| ---------------------------------- | ----------------------- |
| repository **overwrites** the vars | declaring **no** `vars` |
| Wrangler **deletes** the vars      | **`keep_vars: true`**   |

The earlier runbook had the first and read as though it had both. Forever now
carries **both, plus the explicit flag** — three independent defences:

1. `wrangler.jsonc` sets `keep_vars: true`, which Nitro propagates into
   `.output/server/wrangler.json`;
2. the production upload is a **structured argument vector**, not a shell
   string, and `--keep-vars` is verified as an exact token — see §2b;
3. the fail-closed preflight (`npm run release:verify-bindings`) refuses a
   candidate whose binding fingerprint is not EQUAL to the live Worker's, on
   snapshots captured **mechanically** from Cloudflare rather than written by
   hand.

---

## 2b. THE UPLOAD IS A STRUCTURED COMMAND, AND A SUBSTRING IS NOT PROOF

Added by `FOREVER-PR138-MERGE-BLOCKER-CORRECTION-002` after an independent
review of the correction above returned **CHANGES_REQUIRED**.

The first correction pinned the upload as text and validated it by asking
whether the text contained `--keep-vars`. An independent review executed
fourteen adversarial commands against that check. **Ten commands that DELETE
deployment-managed variables were accepted**, including:

| Accepted, and does not preserve          | Why it passed a substring test |
| ---------------------------------------- | ------------------------------ |
| `--keep-vars=false`                      | contains `--keep-vars`         |
| `--keep-vars false`                      | contains `--keep-vars`         |
| `--no-keep-vars`, `--keep-vars-disabled` | contains `--keep-vars`         |
| a trailing `# --keep-vars` comment       | contains `--keep-vars`         |
| a decoy argument carrying the substring  | contains `--keep-vars`         |
| text after a `--` terminator             | contains `--keep-vars`         |
| `echo '--keep-vars'`                     | contains `--keep-vars`         |
| `wrangler deploy …`                      | contains `--keep-vars`         |
| a wrong or missing `--config`            | never checked at all           |

Cloudflare's own wording — _"When not used (**or set to false**)"_ — makes
`--keep-vars=false` precisely the deleting invocation that produced `ae4cae19`.
Editing this runbook to it left every assertion green.

**So there is no command string any more.** The upload is one canonical
specification, held as data in
`src/lib/stale-asset/worker-variable-preservation.ts`:

```
PRODUCTION_VERSION_UPLOAD_SPEC = {
  executable: "wrangler",
  args: ["versions", "upload", "--keep-vars", "--config", ".output/server/wrangler.upload.json"],
}
```

- **`--config` names the EPHEMERAL upload specification, never the immutable
  build output.** This block published `.output/server/wrangler.json` until the
  second independent review of PR #140 caught it. That path is the immutable
  generated configuration, which declares neither deployment-managed plain-text
  binding, so an upload performed with it produces the 10-binding shape both
  rejected candidates came back with. `verifyUploadSpec` refuses it by name with
  `wrong_config_path`, and mutation control 29 exists to keep it refused — so
  the published argv was one the release tooling would have rejected outright.
  See §2c;
- the command printed in §2 step 4 is **derived from** that specification, so
  documentation and execution cannot drift apart. The assertion that pins this
  block now derives the argv from `PRODUCTION_VERSION_UPLOAD_SPEC` rather than
  restating it, because a retyped copy is exactly how the two drifted apart;
- `npm run release:upload-version` is the only thing that spawns Wrangler, and
  it spawns exactly those arguments with **`shell: false`** — nothing is
  concatenated, quoted, split or word-expanded, so there is no text for a shell
  to reinterpret;
- every argument is compared token by token; anything that is not the canonical
  vector is refused with a NAMED reason;
- the wrapper resolves Wrangler explicitly and requires the **exact supported
  version**. It never falls back to a PATH lookup, so a release is never
  performed by whichever Wrangler happens to be installed;
- the wrapper runs the pre-upload preflight FIRST and refuses to spawn Wrangler
  unless it produced `PREUPLOAD_EXPLICIT_BINDINGS_OK` — the marker named in §2
  step 3 and §2c. This bullet named one of the two superseded markers listed
  there until the second independent review of PR #140 caught it. Neither is
  emitted any more, so the gate this section described could not have been
  observed by an operator watching for it.

**Never hand-write a binding snapshot.** The preflight's inputs are produced by
`npm run release:capture-bindings`, which reads
`result.resources.bindings` from Cloudflare's documented version-detail
endpoint and writes only `{ name, type }`. Cloudflare returns `plain_text` as
`{ name, text, type }` and `text` is the production value, so the raw response
is never written, never logged and never quoted in an error. An unrecognised
binding type is a STOP, never an omission. A snapshot transcribed by hand
records what the operator expected and makes the comparison confirm itself —
which is the same false assurance §2a exists to remove.

The deployment plane remains the **source of truth** for both values. The
repository never carries them, never names them in a `vars` block, and never
moves `SUPABASE_URL` into a client-visible variable.

### Surviving secrets are NOT evidence

**Secrets are never deleted, with or without the flag.** A candidate can show
all six secret bindings intact while every plain-text variable has been removed
— which is exactly what `ae4cae19` looked like. Any check that reasons "the
secrets are still there, so the environment survived" is measuring the one thing
that could not have failed.

Therefore, before preview acceptance:

- **the candidate's binding fingerprint must EQUAL the live Worker's** — name
  and class for every binding, values never read;
- **a candidate carrying fewer bindings than the live Worker is REJECTED**, even
  though it holds 0% of traffic and harms nothing where it sits;
- **never cut over a candidate that returns 500, or that lacks either
  `SUPABASE_URL` or `STUDIO_STORAGE_WRITE_PROVIDER`** — no percentage, no
  "verify it after", no exceptions.

A rejected candidate is left at 0%. It is not deleted, and it is not modified;
it is evidence.

---

## 2c. INHERITANCE DOES NOT WORK HERE — THE TWO BINDINGS ARE DECLARED EXPLICITLY

Corrected by `FOREVER-STUDIO-EXPLICIT-BINDINGS-FIX-002` after the single
authorized upload of the PR #139 candidate was refused by Cloudflare.

§2a established that omitting `--keep-vars` deletes deployment-managed
variables. That is true and was never the whole story: candidate `3540bc64`
passed `--keep-vars` correctly and still came back with ten bindings, because
generic inheritance resolves against the LATEST UPLOADED version and the latest
uploaded version was by then the failed 10-binding `ae4cae19`.

PR #139's answer was to name the inheritance source explicitly — two `inherit`
records pinned by `version_id` to the verified 12-binding live version. **The
production API refuses that**, and the release path no longer contains it.

### What the upload actually returned

One authorized upload, at 0%, with `--keep-vars` and both pinned records:

```
POST /accounts/{account_id}/workers/scripts/forever/versions  ->  HTTP 400

  inherit binding 'STUDIO_STORAGE_WRITE_PROVIDER' is invalid: 'version_id'
  value '<live-version-uuid>' is invalid, only the literal 'latest' is
  supported by this API [code: 10057]

  inherit binding 'SUPABASE_URL' is invalid: 'version_id' value
  '<live-version-uuid>' is invalid, only the literal 'latest' is supported by
  this API [code: 10057]
```

Everything before that call succeeded: the Worker settings and secrets reads,
the asset-upload session, three asset uploads (26 files) and the settings read.
**No Worker version was created**, no deployment record changed, and the live
version kept 100% of traffic. The failure is confined to version creation, and
specifically to the binding records.

**Token permissions are NOT the cause, and this is measured rather than
assumed.** The same credential performed the asset uploads — genuine writes —
immediately before the refusal, and the refusal is a request-body validation
code, not `10000`/HTTP 403. A release stopped by permissions looks nothing like
this.

### The documentation / runtime contradiction

Cloudflare's published schema for the Upload Version API may still describe a
version UUID as an accepted value for an `inherit` binding. **The production API
rejects it.** Where a schema and a measured production response disagree, this
repository follows the measured response.

UUID inheritance is therefore **not** restored on the strength of the schema,
and the mechanism is **not** retained as a fallback. A fallback to a form the
API refuses is not a safety net; it is an outage waiting for the first failure.
If Cloudflare later makes pinned inheritance work, that is a new task with its
own measurement — not a revert.

**What PR #139's offline proof actually proved.** It ran the repository-locked
Wrangler against a loopback mock and asserted the multipart metadata Wrangler
emits. That was real, and it measured WRANGLER. It could not measure
CLOUDFLARE, and §2c said so at the time: the surrounding claim was labelled "a
high-confidence inference, NOT a proven Cloudflare guarantee". The inference was
wrong in the one place no local proof could reach. **That inherit proof is
deleted** — it defended a mechanism the API refuses — and it is not referenced
anywhere as current evidence.

**An equivalent proof exists for the mechanism that replaced it.**
`src/lib/stale-asset/wrangler-plain-text-serialization.test.ts` runs the same
repository-locked Wrangler, against a loopback listener, under the same
process-level network guard and the same constructed child environment, and
reads the multipart metadata Wrangler emits for the two explicit records. It
proves exactly two `plain_text` records with the right names carrying the values
the specification supplied, **zero** `inherit` records, and no duplicate name.
Dropping it along with the inherit proof would have left the new mechanism
resting on inspecting the configuration this repository writes — which is the
same gap the superseded PREUPLOAD contract had.

**And it carries the narrower claim the previous one should have carried.** It
is evidence about WRANGLER's serialization only. It says nothing about what
Cloudflare accepts, it cannot, and it is never cited as though it did.
Post-upload capture and comparison — §2 step 6 — remain the only evidence of
what the API actually produced.

### Why `"latest"` is prohibited, even though it is the only accepted value

`"latest"` resolves to the most recently uploaded version, and traffic
allocation does not influence it — a version sitting at 0% is a perfectly
eligible source. Today the newest uploads are, in order, the rejected
10-binding candidates. Inheriting from `"latest"` would reproduce the exact
incident this runbook exists to prevent.

### Why deleting the newer candidates is NOT the answer

Making `"latest"` point at the right version by deleting the rejected 0%
candidates is rejected on three counts:

1. **They are evidence.** `ae4cae19` and `3540bc64` are the measured record of
   two distinct failure mechanisms. §2b's rule — a rejected candidate is left at
   0%, not deleted and not modified — exists for this reason.
2. **It makes correctness depend on deletion.** A release that is only safe
   while no newer version exists is not safe; it is untested. The next upload
   from any source silently re-arms the defect.
3. **It is a destructive production action** taken to work around a limitation,
   which is exactly the class of change a release must not make.

### The mechanism that replaced it

Both deployment-managed variables are declared **explicitly**, as `plain_text`
bindings, in the ephemeral upload specification:

```json
[
  { "name": "SUPABASE_URL", "type": "plain_text", "text": "<release input>" },
  {
    "name": "STUDIO_STORAGE_WRITE_PROVIDER",
    "type": "plain_text",
    "text": "<release input>"
  }
]
```

- **Nothing is inherited, so nothing depends on the upload history.** The
  release stops being sensitive to which version Cloudflare considers latest,
  which removes the entire failure class rather than steering around it;
- **zero `inherit` records is a gate, not a convention.** Any `inherit` record,
  `"latest"` or a version UUID, is a named STOP in both the value-aware and the
  value-free contract;
- **`--keep-vars` is retained as documented secondary protection** for the six
  secrets and the other supported categories. It is not the mechanism these two
  bindings depend on;
- **a `vars` block remains prohibited.** `vars` and explicit bindings are two
  ways to say the same thing and Wrangler does not merge them; exactly one
  mechanism is used.

### Where the values come from, and where they must never appear

**The repository does not contain these values and is not going to.** They are
deployment-plane values; nothing in the release path hardcodes, defaults,
guesses or reconstructs either one. They are supplied per release through
release-scoped environment inputs:

| Binding                         | Release input                                   | Accepted values                                                                |
| ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `SUPABASE_URL`                  | `FOREVER_RELEASE_SUPABASE_URL`                  | absolute `https` ORIGIN — no credentials, query, fragment or path              |
| `STUDIO_STORAGE_WRITE_PROVIDER` | `FOREVER_RELEASE_STUDIO_STORAGE_WRITE_PROVIDER` | exactly `supabase` or `r2`, from `src/features/forever-studio/studio-types.ts` |

The names are deliberately NOT the runtime variable names. Those may well be
exported in a developer's shell, and a release must never ship a development
value because it happened to be in the environment.

**THERE IS NO DEFAULT.** `STUDIO_STORAGE_WRITE_PROVIDER` has a documented
RUNTIME default of `supabase` for a deployment that has not been configured yet.
Applying that default during a RELEASE would silently reconfigure production
storage in a release that was supposed to change nothing, so an absent input is
a STOP. The provider contract is imported from `studio-types.ts` rather than
re-listed, so Studio and the release path cannot disagree about what a valid
provider is.

**A value may never appear in** console output, an error message, a test
snapshot, a provenance receipt, a committed fixture, a GitHub PR description, or
a hash that would disclose a low-entropy value. Concretely:

- the PREUPLOAD preflight runs in a **separate process** and is handed a
  VALUE-FREE projection — names and classes only;
- the specification digest is **salted with a per-release secret** held only in
  the wrapper's memory. `STUDIO_STORAGE_WRITE_PROVIDER` has two possible values,
  so a bare SHA-256 of a document whose every other byte is knowable would be a
  two-guess oracle. The digest proves integrity; it is not content-addressable
  and is not reproducible later, on purpose;
- values are refused on the command line — argv is world-readable and lands in
  shell history;
- every refusal names the BINDING and the RULE, never the value that broke it.

### Exactly which process holds what

Stated as facts rather than as an impression, because the previous wording read
as though nothing anywhere held a value, and both children were in fact being
handed the release-input variables:

1. **The wrapper process DOES hold both release inputs**, from the moment it
   reads them until the ephemeral specification has been built and verified. It
   is the one process permitted to, and it is the only one.
2. **The PREUPLOAD child does NOT.** `FOREVER_RELEASE_SUPABASE_URL` and
   `FOREVER_RELEASE_STUDIO_STORAGE_WRITE_PROVIDER` are **deleted from its
   environment** before it is spawned, so "this process was never given a value"
   is a property of the process and not merely of the code path it took.
3. **The Wrangler child does NOT either.** Both keys are deleted from its
   environment as well. Wrangler receives the two values through **exactly one
   channel** — the verified ephemeral specification named by `--config`. This
   matters concretely: Wrangler resolves `${VAR}`-style references and reads
   `.env`/`.dev.vars`, so an environment copy would be a real second source that
   nothing in this contract verifies.
4. **The specification is deleted once the launcher returns or throws.** The
   removal is in a `finally`, so a successful upload, a non-zero Wrangler exit
   and an exception all reach it. If removal itself fails, the wrapper says so
   loudly and names the file as one that carries values.
5. **A lost exclusive-create race is the same fail-closed STOP.** If a
   concurrent release creates that path between the wrapper's existence check
   and its exclusive create, the other run's file is neither overwritten nor
   deleted, this run's temporary directories are cleaned, and Wrangler is never
   spawned.

Both child-environment facts are proven behaviourally rather than asserted:
`release-child-environment.test.ts` spawns real child processes with the
environments the production builders produce and has them report their own
environment back, and `release-binding-preflight.test.ts` runs the real wrapper
end-to-end and observes the actual PREUPLOAD child.

### Configuration inspection is not enough — and neither is a digest

The superseded PREUPLOAD contracts each checked something true and insufficient:
argv tokens and `keep_vars: true`, then a pinned inheritance source. What is
proved now is the **shape of the result** — the binding set the upload will
produce — plus a re-proof at the last possible moment:

- **at PREUPLOAD**, against the value-free projection: zero inherit records, the
  ten preserved bindings present, both explicit plain-text bindings present as
  `plain_text`, no duplicate name, no `vars` block, exactly twelve total, and a
  live snapshot that is itself the verified twelve;
- **at spawn**, against the real bytes on disk: the salted digest still matches
  AND the document is re-parsed and re-checked against the full contract. A
  digest alone proves the file did not change; re-parsing proves the file that
  did not change is still the right file.

### This does not replace post-upload verification

Explicit bindings make the upload independent of Cloudflare's inheritance
resolution. They do not prove the result. **After the upload, the candidate must
still be captured and proved to carry exactly twelve bindings before any
deployment authorization is offered** — §2 step 6, unchanged. A candidate that
cannot be proved equivalent stays at 0%.

### Owner setup required before the next upload attempt

The next candidate upload will STOP at gate 3 unless both release inputs above
are exported in the shell that runs it, alongside the Cloudflare credentials the
capture step already requires. Nothing else changed: the same
`release:capture-bindings` → dry run → single authorized upload sequence
applies.

**No cleanup is required for this correction.** The two rejected candidates stay
where they are, at 0%, as evidence — §2b. The 26 asset blobs the refused upload
staged into the account's asset store belong to an upload session that never
became a version; nothing references or serves them, and deleting them is not
part of this or any release step.

---

## 2d. RELEASE CHECK MAPPING — WHAT RUNS, AND WHAT IS N/A

Added by `FOREVER-PR140-CORRECTIONS-002`. Every gate a release claims is listed
here with the command that produces it, so a claim in a PR description can be
checked against a command rather than taken on trust.

| Check                          | Command                                                                        | Status                                    |
| ------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------- |
| production build               | `npm run build`                                                                | required                                  |
| full test suite                | `npx vitest run`                                                               | required                                  |
| release binding preflight      | `npm run release:verify-bindings`                                              | required                                  |
| Wrangler identity gate         | `npm run release:wrangler-gate`                                                | required                                  |
| mutation controls (49)         | `npm run release:keep-vars-mutations`                                          | required                                  |
| offline Wrangler serialization | `npx vitest run src/lib/stale-asset/wrangler-plain-text-serialization.test.ts` | required                                  |
| network containment            | `npx vitest run src/lib/stale-asset/release-network-containment.test.ts`       | required                                  |
| lint                           | `npx eslint <changed files>`                                                   | required, scoped — see below              |
| formatting                     | `npx prettier --check <changed files>`                                         | required, scoped                          |
| candidate preview log check    | —                                                                              | **N/A — platform limitation, see §6**     |
| pre-cutover candidate log gate | step 11b, Version Overrides — see §6                                           | **required — must read `PASS` before A4** |
| repository CI                  | `quality-gate` on the pull request                                             | required                                  |
| `actionlint`                   | `actionlint` inside `quality-gate` (pinned, checksum-verified)                 | required — enforced in CI                 |

### `candidate preview log check: N/A — the platform cannot emit it`

**This N/A is not a waiver and is not discretionary.** Cloudflare excludes
Workers Logs, `wrangler tail` and Logpush for Preview URLs, so there is no
command that produces this evidence at the candidate-upload stage — see §6. It
is listed here so a release report states it explicitly rather than omitting it,
and so the omission can never be read as a check that passed.

**An N/A here is not a green check.** It means the evidence does not exist for
the PREVIEW URL, not that the candidate is healthy, and not that no earlier log
evidence is obtainable. The gate is not cancelled and it does not move to after
the cutover: it is satisfied at **step 11b**, before the cutover, using Version
Overrides against a candidate included in the deployment at 0% — see §6. Step
16b is an additional post-cutover acceptance check, not the first opportunity.

### `pre-cutover candidate log gate (step 11b): required — must read PASS before A4`

This row exists so a release report cannot omit the gate by never mentioning it.
Its only honest values are `PASS`, `STOP`, `NOT VERIFIED` or
`DECLINED BY OWNER`. It is not `N/A`: the mechanism exists, and its recorded
value is a release fact rather than an absence.

**Only `PASS` permits the A4 cutover authorization.** `STOP`, `NOT VERIFIED` and
`DECLINED BY OWNER` are all honest, reportable outcomes and all three are
BLOCKING. `DECLINED BY OWNER` is not a waiver: it is recorded, in full, as

    GATE DECLINED — RELEASE REMAINS BLOCKED BEFORE CUTOVER

The A1–A3 mutations are individually discretionary — the Owner may decline to
authorize them. What the Owner cannot do is decline the gate and cut over
anyway. Declining the gate declines the release, not the gate's authority.

### The `actionlint` waiver is VOID, and the check now RUNS

This section previously carried an owner-approved N/A waiver for `actionlint`,
valid only while the repository held no workflow files.
**It expired exactly as it was written to expire:**
`FOREVER-DEVELOPMENT-PROCESS-001` added `.github/workflows/quality-gate.yml`, so
there is now something for `actionlint` to lint. The superseded wording is
deliberately not reproduced here — the current state is the only state.

**`actionlint` is now ENFORCED by `quality-gate`.**
`FOREVER-ACTIONLINT-GATE-001` closed the gap the expired waiver left, inside the
one canonical gate — not in a second workflow and not in a second job. On every
pull request and every push to `main`, `quality-gate` downloads the official
`rhysd/actionlint` `v1.7.12` Linux AMD64 release archive into `$RUNNER_TEMP`,
verifies it against the published SHA-256
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8` **before**
extracting or executing it, and lints **every** file under `.github/workflows` —
with no file arguments, so a workflow added later cannot arrive unlinted. The
lint runs **before** `npm run verify:ci`, so a broken workflow fails in seconds
rather than after the full gate.

**Nothing about that install is taken on trust.** No `latest` tag, no unpinned
remote installer script piped into a shell, and no unverified binary: an archive
whose digest does not match the pin fails the job instead of being executed.

`npm run process:check` holds the step to that shape, so it cannot be weakened
while this document still claims it. The checker fails if the step is removed;
if the version pin or the digest pin is dropped, or the download stops being
derived from the pin; if the checksum check is removed, or moved after the
archive is extracted or executed; if the lint is moved after the canonical
verification; or if the lint is **neutered** — reduced to a `-version` print,
narrowed to named files (which would exclude a workflow added later), or given
`continue-on-error`, `|| true`, `set +e` or a step-level `if:` so its exit code
stops failing the job.

**The workflow was not created to satisfy a linter.**
`quality-gate` exists to run `npm run verify:ci` on every pull request and every
push to `main`. The waiver's expiry is a consequence of that, not its purpose.

**A status check is evidence only when it ran.**
This repository now publishes exactly one check, `quality-gate`. A check that is
queued, skipped or absent is never presented — in a PR description, a release
report or a review summary — as a check that passed; an empty or pending check
list means "nothing ran". Every other gate in the table above is a LOCAL command
whose output is the evidence; if a report claims a gate held, it names the
command and quotes the result.

### Why lint is scoped rather than repository-wide

`npm run lint` runs `eslint .` from the repository root, and this checkout has
sibling worktrees and scratch trees physically located beneath it (`.codex/tmp`,
`.forever-factory/worktrees`, and others). A repository-wide lint therefore
traverses unrelated checkouts and reports findings that belong to other
branches. That is an environmental limitation of this working copy, **not** a
reason to edit the ESLint configuration: changing shared configuration to
accommodate one machine's directory layout would weaken the check for everyone.

The release therefore lints the changed files explicitly — `npx eslint` with
each changed source, test and documentation-supported file named — and reports
the limitation alongside the result.

---

## 3. What must never be part of a release step

- No percentage rollout while version affinity is absent (§0).
- No migration applied or reverted as part of a cutover.
- No `retryable` change, no Coralina row repair, no Retry, no re-upload.
- No credential rotation, no R2 or Supabase Storage mutation.
- No binding removed. The deployed Worker carries twelve bindings: four declared
  by this repository (`ASSETS`, `R2_PRIVATE_SOURCES`, `R2_PUBLIC_MEDIA`,
  `R2_PROJECT_ARCHIVES`), two deployment-managed plain-text variables
  (`SUPABASE_URL`, `STUDIO_STORAGE_WRITE_PROVIDER`) and six deployment-managed
  secrets. `wrangler.jsonc` declares **no** `vars` block on purpose — declaring
  one would replace the deployment-set values — **and** sets `keep_vars: true`,
  without which Wrangler deletes those undeclared variables before applying the
  configuration. Both are required; see §2a for the candidate that proved it.

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
  closure hold** (steps 12–13), or a separately approved compatibility bridge.
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
4. **The rollback target is verified BY WORKER VERSION UUID**: it is the exact
   immutable previous Worker version UUID recorded in step 4 of §2, it is an
   existing version in `wrangler versions list`, and it is **not** the invalid
   pre-R2 Worker `9919f28c`.

   **The rollback target is never selected or confirmed by `CLIENT_ASSET_ID`.**
   For a server-only release the previous and current client asset identities
   are EQUAL, so "roll back to the version whose client asset identity is X"
   does not identify a version at all — it identifies two of them, or none. If
   the previous Worker version UUID was not retained, the rollback STOPS and the
   version is re-established from `wrangler versions list` before anything
   moves. A rollback aimed at a version that was inferred rather than recorded
   is not a rollback.

```
wrangler versions deploy --name forever --version-id <previous-worker-version-uuid> --percentage 100
```

Run `--dry-run` first and confirm the exact source and target Worker version
UUIDs.

**The rollback itself is ATOMIC.** One invocation, old 0% / previous 100%. No
intermediate percentage, no partial rollback, no 5% → 25% step — the
version-affinity prohibition in §0 applies identically in this direction.

**After the rollback:**

5. **Verify the rolled-back WORKER VERSION, by UUID.** `wrangler deployments
list` must show the exact previous Worker version UUID from step 4 holding
   100% of traffic. **This is the rollback gate.**
   5a. **Verify the full old asset graph** on the live origin, transitively,
   including the authenticated Studio chunk graph reachable from `/studio`.
   `/forever-client-assets.json` is checked for client asset compatibility only;
   for a server-only release it reports the SAME value in both directions, so it
   can never confirm that the rollback happened. Step 5 does.
6. **Verify public routes**, the migration ledger and Coralina containment.
7. **The Owner opens Studio FRESH and confirms the authenticated dashboard
   renders.** This is the rollback acceptance gate, exactly as it is the forward
   one. Asset-level checks cannot replace it.

**Never during a rollback:** no Coralina repair, no Retry, no re-upload, no
migration, no `retryable` change, no credential rotation.

The R2 rollback boundary in `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md` still applies:
once an R2 job exists, the pre-R2 Worker is not a valid rollback target.

---

## 6. CANDIDATE LOG VERIFICATION — THE FIVE STATES, AND WHICH ONE CAN BE LOGGED

Added by `FOREVER-PR140-PREVIEW-LOG-GATE-REPAIR-005` after a release report
recorded PASS while stating that the mandatory Workers Logs verification had not
been completed. Both halves of that were wrong: a required gate that did not
hold is not a PASS, and the gate itself was **impossible to satisfy as written**.

**Corrected by `FOREVER-PR141-PR142-EVIDENCE-REVIEW-CORRECTIONS-007`.** The
first revision of this section drew the right conclusion about Preview URLs and
then the WRONG conclusion about everything after them: it stated that the first
technically valid stage for candidate logs is after the atomic cutover. That is
false. Cloudflare documents a pre-rollout smoke-test mechanism — **Version
Overrides** — that invokes a candidate sitting at 0% inside the current
deployment, and those invocations are ordinary, observable Worker invocations.
The corrected lifecycle is below, and it is expressed as **five distinct
states**, because the earlier text collapsed three of them into one phrase
("candidate at 0%") and reasoned about the merged thing.

### The five states, kept apart

Everything in this section depends on not confusing these. They are NOT degrees
of the same thing; they differ in what the platform will do.

| #   | State                                                                   | Candidate reachable how                                          | Normal production traffic | Candidate logs obtainable?                                |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- | --------------------------------------------------------- |
| 1   | **Uploaded, ABSENT from the active deployment**                         | versioned Preview URL only                                       | 100% previous version     | **No** — preview logging excluded; overrides inapplicable |
| 2   | **In the current deployment at 0%**, previous version at 100%           | Preview URL, **plus** the production origin via version override | 100% previous version     | Only once a request actually reaches it — state 3         |
| 3   | **Controlled requests carrying `Cloudflare-Workers-Version-Overrides`** | production origin, per request, by exact version UUID            | **still 100% previous**   | **Yes** — subject to the two prerequisites below          |
| 4   | **Normal production traffic during states 2–3**                         | never reaches the candidate                                      | 100% previous version     | n/a — the candidate is not serving it                     |
| 5   | **After the atomic cutover**, candidate at 100%                         | production origin, all traffic                                   | 100% **candidate**        | **Yes** — and now unavoidably                             |

**State 1 is where the PR #140 candidate is today.** It is not "at 0%". It holds
no percentage at all, because it is not a member of the current deployment.
Writing "candidate traffic: 0%" for state 1 was the conflation that produced the
wrong conclusion, and it is corrected in the status table at the end of this
section.

### What the platform actually does

Cloudflare documents the limitation directly, under Preview URLs → Limitations:

> You cannot view logs for Preview URLs today, this includes Workers Logs,
> Wrangler tail and Logpush.

— <https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/#limitations>

All three observation routes are excluded by name. **No API token, permission,
binding, sampling rate or configuration change makes preview logs appear.** A
release that waits for them waits forever.

The earlier revision of step 11 required confirming "that logs appear for the
candidate", and the candidate is reachable at that stage ONLY through its
versioned Preview URL. The step therefore demanded evidence the platform does
not emit.

**This was first misdiagnosed as a token-permission fault.** The release
environment's token does also lack Workers Observability read — the telemetry
query returns HTTP 403 `[code: 10000]` — and that is a real but SECONDARY fact.
Widening the token would not have produced a single log line. Recording the
token as the cause would have sent the next operator to fix the wrong thing.

### Uploaded-but-undeployed observability is DORMANT

Measured on the PR #140 candidate, read-only:

- `GET .../workers/scripts/forever/script-settings` reports
  `observability: null`, `enabled: false` — while the uploaded artefact's own
  `.output/server/wrangler.json` correctly declares
  `observability: {enabled: true, head_sampling_rate: 1}`;
- `GET .../workers/scripts/forever/versions/<id>` returns **no** `observability`
  field at all, for ANY version. Reading one there and concluding "disabled" is
  a measurement error; `script-settings` is the endpoint that reports it.

Observability is a **script-level** setting that Cloudflare applies on
**deploy** — the Workers Logs documentation instructs the operator to "redeploy
your Worker" for a change to take effect. A version upload creates an
immutable version; it does not change what the live script is doing. So the
candidate's observability configuration is correct AND dormant, simultaneously,
and there is no defect to fix in the repository.

### A 0% VERSION IS NOT AN UNINVOKABLE VERSION — the corrected finding

Workers Logs record **invocations**, and the earlier revision reasoned from that
to "0% means zero invocations, so there is nothing to log". **That inference is
WRONG, and Cloudflare refutes it in the first sentence of the Version Overrides
page:**

> You can use version overrides to send a request to a specific version of your
> Worker in the current deployment, even those set to serve 0% of traffic.

— <https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/>

The mechanism is a request header naming the Worker and the exact version UUID:

> To specify a version override in your request, set the
> `Cloudflare-Workers-Version-Overrides` header on the request to your Worker.

It has exactly one prerequisite, and Cloudflare states it as a caution:

> A version override will only be applied if the specified version is in the
> current deployment.

and, in the same caution:

> Workers currently only supports serving **two** different versions in one
> deployment. Follow the instructions for gradual deployments to ensure the
> requested version is in the current deployment. You can set the new version to
> 0% traffic to avoid normal traffic being routed to it.

Cloudflare then presents this as **its documented pre-rollout smoke test**, in a
section titled "Smoke test example":

> You may want to test a new version in production before gradually deploying it
> to an increasing proportion of external traffic. This is commonly referred to
> as a "smoke test". […] Create a new deployment using `wrangler versions deploy`
> and specify 0% for the new version whilst keeping the previous version at 100%.

And it states that the resulting invocation is attributable:

> You can observe the version of your Worker that was invoked using
> Observability, including in features such as Logpush.

Applying that to the five states, the corrected table is:

| State                                                   | Yields candidate logs?                 | Why                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — uploaded, ABSENT from the deployment, Preview URL   | **No**                                 | preview logging is excluded by name; and an override "will only be applied if the specified version is in the current deployment"       |
| 2 — in the current deployment at 0%, no override sent   | **No — but not because 0% forbids it** | nothing has invoked it yet; normal traffic is routed by percentage and 0% is never selected                                             |
| 3 — in the deployment at 0% **and** an override request | **YES**                                | the request reaches the candidate on the production origin; it is an ordinary invocation and Observability attributes it to the version |
| 4 — normal production traffic during states 2–3         | n/a                                    | routed entirely to the previous version at 100%; it never touches the candidate                                                         |
| 5 — after the atomic cutover, candidate at 100%         | **Yes**                                | the candidate is the deployed version and all invocations are its own                                                                   |

**`wrangler tail --version-id <candidate>` is re-classified, not re-refuted.**
It is still true that `--version-id` FILTERS the deployed Worker's stream and
cannot attach to a Preview URL, so it is useless in state 1. It is **useful in
state 3**: the candidate is then part of the deployed Worker, so the stream it
filters contains the candidate's override invocations.

**The corrected conclusion: state 3 is the FIRST technically valid stage for
candidate logs, and it is BEFORE the atomic cutover.** Post-cutover verification
(step 16b) remains required as an acceptance check, but it is no longer the
earliest possible stage and must never again be described as such.

### Version Overrides are NOT a percentage rollout — the distinction that matters

§0 prohibits a percentage rollout while version affinity is absent. That
prohibition is **not** a prohibition on state 2, and the difference is
mechanical, not a matter of degree:

- A percentage rollout gives **every normal request a random chance** of hitting
  either version — Cloudflare: "each request has a random chance of routing to
  either version based on the specified percentages". That is the condition that
  produces the asset-skew breakage §0 describes.
- At **100% previous / 0% candidate**, the candidate's selection probability is
  zero. No normal request can reach it. The skew condition — HTML from one
  version and a content-hashed chunk from the other — **cannot arise for traffic
  that sends no override header**, because there is only one selectable version.
- An override request is not a percentage; it is an explicit, per-request
  instruction naming a UUID. It moves no traffic and changes no percentage.

So §0 does not forbid state 2, and this runbook must not use §0 to dismiss it.

### Does Forever's static-asset and version-affinity situation PERMIT state 2+3?

**Determination: YES for scripted, header-bearing probes. NO for the ordinary
Owner browser acceptance session.** Both halves are proven below; neither may be
dropped. The second half is stated at exactly the strength the evidence supports
and no further — see the scope note under limit 1.

**PERMITTED, because:**

1. **The two-version limit fits exactly.** Cloudflare supports two versions in
   one deployment; Forever needs previous + candidate = two.
2. **Normal traffic is not exposed.** Previous version at 100% is the only
   selectable version for override-free requests. §0's failure mode requires two
   selectable versions.
3. **Every probe this runbook already performs is a discrete HTTP request.**
   Steps 8, 9 and 16a fetch `/`, `/projects`, `/sitemap.xml`, `/robots.txt`, the
   404 contracts, the full transitive `/assets/*` graph and the Studio chunk
   graph as individual requests. Adding the override header to **each** of them
   runs the identical probe set against the candidate **on the production
   origin**, where — unlike the Preview URL — the invocations are loggable.
4. **No Durable Objects.** `wrangler.jsonc` declares none, so the Durable-Object
   gradual-deployment caveat does not apply here.

**LIMITED, and these limits are load-bearing:**

1. **The override header is unavailable for the ordinary Owner browser
   acceptance session under Forever's current workers.dev-only architecture,
   because normal navigation and automatically requested subresources do not
   carry the override header.** A top-level navigation carries no custom header,
   and neither do the subresource requests the returned HTML triggers. Those
   requests are therefore routed by percentage — Cloudflare: "the request will
   be routed according to the percentages set in the gradual deployment
   configuration" — i.e. to the previous version, which does not have the
   candidate's content-hashed chunk names. **An ordinary browser session pointed
   at a state-2 origin either never reaches the candidate at all, or reaches it
   for the document only and then 404s on every candidate chunk.**

   **SCOPE OF THIS CLAIM, STATED DELIBERATELY.** This is a statement about the
   session step 17 actually prescribes: the Owner opening Studio in a normal
   browser against the production origin. It is **not** a universal claim that
   no browser automation, extension, proxy or instrumented client could ever
   attach the header. Some such mechanism may well be capable of it. **None of
   them is part of the authorized Forever release workflow**, none is
   provisioned, and none may be introduced to satisfy this gate without its own
   authorization and its own evidence. An earlier revision of this section
   asserted the universal form — "NO for any browser session" — which claimed
   more than the cited Cloudflare documentation establishes. The narrower claim
   is the one that is proven, and it is sufficient: it is exactly what keeps the
   Owner acceptance gate at step 17.

2. **The header cannot be injected for Forever.** The documented way to attach
   these headers without client cooperation is a zone Transform Rule, and
   Cloudflare excludes exactly this origin shape: "Transform Rules require your
   Worker to be on a route on a zone you control. They are not available for
   Workers served on `*.workers.dev` domains." Forever is served from
   `forever.phuketre22.workers.dev`. This is the SAME root cause that makes
   version affinity unavailable in §0 — one missing zone disables both.
3. **Therefore step 17's acceptance gate cannot move earlier.** "The Owner opens
   Studio fresh and confirms the authenticated dashboard renders" is a real
   browser session. Version Overrides move the **log** gate before the cutover;
   they do **not** move the **Owner browser acceptance** gate before it. Anyone
   reading this section as "the candidate can now be fully accepted before
   cutover" has read it wrong.
4. **Cron triggers cannot be smoke-tested at all pre-cutover.** The Studio
   scheduled runner is invoked by the platform on `*/5 * * * *`. A scheduled
   invocation carries no request, so there is no header to set, and no documented
   mechanism directs a cron invocation to a 0% candidate. The scheduled path is
   first exercised at state 5.
5. **Overrides make the candidate INVOCABLE, not OBSERVABLE.** See the
   prerequisites below.

### The prerequisites of a pre-cutover log gate — and WHEN each is proven

These must be satisfied by MEASUREMENT, not by assumption, or state 3 produces
invocations and no evidence. Prerequisite 3 is the one that must hold **before
A1 is performed at all**, and it exists because a deployment mutation whose
outcome is already known to be unreadable is a mutation made for nothing.

1. **Script-level observability must actually be live.** Workers Logs is a
   script-level setting. Measured on this Worker, `script-settings` reported
   `observability: null`, `enabled: false` while the candidate artefact's own
   config correctly declared it enabled. Creating the state-2 deployment MAY
   change that — this runbook does not claim it does or does not. **Re-read
   `GET .../workers/scripts/forever/script-settings` after the state-2
   deployment exists and record what it actually says.** If observability is
   still off, state 3 yields no logs and the gate is `NOT VERIFIED` — never
   "clean", and never quietly skipped.
2. **The reading credential must carry Workers Observability read.** The release
   environment's token does not; the telemetry query returns HTTP 403
   `[code: 10000]`. That is Owner setup and it is a prerequisite of the state-3
   authorization, not something to discover afterwards.

3. **A2 AND A3 MUST BE PROVEN OPERATIONALLY AVAILABLE AND SEPARATELY AUTHORIZED
   BEFORE A1 IS PERFORMED.** A1 is a real mutation of the production deployment.
   It is justified only by the evidence A2 and A3 are supposed to produce, so
   performing it while that evidence is already known to be unobtainable buys a
   deployment mutation and nothing else, and can end only in `NOT VERIFIED`.

   Before A1, record all three of:
   - the Owner's separate A2 authorization, naming the complete probe set;
   - the Owner's separate A3 authorization;
   - a **positive, non-mutating read-access proof** for the observability
     credential — a telemetry query that returns a result rather than HTTP 403
     `[code: 10000]`. The credential named in prerequisite 2 is the thing being
     proven; it is not assumed from the fact that a token exists.

   **If read access cannot be demonstrated, A1 is not performed.** The release
   is recorded as `NOT VERIFIED` and remains BLOCKED BEFORE CUTOVER, with the
   candidate left in §6 state 1 exactly as it is. Proceeding to A1 anyway — "we
   will find out afterwards" — is the specific error this prerequisite exists to
   stop, and it is out of contract.

   Prerequisite 1 is deliberately NOT on this list. Script-level observability
   may only become live once the state-2 deployment exists, so it genuinely
   cannot be settled before A1; it is measured immediately after A1 and it
   blocks A4 if it is off. Prerequisite 3 is different: it is knowable in
   advance, which is precisely why it must be known in advance.

### The `--keep-vars` hazard applies to the state-2 deployment too — UNPROVEN, so MEASURE

The measured incident behind §2a is that a version operation without
`--keep-vars` deleted the deployment-managed plain-text variables. Whether
`wrangler versions deploy` — which sets percentages over already-uploaded
versions — can do the same is **NOT established here in either direction**.

It is therefore treated as unknown and handled by measurement: **re-run
`npm run release:verify-bindings` against the live Worker AFTER the state-2
deployment is created and BEFORE any override probe is trusted.** A binding
fingerprint that changed is a stop, and the remedy is to redeploy the previous
version alone at 100%.

### What this changes, and what it must never be allowed to excuse

- Step 11 verifies the observability CONFIGURATION only, and records preview
  logs as `UNSUPPORTED (N/A — platform limitation)`. That part is unchanged and
  correct: state 1 genuinely cannot be logged.
- **Step 11b is the pre-cutover override smoke and log gate.** It is not
  automatic — it exists only when the Owner has authorized states 2 and 3.
- **Absence of log evidence is NEVER evidence of correctness.** No report may
  turn "logs could not exist" or "logs were not obtained" into "no errors were
  found". A candidate that raises an exception on every request produces exactly
  the same empty log evidence as a perfect one.
- **"Not yet obtainable" and "impossible" are different words.** State 1 cannot
  be logged. That is not a property of the candidate, of 0%, or of the platform's
  logging in general — it is a property of the candidate being ABSENT from the
  deployment, and it is reversible by an authorized deployment mutation.
- The candidate-upload gates that DO hold are unchanged and remain mandatory:
  binding fingerprint equality, public-route probes with zero 5xx, the full
  transitive `/assets/*` graph, and the Studio chunk graph. Those caught both
  previously rejected candidates; they are not weakened here.
- **A candidate-upload PASS still authorizes NOTHING beyond a verified artefact
  sitting outside the deployment.** It is not a cutover decision, not an
  acceptance, and not a statement that the candidate runs correctly under real
  traffic.

### The FOUR separate Owner authorizations

These are four decisions, not one. Each is requested, granted and recorded on its
own; none implies the next; and **the state-2 deployment mutation described here
is NOT authorized by this document.**

**A1 — include the candidate in the active deployment at 0%.** Must state the
exact candidate Worker version UUID, the exact previous Worker version UUID
remaining at **100%**, that this is a deployment mutation performed with
`wrangler versions deploy`, that normal traffic does not move, and that the
rollback is to redeploy the previous version alone at 100%. The post-mutation
binding **and deployment-membership** re-verification above is part of this
authorization.

**A1 IS GATED ON PREREQUISITE 3.** It may not be requested or performed until
A2 and A3 are separately authorized AND the observability read access A3 depends
on has been positively demonstrated. **If the operator already knows the
candidate's logs cannot be read, the state-2 deployment is NOT created.** A1
exists to make A2 and A3 possible; performing it when they are not is a
production deployment mutation with no reachable purpose.

**A2 — send controlled requests using Version Overrides.** Must NAME the exact
request set in advance, and every request in it must be **non-mutating**: `GET`
or `HEAD` only, on public routes and asset paths. No POST, no Studio write, no
job creation, no authenticated session, no cron. Each request carries
`Cloudflare-Workers-Version-Overrides: forever="<candidate-uuid>"` and no other
override.

**A3 — read the resulting logs and attribute them to the exact candidate UUID.**
Must state that attribution is by version UUID and that a log line not carrying
the candidate UUID is NOT candidate evidence. Requires the observability-read
credential named above. **A3 passes only when it returns ACTUAL
candidate-attributed evidence.** An empty result, a result carrying no event
attributed to the candidate UUID, or a query that cannot be executed at all, is
`NOT VERIFIED` — never "clean", and never rounded up.

**A4 — the atomic cutover. HARD-GATED.** A4 may be requested only when ALL FIVE
of the following are true. This is a conjunction, not a checklist to weigh:

1. **A1 completed successfully** — the candidate is a member of the active
   deployment at 0% and the previous version holds 100%;
2. **bindings AND deployment membership were re-verified** against the live
   Worker after A1, and both matched;
3. **A2's COMPLETE named non-mutating probe set passed** — every request in the
   set that was authorized in advance, with zero 5xx and zero probe failures.
   A partial probe set is not a pass;
4. **A3 returned actual candidate-attributed evidence** — at least one log event
   carrying the candidate UUID, with no candidate release error in it;
5. **step 11b has the exact final status `PASS`.**

The A4 authorization request must then state:

1. the exact candidate Worker version UUID being cut over to;
2. the exact previous Worker version UUID as the rollback target;
3. the pre-cutover log gate recorded as `PASS` — the only value that reaches
   this point — and step 16b named as the post-cutover check that still applies;
4. the Owner Studio hold (steps 12–13);
5. explicit acceptance of the rollback boundary below.

A cutover performed without all five preconditions and all five statements is
out of contract.

#### The outcomes that BLOCK A4 — exhaustive

Each of these halts the release before the cutover. None is waivable, and none
may be carried into an A4 request as an accepted risk:

- `STOP`;
- `NOT VERIFIED`;
- `DECLINED BY OWNER`;
- observability unavailable;
- log-reading access unavailable;
- no attributable candidate log events;
- binding verification failure;
- any override probe failure.

**`DECLINED BY OWNER` IS NOT A WAIVER.** It is recorded, in full, as

    GATE DECLINED — RELEASE REMAINS BLOCKED BEFORE CUTOVER

An earlier revision of this section said A4 could be requested "after the Owner
has explicitly declined the pre-cutover gate", and the failure-boundary text said
"the Owner decides whether to proceed to A4 with the gate explicitly declined".
Both are RETRACTED. They made the gate advisory, which is the same defect as a
report that records `PASS` beside an unsatisfied mandatory gate — the defect this
whole section exists to correct. The Owner may decline to authorize A1, A2 or A3;
declining them declines the release. It does not unlock A4.

`NOT VERIFIED` and `DECLINED BY OWNER` remain honest, required, reportable
outcomes. They are exactly what an operator must write down when the gate did not
pass. What they may never do is appear in an A4 authorization as anything other
than the reason there is no A4.

### Failure boundaries — step 11b BEFORE the cutover, step 16b AFTER it

The two gates have different failure modes because they sit on opposite sides of
the traffic move.

**Step 11b (state 3, pre-cutover).** Traffic has NOT moved, so failure is a
refusal to proceed, never a rollback of traffic:

- **A candidate release error in the override logs is a STOP.** The cutover is
  not requested. The candidate stays out of production and the state-2
  deployment is reverted to the previous version alone at 100%.
- **A 5xx on any override probe is a STOP**, on the same terms as step 8.
- **Logs that cannot be read, or observability that is still off, are
  `NOT VERIFIED`** — not a pass, and not a failure of the candidate. **It is
  still BLOCKING.** `NOT VERIFIED` does not reach A4; the release halts here and
  the state-2 deployment is reverted to the previous version alone at 100%.
  There is no Owner decision that converts it into permission to cut over.
- **A gate the Owner declines to authorize is `DECLINED BY OWNER`, and it is
  BLOCKING on identical terms** —
  `GATE DECLINED — RELEASE REMAINS BLOCKED BEFORE CUTOVER`. Recording the
  decline honestly is required; treating the record as a waiver is not
  permitted.
- **A3 that returns no event attributed to the candidate UUID is `NOT VERIFIED`**
  even when the query itself succeeded. Zero attributable events is an absence
  of evidence, and §6 does not let an absence of evidence become a pass.
- **Any failure of any authorized override probe is a STOP**, including a probe
  that could not be executed. The named set passes as a whole or not at all.
- **A binding or deployment-membership re-verification that does not match after
  A1 is a STOP**, and the remedy is to redeploy the previous version alone at
  100%.

**Step 16b (state 5, post-cutover).** Traffic has ALREADY moved, so failure is a
rollback:

- **A candidate release error in the logs is a ROLLBACK TRIGGER under §5** —
  same holds, same atomic single-invocation reallocation, same acceptance gate.
- **Logs that cannot be read at all are NOT a pass.** An empty or unavailable
  result is recorded as `NOT VERIFIED`. The release halts at §5 rollback
  readiness and the Owner decides; it is never rounded up to "clean".
- Reading logs at either step requires a token carrying Workers Observability
  read, or dashboard access. Obtaining it is Owner setup, and it is a
  **prerequisite of A1 and of the cutover authorization alike** — proven before
  the state-2 deployment is created, not discovered afterwards. This runbook
  states that requirement in exactly one direction: **there is no path in which
  a cutover proceeds while Observability read access is unavailable.** Any
  reading of any paragraph here that permits one is a misreading of this
  sentence.

**Step 16b is retained as a required acceptance check. It is NOT the first
possible candidate-log stage** — step 11b is — and no report may describe it as
such.

### Status of the PR #140 candidate, recorded accurately

The single authorized upload was performed. Its outcome is recorded here so no
later reader has to reconstruct it from a report that overstated its verdict.

| Fact                                       | Status                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Upload                                     | **SUCCEEDED** — one attempt, no retry                                          |
| Candidate Worker version                   | `ebe99b50-eed0-4365-8e00-934189581bcb`                                         |
| Previous live Worker version               | `fb4bf6d7-76c3-4c87-a7f7-08e6ce36fde3`                                         |
| Binding fingerprint vs live                | **PASS** — `BINDINGS_PRESERVED`, `workerVersionIdentityOk: true`, 12/12 EQUAL  |
| Preview routes, asset graph, Studio chunks | **PASS** — zero 5xx, full transitive graph HTTP 200                            |
| `CLIENT_ASSET_ID` on candidate             | **PASS** — `f0d147dcfb85f9bbeaddf9466c39c52e`                                  |
| Production traffic                         | **UNCHANGED** — previous live version still 100%                               |
| Candidate deployment membership            | **STATE 1 — ABSENT from the active deployment.** It holds no percentage at all |
| Workers Logs for the candidate             | **NOT OBTAINABLE IN STATE 1 — not verified, not clean**                        |
| Release status                             | **BLOCKED BEFORE CUTOVER**                                                     |

**The candidate is in state 1, NOT "at 0%".** The two are different, and this
row was previously written as "Candidate traffic: 0% — absent from the active
deployment", which asserted both at once. A candidate at 0% _inside_ the
deployment (state 2) is invocable by version override and its logs are
obtainable; a candidate that is absent is neither. Reaching state 2 requires the
A1 deployment mutation, which **has not been requested, authorized or
performed**.

**The release is not accepted and no cutover is authorized by any of the above.**
It proceeds only by following the corrected lifecycle in this section and
obtaining the separate Owner authorization it defines. The earlier report that
recorded `PASS` while acknowledging an unsatisfied mandatory gate is superseded:
a required gate that did not hold is a BLOCKED verdict, and a gate that cannot
hold must be corrected rather than reported around.

The candidate is left exactly where it is, at 0%, unmodified and undeleted —
§2b: a candidate that is not accepted is evidence, not rubbish.

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
- **Temporary deeper observation** uses `wrangler tail`, which needs no
  deployment and no configuration change **of its own** — but it attaches to the
  Worker that is DEPLOYED, and `--version-id` only FILTERS that stream by
  version. **`wrangler tail` cannot observe a versioned Preview URL**, so it is
  useless against a candidate that is ABSENT from the deployment (§6 state 1).
  It becomes usable at **step 11b**, once the candidate is a member of the
  current deployment at 0% and override requests are invoking it — the stream it
  filters then contains the candidate's own invocations, before any traffic
  moves. It is usable again at step 16b. See §6 — the earlier wording of this
  bullet read as though a candidate could be tailed at state 1, and the wording
  that replaced it wrongly deferred tail to after the cutover.

**Honest limit, restated:** Workers Logs record Worker INVOCATIONS. A 404 for a
missing static asset is answered by the asset handler without raising a Worker
exception, so Workers Logs cannot, on their own, prove a browser-only
dynamic-import failure. Step 14a's asset-404 rate on Worker analytics is the
signal that covers that gap.

---

## 8. Deferred follow-up

`FOREVER-CLOUDFLARE-VERSION-AFFINITY-001` — obtain true version affinity through
a custom domain plus a Transform Rule setting `Cloudflare-Workers-Version-Key`,
or through an approved upstream router. Only after that is configured **and
proven** may a percentage rollout be reconsidered, and this runbook must be
updated in the same task that proves it.

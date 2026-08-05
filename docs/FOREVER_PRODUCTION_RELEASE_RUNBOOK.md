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

   **PREUPLOAD additionally proves the inheritance SOURCE — see §2c.** The
   supplied live version must carry exactly the twelve-binding contract
   including both plain-text names; the ephemeral upload specification must
   carry exactly two `inherit` records named `SUPABASE_URL` and
   `STUDIO_STORAGE_WRITE_PROVIDER`, both pinned to that exact UUID, neither
   using `"latest"`, neither omitting `version_id` and neither carrying a value
   field; no binding name may be duplicated; the immutable build must be
   unchanged; and the normalized specification's SHA-256 is recorded. The
   success marker is `PREUPLOAD_PINNED_INHERITANCE_OK`. The superseded
   `PREUPLOAD_CONTRACT_OK` is never emitted again.

4. **Upload the candidate at 0% traffic, through the structured wrapper**, which
   preserves deployment-managed variables:

   ```
   npm run release:upload-version -- \
     --live .forever-build/live-bindings.json \
     --expected-live-version <exact-discovered-live-worker-version-uuid> \
     --receipt .forever-build/worker-version-provenance.json \
     --authorize-upload
   ```

   The wrapper first proves the resolved Wrangler is exactly the supported
   version, then spawns — with **no shell** — exactly this and nothing else:

   ```
   wrangler versions upload --keep-vars --config .output/server/wrangler.upload.json
   ```

   **`--config` names the ephemeral upload specification, not the build
   output.** `.output/server/wrangler.upload.json` is generated per release by
   the wrapper: it is `.output/server/wrangler.json` byte-for-byte plus exactly
   the two pinned `inherit` bindings. The build output is never modified, and
   the specification is written into the same directory so `main` and the
   relative `assets.directory` resolve to the identical Worker bundle and asset
   set. It is untracked, hashed at verification, and re-hashed immediately
   before the spawn — if it changed in between, the wrapper STOPS rather than
   uploading bytes nobody verified.

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
   correlates all four facts: expected former live UUID, normalized
   upload-specification SHA-256, immutable release-manifest SHA-256, and the
   resulting candidate UUID. **Migration-free**: schema-1 receipts remain
   readable exactly as written — no rewrite, no backfill — and only schema 2 is
   ever produced. It is still value-free: two UUIDs and two digests.

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
11. **Enable and verify Workers Logs.** `observability.enabled` is `true` with
    `head_sampling_rate: 1` in `wrangler.jsonc`; confirm it survived into
    `.output/server/wrangler.json` and that logs appear for the candidate. The
    sampling rate is a PERMANENT setting, not a temporary elevation — see §7.
12. **Obtain an explicit, short Owner Studio hold.** Required for the first
    bootstrap release — see §4. The Owner is told the window and told to take no
    Studio action during it.
13. **The Owner closes or refreshes the existing Studio tab and performs no
    action.** No upload, no publication, no Retry, no member change, no password
    change.
14. **Atomic cutover.** Move from old 100% / new 0% to old 0% / new 100% in ONE
    `wrangler versions deploy` invocation. No intermediate percentage. Run
    `--dry-run` first and confirm the exact source and target **Worker version
    UUIDs** — the target must be the candidate UUID recorded in step 4, and the
    source must be the previous UUID recorded in step 4.
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
  args: ["versions", "upload", "--keep-vars", "--config", ".output/server/wrangler.json"],
}
```

- the command printed in §2 step 4 is **derived from** that specification, so
  documentation and execution cannot drift apart;
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
  unless it produced `PREUPLOAD_CONTRACT_OK`.

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

## 2c. `--keep-vars` IS NOT A SUFFICIENT RELEASE INVARIANT

§2a established that omitting `--keep-vars` deletes deployment-managed
variables. That is true and it is not the whole story. A second candidate,
`3540bc64`, passed `--keep-vars` **correctly** and still came back with ten
bindings.

### What actually happened

| upload     | `--keep-vars` | predecessor | predecessor bindings | result |
| ---------- | ------------- | ----------- | -------------------- | ------ |
| `ae4cae19` | absent        | `9af03721`  | 12                   | 10     |
| `3540bc64` | present       | `ae4cae19`  | 10                   | 10     |

The first upload deleted the variables outright. The second kept variables from
the latest uploaded version — and the latest uploaded version was by then the
failed 10-binding candidate, which had nothing to keep. Two different
mechanisms, one identical outcome.

**Inheritance resolves against the LATEST UPLOADED version, not the deployed
one.** Traffic allocation does not influence it. A version sitting at 0% is a
perfectly eligible inheritance source, and the 12-binding version holding 100%
of traffic was two versions older.

### What is proven, and what is inferred

**Proven.** Cloudflare documents, for the `inherit` binding type: "Defaults to
inheriting the binding from the latest version." An offline capture against the
pinned Wrangler proved it forwards an explicit `version_id` verbatim.

**A high-confidence inference, NOT a proven Cloudflare guarantee.** That generic
`keep_bindings` resolves against that same base. `keep_bindings` is not
documented on the Upload Version API page and no server-side trace exists. The
chronology, the documented `inherit` default and the observed outcome all agree
— but agreement is not proof, and this document does not claim otherwise.

The correction does not depend on resolving that gap: naming the source version
explicitly removes the implicit default from the release path entirely.

### The mechanism

The two deployment-managed plain-text bindings are **inherited by name**, from
an **explicitly pinned** source version:

```json
[
  { "name": "SUPABASE_URL", "type": "inherit", "version_id": "<expected-live-version>" },
  {
    "name": "STUDIO_STORAGE_WRITE_PROVIDER",
    "type": "inherit",
    "version_id": "<expected-live-version>"
  }
]
```

- **the pin is the verified 100% live UUID**, supplied at release time through
  `--expected-live-version` and verified against the sanitized live snapshot. It
  is never hard-coded in tracked source, because a committed UUID goes stale
  silently;
- **`"latest"` is prohibited**, and so is omitting `version_id` — either one
  restores the implicit source that caused the incident;
- **a newer 0% candidate must not affect the inheritance source.** The source is
  the snapshot-verified live version and nothing else;
- **binding values are never read or retransmitted.** An `inherit` record
  carries a name and a source version UUID. Neither production value is read,
  copied, logged, persisted or retransmitted anywhere in the release path — the
  values never leave Cloudflare. `--var`, a `vars` block and copying a value
  into a temporary file are all refused;
- **only these two binding names may use this mechanism.** A third `inherit`
  record is a named STOP;
- **`--keep-vars` is retained as documented secondary protection** for the six
  secrets and the other supported categories. It is no longer the mechanism
  these two plain-text bindings depend on.

### Configuration inspection is not enough

The superseded PREUPLOAD contract checked argv tokens and `keep_vars: true` and
returned `PREUPLOAD_CONTRACT_OK` for an upload that was guaranteed to inherit
from a 10-binding base. Everything it checked was true; none of it described the
bytes that left the machine.

**The actual serialized metadata must be inspected offline.**
`src/lib/stale-asset/wrangler-inherit-serialization.test.ts` runs the
repository-locked Wrangler against a loopback mock with dummy credentials, a
dummy account, a dummy Worker name and dummy version UUIDs, and asserts the
multipart metadata Wrangler really emits. It creates no Worker version and
cannot reach `api.cloudflare.com`. It fails if `version_id` is stripped,
replaced with `"latest"`, if either binding is missing or duplicated, if a third
inherit record appears, if any plain-text value is present, or if the resolved
Wrangler is not the version locked by this repository.

### This does not replace post-upload verification

Pinned inheritance makes the upload independent of the implicit source. It does
not prove the result. **After the upload, the candidate must still be captured
and proved to carry exactly twelve bindings before any deployment authorization
is offered** — §2 step 6, unchanged. A candidate that cannot be proved
equivalent stays at 0%.

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
dynamic-import failure. Step 14a's asset-404 rate on Worker analytics is the
signal that covers that gap.

---

## 8. Deferred follow-up

`FOREVER-CLOUDFLARE-VERSION-AFFINITY-001` — obtain true version affinity through
a custom domain plus a Transform Rule setting `Cloudflare-Workers-Version-Key`,
or through an approved upstream router. Only after that is configured **and
proven** may a percentage rollout be reconsidered, and this runbook must be
updated in the same task that proves it.

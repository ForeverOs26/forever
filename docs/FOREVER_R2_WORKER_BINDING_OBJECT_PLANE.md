# Forever Studio — the Worker-side R2 object plane

**Status:** ordinary-file processing corrected; the large-archive multipart
control plane remains incomplete on a Worker and is documented here in full.

---

## 1. What was wrong

Forever Studio's R2 storage plane reached R2 exactly one way: the **S3 API,
SigV4-signed, over `fetch`**. That path has two consumers with very different
fates on Cloudflare.

| Who makes the request                                       | Outcome in production   |
| ----------------------------------------------------------- | ----------------------- |
| the **browser**, using a presigned URL the Worker generated | every upload accepted   |
| the **Worker itself**, calling R2 directly                  | never reached R2 at all |

The first real R2 production pilot uploaded six Owner-selected files — three
photographs and three documents, 51,937,418 bytes — into `forever-private-sources`
without a single failure. Then processing ran, and the very first server-side
object HEAD threw a fetch-level `TypeError` before a byte was read. R2's own
operations log recorded **zero** object operations for that bucket across every
attempt, while the browser's `PutObject` calls from the upload window sat right
there in the same log.

The repository already stated the rule it broke. `public-media.server.ts` says
plainly that on a Worker, R2 is reached through the **bucket binding**, and that
the S3 API is "what local development, tests, and any non-Worker host use". The
public media route obeys it. The processing plane did not, and the three R2
bindings configured on the live Worker sat unused by it.

Three defects compounded it:

- the generic `processing_failed` wrapper swallowed the cause, so seven
  identical attempts produced no diagnosable evidence;
- provider resolution sat _outside_ the processing failure boundary, so a
  provider refusal escaped `processClaimedJob` entirely and left the job claimed
  and `processing`;
- nothing capped automatic attempts, so a deterministic failure retried every
  five minutes until a human stopped it by hand.

---

## 2. What the correction does

### 2.1 Two transports, one choice, made at construction

`createR2StorageProvider` takes an explicit `runtime`:

- **`worker`** — every server-side object operation goes through the native
  bucket bindings. The S3 client stays for the one thing a binding cannot do:
  presigning the browser's direct upload.
- **`node`** (default) — local development, tests and any non-Worker host keep
  the S3 object plane, byte-for-byte as before.

`resolveStudioR2Runtime()` decides, from two independent signals: the Cloudflare
`navigator.userAgent`, and the presence of Nitro's `globalThis.__env__` (which
the cloudflare-module preset publishes for **both** the `fetch` and the
`scheduled` entry paths — which is what lets a cron-driven tick resolve
bindings with no browser session).

There is deliberately **no third case**. A Worker without usable bindings does
not fall back to S3-over-fetch: on a Worker that is not a fallback at all, only
a slower way to fail. It refuses, with a `provider_resolution` stage on it.

### 2.2 Binding selection is closed and kind-keyed

```
private_source    → R2_PRIVATE_SOURCES
public_media      → R2_PUBLIC_MEDIA
project_archives  → R2_PROJECT_ARCHIVES
```

Callers hold a **logical bucket name**, and the only route from that name to a
binding runs through `bucketKindForLogicalBucket` — a closed table that returns
null for anything it does not know. No string reaches a binding by resembling a
bucket name, and no caller can select one.

`r2-layout.ts` is untouched, so every stored manifest and every existing object
keeps addressing exactly the same bytes.

### 2.3 Sanitized stage telemetry

`StudioStageTelemetry` has exactly seven bounded fields — provider, stage, safe
code, exception-class category, attempt number, retryability, workflow. There is
**no free-text field**, so there is nowhere for a filename, object key, bucket
path, presigned URL, signature, credential, document content, Owner id or job id
to be written, by accident or by a later "just one more detail" edit.

It is persisted in the job's existing `facts` JSONB and logged as one allowlisted
line. The production symptom is now `object_stat_failed` with
`stage=object_stat`, not `processing_failed`.

### 2.4 Bounded automatic retries

`STUDIO_AUTOMATIC_RETRY_LIMIT` bounds **consecutive failed automatic attempts** —
the cron tick and the dashboard's background resume. Deliberately not:

- a cap on `attempt_count` (that counts every claim, and a large archive
  legitimately re-claims once per bounded slice);
- a cap on Owner-initiated processing (stopping the automatic loop exists
  precisely to hand the decision back to a person);
- a licence to rewrite history — `attempt_count` is never reset or adjusted.

State lives in the job's existing `facts` JSONB. **No migration.**

---

## 3. The gap: the multipart archive control plane

### 3.1 What is already Worker-native

| Archive operation                          | On a Worker                                   |
| ------------------------------------------ | --------------------------------------------- |
| ranged reads of a completed archive        | ✅ `R2_PROJECT_ARCHIVES` binding              |
| completed-object size verification         | ✅ binding `head`                             |
| cleanup / delete                           | ✅ binding `delete`                           |
| per-part presigned upload targets          | ✅ S3 presigning (no request; browser-facing) |
| abort of an upload that cannot exist there | ✅ no-op                                      |

### 3.2 What is not, and why

| Operation                 | Binding equivalent                            |
| ------------------------- | --------------------------------------------- |
| `CreateMultipartUpload`   | exists (`createMultipartUpload`)              |
| `CompleteMultipartUpload` | exists (`resumeMultipartUpload().complete()`) |
| `AbortMultipartUpload`    | exists (`resumeMultipartUpload().abort()`)    |
| **`ListParts`**           | **none**                                      |

`ListParts` is not an incidental call. It is the **resume authority**:

> The parts the storage system durably holds. Authoritative: a browser's claim
> about what it uploaded is only ever cross-checked against this.

The confirm path lists what R2 actually holds, compares each part against its
planned size, treats any disagreement with the client's claimed ETag as a
missing part, and re-issues targets only for those. The R2 binding API has no
way to enumerate the parts of an in-progress multipart upload.

Two substitutes were considered and both rejected:

1. **Trust the browser's reported receipts.** This inverts the contract the
   current design exists to enforce. A client can compute a valid-looking ETag
   for a part it never uploaded; the server would then believe the part is
   present, never re-issue a target for it, and completion would fail forever
   with no way to identify which part is missing. That is a strict weakening of
   the resume guarantee.
2. **Attempt completion and re-upload everything on failure.** Converges, but
   turns one missing part in a 300 MB archive into a full re-upload. Also a
   strict weakening of the resume guarantee.

So on a Worker the multipart control plane **fails closed, loudly**:
`archive_control_plane_unavailable`, stage `archive_control_plane`,
non-retryable. Archive support is not silently disabled — it names exactly which
plane is unavailable, on the same deployment where ordinary files now process
natively. Off a Worker, nothing changes.

### 3.3 How the gap is presented, rather than hidden

An incomplete lane that fails at the point of use is not much better than one
that fails silently: the Owner has already chosen a file, waited, and formed an
expectation. So the gap is declared up front, at three separate levels.

**The provider declares it.** `StudioStorageProvider.archiveControlPlane` is a
closed two-value capability set by the provider itself — the object that would
have to do the work is the object that says whether it can, so the capability
and the refusal cannot drift apart. Supabase is always `available`; R2 is
`available` off a Worker and `temporarily_unavailable` on one.

**The server refuses before allocating anything.** Every endpoint that could
create an archive, a job, a signed part target or a stored object calls
`assertArchiveControlPlaneAvailable` first — after authentication and
authorization, so it is not an unauthenticated probe of what a deployment
supports, and before the first durable effect of any kind:

| Endpoint                  | Refused before                                             |
| ------------------------- | ---------------------------------------------------------- |
| `startUploadJob`          | the job row, staging paths and signed targets exist        |
| `planJobArchiveUpload`    | the archive row, multipart upload and part targets exist   |
| `confirmJobArchiveUpload` | any part-state read, completion call or archive transition |

The refusal is `archive_upload_temporarily_unavailable` with a fixed safe
message: no filename, path, object key, bucket, binding, URL, provider id,
runtime or credential.

`StartJobInput.archives` exists solely so a MIXED submission is one thing. The
archives are planned later on their own endpoint, so without that declaration
the browser would have to create the ordinary job first and only then discover
the lane is closed — leaving a half-made upload behind for the Owner to clean
up. It is untrusted like every other browser input: it cannot create an archive,
and omitting it gains nothing, because the plan endpoint refuses independently.

**The window says so.** `StudioOverview.capabilities.archiveUpload` carries the
same closed enum to the browser. All fourteen windows still render; the archive
window still names its material; its picker is `disabled`, and the reason is
wired into the control's own `aria-describedby` so assistive technology hears
the explanation rather than only meeting a dead input. Nothing else changes:
the other thirteen windows, the workflow, the facts and the publication rules
are exactly as they were, and no completeness or approval gate is added.

The client is told, never asked. A forged capability, a stale cached overview
or a raw HTTP call all meet the same server refusal.

**One deliberate non-restriction.** The gate is on the resumable multipart
_lane_, not on the archive _window_. A ZIP small enough for the ordinary signed
lane never needs a part listing, so it still uploads and still expands inline
under `project_archive`. Refusing it would remove working functionality for no
safety gain.

### 3.4 The exact additional architecture needed

Three viable designs, in preference order:

**A. Parts-as-objects layout for the R2 archive lane (recommended).**
Each part becomes its own R2 object under a deterministic per-archive prefix,
exactly as the Supabase lane already works. Then:

- resume authority = `binding.list({ prefix })` — authoritative, Worker-native,
  and _stronger_ than `ListParts` (part objects do not expire the way an
  abandoned multipart upload does, removing the `upload_expired` loss mode);
- the browser still uploads each part directly with a presigned PUT — no Worker
  byte relay;
- no assembly step is needed: `StudioArchiveByteReader` already abstracts a
  _parted_ reader, which is what the Supabase lane returns today, with the same
  bounded memory profile;
- `discardArchiveParts` becomes a real delete, and abort becomes a prefix sweep.

Cost: it changes the R2 archive object layout and the meaning of
`StudioArchiveStorageState.multipartUploadId` for new archives. **Zero R2
archives exist in production today**, so the change is safe now and gets harder
later. It needs its own correction, its own migration-free compatibility rule
for any archive written before it, and its own verification pass.

**B. A Cloudflare API control plane.** Drive multipart through
`api.cloudflare.com`, which a Worker can reach. Requires a new Worker secret (an
API token with R2 permissions) and therefore a Cloudflare credential change.

**C. A service binding to a non-Worker host** that performs the S3 control-plane
calls. Requires a new deployment component and a new binding.

**A is the only one that needs no credential, no new binding and no new
deployment component**, and it is the one this document recommends.

---

## 4. The follow-up: FOREVER-R2-BINDING-NATIVE-MULTIPART-ARCHIVE-001

Restoring full project-archive upload on the production Worker is tracked as a
separate task. It is deliberately NOT part of the correction that gates the lane
— gating is small and reversible, and the recovery of the contained production
job must not wait for an archive redesign.

**Objective.** An authoritative, R2-native archive resume model — design A
above, parts-as-objects, unless the implementing task finds better.

**Invariants it must preserve.** These are the reasons the substitutes in §3.2
were rejected, and they are not negotiable:

- **direct browser-to-R2 upload** — every part travels device → R2 on its own
  short-lived presigned request;
- **authoritative server-verifiable resume** — what storage durably holds is
  established by the SERVER asking storage, never by the client reporting. A
  client's claim may still be cross-checked; it may never be the source;
- **no Worker whole-file relay** — archive bytes never pass through the isolate;
- **bounded memory** — the reader stays at roughly one logical part, whatever
  the archive's size;
- **idempotent completion** — completing an already-completed archive returns
  the same state rather than failing, so a retried confirm after a lost response
  succeeds;
- **no credential expansion** — no new secret, no broader token scope, no new
  binding beyond the three that already exist.

**Definition of done.** `archiveControlPlane` reports `available` on
`runtime = worker, provider = r2`; the archive window loses its unavailable
state with no UI change of its own; and the gate added here becomes dead code
that can be deleted in the same change.

**Out of scope for it.** The ordinary-file object plane, the Coralina recovery,
telemetry, and the retry policy — all already corrected and not to be disturbed.

---

## 5. What did not change

- browser direct upload: device → R2, short-lived presigned PUT, no Worker byte
  relay, no permanent browser credential, no browser DELETE, existing CORS;
- `r2-layout.ts`, so manifests and objects address the same bytes;
- the material-purpose contract in every respect;
- public delivery: only verified sanitized derivatives in `R2_PUBLIC_MEDIA`,
  opaque immutable keys, `/media` reading that bucket and nothing else, generic
  not-found, no `r2.dev` dependency;
- the no-fallback rule: an R2 job succeeds on R2 or fails closed, and nothing in
  the storage plane knows how to reach Supabase Storage;
- the database schema. No migration.

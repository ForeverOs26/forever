# Forever — Cloudflare R2 media storage architecture

**Task:** FOREVER-R2-MEDIA-STORAGE-CUTOVER-001
**Status:** implemented in code, **not deployed**. No R2 bucket, credential,
binding, secret or deployment was created by the work that produced this
document.

---

## 1. The Owner decision this implements

Supabase stays responsible for **identity and structured truth**:

- Auth, the Owner and employee identities;
- PostgreSQL — projects, developers, units, prices, amenities;
- CRM;
- Studio jobs, archives, entries and the audit log;
- compact file **metadata** and object **references**.

Cloudflare R2 becomes responsible for **every heavy project file**: private
source photographs and renders, public image derivatives, videos, brochures,
price lists, payment plans, master/floor/unit plans, maps, construction media,
legal documents, PDFs, ZIP archives, resumable archive parts, and every future
Studio project material.

After the future cutover, a **newly created** Studio job puts no project file or
derivative in Supabase Storage.

Nothing about the Studio interface changes. The Owner still picks a project, a
workflow, an upload window and files, and presses Publish.

---

## 2. Three buckets, one boundary

| Bucket                     | Binding               | Holds                                                               | Publicly readable                       |
| -------------------------- | --------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| `forever-private-sources`  | `R2_PRIVATE_SOURCES`  | original uploads, re-staged ZIP entries, per-entry private evidence | **never**                               |
| `forever-public-media`     | `R2_PUBLIC_MEDIA`     | verified, sanitized derivatives only                                | only through Forever's `/media/…` route |
| `forever-project-archives` | `R2_PROJECT_ARCHIVES` | completed ZIP packages assembled by multipart upload                | **never**                               |

All three stay **private at the bucket level**. `r2.dev` public access,
anonymous listing and a public custom domain are all **off**. "Private" is a
bucket boundary, not a prefix convention.

### Key layout

Studio addresses objects by a **logical bucket + path**, exactly as it always
has; `server/storage/r2-layout.ts` is the single total mapping onto R2.

| Logical bucket      | Kind               | R2 key prefix |
| ------------------- | ------------------ | ------------- |
| `studio-uploads`    | `private_source`   | `studio/`     |
| `project-images`    | `public_media`     | `media/i/`    |
| `project-documents` | `public_media`     | `media/d/`    |
| `studio-archives`   | `project_archives` | `studio/`     |

Concrete keys:

```
private source     studio/jobs/<job-id>/staging/<NNN>/object
re-staged entry    studio/jobs/<job-id>/zip/<attempt>/<NNN>/object
entry evidence     studio/jobs/<job-id>/evidence/<archive-id>/<NNNNN>/<NNNNN>
archive object     studio/archives/<job-id>/<archive-id>/archive.zip
public derivative  media/i/studio/<job-id>/<attempt>/<NN>-<hash16>.<ext>
```

Every key is server-generated, immutable, job-scoped, attempt-isolated where the
existing concurrency semantics require it, safe for lexicographic prefix
cleanup, and independent of any client-supplied directory. **R2 private keys
carry no filename at all** — a filename routinely contains a personal name, an
address or a deal reference, and a storage key has no need of one. (The legacy
Supabase private path keeps its sanitized filename: those objects already exist
and rewriting the scheme would orphan them.) No key contains an Owner email or
Auth user id.

The two public logical buckets share one R2 bucket but **not** one key
namespace. That is deliberate: the post-publication orphan sweep enumerates one
public bucket at a time and deletes what the committed publication does not
reference, so a shared namespace would make each sweep see the other bucket's
committed objects as orphans.

---

## 3. The provider contract

`src/features/forever-studio/server/storage/provider.ts` is the whole seam.
Studio's orchestration, extraction, media-truth and large-archive code call it;
none of them contains an R2 call, an S3 endpoint, a bucket name or a credential.

Two planes:

- **object plane** (`provider.objects`) — the existing `StudioStorage` shape:
  stat, streamed hash, streamed read, bounded download, put, remove, public URL.
  Both providers implement it, so every byte-verification and derivative rule in
  the pipeline is provider-agnostic by construction;
- **control plane** — allocating an upload the BROWSER performs, and the
  resumable multipart lifecycle: `allocateOrdinaryUpload`,
  `beginArchiveUpload`, `archivePartTargets`, `listAcceptedArchiveParts`,
  `completeArchiveUpload`, `abortArchiveUpload`, `discardArchiveParts`,
  `archiveReader`, `buildPublicUrl`, `locatorFor`.

Implementations:

| File                            | Role                                         |
| ------------------------------- | -------------------------------------------- |
| `storage/supabase-provider.ts`  | the LEGACY lane, unchanged behaviour         |
| `storage/r2-provider.server.ts` | the R2 lane                                  |
| `storage/r2-client.server.ts`   | the S3 subset Forever uses, over `fetch`     |
| `storage/sigv4.server.ts`       | AWS SigV4 presigning and request signing     |
| `storage/registry.server.ts`    | reads configuration, builds the provider set |
| `storage/job-provider.ts`       | reads back the provider a job recorded       |

---

## 4. Ordinary direct upload

1. The authenticated Studio server boundary authorizes the Owner or Trusted
   Publisher and validates project access, workflow, material purpose and
   manifest. **A denied request is refused before any target is allocated** —
   no presign, no object, no row.
2. The job row is created or resumed, and the storage provider is **persisted**
   on it.
3. The server generates a unique private R2 object key per declared file and
   returns a **short-lived presigned PUT** for exactly that key.
4. The browser `PUT`s the `File` straight to the R2 S3 endpoint. Bytes are never
   relayed through a server function, an Edge Function, a Worker handler or the
   database.
5. The browser reports only completion state. It never sees a credential.
6. Processing HEADs and reads the **actual** R2 object and independently
   verifies actual byte size, streamed SHA-256, magic-byte media type,
   declared-versus-observed type, and every existing sanitization and
   publication rule.
7. A verified derivative — and only a verified derivative — is written to
   `forever-public-media`.
8. Supabase stores the metadata and the public Forever media URL.

### Presigned URLs are bearer credentials

Generated server-side only; least-privilege bucket-scoped credentials; one HTTP
method; exactly one object key; short expiry (900 s); Content-Type signed so a
browser that declares different bytes is refused **by R2 itself**. They are
never printed, logged, persisted into PostgreSQL, put into audit metadata,
client analytics, an error message, Git or an evidence artifact. Browser-presigned
**DELETE is never issued**: deletion is server-side only and only for job-scoped
keys.

---

## 5. Large archives — R2 multipart

The Owner-facing contract is unchanged: fixed 8 MiB parts, an exact ordered
per-part SHA-256 manifest as the resume identity, storage acceptance that proves
every part exists at its planned size, and byte verification of the actual
stored bytes before anything expands. What changed is the transport.

1. The server creates **one** R2 multipart upload for **one** archive object key
   and stores the durable identity (object key + upload id) in the archive's
   existing `extracted` JSONB.
2. The browser uploads parts directly to R2 through presigned part URLs.
3. Every part has a fixed part number, a fixed expected size, a
   browser-computed SHA-256 claim (recorded at plan time, never trusted) and a
   returned R2 ETag.
4. Resume calls **ListParts** — the storage system, not the browser, is the
   authority — and returns targets for the missing parts only.
5. A claimed ETag that disagrees with ListParts marks that part as still
   needing bytes; it is never silently accepted.
6. Completion happens only when every required part is represented exactly once
   at exactly its planned size. It is idempotent.
7. The completed object is then read back and byte-verified: each **logical
   part** is a byte range of the assembled object, streamed through SHA-256 and
   compared against its plan-time claim — identical evidence and identical
   rejection rules to the Supabase lane.
8. The Owner-selected `materialPurpose` survives plan, every part upload,
   resume, completion, processing slices and scheduled continuation, because it
   lives on the durable row.
9. Full Project Archive remains the only window whose entries may be boundedly
   classified. An archive in any other window hands that window down to every
   entry. The structured-artifact purpose matrix is untouched.

**Lost uploads.** R2 expires abandoned multipart uploads on its own schedule,
but the application still handles expired upload ids, aborted uploads, missing
parts, duplicate part numbers, stale ETags, completion races, retry after
completion, stale workers, concurrent resume, and an upload that no longer
exists. An expired upload **never restarts the whole job**: the affected archive
is rejected in place with `archive_upload_expired`, every other archive and
ordinary file continues, and re-presenting the same bytes plans a **fresh
archive id and a fresh immutable object key** — a rejected row is never a resume
candidate, so an abandoned upload can never be resumed into or overwritten.

---

## 6. Public delivery

Route: `GET|HEAD https://forever.phuketre22.workers.dev/media/<opaque-key>`
(`src/routes/media.$.ts`; handler in `server/public-media.ts`).

It reads only `R2_PUBLIC_MEDIA` (binding when the Worker runtime exposes one,
otherwise the same bucket through the S3 API with the same server-only
credentials — the bucket is chosen at construction, never from a request). It
can never read `R2_PRIVATE_SOURCES` or `R2_PROJECT_ARCHIVES`: it prepends the
immutable `media/` key prefix to whatever it is asked for, so a request for a
private key becomes a public key that does not exist.

It supports GET, HEAD, byte ranges (video seeking), conditional requests
(`If-None-Match` → 304), and returns correct `Content-Type`, `Content-Length`,
`ETag`, `Accept-Ranges`, immutable `Cache-Control`, `X-Content-Type-Options:
nosniff` and `Cross-Origin-Resource-Policy`. An unsatisfiable range is 416 with
`Content-Range: bytes */<size>`.

It never lists a prefix, never exposes a bucket name, never exposes an original
private filename, and never proxies a caller-supplied URL. Malformed,
percent-decoded-traversal and ambiguous keys, absent objects, private keys and
storage failures all return **one byte-identical generic 404** — existence is
never disclosed.

`r2.dev` is never a production delivery URL.

---

## 7. Provider persistence and legacy compatibility

- A job records its provider in the existing `studio_upload_jobs.facts` JSONB
  (`facts.storage.provider`) and mirrors it onto every file in the existing
  `files` JSONB (`files[].storageProvider`).
- An archive records its provider and durable upload identity in the existing
  `studio_archives.extracted` JSONB (`extracted.storage`).
- A manifest with **no** recorded provider means **Supabase** — which is exactly
  what those jobs were created on. There is no third answer, no inference from a
  URL, and no consultation of the current deployment setting.
- Old public Supabase media URLs keep rendering unchanged. Old project rows need
  no backfill and are never rewritten.
- A retry never changes provider mid-job. A resumed R2 job never falls back to
  Supabase. A resumed Supabase legacy job never turns itself into R2.

Production currently has zero Studio jobs; compatibility is nonetheless
implemented and tested against a manifest with the pre-contract shape rather
than relying on that count.

---

## 8. Deletion locators

A public URL is a delivery address, not an identity. The server-private locator
(`{ storageProvider, bucketKind, bucket, objectKey }`) is persisted **alongside**
the public URL — job manifests keep `publicBucket`/`publicPath`, archive entry
rows keep `public_bucket`/`public_path`, and the provider comes from the job's
persisted record. A destructive object key is **never** derived by parsing a
public URL. The R2 object plane additionally refuses any delete outside a job
prefix.

---

## 9. Configuration

### Non-secret, server-only

| Name                                                                                  | Values             | Meaning                                                      |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `STUDIO_STORAGE_WRITE_PROVIDER`                                                       | `supabase` \| `r2` | which system a **newly created** job writes to               |
| `FOREVER_PUBLIC_MEDIA_ORIGIN`                                                         | origin             | optional; overrides the origin used to build `/media/…` URLs |
| `R2_BUCKET_PRIVATE_SOURCES` / `R2_BUCKET_PUBLIC_MEDIA` / `R2_BUCKET_PROJECT_ARCHIVES` | bucket names       | optional overrides; default to the three production names    |

`STUDIO_STORAGE_WRITE_PROVIDER` is **never** a `VITE_*` variable and never
reaches the browser bundle.

Documented behaviour for every input:

| Configured value                              | Behaviour                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| absent, empty, whitespace                     | `supabase` — the pre-cutover state; nothing new reaches R2                                                    |
| `supabase` / `r2` (trimmed, case-insensitive) | that provider                                                                                                 |
| anything else non-empty                       | **refusal**: new job creation fails closed with `storage_write_provider_invalid` until the value is corrected |

A change affects **new jobs only**. Once `r2` is selected, an R2 error **fails
closed** — there is no automatic fallback to Supabase Storage anywhere in the
codebase.

### Secrets (server-only)

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

They are used **only** to sign requests — most importantly the browser's
short-lived direct-upload URLs. They must never appear in `VITE_*` variables,
committed `wrangler` vars, client code, generated client assets, Supabase, test
snapshots, logs, reports or GitHub PR text.

**Minimum Cloudflare permissions:** one R2 API token scoped to **Object Read &
Write** on exactly the three buckets `forever-private-sources`,
`forever-public-media` and `forever-project-archives`. No account-level R2 admin,
no bucket create/delete, no Workers permissions, no other Cloudflare product.
The token's S3 credentials are what `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY` hold.

### Bindings

```jsonc
"r2_buckets": [
  { "binding": "R2_PRIVATE_SOURCES",   "bucket_name": "forever-private-sources" },
  { "binding": "R2_PUBLIC_MEDIA",      "bucket_name": "forever-public-media" },
  { "binding": "R2_PROJECT_ARCHIVES",  "bucket_name": "forever-project-archives" }
]
```

Preserved unchanged: Worker name `forever`, the `*/5 * * * *` Studio cron,
compatibility-date behaviour, `nodejs_compat`, every current Supabase binding,
`STUDIO_OWNER_USER_ID`, and the absence of `STUDIO_OWNER_EMAIL`.

---

## 10. CORS runbook (to apply at deployment, not here)

Direct browser upload requires CORS on the two buckets the browser touches:
`forever-private-sources` (ordinary files) and `forever-project-archives`
(multipart parts). `forever-public-media` needs **no** CORS — it is never
addressed by the browser directly; delivery is same-origin through `/media/…`.

Production rule, per bucket:

```json
[
  {
    "AllowedOrigins": ["https://forever.phuketre22.workers.dev"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- **No wildcard origin in production.** List the exact production origin.
- `PUT` is the only method the browser performs. `HEAD`/`GET` are server-side
  and need no CORS entry; add them only if a future browser feature requires it.
- `content-type` is the only request header the browser sends that the signature
  covers, so it is the only one that must be allowed. No checksum or custom
  metadata header is signed today; if one is added, it must be added here too.
- `ExposeHeaders: ["ETag"]` is **required** — multipart completion needs the
  per-part ETag the browser reads from the response.
- Local and staging get their own rule with their own origins, in their own
  bucket set. Never widen production's rule to cover them.
- CORS is applied to the **S3 endpoint** the presigned URL targets
  (`https://<account>.r2.cloudflarestorage.com`). Do **not** assume a custom
  domain: none is configured, and presigned URLs do not use one.

---

## 11. Performance and memory

- Bytes go **device → R2**. No Worker byte relay was introduced.
- The browser never buffers a whole large archive beyond its existing `File`
  object: parts are sliced and hashed one at a time.
- No Worker request handler buffers a whole archive. The R2 archive reader
  caches at most one 8 MiB logical part, the same bound the Supabase parted
  reader has; whole-archive hashing streams range reads without a per-part
  buffer.
- Bounded processing, slice budgets and parse limits are unchanged.
- The public media route streams the R2 body straight through; it never
  materializes an object.
- The SigV4 signer and the S3 client are `.server.ts` modules reached only from
  server code, pinned by the bundle-boundary tests. **No signing dependency
  ships to the client** — indeed none was added at all.

---

## 12. Dependency decision

No dependency was added.

Considered: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, and
`aws4fetch`. Both were rejected:

- the repository has **no** storage dependency today, and the AWS SDK is a large
  multi-package graph with its own credential-provider chain to audit;
- either package is importable from a client-reachable module, so the only thing
  stopping a signing library from reaching the browser bundle would be
  discipline;
- Forever needs exactly two operations — sign a request this server makes, and
  presign one single-object URL — which is ~200 dependency-free lines.

The runtime already provides everything cryptographic: `crypto.subtle`
(HMAC-SHA256, SHA-256) exists on both the Cloudflare Worker and Node. **No
cryptography is hand-rolled**; only the specified canonical-string format around
those primitives is implemented, and it is verified end to end by a local
harness that recomputes every signature.

---

## 13. Testing

Local, in-process, **disposable** S3-compatible harness
(`tests/local-r2.ts`): no socket is ever opened, the endpoint is the reserved
non-routable `https://local-r2.invalid`, and `assertLocalR2Endpoint` refuses
anything else before the first write. It authenticates every request by
recomputing the SigV4 signature with the production signer, so expiry, method
binding, key binding, query binding and Content-Type binding are genuinely
proven rather than assumed.

Suites: `r2-storage-contract`, `r2-ordinary-upload`, `r2-multipart`,
`public-media-route`, `r2-legacy-and-recovery`, `r2-material-purposes`,
`r2-upload-transport`, plus the extended `bundle-boundary` and
`storage-streaming-client` pins.

Ten mutation controls edit the real implementation, prove the edit landed, prove
the guarding test goes red for an **assertion** reason (build-only failures are
rejected as evidence), and restore the source byte for byte.

---

## 14. Rollout, rollback and the clean reset

See `docs/FOREVER_STUDIO_OWNER_RUNBOOK.md` for the operational sequence.

**Rollback boundary — read this before rolling back.** The pre-R2 Worker is a
safe rollback target only until the FIRST R2 job exists. After that it is not:
it cannot resolve an R2 job's provider, cannot read an R2 object, and cannot
complete an R2 multipart upload. From the first R2 job onward the rollback
target is **the same reviewed dual-provider code with
`STUDIO_STORAGE_WRITE_PROVIDER=supabase`**, which stops new R2 writes while
still being able to finish the R2 jobs that already exist.

**Object retention.** Nothing in this change deletes anything. R2 objects are
retained indefinitely; the only deletions are the existing post-publication
orphan sweep (job-scoped keys of losing attempts) and the existing
failed-attempt cleanup. Abandoned multipart uploads expire on R2's platform
schedule; the application also aborts one explicitly when the archive row it
belongs to could not be written.

**Incident handling.** An R2 outage makes new uploads fail closed with a safe,
retryable error; already-uploaded work stays durable and the scheduled runner
resumes it when R2 returns. If a credential is suspected compromised, rotate the
R2 API token — every presigned URL it issued becomes invalid immediately, and
in-flight uploads simply retry through fresh targets. Never respond to an R2
incident by flipping `STUDIO_STORAGE_WRITE_PROVIDER` back for jobs that already
exist: it affects new jobs only, and the existing R2 jobs still need R2.

**Clean-reset prerequisite.** Deleting the old project catalogue and recreating
projects through Studio is a SEPARATE, Owner-gated task. It may only begin after
a pilot project has been uploaded and verified end to end on R2, after a full
metadata snapshot, after R2 is confirmed as the only write provider, and with
explicit Owner authorization. It is not implemented and not executed here.

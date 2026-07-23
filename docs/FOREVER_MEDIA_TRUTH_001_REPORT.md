# FOREVER-MEDIA-TRUTH-001

## Executive verdict

Implemented locally on `codex/forever-media-truth-001` from exact post-PR-98
`origin/main` merge commit `896cf9b8df25a46cc8590c0b724552b48c09010d`.

The post-PR-98 Studio pipeline already kept uploaded originals private, streamed
the stored bytes for an exact SHA-256 and size, classified media from magic
bytes, and scoped public paths to a processing-attempt token. It did not yet
establish the required privacy boundary: the former `copyObject` streamed the
original payload unchanged into a public bucket. Replacing only the Storage
`Content-Type` removed browser-supplied object metadata, not metadata embedded
inside the payload.

The new boundary is:

> PRIVATE ORIGINAL -> BYTE-VERIFIED SOURCE RECORD -> PRIVATE METADATA RECORD ->
> SANITIZED AND BYTE-VERIFIED PUBLIC DERIVATIVE

JPEG, PNG, and WebP can now become public within a 24 MiB transformation cap.
Every other image/video container and every selected PDF/document fails closed
to private retention with a neutral warning. Unsupported media does not fail
the job.

## Verified pre-change media path

1. The browser accepts materials and exposes an `image/*` environment-camera
   capture input.
2. The server declares at most 60 files, each no larger than 1 GiB, and creates
   a signed target under `studio-uploads/jobs/<job>/staging/...`.
3. The browser uploads the original directly to that private target.
4. Processing streams every stored object to calculate the exact SHA-256,
   observed size, and a 4 KiB magic-byte sample.
5. ZIP files of at most 16 MiB are fully validated and expanded entry by entry;
   selected entries are re-staged privately under a token-scoped path.
6. Selected media is deduplicated by the original SHA-256.
7. Before this change, `copyObject` downloaded the source as a stream and
   uploaded the same bytes to `project-images` or `project-documents`. Storage
   object metadata changed, while EXIF/XMP/container bytes survived.
8. Public paths include the job and a prefix derived from the winning claim
   token. Winner/loser cleanup removes only the losing token prefix.
9. `project_media.metadata` and `studio_upload_jobs.files` are server-held JSON.
   PR #98 removed table-level public SELECT and grants only explicit public
   `project_media` columns; `metadata` is not granted to `anon` or
   `authenticated`.

## Threat and capability matrix recorded before implementation

| Format / path                 | Embedded privacy capability                                   | Pre-change survival             | Orientation/rendering concern               | Worker-safe capability found                                      | Decision                                                         |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| JPEG/JPG                      | EXIF GPS/time/device/software, XMP, IPTC, comments, thumbnail | All bytes survived              | EXIF orientation can be required            | Bounded marker rewrite is feasible                                | Sanitize and verify; reconstruct minimal orientation-only EXIF   |
| PNG                           | `eXIf`, XMP/arbitrary text, author/path/device/time           | All chunks survived             | `eXIf` orientation and color chunks         | Bounded chunk rewrite and CRC verification are feasible           | Sanitize and verify; reconstruct minimal orientation-only `eXIf` |
| WebP                          | EXIF/XMP RIFF chunks                                          | All chunks survived             | EXIF orientation and VP8X flags             | Bounded RIFF rewrite is feasible                                  | Sanitize, rewrite flags/size, and verify                         |
| HEIC/HEIF                     | EXIF/XMP items, ISO-BMFF metadata, thumbnails                 | All boxes survived              | Item transforms/auxiliary images            | No compatible bounded transformer exists                          | Private retention only                                           |
| AVIF                          | EXIF/XMP items and ISO-BMFF metadata                          | All boxes survived              | Item transforms/color properties            | No compatible bounded transformer exists                          | Private retention only                                           |
| MP4                           | Creation time, location, author/device/software               | All boxes survived              | Nested offsets/sample tables                | Arbitrary video cannot be buffered; no streaming sanitizer exists | Private retention only                                           |
| MOV/QuickTime                 | Location/device/model/author/time atoms                       | All atoms survived              | Atom rewrite can invalidate offsets/media   | No compatible streaming sanitizer exists                          | Private retention only                                           |
| WebM/Matroska and other video | Tags, title, muxing/writing app, attachments                  | All bytes survived              | Container rewrite required                  | No verified sanitizer exists                                      | Unsupported and private                                          |
| GIF/other raster              | Comments/application extensions or format metadata            | All bytes survived              | Animation/application extensions may matter | No verified sanitizer exists                                      | Unsupported and private                                          |
| PDF/selected documents        | Author/software/time/XMP, attachments, JavaScript, paths      | All bytes survived              | Safe rewrite requires a PDF sanitizer       | No compatible sanitizer exists                                    | Private retention only; never blind-copy                         |
| ZIP-selected media            | Same risks as the inner format                                | Survived after private re-stage | Same as inner format                        | Existing bounded expansion is reusable                            | Apply identical fail-closed inner-format policy                  |

## Trust model

### Server-recorded evidence

- Authenticated upload/record time, author, and role.
- Job id and processing-attempt identity.
- Exact private original SHA-256 and server-observed size.
- Magic-byte media class observed from the stored original.
- Exact public derivative SHA-256, size, magic class, and canonical MIME.
- Sanitizer version and verifier result.

These statements describe bytes and events observed by Forever. They do not
prove when, where, or by which device content was captured.

### Embedded file claims

Capture time, timezone, GPS, device make/model, software/editor, orientation,
and container creation time are claims carried by the file. They are stored as
claims and are never described as Forever-verified.

### Human observations

Only facts explicitly entered or confirmed by the Owner or Trusted Publisher
are human observations. Embedded metadata is not promoted to this class.

## Final format policy

| Format                           | Final behavior                                                                                | Conditions / warning                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG/JPG                         | **SANITIZED AND PUBLICATION-ELIGIBLE** or **VERIFIED METADATA-FREE AND PUBLICATION-ELIGIBLE** | At most 24 MiB; structurally valid; dimensions present; no ICC profile requiring unsafe preservation; orientation retained only in deterministic orientation-only EXIF |
| PNG                              | **SANITIZED AND PUBLICATION-ELIGIBLE** or **VERIFIED METADATA-FREE AND PUBLICATION-ELIGIBLE** | At most 24 MiB; valid signature/chunk bounds/CRC/IHDR/IDAT/IEND; no `iCCP` or unknown critical chunk; safe color/render chunks retained                                |
| WebP                             | **SANITIZED AND PUBLICATION-ELIGIBLE** or **VERIFIED METADATA-FREE AND PUBLICATION-ELIGIBLE** | At most 24 MiB; exact RIFF bounds; VP8/VP8L payload and dimensions; no ICC profile; EXIF/XMP stripped and VP8X flags rewritten                                         |
| HEIC/HEIF                        | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No compatible Worker-safe item/transform sanitizer                                                                                                                     |
| AVIF                             | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No compatible Worker-safe item/property sanitizer                                                                                                                      |
| MP4                              | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No bounded streaming ISO-BMFF metadata rewriter                                                                                                                        |
| MOV/QuickTime                    | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No bounded streaming QuickTime atom rewriter                                                                                                                           |
| WebM/MKV/AVI/M4V and other video | **UNSUPPORTED AND PRIVATE**                                                                   | Byte classification may recognize the container, but publication remains fail-closed                                                                                   |
| GIF/BMP/TIFF and other raster    | **UNSUPPORTED AND PRIVATE**                                                                   | No verified orientation/metadata sanitizer                                                                                                                             |
| PDF and other documents          | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING** or **UNSUPPORTED AND PRIVATE**            | Public document byte copying is removed until a compatible sanitizer exists                                                                                            |
| Supported image over 24 MiB      | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | Original is still streamed and hashed; transformation is not attempted                                                                                                 |

The phone-video input workflow remains available. Phone originals still upload
and remain private, while unsafe video publication is withheld explicitly.

## Private metadata schema

No schema change is required. Direct-file evidence is stored in the existing
private `studio_upload_jobs.files[*].mediaTruth`; ZIP entry evidence is stored
under `mediaTruthEntries`; published derivatives repeat the link in
`project_media.metadata.studio.media_truth`.

```json
{
  "parser": { "format": "jpeg", "result": "parsed" },
  "claims": {
    "capture_time": "2026:01:02 03:04:05",
    "timezone": "+07:00",
    "orientation": 6,
    "dimensions": { "width": 2, "height": 3 },
    "device_make": "synthetic fixture value",
    "device_model": "synthetic fixture value",
    "software": "synthetic fixture value",
    "gps": { "latitude": 12.5822, "longitude": 98.765, "altitude": 123 }
  },
  "sensitive_metadata_found": true,
  "sanitization_succeeded": true,
  "original": { "sha256": "...", "size": 123 },
  "derivative": {
    "sha256": "...",
    "size": 87,
    "media_class": "image",
    "content_type": "image/jpeg"
  },
  "sanitizer_version": "forever-media-truth-001/v1",
  "verification": { "result": "verified", "forbidden_metadata": [] }
}
```

Exact GPS/device/path claims exist only in these private JSON records. Browser
warnings, audit descriptions, logs, public URLs, catalogue projections, and
Project Detail projections receive no sensitive values. Warning filenames are
reduced to normalized basenames, and the existing path/credential redactor is
also applied at the final browser-warning projection.

## Sanitizer and verifier design

### JPEG

- Parses marker lengths and requires dimensions plus an SOS scan ending in EOI.
- Extracts TIFF/EXIF claims with explicit bounds, IFD-count, value-size, and
  cycle checks.
- Removes EXIF, XMP, IPTC, comments, unsafe APP segments, embedded EXIF
  thumbnails, and trailing bytes.
- Retains JFIF and Adobe rendering markers.
- If orientation is 2-8, creates a deterministic EXIF payload containing only
  tag `0x0112`.
- Fails closed on an ICC profile because ICC descriptive/device tags cannot be
  safely rewritten by the present parser.

### PNG

- Verifies signature, exact chunk bounds, CRCs, IHDR dimensions, IDAT presence,
  IEND, and absence of trailing bytes.
- Removes `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`, and unknown ancillary chunks.
- Retains only documented rendering chunks. Unknown critical chunks and `iCCP`
  fail closed.
- Reconstructs only a minimal orientation `eXIf` where required and writes a
  new CRC.

### WebP

- Verifies exact RIFF size, chunk bounds/padding, dimensions, and VP8/VP8L
  presence.
- Removes EXIF, XMP, and unknown chunks. ICC fails closed.
- Reconstructs a minimal orientation-only EXIF chunk where required.
- Clears/sets VP8X EXIF/XMP flags consistently and recomputes RIFF/chunk sizes.

### Result verification and upload

The transformer first requires the bounded source bytes to match the SHA-256
and size already observed by the streaming original read, closing a source
replacement race between hashing and transformation. The verifier then
reparses the derivative bytes. It rejects forbidden chunks or segments, magic
mismatch, dimension change, orientation change, malformed or empty output, and
any EXIF that is not exactly the one-tag orientation form. Only after this
passes is the derivative uploaded to the attempt-token public path. Studio
then streams that public object again and requires the expected SHA-256, size,
image magic class, and canonical MIME before creating a media record.

Originals are never overwritten. Original and derivative hashes are never
claimed to be equal. A metadata-free source may produce the same payload hash,
but it is still a separate public object with independently verified evidence.

## Cloudflare/Nitro runtime compatibility and resource safety

- Pure TypeScript plus `Buffer` and `node:crypto`, already supported by the
  project Nitro/Cloudflare Node-compat build.
- No native dependency, `child_process`, external processor, third-party
  upload, or paid service.
- Original hashing remains streaming and bounded for files up to the existing
  1 GiB ceiling.
- Only JPEG/PNG/WebP files at most 24 MiB are materialized for transformation.
- ZIP archives retain the existing 16 MiB bounded download and validated
  entry-by-entry expansion contract.
- Video, HEIC/HEIF/AVIF, documents, large images, malformed metadata, ICC
  profiles, and unknown critical chunks stay private rather than risking
  memory exhaustion or ambiguous rendering.

## Studio, replay, and cleanup behavior

- A supported image yields one verified derivative, normal hero/gallery
  behavior, and private original-to-derivative evidence.
- Unsupported media contributes a neutral warning and no public object; valid
  business data and other supported files still publish.
- Original-SHA deduplication remains before transformation.
- Re-entry after success returns the stored result and creates no second media
  row or public path.
- Attempt-token paths, claim checks, stale-worker behavior, loser cleanup, and
  winner foreign-prefix sweeping are unchanged.
- A finalization failure still removes the current attempt's derivatives.
- Factory A0, Partner Demo hard-off, direct Owner/Publisher authorization,
  incomplete-data behavior, and private resale contact boundaries are
  unchanged.

## Synthetic regression fixtures

Fixtures are generated in TypeScript and contain fake values only:

- JPEG with GPS, capture time/timezone, make/model, software, orientation, XMP,
  IPTC, and comment/email/phone-shaped data.
- PNG with `eXIf`, author/software text, and a fake private Windows path.
- WebP with EXIF/XMP and fake private values.
- HEIC/HEIF/AVIF and MP4/MOV `ftyp` containers proving private-only policy.
- Clean metadata-free JPEG/PNG/WebP.
- Malformed EXIF.
- A size-boundary test using only a declared size (no large committed binary).
- ZIP entry sanitizer/evidence coverage.

The tests prove private original stability, distinct hashes after metadata
removal, forbidden-value absence, dimension/orientation preservation,
unsupported private retention, deterministic replay, and cleanup behavior.
No real photo, real GPS coordinate, serial number, or customer value is
committed.

## Public and bundle boundaries

The merged PR #98 public contract remains unchanged:

- Catalogue and Project Detail explicitly select public media columns only.
- `anon` and `authenticated` have no table-level `project_media` SELECT and no
  `metadata` column grant.
- Public roles cannot select project/unit provenance, raw price-source fields,
  or private developer contacts.
- Internal knowledge source paths remain behind direct DEV-only dynamic import
  guards.
- Media-truth implementation is server-reachable only; shared browser code
  contains type declarations, not private record values.

Generated client/server bundle scans are recorded in Validation Evidence after
the production build.

## Limitations

- Validation is a strict container/metadata structural rewrite and reparse, not
  a full platform-native pixel decode of every codec variant.
- ICC-bearing images are retained privately because publishing them without a
  validated profile rewriter could change appearance or retain device claims.
- Video, HEIC/HEIF/AVIF, PDF, other documents, unsupported raster formats, and
  supported images above 24 MiB have no public derivative in this change.
- Exact GPS and other embedded claims are private evidence only; no public GPS
  precision or human-authenticated capture claim is introduced.
- Physical iOS/Android capture and gallery testing remains a rollout gate.
- Unpublishing database rows does not itself remove already-created public
  Storage objects; explicit object removal remains required.

## Migration state

No migration was created or modified. Existing JSON fields truthfully hold the
private record, and PR #98 already provides the required column-grant boundary.
No migration was applied.

## Rollout requirements

1. Owner reviews this Draft PR and the private-only decisions for video,
   HEIC/HEIF/AVIF, PDF, ICC-bearing images, and images above 24 MiB.
2. Run physical iOS/Android camera and gallery tests before production. This
   implementation has not been physically phone-verified.
3. Separately authorize any future Worker-compatible video/HEIC/PDF sanitizer;
   do not relax fail-closed behavior based only on extensions or client claims.
4. Deploy through the normal reviewed release process. This task does not
   deploy or access staging/production.

## Rollback and unpublish behavior

- Code rollback is a normal revert of this implementation commit; do not
  rewrite published history.
- Existing project unpublish removes the project from public query results but
  does not delete Storage objects. The objects produced here are sanitized,
  but their unguessable URLs remain readable until explicitly removed.
- A full media rollback/unpublish requires removing the relevant public
  `project_media` reference and token-scoped Storage object while preserving
  the private original and job evidence.
- Do not restore the former blind-copy path during rollback. If sanitizer
  capability is unavailable, retain media privately.

## Validation evidence

- Prettier and changed-file ESLint: pass.
- TypeScript `tsc --noEmit`: pass.
- Focused media-truth and storage-concurrency suites: 2 files, 19 tests passed.
- Complete Studio plus public-query, Project Detail, and boundary suites: 27
  files, 214 tests passed after the final source-race hardening.
- Full repository Vitest run: 342 files; 3,250 tests passed and 5 skipped.
- Real PostgreSQL harness with PostgreSQL 17 on `PATH`: all migrations and all
  Studio behavioral assertions passed.
- Nitro production build using the `cloudflare-module` preset and compatibility
  date `2026-07-23`: pass.
- Corrected absolute-path client/server scans found no synthetic fixture values,
  Owner filesystem paths, private staging/storage markers, knowledge-source
  markers, JWT-shaped values, or service-role credential values in client
  output. The sanitizer version is server-only. The server bundle contains the
  expected `SUPABASE_SERVICE_ROLE_KEY` environment-variable name, not a key.
- `git diff --check`: pass.
- No schema, grant, or migration file was created or changed.

## Environment confirmation

Staging and production were not accessed. No migration was applied. No deploy
occurred. Coralina and Rainpalm were not published.

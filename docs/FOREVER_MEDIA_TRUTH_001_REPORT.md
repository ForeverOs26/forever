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

## Final correction pass (post independent review)

An independent read-only review confirmed the boundary was sound but flagged
four residual defects. Sanitizer version `forever-media-truth-001/v3` addresses
all four:

1. **Decoded-dimension bomb.** A tiny compressed file could declare enormous
   dimensions (e.g. 50000×50000) and publish, so a browser/thumbnailer/Worker
   would allocate gigapixels on fetch. Now every parser and the verifier enforce
   `MAX_MEDIA_DIMENSION = 12000` px/side and `MAX_MEDIA_PIXELS = 64_000_000`
   with overflow-safe arithmetic; an over-dimension source is retained privately
   and produces no public object. The bounds admit ordinary 12 MP, 24 MP, and
   48 MP phone photos while capping any public gallery image's decoded RGBA at
   ≈ 256 MiB, so no fetch can be forced to allocate the ≈ 1 GiB a near-256 MP
   frame would have demanded.
2. **Post-SOS metadata smuggling.** The first-SOS-then-copy JPEG reader treated
   all bytes to EOI as opaque scan, so an APP1/EXIF or COM planted between scans
   survived verbatim and still verified. A complete bounded marker/entropy walk
   now tokenizes the whole stream: multi-scan/progressive JPEG is supported,
   inter-scan APPn/COM are stripped, and trailing bytes after EOI are rejected.
3. **ICC / Display-P3 handling.** An ICC-bearing image (common on iPhone
   exports) was treated as `malformed`. It is now retained privately with the
   dedicated `media_color_profile_unsupported` reason/warning — never
   misclassified — so its color is never silently reinterpreted as sRGB.
4. **Worker memory amplification.** Verification re-ran the full sanitizer,
   building a second derivative. Verification now inspects the already-built
   derivative directly (no re-rewrite), parsers use zero-copy subarray views,
   and unchanged PNG/WebP chunks are re-emitted verbatim. Measured peak growth
   for a near-cap image is ≈ one derivative (see Cloudflare section).

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

| Format                                 | Final behavior                                                                                | Conditions / warning                                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG/JPG                               | **SANITIZED AND PUBLICATION-ELIGIBLE** or **VERIFIED METADATA-FREE AND PUBLICATION-ELIGIBLE** | At most 24 MiB; ≤ 12000 px/side and ≤ 64 MP; structurally valid; complete marker walk; no trailing bytes after EOI; not ICC/color-managed; orientation retained only in deterministic orientation-only EXIF |
| PNG                                    | **SANITIZED AND PUBLICATION-ELIGIBLE** or **VERIFIED METADATA-FREE AND PUBLICATION-ELIGIBLE** | At most 24 MiB; ≤ 12000 px/side and ≤ 64 MP; valid signature/chunk bounds/CRC/IHDR/IDAT/IEND; no `iCCP` or unknown critical chunk; safe color/render chunks retained                                        |
| WebP                                   | **SANITIZED AND PUBLICATION-ELIGIBLE** or **VERIFIED METADATA-FREE AND PUBLICATION-ELIGIBLE** | At most 24 MiB; ≤ 12000 px/side and ≤ 64 MP; exact RIFF bounds; VP8/VP8L payload and dimensions; no `ICCP`; EXIF/XMP stripped and VP8X flags rewritten                                                      |
| ICC / color-managed image              | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | JPEG `ICC_PROFILE` / PNG `iCCP` / WebP `ICCP`: retained with `media_color_profile_unsupported`; never malformed, never re-color-mapped                                                                      |
| Supported image over 12000 px or 64 MP | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | Declared decoded size exceeds the pixel/side bound; retained privately, no public object                                                                                                                    |
| HEIC/HEIF                              | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No compatible Worker-safe item/transform sanitizer                                                                                                                                                          |
| AVIF                                   | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No compatible Worker-safe item/property sanitizer                                                                                                                                                           |
| MP4                                    | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No bounded streaming ISO-BMFF metadata rewriter                                                                                                                                                             |
| MOV/QuickTime                          | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | No bounded streaming QuickTime atom rewriter                                                                                                                                                                |
| WebM/MKV/AVI/M4V and other video       | **UNSUPPORTED AND PRIVATE**                                                                   | Byte classification may recognize the container, but publication remains fail-closed                                                                                                                        |
| GIF/BMP/TIFF and other raster          | **UNSUPPORTED AND PRIVATE**                                                                   | No verified orientation/metadata sanitizer                                                                                                                                                                  |
| PDF and other documents                | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING** or **UNSUPPORTED AND PRIVATE**            | Public document byte copying is removed until a compatible sanitizer exists                                                                                                                                 |
| Supported image over 24 MiB            | **PRIVATE RETENTION ONLY WITH TRANSPARENT WARNING**                                           | Original is still streamed and hashed; transformation is not attempted                                                                                                                                      |

The phone-video input workflow remains available. Phone originals still upload
and remain private, while unsafe video publication is withheld explicitly.

## Final public filename and embedded-thumbnail correction

Public derivative object names are opaque and deterministic. Their only inputs
are job id, processing-attempt token, media ordinal, the verified final-byte
SHA-256 prefix, and the canonical extension derived from the verified format:
`studio/<job>/<attempt>/<ordinal>-<derivative-hash-prefix>.<canonical-ext>`.
Original filenames never participate in public object paths.

Public media titles are neutral and deterministic category labels such as
`Project photo 1`, `Master plan 1`, or `Construction update <date>`. The same
neutral title is the only media-title value available to catalogue and Project
Detail rendering/alt projections. Original filenames remain only in authorized
private Studio job records and the non-public `project_media.metadata` column.
Browser warning payloads use neutral source labels rather than basenames.

JPEG APP0/JFIF is reconstructed rather than retained verbatim. Only validated
JFIF 1.00-1.02 version/density fields survive in one canonical 14-byte payload;
`Xthumbnail` and `Ythumbnail` are zero. Original thumbnail bytes, JFXX, and
other unproven APP0 extensions are removed. Malformed or duplicate JFIF fails
closed. Final-byte verification independently rejects non-canonical JFIF,
non-zero thumbnail dimensions, or retained thumbnail payloads.

Hostile synthetic filename regressions cover fake person, property-address,
phone/email, Windows/POSIX path, Unicode, and traversal values. They prove those
values are absent from public URLs, public media records/titles, catalogue and
Project Detail projections, browser warnings, and server logs while remaining
available in private job/media metadata. Generated client/server bundles are
scanned after the production build.

A test-only installed Chromium route performs genuine pixel decode for
representative sanitized JPEG, PNG, and WebP derivatives. This supplements, but
does not replace, container verification. Physical iOS/Android camera/gallery
and representative deployed-browser checks remain rollout gates; universal
visual correctness is not claimed from container parsing or one browser smoke.

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
  "sanitizer_version": "forever-media-truth-001/v3",
  "verification": { "result": "verified", "forbidden_metadata": [] }
}
```

Exact GPS/device/path claims and original filenames exist only in these private
JSON records. Browser warnings, audit descriptions, logs, public URLs, public
titles/alt text, catalogue projections, and Project Detail projections receive
no private filename text. Browser warnings use only neutral labels; the existing
path/credential redactor is also applied at the final warning projection.

## Sanitizer and verifier design

### Decoded-dimension and pixel-count boundary

Every parser (JPEG SOF, PNG IHDR, WebP VP8X/VP8L/VP8) and the final-byte
verifier reject dimensions outside safe bounds, so a small compressed file
cannot declare gigapixels and publish:

- `MAX_MEDIA_DIMENSION = 12000` px per side, and
- `MAX_MEDIA_PIXELS = 64_000_000` (64 MP) total decoded pixels.

The check is overflow-safe: because width and height are unsigned-32-bit fields
whose raw product can exceed 2^53, each side is compared to 12000 first, after
which `width*height` is at most 1.44×10⁸ and exact in IEEE-754. These bounds
admit ordinary 12 MP, 24 MP, and 48 MP phone photos (a 48 MP sensor ≈ 8000×6000)
with margin, while capping a public gallery image's decoded RGBA at ≈ 256 MiB —
so no fetch can be forced to allocate the ≈ 1 GiB an image near the previous
256 MP ceiling would have demanded. An over-dimension source is retained
privately and creates no public object; the verifier independently re-enforces
the bound on the derivative.

### JPEG

- Performs a **complete bounded marker/entropy walk** over the whole stream
  rather than stopping at the first SOS. Stuffed `FF00` bytes and restart
  markers `FFD0–FFD7` are treated as entropy; multiple SOS scans and inter-scan
  `DHT/DQT/DRI/DNL` tables are supported (valid progressive JPEG is preserved).
- Because the walk sees every segment, `APP0–APP15` and `COM` planted **between
  scans** are stripped exactly like pre-scan segments — they can no longer hide
  inside opaque scan bytes. Requires SOF dimensions (within bounds), at least
  one SOS, and an EOI; **bytes after EOI are rejected** (fail closed).
- Extracts TIFF/EXIF claims with explicit bounds, IFD-count, value-size, and
  cycle checks; removes EXIF, XMP, IPTC, comments, unsafe APP segments, and
  embedded EXIF thumbnails.
- Reconstructs at most one canonical JFIF APP0 segment from validated
  version/density fields; `Xthumbnail` and `Ythumbnail` are always zero and no
  source thumbnail bytes survive. Duplicate, malformed, or ambiguous JFIF fails
  closed; JFXX and other APP0 extensions are removed.
- Retains only a strictly shaped Adobe rendering marker.
- If orientation is 2-8, creates a deterministic EXIF payload containing only
  tag `0x0112` (metadata orientation only — see decode/render notes).
- On an ICC (`APP2 ICC_PROFILE`) profile, retains the source privately as a
  color-managed image (see ICC policy) — never re-emitted, never malformed.

### PNG

- Verifies signature, exact chunk bounds, CRCs, IHDR dimensions (within the
  decoded bound), IDAT presence, IEND, and absence of trailing bytes.
- Removes `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`, and unknown ancillary chunks.
- Retains only documented rendering chunks; unknown critical chunks fail closed.
  An `iCCP` chunk routes the source to private color-profile retention.
- Reconstructs only a minimal orientation `eXIf` where required. Unchanged
  chunks (including large IDAT) are re-emitted verbatim without a re-CRC.

### WebP

- Verifies exact RIFF size, chunk bounds/padding, dimensions (within the decoded
  bound), and VP8/VP8L presence.
- Removes EXIF, XMP, and unknown chunks; an `ICCP` chunk routes the source to
  private color-profile retention.
- Reconstructs a minimal orientation-only EXIF chunk where required.
- Clears/sets VP8X EXIF/XMP flags consistently and recomputes RIFF/chunk sizes;
  the VP8/VP8L bitstream is re-emitted as a view (no extra copy).

### ICC / color-profile policy

An embedded ICC / color-managed image (Display-P3 iPhone exports, ICC-tagged
JPEG/PNG/WebP) is **not malformed**. Silently stripping the profile would leave
wide-gamut pixels reinterpreted as sRGB (visibly wrong color), and ICC profiles
can also carry device/author descriptive tags. This task adds no native
Cloudflare-incompatible dependency and no paid media service, and does not
implement in-Worker color conversion; a strict byte-hash profile allowlist was
evaluated but not adopted (canonical profile bytes cannot be pinned truthfully
in this pass). The chosen policy is therefore **private retention with the
dedicated `media_color_profile_unsupported` reason/warning**, applied uniformly
to JPEG `APP2 ICC_PROFILE` (including split multi-segment and
incomplete/malformed sequences), PNG `iCCP`, and WebP `ICCP`. Practical phone
limitation: an ordinary iPhone photo exported/shared as a Display-P3 JPEG stays
private (with this neutral reason) until a validated profile handler exists,
rather than publishing with altered color.

### Result verification and upload

The transformer first requires the bounded source bytes to match the SHA-256
and size already observed by the streaming original read, closing a source
replacement race between hashing and transformation. The verifier then
independently **re-parses the derivative bytes without re-running the
sanitizer**. It rejects forbidden chunks or segments (including any inter-scan
APPn/COM, `iCCP`/`ICCP`, or JFIF thumbnail), magic mismatch, out-of-bound or
changed dimensions, orientation change (read directly from the derivative's own
minimal metadata), and any EXIF that is not exactly the one-tag orientation
form. Only after this passes is the derivative uploaded to the attempt-token
public path. Studio then streams that public object again and requires the
expected SHA-256, size, image magic class, and canonical MIME before creating a
media record.

Originals are never overwritten. Original and derivative hashes are never
claimed to be equal. A metadata-free source may produce the same payload hash,
but it is still a separate public object with independently verified evidence.

### Decode and render validation

An installed-Chromium smoke (`media-decode-smoke.test.ts`, skipped when no
Chromium is present) performs genuine pixel decode of representative sanitized
derivatives:

- JPEG, PNG, and WebP derivatives decode with `naturalWidth/Height > 0`.
- JPEG derivatives carrying preserved EXIF orientations **2–8** each decode
  successfully in Chromium.

Orientation is preserved as **metadata** (a minimal one-tag EXIF for JPEG/WebP,
a minimal `eXIf` for PNG) — the pixels are **not** rotated. Browser support for
metadata orientation differs by container and must be validated on real devices:
Chromium/Safari honor **JPEG** EXIF orientation broadly; **PNG `eXIf`**
orientation is honored only in newer engines; **WebP** EXIF orientation is not
reliably honored by current browsers. No pixel rotation is claimed here.

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

### Measured memory boundary

The sanitizer no longer amplifies memory. Verification inspects the
already-built derivative instead of re-running the transformer (which had built
a second full derivative), parsers use zero-copy `Buffer.subarray` views, and
unchanged PNG/WebP chunks are re-emitted verbatim, so the only large allocation
is the single derivative built alongside the resident source.

Measured in a clean child process on a generated near-cap (22 MiB) valid image
via `process.resourceUsage().maxRSS` sampled before and after the call
(`src/features/forever-studio/tests/media-memory.test.ts`):

| Metric                      | JPEG        | PNG        |
| --------------------------- | ----------- | ---------- |
| Source bytes                | 23,068,672  | 23,068,672 |
| Derivative bytes            | 23,068,672  | 23,068,672 |
| Peak RSS growth of the call | ≈ 22–23 MiB | ≈ 22 MiB   |
| Ratio to one derivative     | ≈ 1.03×     | ≈ 1.00×    |

- Selected transformation cap: `MAX_MEDIA_SANITIZE_BYTES = 24 MiB`.
- Safety margin: peak image-data footprint is ≈ 2× the payload (source +
  one derivative ≈ 46 MiB at the 24 MiB cap), well under the 128 MiB Worker
  envelope this repository assumes for the request path; workerd's runtime
  baseline is smaller than the Node baseline used for the measurement above.
- The regression test asserts the per-call peak growth stays below 2× the
  source size, which would fail if a second-derivative rewrite were reintroduced
  (that path roughly triples the growth).

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
- Dimension fixtures with header-declared sizes and tiny bodies: ordinary 12 MP
  / 24 MP / 48 MP phone-photo pass (portrait and landscape), 50000×50000 bomb,
  a 100 MP frame that the previous 256 MP cap admitted (now retained privately),
  oversized JPEG/PNG/WebP, exact pixel-cap pass, one-pixel-over fail, per-side
  over, and a 65535² overflow-safety case.
- Multi-scan (progressive) JPEG with private COM and/or EXIF planted between
  scans, and a baseline JPEG with `FF00` stuffing + `RSTn` restart markers.
- A JPEG with trailing bytes after EOI (rejected).
- ICC-bearing JPEG (single, split multi-segment, and incomplete-sequence) with a
  fake in-profile device marker.

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

- Validation combines strict container/metadata rewrite-and-reparse with a real
  Chromium decode smoke for representative sanitized JPEG, PNG, and WebP. This
  does not claim universal visual correctness for every codec variant or device.
- ICC / color-managed images (including common Display-P3 iPhone exports) are
  retained privately with `media_color_profile_unsupported` until a validated
  Worker-safe profile handler exists; publishing them without one would alter
  color or retain device claims.
- Orientation is preserved as metadata, not pixel rotation; browser honoring
  differs by container (JPEG broad, PNG `eXIf` newer engines only, WebP EXIF not
  reliable). Real-device verification is required.
- JPEG files with any bytes after EOI (for example Samsung/Google Motion Photos,
  which append a video after the still) are retained privately rather than
  trimmed-and-published.
- Supported images declaring more than 12000 px/side or 64 MP are retained
  privately with no public object.
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
2. Run physical iOS/Android camera/gallery tests and representative deployed
   browser checks before production. Local Chromium decode is proven, but this
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

All results below are from the isolated worktree at PR head
`75b51f041ea08ef05b08b2e2ef2e760516bac89a` plus the public-decode-limit
correction pass (`MAX_MEDIA_DIMENSION` 20000→12000, `MAX_MEDIA_PIXELS`
256_000_000→64_000_000).

- Media-truth + new regression suites: `media-truth.test.ts` (32 tests, incl.
  the 12/24/48 MP phone-photo pass, the 100 MP frame the previous cap admitted
  now retained privately, dimension-boundary, inter-scan/marker-walk, and
  ICC/color-profile cases), `media-memory.test.ts` (2 tests),
  `media-decode-smoke.test.ts` (2 tests, incl. EXIF orientations 2–8): all pass.
- Hostile-filename and JFIF-thumbnail regressions: pass (within the media-truth
  suite).
- Complete Forever Studio suite (including storage concurrency/replay/cleanup,
  authorization, object/actor boundaries, bundle boundary, upload readiness):
  21 files, 209 tests passed.
- Child-process memory measurement (near-cap 22 MiB JPEG and PNG): per-call peak
  RSS growth ≈ one derivative (JPEG ≈ 22.8 MiB / 1.03×, PNG ≈ 22.2 MiB / 1.00×);
  regression asserts growth < 2× source. See the Cloudflare section.
- Chromium decode: representative sanitized JPEG/PNG/WebP decode, and JPEG
  derivatives for EXIF orientations 2–8 all decode.
- Full repository Vitest run: 342 test files passed (344 total), 3,271 tests
  passed and 5 skipped.
  The only failures are two pre-existing, unrelated files that both depend on
  local/gitignored `forever-data` artifacts absent in a fresh worktree checkout:
  `src/import/importer-preflight.test.ts` (3 assertions — fails identically at
  the pristine PR head with this change stashed) and
  `src/features/project-detail/partner-demo-data.test.ts` (module-load failure:
  cannot resolve the gitignored `forever-data/projects/modeva/...` source files).
  Neither touches `forever-studio`; no media/studio test fails.
- TypeScript `tsc --noEmit`: the only error is a pre-existing, unrelated missing
  gitignored data artifact
  (`forever-data/projects/modeva/extracted/price-list.json`) imported by
  `partner-demo-data.ts`; that file is byte-identical to the PR head and absent
  in any fresh checkout. All changed files (media-truth, extraction,
  studio-types, tests) typecheck cleanly.
- Changed-file ESLint: pass.
- Prettier check over every changed file: pass.
- Nitro/Cloudflare production build (`vite build`, cloudflare target): pass;
  generated `.output/server/wrangler.json`, `.wrangler/deploy/config.json`, and
  the Cloudflare worker. No deployment was run.
- Generated client/server artifact scans: the sanitizer version
  `forever-media-truth-001/v3` and `media_color_profile_unsupported` appear only
  in the server output, never in `.output/public`. No fixture person/device/GPS
  values, JFIF thumbnail secret, or ICC marker appear in any generated output.
  No real secret key value appears in the client bundle — the only `sb_secret_`
  occurrence is a Supabase library key-type guard (`e.startsWith("sb_secret_")`),
  not a key. Zero U+FFFD in server output.
- `git diff --check`: pass.
- No schema, grant, or migration file was created or changed.
- Disposable PostgreSQL suite (`npm run studio:pg-test`, explicitly authorized):
  a throwaway loopback-only PostgreSQL 17 cluster under the OS temp directory
  applied the complete committed migration chain as test setup and ran the
  behavioral assertions — result `ALL STUDIO POSTGRES ASSERTIONS PASSED`,
  `[studio-pg] PASS`. The cluster was destroyed on exit. No remote/persistent
  database was contacted; no production migration was applied.

## Environment confirmation

Staging and production were not accessed. No production or persistent migration
was applied (only disposable test-cluster setup). No deploy occurred. Coralina
and Rainpalm were not published.

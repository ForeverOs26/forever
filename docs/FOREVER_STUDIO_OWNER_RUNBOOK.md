# Forever Studio — Owner Runbook

Status: Companion runbook for FOREVER-STUDIO-001. PR #95 is merged, but
production rollout is **BLOCKED** until the six Owner gates in
`docs/FOREVER_STUDIO_PRODUCTION_PREFLIGHT_REPORT.md` are satisfied. Updated
2026-07-23.

Forever Studio is your publishing tool. You sign in on your phone, tablet,
or computer, upload the materials you have, and the public page goes live
immediately. Missing information never blocks anything — add it later.

## One-time setup (done once, by whoever deploys)

Do not treat this numbered list as standing authorization. Each action requires
the separate Owner confirmation defined in the production preflight report.

1. After Gate A approval, apply the **seven pending Studio migrations** in this
   exact order. The progressive ingestion migration is already applied
   (Coralina is imported as an unpublished draft) — do not re-apply it.
   - `20260721120000_forever_studio_v1.sql`
   - `20260721123000_studio_internal_acl_hardening.sql`
   - `20260722103000_studio_object_authorization.sql`
   - `20260722110000_studio_object_ownership_backfill.sql`
   - `20260722120000_studio_independent_review_corrections.sql`
   - `20260722130000_studio_resume_principal_authorization.sql`
   - `20260722140000_studio_durable_resume_eligibility.sql`
2. Set the server environment variables:
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (used to verify the signed-in
     publisher's token), and
   - `SUPABASE_SERVICE_ROLE_KEY` (used only on the server for Studio writes),
     plus
   - either `STUDIO_OWNER_USER_ID=<your Supabase user id>` (preferred, exact
     identity) or `STUDIO_OWNER_EMAIL=<your confirmed email>`.
3. Create one Owner login (email + password) in the production Supabase Auth
   project and confirm it. The 2026-07-23 preflight found zero Auth users and
   public email signup enabled; disable public signup before rollout.
4. Open `<your site>/studio`, sign in — you become the Owner automatically.
   Nobody else can do this: the database allows exactly one self-bootstrapped
   owner, only while the member list is empty, and only for your configured
   identity. Public signups must be off even though Studio also rejects any
   non-member.

## Daily use

Open **`/studio`** and sign in. You will see five buttons:

- **New Development** — a project that is not on Forever yet.
- **Project Update** — new materials for an existing project.
- **Price / Availability Update** — a new price list.
- **Construction Media Update** — progress photos or videos.
- **Resale Listing** — a resale unit with photos and basic facts.

Then:

1. Type what you know (a name is enough for a new project; everything else
   is optional).
2. Tap **Choose files** (or **Take photo** for the camera) and add whatever
   you have: PDFs, brochures, price lists, master plans, floor plans,
   payment plans, ZIP archives, photos, videos.
3. Tap **Publish now**.

Forever uploads the files, extracts what it can, creates or updates the
page, and publishes it. You then get four buttons: **Open page**, **Share**,
**Edit**, **Unpublish**.

Things worth knowing:

- Uploading to a project that already exists **updates** it — it never
  creates a duplicate.
- Phone photos and videos work as they are: iPhone HEIC/HEIF photos and
  MP4/MOV videos are recognized by their actual content. A file whose bytes
  do not match its name (or an unrecognized format) is kept safely private
  and never published — the rest of the upload still goes through.
- A price-list PDF that cannot be read automatically is kept safely and the
  page still publishes; you can add a reviewed price list later.
- A ZIP that fails the safety checks (damaged, suspicious, or too large) is
  kept unopened and privately; the rest of the upload still publishes.
- If the connection drops, nothing is lost: the upload is saved as a job
  with a **Retry** button. Long uploads keep themselves alive; a genuinely
  interrupted one is picked up automatically.
- Every change records who made it. If the audit log itself ever hiccups,
  your publication still completes — the page is never lost to bookkeeping.

## Fixing and completing information later

- **Edit** on any project or listing opens a short form — fill only the
  fields you want to change. Your entries outrank extracted data, and
  nothing a publisher uploads can overwrite a value you set yourself.
- **Unpublish** hides a page immediately; **Publish** brings it back.

## Trusted Publishers

On `/studio` → **Manage publishers** (only you see this):

- **Invite**: enter their email, a temporary password (10+ characters), and
  a name. Share the password with them directly. They can then do
  everything you do with projects and listings — including publishing
  immediately — but they cannot manage publishers.
- **Disable** cuts a publisher's access instantly (their history remains).
  **Enable** restores it. You cannot disable yourself or the last owner.
- Each publisher sees only **their own** uploads and errors. Only you see
  everyone's activity and the publisher list.
- A publisher can fill in missing information and improve their own entries,
  but nothing a publisher enters can silently replace a value you set — your
  value stays, and the attempted change is recorded for you to review.

There is no public registration. An account that is not on the member list
is rejected by the server even if someone creates a login elsewhere.

## If something looks wrong

- A page shows less than you expect → open **Edit** and fill the gaps, or
  upload better source files; nothing is ever invented to fill a hole.
- An upload failed → open `/studio`, find the job in **Recent uploads**,
  and retry it. Retries never create duplicates.
- Ask for the audit trail: every publication, edit, invite, and disable is
  recorded with the account that did it.

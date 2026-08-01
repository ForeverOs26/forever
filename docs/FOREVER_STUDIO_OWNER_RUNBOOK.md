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
2. **Pending authoritative host access:** set the server environment variables
   only in the verified production host and only in an operation whose deployment
   effect has been separately authorized:
   - `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (used to verify the signed-in
     publisher's token), and
   - `SUPABASE_SERVICE_ROLE_KEY` (used only on the server for Studio writes),
     plus
   - `STUDIO_OWNER_USER_ID=<your Supabase user id>` (exact identity, server
     only; never expose the value in logs, screenshots, Git, or client code).
3. **Completed 2026-07-23:** production Supabase Auth contains exactly one
   confirmed Owner login; public signup is disabled; email/password sign-in is
   still enabled. No second user was created.
4. **Not yet authorized:** open `<your site>/studio`, sign in — you become the
   Owner automatically.
   Nobody else can do this: the database allows exactly one self-bootstrapped
   owner, only while the member list is empty, and only for your configured
   identity. Public signups must be off even though Studio also rejects any
   non-member.

## If you forget your password

Studio has a self-service recovery flow. It does **not** create an account and it
does **not** grant Studio membership — it only lets an account that already
exists replace a forgotten password.

1. Open **`/studio`** and choose **Forgot password?**
2. Enter the email address of your Studio account and submit.
3. The screen always says the same thing — *"If an account exists for that email,
   a password reset link has been sent."* It says this whether or not the address
   has an account. That is deliberate: it stops anyone using the form to discover
   who has Studio access.
4. Open the email and follow the link. It goes to exactly
   **`/studio/reset-password`** on the production site and nowhere else.
5. Enter the new password twice. Minimum **10 characters** — the same rule used
   for publisher invitations. The Supabase server may still reject a weak
   password; if it does, choose a longer, less predictable one.
6. On success you are signed out of the recovery link automatically and returned
   to the normal sign-in screen.
7. **Sign in again with the new password.** This fresh sign-in is required — the
   recovery link never opens the dashboard by itself.

Notes:

- If the link says it has expired, request a new one and use the most recent
  email. Reset links are single-use and short-lived.
- Recovery gives no Studio access on its own. If the account is not an active
  Studio member, signing in afterwards will still be refused.
- **Never share a password in chat, a terminal, a screenshot, a log or a report** —
  including with whoever is helping you operate Forever. Type it only into the
  browser.

### Deployment prerequisite (one time, by whoever deploys)

The recovery email will only work once the production Supabase Auth
configuration allows the exact return address:

- **Site URL:** `https://forever.phuketre22.workers.dev`
- **Redirect allowlist:** `https://forever.phuketre22.workers.dev/studio/reset-password`

Add the exact URL, not a wildcard. Until it is allowlisted and verified, do not
send a recovery email — the link would refuse to return to the site.

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
2. Put each file into the window that says what it is (see **Upload
   windows** below), using **Choose files** — or **Take photo** in the photo
   and construction windows.
3. Tap **Publish now**.

### Upload windows

Instead of one general "materials" box, Studio shows a separate window for
each kind of material:

| Window                               | What goes in it                                  |
| ------------------------------------ | ------------------------------------------------ |
| Brochure                             | The project brochure or e-brochure               |
| Project Photos / Renders             | Photographs and renders of the project           |
| Video                                | Project or promotional video                     |
| Developer / Company Profile          | Developer background — kept private (see below)  |
| Price List                           | Prices or availability                           |
| Payment Plan                         | Payment terms, instalments, deposit schedules    |
| Master Plan                          | The site or master plan of the whole development |
| Floor Plans                          | Building or storey floor plans                   |
| Unit Plans                           | Layouts of individual units, villas or houses    |
| Map / Location                       | Location maps and surrounding-area material      |
| Construction Photos                  | Site progress photos                             |
| Construction Videos                  | Site progress video, including drone footage     |
| Documents / Legal                    | Contracts, title documents, other paperwork      |
| Full Project Archive / Other Package | A complete ZIP package                           |

**The window you choose is the instruction.** Forever does not read the
filename to work out what a file is. A price list called `document.pdf`
uploaded into **Price List** is a price list. A file called
`price-list.pdf` uploaded into **Documents / Legal** stays a document.

Because of that:

- **You never need to rename a file.** Camera names like `IMG_4821.jpg`,
  scanner names like `scan001.pdf`, and Thai or Japanese filenames all work.
- **You never need to prepare folders** or sort anything before uploading.
- **Every window is optional.** Fill the ones you have material for and
  leave the rest empty — nothing is required, and nothing is chased.
- **You can add more later.** Upload the brochure today and the price list
  next week; the page updates rather than duplicating.

The workflow you picked decides which windows appear first. Anything not
shown up front is still there under **More material types** — no material is
ever out of reach because of the workflow you chose.

If you would rather not sort at all, put the whole package into **Full
Project Archive / Other Package**. Forever opens it and routes what it finds
by the names and folders inside the ZIP. That is a convenience for
unsorted packages only; it never overrides a window you chose yourself.

**A ZIP in any other window keeps that window.** Put a ZIP of photographs
into **Project Photos / Renders** and every usable photo inside it is a
project photo — the names and folders inside the ZIP do not get a vote.
Put a ZIP into **Documents / Legal** and its contents are documents, so
they are kept privately rather than published to the gallery. This is true
whatever the ZIP weighs: a large archive uploads in resumable parts, which
changes how the file travels and nothing about what it is.

**Developer / Company Profile** is the one window with no public page of
its own. What you upload there is kept privately and may be used to fill in
the developer details shown on the project page; it does not create a
separate developer section, and uploading it publishes nothing on its own.

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
- Safety checks still run on the actual bytes, and they never move a file to
  a different window. If you put a PDF into **Project Photos** it is not
  quietly re-filed as a document: it stays the photo you said it was, is
  kept private because it cannot be shown as a photo, and you get a short
  note. Everything else in the same upload still publishes.
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

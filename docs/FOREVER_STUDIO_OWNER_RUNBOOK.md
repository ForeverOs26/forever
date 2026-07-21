# Forever Studio — Owner Runbook

Status: Companion runbook for FOREVER-STUDIO-001; effective once the Studio
migrations are applied and the environment variables are configured.
Written 2026-07-21.

Forever Studio is your publishing tool. You sign in on your phone, tablet,
or computer, upload the materials you have, and the public page goes live
immediately. Missing information never blocks anything — add it later.

## One-time setup (done once, by whoever deploys)

1. Apply the two prepared migrations to Supabase (progressive ingestion
   first, then Studio). This is the only step that involves a database.
2. Set two server environment variables: `SUPABASE_SERVICE_ROLE_KEY` and
   `STUDIO_OWNER_EMAIL=<your email>`.
3. Create your login (email + password) in Supabase Auth, or keep the one
   you have.
4. Open `<your site>/studio`, sign in with that email — you become the
   Owner automatically. Nobody else can do this: the bootstrap works only
   while the member list is empty and only for exactly your email.

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
- A price-list PDF that cannot be read automatically is kept safely and the
  page still publishes; you can add a reviewed price list later.
- If the connection drops, nothing is lost: the upload is saved as a job
  with a **Retry** button.
- Every change records who made it.

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

There is no public registration. An account that is not on the member list
is rejected by the server even if someone creates a login elsewhere.

## If something looks wrong

- A page shows less than you expect → open **Edit** and fill the gaps, or
  upload better source files; nothing is ever invented to fill a hole.
- An upload failed → open `/studio`, find the job in **Recent uploads**,
  and retry it. Retries never create duplicates.
- Ask for the audit trail: every publication, edit, invite, and disable is
  recorded with the account that did it.

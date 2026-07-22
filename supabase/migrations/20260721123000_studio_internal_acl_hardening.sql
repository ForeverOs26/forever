-- FOREVER-STUDIO-001 corrective hardening: platform defaults can grant
-- anon/authenticated access to newly-created public tables. Studio internals
-- are server-only, so remove every inherited table privilege explicitly.
BEGIN;

REVOKE ALL ON TABLE public.studio_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.studio_upload_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.studio_listing_contacts FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.studio_members TO service_role;
GRANT ALL ON TABLE public.studio_upload_jobs TO service_role;
GRANT ALL ON TABLE public.studio_listing_contacts TO service_role;

COMMIT;

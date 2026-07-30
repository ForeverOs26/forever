-- FOREVER-LISTINGS-BROWSER-WRITE-REVOKE-001 — safe fixtures for the disposable
-- PostgreSQL privilege suite. Test infrastructure only; never applied to any real
-- database.
--
-- Every value is synthetic and non-personal. No real name, email address, phone
-- number, message or contact value appears here, and nothing is copied from
-- production: the addresses use the reserved `.invalid` TLD and the phone number
-- is an all-zero placeholder. The fixture exists so the ACL assertions run against
-- rows rather than against an empty schema — a privilege test on an empty table
-- can pass for the wrong reason.

BEGIN;

-- The Studio member table keys on auth.users, so the identity comes first.
INSERT INTO auth.users (id, email)
VALUES ('99990000-0000-4000-8000-000000000001', 'fixture-owner@example.invalid')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.developers (id, name)
VALUES ('d0000000-0000-4000-8000-000000000001', 'Fixture Developer')
ON CONFLICT (id) DO NOTHING;

-- One PUBLISHED, ACTIVE project. Published + active is what every public RLS
-- predicate requires, so this row is what proves a preserved SELECT still returns
-- data rather than merely being permitted.
INSERT INTO public.projects (id, developer_id, name, slug, is_active, public_status)
VALUES ('40000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000001',
        'Fixture Project', 'fixture-project', true, 'published')
ON CONFLICT (id) DO NOTHING;

-- A second project left as a DRAFT, so an RLS-filtered read (zero rows, no error)
-- can be told apart from a privilege-denied read (42501).
INSERT INTO public.projects (id, name, slug, is_active, public_status)
VALUES ('40000000-0000-4000-8000-000000000002', 'Fixture Draft', 'fixture-draft', true, 'draft')
ON CONFLICT (id) DO NOTHING;

-- The five remaining column-grant tables the project page reads through explicit
-- column SELECT grants this migration must not disturb.
INSERT INTO public.buildings (id, project_id, name, building_code)
VALUES ('b0000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001', 'Fixture Building A', 'A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.units (id, project_id, building_id, unit_code, bedrooms)
VALUES ('c0000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000001', 'A-01', 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.unit_price_history (id, unit_id, price, currency)
VALUES ('c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000001', 1000000, 'THB')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.project_media (id, project_id, media_type, url, title, sort_order)
VALUES ('e0000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001', 'gallery',
        'https://example.invalid/fixture.jpg', 'Fixture image', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.investment_data (id, project_id, annual_roi_percent)
VALUES ('f0000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001', 6.5)
ON CONFLICT (id) DO NOTHING;

-- One PUBLISHED listing — the table the security finding named.
INSERT INTO public.listings (id, kind, title, slug, publication_status, availability_status)
VALUES ('a0000000-0000-4000-8000-000000000001', 'resale', 'Fixture Listing',
        'fixture-listing', 'published', 'available')
ON CONFLICT (id) DO NOTHING;

-- One lead, so the leads assertions run against a populated table.
INSERT INTO public.leads (id, name, email, phone, status, source)
VALUES ('11110000-0000-4000-8000-000000000001', 'Fixture Prospect',
        'fixture@example.invalid', '+66000000000', 'new', 'contact_form')
ON CONFLICT (id) DO NOTHING;

-- One row in a private Studio table, so "still unreachable by the browser" is
-- asserted against a populated table rather than an empty one.
INSERT INTO public.studio_members (user_id, email, role, is_active)
VALUES ('99990000-0000-4000-8000-000000000001', 'fixture-owner@example.invalid',
        'owner', true)
ON CONFLICT (user_id) DO NOTHING;

-- One amenity and one project link — the two tables 20260728160000 already
-- partially hardened, so the residual MAINTAIN letter is removed from populated
-- tables rather than empty ones.
INSERT INTO public.amenities (id, slug, name, category)
VALUES ('aa000000-0000-4000-8000-000000000001', 'fixture-pool', 'Fixture Pool',
        'Outdoor & Leisure')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.project_amenities (project_id, amenity_id)
VALUES ('40000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

COMMIT;

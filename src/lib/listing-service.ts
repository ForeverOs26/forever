/**
 * Public resale listing reads.
 *
 * Uses the anonymous client, so the database's RLS is the truth boundary:
 * only `publication_status = 'published'` rows are ever served. Fail-closed
 * like every public surface — a missing listing is a 404, a missing field
 * stays absent ("Price on request", omitted sections), nothing is invented.
 */

import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

export interface PublicListing {
  id: string;
  slug: string | null;
  title: string;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  price: number | null;
  currency: string | null;
  availability_status: string;
  description: string | null;
  photos: string[];
  location_name_raw: string | null;
  project_name_raw: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_at: string;
}

const LISTING_SELECT =
  "id,slug,title,property_type,bedrooms,bathrooms,area_sqm,price,currency,availability_status,description,photos,location_name_raw,project_name_raw,contact_name,contact_phone,contact_email,created_at";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The generated Database types predate the listings table; the anon client is
// used untyped here and rows are narrowed by PublicListing.
const anon = supabase as unknown as SupabaseClient;

export const ListingService = {
  async getBySlugOrId(slugOrId: string): Promise<PublicListing | null> {
    const bySlug = await anon
      .from("listings")
      .select(LISTING_SELECT)
      .eq("slug", slugOrId)
      .maybeSingle();
    if (!bySlug.error && bySlug.data) return bySlug.data as unknown as PublicListing;
    if (UUID_PATTERN.test(slugOrId)) {
      const byId = await anon
        .from("listings")
        .select(LISTING_SELECT)
        .eq("id", slugOrId)
        .maybeSingle();
      if (!byId.error && byId.data) return byId.data as unknown as PublicListing;
    }
    return null;
  },
};

export function listingDetailQuery(slugOrId: string) {
  return queryOptions({
    queryKey: ["listing", slugOrId],
    queryFn: () => ListingService.getBySlugOrId(slugOrId),
  });
}

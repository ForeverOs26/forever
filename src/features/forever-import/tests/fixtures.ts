/**
 * Forever Import — shared test fixtures.
 *
 * Deterministic builders for canonical entities and import context. Every
 * builder takes a partial override so tests state only what they exercise.
 */

import type {
  ForeverDeveloper,
  ForeverDocument,
  ForeverMedia,
  ForeverProject,
} from "@/features/forever-database";

import type { ImportContext, ImportSource } from "../types";

export function makeSource(overrides: Partial<ImportSource> = {}): ImportSource {
  return {
    id: "developer-price-list",
    kind: "project",
    format: "manual",
    label: "Developer price list",
    ...overrides,
  };
}

export function makeContext(overrides: Partial<ImportContext> = {}): ImportContext {
  return {
    source: makeSource(),
    now: "2026-01-01T00:00:00.000Z",
    defaultCurrency: "THB",
    ...overrides,
  };
}

export function makeProject(overrides: Partial<ForeverProject> = {}): ForeverProject {
  return {
    id: "project-1",
    slug: "coralina-residences",
    name: "Coralina Residences",
    projectType: "condominium",
    publicStatus: "active",
    salesStatus: "available",
    constructionStatus: "under_construction",
    ownershipType: "freehold",
    raw: {
      publicStatus: "Active",
      salesStatus: "Available",
      constructionStatus: "Under construction",
      ownershipType: "Freehold",
    },
    highlights: [],
    pricing: {},
    trust: { foreverVerified: false },
    isFeatured: false,
    isActive: true,
    ...overrides,
  };
}

export function makeDeveloper(overrides: Partial<ForeverDeveloper> = {}): ForeverDeveloper {
  return {
    id: "developer-1",
    slug: "coralina-group",
    name: "Coralina Group",
    verificationStatus: "unverified",
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<ForeverMedia> = {}): ForeverMedia {
  return {
    id: "media-1",
    projectId: "project-1",
    mediaType: "gallery_image",
    title: "Pool",
    url: "https://cdn.example.com/pool.jpg",
    sortOrder: 0,
    isPublic: true,
    ...overrides,
  };
}

export function makeDocument(overrides: Partial<ForeverDocument> = {}): ForeverDocument {
  return {
    id: "document-1",
    projectId: "project-1",
    documentType: "brochure",
    title: "Brochure",
    url: "https://cdn.example.com/brochure.pdf",
    sortOrder: 0,
    isPublic: true,
    ...overrides,
  };
}

/**
 * Every public reader, not one
 * (FOREVER-MEDIA-SEMANTIC-PUBLIC-CONTRACT-001, blocker 117-4).
 *
 * The first version of this contract protected the Project Detail gallery and
 * nothing else. The catalogue card, the Discovery card, the related-project
 * card, the Navigator match card, the Open Graph tag and the JSON-LD `image`
 * all read the same rows through their own code, so the launch-party
 * photograph the project page had learned to hide was still the picture the
 * catalogue showed and the picture a search engine cached.
 *
 * These tests are organised by SURFACE rather than by rule, because the defect
 * being prevented is "one reader forgot", not "the rule was wrong". Each surface
 * gets the same three questions: does a prohibited role reach it, does a retired
 * cover reach it, and what does it do when the honest answer is nothing?
 *
 * The card components are covered through the two data readers they render —
 * `ProjectService` for everything typed `Property` (`/projects`, `/discovery`,
 * related cards, the Navigator match card, the home page), and
 * `groupProjectMedia` for everything typed `ProjectDetail` (hero, mosaic,
 * lightbox, OG, JSON-LD). Neither component has an image source of its own:
 * `PremiumProjectCard` renders `project.image`, `MatchResultCard` renders
 * `project.image`, and the mosaic and lightbox render `projectPhotographs`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listDemoPreviewProperties, listPartnerDemoProperties, from } = vi.hoisted(() => ({
  listDemoPreviewProperties: vi.fn(),
  listPartnerDemoProperties: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/features/project-detail/demo-preview", () => ({ listDemoPreviewProperties }));
vi.mock("@/features/project-detail/partner-demo-data", () => ({ listPartnerDemoProperties }));

import { makeProjectDetail } from "@/features/forever-database/tests/fixtures";
import { ProjectService } from "@/lib/project-service";
import { GALLERY_EXCLUDED_ROLES } from "@/lib/public-media-policy";

import { groupProjectMedia } from "./project-detail-mappers";
import { projectPhotographs, projectSocialImage } from "./project-sections";
import { buildProjectStructuredData } from "./project-structured-data";
import type { ProjectMediaRow } from "./project-detail-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type MediaSeed = { media_type?: string; url: string; sort_order?: number; semantic_role?: string };

function catalogueRow(slug: string, media: MediaSeed[], mainImageUrl: string | null) {
  return {
    slug,
    name: slug,
    developer: { name: "Developer" },
    media: media.map((item, index) => ({
      media_type: item.media_type ?? "gallery",
      url: item.url,
      sort_order: item.sort_order ?? index,
      semantic_role: item.semantic_role ?? null,
    })),
    main_image_url: mainImageUrl,
    is_active: true,
    is_featured: false,
    created_at: "2026-01-01",
    project_type: "Villa",
  };
}

function stubCatalogue(rows: ReturnType<typeof catalogueRow>[]) {
  const result = { data: rows, error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    query[method] = vi.fn().mockReturnValue(query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null });
  query.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  from.mockReturnValue(query);
  return query;
}

function detailRow(seed: MediaSeed): ProjectMediaRow {
  return {
    id: seed.url,
    project_id: "p-1",
    media_type: seed.media_type ?? "gallery",
    title: null,
    url: seed.url,
    sort_order: seed.sort_order ?? 0,
    semantic_role: seed.semantic_role ?? null,
  } as unknown as ProjectMediaRow;
}

/** The three acceptance projects, in the shape their real rows have. */
const CORALINA: MediaSeed[] = [
  // The launch-event photograph that is the cover today.
  { media_type: "cover", url: "https://cdn/coralina-launch.jpg", semantic_role: "group_photo" },
  { url: "https://cdn/coralina-entrance.jpg", semantic_role: "property_exterior", sort_order: 1 },
  { url: "https://cdn/coralina-aerial.jpg", semantic_role: "property_aerial", sort_order: 2 },
  { url: "https://cdn/coralina-logo.png", semantic_role: "text_promo", sort_order: 3 },
  { url: "https://cdn/coralina-team.jpg", semantic_role: "group_photo", sort_order: 4 },
];

const SIERRA: MediaSeed[] = [
  {
    media_type: "cover",
    url: "https://cdn/sierra-holiday-moments.png",
    semantic_role: "text_promo",
  },
  { url: "https://cdn/sierra-exterior.jpg", semantic_role: "property_exterior", sort_order: 1 },
  { url: "https://cdn/sierra-christmas.jpg", semantic_role: "lifestyle", sort_order: 2 },
  { url: "https://cdn/sierra-render.jpg", semantic_role: "architecture_render", sort_order: 3 },
];

const VILLA_KIRARA: MediaSeed[] = [
  ...Array.from({ length: 24 }, (_, index) => ({
    url: `https://cdn/kirara-launch-${index}.jpg`,
    semantic_role: "event",
    sort_order: index,
  })),
  {
    media_type: "floor_plan",
    url: "https://cdn/kirara-house-plan.pdf",
    semantic_role: "plan",
    sort_order: 100,
  },
  {
    media_type: "document",
    url: "https://cdn/kirara-location.png",
    semantic_role: "map",
    sort_order: 101,
  },
];

beforeEach(() => {
  vi.stubEnv("VITE_PARTNER_DEMO", "false");
  from.mockClear();
  listDemoPreviewProperties.mockResolvedValue([]);
  listPartnerDemoProperties.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Surface: the catalogue, Discovery, related cards, Navigator
// ---------------------------------------------------------------------------

describe("every surface that renders a Property", () => {
  it("requests the semantic role, because it cannot filter on a column it did not select", async () => {
    stubCatalogue([catalogueRow("p", [], null)]);
    await ProjectService.listActive();
    const select = (from.mock.results[0]?.value as { select: ReturnType<typeof vi.fn> }).select;
    expect(select.mock.calls[0][0]).toContain(
      "media:project_media(media_type, url, sort_order, semantic_role)",
    );
  });

  it("Coralina: the card shows the entrance, never the launch party or the logo", async () => {
    stubCatalogue([catalogueRow("coralina", CORALINA, "https://cdn/coralina-launch.jpg")]);
    const [project] = await ProjectService.listActive();

    expect(project.image).toBe("https://cdn/coralina-entrance.jpg");
    expect(project.gallery).toEqual([
      "https://cdn/coralina-entrance.jpg",
      "https://cdn/coralina-aerial.jpg",
    ]);
    expect(JSON.stringify(project)).not.toContain("coralina-launch");
    expect(JSON.stringify(project)).not.toContain("coralina-team");
    expect(JSON.stringify(project)).not.toContain("coralina-logo");
  });

  it("Sierra: HOLIDAY MOMENTS and the Christmas material never reach a card", async () => {
    stubCatalogue([catalogueRow("sierra", SIERRA, "https://cdn/sierra-holiday-moments.png")]);
    const [project] = await ProjectService.listActive();

    expect(project.image).toBe("https://cdn/sierra-exterior.jpg");
    expect(project.gallery).toEqual([
      "https://cdn/sierra-exterior.jpg",
      "https://cdn/sierra-render.jpg",
    ]);
    expect(JSON.stringify(project)).not.toContain("holiday-moments");
    expect(JSON.stringify(project)).not.toContain("christmas");
  });

  it("Villa Kirara: the card has no image at all, and renders its neutral state", async () => {
    stubCatalogue([catalogueRow("villa-kirara", VILLA_KIRARA, null)]);
    const [project] = await ProjectService.listActive();

    // `PremiumProjectCard` and `MatchResultCard` both branch on a falsy
    // `image` and render their own neutral state; "" is what selects it.
    expect(project.image).toBe("");
    expect(project.gallery).toEqual([]);
    expect(JSON.stringify(project)).not.toContain("kirara-launch");
    // The project is still a usable record.
    expect(project.floorPlans).toEqual(["https://cdn/kirara-house-plan.pdf"]);
  });

  it("never falls back to another project's photograph", async () => {
    stubCatalogue([
      catalogueRow("villa-kirara", VILLA_KIRARA, null),
      catalogueRow("sierra", SIERRA, "https://cdn/sierra-exterior.jpg"),
    ]);
    const projects = await ProjectService.listActive();
    const kirara = projects.find((project) => project.slug === "villa-kirara")!;

    expect(kirara.image).toBe("");
    expect(JSON.stringify(kirara)).not.toContain("sierra");
  });

  it("keeps a retired cover off every card", async () => {
    stubCatalogue([
      catalogueRow(
        "p",
        [
          {
            media_type: "superseded_cover",
            url: "https://cdn/retired.jpg",
            semantic_role: "property_exterior",
          },
          { url: "https://cdn/current.jpg", semantic_role: "property_exterior", sort_order: 1 },
        ],
        "https://cdn/retired.jpg",
      ),
    ]);
    const [project] = await ProjectService.listActive();

    expect(JSON.stringify(project)).not.toContain("retired.jpg");
    expect(project.image).toBe("https://cdn/current.jpg");
  });

  it("shows every role-less row, which is the whole pre-backfill estate", async () => {
    stubCatalogue([
      catalogueRow(
        "legacy",
        [
          { url: "https://cdn/a.jpg" },
          { url: "https://cdn/b.jpg", sort_order: 1 },
          { url: "https://cdn/c.jpg", sort_order: 2 },
        ],
        "https://cdn/main.jpg",
      ),
    ]);
    const [project] = await ProjectService.listActive();

    expect(project.image).toBe("https://cdn/main.jpg");
    expect(project.gallery).toHaveLength(3);
  });

  it("orders a card gallery deterministically, and identically on replay", async () => {
    const seed = () =>
      stubCatalogue([
        catalogueRow(
          "p",
          [
            { url: "https://cdn/c.jpg", sort_order: 9, semantic_role: "property_exterior" },
            { url: "https://cdn/a.jpg", sort_order: 1, semantic_role: "property_exterior" },
            { url: "https://cdn/b.jpg", sort_order: 5, semantic_role: "amenity" },
          ],
          null,
        ),
      ]);

    seed();
    const first = (await ProjectService.listActive())[0].gallery;
    seed();
    const second = (await ProjectService.listActive())[0].gallery;

    expect(first).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"]);
    expect(second).toEqual(first);
  });

  it("refuses every prohibited role, one at a time", async () => {
    for (const role of GALLERY_EXCLUDED_ROLES) {
      stubCatalogue([
        catalogueRow("p", [{ url: `https://cdn/${role}.jpg`, semantic_role: role }], null),
      ]);
      const [project] = await ProjectService.listActive();
      expect(project.image, `${role} must not become a card image`).toBe("");
      expect(project.gallery, `${role} must not enter a card gallery`).toEqual([]);
    }
  });

  /**
   * NEGATIVE CONTROL — one unsafe catalogue reader, restored.
   *
   * This is the exact expression `mapToProperty` used before this change:
   * select on `media_type`, ignore the role. If the real reader ever agrees with
   * it again on this fixture, the catalogue half of the contract is gone.
   */
  it("negative control: the media_type-only catalogue reader is detectably wrong", async () => {
    stubCatalogue([catalogueRow("coralina", CORALINA, "https://cdn/coralina-launch.jpg")]);
    const [project] = await ProjectService.listActive();

    const unsafeGallery = CORALINA.filter(
      (item) => (item.media_type ?? "gallery") === "gallery" || item.media_type === "cover",
    ).map((item) => item.url);
    const unsafeImage = "https://cdn/coralina-launch.jpg";

    expect(unsafeGallery).toContain("https://cdn/coralina-team.jpg");
    expect(unsafeImage).toBe("https://cdn/coralina-launch.jpg");
    expect(project.gallery).not.toEqual(unsafeGallery);
    expect(project.image).not.toBe(unsafeImage);
  });
});

// ---------------------------------------------------------------------------
// Surface: Open Graph, Twitter and JSON-LD
// ---------------------------------------------------------------------------

describe("the image that leaves the site", () => {
  const detail = (media: MediaSeed[], mainImageUrl: string | null) =>
    makeProjectDetail({
      media: groupProjectMedia(media.map(detailRow), { projectId: "p-1", mainImageUrl }),
    });

  it("is the same list the page renders, not a second expression of it", () => {
    const project = detail(SIERRA, "https://cdn/sierra-holiday-moments.png");
    expect(projectSocialImage(project)).toBe(projectPhotographs(project)[0]?.url);
  });

  it("Sierra: the social image is the exterior, never the seasonal graphic", () => {
    const project = detail(SIERRA, "https://cdn/sierra-holiday-moments.png");
    expect(projectSocialImage(project)).toBe("https://cdn/sierra-exterior.jpg");
  });

  it("Coralina: the social image is the entrance, never the launch party", () => {
    const project = detail(CORALINA, "https://cdn/coralina-launch.jpg");
    expect(projectSocialImage(project)).toBe("https://cdn/coralina-entrance.jpg");
  });

  it("Villa Kirara: there is no social image, so no og:image is emitted", () => {
    const project = detail(VILLA_KIRARA, null);
    expect(projectSocialImage(project)).toBeNull();
  });

  it("omits the JSON-LD image entirely rather than emitting an empty one", () => {
    const project = detail(VILLA_KIRARA, null);
    const scripts = buildProjectStructuredData(project, "https://forever.example/projects/k");
    for (const script of scripts) {
      const payload = JSON.parse(script.children) as Record<string, unknown>;
      expect(payload).not.toHaveProperty("image");
    }
    expect(JSON.stringify(scripts)).not.toContain("kirara-launch");
  });

  it("emits the eligible image in both the Product and the Place block", () => {
    const project = detail(SIERRA, "https://cdn/sierra-holiday-moments.png");
    const image = projectSocialImage(project) ?? undefined;
    const scripts = buildProjectStructuredData(
      project,
      "https://forever.example/projects/s",
      image,
    );
    const payloads = scripts.map(
      (script) => JSON.parse(script.children) as Record<string, unknown>,
    );

    expect(payloads[0].image).toEqual(["https://cdn/sierra-exterior.jpg"]);
    expect(payloads[1].image).toBe("https://cdn/sierra-exterior.jpg");
    expect(JSON.stringify(payloads)).not.toContain("holiday-moments");
  });

  /**
   * NEGATIVE CONTROL — one unsafe OG/JSON-LD reader, restored.
   *
   * The route used to compute its own `hero ?? gallery[0]` from the raw rows.
   * Reconstructed here over the unfiltered set, it returns the seasonal graphic.
   */
  it("negative control: an OG reader over unfiltered rows is detectably wrong", () => {
    const project = detail(SIERRA, "https://cdn/sierra-holiday-moments.png");
    const unsafe =
      SIERRA.find((item) => item.media_type === "cover")?.url ??
      SIERRA.find((item) => (item.media_type ?? "gallery") === "gallery")?.url;

    expect(unsafe).toBe("https://cdn/sierra-holiday-moments.png");
    expect(projectSocialImage(project)).not.toBe(unsafe);

    const scripts = buildProjectStructuredData(project, "https://forever.example/p", unsafe);
    // The unsafe value only reaches JSON-LD if a caller hands it over — which is
    // why the route now has exactly one place to get it from.
    expect(JSON.stringify(scripts)).toContain("holiday-moments");
  });
});

// ---------------------------------------------------------------------------
// The sibling row
// ---------------------------------------------------------------------------

/**
 * The shape the migration itself says re-published projects already have: one
 * URL carried by BOTH a `cover` row and a `gallery` row.
 *
 * A per-row filter is theatre against it. `presentableCoverUrl` refuses the
 * cover because its row records `text_promo`; the sibling gallery row for the
 * identical URL is still role-less, passes on its own terms, and
 * `hero: cover ?? gallery[0]` hands the page the graphic anyway.
 *
 * So the rule is per URL: if ANY row records a prohibited role for a URL, that
 * URL is prohibited everywhere.
 */
describe("one URL on two rows", () => {
  const SIERRA_SIBLING: MediaSeed[] = [
    {
      media_type: "cover",
      url: "https://cdn/sierra-holiday-moments.png",
      semantic_role: "text_promo",
    },
    // The same image, published again as a gallery entry, still unclassified.
    { media_type: "gallery", url: "https://cdn/sierra-holiday-moments.png", sort_order: 1 },
    { url: "https://cdn/sierra-exterior.jpg", semantic_role: "property_exterior", sort_order: 2 },
  ];

  it("cannot re-enter the project page through its role-less sibling", () => {
    const media = groupProjectMedia(SIERRA_SIBLING.map(detailRow), {
      projectId: "sierra",
      mainImageUrl: "https://cdn/sierra-holiday-moments.png",
    });

    expect(JSON.stringify(media)).not.toContain("holiday-moments");
    expect(media.hero?.url).toBe("https://cdn/sierra-exterior.jpg");
  });

  it("cannot re-enter a catalogue card through its role-less sibling", async () => {
    stubCatalogue([
      catalogueRow("sierra", SIERRA_SIBLING, "https://cdn/sierra-holiday-moments.png"),
    ]);
    const [project] = await ProjectService.listActive();

    expect(JSON.stringify(project)).not.toContain("holiday-moments");
    expect(project.image).toBe("https://cdn/sierra-exterior.jpg");
  });

  it("cannot re-enter og:image or JSON-LD through its role-less sibling", () => {
    const project = makeProjectDetail({
      media: groupProjectMedia(SIERRA_SIBLING.map(detailRow), {
        projectId: "sierra",
        mainImageUrl: "https://cdn/sierra-holiday-moments.png",
      }),
    });
    const image = projectSocialImage(project) ?? undefined;
    expect(image).toBe("https://cdn/sierra-exterior.jpg");
    expect(
      JSON.stringify(buildProjectStructuredData(project, "https://forever.example/p", image)),
    ).not.toContain("holiday-moments");
  });

  /**
   * NEGATIVE CONTROL — the per-row rule, restored.
   *
   * Judged one row at a time, the sibling passes. If the real reader ever agrees
   * with this on the fixture above, the per-URL rule is gone.
   */
  it("negative control: judging each row alone lets the graphic back in", () => {
    const perRowSurvivors = SIERRA_SIBLING.filter(
      (item) => !item.semantic_role || item.semantic_role === "property_exterior",
    ).map((item) => item.url);
    expect(perRowSurvivors).toContain("https://cdn/sierra-holiday-moments.png");

    const media = groupProjectMedia(SIERRA_SIBLING.map(detailRow), {
      projectId: "sierra",
      mainImageUrl: null,
    });
    expect(media.gallery.map((item) => item.url)).not.toEqual(perRowSurvivors);
  });

  /**
   * Retirement is NOT part of the per-URL rule, and must not become part of it.
   *
   * `superseded_cover` withdraws a designation, not an image. Coralina's previous
   * cover is a fine exterior photograph and belongs in the gallery it was
   * promoted out of — deleting it would be the mirror image of the defect this
   * contract exists to fix.
   */
  it("keeps a demoted cover in the gallery, because retirement is not a verdict on the image", () => {
    const media = groupProjectMedia(
      [
        detailRow({
          media_type: "superseded_cover",
          url: "https://cdn/coralina-old-exterior.jpg",
          semantic_role: "property_exterior",
        }),
        detailRow({
          media_type: "gallery",
          url: "https://cdn/coralina-old-exterior.jpg",
          semantic_role: "property_exterior",
          sort_order: 1,
        }),
        detailRow({
          media_type: "cover",
          url: "https://cdn/coralina-new-exterior.jpg",
          semantic_role: "property_exterior",
          sort_order: 2,
        }),
      ],
      { projectId: "coralina", mainImageUrl: "https://cdn/coralina-new-exterior.jpg" },
    );

    expect(media.hero?.url).toBe("https://cdn/coralina-new-exterior.jpg");
    expect(media.gallery.map((item) => item.url)).toContain(
      "https://cdn/coralina-old-exterior.jpg",
    );
    // The retired ROW is gone; the image it named is not.
    expect(media.gallery.filter((item) => item.type === "superseded_cover")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Surface: the sections that are not the gallery
// ---------------------------------------------------------------------------

describe("plans, maps and documents", () => {
  it("survive the contract, because the gallery deny-list is not the floor", () => {
    const media = groupProjectMedia(
      [
        detailRow({ media_type: "floor_plan", url: "https://cdn/fp.jpg", semantic_role: "plan" }),
        detailRow({ media_type: "master_plan", url: "https://cdn/mp.pdf", semantic_role: "plan" }),
        detailRow({ media_type: "unit_plan", url: "https://cdn/up.pdf", semantic_role: "plan" }),
        detailRow({ media_type: "document", url: "https://cdn/map.png", semantic_role: "map" }),
        detailRow({
          media_type: "brochure",
          url: "https://cdn/br.pdf",
          semantic_role: "text_promo",
        }),
      ],
      { projectId: "p-1", mainImageUrl: null },
    );

    expect(media.floorPlans).toHaveLength(1);
    expect(media.masterPlan?.url).toBe("https://cdn/mp.pdf");
    expect(media.unitPlans).toHaveLength(1);
    expect(media.brochures).toHaveLength(1);
    expect(media.documents.map((d) => d.url)).toContain("https://cdn/map.png");
    // And none of them is a photograph.
    expect(media.gallery).toEqual([]);
  });

  /**
   * `ProjectFloorPlans` and `ProjectLocation` render their rows as `<img>` tiles,
   * so a launch-party photograph misfiled as a floor plan is a launch-party
   * photograph on the project page, reached through a section the gallery
   * contract never covered.
   */
  it("drop a row whose recorded subject is people, whatever section claims it", () => {
    const media = groupProjectMedia(
      [
        detailRow({
          media_type: "floor_plan",
          url: "https://cdn/party.jpg",
          semantic_role: "event",
        }),
        detailRow({
          media_type: "document",
          url: "https://cdn/team.jpg",
          semantic_role: "group_photo",
        }),
        detailRow({ media_type: "floor_plan", url: "https://cdn/real.jpg", semantic_role: "plan" }),
      ],
      { projectId: "p-1", mainImageUrl: null },
    );

    expect(media.floorPlans.map((item) => item.url)).toEqual(["https://cdn/real.jpg"]);
    expect(JSON.stringify(media)).not.toContain("party.jpg");
    expect(JSON.stringify(media)).not.toContain("team.jpg");
  });

  it("keep the catalogue reader symmetric with the detail reader", async () => {
    stubCatalogue([
      catalogueRow(
        "p",
        [
          { media_type: "floor_plan", url: "https://cdn/party.jpg", semantic_role: "event" },
          { media_type: "floor_plan", url: "https://cdn/real.jpg", semantic_role: "plan" },
          { media_type: "video", url: "https://cdn/launch.mp4", semantic_role: "event" },
        ],
        null,
      ),
    ]);
    const [project] = await ProjectService.listActive();

    expect(project.floorPlans).toEqual(["https://cdn/real.jpg"]);
    expect(project.videos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Surface: the project page's own sections
// ---------------------------------------------------------------------------

describe("the project page", () => {
  it("gives the mosaic and the lightbox the identical filtered list", () => {
    const project = makeProjectDetail({
      media: groupProjectMedia(CORALINA.map(detailRow), {
        projectId: "p-1",
        mainImageUrl: "https://cdn/coralina-launch.jpg",
      }),
    });
    // `ProjectTopSection` computes this once and passes the same array to both.
    const photographs = projectPhotographs(project);
    expect(photographs.map((item) => item.url)).toEqual([
      "https://cdn/coralina-entrance.jpg",
      "https://cdn/coralina-aerial.jpg",
    ]);
  });

  it("offers no photographs section when every photograph is prohibited", () => {
    const media = groupProjectMedia(VILLA_KIRARA.map(detailRow), {
      projectId: "p-1",
      mainImageUrl: null,
    });
    const project = makeProjectDetail({ media });
    expect(projectPhotographs(project)).toEqual([]);
    // The mosaic renders `project-media-empty` for an empty list, and the plans
    // and documents keep their own sections.
    expect(media.floorPlans).toHaveLength(1);
    expect(media.documents.length).toBeGreaterThan(0);
  });
});

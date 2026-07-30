import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import type {
  DecisionDeckDocument,
  DecisionDeckFullPassport,
  DecisionDeckMediaAsset,
  DecisionDeckPlans,
  DecisionDeckRelatedProject,
  DecisionDeckUpdate,
  DecisionDeckValue,
} from "../decision-deck-model";
import type { ProjectAmenity } from "../project-detail-types";
import { ProjectDecisionAmenities } from "./ProjectDecisionAmenities";
import { ProjectDecisionDocuments } from "./ProjectDecisionDocuments";
import { ProjectFeaturedAmenities } from "./ProjectFeaturedAmenities";
import { ProjectFilm } from "./ProjectFilm";
import { ProjectFullPassport } from "./ProjectFullPassport";
import { ProjectPlans } from "./ProjectPlans";
import { ProjectRelatedProjects } from "./ProjectRelatedProjects";
import { ProjectUpdates } from "./ProjectUpdates";

function supported<T>(value: T): DecisionDeckValue<T> {
  return { state: "supported", value };
}

function unavailable<T>(): DecisionDeckValue<T> {
  return { state: "unavailable", reason: "not-recorded" };
}

function mediaAsset(overrides: Partial<DecisionDeckMediaAsset> = {}): DecisionDeckMediaAsset {
  return {
    id: "asset",
    type: "gallery",
    url: "https://cdn.example.com/asset.jpg",
    sortOrder: 0,
    semanticRole: null,
    label: "Generated media label",
    source: "public-project-media",
    ...overrides,
  };
}

async function renderInRouter(ui: ReactNode, visibleText: string) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByText(visibleText)).toBeInTheDocument());
}

describe("Decision Deck supporting sections", () => {
  it("renders supported featured amenities with safe notes and neutral markers", () => {
    const amenities: ProjectAmenity[] = [
      {
        id: "pool",
        slug: "pool",
        name: "Swimming pool",
        category: "Pools",
        icon: "check",
        note: "Recorded on the canonical amenity relation.",
        isFeatured: true,
        sortOrder: 1,
      },
      {
        id: "lounge",
        slug: "lounge",
        name: "Residents' lounge",
        category: "Shared spaces",
        icon: "unknown-token",
        note: "",
        isFeatured: true,
        sortOrder: 2,
      },
    ];

    const { rerender } = render(<ProjectFeaturedAmenities amenities={supported(amenities)} />);

    const section = screen.getByTestId("featured-amenities");
    expect(section).toHaveAttribute("id", "featured-amenities");
    expect(section).toHaveAttribute("data-decision-deck-section");
    expect(section).toHaveClass("py-11", "sm:py-16");
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(section.querySelectorAll('[data-amenity-marker="neutral"]')).toHaveLength(2);
    expect(section).toHaveTextContent("Recorded on the canonical amenity relation.");

    rerender(
      <ProjectFeaturedAmenities
        amenities={{ state: "empty", reason: "no-featured-canonical-amenities" }}
      />,
    );
    expect(screen.queryByTestId("featured-amenities")).toBeNull();
  });

  it("uses a stable native film player without autoplay or eager loading", () => {
    const film = mediaAsset({
      id: "film",
      type: "video",
      url: "https://cdn.example.com/project.webm",
      label: "Source title must not be required",
    });
    const { rerender } = render(<ProjectFilm film={film} />);

    const section = screen.getByTestId("project-film");
    const video = section.querySelector("video");
    expect(section).toHaveAttribute("id", "film");
    expect(section).toHaveClass("py-11", "sm:py-16");
    expect(section.querySelector(".aspect-video")).not.toBeNull();
    expect(video).toHaveAttribute("src", film.url);
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");

    rerender(<ProjectFilm film={null} />);
    expect(screen.queryByTestId("project-film")).toBeNull();
  });

  it("opens image plans in a lightbox and PDFs as external links with generic labels", async () => {
    const image = mediaAsset({
      id: "master",
      type: "master_plan",
      url: "https://cdn.example.com/master.png",
      label: "PRIVATE SOURCE MASTER TITLE",
    });
    const pdf = mediaAsset({
      id: "unit",
      type: "unit_plan",
      url: "https://cdn.example.com/unit.pdf?version=2",
      label: "PRIVATE SOURCE UNIT TITLE",
    });
    const plans: DecisionDeckPlans = {
      categories: [
        {
          id: "master-plan",
          label: "PRIVATE CATEGORY LABEL",
          items: [image],
        },
        {
          id: "unit-plans",
          label: "PRIVATE UNIT CATEGORY",
          items: [pdf],
        },
      ],
      all: supported([image, pdf]),
    };

    render(<ProjectPlans plans={plans} />);

    const section = screen.getByTestId("project-plans");
    expect(section).toHaveAttribute("id", "plans");
    expect(section).toHaveClass("py-11", "sm:py-16");
    expect(section).toHaveTextContent("Master plan");
    expect(section).toHaveTextContent("Unit plan");
    expect(section).not.toHaveTextContent(/PRIVATE/);

    const pdfLink = within(section).getByRole("link", { name: "Open Unit plan PDF" });
    expect(pdfLink).toHaveAttribute("href", pdf.url);
    expect(pdfLink).toHaveAttribute("target", "_blank");
    expect(pdfLink).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(within(section).getByRole("button", { name: "View Master plan" }));
    await waitFor(() => expect(screen.getByTestId("project-lightbox")).toBeInTheDocument());
    expect(
      within(screen.getByTestId("project-lightbox")).getByRole("img", {
        name: "Master plan",
      }),
    ).toHaveAttribute("src", image.url);
  });

  it("renders supported structured updates and hides unsupported states", () => {
    const updates: readonly DecisionDeckUpdate[] = [
      { type: "price-list", label: "Price list updated", date: "2026-07-28" },
    ];
    const { rerender } = render(<ProjectUpdates updates={supported(updates)} />);

    const section = screen.getByTestId("project-updates");
    expect(section).toHaveAttribute("id", "updates");
    expect(section).toHaveTextContent("Price list updated");
    expect(section).toHaveTextContent("2026-07-28");

    rerender(<ProjectUpdates updates={{ state: "unavailable", reason: "unsupported" }} />);
    expect(screen.queryByTestId("project-updates")).toBeNull();
  });

  it("renders the full Passport only as detailed evidence, not a compact-strip duplicate", () => {
    const passport: DecisionDeckFullPassport = {
      foreverId: supported("FOREVER-EXAMPLE"),
      overallScore: unavailable(),
      verdict: unavailable(),
      coreDimensions: supported([{ id: "trust", label: "Trust", value: 8.4 }]),
      buyerProfile: unavailable(),
      listedAvailability: unavailable(),
      lastInspection: unavailable(),
      lastPriceUpdate: unavailable(),
      advisorySummary: unavailable(),
      riskSummary: unavailable(),
    };

    render(<ProjectFullPassport passport={passport} />);

    const section = screen.getByTestId("full-passport");
    expect(section).toHaveTextContent("Evidence interpretation");
    expect(section).toHaveTextContent("Trust");
    expect(section).toHaveTextContent("8.4");
    expect(section).not.toHaveTextContent("FOREVER-EXAMPLE");
    expect(section).not.toHaveTextContent("Recorded inventory");
  });

  it("preserves full-amenity global order across category changes", () => {
    const amenities: ProjectAmenity[] = [
      {
        id: "x-0",
        slug: "x-0",
        name: "First",
        category: "X",
        icon: "",
        note: "",
        isFeatured: false,
        sortOrder: 0,
      },
      {
        id: "y-1",
        slug: "y-1",
        name: "Second",
        category: "Y",
        icon: "",
        note: "",
        isFeatured: false,
        sortOrder: 1,
      },
      {
        id: "x-2",
        slug: "x-2",
        name: "Third",
        category: "X",
        icon: "",
        note: "",
        isFeatured: false,
        sortOrder: 2,
      },
    ];

    render(<ProjectDecisionAmenities amenities={supported(amenities)} />);
    expect(
      within(screen.getByTestId("full-amenities"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["XFirst", "YSecond", "XThird"]);
  });

  it("builds deterministic ordinary project links without ranking language", async () => {
    const related: readonly DecisionDeckRelatedProject[] = [
      { slug: "alpha", name: "Alpha", location: "Bang Tao" },
      { slug: "beta", name: "Beta", location: "Rawai" },
    ];

    await renderInRouter(
      <ProjectRelatedProjects related={supported(related)} />,
      "Related projects",
    );

    const section = screen.getByTestId("related-projects");
    const links = within(section).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/projects/alpha",
      "/projects/beta",
    ]);
    expect(section).not.toHaveTextContent(/best fit|match/i);
  });

  it("regenerates document labels and never renders supplied labels or notes", () => {
    const documents: readonly DecisionDeckDocument[] = [
      {
        id: "brochure-1",
        type: "brochure",
        url: "https://cdn.example.com/brochure-1.pdf",
        label: "PRIVATE SOURCE TITLE",
      },
      {
        id: "brochure-2",
        type: "brochure",
        url: "https://cdn.example.com/brochure-2.pdf",
        label: "C:\\private\\owner-copy.pdf",
      },
    ];

    render(<ProjectDecisionDocuments documents={supported(documents)} />);

    const section = screen.getByTestId("project-documents");
    expect(section).toHaveAttribute("id", "documents");
    expect(section).toHaveClass("py-11", "sm:py-16");
    expect(section).toHaveTextContent("Brochure");
    expect(section).toHaveTextContent("Brochure 2");
    expect(section).not.toHaveTextContent(/PRIVATE|C:\\private/);
    expect(within(section).getAllByRole("link")).toHaveLength(2);
  });
});

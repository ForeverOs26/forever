/**
 * FOREVER-STUDIO-AMENITIES-CORE-001 — the Facilities & Amenities editor.
 *
 * The behaviours asserted here are the ones that decide whether the Owner can
 * trust the section with real work:
 *
 *   * a failed save keeps every local edit — the Owner's copy is the only copy;
 *   * a successful save re-hydrates from the CANONICAL state and clears the
 *     unsaved-changes marker;
 *   * an empty selection is saveable, because "this project has no amenities" is
 *     a statement the Owner is allowed to make;
 *   * the 8-featured ceiling is visible in the UI, not discovered as a server
 *     refusal;
 *   * a failed creation never discards the selections already staged beside it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getAmenities: vi.fn(),
  saveAmenities: vi.fn(),
}));

vi.mock("../studio.functions", () => ({
  studioGetProjectAmenities: endpoints.getAmenities,
  studioSaveProjectAmenities: endpoints.saveAmenities,
}));

import { StudioProjectAmenitiesEditor } from "../components/StudioProjectAmenitiesEditor";

const CATALOGUE = [
  { id: "1", slug: "swimming-pool", name: "Swimming Pool", category: "Leisure", icon: "waves" },
  { id: "2", slug: "kids-pool", name: "Kids Pool", category: "Leisure", icon: "baby" },
  {
    id: "3",
    slug: "fitness-centre",
    name: "Fitness Centre",
    category: "Wellness",
    icon: "dumbbell",
  },
  { id: "4", slug: "spa", name: "Spa", category: "Wellness", icon: "flower" },
  { id: "5", slug: "concierge", name: "Concierge", category: "Services", icon: "bell" },
  { id: "6", slug: "co-working-space", name: "Co-working Space", category: "", icon: "" },
];

function selectedRow(
  slug: string,
  overrides: { note?: string; isFeatured?: boolean; sortOrder?: number; icon?: string } = {},
) {
  const entry = CATALOGUE.find((row) => row.slug === slug);
  return {
    amenityId: entry?.id ?? `id-${slug}`,
    slug,
    name: entry?.name ?? slug,
    category: entry?.category ?? "",
    icon: overrides.icon ?? entry?.icon ?? "",
    note: overrides.note ?? "",
    isFeatured: overrides.isFeatured ?? false,
    sortOrder: overrides.sortOrder ?? 0,
  };
}

type SelectedRow = ReturnType<typeof selectedRow>;

function loadWith(selected: SelectedRow[], catalogue = CATALOGUE) {
  endpoints.getAmenities.mockResolvedValue({ slug: "modeva", catalogue, selected });
}

function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <StudioProjectAmenitiesEditor slug="modeva" />
    </QueryClientProvider>,
  );
  return { queryClient, view };
}

/** The rendered selection, in the order the cards appear. */
function renderedSelection(): string[] {
  return screen
    .getAllByTestId(/^amenity-row-/)
    .map((node) => node.getAttribute("data-testid")!.replace("amenity-row-", ""));
}

function saveResult(selected: SelectedRow[], createdAmenitySlugs: string[] = []) {
  return {
    slug: "modeva",
    selected,
    selectedCount: selected.length,
    featuredCount: selected.filter((row) => row.isFeatured).length,
    createdAmenitySlugs,
  };
}

/**
 * Resolves once the query has settled and the editor is interactive. The
 * heading renders in the loading and error states too, so waiting on it would
 * let a test run against a half-rendered section.
 */
async function loaded() {
  await screen.findByTestId("amenity-counts");
}

/**
 * Expand the "Create a new amenity" disclosure, as a user would. Its contents
 * are inside a closed `<details>` until then, which counts as not visible.
 */
function openCreateForm() {
  const disclosure = screen.getByTestId("amenity-create") as HTMLDetailsElement;
  if (!disclosure.open) fireEvent.click(screen.getByText("Create a new amenity"));
  if (!disclosure.open) disclosure.open = true;
}

describe("StudioProjectAmenitiesEditor", () => {
  beforeEach(() => {
    endpoints.getAmenities.mockReset();
    endpoints.saveAmenities.mockReset();
  });

  it("renders the buyer-facing heading and loads the existing selection", async () => {
    loadWith([
      selectedRow("swimming-pool", { note: "Two lap pools", isFeatured: true, sortOrder: 10 }),
      selectedRow("spa", { note: "By appointment", sortOrder: 10 }),
    ]);
    renderEditor();

    expect(await screen.findByRole("heading", { name: "Facilities & Amenities" })).toBeVisible();
    await loaded();
    expect(renderedSelection()).toEqual(["swimming-pool", "spa"]);
    expect(screen.getByLabelText("Note for Swimming Pool")).toHaveValue("Two lap pools");
    expect(screen.getByLabelText("Note for Spa")).toHaveValue("By appointment");
    expect(screen.getByText("Featured")).toBeVisible();
    // Nothing has been touched, so nothing is unsaved.
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("shows the selected count and the featured count out of the ceiling", async () => {
    loadWith([
      selectedRow("swimming-pool", { isFeatured: true, sortOrder: 10 }),
      selectedRow("kids-pool", { isFeatured: true, sortOrder: 20 }),
      selectedRow("spa", { sortOrder: 10 }),
    ]);
    renderEditor();
    await loaded();
    expect(screen.getByTestId("amenity-counts")).toHaveTextContent("3 selected · 2 / 8 featured");
  });

  it("degrades to one inline line when the read fails, and never throws", async () => {
    endpoints.getAmenities.mockRejectedValue(new Error("studio_access_denied"));
    renderEditor();
    expect(await screen.findByRole("heading", { name: "Facilities & Amenities" })).toBeVisible();
    expect(await screen.findByText(/Amenities could not be loaded/)).toBeVisible();
  });

  it("keeps unsaved edits on screen when a REFETCH fails, not just when a save does", async () => {
    // The distinction matters. A failed initial load has nothing to preserve, so
    // the error line may own the section. A failed refetch happens when the
    // editor is already hydrated and the Owner may have work in progress — and
    // refetches are routine here, because a successful save invalidates
    // `["studio","project",slug]`, a prefix that matches this query. If the error
    // line took over then, the edits would still be in state but invisible,
    // which reads as data loss.
    loadWith([selectedRow("swimming-pool", { sortOrder: 10 })]);
    const { queryClient } = renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Add Spa" }));
    fireEvent.change(screen.getByLabelText("Note for Spa"), {
      target: { value: "Work in progress" },
    });
    expect(screen.getByText("Unsaved changes")).toBeVisible();

    // Now the next read fails and something invalidates the query.
    endpoints.getAmenities.mockRejectedValue(new Error("network"));
    await queryClient.invalidateQueries({ queryKey: ["studio", "project", "modeva"] });

    await waitFor(() => expect(screen.getByTestId("amenity-stale")).toBeVisible());
    // The editor is still an editor, and every edit survived.
    expect(screen.queryByText(/Amenities could not be loaded/)).not.toBeInTheDocument();
    expect(renderedSelection()).toEqual(["swimming-pool", "spa"]);
    expect(screen.getByLabelText("Note for Spa")).toHaveValue("Work in progress");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    // And it is still saveable — a stale read does not lock the Owner out.
    expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();
  });

  it("filters the catalogue by search over both name and slug", async () => {
    loadWith([]);
    renderEditor();
    await loaded();

    expect(screen.getByRole("button", { name: "Add Spa" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Add an amenity"), { target: { value: "pool" } });
    expect(screen.getByRole("button", { name: "Add Kids Pool" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Swimming Pool" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add Spa" })).not.toBeInTheDocument();

    // The slug matches even when the display name does not contain the text.
    fireEvent.change(screen.getByLabelText("Add an amenity"), {
      target: { value: "fitness-centre" },
    });
    expect(screen.getByRole("button", { name: "Add Fitness Centre" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add Kids Pool" })).not.toBeInTheDocument();
  });

  it("filters the catalogue by category, offering only the categories that exist", async () => {
    loadWith([]);
    renderEditor();
    await loaded();

    const filter = screen.getByLabelText("Filter by category");
    expect(
      within(filter)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All categories", "Leisure", "Services", "Wellness"]);

    fireEvent.change(filter, { target: { value: "Wellness" } });
    expect(screen.getByRole("button", { name: "Add Spa" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Fitness Centre" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add Kids Pool" })).not.toBeInTheDocument();
  });

  it("adds a selection unfeatured with a renumbered order, and removes it again", async () => {
    loadWith([selectedRow("swimming-pool", { isFeatured: true, sortOrder: 10 })]);
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Add Spa" }));
    expect(renderedSelection()).toEqual(["swimming-pool", "spa"]);
    expect(screen.getByTestId("amenity-counts")).toHaveTextContent("2 selected · 1 / 8 featured");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    // An added amenity is offered as "Feature Spa", i.e. it arrived unfeatured.
    expect(screen.getByRole("button", { name: "Feature Spa" })).toBeVisible();
    // It is no longer offered by the picker.
    expect(screen.queryByRole("button", { name: "Add Spa" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Spa" }));
    expect(renderedSelection()).toEqual(["swimming-pool"]);
    expect(screen.getByRole("button", { name: "Add Spa" })).toBeVisible();
  });

  it("keeps an edited note in local state", async () => {
    loadWith([selectedRow("spa", { sortOrder: 10 })]);
    renderEditor();
    await loaded();

    fireEvent.change(screen.getByLabelText("Note for Spa"), {
      target: { value: "Two treatment rooms" },
    });
    expect(screen.getByLabelText("Note for Spa")).toHaveValue("Two treatment rooms");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("features and unfeatures an amenity, moving it to the head of the list", async () => {
    loadWith([
      selectedRow("swimming-pool", { sortOrder: 10 }),
      selectedRow("spa", { sortOrder: 20 }),
    ]);
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Feature Spa" }));
    // Featured amenities lead the public list, so the card leads the editor too.
    expect(renderedSelection()).toEqual(["spa", "swimming-pool"]);
    expect(screen.getByTestId("amenity-counts")).toHaveTextContent("2 selected · 1 / 8 featured");

    fireEvent.click(screen.getByRole("button", { name: "Unfeature Spa" }));
    expect(screen.getByTestId("amenity-counts")).toHaveTextContent("2 selected · 0 / 8 featured");
  });

  it("blocks a ninth featured amenity in the UI and says why", async () => {
    const eight = ["swimming-pool", "kids-pool", "fitness-centre", "spa"].map((slug, index) =>
      selectedRow(slug, { isFeatured: true, sortOrder: (index + 1) * 10 }),
    );
    // Four catalogue rows plus four synthetic ones make up the eight featured.
    const extraCatalogue = Array.from({ length: 4 }, (_unused, index) => ({
      id: `x${index}`,
      slug: `extra-${index}`,
      name: `Extra ${index}`,
      category: "Leisure",
      icon: "",
    }));
    loadWith(
      [
        ...eight,
        ...extraCatalogue.map((row, index) => ({
          amenityId: row.id,
          slug: row.slug,
          name: row.name,
          category: row.category,
          icon: row.icon,
          note: "",
          isFeatured: true,
          sortOrder: (index + 5) * 10,
        })),
        selectedRow("concierge", { sortOrder: 10 }),
      ],
      [...CATALOGUE, ...extraCatalogue],
    );
    renderEditor();
    await loaded();

    expect(screen.getByTestId("amenity-counts")).toHaveTextContent("9 selected · 8 / 8 featured");
    // The one unfeatured row cannot become the ninth.
    expect(screen.getByRole("button", { name: "Feature Concierge" })).toBeDisabled();
    expect(screen.getByText(/At most 8 amenities can be featured/)).toBeVisible();
    // Unfeaturing is still available — that is how the Owner makes room.
    expect(screen.getByRole("button", { name: "Unfeature Spa" })).toBeEnabled();
  });

  it("reorders within a group and refuses to cross the group boundary", async () => {
    loadWith([
      selectedRow("swimming-pool", { isFeatured: true, sortOrder: 10 }),
      selectedRow("kids-pool", { isFeatured: true, sortOrder: 20 }),
      selectedRow("spa", { sortOrder: 10 }),
      selectedRow("concierge", { sortOrder: 20 }),
    ]);
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Move Concierge up" }));
    expect(renderedSelection()).toEqual(["swimming-pool", "kids-pool", "concierge", "spa"]);

    // The first row of each group has nowhere to rise to.
    expect(screen.getByRole("button", { name: "Move Swimming Pool up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Concierge up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Spa down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Swimming Pool down" }));
    expect(renderedSelection()).toEqual(["kids-pool", "swimming-pool", "concierge", "spa"]);
  });

  it("saves the exact final set and clears the unsaved-changes marker", async () => {
    loadWith([selectedRow("swimming-pool", { note: "Two lap pools", sortOrder: 10 })]);
    const committed = [
      selectedRow("swimming-pool", { note: "Two lap pools", isFeatured: true, sortOrder: 10 }),
      selectedRow("spa", { sortOrder: 10 }),
    ];
    endpoints.saveAmenities.mockResolvedValue(saveResult(committed));
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Add Spa" }));
    fireEvent.click(screen.getByRole("button", { name: "Feature Swimming Pool" }));
    expect(screen.getByText("Unsaved changes")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save amenities" }));

    await waitFor(() => expect(endpoints.saveAmenities).toHaveBeenCalledTimes(1));
    expect(endpoints.saveAmenities).toHaveBeenCalledWith({
      data: {
        slug: "modeva",
        amenities: [
          { slug: "swimming-pool", note: "Two lap pools", isFeatured: true, sortOrder: 10 },
          { slug: "spa", note: "", isFeatured: false, sortOrder: 10 },
        ],
        createdAmenities: [],
      },
    });
    // Re-hydrated from the canonical result, so nothing is outstanding.
    await waitFor(() => expect(screen.getByText("Saved.")).toBeVisible());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(renderedSelection()).toEqual(["swimming-pool", "spa"]);
  });

  it("swaps the Save label while the save is in flight", async () => {
    loadWith([selectedRow("spa", { sortOrder: 10 })]);
    let release!: () => void;
    endpoints.saveAmenities.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(saveResult([selectedRow("spa", { sortOrder: 10 })]));
      }),
    );
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Save amenities" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save amenities" })).toBeVisible(),
    );
  });

  it("PRESERVES every local edit when the save fails, and shows the refusal", async () => {
    loadWith([selectedRow("swimming-pool", { note: "Two lap pools", sortOrder: 10 })]);
    endpoints.saveAmenities.mockRejectedValue(new Error("At most 8 amenities can be featured."));
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Add Spa" }));
    fireEvent.change(screen.getByLabelText("Note for Spa"), { target: { value: "Draft note" } });
    fireEvent.click(screen.getByRole("button", { name: "Feature Spa" }));

    fireEvent.click(screen.getByRole("button", { name: "Save amenities" }));
    expect(await screen.findByText("At most 8 amenities can be featured.")).toBeVisible();

    // Nothing was reset from the server: the selection, the note and the
    // featured flag are all exactly as the Owner left them, and the work is
    // still marked unsaved.
    expect(renderedSelection()).toEqual(["spa", "swimming-pool"]);
    expect(screen.getByLabelText("Note for Spa")).toHaveValue("Draft note");
    expect(screen.getByLabelText("Note for Swimming Pool")).toHaveValue("Two lap pools");
    expect(screen.getByRole("button", { name: "Unfeature Spa" })).toBeVisible();
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it("saves an empty selection — Save is never disabled for having nothing selected", async () => {
    loadWith([selectedRow("spa", { sortOrder: 10 })]);
    endpoints.saveAmenities.mockResolvedValue(saveResult([]));
    renderEditor();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove Spa" }));
    expect(screen.getByTestId("amenity-counts")).toHaveTextContent("0 selected · 0 / 8 featured");
    const saveButton = screen.getByRole("button", { name: "Save amenities" });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(endpoints.saveAmenities).toHaveBeenCalledWith({
        data: { slug: "modeva", amenities: [], createdAmenities: [] },
      }),
    );
    await waitFor(() => expect(screen.getByText("Saved.")).toBeVisible());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("starts from an empty project and still allows a save", async () => {
    loadWith([]);
    endpoints.saveAmenities.mockResolvedValue(saveResult([]));
    renderEditor();
    await loaded();
    expect(screen.getByText(/No amenities selected/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save amenities" })).toBeEnabled();
  });

  it("suggests a slug from the name, then stops once the slug is edited", async () => {
    loadWith([]);
    renderEditor();
    await loaded();

    openCreateForm();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kids' Club & Pool" } });
    expect(screen.getByLabelText("Identifier")).toHaveValue("kids-club-pool");

    fireEvent.change(screen.getByLabelText("Identifier"), { target: { value: "kids-club" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kids Club Deluxe" } });
    // The hand-chosen key survives: the editor stops fighting its user.
    expect(screen.getByLabelText("Identifier")).toHaveValue("kids-club");
  });

  it("warns when a proposed new amenity already looks like an existing one", async () => {
    loadWith([]);
    renderEditor();
    await loaded();

    openCreateForm();
    expect(screen.queryByTestId("amenity-close-matches")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kids' Pool" } });
    const warning = await screen.findByTestId("amenity-close-matches");
    expect(within(warning).getByText(/Kids Pool \(kids-pool\)/)).toBeVisible();
  });

  it("stages a created amenity into the selection AND the save payload", async () => {
    loadWith([]);
    endpoints.saveAmenities.mockResolvedValue(
      saveResult([selectedRow("rooftop-bar", { icon: "martini", sortOrder: 10 })], ["rooftop-bar"]),
    );
    renderEditor();
    await loaded();

    openCreateForm();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rooftop Bar" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Leisure" } });
    fireEvent.change(screen.getByLabelText("Icon name"), { target: { value: "martini" } });
    fireEvent.click(screen.getByRole("button", { name: "Add new amenity" }));

    expect(renderedSelection()).toEqual(["rooftop-bar"]);
    fireEvent.click(screen.getByRole("button", { name: "Save amenities" }));
    await waitFor(() =>
      expect(endpoints.saveAmenities).toHaveBeenCalledWith({
        data: {
          slug: "modeva",
          amenities: [{ slug: "rooftop-bar", note: "", isFeatured: false, sortOrder: 10 }],
          createdAmenities: [
            { name: "Rooftop Bar", slug: "rooftop-bar", category: "Leisure", icon: "martini" },
          ],
        },
      }),
    );
    await waitFor(() => expect(screen.getByText(/1 new amenity added/)).toBeVisible());
  });

  it("a refused creation keeps the staged project selections intact", async () => {
    loadWith([selectedRow("spa", { note: "By appointment", sortOrder: 10 })]);
    renderEditor();
    await loaded();

    // One good creation is staged alongside a picked amenity and an edited note.
    fireEvent.click(screen.getByRole("button", { name: "Add Concierge" }));
    fireEvent.change(screen.getByLabelText("Note for Spa"), { target: { value: "Edited note" } });
    openCreateForm();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rooftop Bar" } });
    fireEvent.click(screen.getByRole("button", { name: "Add new amenity" }));
    expect(renderedSelection()).toEqual(["spa", "concierge", "rooftop-bar"]);

    // Now a bad one: an identifier that is not kebab-case.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sky Lounge" } });
    fireEvent.change(screen.getByLabelText("Identifier"), { target: { value: "Sky Lounge" } });
    fireEvent.click(screen.getByRole("button", { name: "Add new amenity" }));

    expect(screen.getByText(/lower-case words joined by single hyphens/)).toBeVisible();
    // Everything staged before the failure is untouched.
    expect(renderedSelection()).toEqual(["spa", "concierge", "rooftop-bar"]);
    expect(screen.getByLabelText("Note for Spa")).toHaveValue("Edited note");

    // And an identifier that already exists is refused rather than merged.
    fireEvent.change(screen.getByLabelText("Identifier"), { target: { value: "spa" } });
    fireEvent.click(screen.getByRole("button", { name: "Add new amenity" }));
    expect(screen.getByText(/The identifier spa already exists/)).toBeVisible();
    expect(renderedSelection()).toEqual(["spa", "concierge", "rooftop-bar"]);
  });

  it("renders a neutral marker for a blank or unknown icon rather than breaking", async () => {
    loadWith([
      selectedRow("spa", { icon: "definitely-not-a-real-icon", sortOrder: 10 }),
      selectedRow("co-working-space", { icon: "", sortOrder: 20 }),
    ]);
    renderEditor();
    await loaded();

    // Both rows render, both with the same neutral marker.
    expect(renderedSelection()).toEqual(["spa", "co-working-space"]);
    expect(screen.getByText("Spa")).toBeVisible();
    expect(screen.getByText("Co-working Space")).toBeVisible();
    for (const slug of ["spa", "co-working-space"]) {
      expect(within(screen.getByTestId(`amenity-row-${slug}`)).getByText("•")).toBeInTheDocument();
    }
  });
});

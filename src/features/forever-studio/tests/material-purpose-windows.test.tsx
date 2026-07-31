/**
 * FOREVER-STUDIO-EXPLICIT-MATERIAL-SLOTS-001 — the upload windows.
 *
 * Studio no longer asks the Owner for "materials" and then guesses what each
 * file was. It shows a labelled window per material purpose; uploading into a
 * window IS the instruction. These tests pin that surface:
 *
 *  - every required window renders, on every workflow;
 *  - the chosen purpose is attached at selection time, survives serialization,
 *    and reaches the server request unchanged;
 *  - removing one file never disturbs another file's purpose;
 *  - every window is optional and nothing gates publication;
 *  - the layout does not overflow horizontally at 375 px.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const endpoints = vi.hoisted(() => ({
  getOverview: vi.fn(),
  startJob: vi.fn(),
  processJob: vi.fn(),
}));

const uploaded = vi.hoisted(() => ({ toSignedUrl: vi.fn() }));

vi.mock("../studio.functions", () => ({
  studioGetOverview: endpoints.getOverview,
  studioStartJob: endpoints.startJob,
  studioProcessJob: endpoints.processJob,
  studioPlanArchiveUpload: vi.fn(),
  studioConfirmArchiveUpload: vi.fn(),
  studioResumePending: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: { from: () => ({ uploadToSignedUrl: uploaded.toSignedUrl }) },
  },
}));

import { StudioUploader } from "../components/StudioUploader";
import {
  additionalMaterialWindows,
  primaryMaterialWindows,
  STUDIO_MATERIAL_WINDOWS,
  STUDIO_WORKFLOWS,
  type StudioMaterialPurpose,
  type StudioWorkflow,
} from "../studio-types";

const OVERVIEW = {
  session: { role: "owner", email: "owner@example.com", displayName: "Owner" },
  projects: [],
  listings: [],
  jobs: [],
  members: [],
  activeJobs: 0,
};

/**
 * Every window the Owner-approved model requires, named as the Owner would
 * name it. Written out literally rather than derived from the source so a
 * silent narrowing of the vocabulary fails this test.
 */
const REQUIRED_WINDOWS = [
  "Brochure",
  "Price List",
  "Payment Plan",
  "Project Photos / Renders",
  "Video",
  "Master Plan",
  "Floor Plans",
  "Unit Plans",
  "Construction Photos",
  "Construction Videos",
  "Documents / Legal",
  "Developer / Company Profile",
  "Map / Location",
  "Full Project Archive / Other Package",
];

function renderUploader(workflow?: StudioWorkflow) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const uploadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/upload",
    component: () => <StudioUploader workflow={workflow} />,
  });
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio",
    component: () => <p>Studio dashboard</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([studioRoute, uploadRoute]),
    history: createMemoryHistory({ initialEntries: ["/studio/upload"] }),
  });
  return render(<RouterProvider router={router} />);
}

/** The file picker belonging to one window, found by its visible label. */
function windowInput(label: string): HTMLInputElement {
  const input = screen.getByLabelText(label, { selector: 'input[type="file"]' });
  if (!(input instanceof HTMLInputElement)) throw new Error(`no picker for ${label}`);
  return input;
}

async function addTo(label: string, ...files: File[]) {
  const input = windowInput(label);
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

function file(name: string, bytes = 8): File {
  return new File([new Uint8Array(bytes)], name);
}

type SentFile = { name: string; materialPurpose?: string };

function sentFiles(): SentFile[] {
  expect(endpoints.startJob).toHaveBeenCalled();
  return endpoints.startJob.mock.calls[0][0].data.files as SentFile[];
}

async function publish() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
  });
}

describe("Studio upload windows", () => {
  beforeAll(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    endpoints.getOverview.mockReset().mockResolvedValue(OVERVIEW);
    endpoints.startJob.mockReset().mockResolvedValue({ jobId: "job-1", uploads: [] });
    endpoints.processJob.mockReset().mockResolvedValue({
      status: "published",
      pagePath: "/projects/x",
      warnings: [],
      counts: null,
      projectSlug: "x",
      listingId: null,
    });
    uploaded.toSignedUrl.mockReset().mockResolvedValue({ error: null });
  });

  // -------------------------------------------------------------------------
  // 1. Every required window renders
  // -------------------------------------------------------------------------

  it("renders a separate, labelled window for every required material purpose", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });

    for (const label of REQUIRED_WINDOWS) {
      const input = windowInput(label);
      expect(input, label).toBeVisible();
      // Each window explains, in one short sentence, what belongs in it.
      const describedBy = input.getAttribute("aria-describedby");
      expect(describedBy, label).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent?.length ?? 0).toBeGreaterThan(0);
    }
    // No generic catch-all picker survives alongside them.
    expect(screen.queryByRole("button", { name: "Choose files" })).not.toBeInTheDocument();
  });

  it("keeps every required window reachable on every workflow", async () => {
    for (const workflow of STUDIO_WORKFLOWS) {
      const view = renderUploader(workflow);
      await screen.findByRole("button", { name: "Publish now" });
      for (const label of REQUIRED_WINDOWS) {
        // Present and operable whether it leads the workflow or sits under
        // "More material types" — a workflow narrows the common case, it never
        // removes access to a material the Owner actually has.
        expect(windowInput(label), `${workflow} :: ${label}`).toBeInTheDocument();
      }
      // Every window this workflow leads with is one of the required windows.
      for (const window of primaryMaterialWindows(workflow)) {
        expect(REQUIRED_WINDOWS, workflow).toContain(window.label);
      }
      view.unmount();
    }
  });

  it("leads each workflow with the windows that workflow is about", async () => {
    const expectations: Array<{ workflow: StudioWorkflow; leads: StudioMaterialPurpose[] }> = [
      { workflow: "price_availability_update", leads: ["price_list", "payment_plan"] },
      {
        workflow: "construction_media_update",
        leads: ["construction_photo", "construction_video"],
      },
      { workflow: "resale_listing", leads: ["project_photo", "video", "floor_plan", "unit_plan"] },
    ];
    for (const { workflow, leads } of expectations) {
      const primary = primaryMaterialWindows(workflow).map((window) => window.purpose);
      for (const purpose of leads) expect(primary, workflow).toContain(purpose);
      // ...and the rest stay available rather than disappearing.
      const total = primary.length + additionalMaterialWindows(workflow).length;
      expect(total, workflow).toBe(STUDIO_MATERIAL_WINDOWS.length);
    }
    // The broad workflows lead with everything.
    expect(additionalMaterialWindows("new_development")).toHaveLength(0);
    expect(additionalMaterialWindows("project_update")).toHaveLength(0);
  });

  it("offers camera capture in the photo and construction windows", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    for (const label of ["Project Photos / Renders", "Construction Photos"]) {
      expect(
        screen.getByLabelText(`Take a photo for ${label}`, { selector: 'input[type="file"]' }),
      ).toHaveAttribute("capture", "environment");
    }
  });

  // -------------------------------------------------------------------------
  // 2 & 3. The purpose is attached at selection and survives to the server
  // -------------------------------------------------------------------------

  it("sends every direct file with the purpose of the window it was added to", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });

    await addTo("Price List", file("document.pdf"));
    await addTo("Documents / Legal", file("price-list.pdf"));
    await addTo("Project Photos / Renders", file("master-plan.jpg"));
    await addTo("Payment Plan", file("brochure-final.pdf"));
    await addTo("Construction Photos", file("IMG_4821.jpg"));
    await publish();

    // Exactly the Owner's instruction, filename notwithstanding.
    expect(sentFiles()).toEqual([
      { name: "document.pdf", size: 8, contentType: undefined, materialPurpose: "price_list" },
      {
        name: "price-list.pdf",
        size: 8,
        contentType: undefined,
        materialPurpose: "document_legal",
      },
      {
        name: "master-plan.jpg",
        size: 8,
        contentType: undefined,
        materialPurpose: "project_photo",
      },
      {
        name: "brochure-final.pdf",
        size: 8,
        contentType: undefined,
        materialPurpose: "payment_plan",
      },
      {
        name: "IMG_4821.jpg",
        size: 8,
        contentType: undefined,
        materialPurpose: "construction_photo",
      },
    ]);
  });

  it("never sends a direct file without a purpose", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Brochure", file("a.pdf"), file("b.pdf"));
    await addTo("Map / Location", file("c.png"));
    await publish();
    for (const sent of sentFiles()) {
      expect(sent.materialPurpose, sent.name).toBeTruthy();
    }
  });

  it("survives JSON serialization of the request payload unchanged", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Unit Plans", file("scan001.pdf"));
    await addTo("Video", file("clip.mp4"));
    await publish();

    // The wire is JSON: the purpose must be a plain serializable value, not a
    // symbol, class instance, or something DOM grouping implied.
    const payload = endpoints.startJob.mock.calls[0][0].data;
    const roundTripped = JSON.parse(JSON.stringify(payload)) as { files: SentFile[] };
    expect(roundTripped.files.map((entry) => entry.materialPurpose)).toEqual([
      "unit_plan",
      "video",
    ]);
  });

  it("uses only purposes the server allowlist recognizes", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    for (const window of STUDIO_MATERIAL_WINDOWS) {
      await addTo(window.label, file(`${window.purpose}.bin`));
    }
    await publish();
    const known = new Set(STUDIO_MATERIAL_WINDOWS.map((window) => window.purpose));
    for (const sent of sentFiles()) {
      expect(known.has(sent.materialPurpose as StudioMaterialPurpose), sent.name).toBe(true);
    }
    expect(sentFiles()).toHaveLength(STUDIO_MATERIAL_WINDOWS.length);
  });

  // -------------------------------------------------------------------------
  // 8 & 9. Files sit under their own window; removal is surgical
  // -------------------------------------------------------------------------

  it("lists each selected file beneath the window it was added to", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("q3.pdf"));
    await addTo("Floor Plans", file("level-2.pdf"));

    const priceList = screen.getByRole("list", { name: "Price List files" });
    expect(within(priceList).getByText("q3.pdf")).toBeVisible();
    expect(within(priceList).queryByText("level-2.pdf")).not.toBeInTheDocument();

    const floors = screen.getByRole("list", { name: "Floor Plans files" });
    expect(within(floors).getByText("level-2.pdf")).toBeVisible();
  });

  it("removing one file leaves every other file's purpose untouched", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });

    await addTo("Brochure", file("keep-brochure.pdf"));
    await addTo("Price List", file("drop-me.pdf"), file("keep-price.pdf"));
    await addTo("Construction Photos", file("keep-site.jpg"));

    // Remove the middle selection — the one whose neighbours are most at risk
    // if purposes were positional rather than carried per file.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove drop-me.pdf from Price List" }));
    });
    expect(screen.queryByText("drop-me.pdf")).not.toBeInTheDocument();

    await publish();
    expect(sentFiles().map((entry) => [entry.name, entry.materialPurpose])).toEqual([
      ["keep-brochure.pdf", "brochure"],
      ["keep-price.pdf", "price_list"],
      ["keep-site.jpg", "construction_photo"],
    ]);
  });

  it("keeps two identically named files in different windows independent", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Price List", file("scan.pdf"));
    await addTo("Documents / Legal", file("scan.pdf"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove scan.pdf from Price List" }));
    });
    await publish();
    expect(sentFiles()).toEqual([
      { name: "scan.pdf", size: 8, contentType: undefined, materialPurpose: "document_legal" },
    ]);
  });

  // -------------------------------------------------------------------------
  // 10, 11 & 12. Everything optional; no gate
  // -------------------------------------------------------------------------

  it("publishes with every window left empty", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await publish();
    expect(endpoints.startJob).toHaveBeenCalledTimes(1);
    expect(sentFiles()).toEqual([]);
    expect(await screen.findByRole("heading", { name: "Published" })).toBeVisible();
  });

  it("publishes when only one of fourteen windows was used", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Master Plan", file("site.pdf"));
    await publish();
    expect(await screen.findByRole("heading", { name: "Published" })).toBeVisible();
    expect(sentFiles()).toHaveLength(1);
  });

  it("shows no approval, readiness or verification gate anywhere in the flow", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo("Brochure", file("b.pdf"));

    // The single final action is still to publish.
    const buttons = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    for (const forbidden of [
      /review/i,
      /approve/i,
      /verify/i,
      /confirm source/i,
      /ready for publication/i,
      /submit for/i,
    ]) {
      expect(
        buttons.filter((text) => forbidden.test(text)),
        String(forbidden),
      ).toHaveLength(0);
    }
    expect(
      screen.getByText(
        "Your upload publishes immediately. Missing information never blocks publication.",
        {
          exact: false,
        },
      ),
    ).toBeVisible();

    await publish();
    // Upload → published. No intermediate state asked the Owner for anything.
    expect(await screen.findByRole("heading", { name: "Published" })).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 18. Mobile layout
  // -------------------------------------------------------------------------

  it("keeps every window within a 375 px viewport with no horizontal overflow", async () => {
    const view = renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    await addTo(
      "Documents / Legal",
      file("a-very-long-original-file-name-from-a-phone-camera-export-2026.pdf"),
    );

    // jsdom has no layout engine, so overflow is proven structurally: the
    // classes that would let a long filename or a wide card push the page
    // sideways must be present (truncate/min-w-0) and no fixed width may be
    // wider than the viewport.
    const cards = view.container.querySelectorAll("div.rounded-lg.border");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.className).not.toMatch(/\bw-\[\d{3,}px\]/);
      expect(card.className).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
    }
    // Long names truncate inside their row instead of widening it.
    const name = screen.getByText(
      "a-very-long-original-file-name-from-a-phone-camera-export-2026.pdf",
    );
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
    // The window grid is single-column by default and only widens from `sm`
    // up: no UNPREFIXED multi-column class may appear on it.
    const grids = Array.from(view.container.querySelectorAll("div")).filter((element) =>
      element.className.includes("sm:grid-cols-2"),
    );
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      const classes = grid.className.split(/\s+/);
      expect(classes).toContain("grid");
      expect(classes.filter((token) => /^grid-cols-[2-9]$/.test(token))).toHaveLength(0);
    }
  });

  it("labels each picker with its window so assistive tech states the purpose", async () => {
    renderUploader("new_development");
    await screen.findByRole("button", { name: "Publish now" });
    for (const window of STUDIO_MATERIAL_WINDOWS) {
      const input = windowInput(window.label);
      // Focusable (sr-only, not display:none) so the window is keyboard-usable.
      expect(input.className, window.label).toContain("sr-only");
      expect(input.className, window.label).not.toContain("hidden");
      expect(input.id, window.label).toBe(`studio-material-${window.purpose}`);
    }
  });
});

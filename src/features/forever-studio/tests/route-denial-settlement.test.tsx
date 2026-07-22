import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioListingDetail, StudioProjectDetail } from "../studio-types";

const endpoints = vi.hoisted(() => ({
  getProjectDetail: vi.fn(),
  getListingDetail: vi.fn(),
  getOverview: vi.fn(),
}));

vi.mock("../studio.functions", () => ({
  studioGetProjectDetail: endpoints.getProjectDetail,
  studioGetListingDetail: endpoints.getListingDetail,
  studioGetOverview: endpoints.getOverview,
  studioInviteMember: vi.fn(),
  studioProcessJob: vi.fn(),
  studioResumePending: vi.fn(),
  studioSaveProjectFacts: vi.fn(),
  studioSetHeroImage: vi.fn(),
  studioSetListingPublication: vi.fn(),
  studioSetMemberActive: vi.fn(),
  studioSetProjectPublication: vi.fn(),
  studioStartJob: vi.fn(),
  studioUpdateResale: vi.fn(),
}));

import { StudioProjectEditor } from "../components/StudioProjectEditor";
import { StudioResaleEditor } from "../components/StudioResaleEditor";

const PROJECT_SECRET = "Publisher B private project title";
const LISTING_SECRET = "private-seller@example.com";
const RAW_INFRASTRUCTURE =
  'relation "studio_listing_contacts" failed at C:\\server\\private postgres://user:password@db';

const projectDetail: StudioProjectDetail = {
  slug: "publisher-own-project",
  name: "Publisher own project",
  publicStatus: "draft",
  isActive: true,
  isPublic: false,
  facts: { name: "Publisher own project" },
  mainImageUrl: null,
  media: [],
  updatedAt: null,
  lastSourceDate: null,
};

const listingDetail: StudioListingDetail = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "publisher-own-listing",
  publicationStatus: "draft",
  isPublic: false,
  facts: { title: "Publisher own listing" },
  photos: [],
  updatedAt: null,
};

function denial(code: string, raw = `${RAW_INFRASTRUCTURE} ${PROJECT_SECRET} ${LISTING_SECRET}`) {
  const error = new Error(raw);
  error.name = code;
  return error;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderStudioRoute(path: string, initialEntries = [path]) {
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
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio",
    component: () => <p>Studio dashboard</p>,
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/project/$slug",
    component: ProjectRoute,
  });
  const listingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/resale/$id",
    component: ListingRoute,
  });

  function ProjectRoute() {
    const { slug } = projectRoute.useParams();
    return <StudioProjectEditor slug={slug} />;
  }

  function ListingRoute() {
    const { id } = listingRoute.useParams();
    return <StudioResaleEditor listingId={id} />;
  }

  const history = createMemoryHistory({ initialEntries });
  const router = createRouter({
    routeTree: rootRoute.addChildren([studioRoute, projectRoute, listingRoute]),
    history,
  });
  const view = render(<RouterProvider router={router} />);
  return { history, queryClient, router, view };
}

async function expectSafeDenial() {
  expect(await screen.findByRole("heading", { name: "Studio access denied" })).toBeVisible();
  expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  expect(screen.queryByText(PROJECT_SECRET)).not.toBeInTheDocument();
  expect(screen.queryByText(LISTING_SECRET)).not.toBeInTheDocument();
  expect(
    screen.queryByText(/studio_listing_contacts|postgres:\/\/|C:\\server/),
  ).not.toBeInTheDocument();
}

describe("Studio guarded route settlement", () => {
  beforeAll(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });

  beforeEach(() => {
    endpoints.getProjectDetail.mockReset();
    endpoints.getListingDetail.mockReset();
    endpoints.getOverview.mockReset();
  });

  it.each([
    ["cross-publisher project", "studio_access_denied"],
    ["Owner-managed legacy project", "studio_access_denied"],
    ["non-member project", "studio_membership_required"],
    ["disabled-publisher project", "studio_membership_disabled"],
  ])("settles a denied %s direct URL without retry or disclosure", async (_scenario, code) => {
    const request = deferred<StudioProjectDetail>();
    endpoints.getProjectDetail.mockReturnValueOnce(request.promise);
    renderStudioRoute("/studio/project/guessed-project");

    expect(await screen.findByText("Loading…")).toBeVisible();
    expect(screen.queryByText(PROJECT_SECRET)).not.toBeInTheDocument();
    await act(async () => request.reject(denial(code)));

    await expectSafeDenial();
    expect(endpoints.getProjectDetail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["cross-publisher listing", "studio_access_denied"],
    ["Owner-managed legacy listing", "studio_access_denied"],
    ["non-member listing", "studio_membership_required"],
    ["disabled-publisher listing", "studio_membership_disabled"],
  ])("settles a denied %s direct URL without retry or disclosure", async (_scenario, code) => {
    const request = deferred<StudioListingDetail>();
    endpoints.getListingDetail.mockReturnValueOnce(request.promise);
    renderStudioRoute("/studio/resale/00000000-0000-0000-0000-000000000002");

    expect(await screen.findByText("Loading…")).toBeVisible();
    expect(screen.queryByText(LISTING_SECRET)).not.toBeInTheDocument();
    await act(async () => request.reject(denial(code)));

    await expectSafeDenial();
    expect(endpoints.getListingDetail).toHaveBeenCalledTimes(1);
  });

  it("settles both a fresh deep-link and a refresh and keeps browser Back usable", async () => {
    endpoints.getProjectDetail.mockRejectedValue(denial("studio_access_denied"));

    const first = renderStudioRoute("/studio/project/guessed-project", [
      "/studio",
      "/studio/project/guessed-project",
    ]);
    await expectSafeDenial();
    await act(async () => first.history.back());
    await waitFor(() => expect(first.router.state.location.pathname).toBe("/studio"));
    expect(await screen.findByText("Studio dashboard")).toBeVisible();
    first.view.unmount();
    first.queryClient.clear();

    const refreshed = renderStudioRoute("/studio/project/guessed-project");
    await expectSafeDenial();
    expect(endpoints.getProjectDetail).toHaveBeenCalledTimes(2);
    refreshed.view.unmount();
    refreshed.queryClient.clear();
  });

  it("keeps Owner and publisher access to authorized project and listing routes unchanged", async () => {
    endpoints.getProjectDetail.mockResolvedValue(projectDetail);
    endpoints.getListingDetail.mockResolvedValue(listingDetail);

    const project = renderStudioRoute("/studio/project/publisher-own-project");
    expect(await screen.findByRole("heading", { name: "Publisher own project" })).toBeVisible();
    expect(screen.queryByText("Studio access denied")).not.toBeInTheDocument();
    project.view.unmount();
    project.queryClient.clear();

    const listing = renderStudioRoute("/studio/resale/00000000-0000-0000-0000-000000000001");
    expect(await screen.findByRole("heading", { name: "Publisher own listing" })).toBeVisible();
    expect(screen.queryByText("Studio access denied")).not.toBeInTheDocument();
    listing.view.unmount();
    listing.queryClient.clear();
  });
});

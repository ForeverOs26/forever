import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { makeProjectDetail } from "@/features/forever-database/tests/fixtures";

import { loadProjectDetailRouteData } from "./project-detail-route-loader";
import { publicProjectDetail } from "./public-project-detail";

function queryClient(ensureQueryData: ReturnType<typeof vi.fn>): QueryClient {
  return { ensureQueryData } as unknown as QueryClient;
}

describe("Project Detail route loader", () => {
  it.each([
    { isDemoPreview: true, usesLocalPreviewData: false },
    { isDemoPreview: false, usesLocalPreviewData: true },
  ])("does not query Related for deterministic local data (%o)", async (core) => {
    const project = publicProjectDetail(makeProjectDetail({ core }));
    const ensureQueryData = vi.fn().mockResolvedValue(project);

    await expect(
      loadProjectDetailRouteData(queryClient(ensureQueryData), project.slug),
    ).resolves.toEqual({ project, relatedProjects: [] });
    expect(ensureQueryData).toHaveBeenCalledTimes(1);
  });

  it("keeps the core project when the optional Related reader fails", async () => {
    const project = publicProjectDetail(
      makeProjectDetail({
        core: { isDemoPreview: false, usesLocalPreviewData: false },
      }),
    );
    const ensureQueryData = vi
      .fn()
      .mockResolvedValueOnce(project)
      .mockRejectedValueOnce(new Error("related reader unavailable"));

    await expect(
      loadProjectDetailRouteData(queryClient(ensureQueryData), project.slug),
    ).resolves.toEqual({ project, relatedProjects: [] });
    expect(ensureQueryData).toHaveBeenCalledTimes(2);
  });
});

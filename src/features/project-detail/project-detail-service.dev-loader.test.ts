import { afterEach, describe, expect, it, vi } from "vitest";

import { makeProjectDetail } from "@/features/forever-database/tests/fixtures";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getDemoPreviewProjectDetail: vi.fn(),
  getPartnerDemoProjectDetail: vi.fn(),
  partnerDemoModuleResolved: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));

vi.mock("./demo-preview", () => ({
  getDemoPreviewProjectDetail: mocks.getDemoPreviewProjectDetail,
}));

vi.mock("./partner-demo-data", () => {
  mocks.partnerDemoModuleResolved();
  return {
    getPartnerDemoProjectDetail: mocks.getPartnerDemoProjectDetail,
  };
});

import { ProjectDetailService } from "./project-detail-service";
import { publicProjectDetail } from "./public-project-detail";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProjectDetailService development-only data loaders", () => {
  it("resolves Partner Demo data only in the exact Partner Demo mode", async () => {
    expect(import.meta.env.DEV).toBe(true);

    const coralina = makeProjectDetail({ core: { slug: "coralina" } });
    const modeva = makeProjectDetail({ core: { slug: "modeva" } });
    mocks.getDemoPreviewProjectDetail.mockResolvedValue(coralina);
    mocks.getPartnerDemoProjectDetail.mockResolvedValue(modeva);

    vi.stubEnv("VITE_PARTNER_DEMO", "false");
    await expect(ProjectDetailService.getBySlug("coralina")).resolves.toEqual(
      publicProjectDetail(coralina),
    );

    expect(mocks.partnerDemoModuleResolved).not.toHaveBeenCalled();
    expect(mocks.getPartnerDemoProjectDetail).not.toHaveBeenCalled();
    expect(mocks.getDemoPreviewProjectDetail).toHaveBeenCalledWith("coralina");
    expect(mocks.from).not.toHaveBeenCalled();

    vi.stubEnv("VITE_PARTNER_DEMO", "true");
    await expect(ProjectDetailService.getBySlug("modeva")).resolves.toEqual(
      publicProjectDetail({
        ...modeva,
        core: { ...modeva.core, usesLocalPreviewData: true },
      }),
    );

    expect(mocks.partnerDemoModuleResolved).toHaveBeenCalledTimes(1);
    expect(mocks.getPartnerDemoProjectDetail).toHaveBeenCalledWith("modeva");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

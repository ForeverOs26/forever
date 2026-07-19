import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isDemoLeadModeEnabled,
  submitLead,
  validateLead,
  type LeadFormValues,
} from "@/lib/lead-service";

const insertMock = vi.fn(async () => ({ error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    get from() {
      return fromMock;
    },
  },
}));

const validValues: LeadFormValues = {
  firstName: "Alex",
  lastName: "Guest",
  email: "alex.guest@example.com",
  phone: "+66 81 234 5678",
  source: "booth",
};

describe("isDemoLeadModeEnabled", () => {
  it("is disabled by default in ordinary local development", () => {
    expect(isDemoLeadModeEnabled({ DEV: true })).toBe(false);
  });

  it("is always disabled outside local development", () => {
    expect(isDemoLeadModeEnabled({ DEV: false })).toBe(false);
    expect(isDemoLeadModeEnabled({ DEV: false, VITE_DEMO_LEAD_MODE: "true" })).toBe(false);
  });

  it("can be explicitly enabled for ordinary local development", () => {
    expect(isDemoLeadModeEnabled({ DEV: true, VITE_DEMO_LEAD_MODE: "true" })).toBe(true);
  });

  it("is mandatory when the Partner Demo process is active", () => {
    expect(
      isDemoLeadModeEnabled({
        DEV: true,
        VITE_PARTNER_DEMO: "true",
        VITE_DEMO_LEAD_MODE: "false",
      }),
    ).toBe(true);
  });
});

describe("submitLead demo mode (local development)", () => {
  beforeEach(() => {
    insertMock.mockClear();
    fromMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("completes without any lead write or network call in demo mode", async () => {
    vi.stubEnv("VITE_PARTNER_DEMO", "true");

    await expect(submitLead(validValues)).resolves.toBeUndefined();
    expect(fromMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still validates before completing in demo mode", async () => {
    vi.stubEnv("VITE_PARTNER_DEMO", "true");
    await expect(submitLead({ ...validValues, email: "not-an-email" })).rejects.toThrow(
      "Please check the highlighted fields",
    );
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("writes through the unchanged production path when demo mode is off", async () => {
    vi.stubEnv("VITE_PARTNER_DEMO", "false");
    vi.stubEnv("VITE_DEMO_LEAD_MODE", "false");

    await expect(submitLead(validValues)).resolves.toBeUndefined();
    expect(fromMock).toHaveBeenCalledWith("leads");
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Alex Guest",
        email: "alex.guest@example.com",
        status: "new",
        source: "booth",
      }),
    );
  });

  it("keeps the existing validation contract", () => {
    expect(validateLead(validValues)).toEqual({});
    expect(validateLead({ ...validValues, phone: "" })).toHaveProperty("phone");
  });
});

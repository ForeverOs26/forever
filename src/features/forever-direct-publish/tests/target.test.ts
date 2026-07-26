import { describe, expect, it } from "vitest";

import {
  assertProductionTarget,
  DIRECT_PUBLISH_TARGET,
  PRODUCTION_PROJECT_REF,
  projectRefFromUrl,
  STAGING_PROJECT_REF,
} from "../target";

const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_PROJECT_REF}.supabase.co`;

describe("projectRefFromUrl", () => {
  it("reads the ref from an exact supabase origin", () => {
    expect(projectRefFromUrl(PRODUCTION_URL)).toBe(PRODUCTION_PROJECT_REF);
    expect(projectRefFromUrl(`${PRODUCTION_URL}/`)).toBe(PRODUCTION_PROJECT_REF);
  });

  it("refuses to guess a ref from anything else", () => {
    for (const url of [
      "http://abtvsrcnfwlbawvrjeed.supabase.co",
      "https://abtvsrcnfwlbawvrjeed.supabase.co/rest/v1",
      "https://db.example.com",
      "https://aws-0-ap-northeast-1.pooler.supabase.com",
      "not a url",
      "",
    ]) {
      expect(projectRefFromUrl(url)).toBeNull();
    }
  });
});

describe("assertProductionTarget", () => {
  it("verifies the exact production ref before any write", () => {
    const verified = assertProductionTarget({
      supabaseUrl: PRODUCTION_URL,
      requestedTarget: DIRECT_PUBLISH_TARGET,
    });
    expect(verified).toEqual({
      target: "production",
      projectRef: PRODUCTION_PROJECT_REF,
      url: PRODUCTION_URL,
    });
  });

  it("refuses staging by ref", () => {
    expect(() =>
      assertProductionTarget({ supabaseUrl: STAGING_URL, requestedTarget: "production" }),
    ).toThrowError(/staging/i);
  });

  it("refuses any other project ref", () => {
    expect(() =>
      assertProductionTarget({
        supabaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
        requestedTarget: "production",
      }),
    ).toThrowError(/not production/i);
  });

  it("refuses a non-production requested target", () => {
    expect(() =>
      assertProductionTarget({ supabaseUrl: PRODUCTION_URL, requestedTarget: "staging" }),
    ).toThrowError(/production only/i);
  });

  it("refuses an unproven or missing origin rather than assuming", () => {
    expect(() =>
      assertProductionTarget({ supabaseUrl: undefined, requestedTarget: "production" }),
    ).toThrowError(/not configured/i);
    expect(() =>
      assertProductionTarget({
        supabaseUrl: "https://forever.example",
        requestedTarget: "production",
      }),
    ).toThrowError(/cannot be proven/i);
  });
});

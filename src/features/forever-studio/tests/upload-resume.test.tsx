/**
 * FOREVER-STUDIO-LARGE-ARCHIVE-001 — Android staging incident regression
 * tests (network interruption during a chunked upload), client resume unit.
 *
 * Proven incident behavior under correction:
 *  1. a part failing while offline pauses the upload instead of terminally
 *     failing it, and already-stored parts are retained;
 *  2. connectivity restoration re-plans the SAME archive and uploads ONLY the
 *     missing parts through fresh signed targets (expired URLs replaced);
 *  3. the replan loop is bounded when the path is broken while "online".
 *
 * The uploader-level recovery affordance and the transient-vs-denial route
 * rendering are covered in uploader-recovery.test.tsx.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioArchivePartTarget } from "../studio-types";

const endpoints = vi.hoisted(() => ({
  planArchiveUpload: vi.fn(),
  confirmArchiveUpload: vi.fn(),
}));

const storage = vi.hoisted(() => ({
  uploadToSignedUrl: vi.fn(),
}));

vi.mock("../studio.functions", () => ({
  studioPlanArchiveUpload: endpoints.planArchiveUpload,
  studioConfirmArchiveUpload: endpoints.confirmArchiveUpload,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ uploadToSignedUrl: storage.uploadToSignedUrl }),
    },
  },
}));

import { uploadLargeArchive, type ArchiveUploadProgress } from "../components/archive-upload";
import { isStudioRouteDenial } from "../components/StudioRouteDenied";

function target(index: number, token: string): StudioArchivePartTarget {
  return {
    index,
    bucket: "studio-uploads",
    path: `jobs/job-1/parts/arch-1/${String(index).padStart(5, "0")}`,
    token,
  };
}

let onLine = true;

function setOnline(value: boolean, dispatch = false) {
  onLine = value;
  if (dispatch) window.dispatchEvent(new Event(value ? "online" : "offline"));
}

beforeEach(() => {
  vi.useRealTimers();
  endpoints.planArchiveUpload.mockReset();
  endpoints.confirmArchiveUpload.mockReset();
  storage.uploadToSignedUrl.mockReset();
  onLine = true;
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => onLine,
  });
});

describe("uploadLargeArchive offline pause and resume", () => {
  it("pauses on offline failure, keeps stored parts, and resumes only missing parts with fresh targets", async () => {
    const file = new File([new Uint8Array(64)], "big.zip");
    endpoints.planArchiveUpload.mockResolvedValueOnce({
      archiveId: "arch-1",
      partSize: 8,
      partCount: 3,
      presentParts: [],
      parts: [
        target(0, "round1-token-0"),
        target(1, "round1-token-1"),
        target(2, "round1-token-2"),
      ],
    });
    // Second plan: part 0 already stored server-side; FRESH tokens for the
    // still-missing parts (regenerating any expired signed URL).
    endpoints.planArchiveUpload.mockResolvedValueOnce({
      archiveId: "arch-1",
      partSize: 8,
      partCount: 3,
      presentParts: [0],
      parts: [target(1, "round2-token-1"), target(2, "round2-token-2")],
    });
    endpoints.confirmArchiveUpload.mockResolvedValue({
      archiveId: "arch-1",
      accepted: true,
      missingParts: [],
    });
    storage.uploadToSignedUrl.mockImplementation((_path: string, token: string) => {
      if (token === "round1-token-1") {
        // Wi-Fi dropped mid-upload: this and any further fetch would fail.
        setOnline(false);
        return Promise.resolve({ error: new TypeError("Failed to fetch") });
      }
      return Promise.resolve({ error: null });
    });

    const states: ArchiveUploadProgress["state"][] = [];
    const uploadPromise = uploadLargeArchive("job-1", file, (progress) =>
      states.push(progress.state),
    );
    await vi.waitFor(() => expect(states).toContain("paused"));
    // While paused offline nothing terminal happened and storage acceptance
    // was never requested; restore connectivity.
    expect(endpoints.confirmArchiveUpload).not.toHaveBeenCalled();
    setOnline(true, true);

    const result = await uploadPromise;
    expect(result.archiveId).toBe("arch-1");
    expect(states.at(-1)).toBe("stored");

    // Same job + same manifest on both plans → the server resumes the SAME
    // archive; the client never forked a second job or archive.
    expect(endpoints.planArchiveUpload).toHaveBeenCalledTimes(2);
    const [firstPlan, secondPlan] = endpoints.planArchiveUpload.mock.calls.map(
      (call) => call[0].data,
    );
    expect(secondPlan).toEqual(firstPlan);

    // Part 0 uploaded exactly once (retained across the pause); parts 1 and 2
    // resumed through the fresh round-2 tokens only.
    const tokens = storage.uploadToSignedUrl.mock.calls.map((call) => call[1]);
    expect(tokens).toEqual([
      "round1-token-0",
      "round1-token-1",
      "round2-token-1",
      "round2-token-2",
    ]);

    // Storage acceptance was requested only after every part was stored.
    expect(endpoints.confirmArchiveUpload).toHaveBeenCalledTimes(1);
  });

  it("stays bounded when uploads keep failing while the browser reports online", async () => {
    // Fake only the timer functions the backoff uses; keep setImmediate real
    // so the test can yield genuine event-loop turns between advances.
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    const file = new File([new Uint8Array(64)], "big.zip");
    endpoints.planArchiveUpload.mockResolvedValue({
      archiveId: "arch-1",
      partSize: 8,
      partCount: 1,
      presentParts: [],
      parts: [target(0, "token-0")],
    });
    storage.uploadToSignedUrl.mockResolvedValue({ error: new Error("HTTP 500") });

    let settled = false;
    const outcome = uploadLargeArchive("job-1", file, () => undefined).then(
      () => null,
      (error: unknown) => error,
    );
    void outcome.then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 500 && !settled; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      if (vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync();
    }
    expect(settled).toBe(true);

    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("failed to upload");
    // Initial round + MAX_STALLED_RESUME_ROUNDS replans, then a hard stop —
    // no unbounded replan spin against a persistently broken path.
    expect(endpoints.planArchiveUpload).toHaveBeenCalledTimes(4);
  });
});

describe("isStudioRouteDenial", () => {
  it("treats network and sanitized transient failures as non-denials", () => {
    expect(isStudioRouteDenial(new TypeError("Failed to fetch"))).toBe(false);
    const transient = new Error("Forever Studio hit a temporary problem completing this request.");
    transient.name = "studio_request_failed";
    expect(isStudioRouteDenial(transient)).toBe(false);
    expect(isStudioRouteDenial(new Error("Unauthorized: Invalid token"))).toBe(false);
  });

  it("recognizes only server-proven denial codes", () => {
    for (const code of [
      "studio_access_denied",
      "studio_membership_required",
      "studio_membership_disabled",
    ]) {
      const denial = new Error("denied");
      denial.name = code;
      expect(isStudioRouteDenial(denial)).toBe(true);
    }
  });
});

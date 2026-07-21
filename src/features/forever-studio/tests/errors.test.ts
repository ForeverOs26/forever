/**
 * FOREVER-STUDIO-001 — operational error sanitization (item 11).
 *
 * Users and persisted job records only ever see a stable safe code, a concise
 * message, and a retryability flag. Raw database/filesystem/SQL/path text is
 * redacted from logs and never surfaced.
 */

import { describe, expect, it, vi } from "vitest";

import { StudioAccessError } from "../server/contracts";
import { redact, StudioError, toSafeError } from "../server/errors";
import { processUploadJob, startUploadJob } from "../server/service";
import { makeWorld, OWNER } from "./fakes";

describe("error sanitization", () => {
  it("redacts paths, connection strings, keys, and JWTs", () => {
    const raw =
      "failed at /home/user/forever/src/x.ts using postgres://user:pw@db:5432/app key sb_secret_ABC123 token eyJhbGciOiJI.payload.sig SUPABASE_SERVICE_ROLE_KEY=super-secret";
    const out = redact(raw);
    expect(out).not.toContain("/home/user/forever");
    expect(out).not.toContain("postgres://user");
    expect(out).not.toContain("sb_secret_ABC123");
    expect(out).not.toContain("eyJhbGciOiJI");
    expect(out).not.toContain("super-secret");
  });

  it("collapses an unknown error to a generic retryable code, logging nothing raw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const safe = toSafeError(new Error("connect ECONNREFUSED /var/run/postgres at 10.0.0.1:5432"));
    expect(safe.code).toBe("processing_failed");
    expect(safe.retryable).toBe(true);
    expect(safe.message).not.toContain("ECONNREFUSED");
    expect(safe.message).not.toContain("10.0.0.1");
    // The log line is redacted.
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("/var/run/postgres");
    spy.mockRestore();
  });

  it("preserves safe codes for access and studio errors", () => {
    expect(
      toSafeError(new StudioAccessError("studio_owner_required", "Only the Owner may do this.")),
    ).toMatchObject({
      code: "studio_owner_required",
      retryable: false,
    });
    expect(
      toSafeError(new StudioError("ingest_failed", "The page could not be saved.", true)),
    ).toMatchObject({
      code: "ingest_failed",
      retryable: true,
    });
  });

  it("a job that fails on a raw internal error surfaces only a safe code + message", async () => {
    const world = makeWorld();
    // Make the atomic publish throw a raw, path-laden error.
    const originalPublish = world.data.publishProject.bind(world.data);
    world.data.publishProject = async () => {
      throw new Error(
        "duplicate key value violates unique constraint at /home/user/forever/db pg://secret",
      );
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = await startUploadJob(world.deps, OWNER, {
      workflow: "new_development",
      projectFacts: { name: "Leaky Project" },
      files: [],
    });
    const result = await processUploadJob(world.deps, OWNER, started.jobId);
    world.data.publishProject = originalPublish;

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBeTruthy();
    expect(result.error).not.toContain("/home/user/forever");
    expect(result.error).not.toContain("pg://");
    expect(result.error).not.toContain("unique constraint");
    // The persisted job.error is equally safe.
    const job = await world.data.getJob(started.jobId);
    expect(job?.error).not.toContain("/home/user/forever");
    expect(job?.error_code).toBe(result.errorCode);
    spy.mockRestore();
  });
});

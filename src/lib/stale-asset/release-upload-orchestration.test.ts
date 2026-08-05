/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — the final pre-spawn digest guard,
 * proven BEHAVIOURALLY.
 *
 * PR139 independent review, P2-4: the upload wrapper's post-PREUPLOAD digest
 * re-check was verified only by matching the wrapper's source text —
 *
 *   expect(wrapper).toMatch(/\n\s*if \(consumedDigest !== verifiedDigest\) \{/)
 *
 * — which proves the characters exist and nothing about whether the program
 * refuses, whether the refusal precedes the spawn, or whether the guard is
 * reachable at all.
 *
 * Every test here runs the real decision function with an INJECTED launcher and
 * measures two facts that a source-text assertion cannot reach: the named STOP
 * that came back, and whether the launcher was called. Mutation control 37 now
 * fails because a mutated guard CALLS THE SPY, not because a line of text
 * changed.
 *
 * The full offline PREUPLOAD contract runs first on a dummy specification, so
 * these are not assertions about an artefact that was never verified: the
 * specification tampered with below is one that genuinely passed
 * `verifyUploadSpecification`.
 *
 * NO SPAWN. NO NETWORK. NO CREDENTIAL. NO PRODUCTION IDENTIFIER. Every UUID,
 * binding source and digest below is synthetic.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildUploadSpecification,
  normalizeUploadSpecification,
  verifyUploadSpecification,
} from "./pinned-binding-inheritance";
import {
  IMMUTABLE_BUILD_OUTPUT_CHANGED_STOP,
  UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP,
  UPLOAD_SPECIFICATION_MISSING_STOP,
  verifyThenLaunchUpload,
} from "./release-upload-orchestration";
import {
  DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  EXPECTED_PRODUCTION_BINDING_COUNT,
} from "./worker-variable-preservation";

/** Dummy. Not the live version, not any real Worker version. */
const DUMMY_LIVE_VERSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/** A dummy immutable build output, in the shape the release path produces. */
const DUMMY_GENERATED_CONFIG: Record<string, unknown> = {
  name: "forever-offline-orchestration-fixture",
  main: "index.mjs",
  compatibility_date: "2026-07-30",
  compatibility_flags: ["nodejs_compat"],
  keep_vars: true,
  assets: { binding: "ASSETS", directory: "./public" },
};

/** A sanitized twelve-name live snapshot. Names only; no value exists here. */
const DUMMY_LIVE_BINDING_NAMES = [
  ...DEPLOYMENT_MANAGED_PLAIN_TEXT_BINDINGS,
  "ASSETS",
  "STUDIO_MEDIA",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "STUDIO_SESSION_SECRET",
  "STUDIO_ADMIN_TOKEN",
  "STUDIO_WEBHOOK_SECRET",
  "STUDIO_STORAGE_SIGNING_KEY",
  "STUDIO_INTERNAL_API_KEY",
  "STUDIO_TELEMETRY_KEY",
];

let workspace = "";
let specificationPath = "";
let generatedConfigPath = "";
let verifiedDigest = "";
let generatedBytesBefore: Buffer;

/** Records every launch. Length is the assertion; the value is never used. */
let launches: number;
const launcherSpy = () => {
  launches += 1;
  return { status: 0 } as const;
};

beforeEach(() => {
  launches = 0;
  workspace = mkdtempSync(join(tmpdir(), "forever-upload-orchestration-"));
  specificationPath = join(workspace, "wrangler.upload.json");
  generatedConfigPath = join(workspace, "wrangler.json");

  writeFileSync(
    generatedConfigPath,
    `${JSON.stringify(DUMMY_GENERATED_CONFIG, null, 2)}\n`,
    "utf8",
  );
  generatedBytesBefore = readFileSync(generatedConfigPath);

  // ---- the applicable offline PREUPLOAD verification, in full ---------------
  const specification = buildUploadSpecification({
    generatedConfig: DUMMY_GENERATED_CONFIG,
    expectedLiveVersion: DUMMY_LIVE_VERSION,
  });
  const preupload = verifyUploadSpecification({
    specification,
    generatedConfig: DUMMY_GENERATED_CONFIG,
    expectedLiveVersion: DUMMY_LIVE_VERSION,
    liveSnapshotVersionId: DUMMY_LIVE_VERSION,
    liveBindingNames: DUMMY_LIVE_BINDING_NAMES,
  });
  if (!preupload.ok || preupload.normalized === null) {
    throw new Error(
      `the dummy fixture did not satisfy PREUPLOAD: ${JSON.stringify(preupload.violations)}`,
    );
  }

  writeFileSync(specificationPath, preupload.normalized, "utf8");
  verifiedDigest = createHash("sha256").update(preupload.normalized).digest("hex");
});

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

const decide = () =>
  verifyThenLaunchUpload({
    specificationPath,
    verifiedDigest,
    generatedConfigPath,
    generatedBytesBefore,
    launch: launcherSpy,
  });

describe("the dummy fixture really passed the offline PREUPLOAD contract", () => {
  it("carries exactly the twelve-name source and the two pinned inherit records", () => {
    expect(DUMMY_LIVE_BINDING_NAMES).toHaveLength(EXPECTED_PRODUCTION_BINDING_COUNT);
    const specification = JSON.parse(readFileSync(specificationPath, "utf8")) as {
      unsafe: { bindings: { name: string; type: string; version_id: string }[] };
    };
    expect(specification.unsafe.bindings).toHaveLength(2);
    for (const binding of specification.unsafe.bindings) {
      expect(binding.type).toBe("inherit");
      expect(binding.version_id).toBe(DUMMY_LIVE_VERSION);
    }
  });
});

describe("PINNED_SPEC_CONSUMED: the verified bytes are the uploaded bytes", () => {
  it("LAUNCHES when the specification is untouched — the positive control", () => {
    const decision = decide();

    expect(decision.stop).toBeNull();
    expect(decision.launched).toBe(true);
    expect(decision.consumedDigest).toBe(verifiedDigest);
    expect(launches).toBe(1);
  });

  it("STOPS with the named digest mismatch, and NEVER calls the launcher", () => {
    // The specification is changed AFTER PREUPLOAD verified it and BEFORE the
    // final spawn decision — the exact window this guard exists to close.
    const tampered = buildUploadSpecification({
      generatedConfig: DUMMY_GENERATED_CONFIG,
      expectedLiveVersion: "9f8e7d6c-5b4a-4392-8817-06f5e4d3c2b1",
    });
    writeFileSync(specificationPath, normalizeUploadSpecification(tampered), "utf8");

    const decision = decide();

    expect(decision.stop).toBe(UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP);
    expect(decision.launched).toBe(false);
    expect(decision.result).toBeNull();
    expect(decision.consumedDigest).toBeNull();
    // THE assertion mutation control 37 now fails on: no upload, no spawn.
    expect(launches).toBe(0);
  });

  it("STOPS on a change too small to be visible, down to one byte", () => {
    const current = readFileSync(specificationPath, "utf8");
    writeFileSync(specificationPath, `${current} `, "utf8");

    const decision = decide();

    expect(decision.stop).toBe(UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP);
    expect(launches).toBe(0);
  });

  it("STOPS when the verified specification has been removed", () => {
    rmSync(specificationPath);

    const decision = decide();

    expect(decision.stop).toBe(UPLOAD_SPECIFICATION_MISSING_STOP);
    expect(decision.launched).toBe(false);
    expect(launches).toBe(0);
  });

  it("STOPS when the immutable build output moved underneath the specification", () => {
    writeFileSync(
      generatedConfigPath,
      `${JSON.stringify({ ...DUMMY_GENERATED_CONFIG, compatibility_date: "2026-08-01" }, null, 2)}\n`,
      "utf8",
    );

    const decision = decide();

    expect(decision.stop).toBe(IMMUTABLE_BUILD_OUTPUT_CHANGED_STOP);
    expect(decision.launched).toBe(false);
    expect(launches).toBe(0);
  });

  it("refuses without echoing the specification, a digest secret or raw output", () => {
    writeFileSync(specificationPath, '{"leaked":"CANARY_VALUE_IN_SPECIFICATION_9F3K"}\n', "utf8");

    const decision = decide();

    expect(decision.stop).toBe(UPLOAD_SPECIFICATION_DIGEST_MISMATCH_STOP);
    expect(JSON.stringify(decision)).not.toContain("CANARY_VALUE_IN_SPECIFICATION_9F3K");
    expect(launches).toBe(0);
  });

  it("performs no network activity of any kind — the launcher IS the only side effect", () => {
    // The decision touches the filesystem and nothing else. With the launcher
    // never called, a refusal cannot reach Wrangler, Cloudflare or a socket.
    rmSync(specificationPath);
    expect(decide().launched).toBe(false);
    expect(launches).toBe(0);
  });
});

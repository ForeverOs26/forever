/**
 * FOREVER-STUDIO-001 — bundle boundary.
 *
 * The browser must never receive service-role code or credentials. Studio's
 * client-reachable modules (routes, components, the functions file, the
 * middleware file) may reference server modules ONLY through dynamic
 * `await import(...)` inside server-executed callbacks, which the compiler
 * strips from the client build. These static scans pin that structure; the
 * production-build asset scan is performed in CI/validation on `.output`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const CLIENT_REACHABLE = [
  "src/routes/studio.tsx",
  "src/routes/studio.upload.tsx",
  "src/routes/studio.members.tsx",
  "src/routes/studio.project.$slug.tsx",
  "src/routes/studio.resale.$id.tsx",
  "src/routes/resale.$slug.tsx",
  "src/lib/listing-service.ts",
  "src/features/forever-studio/studio-types.ts",
  "src/features/forever-studio/studio.functions.ts",
  "src/features/forever-studio/studio-auth.ts",
  "src/features/forever-studio/amenity-editor-state.ts",
  "src/features/forever-studio/components/StudioDashboard.tsx",
  "src/features/forever-studio/components/StudioUploader.tsx",
  "src/features/forever-studio/components/StudioMembers.tsx",
  "src/features/forever-studio/components/StudioProjectAmenitiesEditor.tsx",
  "src/features/forever-studio/components/StudioProjectEditor.tsx",
  "src/features/forever-studio/components/StudioResaleEditor.tsx",
  "src/features/forever-studio/components/StudioLogin.tsx",
  "src/features/forever-studio/components/StudioShell.tsx",
  "src/features/forever-studio/components/useStudioSession.ts",
  "src/features/forever-studio/components/archive-upload.ts",
  "src/features/forever-studio/components/upload-transport.ts",
  "src/routes/media.$.ts",
  "src/routes/studio_.forgot-password.tsx",
  "src/routes/studio_.reset-password.tsx",
  "src/features/forever-studio/studio-recovery-contract.ts",
  "src/features/forever-studio/components/studio-recovery-mode.ts",
  "src/features/forever-studio/components/studio-recovery-client.ts",
  "src/features/forever-studio/components/studio-recovery-shared-deny.ts",
  "src/features/forever-studio/components/StudioForgotPassword.tsx",
  "src/features/forever-studio/components/StudioResetPassword.tsx",
];

describe("Studio bundle boundary", () => {
  it("no client-reachable module statically imports server-only code", () => {
    for (const path of CLIENT_REACHABLE) {
      const source = read(path);
      // Static ESM imports of server modules are forbidden everywhere in the
      // client-reachable graph; dynamic import() inside handlers is the only
      // allowed channel.
      expect(source, path).not.toMatch(/^import .*client\.server/m);
      expect(source, path).not.toMatch(
        /^import .*\/server\/(deps|service|membership|extraction|contracts)/m,
      );
      expect(source, path).not.toMatch(/^import .*ingest-client/m);
      expect(source, path).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(source, path).not.toContain("supabaseAdmin");
    }
  });

  it("public media paths and titles cannot be derived from original filenames", () => {
    const extraction = read("src/features/forever-studio/server/extraction.ts");
    expect(extraction).not.toContain("prettyTitleFromFileName");
    expect(extraction).not.toContain("publicPathForMedia");
    expect(extraction).toContain("publicPathForDerivative(");
    expect(extraction).toContain("derivativeSha256");
    expect(extraction).toContain("neutralPublicMediaTitle(");
    expect(extraction).not.toContain(
      'canonicalPublicContentType(candidate.name, publicDigest.head, "image")',
    );
  });

  it("server functions and middleware reach server modules only via dynamic import", () => {
    const functions = read("src/features/forever-studio/studio.functions.ts");
    const auth = read("src/features/forever-studio/studio-auth.ts");
    expect(functions).toMatch(/await import\("\.\/server\/service"\)/);
    expect(auth).toMatch(/await import\("\.\/server\/deps\.server"\)/);
  });

  it("only deps.server.ts touches the service-role client", () => {
    const studioFiles = [
      "src/features/forever-studio/server/contracts.ts",
      "src/features/forever-studio/server/service.ts",
      "src/features/forever-studio/server/extraction.ts",
      "src/features/forever-studio/server/membership.ts",
      "src/features/forever-studio/server/errors.ts",
    ];
    for (const path of studioFiles) {
      expect(read(path), path).not.toContain("client.server");
      expect(read(path), path).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
    const deps = read("src/features/forever-studio/server/deps.server.ts");
    expect(deps).toContain('from "@/integrations/supabase/client.server"');
    // The credential itself is read only by the shared server client module,
    // never by Studio code.
    expect(deps).not.toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
  });

  it("no client-reachable module references private contact columns (item 1)", () => {
    for (const path of CLIENT_REACHABLE) {
      const source = read(path);
      expect(source, path).not.toContain("contact_name");
      expect(source, path).not.toContain("contact_phone");
      expect(source, path).not.toContain("contact_email");
    }
  });

  it("Studio stays out of the public surface: nav, sitemap, and demo mode", () => {
    expect(read("src/components/layout/Header.tsx")).not.toContain("studio");
    expect(read("src/routes/sitemap[.]xml.ts")).not.toContain("studio");
    expect(read("src/routes/sitemap[.]xml.ts")).not.toContain("resale");
    // Studio routes are marked noindex.
    for (const route of CLIENT_REACHABLE.filter((path) => path.includes("routes/studio"))) {
      expect(read(route), route).toContain("noindex");
    }
    // The server boundary refuses Studio writes in Partner Demo mode.
    expect(read("src/features/forever-studio/server/membership.ts")).toContain(
      "studio_disabled_in_partner_demo",
    );
    expect(read("src/features/forever-studio/server/deps.server.ts")).toContain(
      "VITE_PARTNER_DEMO",
    );
  });

  it("R2 credentials and the S3 signer stay server-only", () => {
    // No client-reachable module may name an R2 secret, reach the signer, or
    // reach the provider registry: a presigned URL is minted on the server or
    // not at all.
    for (const path of CLIENT_REACHABLE) {
      const source = read(path);
      for (const secret of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
        expect(source, `${path}:${secret}`).not.toContain(secret);
      }
      expect(source, path).not.toContain("STUDIO_STORAGE_WRITE_PROVIDER");
      expect(source, path).not.toContain("r2.cloudflarestorage.com");
      expect(source, path).not.toMatch(
        /^import .*storage\/(sigv4|r2-client|r2-provider|registry)/m,
      );
      expect(source, path).not.toContain("AWS4-HMAC-SHA256");
    }
    // The signer is reached only from the R2 client and the local test harness.
    const client = read("src/features/forever-studio/server/storage/r2-client.server.ts");
    expect(client).toContain('from "./sigv4.server"');
    // The route file itself reaches the handler only through dynamic import.
    const route = read("src/routes/media.$.ts");
    expect(route).toMatch(/await import\(\s*"@\/features\/forever-studio\/server\/public-media"/);
    expect(route).toMatch(
      /await import\(\s*\n?\s*"@\/features\/forever-studio\/server\/public-media\.server"/,
    );
  });

  it("the Worker binding plane stays server-only and reaches no credential", () => {
    // The binding modules are `.server.ts` and must be as unreachable from the
    // browser as the signer is — the binding is a capability handle, and a
    // client-reachable path to one would be a path to the private bucket.
    for (const path of CLIENT_REACHABLE) {
      const source = read(path);
      expect(source, path).not.toMatch(/^import .*storage\/r2-bindings/m);
      expect(source, path).not.toMatch(/^import .*storage\/r2-binding-objects/m);
      expect(source, path).not.toContain("R2_PRIVATE_SOURCES");
      expect(source, path).not.toContain("R2_PROJECT_ARCHIVES");
      expect(source, path).not.toContain("__env__");
    }
    // The binding plane itself never touches a credential or the signer: it is
    // the transport that exists precisely BECAUSE it needs neither.
    const bindings = read("src/features/forever-studio/server/storage/r2-bindings.server.ts");
    const objects = read("src/features/forever-studio/server/storage/r2-binding-objects.server.ts");
    for (const source of [bindings, objects]) {
      expect(source).not.toContain("sigv4");
      expect(source).not.toContain("AWS4-HMAC-SHA256");
      expect(source).not.toContain("R2_SECRET_ACCESS_KEY");
      expect(source).not.toMatch(/^import .*r2-client\.server/m);
    }
    // And the stage vocabulary carries no free-text field for a key or a name.
    const stage = read("src/features/forever-studio/server/processing-stage.ts");
    expect(stage).toContain("STUDIO_STAGE_TELEMETRY_KEYS");
    expect(stage).not.toContain("objectKey");
    expect(stage).not.toContain("fileName");
  });

  it("the archive capability crosses the boundary as a closed enum and nothing else", () => {
    // The client-safe module is a vocabulary, not a probe: it may not reach
    // any server module, and it may not name a binding, bucket or credential.
    const capability = read("src/features/forever-studio/archive-capability.ts");
    expect(capability).not.toMatch(/^import /m);
    for (const forbidden of [
      "R2_PRIVATE_SOURCES",
      "R2_PUBLIC_MEDIA",
      "R2_PROJECT_ARCHIVES",
      "__env__",
      "cloudflarestorage",
      "forever-private-sources",
      "AWS4-HMAC-SHA256",
    ]) {
      expect(capability, forbidden).not.toContain(forbidden);
    }
    // The enforcement lives on the server, where the client cannot see it.
    const guard = read("src/features/forever-studio/server/archive-capability.server.ts");
    expect(guard).toContain("assertArchiveControlPlaneAvailable");
    for (const path of CLIENT_REACHABLE) {
      const source = read(path);
      expect(source, path).not.toMatch(/^import .*archive-capability\.server/m);
      expect(source, path).not.toContain("archiveControlPlane");
    }
  });

  it("the write provider is decided on the server and persisted per job", () => {
    const service = read("src/features/forever-studio/server/service.ts");
    // Creation reads the global setting exactly once; processing never does.
    expect(service).toContain("deps.storageProviders.writeProviderId");
    expect(service).toContain("deps.storageProviders.get(jobStorageProvider(claimed))");
    const processing = service.slice(service.indexOf("export async function processClaimedJob"));
    expect(processing).not.toContain("writeProviderId");
  });

  it("the ingestion lane's owner-tooling boundary is respected", () => {
    // ingest-client stays CLI-only: no Studio module imports it.
    const all = CLIENT_REACHABLE.concat([
      "src/features/forever-studio/server/contracts.ts",
      "src/features/forever-studio/server/service.ts",
      "src/features/forever-studio/server/extraction.ts",
      "src/features/forever-studio/server/membership.ts",
      "src/features/forever-studio/server/deps.server.ts",
    ]);
    for (const path of all) {
      expect(read(path), path).not.toContain("forever-ingestion/ingest-client");
      expect(read(path), path).not.toContain("forever-ingestion/cli");
    }
  });
});

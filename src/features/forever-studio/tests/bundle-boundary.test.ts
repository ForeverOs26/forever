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
  "src/features/forever-studio/components/StudioDashboard.tsx",
  "src/features/forever-studio/components/StudioUploader.tsx",
  "src/features/forever-studio/components/StudioMembers.tsx",
  "src/features/forever-studio/components/StudioProjectEditor.tsx",
  "src/features/forever-studio/components/StudioResaleEditor.tsx",
  "src/features/forever-studio/components/StudioLogin.tsx",
  "src/features/forever-studio/components/StudioShell.tsx",
  "src/features/forever-studio/components/useStudioSession.ts",
  "src/features/forever-studio/components/archive-upload.ts",
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

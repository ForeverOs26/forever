import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Forever Partner Demo Windows launcher", () => {
  const command = read("scripts/demo/Start-Forever-Partner-Demo.cmd");
  const launcher = read("scripts/demo/Start-ForeverPartnerDemo.ps1");
  const viteConfig = read("vite.config.ts");

  it("limits the required policy override to the one launcher process and uses no detached shell", () => {
    expect(command).toMatch(/^powershell\.exe .* -ExecutionPolicy Bypass -File /im);
    expect(command).not.toMatch(/\bstart\s+"/i);
    expect(command).toContain("-File");
  });

  it("forces the Partner Demo safety controls at process scope", () => {
    expect(launcher).toContain("$env:VITE_PARTNER_DEMO = 'true'");
    expect(launcher).toContain("$env:VITE_PARTNER_DEMO_DATA = 'committed-local'");
    expect(launcher).toContain("$env:VITE_DEMO_LEAD_MODE = 'true'");
    expect(launcher).toContain("$env:VITE_SUPABASE_URL = 'http://127.0.0.1:1'");
  });

  it("uses an exact strict port and a bounded readiness proof before opening", () => {
    expect(launcher).toContain("'--strictPort'");
    expect(launcher).toContain("'partner-demo'");
    expect(launcher).toContain("$StartupTimeoutSeconds");
    expect(launcher).toContain("Invoke-WebRequest -Uri $healthUrl");
    expect(launcher.indexOf("Safe readiness confirmed")).toBeLessThan(
      launcher.indexOf("Start-Process $demoUrl"),
    );
    expect(launcher).not.toContain("Start-Job");
    expect(launcher).not.toMatch(/Start-Sleep\s+-Seconds\s+6/);
  });

  it("proves the intended Forever server, no-write boundary, and local data source", () => {
    expect(viteConfig).toContain('app: "forever"');
    expect(viteConfig).toContain('mode: "partner-demo"');
    expect(viteConfig).toContain('leadWrites: leadWritesBlocked ? "blocked" : "unproven"');
    expect(viteConfig).toContain('projectData: localDataOnly ? "committed-local" : "unproven"');
  });

  it("serializes launches and owns child shutdown", () => {
    expect(launcher).toContain("Local\\ForeverPartnerDemoV1");
    expect(launcher).toContain("Wait-Process -Id $server.Id");
    expect(launcher).toContain("Stop-Process -Id $server.Id -Force");
    expect(launcher).toContain("$mutex.ReleaseMutex()");
  });
});

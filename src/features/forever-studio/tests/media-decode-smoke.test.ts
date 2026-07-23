import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createPublicDerivative } from "../server/media-truth";
import { syntheticPng } from "./media-truth-fixtures";

const CHROMIUM_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((candidate): candidate is string => Boolean(candidate));

const chromium = CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate));
const decodeDescribe = chromium ? describe : describe.skip;

function chromiumDom(html: string): string {
  if (!chromium) throw new Error("chromium_unavailable");
  const root = mkdtempSync(join(tmpdir(), "forever-media-decode-"));
  try {
    const page = join(root, "decode.html");
    writeFileSync(page, html, "utf8");
    const result = spawnSync(
      chromium,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        `--user-data-dir=${join(root, "profile")}`,
        "--dump-dom",
        pathToFileURL(page).href,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30_000 },
    );
    if (result.status !== 0) {
      throw new Error(`chromium_failed:${result.status}:${result.stderr.slice(0, 500)}`);
    }
    return result.stdout;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function derivative(bytes: Buffer, contentType: string): Buffer {
  const result = createPublicDerivative({
    bytes,
    originalSha256: createHash("sha256").update(bytes).digest("hex"),
    originalSize: bytes.length,
    observedContentType: contentType,
  });
  if (!result.eligible) throw new Error(`derivative_ineligible:${result.reason}`);
  return result.bytes;
}

decodeDescribe("real browser image decode smoke", () => {
  it("decodes representative sanitized JPEG, PNG, and WebP derivatives in Chromium", () => {
    const images = [
      {
        name: "jpeg",
        type: "image/jpeg",
        bytes: derivative(readFileSync("src/assets/phuket-hero.jpg"), "image/jpeg"),
      },
      {
        name: "png",
        type: "image/png",
        bytes: derivative(syntheticPng(true, 8), "image/png"),
      },
      {
        name: "webp",
        type: "image/webp",
        bytes: derivative(
          Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"),
          "image/webp",
        ),
      },
    ];
    const tags = images
      .map(
        (image) =>
          `<img data-name="${image.name}" src="data:${image.type};base64,${image.bytes.toString("base64")}">`,
      )
      .join("");
    const dom = chromiumDom(`<!doctype html><body>${tags}<script>
        addEventListener("load", () => {
          const result = [...document.images].map((image) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
              ? image.dataset.name + ":ok:" + image.naturalWidth + "x" + image.naturalHeight
              : image.dataset.name + ":failed"
          );
          document.body.textContent = "DECODE_RESULT=" + result.join(",");
        });
      </script></body>`);

    expect(dom).toMatch(/DECODE_RESULT=jpeg:ok:\d+x\d+,png:ok:3x2,webp:ok:1x1/);
  }, 60_000);
});

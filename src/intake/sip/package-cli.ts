/** SIP-001B package CLI — explicit, generic, local-only post-freeze packaging. */
import { readFileSync } from "node:fs";

import type { ExtractedPriceList } from "@/import/types";

import { parseSipPackageArgs } from "./package-cli-args";
import { writeSIP001BPackage, type BoundPriceArtifactPaths } from "./update-package";

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const values = parseSipPackageArgs(process.argv.slice(2).filter((arg) => arg !== "--"));
  const priceArtifacts: BoundPriceArtifactPaths = {
    source_proof: values["--price-source-proof"],
    qualification: values["--price-qualification"],
    candidate_price_list: values["--price-candidate"],
    review_summary: values["--price-review-summary"],
    preparation_summary: values["--price-preparation-summary"],
    reviewed_price_list: values["--reviewed"],
  };
  const result = writeSIP001BPackage({
    projectSlug: values["--project-slug"],
    updateDate: values["--update-date"],
    ...(values["--origin-channel"] ? { originChannel: values["--origin-channel"] } : {}),
    pricePdfPath: values["--price-pdf"],
    masterPdfPath: values["--master-pdf"],
    priceArtifacts,
    previousPriceList: read(values["--previous"]) as ExtractedPriceList,
    outDir: values["--out-dir"],
    workspaceRoot: values["--workspace"],
  });
  console.log(
    JSON.stringify({
      bundle_id: result.sourceBundle.bundle_id,
      version_diff: result.diff.summary_counts,
      master_pages: result.masterRegistration.page_count,
    }),
  );
}

main();

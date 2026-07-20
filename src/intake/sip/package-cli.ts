import { readFileSync } from "node:fs";
import { writeSIP001BPackage } from "./update-package";
const values: Record<string, string> = {};
const args = process.argv.slice(2).filter((arg) => arg !== "--");
for (let i = 0; i < args.length; i += 2) {
  if (!args[i]?.startsWith("--") || !args[i + 1]) throw new Error("sip_package_invalid_arguments");
  values[args[i]] = args[i + 1];
}
const required = [
  "--price-pdf",
  "--master-pdf",
  "--reviewed",
  "--previous",
  "--summary",
  "--out-dir",
  "--workspace",
];
if (required.some((key) => !values[key])) throw new Error("sip_package_required_arguments_missing");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const result = writeSIP001BPackage({
  projectSlug: "coralina",
  updateDate: "2026-07-17",
  pricePdfPath: values["--price-pdf"],
  masterPdfPath: values["--master-pdf"],
  priceList: read(values["--reviewed"]),
  previousPriceList: read(values["--previous"]),
  priceArtifactHashes: read(values["--summary"]).artifact_hashes,
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

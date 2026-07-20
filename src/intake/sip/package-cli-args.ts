/** Explicit argument parser for the generic SIP-001B package CLI. */
export const PACKAGE_VALUE_FLAGS = new Set([
  "--project-slug",
  "--update-date",
  "--origin-channel",
  "--price-pdf",
  "--master-pdf",
  "--price-source-proof",
  "--price-qualification",
  "--price-candidate",
  "--price-review-summary",
  "--price-preparation-summary",
  "--reviewed",
  "--previous",
  "--out-dir",
  "--workspace",
]);

const REQUIRED_FLAGS = [
  "--project-slug",
  "--update-date",
  "--price-pdf",
  "--master-pdf",
  "--price-source-proof",
  "--price-qualification",
  "--price-candidate",
  "--price-review-summary",
  "--price-preparation-summary",
  "--reviewed",
  "--previous",
  "--out-dir",
  "--workspace",
];

export function parseSipPackageArgs(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !PACKAGE_VALUE_FLAGS.has(flag)) {
      throw new Error(`sip_package_unknown_argument: ${flag ?? ""}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`sip_package_value_required: ${flag}`);
    }
    if (Object.hasOwn(values, flag)) throw new Error(`sip_package_duplicate_argument: ${flag}`);
    values[flag] = value;
  }
  for (const flag of REQUIRED_FLAGS) {
    if (!values[flag]) throw new Error(`sip_package_required_argument_missing: ${flag}`);
  }
  return values;
}

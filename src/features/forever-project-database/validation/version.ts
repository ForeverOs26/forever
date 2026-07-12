// Reuse the RC4.5 version guard (itself the RC4.4/RC3.3 one) under a
// canonical-database name — one version validation across the whole family.
export { validateExtractionVersion as validateProjectRecordVersion } from "@/features/forever-extraction-pipeline";

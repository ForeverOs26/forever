/**
 * Forever Extraction Pipeline — version validation.
 *
 * An extraction version — and the source revision every fact and plan pins —
 * *is* the RC4.4/RC3.3 version shape, so its guard is that guard, re-exported
 * under an extraction-facing name rather than restated — one definition of a
 * well-formed version across the whole source-and-extraction family, and no
 * duplicated validation logic. All checks return issues; none throw.
 */

export { validateProjectSourceVersion as validateExtractionVersion } from "@/features/forever-project-sources";

/**
 * Forever Project Sources — version validation.
 *
 * A source version *is* the RC3.3 version shape, so its guard is the RC3.3
 * guard, re-exported under a project-source name rather than restated — one
 * definition of a well-formed version across the whole source family, and no
 * duplicated validation logic. All checks return issues; none throw.
 */

export { validateSourceVersion as validateProjectSourceVersion } from "@/features/forever-source-registry";

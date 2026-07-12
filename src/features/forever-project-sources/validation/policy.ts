/**
 * Forever Project Sources — policy validation.
 *
 * A source policy *is* the RC4.0 policy shape, so its guard is the RC4.0
 * guard, re-exported under a project-source name rather than restated — one
 * definition of a well-formed policy across the whole system, and no
 * duplicated validation logic. All checks return issues; none throw.
 */

export { validateProjectIntegrationPolicy as validateProjectSourcePolicy } from "@/features/forever-project-integration";

/**
 * Forever Project Factory — version validation.
 *
 * A factory version *is* the RC4.0 version shape (through RC4.2), so its guard
 * is the RC4.0 guard, re-exported under a factory-facing name rather than
 * restated — one definition of a well-formed version across the whole system,
 * and no duplicated validation logic. All checks return issues; none throw.
 */

export { validateProjectIntegrationVersion as validateFactoryVersion } from "@/features/forever-project-integration";

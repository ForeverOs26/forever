/**
 * Forever Project Factory — policy validation.
 *
 * A {@link import("../policy").FactoryPolicy} *is* the RC4.0 integration
 * policy, so its guard is the RC4.0 guard, re-exported under a factory-facing
 * name rather than restated. That guard already reuses the Forever Pipeline
 * (RC3.5) execution-mode and error-strategy runtime guards and the Forever Sync
 * (RC3.2) retry shape — one behavioural contract, one validator, across the
 * whole system, and no duplicated validation logic. All checks return issues;
 * none throw.
 */

export { validateProjectIntegrationPolicy as validateFactoryPolicy } from "@/features/forever-project-integration";

// Reuse the RC4.0 policy guard — the policy *is* the RC4.0 policy, and so is
// its validation. One rule across the whole system, never a local variant.
export { validateProjectIntegrationPolicy as validateProjectDatabasePolicy } from "@/features/forever-project-integration";

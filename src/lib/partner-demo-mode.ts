type PartnerDemoEnv = Pick<ImportMetaEnv, "DEV"> & {
  VITE_PARTNER_DEMO?: string;
  VITE_DEMO_LEAD_MODE?: string;
};

/** True only for the launcher-controlled local Partner Demo process. */
export function isPartnerDemoModeEnabled(env: PartnerDemoEnv = import.meta.env): boolean {
  return env.DEV && env.VITE_PARTNER_DEMO === "true";
}

/**
 * Local no-write behavior is opt-in for ordinary development and mandatory for
 * the Partner Demo. Production always returns false.
 */
export function isDemoLeadModeEnabled(env: PartnerDemoEnv = import.meta.env): boolean {
  return env.DEV && (env.VITE_PARTNER_DEMO === "true" || env.VITE_DEMO_LEAD_MODE === "true");
}

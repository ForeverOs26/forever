export const IMPORT_TARGETS = ["local", "staging", "production"] as const;

export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export interface ImportTargetDefinition {
  name: ImportTarget;
  expectedProjectId: string | null;
  executeAllowedByTarget: boolean;
}

export interface ImportTargetIdentity {
  projectId?: string;
}

export const IMPORT_TARGET_REGISTRY: Readonly<Record<ImportTarget, ImportTargetDefinition>> = {
  local: {
    name: "local",
    expectedProjectId: "forever-local",
    executeAllowedByTarget: true,
  },
  staging: {
    name: "staging",
    expectedProjectId: null,
    executeAllowedByTarget: false,
  },
  production: {
    name: "production",
    expectedProjectId: null,
    executeAllowedByTarget: false,
  },
};

export function isImportTarget(value: string): value is ImportTarget {
  return IMPORT_TARGETS.includes(value as ImportTarget);
}

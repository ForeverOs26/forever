/**
 * Forever Source Registry — source definition.
 *
 * A {@link SourceDefinition} is the complete, declarative description of one
 * source: its identity and version, where it sits in its lifecycle, how
 * authoritative and trusted it is, what it can do, which canonical entities it
 * supplies, and how it bridges to the synchronization foundation. It is the
 * unit the registry stores and the validation pipeline judges.
 *
 * The definition reuses the neighbouring foundations rather than restating them:
 * `supportedEntities` are the Forever Import (RC3.1) entity kinds, and the
 * optional `syncSystem`/`syncDirections` are the Forever Sync (RC3.2) vocabulary,
 * so a described source lines up with the import and sync paths that will later
 * consume it. It carries no connection detail, credential, or transport — those
 * live entirely outside RC3.3.
 */

import type { SyncDirection, SyncSystem } from "@/features/forever-sync";

import type { SourceCapability } from "./capability";
import type { SourceIdentity } from "./identity";
import type { SourceLifecycle } from "./lifecycle";
import type { SourceMetadata } from "./metadata";
import type { SourcePriority } from "./priority";
import type { SourceTrustLevel } from "./trust";
import type { SourceEntityKind } from "./types";
import type { SourceVersion } from "./version";

/** The full declarative description of one source. */
export interface SourceDefinition {
  identity: SourceIdentity;
  version: SourceVersion;
  lifecycle: SourceLifecycle;
  priority: SourcePriority;
  trustLevel: SourceTrustLevel;
  /** Everything this source can do; may include explicitly unsupported kinds. */
  capabilities: SourceCapability[];
  /** Canonical entity kinds this source can supply. Reuses the RC3.1 kinds. */
  supportedEntities: SourceEntityKind[];
  /** Optional bridge to RC3.2: the sync system this source corresponds to. */
  syncSystem?: SyncSystem;
  /** Optional bridge to RC3.2: the sync directions this source can take part in. */
  syncDirections?: SyncDirection[];
  metadata?: SourceMetadata;
}

/**
 * Identity helper that pins an object to the {@link SourceDefinition} shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the definition unchanged.
 */
export function defineSource(definition: SourceDefinition): SourceDefinition {
  return definition;
}

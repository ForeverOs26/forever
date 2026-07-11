import type { AuditFields, ForeverId, ISODate, SourceMetadata } from "./common";
import type { ConstructionPhase, ConstructionStatus } from "./enums";

/**
 * Construction Progress — a point-in-time record of build status.
 *
 * A canonical structure for future building-level construction tracking
 * (Data Standard section 14, "Building-level construction progress"). A
 * record may describe the whole project (`buildingId` omitted) or a specific
 * building. `status` is the normalized enum; `statusRaw` preserves the
 * original wording.
 */
export interface ForeverConstructionProgress extends AuditFields {
  id: ForeverId;
  projectId: ForeverId;
  buildingId?: ForeverId;
  status: ConstructionStatus;
  statusRaw: string;
  phase?: ConstructionPhase;
  /** Completion percentage in the range 0..100. */
  percentComplete?: number;
  completionDate?: ISODate | string;
  reportedDate?: ISODate | string;
  notes?: string;
  source?: SourceMetadata;
}

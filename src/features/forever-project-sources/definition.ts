/**
 * Forever Project Sources — the source definition.
 *
 * A {@link ProjectSourceDefinition} is the complete, declarative description of
 * one catalogued document: its identity and version, its descriptor
 * (document type, file format, language, dates), the authority standing behind
 * it, its current status, the RC3.3 source-system type it arrived through, its
 * relationships to other catalogued sources, and the optional policy and
 * metadata that govern and describe it. It is the unit the registry stores and
 * the validation pipeline judges.
 *
 * {@link describeProjectSource} is the deterministic entry point that builds a
 * definition from a verified project slug and the facts the caller can prove.
 * It is pure — it reads no clock and holds no shared state, so every call with
 * equal input returns an equal, independent value that is safe to mutate,
 * diff, register, and validate. Where a fact is not supplied it defaults to
 * the explicit safe posture (`unknown` origin, `unknown`/`unverified`
 * authority, `registered` status, revision `1.0.0`) — a stated convention,
 * never a fabricated fact.
 */

import type { ProjectSourceAuthority } from "./authority";
import { projectSourceAuthority } from "./authority";
import type {
  ProjectSourceDescriptor,
  ProjectSourceDocumentType,
  ProjectSourceFileFormat,
} from "./descriptor";
import { projectSourceDescriptor } from "./descriptor";
import type { ProjectSourceIdentity } from "./identity";
import { deriveProjectSourceIdentity } from "./identity";
import type { ProjectSourcePolicy } from "./policy";
import type { ProjectSourceRelationships } from "./relationships";
import type { ProjectSourceStatus } from "./status";
import type { ProjectSourceMetadata, ProjectSourceOriginType } from "./types";
import type { ProjectSourceVersion } from "./version";
import { projectSourceVersion } from "./version";

/** The full declarative description of one catalogued project source. */
export interface ProjectSourceDefinition {
  identity: ProjectSourceIdentity;
  descriptor: ProjectSourceDescriptor;
  version: ProjectSourceVersion;
  authority: ProjectSourceAuthority;
  status: ProjectSourceStatus;
  /** The RC3.3 source-system type this document arrived through. */
  origin: ProjectSourceOriginType;
  relationships?: ProjectSourceRelationships;
  /** Optional behavioural contract for a future intake runtime. */
  policy?: ProjectSourcePolicy;
  metadata?: ProjectSourceMetadata;
}

/**
 * Identity helper that pins an object to the {@link ProjectSourceDefinition}
 * shape.
 *
 * Gives call sites full type-checking and inference without forcing a factory;
 * the returned value is the definition unchanged.
 */
export function defineProjectSource(definition: ProjectSourceDefinition): ProjectSourceDefinition {
  return definition;
}

/** The facts {@link describeProjectSource} builds a definition from. */
export interface DescribeProjectSourceInput {
  /** The verified slug of the project the document belongs to. */
  projectSlug: string;
  /** The document's slug within the project, e.g. `price-list`. */
  sourceSlug: string;
  documentType: ProjectSourceDocumentType;
  fileFormat: ProjectSourceFileFormat;
  /** Display name; defaults to the normalized source slug when omitted. */
  name?: string;
  /** Revision of the document; defaults to `1.0.0`, the first received revision. */
  version?: ProjectSourceVersion;
  /** Attribution; defaults to the explicit `unknown`/`unverified` posture. */
  authority?: ProjectSourceAuthority;
  /** Current standing; defaults to `registered`. */
  status?: ProjectSourceStatus;
  /** RC3.3 source-system type; defaults to the explicit `unknown`. */
  origin?: ProjectSourceOriginType;
  language?: string;
  uploadedAt?: string;
  documentDate?: string;
  relationships?: ProjectSourceRelationships;
  policy?: ProjectSourcePolicy;
  metadata?: ProjectSourceMetadata;
}

/**
 * Describe one project source deterministically from a verified project slug
 * and the facts the caller can prove.
 *
 * Pure and total: the same input always yields a byte-identical definition.
 * The identity (including the version-addressed id) is derived through the
 * module's own naming rules, optional facts are attached only when supplied,
 * and every default is the explicit safe posture rather than an invented fact.
 * The result is deep-copied from the input, so it never aliases a caller
 * value: mutating a described definition can never reach back into the input,
 * and two definitions described from one input share no state.
 */
export function describeProjectSource(input: DescribeProjectSourceInput): ProjectSourceDefinition {
  const version = input.version ?? projectSourceVersion(1, 0, 0);
  const definition: ProjectSourceDefinition = {
    identity: deriveProjectSourceIdentity(input.projectSlug, input.sourceSlug, {
      name: input.name,
      version,
    }),
    descriptor: projectSourceDescriptor(input.documentType, input.fileFormat, {
      language: input.language,
      uploadedAt: input.uploadedAt,
      documentDate: input.documentDate,
    }),
    version,
    authority: input.authority ?? projectSourceAuthority("unknown"),
    status: input.status ?? "registered",
    origin: input.origin ?? "unknown",
  };
  if (input.relationships !== undefined) definition.relationships = input.relationships;
  if (input.policy !== undefined) definition.policy = input.policy;
  if (input.metadata !== undefined) definition.metadata = input.metadata;
  // Deep-copy so the described definition never aliases the caller's input.
  return structuredClone(definition);
}

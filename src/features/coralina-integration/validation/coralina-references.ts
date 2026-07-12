/**
 * Coralina cross-foundation reference resolution.
 *
 * RC4.0 deliberately leaves one boundary open: it validates that a step *carries*
 * the reference its kind implies, but never resolves that `sourceId`,
 * `connectorId`, or `pipelineId` against the RC3.3/3.4/3.5 registries. This module
 * closes that boundary for the Coralina vertical slice — deterministically, and
 * only for the Coralina bundle (it is not a generic runtime registry).
 *
 * It confirms that every reference the Coralina integration makes resolves:
 * source, connector, and pipeline ids resolve in their registries; the pipeline's
 * own source/connector references resolve; the connector's bound source resolves;
 * the integration's `projectId` is consistent with the canonical record; and every
 * canonical foreign key (developer, location, unit→project, document→project,
 * media→project) resolves. Nothing throws — it returns a structured report.
 */

import { validateReferentialIntegrity } from "@/features/forever-database";
import type { ForeverDatabaseRecord } from "@/features/forever-database";
import type { PipelineDefinition } from "@/features/forever-pipeline";
import {
  projectIntegrationConnectorIds,
  projectIntegrationPipelineIds,
  projectIntegrationSourceIds,
} from "@/features/forever-project-integration";

import { CORALINA_PROJECT_ID } from "../identity";
import { buildCoralinaRecord } from "../adapters/coralina-canonical";
import {
  buildCoralinaIntegrationBundle,
  type CoralinaIntegrationBundle,
} from "../integration/coralina-integration";

/** One resolved-or-unresolved cross-foundation reference. */
export interface CoralinaReferenceCheck {
  /** The kind of reference checked, e.g. `sourceId`, `pipelineId`, `location`. */
  kind: string;
  /** The id or label the check targets. */
  target: string;
  resolved: boolean;
  message: string;
}

/** The structured outcome of resolving every Coralina reference. */
export interface CoralinaReferenceResolution {
  valid: boolean;
  checks: CoralinaReferenceCheck[];
  unresolved: CoralinaReferenceCheck[];
}

function check(
  kind: string,
  target: string,
  resolved: boolean,
  message: string,
): CoralinaReferenceCheck {
  return { kind, target, resolved, message };
}

function collectPipelineRefs(pipeline: PipelineDefinition): {
  sourceIds: string[];
  connectorIds: string[];
} {
  const sourceIds = new Set<string>();
  const connectorIds = new Set<string>();
  for (const stage of pipeline.stages) {
    for (const step of stage.steps) {
      if (step.sourceId !== undefined) sourceIds.add(step.sourceId);
      if (step.connectorId !== undefined) connectorIds.add(step.connectorId);
    }
  }
  return { sourceIds: [...sourceIds], connectorIds: [...connectorIds] };
}

/**
 * Resolve every reference the Coralina integration bundle makes.
 *
 * Pure and deterministic: identical inputs always produce an equal report.
 */
export function resolveCoralinaReferences(
  bundle: CoralinaIntegrationBundle = buildCoralinaIntegrationBundle(),
  record: ForeverDatabaseRecord = buildCoralinaRecord(),
): CoralinaReferenceResolution {
  const checks: CoralinaReferenceCheck[] = [];
  const { sourceRegistry, connectorRegistry, pipelineRegistry, integration } = bundle;

  // 1. Integration → source/connector/pipeline references resolve in their registries.
  for (const id of projectIntegrationSourceIds(integration)) {
    const ok = sourceRegistry.has(id);
    checks.push(
      check("sourceId", id, ok, ok ? `Source ${id} resolves` : `Source ${id} is unregistered`),
    );
  }
  for (const id of projectIntegrationConnectorIds(integration)) {
    const ok = connectorRegistry.has(id);
    checks.push(
      check(
        "connectorId",
        id,
        ok,
        ok ? `Connector ${id} resolves` : `Connector ${id} is unregistered`,
      ),
    );
  }
  for (const id of projectIntegrationPipelineIds(integration)) {
    const ok = pipelineRegistry.has(id);
    checks.push(
      check(
        "pipelineId",
        id,
        ok,
        ok ? `Pipeline ${id} resolves` : `Pipeline ${id} is unregistered`,
      ),
    );
  }

  // 2. Each referenced pipeline's own source/connector references resolve.
  for (const id of projectIntegrationPipelineIds(integration)) {
    const pipeline = pipelineRegistry.resolve(id);
    if (!pipeline) continue;
    const { sourceIds, connectorIds } = collectPipelineRefs(pipeline);
    for (const sourceId of sourceIds) {
      const ok = sourceRegistry.has(sourceId);
      checks.push(
        check(
          "pipelineSourceId",
          sourceId,
          ok,
          ok
            ? `Pipeline source ${sourceId} resolves`
            : `Pipeline source ${sourceId} is unregistered`,
        ),
      );
    }
    for (const connectorId of connectorIds) {
      const ok = connectorRegistry.has(connectorId);
      checks.push(
        check(
          "pipelineConnectorId",
          connectorId,
          ok,
          ok
            ? `Pipeline connector ${connectorId} resolves`
            : `Pipeline connector ${connectorId} is unregistered`,
        ),
      );
    }
  }

  // 3. Each referenced connector's bound source resolves.
  for (const id of projectIntegrationConnectorIds(integration)) {
    const connector = connectorRegistry.resolve(id);
    if (!connector?.sourceId) continue;
    const ok = sourceRegistry.has(connector.sourceId);
    checks.push(
      check(
        "connectorSourceId",
        connector.sourceId,
        ok,
        ok
          ? `Connector-bound source ${connector.sourceId} resolves`
          : `Connector-bound source ${connector.sourceId} is unregistered`,
      ),
    );
  }

  // 4. projectId consistency across the integration and the canonical record.
  const projectConsistent =
    integration.projectId === CORALINA_PROJECT_ID && record.project.id === CORALINA_PROJECT_ID;
  checks.push(
    check(
      "projectId",
      CORALINA_PROJECT_ID,
      projectConsistent,
      projectConsistent
        ? `Integration, canonical project, and identity all use ${CORALINA_PROJECT_ID}`
        : `projectId mismatch: integration=${String(integration.projectId)} record=${record.project.id}`,
    ),
  );

  // 5. Developer reference: absent developer must pair with an absent developerId.
  const developerConsistent =
    record.developer === null
      ? record.project.developerId === undefined
      : record.project.developerId === record.developer.id;
  checks.push(
    check(
      "developerId",
      record.developer?.id ?? "(none)",
      developerConsistent,
      record.developer === null
        ? "No developer and no developerId (consistent absent reference)"
        : developerConsistent
          ? "project.developerId matches the developer record"
          : "project.developerId does not match the developer record",
    ),
  );

  // 6. Location reference resolves.
  const locationConsistent =
    record.location !== null && record.project.locationId === record.location.id;
  checks.push(
    check(
      "locationId",
      record.location?.id ?? "(none)",
      locationConsistent,
      locationConsistent
        ? "project.locationId resolves to the location record"
        : "project.locationId does not resolve to a location record",
    ),
  );

  // 7. Unit / document / media → project references resolve.
  const projectId = record.project.id;
  const unitsOk = record.units.every((u) => u.projectId === projectId);
  checks.push(
    check(
      "units",
      `${record.units.length} units`,
      unitsOk,
      unitsOk
        ? "Every unit references the Coralina project"
        : "A unit references an unknown project",
    ),
  );
  const documentsOk = record.documents.every((d) => d.projectId === projectId);
  checks.push(
    check(
      "documents",
      `${record.documents.length} documents`,
      documentsOk,
      documentsOk
        ? "Every document references the Coralina project"
        : "A document references an unknown project",
    ),
  );
  const mediaOk = record.media.every((m) => m.projectId === projectId);
  checks.push(
    check(
      "media",
      `${record.media.length} media`,
      mediaOk,
      mediaOk
        ? "Every media asset references the Coralina project"
        : "A media asset references an unknown project",
    ),
  );

  // 8. Full canonical referential integrity (authoritative RC3.0 check).
  const integrity = validateReferentialIntegrity(record);
  checks.push(
    check(
      "canonicalIntegrity",
      "record",
      integrity.valid,
      integrity.valid
        ? "Canonical record passes RC3.0 referential integrity"
        : `Canonical record has ${integrity.issues.length} referential issue(s)`,
    ),
  );

  const unresolved = checks.filter((c) => !c.resolved);
  return { valid: unresolved.length === 0, checks, unresolved };
}

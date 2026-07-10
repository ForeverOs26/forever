/**
 * Barrel for the advisory sub-components. Re-exports both the components and
 * their prop types. Component names and data-type names never collide because
 * data types live in `../types` with `Data` / domain suffixes.
 */

export { ClientSnapshot } from "./ClientSnapshot";
export type { ClientSnapshotProps } from "./ClientSnapshot";

export { RecommendedProjects } from "./RecommendedProjects";
export type { RecommendedProjectsProps } from "./RecommendedProjects";

export { AdvisorStrategy } from "./AdvisorStrategy";
export type { AdvisorStrategyProps } from "./AdvisorStrategy";

export { RiskPanel } from "./RiskPanel";
export type { RiskPanelProps } from "./RiskPanel";

export { NextAction } from "./NextAction";
export type { NextActionProps } from "./NextAction";

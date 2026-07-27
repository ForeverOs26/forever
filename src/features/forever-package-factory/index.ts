/**
 * Package Factory — public surface.
 *
 * Server/CLI only. Nothing here may enter the browser bundle: the adapters read
 * the filesystem, and the production reader reads a service-role credential.
 */

export * from "./source-set";
export * from "./types";
export * from "./resolve";
export * from "./identity";
export * from "./document-class";
export * from "./precedence";
export * from "./facts";
export * from "./media-selection";
export * from "./package-builder";
export * from "./exceptions";
export * from "./pipeline";
export { BUILT_IN_LAYOUTS, parseWithRegistry, selectLayout } from "./parsers/registry";
export type { LayoutDescriptor, LayoutSelection } from "./parsers/registry";

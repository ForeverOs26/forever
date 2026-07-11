/**
 * Forever Database (RC3.0) — the internal database foundation.
 *
 * This module defines the canonical Forever project domain that every future
 * module (import pipelines, Discovery, Navigator, Marketplace) will build on.
 * RC3.0 is architecture only: canonical models, reusable database descriptors,
 * runtime validation, and a deterministic adapter from the existing
 * `ProjectDetail` view model. It changes no existing behaviour.
 */

export * from "./domain";
export * from "./adapters";

/**
 * Forever Import — adapter registry.
 *
 * A small, deterministic lookup that lets future importers register an
 * {@link ImportAdapter} for a `(format, kind)` pair and resolve it later. This
 * is how a new source format plugs into the foundation without any existing
 * code changing — the open/closed seam of RC3.1.
 */

import type { ImportFormat, ImportSourceKind } from "../types";
import type { ImportAdapter } from "./contract";

function keyOf(format: ImportFormat, kind: ImportSourceKind): string {
  return `${format}:${kind}`;
}

/** In-memory registry of adapters keyed by `(format, kind)`. */
export class ImportAdapterRegistry {
  private readonly adapters = new Map<string, ImportAdapter<unknown>>();

  /**
   * Register an adapter. Re-registering the same `(format, kind)` throws so a
   * clash is caught at wiring time rather than silently shadowing.
   */
  register<T>(adapter: ImportAdapter<T>): this {
    const key = keyOf(adapter.format, adapter.kind);
    if (this.adapters.has(key)) {
      throw new Error(`An import adapter is already registered for ${key}`);
    }
    this.adapters.set(key, adapter as ImportAdapter<unknown>);
    return this;
  }

  /** Resolve the adapter for a `(format, kind)` pair, or `undefined`. */
  resolve(format: ImportFormat, kind: ImportSourceKind): ImportAdapter<unknown> | undefined {
    return this.adapters.get(keyOf(format, kind));
  }

  /** Whether an adapter is registered for a `(format, kind)` pair. */
  has(format: ImportFormat, kind: ImportSourceKind): boolean {
    return this.adapters.has(keyOf(format, kind));
  }

  /** Every registered adapter, in insertion order. */
  list(): ImportAdapter<unknown>[] {
    return [...this.adapters.values()];
  }
}

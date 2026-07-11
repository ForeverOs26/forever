/**
 * Forever Import — source abstraction.
 *
 * A *source* is the unit a future importer plugs into: it knows how to obtain
 * already-extracted input, hands it to an {@link ImportAdapter}, and validates
 * the canonical records the adapter produces. External sources (a developer
 * portal, a CRM export, an uploaded spreadsheet) connect through this one
 * interface.
 *
 * The foundation performs no IO: obtaining the raw input is an abstract
 * `read()` that concrete importers implement. RC3.1 ships the wiring, not the
 * data acquisition.
 */

import { partitionIssues } from "../result";
import type { ImportContext, ImportResult, ImportSource } from "../types";
import type { ImportAdapter, RawImportInput } from "../adapters";
import { validateImport, type ImportBatch, type ReferenceScope } from "../validation";

/** The contract every import source satisfies. */
export interface ImportSourceHandler<T> {
  /** Static description of the source (kind, format, origin label). */
  readonly descriptor: ImportSource;
  /** Obtain records from the source as a fully-reported {@link ImportResult}. */
  load(context: ImportContext): ImportResult<T>;
}

/**
 * Template-method base that wires adapter → validation → result.
 *
 * Concrete sources supply three things: a {@link descriptor}, a {@link read}
 * that returns already-extracted input, and a {@link toBatch} that places the
 * produced records into the right {@link ImportBatch} slot. The base owns the
 * orchestration and the deterministic merging of adapter and validation issues.
 */
export abstract class AbstractImportSource<T> implements ImportSourceHandler<T> {
  abstract readonly descriptor: ImportSource;

  constructor(protected readonly adapter: ImportAdapter<T>) {}

  /**
   * Return already-extracted input for the adapter. Implementations own their
   * IO *outside* the foundation and pass the structured result in here; the
   * base never touches the network or filesystem.
   */
  protected abstract read(context: ImportContext): RawImportInput;

  /** Place produced records into the batch slot for this source's kind. */
  protected abstract toBatch(data: T[]): ImportBatch;

  /** Ids known outside this run; override to resolve cross-entity references. */
  protected referenceScope(_context: ImportContext): ReferenceScope {
    return {};
  }

  load(context: ImportContext): ImportResult<T> {
    const adapted = this.adapter.adapt(this.read(context), context);
    const validation = validateImport(this.toBatch(adapted.data), this.referenceScope(context));

    const { errors, warnings } = partitionIssues([
      ...adapted.errors,
      ...adapted.warnings,
      ...validation.issues,
    ]);
    const ok = errors.length === 0;

    return {
      ok,
      data: adapted.data,
      errors,
      warnings,
      stats: {
        ...adapted.stats,
        imported: ok ? adapted.stats.imported : 0,
        failed: ok ? adapted.stats.failed : Math.max(adapted.stats.failed, adapted.data.length),
        errors: errors.length,
        warnings: warnings.length,
      },
      metadata: adapted.metadata,
    };
  }
}

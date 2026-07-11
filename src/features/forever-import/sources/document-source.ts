/**
 * Forever Import — document source.
 *
 * Produces canonical {@link ForeverDocument} records. Documents reference a
 * project, so concrete importers typically override `referenceScope` to supply
 * the owning project ids.
 */

import type { ForeverDocument } from "@/features/forever-database";

import type { ImportBatch } from "../validation";
import { AbstractImportSource } from "./handler";

/** Base for every source whose output is documents. */
export abstract class DocumentImportSource extends AbstractImportSource<ForeverDocument> {
  protected toBatch(data: ForeverDocument[]): ImportBatch {
    return { documents: data };
  }
}

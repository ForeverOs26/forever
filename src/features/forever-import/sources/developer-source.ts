/**
 * Forever Import — developer source.
 *
 * Produces canonical {@link ForeverDeveloper} records.
 */

import type { ForeverDeveloper } from "@/features/forever-database";

import type { ImportBatch } from "../validation";
import { AbstractImportSource } from "./handler";

/** Base for every source whose output is developers. */
export abstract class DeveloperImportSource extends AbstractImportSource<ForeverDeveloper> {
  protected toBatch(data: ForeverDeveloper[]): ImportBatch {
    return { developers: data };
  }
}

/**
 * Forever Import — project source.
 *
 * Produces canonical {@link ForeverProject} records. Concrete importers extend
 * this to supply a descriptor, a `read()`, and (optionally) a reference scope
 * that resolves developer/location foreign keys.
 */

import type { ForeverProject } from "@/features/forever-database";

import type { ImportBatch } from "../validation";
import { AbstractImportSource } from "./handler";

/** Base for every source whose output is projects. */
export abstract class ProjectImportSource extends AbstractImportSource<ForeverProject> {
  protected toBatch(data: ForeverProject[]): ImportBatch {
    return { projects: data };
  }
}

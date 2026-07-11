/**
 * Forever Import — media source.
 *
 * Produces canonical {@link ForeverMedia} records. Media reference a project,
 * so concrete importers typically override `referenceScope` to supply the
 * owning project ids.
 */

import type { ForeverMedia } from "@/features/forever-database";

import type { ImportBatch } from "../validation";
import { AbstractImportSource } from "./handler";

/** Base for every source whose output is media. */
export abstract class MediaImportSource extends AbstractImportSource<ForeverMedia> {
  protected toBatch(data: ForeverMedia[]): ImportBatch {
    return { media: data };
  }
}

/**
 * Forever Source Registry — source identity.
 *
 * A {@link SourceIdentity} is the stable, human- and machine-addressable name of
 * a source: its id, its URL-safe slug, a display name, and its {@link SourceType}
 * and {@link SourceCategory} classification. It reuses the RC3.0 `Slug` and id
 * types so a source is addressed the same way every other canonical Forever
 * entity is.
 *
 * Identity carries no behaviour and no connection detail — those live on the
 * {@link import("./definition").SourceDefinition} and, ultimately, outside RC3.3.
 */

import type { Slug } from "@/features/forever-database";

import type { SourceCategory, SourceType } from "./enums";
import type { SourceId } from "./types";

/** The stable identity of a registered source. */
export interface SourceIdentity {
  /** Stable surrogate id, e.g. `src_developer_website`. */
  id: SourceId;
  /** URL- and file-safe identifier, e.g. `developer-website`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Developer Website`. */
  name: string;
  type: SourceType;
  category: SourceCategory;
}

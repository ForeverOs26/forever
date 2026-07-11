/**
 * Forever Connectors — connector identity.
 *
 * A {@link ConnectorIdentity} is the stable, human- and machine-addressable name
 * of a connector: its id, its URL-safe slug, a display name, the transport
 * `protocol` it speaks, and the `targetSystem` it binds Forever to. It reuses
 * the RC3.0 `Slug` and id types so a connector is addressed the same way every
 * other canonical Forever entity is, and it reuses the Forever Sync (RC3.2)
 * {@link SyncProtocol} and {@link SyncSystem} vocabularies rather than inventing
 * parallel transport or system enums.
 *
 * Identity carries no connection detail and no credential — those live on the
 * {@link import("./configuration").ConnectorConfiguration} (as a schema, never a
 * value) and, ultimately, outside RC3.4.
 */

import type { Slug } from "@/features/forever-database";
import type { SyncProtocol, SyncSystem } from "@/features/forever-sync";

import type { ConnectorId } from "./types";

/** The stable identity of a connector. */
export interface ConnectorIdentity {
  /** Stable surrogate id, e.g. `conn_website_projects`. */
  id: ConnectorId;
  /** URL- and file-safe identifier, e.g. `website-projects`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Website Projects`. */
  name: string;
  /** The transport this connector speaks. Reuses the RC3.2 protocol vocabulary. */
  protocol: SyncProtocol;
  /** The system this connector binds Forever to. Reuses the RC3.2 systems. */
  targetSystem: SyncSystem;
}

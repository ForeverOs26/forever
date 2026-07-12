/**
 * Coralina connector definition (RC3.4).
 *
 * One {@link ConnectorDefinition} describing how Coralina's verified developer
 * file package is carried into the Forever Database. It is declarative only: the
 * `configuration` is a schema of the settings a future runtime would need (a
 * package path), never an actual value, and the connector opens no file, sends
 * no request, and holds no credential.
 *
 * It bridges to RC3.3 through `sourceId`, binding to the verified Coralina price
 * list — the primary structured source it would carry.
 */

import {
  connectorCapability,
  connectorConfigField,
  defineConnector,
  connectorVersion,
  type ConnectorDefinition,
} from "@/features/forever-connectors";

import { CORALINA_CONNECTOR_ID, CORALINA_PRICE_LIST_SOURCE_ID } from "../identity";

/** The Coralina developer-package connector. */
export const CORALINA_CONNECTOR_DEFINITION: ConnectorDefinition = defineConnector({
  identity: {
    id: CORALINA_CONNECTOR_ID,
    slug: "coralina-developer-package",
    name: "Coralina Developer Package",
    protocol: "file",
    targetSystem: "forever_database",
  },
  version: connectorVersion(0, 1, 0),
  capabilities: [
    connectorCapability("connect"),
    connectorCapability("read"),
    connectorCapability("list"),
    connectorCapability("batch"),
    connectorCapability("write", false),
  ],
  configuration: {
    fields: [
      connectorConfigField("package_path", "string", {
        required: true,
        label: "Package path",
        description: "Repo-relative path to the Coralina source package. A schema field only.",
      }),
    ],
  },
  supportedEntities: ["project", "document", "media"],
  directions: ["pull"],
  sourceId: CORALINA_PRICE_LIST_SOURCE_ID,
  metadata: {
    description: "Carries the verified Coralina developer file package into Forever.",
    owner: "Forever intake",
    region: "Phuket",
    tags: ["coralina", "developer-package"],
  },
});

import {
  MockConnector,
  SyntheticAwsConnector,
  SyntheticEntraConnector,
  SyntheticSharePointConnector
} from "@access-kit/connectors-mock";
import { createMicrosoftGraphEntraReadOnlyConnectorFromEnv } from "@access-kit/connectors-microsoft-graph";
import type { ConnectorAdapter } from "@access-kit/core";

export interface RuntimeConnectorOptions {
  env?: NodeJS.ProcessEnv;
}

export function createRuntimeConnectors(options: RuntimeConnectorOptions = {}): Map<string, ConnectorAdapter> {
  const connectors: ConnectorAdapter[] = [
    new MockConnector(),
    new SyntheticEntraConnector(),
    new SyntheticSharePointConnector(),
    new SyntheticAwsConnector()
  ];
  const microsoftGraphConnector = createMicrosoftGraphEntraReadOnlyConnectorFromEnv(options.env ?? process.env);

  if (microsoftGraphConnector) {
    connectors.push(microsoftGraphConnector);
  }

  return new Map<string, ConnectorAdapter>(connectors.map((connector) => [connector.id, connector]));
}

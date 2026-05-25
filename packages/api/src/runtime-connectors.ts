import {
  MockConnector,
  SyntheticAwsConnector,
  SyntheticEntraConnector,
  SyntheticSharePointConnector
} from "@access-kit/connectors-mock";
import type { ConnectorAdapter } from "@access-kit/core";

export function createRuntimeConnectors(): Map<string, ConnectorAdapter> {
  const connectors: ConnectorAdapter[] = [
    new MockConnector(),
    new SyntheticEntraConnector(),
    new SyntheticSharePointConnector(),
    new SyntheticAwsConnector()
  ];

  return new Map<string, ConnectorAdapter>(connectors.map((connector) => [connector.id, connector]));
}

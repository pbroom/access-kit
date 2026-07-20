import { AsyncLocalStorage } from "node:async_hooks";

const requestAuditActorStorage = new AsyncLocalStorage<string>();

export function getRequestAuditActor(): string | undefined {
  return requestAuditActorStorage.getStore();
}

export async function withRequestAuditActor<T>(actor: string, fn: () => Promise<T>): Promise<T> {
  return requestAuditActorStorage.run(actor, fn);
}

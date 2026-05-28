import type { DiscoveryRunWarning } from "@access-kit/core";

import { retryAfterSecondsToMilliseconds, type MicrosoftGraphCollectionPage, type MicrosoftGraphCollectionRead, type MicrosoftGraphReadClient } from "./client.js";
import { DELTA_CURSOR_HASH_LENGTH } from "./constants.js";
import type { GraphDeltaCapableRecord, MicrosoftGraphDeltaState } from "./provider-models.js";
import { applyGraphDeltaChanges, isGraphTombstone, redactValue } from "./provider-utils.js";

export interface MicrosoftGraphCollectionReaderOptions {
  client: MicrosoftGraphReadClient;
  maxPages: number;
  maxRetries: number;
  now: () => string;
  sleep: (milliseconds: number) => Promise<void>;
  pushWarning: (warning: DiscoveryRunWarning) => void;
}

export class MicrosoftGraphCollectionReader {
  readonly #client: MicrosoftGraphReadClient;
  readonly #maxPages: number;
  readonly #maxRetries: number;
  readonly #now: () => string;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #pushWarning: (warning: DiscoveryRunWarning) => void;
  readonly #deltaStates = new Map<string, MicrosoftGraphDeltaState>();
  readonly #collectionCaches = new Map<string, GraphDeltaCapableRecord[]>();

  constructor(options: MicrosoftGraphCollectionReaderOptions) {
    this.#client = options.client;
    this.#maxPages = options.maxPages;
    this.#maxRetries = options.maxRetries;
    this.#now = options.now;
    this.#sleep = options.sleep;
    this.#pushWarning = options.pushWarning;
  }

  async readCollection<T extends GraphDeltaCapableRecord>(
    path: string,
    label: DiscoveryRunWarning["scope"]
  ): Promise<T[]> {
    return (await this.readCollectionResult<T>(path, label)).values;
  }

  async readCollectionResult<T extends GraphDeltaCapableRecord>(
    path: string,
    label: DiscoveryRunWarning["scope"]
  ): Promise<MicrosoftGraphCollectionRead<T>> {
    const deltaState = this.#deltaStates.get(path);
    const cachedValues = this.#collectionCaches.get(path) as T[] | undefined;
    if (deltaState && cachedValues) {
      const incremental = await this.#readCollectionPages(path, deltaState.token, label, cachedValues);
      if (incremental) {
        return incremental;
      }

      this.#deltaStates.delete(path);
      this.#pushWarning({
        code: "GRAPH_INCREMENTAL_SYNC_FULL_RESYNC",
        message: "Microsoft Graph incremental sync state was ambiguous; Access Kit discarded the delta token and recovered with a full read-only resync.",
        severity: "warning",
        scope: label,
        retryable: true
      });
    }

    return await this.#readCollectionPages(path, path, label) ?? { values: [], completed: false };
  }

  async #readCollectionPages<T extends GraphDeltaCapableRecord>(
    cacheKey: string,
    startPath: string,
    label: DiscoveryRunWarning["scope"],
    cachedValues?: T[]
  ): Promise<MicrosoftGraphCollectionRead<T> | undefined> {
    const values: T[] = [];
    let nextPath: string | undefined = startPath;
    let pageCount = 0;
    let retryCount = 0;
    let completed = true;
    let deltaLink: string | undefined;
    const incremental = Boolean(cachedValues);

    while (nextPath) {
      if (pageCount >= this.#maxPages) {
        completed = false;
        this.#pushWarning({
          code: "GRAPH_PAGE_LIMIT_REACHED",
          message: `Microsoft Graph ${label} pagination reached the configured page limit; remaining pages were skipped.`,
          severity: "warning",
          scope: label,
          retryable: true
        });
        return incremental ? undefined : this.#cacheCollection(cacheKey, values, completed);
      }

      const page: MicrosoftGraphCollectionPage<T> = await this.#client.list<T>(nextPath, { headers: { ConsistencyLevel: "eventual" } });
      const status = page.status ?? 200;

      if (incremental && status === 410) {
        this.#pushWarning({
          code: "GRAPH_DELTA_TOKEN_STALE",
          message: "Microsoft Graph rejected a stored delta token; the token was discarded without retaining raw cursor material.",
          severity: "warning",
          scope: label,
          retryable: true
        });
        return undefined;
      }

      if (status === 429) {
        retryCount += 1;
        this.#pushWarning({
          code: "GRAPH_THROTTLE_RETRIED",
          message: "Microsoft Graph throttled readback; retry metadata was captured without retaining raw request identifiers.",
          severity: retryCount > this.#maxRetries ? "warning" : "info",
          scope: label,
          retryable: retryCount <= this.#maxRetries
        });

        if (retryCount <= this.#maxRetries) {
          const retryAfterMilliseconds = retryAfterSecondsToMilliseconds(page.retryAfterSeconds);
          if (retryAfterMilliseconds > 0) {
            await this.#sleep(retryAfterMilliseconds);
          }
          continue;
        }

        completed = false;
        return incremental ? undefined : this.#cacheCollection(cacheKey, values, completed);
      }

      if (status >= 400) {
        completed = false;
        this.#pushWarning({
          code: "GRAPH_COLLECTION_SKIPPED",
          message: `Microsoft Graph ${label} readback returned HTTP ${status}; unsupported provider behavior was skipped instead of becoming canonical facts.`,
          severity: "warning",
          scope: label,
          retryable: status >= 500
        });
        return incremental ? undefined : this.#cacheCollection(cacheKey, values, completed);
      }

      retryCount = 0;
      pageCount += 1;
      deltaLink = page.deltaLink ?? deltaLink;
      for (const item of page.value) {
        if (isGraphTombstone(item)) {
          this.#pushWarning({
            code: "GRAPH_DELTA_TOMBSTONE_OBSERVED",
            message: "Microsoft Graph returned a delta tombstone; Access Kit marked the redacted object deleted instead of dropping deletion evidence.",
            severity: "warning",
            scope: label,
            retryable: false
          });
        }
      }
      values.push(...page.value);

      if (page.nextLink) {
        this.#pushWarning({
          code: "GRAPH_PAGINATION_OBSERVED",
          message: `Microsoft Graph ${label} readback used paginated responses; raw nextLink values were redacted from evidence.`,
          severity: "info",
          scope: label,
          retryable: false
        });
      }

      nextPath = page.nextLink;
    }

    if (deltaLink) {
      this.#deltaStates.set(cacheKey, {
        token: deltaLink,
        capturedAt: this.#now(),
        scope: label
      });
      this.#pushWarning({
        code: incremental ? "GRAPH_DELTA_SYNC_APPLIED" : "GRAPH_DELTA_TOKEN_CAPTURED",
        message: incremental
          ? "Microsoft Graph incremental sync applied a redacted delta cursor and retained tenant-scoped state."
          : "Microsoft Graph returned a delta cursor; Access Kit stored only redacted cursor evidence for future incremental reads.",
        severity: "info",
        scope: label,
        retryable: false
      });
    } else if (incremental) {
      this.#pushWarning({
        code: "GRAPH_DELTA_TOKEN_MISSING",
        message: "Microsoft Graph incremental response did not include a replacement delta token; Access Kit discarded the ambiguous incremental state.",
        severity: "warning",
        scope: label,
        retryable: true
      });
      return undefined;
    }

    const mergedValues = cachedValues ? applyGraphDeltaChanges(cachedValues, values) : values;
    return this.#cacheCollection(cacheKey, mergedValues, completed);
  }

  #cacheCollection<T extends GraphDeltaCapableRecord>(
    cacheKey: string,
    values: T[],
    completed: boolean
  ): MicrosoftGraphCollectionRead<T> {
    this.#collectionCaches.set(cacheKey, values);
    return { values, completed };
  }

  async readRecord<T>(
    path: string,
    label: DiscoveryRunWarning["scope"],
    skipped: Pick<DiscoveryRunWarning, "code" | "message">
  ): Promise<T | undefined> {
    let retryCount = 0;

    while (true) {
      const record = await this.#client.get<T>(path);
      const status = record.status ?? 200;

      if (status === 429) {
        retryCount += 1;
        this.#pushWarning({
          code: "GRAPH_THROTTLE_RETRIED",
          message: "Microsoft Graph throttled readback; retry metadata was captured without retaining raw request identifiers.",
          severity: retryCount > this.#maxRetries ? "warning" : "info",
          scope: label,
          retryable: retryCount <= this.#maxRetries
        });

        if (retryCount <= this.#maxRetries) {
          const retryAfterMilliseconds = retryAfterSecondsToMilliseconds(record.retryAfterSeconds);
          if (retryAfterMilliseconds > 0) {
            await this.#sleep(retryAfterMilliseconds);
          }
          continue;
        }

        return undefined;
      }

      if (status >= 400) {
        this.#pushWarning({
          code: skipped.code,
          message: skipped.message,
          severity: "warning",
          scope: label,
          retryable: status >= 500
        });
        return undefined;
      }

      return record.value;
    }
  }

  buildDeltaCursor(): string | undefined {
    if (this.#deltaStates.size === 0) {
      return undefined;
    }

    const cursorMaterial = [...this.#deltaStates.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, state]) => `${path}:${state.token}:${state.capturedAt}:${state.scope}`)
      .join("|");
    return `cursor:microsoft-graph:delta:${redactValue(cursorMaterial, DELTA_CURSOR_HASH_LENGTH)}`;
  }
}

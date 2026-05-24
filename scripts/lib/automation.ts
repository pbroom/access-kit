import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const backlogStatuses = ["ready", "in_progress", "in_review", "blocked", "merged"] as const;
export const backlogParallelValues = ["yes", "no"] as const;

export type BacklogStatus = (typeof backlogStatuses)[number];
export type BacklogParallelValue = (typeof backlogParallelValues)[number];

export interface BacklogItem {
  id: string;
  slice: string;
  status: BacklogStatus;
  priority: string;
  dependsOn: string[];
  parallel: boolean;
  area: string;
  branch: string;
  pr: string;
  acceptance: string;
  security: string;
  nextAction: string;
}

export const backlogHeaders = [
  "ID",
  "Slice",
  "Status",
  "Priority",
  "Depends On",
  "Parallel",
  "Area",
  "Branch",
  "PR",
  "Acceptance Checks",
  "Security Notes",
  "Next Action"
] as const;

export async function readBacklog(
  backlogPath = join(process.cwd(), "docs", "implementation-backlog.md")
): Promise<BacklogItem[]> {
  return parseBacklog(await readFile(backlogPath, "utf8"));
}

export function parseBacklog(markdown: string): BacklogItem[] {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => normalizeTableRow(line).join("|") === backlogHeaders.join("|"));

  if (headerIndex === -1) {
    throw new Error(`Backlog table must include columns: ${backlogHeaders.join(", ")}`);
  }

  const separator = lines[headerIndex + 1];
  if (!separator || !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator.trim())) {
    throw new Error("Backlog table header must be followed by a Markdown separator row.");
  }

  const rows: BacklogItem[] = [];

  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) {
      break;
    }

    const cells = normalizeTableRow(line);
    if (cells.length !== backlogHeaders.length) {
      throw new Error(`Backlog row has ${cells.length} cells, expected ${backlogHeaders.length}: ${line}`);
    }

    rows.push({
      id: cells[0],
      slice: cells[1],
      status: parseBacklogStatus(cells[2]),
      priority: parsePriority(cells[3]),
      dependsOn: parseDependsOn(cells[4]),
      parallel: parseParallel(cells[5]),
      area: cells[6],
      branch: cells[7],
      pr: cells[8],
      acceptance: cells[9],
      security: cells[10],
      nextAction: cells[11]
    });
  }

  validateBacklogItems(rows);
  return rows;
}

export function validateBacklogItems(items: BacklogItem[]): void {
  if (items.length === 0) {
    throw new Error("Backlog must contain at least one slice.");
  }

  const ids = new Set<string>();

  for (const item of items) {
    if (!/^AK-\d{3}$/.test(item.id)) {
      throw new Error(`Backlog item ${item.id} must use AK-000 style identifiers.`);
    }

    if (ids.has(item.id)) {
      throw new Error(`Backlog item ${item.id} is duplicated.`);
    }

    ids.add(item.id);

    if (!/^P[0-3]$/.test(item.priority)) {
      throw new Error(`Backlog item ${item.id} priority must use P0 through P3.`);
    }

    if (!/^[a-z0-9-]+$/.test(item.area)) {
      throw new Error(`Backlog item ${item.id} area must be a lowercase slug.`);
    }

    for (const [field, value] of Object.entries(item)) {
      if (Array.isArray(value)) {
        continue;
      }

      if (typeof value === "boolean") {
        continue;
      }

      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Backlog item ${item.id} has an empty ${field} field.`);
      }
    }
  }

  for (const item of items) {
    const duplicateDeps = new Set<string>();

    for (const dependency of item.dependsOn) {
      if (!ids.has(dependency)) {
        throw new Error(`Backlog item ${item.id} depends on unknown item ${dependency}.`);
      }

      if (dependency === item.id) {
        throw new Error(`Backlog item ${item.id} cannot depend on itself.`);
      }

      if (duplicateDeps.has(dependency)) {
        throw new Error(`Backlog item ${item.id} repeats dependency ${dependency}.`);
      }

      duplicateDeps.add(dependency);
    }
  }
}

export function findNextReadySlice(items: BacklogItem[]): BacklogItem | undefined {
  return selectReadyBacklogBatch(items, { maxItems: 1 })[0];
}

export interface BacklogBatchOptions {
  maxItems?: number;
}

export function selectReadyBacklogBatch(
  items: BacklogItem[],
  options: BacklogBatchOptions = {}
): BacklogItem[] {
  const maxItems = options.maxItems ?? 3;
  const statusById = new Map(items.map((item) => [item.id, item.status]));
  const eligible = items
    .filter((item) => item.status === "ready")
    .filter((item) => item.dependsOn.every((dependency) => statusById.get(dependency) === "merged"))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));

  const first = eligible[0];

  if (!first) {
    return [];
  }

  if (!first.parallel) {
    return [first];
  }

  const selected: BacklogItem[] = [];
  const selectedAreas = new Set<string>();

  for (const item of eligible) {
    if (selected.length >= maxItems) {
      break;
    }

    if (!item.parallel || selectedAreas.has(item.area)) {
      continue;
    }

    selected.push(item);
    selectedAreas.add(item.area);
  }

  return selected;
}

function normalizeTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");

  return withoutOuterPipes.split("|").map((cell) => cell.trim());
}

function parseBacklogStatus(value: string): BacklogStatus {
  if (backlogStatuses.includes(value as BacklogStatus)) {
    return value as BacklogStatus;
  }

  throw new Error(
    `Unsupported backlog status ${value}. Allowed statuses: ${backlogStatuses.join(", ")}`
  );
}

function parsePriority(value: string): string {
  const normalized = value.toUpperCase();

  if (/^P[0-3]$/.test(normalized)) {
    return normalized;
  }

  throw new Error(`Unsupported backlog priority ${value}. Allowed priorities: P0, P1, P2, P3.`);
}

function parseDependsOn(value: string): string[] {
  if (value === "-") {
    return [];
  }

  return value
    .split(",")
    .map((dependency) => dependency.trim())
    .filter(Boolean);
}

function parseParallel(value: string): boolean {
  const normalized = value.toLowerCase();

  if (normalized === "yes") {
    return true;
  }

  if (normalized === "no") {
    return false;
  }

  throw new Error(
    `Unsupported backlog parallel value ${value}. Allowed values: ${backlogParallelValues.join(", ")}`
  );
}

function priorityRank(priority: string): number {
  return Number(priority.slice(1));
}

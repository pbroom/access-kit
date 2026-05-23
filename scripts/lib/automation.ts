import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const backlogStatuses = ["ready", "in_progress", "in_review", "blocked", "merged"] as const;

export type BacklogStatus = (typeof backlogStatuses)[number];

export interface BacklogItem {
  id: string;
  slice: string;
  status: BacklogStatus;
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
      branch: cells[3],
      pr: cells[4],
      acceptance: cells[5],
      security: cells[6],
      nextAction: cells[7]
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

    for (const [field, value] of Object.entries(item)) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Backlog item ${item.id} has an empty ${field} field.`);
      }
    }
  }
}

export function findNextReadySlice(items: BacklogItem[]): BacklogItem | undefined {
  return items.find((item) => item.status === "ready");
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

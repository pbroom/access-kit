import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, normalize, relative } from "node:path";

const root = process.cwd();
const markdownRoots = ["README.md", "docs", "runbooks", "examples"];
const markdownLinkPattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const externalTargetPattern = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const headingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

const markdownFiles = (await Promise.all(markdownRoots.map(listMarkdownFiles))).flat().sort();
const failures: string[] = [];
let checkedLinks = 0;

console.log(`Markdown roots: ${markdownRoots.map((path) => relative(root, join(root, path))).join(", ")}`);

for (const markdownFile of markdownFiles) {
  const content = await readFile(markdownFile, "utf8");

  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawTarget = normalizeLinkTarget(match[1]);

    if (!rawTarget || externalTargetPattern.test(rawTarget)) {
      continue;
    }

    checkedLinks += 1;
    const [pathPart, anchorPart] = splitAnchor(rawTarget);
    const targetFile = pathPart ? normalize(join(dirname(markdownFile), decodeURIComponent(pathPart))) : markdownFile;

    if (!(await exists(targetFile))) {
      failures.push(`${markdownFile}: missing link target ${rawTarget} -> ${targetFile}`);
      continue;
    }

    if (anchorPart && extname(targetFile) === ".md") {
      const anchor = slugifyHeading(decodeURIComponent(anchorPart));
      const anchors = await readMarkdownAnchors(targetFile);

      if (!anchors.has(anchor)) {
        failures.push(`${markdownFile}: missing anchor #${anchorPart} in ${targetFile}`);
      }
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Markdown link validation failed:\n${failures.join("\n")}`);
}

console.log(`Validated ${checkedLinks} relative Markdown links across ${markdownFiles.length} files.`);

async function listMarkdownFiles(path: string): Promise<string[]> {
  const absolutePath = join(root, path);

  if (!(await exists(absolutePath))) {
    return [];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => []);

  if (entries.length === 0 && path.endsWith(".md")) {
    return [path];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const childPath = join(path, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(childPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(childPath);
    }
  }

  return files;
}

async function exists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}

function normalizeLinkTarget(target: string): string {
  const trimmed = target.trim();
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
  return unwrapped.split(/\s+/)[0] ?? "";
}

function splitAnchor(target: string): [string, string | undefined] {
  const hashIndex = target.indexOf("#");

  if (hashIndex === -1) {
    return [target, undefined];
  }

  return [target.slice(0, hashIndex), target.slice(hashIndex + 1)];
}

async function readMarkdownAnchors(path: string): Promise<Set<string>> {
  const content = await readFile(path, "utf8");
  const slugs = new Set<string>();
  const slugCounts = new Map<string, number>();

  for (const match of content.matchAll(headingPattern)) {
    const baseSlug = slugifyHeading(match[2] ?? "");
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    slugs.add(count === 0 ? baseSlug : `${baseSlug}-${count}`);
  }

  return slugs;
}

function slugifyHeading(heading: string): string {
  return stripHtmlTags(heading)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function stripHtmlTags(value: string): string {
  let stripped = "";
  let insideTag = false;

  for (const character of value) {
    if (character === "<") {
      insideTag = true;
      continue;
    }

    if (character === ">") {
      insideTag = false;
      continue;
    }

    if (!insideTag) {
      stripped += character;
    }
  }

  return stripped;
}

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const DEFAULT_RETAINED_EVIDENCE_ROOTS = ["deploy", "docs", "reports", "runbooks"] as const;

export async function requireRetainedRepositoryPath(
  path: string,
  options: {
    root: string;
    label: string;
    allowedRoots?: readonly string[];
  }
): Promise<string> {
  if (isAbsolute(path)) {
    throw new Error(`${options.label} must be repository-relative: ${path}`);
  }

  const root = await realpath(options.root);
  const absolutePath = resolve(root, path);
  const relativePath = relative(root, absolutePath);

  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${options.label} must stay inside the repository: ${path}`);
  }

  const allowedRoots = options.allowedRoots ?? DEFAULT_RETAINED_EVIDENCE_ROOTS;
  if (!allowedRoots.some((allowedRoot) => relativePath === allowedRoot || relativePath.startsWith(`${allowedRoot}${sep}`))) {
    throw new Error(`${options.label} must reference retained evidence under ${allowedRoots.join(", ")}: ${path}`);
  }

  try {
    const target = await realpath(absolutePath);
    const targetRelativePath = relative(root, target);
    if (targetRelativePath === "" || targetRelativePath.startsWith("..") || isAbsolute(targetRelativePath)) {
      throw new Error(`${options.label} must not resolve outside the repository: ${path}`);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("must not resolve outside")) {
      throw cause;
    }
    throw new Error(`${options.label} references missing retained evidence path ${path}.`, { cause });
  }

  return absolutePath;
}

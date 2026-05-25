const FULL_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;

export function isRequiredActionUse(usedAction: string, action: string): boolean {
  return usedAction === action || usedAction.startsWith(`${action}@`);
}

export function isPinnedRequiredActionUse(usedAction: string, action: string): boolean {
  if (!usedAction.startsWith(`${action}@`)) {
    return false;
  }

  const ref = usedAction.slice(action.length + 1);
  return FULL_SHA_PATTERN.test(ref);
}

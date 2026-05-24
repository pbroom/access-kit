const CHANGE_TICKET_PATTERN_MAX_LENGTH = 128;
const CHANGE_TICKET_VALUE_MAX_LENGTH = 256;

export function isSafeChangeTicketPattern(pattern: string): boolean {
  if (pattern.length > CHANGE_TICKET_PATTERN_MAX_LENGTH || /[()|]/.test(pattern) || /\\[1-9]/.test(pattern)) {
    return false;
  }

  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function changeTicketMatches(pattern: string, value: string): boolean {
  if (!isSafeChangeTicketPattern(pattern) || value.length > CHANGE_TICKET_VALUE_MAX_LENGTH) {
    return false;
  }

  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

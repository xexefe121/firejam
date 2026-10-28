import type { ReportReason } from '../../../shared/protocol';

// Words the app shows for community safety: reporting, blocking, rules and the trademark notice.

export const SUPPORT_EMAIL = 'unityweb9@gmail.com';

export const BAN_TEXT = `This profile has been suspended for breaking FireJam's community rules. Questions: ${SUPPORT_EMAIL}`;

export const BE_KIND = 'Be kind — FireJam filters offensive words, and you can report or block anyone.';

export const COMMUNITY_RULES =
  'Be kind. FireJam hides offensive words in names and chat. Report or block anyone who bothers you; reported profiles are reviewed and can be suspended.';

export const TRADEMARK_NOTICE =
  'Prime Video, Fire TV and Alexa are trademarks of Amazon.com, Inc. or its affiliates. FireJam was not created or endorsed by Amazon.';

export const REPORT_REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'offensive-name', label: 'Offensive name' },
  { reason: 'abusive-messages', label: 'Abusive messages' },
  { reason: 'spam', label: 'Spam' },
  { reason: 'other', label: 'Something else' },
];

export const REPORT_THANKS = "Thanks — we'll review it. You won't see them any more.";

/** Server ack errors that need words people can read. Anything else is shown as the server sent it. */
const ERROR_TEXT: Record<string, string> = {
  name_not_allowed: 'Please choose a different name.',
  removed: 'The host removed you from this jam.',
  banned: BAN_TEXT,
};

export function errorText(e: unknown): string {
  const code = e instanceof Error ? e.message : String(e);
  return ERROR_TEXT[code] ?? code;
}

export const errorCode = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// The server hides people I blocked, so it can't tell me their names any more. This device remembers
// the names of the people it blocked, to label the Blocked list in the profile.

const NAMES_KEY = 'firejam.blockedNames';

function savedNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function rememberBlockedName(id: string, name: string) {
  try {
    const all = savedNames();
    if (all[id] === name) return;
    all[id] = name;
    localStorage.setItem(NAMES_KEY, JSON.stringify(all));
  } catch {
    /* private mode: the list falls back to "Blocked person" */
  }
}

export const blockedName = (id: string): string | undefined => savedNames()[id];

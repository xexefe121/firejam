import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportMsg, ReportReason } from '../../shared/protocol.ts';

const WORDS = [
  'fuck', 'fucker', 'fucking', 'fucked', 'motherfucker', 'motherfucking', 'shit', 'shitty', 'bullshit',
  'bitch', 'bitches', 'bastard', 'asshole', 'arsehole', 'cunt', 'cock', 'cocksucker', 'dick', 'dickhead',
  'pussy', 'wanker', 'twat', 'slut', 'whore', 'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots',
  'fag', 'retard', 'retarded', 'kike', 'chink', 'spic', 'tranny', 'paki', 'coon',
  'damn', 'piss', 'prick', 'douche', 'douchebag', 'shithead', 'fuckface', 'gook', 'wetback',
];
const LEET: Record<string, string> = {
  a: '[a4@]', b: '[b8]', c: '[c(]', e: '[e3]', g: '[g69]', i: '[i1!|]', l: '[l1|]',
  o: '[o0]', s: '[s5$]', t: '[t7+]', z: '[z2]',
};
const WORD_PATTERN = WORDS.sort((a, b) => b.length - a.length)
  .map((word) => [...word].map((c) => `${LEET[c] ?? c}+`).join('[\\s\\p{P}\\p{S}\\p{Cf}]*')).join('|');
const words = () => new RegExp(`(?<![\\p{L}\\p{N}])(?:${WORD_PATTERN})(?![\\p{L}\\p{N}])`, 'giu');

// Whole words only, as in chat: plenty of real names (Akshita, Dikshit, Hancock) contain a listed word.
export function nameAllowed(name: string): boolean {
  // Split camelCase first so "CaptainFucker" is still caught.
  return !words().test(name.normalize('NFKC').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'));
}

export function maskChat(text: string): string {
  return text.normalize('NFKC').replace(words(), (word) => {
    let first = true;
    return word.replace(/[\p{L}\p{N}@!$|+]/gu, (c) => {
      if (first) { first = false; return c; }
      return '\u2022';
    });
  });
}

export const REPORT_REASONS: ReportReason[] = ['offensive-name', 'abusive-messages', 'spam', 'other'];

export interface Report {
  id: string;
  at: number;
  reporter: string;
  target: string;
  reason: ReportReason;
  jamId: string | null;
  messageId: string | null;
  text: string | null;
  targetName: string;
  dismissedAt: number | null;
}

interface Ban {
  userId: string;
  at: number;
  suspended: boolean;
  devices: string[];
}

// Reports and enforcement survive restarts, beside the profile database.
export class Moderation {
  private file = path.join(process.env.FIREJAM_DATA_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data'), 'reports.json');
  reports: Report[] = [];
  bans: Ban[] = [];

  constructor() {
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { reports: Report[]; bans: Ban[] };
      this.reports = saved.reports;
      this.bans = saved.bans;
    }
  }

  isBanned(userId: string): boolean {
    return this.bans.some((b) => b.userId === userId);
  }

  deviceBanned(deviceId: string): boolean {
    return !!deviceId && this.bans.some((b) => b.devices.includes(deviceId));
  }

  report(reporter: string, msg: ReportMsg, targetName: string, text: string | null): boolean {
    const at = Date.now();
    this.reports.push({
      id: randomBytes(9).toString('base64url'), at, reporter, target: msg.target, reason: msg.reason,
      jamId: msg.jamId ?? null, messageId: msg.messageId ?? null, text, targetName, dismissedAt: null,
    });
    this.save();
    return new Set(this.reports.filter((r) => r.target === msg.target && !r.dismissedAt && at - r.at <= 7 * 86400_000).map((r) => r.reporter)).size >= 3;
  }

  ban(userId: string, devices: Set<string>, suspended = false) {
    const old = this.bans.find((b) => b.userId === userId);
    this.bans = this.bans.filter((b) => b.userId !== userId);
    this.bans.push({ userId, at: Date.now(), suspended: old?.suspended === false ? false : suspended, devices: [...devices] });
    this.save();
  }

  unban(userId: string) {
    this.bans = this.bans.filter((b) => b.userId !== userId);
    this.save();
  }

  dismiss(reportId: string): boolean {
    const report = this.reports.find((r) => r.id === reportId);
    if (!report) return false;
    report.dismissedAt = Date.now();
    this.save();
    return true;
  }

  review() {
    const counts: Record<string, { total: number; active: number; reporters: number }> = {};
    for (const r of this.reports) {
      const count = counts[r.target] ??= { total: 0, active: 0, reporters: 0 };
      count.total++;
      if (!r.dismissedAt) count.active++;
    }
    for (const target of Object.keys(counts)) {
      counts[target].reporters = new Set(this.reports.filter((r) => r.target === target && !r.dismissedAt && Date.now() - r.at <= 7 * 86400_000).map((r) => r.reporter)).size;
    }
    return { reports: [...this.reports].reverse(), counts, bans: this.bans };
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ reports: this.reports, bans: this.bans }, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }
}

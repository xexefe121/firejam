import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { HistoryEntry, Media, Place } from '../../shared/protocol.ts';

// "Pick for us": Amazon Bedrock chooses what a jam watches next, from what
// everyone can watch, what they watched lately and what time it is for each of
// them ("it's 11:40 pm in Hyderabad, something short"). Falls back to a simple rule
// when Bedrock isn't reachable, so the button always answers.

/** Amazon Nova Lite through the APAC cross-region inference profile (works from ap-southeast-2). */
const MODEL = process.env.FIREJAM_PICK_MODEL ?? 'apac.amazon.nova-lite-v1:0';
const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'ap-southeast-2' });

export interface PickPerson {
  name: string;
  place: Place;
  recent: HistoryEntry[];
}

export interface Pick {
  mediaId: string;
  reason: string;
  by: 'bedrock' | 'fallback';
}

const hourIn = (tz: string) => Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
const isLate = (tz: string) => {
  const h = hourIn(tz);
  return h >= 22 || h < 6;
};
const timeIn = (tz: string) => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date()).toLowerCase();

export async function pickForUs(people: PickPerson[], options: Media[], current?: string): Promise<Pick> {
  const choices = options.filter((m) => m.id !== current);
  if (choices.length === 0) return { mediaId: options[0].id, reason: 'This is the only one you can all watch.', by: 'fallback' };
  try {
    return await askBedrock(people, choices);
  } catch (e) {
    console.warn('pick: Bedrock unavailable, using fallback:', (e as Error).message);
    return fallback(people, choices);
  }
}

async function askBedrock(people: PickPerson[], choices: Media[]): Promise<Pick> {
  const brief = {
    people: people.map((p) => ({
      name: p.name,
      city: p.place.city,
      localTime: timeIn(p.place.tz),
      lateNight: isLate(p.place.tz),
      recentlyWatched: p.recent.slice(0, 5).map((h) => h.title),
    })),
    options: choices.map((m) => ({
      id: m.id,
      title: m.title,
      minutes: Math.round(m.runtime / 60),
      genre: m.genre,
      about: m.logline,
      service: m.provider === 'firejam' ? 'FireJam (free)' : m.provider,
    })),
  };
  const res = await client.send(
    new ConverseCommand({
      modelId: MODEL,
      system: [
        {
          text:
            'You pick one title for friends and family watching together on Fire TV from different cities. ' +
            'If anyone has lateNight true, prefer something short and say so with their city and local time; otherwise do not mention the time of day. ' +
            'Avoid what they just watched, use their names, and keep it warm and personal. ' +
            'Answer with JSON only: {"mediaId": "<one option id>", "reason": "<one sentence, under 140 characters>"}.',
        },
      ],
      messages: [{ role: 'user', content: [{ text: JSON.stringify(brief) }] }],
      inferenceConfig: { maxTokens: 200, temperature: 0.6 },
    }),
  );
  const text = res.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { mediaId?: string; reason?: string };
  const media = choices.find((m) => m.id === json.mediaId);
  if (!media || !json.reason) throw new Error(`unusable answer: ${text.slice(0, 120)}`);
  return { mediaId: media.id, reason: String(json.reason).slice(0, 180), by: 'bedrock' };
}

function fallback(people: PickPerson[], choices: Media[]): Pick {
  const late = people.find((p) => isLate(p.place.tz));
  if (late) {
    const shortest = [...choices].sort((a, b) => a.runtime - b.runtime)[0];
    return {
      mediaId: shortest.id,
      reason: `It's ${timeIn(late.place.tz)} in ${late.place.city}, so something short: ${Math.round(shortest.runtime / 60)} minutes.`,
      by: 'fallback',
    };
  }
  const seen = new Set(people.flatMap((p) => p.recent.map((h) => h.title)));
  const fresh = choices.find((m) => !seen.has(m.title)) ?? choices[0];
  return { mediaId: fresh.id, reason: `Nobody here has watched ${fresh.title} lately.`, by: 'fallback' };
}

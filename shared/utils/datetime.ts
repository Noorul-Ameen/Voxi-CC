/** UAE (Asia/Dubai) date/time utilities.
 *
 * The UAE uses UTC+4 with no daylight saving, so Dubai local time is a fixed
 * offset. All journey dates are Dubai-local calendar dates (YYYY-MM-DD),
 * independent of the browser's timezone.
 */

export const UAE_TIMEZONE = 'Asia/Dubai';
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Current instant as a Dubai-local Date-like breakdown. */
export function nowInDubai(now: Date = new Date()): {
  date: string; // YYYY-MM-DD
  minutesFromMidnight: number;
  dayOfWeek: number; // 0=Sun..6=Sat (Dubai-local)
} {
  const shifted = new Date(now.getTime() + UAE_OFFSET_MS);
  const date = shifted.toISOString().slice(0, 10);
  const minutesFromMidnight = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date, minutesFromMidnight, dayOfWeek: shifted.getUTCDay() };
}

/** Add days to a YYYY-MM-DD date string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → YYYYMMDD (VOX `d` query parameter format). */
export function toVoxDateParam(date: string): string {
  return date.replaceAll('-', '');
}

/** YYYYMMDD → YYYY-MM-DD. */
export function fromVoxDateParam(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Human-friendly Dubai-local label for a journey date. */
export function formatDateLabel(date: string, now: Date = new Date()): string {
  const today = nowInDubai(now).date;
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Parse a VOX display time like "11:30pm" / "9:00am" to minutes from midnight. */
export function parseTimeLabel(label: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(label.trim());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const pm = m[3]!.toLowerCase() === 'pm';
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  return h * 60 + min;
}

export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const ampm = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm}${ampm}`;
}

export interface DatePhraseResult {
  date?: string;
  /** e.g. "tonight" implies an evening time floor. */
  timeFromMinutes?: number;
  /** "weekend" resolves to the next Sat (VOX weekend = Sat/Sun; Fri evening included). */
  matchedPhrase?: string;
}

/** Resolve natural-language date phrases to Dubai-local dates.
 *  Handles: today, tonight, tomorrow, this weekend, weekday names,
 *  "after 7pm"-style time floors, and explicit "19 Aug" style dates. */
export function parseDatePhrase(text: string, now: Date = new Date()): DatePhraseResult {
  const t = text.toLowerCase();
  const { date: today, dayOfWeek } = nowInDubai(now);
  const result: DatePhraseResult = {};

  if (/\btonight\b/.test(t)) {
    result.date = today;
    result.timeFromMinutes = 18 * 60;
    result.matchedPhrase = 'tonight';
  } else if (/\btoday\b/.test(t)) {
    result.date = today;
    result.matchedPhrase = 'today';
  } else if (/\btomorrow\b/.test(t)) {
    result.date = addDays(today, 1);
    result.matchedPhrase = 'tomorrow';
  } else if (/\b(this\s+)?weekend\b/.test(t)) {
    // UAE weekend: Saturday–Sunday. Days to next Saturday (6).
    const toSat = (6 - dayOfWeek + 7) % 7;
    result.date = addDays(today, toSat);
    result.matchedPhrase = 'weekend';
  } else {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < days.length; i++) {
      const re = new RegExp(`\\b(?:on\\s+|next\\s+|this\\s+)?${days[i]}\\b`);
      if (re.test(t)) {
        let delta = (i - dayOfWeek + 7) % 7;
        if (delta === 0 && /\bnext\b/.test(t)) delta = 7;
        result.date = addDays(today, delta);
        result.matchedPhrase = days[i];
        break;
      }
    }
    // Explicit "19 aug" / "aug 19" / "19 august"
    if (!result.date) {
      const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const m1 = /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t)
        ?? (() => {
          const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})\b/.exec(t);
          return m ? ([m[0], m[2], m[1]] as unknown as RegExpExecArray) : null;
        })();
      if (m1) {
        const day = Number(m1[1]);
        const mon = months.indexOf(m1[2]!.slice(0, 3)) + 1;
        if (day >= 1 && day <= 31 && mon >= 1) {
          const year = Number(today.slice(0, 4));
          let candidate = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          if (candidate < today) candidate = `${year + 1}-${candidate.slice(5)}`;
          result.date = candidate;
          result.matchedPhrase = m1[0] as unknown as string;
        }
      }
    }
  }

  // Time floors: "after 7", "after 7pm", "after 19:00", "after dinner", "late night"
  const after = /\bafter\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
  if (after) {
    let h = Number(after[1]);
    const min = after[2] ? Number(after[2]) : 0;
    const ap = after[3];
    if (ap === 'pm' && h !== 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap && h <= 11 && h >= 1) h += 12; // "after 7" → 7 PM (cinema context)
    result.timeFromMinutes = h * 60 + min;
  } else if (/\bafter\s+dinner\b/.test(t)) {
    result.timeFromMinutes = 20 * 60;
  } else if (/\b(late\s*night|midnight)\b/.test(t)) {
    result.timeFromMinutes = 22 * 60;
  } else if (/\b(this\s+)?(morning)\b/.test(t)) {
    result.timeFromMinutes ??= 0;
  } else if (/\b(this\s+)?evening\b/.test(t)) {
    result.timeFromMinutes = 18 * 60;
    result.date ??= today;
  }

  return result;
}

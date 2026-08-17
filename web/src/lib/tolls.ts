/**
 * I-25 Central Express Lane toll schedule (20th Street ↔ US-36).
 *
 * Source: CDOT "I-25 Central (20th Street to US-36) Express Lanes Toll Rates
 * and Schedule for July 1st, 2025 - August 31st, 2026" (published rate table,
 * confirmed against https://www.codot.gov/projects/archives/i-25-hov-express-lanes).
 *
 * This is a single flat toll per trip, NOT a per-mile or multi-zone charge —
 * CDOT charges "the toll price posted when [drivers] entered", so the price
 * for the whole corridor is just whichever time band you enter in.
 *
 * Update this table whenever CDOT republishes rates (typically annually,
 * around July 1st) — check the schedule linked above.
 */

export type TollDirection = 'northbound' | 'southbound';

export interface TollBand {
  /** Minutes from midnight, inclusive start. */
  startMinutes: number;
  /** Minutes from midnight, exclusive end. 1440 = midnight (end of day). */
  endMinutes: number;
  label: string;
  /** null = lane closed to general traffic in this direction during this band. */
  expressToll: number | null;
  licensePlateToll: number | null;
}

function hm(hour: number, minute = 0): number {
  return hour * 60 + minute;
}

// Northbound: leaving downtown Denver (20th St) toward US-36/Boulder.
// Open noon–3am weekdays, flat rate all weekend.
export const NORTHBOUND_WEEKDAY: TollBand[] = [
  { startMinutes: hm(0), endMinutes: hm(3), label: '12:00 AM – 3:00 AM', expressToll: 1.70, licensePlateToll: 4.15 },
  { startMinutes: hm(3), endMinutes: hm(12), label: '3:00 AM – 12:00 PM', expressToll: null, licensePlateToll: null },
  { startMinutes: hm(12), endMinutes: hm(14), label: '12:00 PM – 2:00 PM', expressToll: 1.70, licensePlateToll: 4.15 },
  { startMinutes: hm(14), endMinutes: hm(15), label: '2:00 PM – 3:00 PM', expressToll: 2.95, licensePlateToll: 5.90 },
  { startMinutes: hm(15), endMinutes: hm(15, 30), label: '3:00 PM – 3:30 PM', expressToll: 4.75, licensePlateToll: 9.75 },
  { startMinutes: hm(15, 30), endMinutes: hm(16, 15), label: '3:30 PM – 4:15 PM', expressToll: 5.75, licensePlateToll: 12.50 },
  { startMinutes: hm(16, 15), endMinutes: hm(17, 45), label: '4:15 PM – 5:45 PM', expressToll: 8.75, licensePlateToll: 17.00 },
  { startMinutes: hm(17, 45), endMinutes: hm(18, 30), label: '5:45 PM – 6:30 PM', expressToll: 5.75, licensePlateToll: 12.50 },
  { startMinutes: hm(18, 30), endMinutes: hm(19), label: '6:30 PM – 7:00 PM', expressToll: 4.75, licensePlateToll: 9.75 },
  { startMinutes: hm(19), endMinutes: hm(24), label: '7:00 PM – 12:00 AM', expressToll: 1.70, licensePlateToll: 4.15 },
];

export const NORTHBOUND_WEEKEND: TollBand[] = [
  { startMinutes: hm(0), endMinutes: hm(24), label: 'All day', expressToll: 1.70, licensePlateToll: 4.15 },
];

// Southbound: coming from US-36/Boulder into downtown Denver.
// Open 5am–11am weekdays only; closed entirely on weekends.
export const SOUTHBOUND_WEEKDAY: TollBand[] = [
  { startMinutes: hm(0), endMinutes: hm(5), label: '12:00 AM – 5:00 AM', expressToll: null, licensePlateToll: null },
  { startMinutes: hm(5), endMinutes: hm(6), label: '5:00 AM – 6:00 AM', expressToll: 1.70, licensePlateToll: 4.15 },
  { startMinutes: hm(6), endMinutes: hm(6, 30), label: '6:00 AM – 6:30 AM', expressToll: 4.45, licensePlateToll: 9.10 },
  { startMinutes: hm(6, 30), endMinutes: hm(7, 15), label: '6:30 AM – 7:15 AM', expressToll: 7.75, licensePlateToll: 12.85 },
  { startMinutes: hm(7, 15), endMinutes: hm(8, 30), label: '7:15 AM – 8:30 AM', expressToll: 8.95, licensePlateToll: 17.00 },
  { startMinutes: hm(8, 30), endMinutes: hm(9), label: '8:30 AM – 9:00 AM', expressToll: 7.75, licensePlateToll: 12.85 },
  { startMinutes: hm(9), endMinutes: hm(10), label: '9:00 AM – 10:00 AM', expressToll: 3.95, licensePlateToll: 8.75 },
  { startMinutes: hm(10), endMinutes: hm(11), label: '10:00 AM – 11:00 AM', expressToll: 1.70, licensePlateToll: 4.15 },
  { startMinutes: hm(11), endMinutes: hm(24), label: '11:00 AM – 12:00 AM', expressToll: null, licensePlateToll: null },
];

export const SOUTHBOUND_WEEKEND: TollBand[] = [
  { startMinutes: hm(0), endMinutes: hm(24), label: 'All day', expressToll: null, licensePlateToll: null },
];

export const TOLL_SCHEDULE_EFFECTIVE = 'Jul 1, 2025 – Aug 31, 2026';

export const DIRECTION_LABELS: Record<TollDirection, { short: string; description: string }> = {
  northbound: { short: 'Northbound', description: 'Downtown Denver → US-36 / Boulder' },
  southbound: { short: 'Southbound', description: 'US-36 / Boulder → Downtown Denver' },
};

export function getScheduleFor(direction: TollDirection, date: Date): TollBand[] {
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  if (direction === 'northbound') return isWeekend ? NORTHBOUND_WEEKEND : NORTHBOUND_WEEKDAY;
  return isWeekend ? SOUTHBOUND_WEEKEND : SOUTHBOUND_WEEKDAY;
}

export function getCurrentBand(direction: TollDirection, date: Date): TollBand {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const schedule = getScheduleFor(direction, date);
  return schedule.find((b) => minutes >= b.startMinutes && minutes < b.endMinutes) ?? schedule[schedule.length - 1];
}

/** Minutes from midnight → "9:15 AM" for the time-of-day picker default. */
export function minutesToClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "HH:MM" (24h, from an <input type="time">) → minutes from midnight. */
export function clockInputToMinutes(value: string): number | null {
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export interface WindowSegment {
  band: TollBand;
  /** Minutes from midnight, clipped to the requested window. */
  from: number;
  to: number;
}

/**
 * "I might arrive anywhere between X and Y" — returns every band the window
 * overlaps, each clipped to the requested [startMinutes, endMinutes) range,
 * in chronological order. Does not handle windows that cross midnight.
 */
export function getBandsInWindow(direction: TollDirection, date: Date, startMinutes: number, endMinutes: number): WindowSegment[] {
  const schedule = getScheduleFor(direction, date);
  const segments: WindowSegment[] = [];
  for (const band of schedule) {
    const from = Math.max(band.startMinutes, startMinutes);
    const to = Math.min(band.endMinutes, endMinutes);
    if (from < to) segments.push({ band, from, to });
  }
  return segments;
}

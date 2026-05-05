/**
 * Scheduling rules engine.
 *
 * Rule types
 * ──────────
 *   Org-level:
 *     min_booking_window  — slot must be ≥ N hours from now
 *     day_blackout        — entire days of week blocked for all providers in the org
 *     time_buffer         — no slots within N minutes of a named time window (e.g. lunch)
 *
 *   Provider-level:
 *     new_patient_days    — new patients may only book on specified days
 *     provider_day_blackout — this provider is unavailable on specified days
 *
 * All functions are pure — no DB calls, no side effects.
 * Timezone: America/New_York (ET) — same as the rest of the booking system.
 */

import { toZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';

// ─── Day-of-week type ─────────────────────────────────────────────────────────

export type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

const DOW_INDEX: Record<number, DayOfWeek> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
};

export const ALL_DAYS: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

// ─── Rule type definitions ────────────────────────────────────────────────────

/**
 * Slot must be booked at least `hours` hours in the future.
 * e.g. { type: 'min_booking_window', hours: 2 }
 */
export interface MinBookingWindowRule {
  type:   'min_booking_window';
  hours:  number;
  label?: string;
}

/**
 * No appointments on the listed days for all providers in the org.
 * e.g. { type: 'day_blackout', days: ['saturday', 'sunday'] }
 */
export interface DayBlackoutRule {
  type:   'day_blackout';
  days:   DayOfWeek[];
  label?: string;
}

/**
 * No appointments within `bufferMinutes` of a named time window.
 * windowStart / windowEnd are "HH:MM" 24-hour strings (ET).
 * e.g. { type: 'time_buffer', windowStart: '12:00', windowEnd: '13:00', bufferMinutes: 30 }
 * → blocks slots at 12:00 and 13:00 (with hourly slots)
 */
export interface TimeBufferRule {
  type:          'time_buffer';
  windowStart:   string;   // "HH:MM"
  windowEnd:     string;   // "HH:MM"
  bufferMinutes: number;
  label?:        string;   // "Lunch break"
}

export type OrgSchedulingRule =
  | MinBookingWindowRule
  | DayBlackoutRule
  | TimeBufferRule;

/**
 * New patients (no existing appointment in the system) can only book on these days.
 * e.g. { type: 'new_patient_days', days: ['monday', 'wednesday', 'friday'] }
 */
export interface NewPatientDaysRule {
  type:   'new_patient_days';
  days:   DayOfWeek[];
  label?: string;
}

/**
 * This specific provider is unavailable on these days (independent of org blackouts).
 * e.g. { type: 'provider_day_blackout', days: ['wednesday'] }
 */
export interface ProviderDayBlackoutRule {
  type:   'provider_day_blackout';
  days:   DayOfWeek[];
  label?: string;
}

export type ProviderSchedulingRule =
  | NewPatientDaysRule
  | ProviderDayBlackoutRule;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Converts "HH:MM" to total minutes from midnight. */
function parseMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Gets the day of week of a UTC datetime, evaluated in ET. */
function slotDayOfWeek(dt: Date): DayOfWeek {
  return DOW_INDEX[toZonedTime(dt, TZ).getDay()];
}

/** Gets minutes from midnight for a UTC datetime, evaluated in ET. */
function slotMinsFromMidnight(dt: Date): number {
  const et = toZonedTime(dt, TZ);
  return et.getHours() * 60 + et.getMinutes();
}

// ─── Core: check a single slot ────────────────────────────────────────────────

/**
 * Returns a human-readable violation reason if the slot is blocked by any rule,
 * or `null` if the slot is allowed.
 *
 * Short-circuits on the first violation found (org rules checked before provider rules).
 */
export function checkSlot(
  slotDatetime: Date,
  orgRules: OrgSchedulingRule[],
  providerRules: ProviderSchedulingRule[],
  options: { isNewPatient: boolean; now: Date },
): string | null {
  const day      = slotDayOfWeek(slotDatetime);
  const slotMins = slotMinsFromMidnight(slotDatetime);
  const { isNewPatient, now } = options;

  // ── Org-level rules ────────────────────────────────────────────────────────
  for (const rule of orgRules) {
    if (rule.type === 'min_booking_window') {
      const minMs = rule.hours * 60 * 60 * 1000;
      if (slotDatetime.getTime() - now.getTime() < minMs) {
        return `must be booked at least ${rule.hours} hour${rule.hours !== 1 ? 's' : ''} in advance`;
      }
    }

    if (rule.type === 'day_blackout') {
      if (rule.days.includes(day)) {
        const dayStr = rule.label ?? rule.days.map(d => d + 's').join(', ');
        return `the practice is closed on ${dayStr}`;
      }
    }

    if (rule.type === 'time_buffer') {
      const windowStartMins = parseMins(rule.windowStart);
      const windowEndMins   = parseMins(rule.windowEnd);
      const bufferedStart   = windowStartMins - rule.bufferMinutes;
      const bufferedEnd     = windowEndMins   + rule.bufferMinutes;
      if (slotMins >= bufferedStart && slotMins < bufferedEnd) {
        const name = rule.label ? `the ${rule.label.toLowerCase()} window` : `${rule.windowStart}–${rule.windowEnd}`;
        return `within the ${rule.bufferMinutes}-minute buffer around ${name}`;
      }
    }
  }

  // ── Provider-level rules ───────────────────────────────────────────────────
  for (const rule of providerRules) {
    if (rule.type === 'provider_day_blackout') {
      if (rule.days.includes(day)) {
        const dayStr = rule.label ?? rule.days.map(d => d + 's').join(', ');
        return `this provider is unavailable on ${dayStr}`;
      }
    }

    if (rule.type === 'new_patient_days' && isNewPatient) {
      if (!rule.days.includes(day)) {
        const allowed = rule.days.join(', ');
        return `new patients can only book on ${allowed}`;
      }
    }
  }

  return null;
}

// ─── Batch filter ─────────────────────────────────────────────────────────────

export interface FilterResult<T> {
  slots:        T[];
  blockedCount: number;
  /** Unique human-readable reasons — use to build "no slots" explanations. */
  reasons:      string[];
}

/**
 * Filters an array of slot-like objects, returning only those that pass all rules.
 * Collects distinct violation reasons across all blocked slots.
 */
export function filterSlotsByRules<T extends { datetime: string }>(
  slots: T[],
  orgRules: OrgSchedulingRule[],
  providerRules: ProviderSchedulingRule[],
  options: { isNewPatient: boolean; now: Date },
): FilterResult<T> {
  const valid: T[]      = [];
  const reasonSet       = new Set<string>();
  let blockedCount      = 0;

  for (const slot of slots) {
    const dt     = new Date(slot.datetime);
    const reason = checkSlot(dt, orgRules, providerRules, options);
    if (reason) {
      reasonSet.add(reason);
      blockedCount++;
    } else {
      valid.push(slot);
    }
  }

  return { slots: valid, blockedCount, reasons: [...reasonSet] };
}

// ─── Message helpers ──────────────────────────────────────────────────────────

/**
 * Converts a list of rule-violation reasons into a patient-facing explanation.
 * Used to augment "no available slots" messages with actionable context.
 */
export function buildRuleExplanation(reasons: string[], providerName: string): string {
  if (reasons.length === 0) return '';
  const bullet = reasons.map(r => `• ${capitalize(r)}.`).join('\n');
  return `\n\nNote: some slots with ${providerName} were unavailable because:\n${bullet}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isValidOrgRule(r: unknown): r is OrgSchedulingRule {
  if (!r || typeof r !== 'object') return false;
  const rule = r as Record<string, unknown>;
  if (rule.type === 'min_booking_window') return typeof rule.hours === 'number' && rule.hours > 0;
  if (rule.type === 'day_blackout')       return Array.isArray(rule.days) && rule.days.length > 0;
  if (rule.type === 'time_buffer')        return (
    typeof rule.windowStart === 'string' &&
    typeof rule.windowEnd   === 'string' &&
    typeof rule.bufferMinutes === 'number' &&
    rule.bufferMinutes >= 0
  );
  return false;
}

export function isValidProviderRule(r: unknown): r is ProviderSchedulingRule {
  if (!r || typeof r !== 'object') return false;
  const rule = r as Record<string, unknown>;
  if (rule.type === 'new_patient_days')     return Array.isArray(rule.days) && rule.days.length > 0;
  if (rule.type === 'provider_day_blackout') return Array.isArray(rule.days) && rule.days.length > 0;
  return false;
}

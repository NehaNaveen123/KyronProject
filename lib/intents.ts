/**
 * Intent detection and data extraction — all pure functions, no LLM.
 * The backend uses these to parse user messages and update conversation state.
 */

import { addDays, addWeeks, startOfWeek, getDay, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TZ = 'America/New_York';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PatientInfo {
  firstName:  string | null;
  lastName:   string | null;
  dob:        string | null;
  phone:      string | null;
  email:      string | null;
  reason:     string | null;
  specialty:  string | null;
}

export type ConversationStep =
  | 'collecting_info'
  | 'awaiting_timeframe'      // legacy — kept for backward compat with stored sessions
  | 'showing_availability'
  | 'confirming_booking'
  | 'booked'
  | 'returning_patient'       // existing appointment found; presenting keep/reschedule/cancel
  | 'confirming_cancel'       // patient chose cancel; awaiting confirmation
  | 'rescheduling'            // showing new slots for reschedule
  | 'confirming_reschedule';  // patient picked new slot; awaiting confirmation

/** Serializable date range (ISO strings so it round-trips through JSON/DB cleanly). */
export interface TimeframeFilter {
  label: string;   // human-readable: "today", "this week", "Monday"
  from:  string;   // ISO string
  to:    string;   // ISO string
}

export interface SlotOption {
  id:        string;
  datetime:  string;   // ISO — used for booking
  formatted: string;   // "Friday (05/01) at 10:00 AM" — shown to patient
  date:      string;   // "Friday (05/01)"
  time:      string;   // "10:00 AM"
}

/** Snapshot of a found existing appointment — populated during returning-patient lookup. */
export interface ExistingAppointment {
  id:           string;
  doctorId:     string;
  doctorName:   string;
  specialty:    string;
  formatted:    string;   // "Friday (05/01) at 10:00 AM"
  datetime:     string;   // ISO
  firstName:    string;   // from the dedicated DB column; empty string for legacy rows
  lastName:     string;
  patientName:  string;   // combined "First Last" — kept for backward compat
  patientDob:   string;
  patientPhone: string;
  patientEmail: string;
  reason:       string;
}

export interface ConversationState {
  step:                 ConversationStep;
  patient:              PatientInfo;
  doctorId:             string | null;
  doctorName:           string | null;   // always from DB
  slots:                SlotOption[];
  selectedSlot:         SlotOption | null;
  appointmentId:        string | null;
  timeframe:            TimeframeFilter | null;
  existingAppointment:  ExistingAppointment | null;  // populated on returning-patient match
}

export function emptyState(): ConversationState {
  return {
    step: 'collecting_info',
    patient: {
      firstName: null, lastName: null, dob:      null,
      phone:     null, email:    null, reason:   null, specialty: null,
    },
    doctorId:            null,
    doctorName:          null,
    slots:               [],
    selectedSlot:        null,
    appointmentId:       null,
    timeframe:           null,
    existingAppointment: null,
  };
}

// ─── Allowed specialties (single source of truth) ─────────────────────────────

export const ALLOWED_SPECIALTIES = [
  'Cardiology',
  'Dermatology',
  'Dentistry',
  'Orthopedics',
  'Neurology',
] as const;

export type AllowedSpecialty = typeof ALLOWED_SPECIALTIES[number];

// ─── Strict specialty keyword map ─────────────────────────────────────────────

const SPECIALTY_MAP: Record<AllowedSpecialty, string[]> = {
  Cardiology:  [
    'heart', 'chest pain', 'chest', 'cardiac', 'cardiovascular',
    'palpitation', 'blood pressure', 'arrhythmia', 'shortness of breath',
    'hypertension', 'coronary', 'angina',
  ],
  Dermatology: [
    'skin', 'rash', 'acne', 'eczema', 'mole', 'hair loss', 'nail',
    'psoriasis', 'hives', 'itching', 'itchy', 'dermatology', 'wart',
    'sunburn', 'dandruff', 'ringworm', 'seborrhea',
  ],
  Dentistry: [
    'tooth', 'teeth', 'dental', 'dentist', 'dentistry', 'gum', 'gums',
    'mouth pain', 'toothache', 'tooth ache', 'broken tooth', 'broke a tooth',
    'cracked tooth', 'chipped tooth', 'cavity', 'cavities', 'filling',
    'root canal', 'wisdom tooth', 'wisdom teeth', 'jaw pain', 'bleeding gums',
  ],
  Orthopedics: [
    'bone', 'joint', 'knee', 'hip', 'back pain', 'back', 'shoulder',
    'fracture', 'arthritis', 'muscle', 'spine', 'orthopedic', 'sports injury',
    'wrist', 'ankle', 'foot pain', 'foot', 'elbow', 'neck pain', 'neck',
    'ligament', 'tendon', 'rotator cuff', 'sciatica', 'scoliosis', 'sprain',
  ],
  Neurology:   [
    'brain', 'headache', 'migraine', 'dizzy', 'dizziness', 'seizure',
    'memory', 'numbness', 'nerve', 'neurological', 'stroke', 'tingling',
    'tremor', 'vertigo', 'epilepsy', 'parkinson', 'multiple sclerosis',
    'neuropathy', 'concussion',
  ],
};

/**
 * Maps a message to one of the allowed specialties, or null.
 * This is the ONLY function that decides specialty — never the LLM.
 */
export function mapToSpecialty(text: string): AllowedSpecialty | null {
  const lower = text.toLowerCase();
  // Dental words can overlap with general injury language ("broke", "pain").
  // Give them explicit priority so "broke a tooth" never falls into Orthopedics.
  if (SPECIALTY_MAP.Dentistry.some(kw => lower.includes(kw))) return 'Dentistry';

  for (const specialty of ALLOWED_SPECIALTIES) {
    if (SPECIALTY_MAP[specialty].some(kw => lower.includes(kw))) return specialty;
  }
  return null;
}

// ─── Unsupported medical keyword detection ────────────────────────────────────

const UNSUPPORTED_MEDICAL_KEYWORDS = [
  'ear', 'hearing', 'throat', 'tonsil', 'sinus', 'nasal', 'nose bleed', 'laryngitis',
  'stomach', 'bowel', 'colon', 'intestine', 'digestive', 'acid reflux', 'heartburn',
  'nausea', 'vomiting', 'diarrhea', 'constipation', 'ibs', 'crohn', 'ulcer', 'liver',
  'lung', 'breathing', 'asthma', 'bronchitis', 'copd', 'pneumonia', 'cough',
  'kidney', 'bladder', 'urinary', 'prostate', 'uti',
  'eye', 'vision', 'glasses', 'retina', 'glaucoma', 'cataract',
  'depression', 'anxiety', 'mental health', 'bipolar', 'adhd', 'insomnia', 'ptsd',
  'cancer', 'tumor', 'chemotherapy', 'oncology',
  'diabetes', 'thyroid', 'hormone', 'insulin', 'hyperthyroid',
  'pregnancy', 'menstrual', 'ovary', 'uterus', 'pelvic', 'gynecology',
  'fever', 'cold', 'flu', 'infection', 'allergy', 'allergies',
];

export function containsMedicalKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  if (ALLOWED_SPECIALTIES.some(s => SPECIALTY_MAP[s].some(kw => lower.includes(kw)))) return true;
  return UNSUPPORTED_MEDICAL_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Timeframe detection ──────────────────────────────────────────────────────

function toRange(from: Date, to: Date, label: string): TimeframeFilter {
  return { label, from: from.toISOString(), to: to.toISOString() };
}

function nowInET(): Date {
  return toZonedTime(new Date(), TZ);
}

function etDayRange(dayInET: Date, label: string): TimeframeFilter {
  const etToday = startOf(nowInET()).getTime();
  const etTarget = startOf(dayInET).getTime();
  const from = etTarget === etToday
    ? new Date()
    : fromZonedTime(startOfDay(dayInET), TZ);

  return toRange(
    from,
    fromZonedTime(endOfDay(dayInET), TZ),
    label,
  );
}

/**
 * Returns a copy of d with time set to 00:00:00.000 in SERVER LOCAL TIME.
 * Using setHours (not date-fns startOfDay) avoids UTC-interpretation issues.
 */
function startOf(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Returns next occurrence of a weekday (0=Sun … 6=Sat), always in the future. */
function nextWeekday(targetDow: number): Date {
  const today    = startOf(nowInET());
  const todayDow = getDay(today);
  let daysAhead  = targetDow - todayDow;
  if (daysAhead <= 0) daysAhead += 7;
  return addDays(today, daysAhead);
}

function thisOrNextWeekday(targetDow: number): Date {
  const today    = startOf(nowInET());
  const todayDow = getDay(today);
  let daysAhead  = targetDow - todayDow;
  if (daysAhead < 0) daysAhead += 7;
  return addDays(today, daysAhead);
}

/**
 * Parses a timeframe from a user message.
 * Returns a serializable date range, or null if no timeframe is specified.
 * All boundary dates use server local time via setHours — never UTC offsets.
 */
export function detectTimeframe(text: string): TimeframeFilter | null {
  const lower = text.toLowerCase().trim();
  const now   = new Date();
  const etNow = nowInET();
  const today = startOf(etNow);   // midnight today in America/New_York

  if (lower.includes('today')) {
    return etDayRange(today, 'today');
  }

  if (lower.includes('tomorrow')) {
    const tom = addDays(today, 1);
    return etDayRange(tom, 'tomorrow');
  }

  if (lower.includes('next week')) {
    const nextMon = startOfWeek(addWeeks(etNow, 1), { weekStartsOn: 1 });
    return toRange(
      fromZonedTime(startOfDay(nextMon), TZ),
      fromZonedTime(endOfDay(addDays(nextMon, 4)), TZ),
      'next week',
    );
  }

  if (lower.includes('this week') || lower.includes('week')) {
    const thisMon = startOfWeek(etNow, { weekStartsOn: 1 });
    const thisFri = addDays(thisMon, 4);
    // Weekend: "this week" has no remaining weekdays → show next week instead.
    const dow = getDay(etNow);   // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) {
      const nextMon = startOfWeek(addWeeks(etNow, 1), { weekStartsOn: 1 });
      return toRange(
        fromZonedTime(startOfDay(nextMon), TZ),
        fromZonedTime(endOfDay(addDays(nextMon, 4)), TZ),
        'next week',
      );
    }
    // Midweek: start from now so already-past morning slots are excluded.
    return toRange(now, fromZonedTime(endOfDay(thisFri), TZ), 'this week');
  }

  // Day names — find next occurrence (all 7 days including weekend)
  const DAYS: [string, number][] = [
    ['monday', 1], ['tuesday', 2], ['wednesday', 3],
    ['thursday', 4], ['friday', 5], ['saturday', 6], ['sunday', 0],
  ];
  for (const [name, dow] of DAYS) {
    if (lower.includes(name)) {
      const wantsNext = new RegExp(`\\bnext\\s+${name}\\b`).test(lower);
      const target = wantsNext ? nextWeekday(dow) : thisOrNextWeekday(dow);
      return etDayRange(target, name.charAt(0).toUpperCase() + name.slice(1));
    }
  }

  // MM/DD pattern — negative lookahead (?![\d\/]) prevents matching MM/DD when
  // it's part of a full date like MM/DD/YYYY (e.g., a patient DOB "10/1/2005").
  const mmdd = lower.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?![\d\/])/);
  if (mmdd) {
    const target = new Date(etNow.getFullYear(), parseInt(mmdd[1]) - 1, parseInt(mmdd[2]));
    return etDayRange(target, mmdd[0]);
  }

  // "Month Day" e.g. "May 5", "May 5th"
  const MONTHS: [string, number][] = [
    ['january',1],['february',2],['march',3],['april',4],['may',5],['june',6],
    ['july',7],['august',8],['september',9],['october',10],['november',11],['december',12],
    ['jan',1],['feb',2],['mar',3],['apr',4],['jun',6],['jul',7],
    ['aug',8],['sep',9],['oct',10],['nov',11],['dec',12],
  ];
  for (const [name, month] of MONTHS) {
    if (lower.includes(name)) {
      const dayM = lower.match(new RegExp(`${name}\\s+(\\d{1,2})`));
      if (dayM) {
        const target = new Date(etNow.getFullYear(), month - 1, parseInt(dayM[1]));
        return etDayRange(target, `${name} ${dayM[1]}`);
      }
    }
  }

  return null;
}

/**
 * Returns true if the user says they're flexible / any time works.
 * In this case we show the next N available slots without a date restriction.
 */
export function isOpenTimeframe(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'anytime', 'any time', 'any day', 'whenever', 'whatever',
    'flexible', 'first available', 'earliest', 'soonest',
    "doesn't matter", 'doesnt matter', "don't mind", 'any opening',
  ].some(w => lower.includes(w));
}

export function isAvailabilityRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'do you have appointments',
    'do you have appointment',
    'when can i come in',
    'do you have anything today',
    'do you have anything tomorrow',
    'do you have anything',
    'any opening',
    'any openings',
    'appointments today',
    'appointments tomorrow',
    'available appointments',
    'what times are available',
    'what time is available',
    'what times do you have',
    'what time do you have',
    'when is the next available',
    'next available',
    'show me availability',
    'show availability',
    'available slot',
    'available slots',
  ].some(phrase => lower.includes(phrase));
}

// ─── Data extraction from free text ──────────────────────────────────────────

export function extractEmail(text: string): string | null {
  const m = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  return m ? m[0].toLowerCase() : null;
}

export function extractPhone(text: string): string | null {
  const m = text.match(/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return m ? m[0].trim() : null;
}

export function extractDob(text: string): string | null {
  const m = text.match(/\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/);
  return m ? m[0] : null;
}

// Common English words that are never names — used to reject false positives in extractName().
const NON_NAME_WORDS = new Set([
  'ok','okay','hi','hey','hello','yes','no','sure','thanks','thank','please','sorry',
  'when','can','come','in','is','it','do','at','the','my','go','be','me','we',
  'he','she','they','you','by','to','for','of','and','or','but','if','so','up',
  'out','on','off','how','why','what','who','that','this','with','from','will',
  'was','are','had','has','have','just','not','any','all','get','got','let','see',
  'now','than','then','there','their','also','too','yet','still','would','could',
  'should','may','might','am','an','a','i',
]);

export function extractName(text: string): { firstName: string; lastName: string } | null {
  // Strip common filler phrases at the start (handles "my name is john doe", "I'm Jane Smith")
  const stripped = text.trim()
    .replace(/^(my name is|i(?:'m| am)|name is|this is|it(?:'s| is)|call me)\s+/i, '')
    .trim();

  if (stripped.endsWith('?') || stripped.length > 60) return null;
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return null;

  // Capitalize first letter of each word so "john doe" → ["John", "Doe"]
  const capitalized = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  if (!capitalized.every(w => /^[A-Z][a-zA-Z'-]*$/.test(w))) return null;

  // Reject if any word is a common English non-name word (catches "Ok It", "Come In", etc.)
  if (capitalized.some(w => NON_NAME_WORDS.has(w.toLowerCase()))) return null;

  return {
    firstName: capitalized[0],
    lastName:  capitalized.length > 1 ? capitalized[capitalized.length - 1] : '',
  };
}

// ─── Slot selection ───────────────────────────────────────────────────────────

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5,
};

/**
 * Parses the 24-hour value (0–23) from a slot's formatted time string.
 * e.g. "3:00 PM" → 15,  "9:00 AM" → 9,  "12:00 PM" → 12.
 */
function parseSlotHour(slotTime: string): number {
  const m = slotTime.match(/(\d{1,2}):\d{2}\s*(AM|PM)/i);
  if (!m) return -1;
  let h = parseInt(m[1], 10);
  const ap = m[2].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h;
}

export function detectSlotSelection(text: string, slots: SlotOption[]): number | null {
  if (!slots.length) return null;
  const lower = text.toLowerCase();

  // ── 1. Ordinals — "first", "2nd", etc. ───────────────────────────────────────
  for (const [word, num] of Object.entries(ORDINALS)) {
    if (lower.includes(word)) {
      const idx = num - 1;
      return idx < slots.length ? idx : null;
    }
  }

  // ── 2. Time expressions — MUST run before digit-only matching ────────────────
  // Handles "3pm", "3 pm", "3:00 pm", "3:00pm", "15:00", etc.
  // The digit-only branch below would misinterpret "3pm" as slot #3 if it ran first.
  const timeMeridiem = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMeridiem) {
    let userHour = parseInt(timeMeridiem[1], 10);
    const ampm   = timeMeridiem[3];
    if (ampm === 'pm' && userHour !== 12) userHour += 12;
    if (ampm === 'am' && userHour === 12) userHour = 0;
    for (let i = 0; i < slots.length; i++) {
      if (parseSlotHour(slots[i].time) === userHour) return i;
    }
  }

  // 24-hour format: "15:00", "09:00"
  const time24 = lower.match(/\b(1\d|2[0-3]|0\d):([0-5]\d)\b/);
  if (time24) {
    const userHour = parseInt(time24[1], 10);
    for (let i = 0; i < slots.length; i++) {
      if (parseSlotHour(slots[i].time) === userHour) return i;
    }
  }

  // ── 3. Digit as list-position number — only after time matching fails ─────────
  const digitMatch = lower.match(/(?:option\s*|number\s*|#\s*)?(\d+)/);
  if (digitMatch) {
    const idx = parseInt(digitMatch[1], 10) - 1;
    if (idx >= 0 && idx < slots.length) return idx;
  }

  // ── 4. Date string (MM/DD) ────────────────────────────────────────────────────
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].date && lower.includes(slots[i].date.toLowerCase())) return i;
  }

  return null;
}

// ─── Confirmation / cancellation ─────────────────────────────────────────────

const YES_WORDS = ['yes','confirm','book it','that works','sounds good','perfect',
                   'ok','okay','sure','yep','yeah','correct','go ahead','please book'];
const NO_WORDS  = ['no','cancel','stop','different','change','another','other'];

export function isConfirmation(text: string): boolean {
  const lower = text.toLowerCase();
  return YES_WORDS.some(w => lower.includes(w)) && !NO_WORDS.some(w => lower.includes(w));
}

export function isCancellation(text: string): boolean {
  return NO_WORDS.some(w => text.toLowerCase().includes(w));
}

// ─── Info completeness ────────────────────────────────────────────────────────

export function missingFields(p: PatientInfo): string[] {
  const fields: Array<[keyof PatientInfo, string]> = [
    ['firstName', 'first name'], ['lastName', 'last name'],
    ['dob', 'date of birth'], ['phone', 'phone number'],
    ['email', 'email address'],
    // Use 'specialty' (not 'reason') so the list empties when isInfoComplete() would return true.
    // Label it 'reason for visit' so the AI asks for it in plain language.
    ['specialty', 'reason for visit'],
  ];
  return fields.filter(([k]) => !p[k]).map(([, label]) => label);
}

export function isInfoComplete(p: PatientInfo): boolean {
  return !!(p.firstName && p.lastName && p.dob && p.phone && p.email && p.specialty);
}

// ─── Returning-patient intents ────────────────────────────────────────────────

/** Patient wants to keep their existing appointment. */
export function isKeepIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return ['keep', 'keep it', 'stay', 'fine', 'good', 'that works', 'all good',
          '1', 'one', 'first', 'option 1'].some(w => lower === w || lower.includes(w));
}

/** Patient wants to reschedule their existing appointment. */
export function isRescheduleIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return ['reschedule', 'change', 'move', 'switch', 'different time', 'different day',
          '2', 'two', 'second', 'option 2'].some(w => lower === w || lower.includes(w));
}

/** Patient wants to cancel their existing appointment. */
export function isCancelIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return ['cancel', 'delete', 'remove', 'no longer', 'dont need', "don't need",
          '3', 'three', 'third', 'option 3'].some(w => lower === w || lower.includes(w));
}

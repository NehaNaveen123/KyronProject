import { prisma } from './db';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { sendConfirmationEmail } from './mail';
import {
  filterSlotsByRules,
  checkSlot,
  buildRuleExplanation,
  type OrgSchedulingRule,
  type ProviderSchedulingRule,
} from './rules';

const TZ = 'America/New_York';

/**
 * Canonical clinic hours in ET — single source of truth for both the seed
 * script and the admin slot-management API.
 */
export const VALID_SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
const HOURS = VALID_SLOT_HOURS as unknown as number[];

function et(date: Date) {
  return toZonedTime(date, TZ);
}

// Day name lookup — used instead of toLocaleDateString so the result is
// based on the UTC fields that toZonedTime writes, not the server's local TZ.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function format(dt: Date) {
  // toZonedTime stores the ET local time in the Date's UTC fields.
  // Always read via getUTC* so this works on any server timezone (Mac, Linux, etc.)
  const d = et(dt);

  const day = WEEKDAY_NAMES[d.getUTCDay()];
  const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd  = String(d.getUTCDate()).padStart(2, '0');

  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min    = d.getUTCMinutes();
  const minStr = min === 0 ? '00' : String(min).padStart(2, '0');

  return {
    date:      `${day} (${mm}/${dd})`,
    time:      `${h}:${minStr} ${ampm}`,
    formatted: `${day} (${mm}/${dd}) at ${h}:${minStr} ${ampm}`,
  };
}

/**
 * Validates that a datetime falls on a valid clinic-hour boundary in ET.
 * Accepts both :00 and :30 minute slots within clinic hours (9–17 ET).
 * Uses getUTC* because toZonedTime stores ET local time in the UTC fields.
 */
export function isValidSlotTime(dt: Date): boolean {
  const etTime = toZonedTime(dt, TZ);
  const etHour = etTime.getUTCHours();
  const etMin  = etTime.getUTCMinutes();
  return HOURS.includes(etHour) && (etMin === 0 || etMin === 30) && dt.getSeconds() === 0 && dt.getMilliseconds() === 0;
}

const isValid = isValidSlotTime;

function toSlot(s: any) {
  const f = format(s.datetime);
  return {
    id:       s.id,
    datetime: s.datetime.toISOString(),
    ...f,
  };
}

/**
 * Look up a provider by specialty string, optionally scoped to an org.
 */
export async function getProviderBySpecialty(specialty: string, orgId?: string) {
  return prisma.provider.findFirst({
    where: {
      specialties: { has: specialty },
      ...(orgId ? { organizationId: orgId } : {}),
    },
    select: { id: true, name: true, specialties: true },
  });
}

/** @deprecated Use getProviderBySpecialty */
export const getDoctorBySpecialty = getProviderBySpecialty;

function todayET(): { from: Date; to: Date } {
  const now     = new Date();
  const nowInET = toZonedTime(now, TZ);
  return {
    from: fromZonedTime(startOfDay(nowInET), TZ),
    to:   fromZonedTime(endOfDay(nowInET),   TZ),
  };
}

function safeSlots(raw: any[]): ReturnType<typeof toSlot>[] {
  console.log('[getAvailability] raw slots before isValid filter:', raw.length);
  const result: ReturnType<typeof toSlot>[] = [];
  for (const a of raw) {
    if (!isValid(a.datetime)) continue;
    const s = toSlot(a);
    if (!s.formatted) {
      console.warn('[getAvailability] blank formatted string — skipping slot:', s.id, s.datetime);
      continue;
    }
    result.push(s);
  }
  return result;
}

// ─── Availability query ───────────────────────────────────────────────────────

interface AvailabilityResult {
  doctorId:       string;
  doctorName:     string;
  specialty:      string;
  slots:          ReturnType<typeof toSlot>[];
  blockedReasons: string[];   // why slots were filtered out, for patient-facing messages
}

/**
 * Fetches available slots for a specialty, scoped to an org when orgId is provided.
 * Applies all scheduling rules (org + provider) before returning slots.
 *
 * @param isNewPatient  true if the patient has no existing appointment in the system
 */
export async function getAvailability(
  specialty:    string,
  timeframe?:   any,
  orgId?:       string,
  isNewPatient  = true,
): Promise<AvailabilityResult> {
  const now = new Date();

  const hasExplicitTimeframe = !!(timeframe?.from && timeframe?.to);
  const from = hasExplicitTimeframe ? new Date(timeframe.from) : todayET().from;
  const to   = hasExplicitTimeframe ? new Date(timeframe.to)   : todayET().to;

  const orgFilter = orgId ? { organizationId: orgId } : {};

  // Fetch provider + availability + rules in one query
  const queryProvider = (f: Date, t: Date) =>
    prisma.provider.findFirst({
      where: { specialties: { has: specialty }, ...orgFilter },
      select: {
        id:             true,
        name:           true,
        specialties:    true,
        schedulingRules: true,
        organization: {
          select: { schedulingRules: true },
        },
        availability: {
          where:   { isBooked: false, datetime: { gte: f, lte: t } },
          orderBy: { datetime: 'asc' },
          take:    20,
          select:  { id: true, datetime: true },
        },
      },
    });

  console.log(
    '[getAvailability] querying', specialty,
    'from', from.toISOString(), 'to', to.toISOString(),
    '| serverNow:', now.toISOString(),
    '| isNewPatient:', isNewPatient,
  );

  const provider = await queryProvider(from, to);

  if (!provider) {
    return { doctorId: '', doctorName: '', specialty, slots: [], blockedReasons: [] };
  }

  const orgRules      = ((provider.organization?.schedulingRules ?? []) as unknown) as OrgSchedulingRule[];
  const providerRules = ((provider.schedulingRules ?? [])            as unknown) as ProviderSchedulingRule[];
  const ruleOptions   = { isNewPatient, now };

  let raw    = safeSlots(provider.availability);
  let result = filterSlotsByRules(raw, orgRules, providerRules, ruleOptions);

  // When the default (today) window returned nothing, auto-expand to the next 7 days
  if (!hasExplicitTimeframe && result.slots.length === 0) {
    const expand7To = fromZonedTime(endOfDay(toZonedTime(addDays(now, 7), TZ)), TZ);
    console.log('[getAvailability] no slots today — expanding to 7 days, to:', expand7To.toISOString());
    const provider7 = await queryProvider(from, expand7To);
    if (provider7) {
      raw    = safeSlots(provider7.availability);
      result = filterSlotsByRules(raw, orgRules, providerRules, ruleOptions);
    }
  }

  console.log('[getAvailability] slots after rule filtering:', result.slots.length, '| blocked:', result.blockedCount);

  return {
    doctorId:       provider.id,
    doctorName:     provider.name,
    specialty,
    slots:          result.slots,
    blockedReasons: result.reasons,
  };
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export async function bookAppointment(params: any) {
  const dt = new Date(params.datetime);

  if (!isValid(dt)) {
    return { success: false as const, error: 'Invalid slot time' };
  }

  const slot = await prisma.availability.findFirst({
    where: params.slotId
      ? { id: params.slotId, isBooked: false }
      : { providerId: params.doctorId, datetime: dt, isBooked: false },
    select: {
      id:       true,
      isBooked: true,
      provider: {
        select: {
          name:           true,
          specialties:    true,
          schedulingRules: true,
          organization:   { select: { schedulingRules: true } },
        },
      },
    },
  });

  if (!slot) {
    return { success: false as const, error: 'Slot taken or not found' };
  }

  // Last-line-of-defence: re-check rules at write time (prevents races and
  // bookings of slots that slipped through an old filtered list)
  const orgRules      = ((slot.provider.organization?.schedulingRules ?? []) as unknown) as OrgSchedulingRule[];
  const providerRules = ((slot.provider.schedulingRules ?? [])              as unknown) as ProviderSchedulingRule[];
  const isNewPatient  = params.isNewPatient ?? true;

  const violation = checkSlot(dt, orgRules, providerRules, { isNewPatient, now: new Date() });
  if (violation) {
    return { success: false as const, error: `This slot cannot be booked: ${violation}` };
  }

  // Sanitize name fields
  const cleanedName = (params.patientName as string ?? '')
    .split(' ')
    .filter(part => part && part.toLowerCase() !== 'null')
    .join(' ')
    .trim() || 'Unknown Patient';

  const nameParts  = cleanedName.split(' ');
  const firstName  = (((params.firstName as string | undefined)?.trim()) || nameParts[0] || '')
    .replace(/^null$/i, '');
  const lastName   = (((params.lastName  as string | undefined)?.trim()) || nameParts.slice(1).join(' ') || '')
    .replace(/^null$/i, '');
  const displayFirstName = firstName || cleanedName.split(' ')[0] || 'there';

  console.log('[bookAppointment] writing name fields:', JSON.stringify({ firstName, lastName, patientName: cleanedName }));

  const [appt] = await prisma.$transaction([
    prisma.appointment.create({
      data: {
        providerId:   params.doctorId,
        patientName:  cleanedName,
        firstName,
        lastName,
        patientDob:   params.patientDob,
        patientPhone: params.patientPhone,
        patientEmail: params.patientEmail,
        reason:       params.reason,
        datetime:     dt,
        sessionId:    params.sessionId,
      },
    }),
    prisma.availability.update({
      where: { id: slot.id },
      data:  { isBooked: true },
    }),
  ]);

  const f = format(dt);

  const recipientEmail = params.patientEmail || params.email;
  if (recipientEmail) {
    console.log(`[bookAppointment] Triggering confirmation email to: ${recipientEmail}`);
    sendConfirmationEmail(recipientEmail, {
      patientName: displayFirstName,
      doctorName:  slot.provider.name,
      time:        f.formatted,
    }).catch(err => console.error('Email background task failed:', err));
  }

  return {
    success:          true as const,
    appointmentId:    appt.id,
    doctorName:       slot.provider.name,
    specialty:        slot.provider.specialties[0] ?? '',
    patientFirstName: displayFirstName,
    ...f,
  };
}

// ─── Rule-violation explanation (re-exported for chat.ts) ─────────────────────
export { buildRuleExplanation };

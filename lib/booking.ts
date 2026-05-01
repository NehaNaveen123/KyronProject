import { prisma } from './db';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { sendConfirmationEmail } from './mail'; // Create this file as shown in the previous step

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

function format(dt: Date) {
  const d = et(dt);

  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;

  return {
    date: `${day} (${mm}/${dd})`,
    time: `${h}:00 ${ampm}`,
    formatted: `${day} (${mm}/${dd}) at ${h}:00 ${ampm}`,
  };
}

/**
 * Validates that a datetime falls on a valid clinic-hour boundary in ET.
 * Uses ET hours (not raw server UTC hours) so the check is timezone-safe.
 * Exported so the admin API can reuse the same guard.
 */
export function isValidSlotTime(dt: Date): boolean {
  const etHour = toZonedTime(dt, TZ).getHours();
  return HOURS.includes(etHour) && dt.getMinutes() === 0 && dt.getSeconds() === 0;
}

// Internal alias kept for backward compat within this file.
const isValid = isValidSlotTime;

function toSlot(s: any) {
  const f = format(s.datetime);

  return {
    id: s.id,
    datetime: s.datetime.toISOString(),
    ...f,
  };
}

export async function getDoctorBySpecialty(specialty: string) {
  return prisma.doctor.findFirst({
    where: { specialty },
    select: { id: true, name: true },
  });
}

function todayET(): { from: Date; to: Date } {
  // Build today's boundaries in America/New_York using the server clock only —
  // never derive "today" from parsed conversation text.
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

export async function getAvailability(specialty: string, timeframe?: any) {
  const now = new Date();

  // When a specific timeframe is passed (user said "today", "tomorrow", etc.), honour it.
  // When no timeframe is given, ALWAYS derive the window from the server clock —
  // never trust dates that may have leaked in from conversation text (e.g. a DOB).
  const hasExplicitTimeframe = !!(timeframe?.from && timeframe?.to);
  const from = hasExplicitTimeframe ? new Date(timeframe.from) : todayET().from;
  const to   = hasExplicitTimeframe ? new Date(timeframe.to)   : todayET().to;

  const queryDoctor = (f: Date, t: Date) =>
    prisma.doctor.findFirst({
      where: { specialty },
      include: {
        availability: {
          where: { isBooked: false, datetime: { gte: f, lte: t } },
          orderBy: { datetime: 'asc' },
          take: 20,
        },
      },
    });

  console.log('[getAvailability] querying', specialty, 'from', from.toISOString(), 'to', to.toISOString(), '| serverNow:', now.toISOString());

  const doctor = await queryDoctor(from, to);

  if (!doctor) {
    return { doctorId: '', doctorName: '', specialty, slots: [] };
  }

  let slots = safeSlots(doctor.availability);

  // When the default (today) window returned nothing, automatically expand to
  // the next 7 days so the patient always sees upcoming options.
  if (!hasExplicitTimeframe && slots.length === 0) {
    const expand7To = fromZonedTime(endOfDay(toZonedTime(addDays(now, 7), TZ)), TZ);
    console.log('[getAvailability] no slots today — expanding to 7 days, to:', expand7To.toISOString());
    const doctor7 = await queryDoctor(from, expand7To);
    if (doctor7) slots = safeSlots(doctor7.availability);
  }

  console.log('[getAvailability] slots after filtering:', slots.length);

  return {
    doctorId:   doctor.id,
    doctorName: doctor.name,
    specialty,
    slots,
  };
}

export async function bookAppointment(params: any) {
  const dt = new Date(params.datetime);

  if (!isValid(dt)) {
    return { success: false as const, error: 'Invalid slot' };
  }

  const slot = await prisma.availability.findFirst({
    where: {
      doctorId: params.doctorId,
      datetime: dt,
      isBooked: false,
    },
    include: { doctor: true },
  });

  if (!slot) {
    return { success: false as const, error: 'Slot taken' };
  }

  // Sanitize the combined name: drop any literal 'null' parts that appear
  // when session state is incomplete, so the DB never stores "null null".
  const cleanedName = (params.patientName as string ?? '')
    .split(' ')
    .filter(part => part && part.toLowerCase() !== 'null')
    .join(' ')
    .trim() || 'Unknown Patient';

  // Prefer explicit firstName/lastName params (new callers pass them separately).
  // Fall back to splitting cleanedName for backward compat.
  const nameParts   = cleanedName.split(' ');
  const firstName   = (((params.firstName as string | undefined)?.trim()) || nameParts[0] || '')
    .replace(/^null$/i, '');
  const lastName    = (((params.lastName  as string | undefined)?.trim()) || nameParts.slice(1).join(' ') || '')
    .replace(/^null$/i, '');
  const displayFirstName = firstName || cleanedName.split(' ')[0] || 'there';

  console.log('[bookAppointment] writing name fields:', JSON.stringify({ firstName, lastName, patientName: cleanedName }));

  const [appt] = await prisma.$transaction([
    prisma.appointment.create({
      data: { ...params, patientName: cleanedName, firstName, lastName },
    }),
    prisma.availability.update({
      where: { id: slot.id },
      data: { isBooked: true },
    }),
  ]);

  const f = format(dt);

  const recipientEmail = params.patientEmail || params.email;
  if (recipientEmail) {
    console.log(`[bookAppointment] Triggering confirmation email to: ${recipientEmail}`);
    
    // We don't await this so the UI response stays fast
    sendConfirmationEmail(recipientEmail, {
      patientName: displayFirstName,
      doctorName: slot.doctor.name,
      time: f.formatted // Uses your existing format helper result
    }).catch(err => console.error("Email background task failed:", err));
  }

  return {
    success: true as const,
    appointmentId:    appt.id,
    doctorName:       slot.doctor.name,
    specialty:        slot.doctor.specialty,
    patientFirstName: displayFirstName,
    ...f,
  };
}

/**
 * Default availability slot generator for newly created providers.
 *
 * Generates 30-minute slots from 9:00 AM to 5:00 PM ET,
 * weekdays only, for the next N calendar days (default 7).
 * All datetimes are stored as UTC in the DB.
 *
 * Uses skipDuplicates so it's safe to call on existing providers too.
 *
 * Timezone safety: toZonedTime stores ET local time in UTC fields, so we
 * always read via getUTC* methods. Date arithmetic uses Date.UTC() to avoid
 * any local-timezone influence from the server process.
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { prisma } from './db';

const TZ = 'America/New_York';

// 30-minute slots: 9:00, 9:30, 10:00, ..., 16:30, 17:00 (17 per weekday)
const SLOT_TIMES: { hour: number; minute: number }[] = [];
for (let hour = 9; hour <= 17; hour++) {
  SLOT_TIMES.push({ hour, minute: 0 });
  if (hour < 17) SLOT_TIMES.push({ hour, minute: 30 });
}

/**
 * Convert an ET calendar date + hour + minute → UTC Date.
 * We build an ISO-style string that fromZonedTime interprets as ET local time,
 * so the result is correct regardless of the server process's local timezone.
 */
function slotUTC(etYear: number, etMonth: number, etDay: number, hour: number, minute: number): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  return fromZonedTime(
    new Date(`${etYear}-${pad(etMonth)}-${pad(etDay)}T${pad(hour)}:${pad(minute)}:00`),
    TZ,
  );
}

export async function generateProviderSlots(providerId: string, days = 7): Promise<number> {
  const now = new Date();

  // Read today's date in ET via UTC fields (toZonedTime stores ET local as UTC)
  const nowET   = toZonedTime(now, TZ);
  const etYear0 = nowET.getUTCFullYear();
  const etMon0  = nowET.getUTCMonth() + 1; // 1-based
  const etDay0  = nowET.getUTCDate();
  const etDow0  = nowET.getUTCDay();       // 0=Sun … 6=Sat

  const slotsToInsert: { providerId: string; datetime: Date }[] = [];

  for (let offset = 0; offset < days; offset++) {
    // Advance the ET calendar date without touching the server's local TZ
    const dayUTC  = new Date(Date.UTC(etYear0, etMon0 - 1, etDay0 + offset));
    const etYear  = dayUTC.getUTCFullYear();
    const etMonth = dayUTC.getUTCMonth() + 1;
    const etDay   = dayUTC.getUTCDate();
    const etDow   = (etDow0 + offset) % 7;

    if (etDow === 0 || etDow === 6) continue; // skip weekends

    for (const { hour, minute } of SLOT_TIMES) {
      const utc = slotUTC(etYear, etMonth, etDay, hour, minute);
      if (utc.getTime() <= now.getTime() - 60_000) continue; // skip past slots
      slotsToInsert.push({ providerId, datetime: utc });
    }
  }

  if (slotsToInsert.length === 0) return 0;

  const result = await prisma.availability.createMany({
    data:           slotsToInsert,
    skipDuplicates: true,
  });

  return result.count;
}

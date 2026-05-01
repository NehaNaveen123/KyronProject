/**
 * Seed script — creates 5 doctors and generates availability slots.
 *
 * Slot rules (spec):
 *   - Weekdays only (Mon–Fri)
 *   - Hours: 9:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00
 *   - Minutes and seconds always 0 — strictly 1-hour increments
 *   - 45 days ahead
 *
 * Run: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import { addDays, setHours, setMinutes, setSeconds, setMilliseconds, isWeekend, startOfDay } from 'date-fns';

const prisma = new PrismaClient();

// Single source of truth for valid slot hours — backend and admin both import this
export const VALID_SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

const DOCTORS = [
  { name: 'Dr. Sarah Chen',     specialty: 'Cardiology'   },
  { name: 'Dr. Michael Torres', specialty: 'Dermatology'  },
  { name: 'Dr. Priya Patel',    specialty: 'Dentistry'    },
  { name: 'Dr. Emily Johnson',  specialty: 'Orthopedics'  },
  { name: 'Dr. David Kim',      specialty: 'Neurology'    },
];

/** Returns a Date snapped to exact hour — no minutes, seconds, or milliseconds. */
function slotDatetime(day: Date, hour: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(day, hour), 0), 0), 0);
}

async function main() {
  console.log('Seeding database…');

  await prisma.appointment.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.doctor.deleteMany();

  const doctors = await Promise.all(DOCTORS.map(d => prisma.doctor.create({ data: d })));
  console.log(`Created ${doctors.length} doctors`);

  const today = startOfDay(new Date());
  const slots: { doctorId: string; datetime: Date }[] = [];

  for (let dayOffset = 0; dayOffset <= 45; dayOffset++) {  // 0 = today
    const day = addDays(today, dayOffset);
    if (isWeekend(day)) continue;

    for (const doctor of doctors) {
      for (const hour of VALID_SLOT_HOURS) {
        slots.push({ doctorId: doctor.id, datetime: slotDatetime(day, hour) });
      }
    }
  }

  await prisma.availability.createMany({ data: slots });
  console.log(`Created ${slots.length} slots (${VALID_SLOT_HOURS.length} per doctor per weekday)`);
  console.log('Seed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

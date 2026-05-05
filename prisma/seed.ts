/**
 * Seed script — creates three demo organizations with providers and availability slots.
 *
 * Organizations seeded:
 *   1. Kyron Demo Clinic       — multi-specialty primary care (original demo)
 *   2. Valley Family Medicine  — family medicine + pediatrics, strict new-patient rules
 *   3. Coastal Dermatology     — dermatology-only boutique clinic, Fri blackout + lunch buffer
 *
 * Slot rules (spec):
 *   - Weekdays only (Mon–Fri)
 *   - Hours: 9:00–17:00 (9 slots per provider per day)
 *   - 45 days ahead
 *
 * Run: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { addDays, setHours, setMinutes, setSeconds, setMilliseconds, isWeekend, startOfDay } from 'date-fns';

const prisma = new PrismaClient();

export const VALID_SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

function slotDatetime(day: Date, hour: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(day, hour), 0), 0), 0);
}

// ─── Org 1: Kyron Demo Clinic ─────────────────────────────────────────────────

const DEMO_ORG = {
  name:          'Kyron Demo Clinic',
  slug:          'kyron-demo',
  address:       '100 Medical Center Dr, Springfield, IL 62701',
  phone:         '(555) 123-4567',
  adminEmail:    'admin@kyron-demo.com',
  adminPassword: 'demo1234',
  hours: {
    monday:    { open: '09:00', close: '17:00', closed: false },
    tuesday:   { open: '09:00', close: '17:00', closed: false },
    wednesday: { open: '09:00', close: '17:00', closed: false },
    thursday:  { open: '09:00', close: '17:00', closed: false },
    friday:    { open: '09:00', close: '17:00', closed: false },
    saturday:  { open: '09:00', close: '17:00', closed: true  },
    sunday:    { open: '09:00', close: '17:00', closed: true  },
  },
};

const DEMO_PROVIDERS = [
  { name: 'Dr. Sarah Chen',     credentials: 'MD, FACC',      specialties: ['Cardiology'] },
  { name: 'Dr. Michael Torres', credentials: 'MD, FAAD',      specialties: ['Dermatology'] },
  { name: 'Dr. Priya Patel',    credentials: 'DDS',           specialties: ['Dentistry'] },
  { name: 'Dr. Emily Johnson',  credentials: 'MD, FAAOS',     specialties: ['Orthopedics'] },
  { name: 'Dr. David Kim',      credentials: 'MD, PhD, FAAN', specialties: ['Neurology'] },
];

// ─── Org 2: Valley Family Medicine ───────────────────────────────────────────
// Showcases: new_patient_days rule (Mon/Wed/Fri only), 2-hour min booking window,
// and weekend Saturday morning hours.

const VALLEY_ORG = {
  name:          'Valley Family Medicine',
  slug:          'valley-family',
  address:       '420 Oak Valley Rd, Sacramento, CA 95814',
  phone:         '(916) 555-0101',
  adminEmail:    'admin@valley-family.com',
  adminPassword: 'valley1234',
  hours: {
    monday:    { open: '08:00', close: '18:00', closed: false },
    tuesday:   { open: '08:00', close: '18:00', closed: false },
    wednesday: { open: '08:00', close: '18:00', closed: false },
    thursday:  { open: '08:00', close: '18:00', closed: false },
    friday:    { open: '08:00', close: '17:00', closed: false },
    saturday:  { open: '09:00', close: '13:00', closed: false },
    sunday:    { open: '09:00', close: '13:00', closed: true  },
  },
  schedulingRules: [
    { type: 'min_booking_window', hours: 2, label: 'Min 2-hour advance booking' },
  ],
};

const VALLEY_PROVIDERS = [
  {
    name:        'Dr. Ana Rivera',
    credentials: 'MD, FAAFP',
    specialties: ['Family Medicine', 'Preventive Care'],
    schedulingRules: [
      { type: 'new_patient_days', days: ['monday', 'wednesday', 'friday'], label: 'New patients Mon/Wed/Fri only' },
    ],
  },
  {
    name:        'Dr. James Park',
    credentials: 'MD, FAAP',
    specialties: ['Pediatrics', 'Family Medicine'],
    schedulingRules: [
      { type: 'new_patient_days', days: ['tuesday', 'thursday'], label: 'New patients Tue/Thu only' },
      { type: 'provider_day_blackout', days: ['friday'], label: 'Dr. Park unavailable Fridays' },
    ],
  },
  {
    name:        'Dr. Linda Osei',
    credentials: 'MD, ABIM',
    specialties: ['Internal Medicine', 'Geriatrics'],
    schedulingRules: [],
  },
];

// ─── Org 3: Coastal Dermatology ───────────────────────────────────────────────
// Showcases: Friday blackout (admin day), lunch-break buffer (12:00–13:00, 30 min),
// and single-specialty boutique clinic.

const COASTAL_ORG = {
  name:          'Coastal Dermatology',
  slug:          'coastal-derm',
  address:       '1 Shoreline Blvd, Suite 300, Miami, FL 33101',
  phone:         '(305) 555-0202',
  adminEmail:    'admin@coastal-derm.com',
  adminPassword: 'coastal1234',
  hours: {
    monday:    { open: '09:00', close: '17:00', closed: false },
    tuesday:   { open: '09:00', close: '17:00', closed: false },
    wednesday: { open: '09:00', close: '17:00', closed: false },
    thursday:  { open: '09:00', close: '17:00', closed: false },
    friday:    { open: '09:00', close: '17:00', closed: true  },
    saturday:  { open: '09:00', close: '17:00', closed: true  },
    sunday:    { open: '09:00', close: '17:00', closed: true  },
  },
  schedulingRules: [
    { type: 'day_blackout',      days: ['friday'],               label: 'Clinic closed Fridays (admin day)' },
    { type: 'time_buffer',       windowStart: '12:00', windowEnd: '13:00', bufferMinutes: 30, label: 'Lunch break' },
    { type: 'min_booking_window',hours: 4,                        label: '4-hour advance notice required' },
  ],
};

const COASTAL_PROVIDERS = [
  {
    name:        'Dr. Sofia Martínez',
    credentials: 'MD, FAAD',
    specialties: ['Dermatology', 'Cosmetic Dermatology'],
    schedulingRules: [
      { type: 'new_patient_days', days: ['monday', 'wednesday'], label: 'New patients Mon/Wed only' },
    ],
  },
  {
    name:        'Dr. Kevin Nguyen',
    credentials: 'MD, FAAD',
    specialties: ['Dermatology', 'Mohs Surgery', 'Skin Cancer'],
    schedulingRules: [],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedOrg(
  orgData: {
    name: string; slug: string; address: string; phone: string;
    adminEmail: string; adminPassword: string; hours: object;
    schedulingRules?: object[];
  },
  providerData: {
    name: string; credentials: string; specialties: string[]; schedulingRules?: object[];
  }[],
) {
  const hashedPw = await bcrypt.hash(orgData.adminPassword, 10);
  const org = await prisma.organization.create({
    data: {
      name:            orgData.name,
      slug:            orgData.slug,
      address:         orgData.address,
      phone:           orgData.phone,
      hours:           orgData.hours,
      adminEmail:      orgData.adminEmail,
      adminPassword:   hashedPw,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schedulingRules: (orgData.schedulingRules ?? []) as any,
    },
  });

  console.log(`\nOrg: ${org.name} (/${org.slug})`);
  console.log(`  Admin: ${orgData.adminEmail} / ${orgData.adminPassword}`);
  console.log(`  Patient URL: /org/${org.slug}`);
  console.log(`  Admin URL:   /org/${org.slug}/admin`);

  const providers = await Promise.all(
    providerData.map(p =>
      prisma.provider.create({
        data: {
          name:            p.name,
          credentials:     p.credentials,
          specialties:     p.specialties,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          schedulingRules: (p.schedulingRules ?? []) as any,
          organizationId:  org.id,
        },
      }),
    ),
  );
  console.log(`  Providers: ${providers.map(p => p.name).join(', ')}`);

  // Generate availability slots (weekdays only, 45 days)
  const today = startOfDay(new Date());
  const slots: { providerId: string; datetime: Date }[] = [];

  for (let dayOffset = 0; dayOffset <= 45; dayOffset++) {
    const day = addDays(today, dayOffset);
    if (isWeekend(day)) continue;
    for (const provider of providers) {
      for (const hour of VALID_SLOT_HOURS) {
        slots.push({ providerId: provider.id, datetime: slotDatetime(day, hour) });
      }
    }
  }

  await prisma.availability.createMany({ data: slots });
  console.log(`  Slots: ${slots.length} (${VALID_SLOT_HOURS.length}/provider/day × 45 days)`);

  return org;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database…');

  // Clear everything in dependency order
  await prisma.appointment.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.organization.deleteMany();

  await seedOrg(DEMO_ORG,    DEMO_PROVIDERS);
  await seedOrg(VALLEY_ORG,  VALLEY_PROVIDERS);
  await seedOrg(COASTAL_ORG, COASTAL_PROVIDERS);

  console.log('\n✅ Seed complete — 3 organizations ready.');
  console.log('\nQuick-start URLs:');
  console.log('  Chat (patient):  /org/kyron-demo');
  console.log('                   /org/valley-family');
  console.log('                   /org/coastal-derm');
  console.log('  Admin dashboard: /org/kyron-demo/admin     (admin@kyron-demo.com / demo1234)');
  console.log('                   /org/valley-family/admin  (admin@valley-family.com / valley1234)');
  console.log('                   /org/coastal-derm/admin   (admin@coastal-derm.com / coastal1234)');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

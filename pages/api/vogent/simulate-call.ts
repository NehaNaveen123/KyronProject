/**
 * POST /api/vogent/simulate-call
 *
 * Admin-only. Creates a mock inbound call record for an org, optionally
 * booking a real appointment, so the Call Log tab shows end-to-end data.
 *
 * - Picks a reason whose specialty matches a provider at this org.
 * - If the matched provider has no slots yet, generates them on-the-fly.
 * - Records bookingOutcome "confirmed" / "failed" / null (no matching provider).
 *
 * Body: { slug: string, bookAppointment?: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { bookAppointment } from '../../../lib/booking';
import { generateProviderSlots } from '../../../lib/providerSlots';
import { v4 as uuidv4 } from 'uuid';

const FIRST_NAMES = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Jennifer', 'William', 'Barbara'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore'];

// Reasons paired with the specialties that should handle them.
// Multiple reasons per specialty so simulations vary.
const REASONS: { text: string; specialties: string[] }[] = [
  // Cardiology
  { text: 'Chest tightness and shortness of breath',      specialties: ['Cardiology'] },
  { text: 'Heart palpitations when exercising',           specialties: ['Cardiology'] },
  { text: 'High blood pressure follow-up',                specialties: ['Cardiology', 'Internal Medicine', 'Family Medicine'] },
  { text: 'Irregular heartbeat noticed recently',         specialties: ['Cardiology'] },
  { text: 'Dizziness and lightheadedness',                specialties: ['Cardiology', 'Neurology', 'Internal Medicine'] },

  // Orthopedics / Sports Medicine
  { text: 'Knee pain after running',                      specialties: ['Orthopedics', 'Orthopedic Surgery', 'Sports Medicine'] },
  { text: 'Persistent lower back pain for 3 weeks',       specialties: ['Orthopedics', 'Orthopedic Surgery', 'Sports Medicine', 'Physical Therapy'] },
  { text: 'Shoulder pain and limited range of motion',    specialties: ['Orthopedics', 'Orthopedic Surgery', 'Sports Medicine'] },
  { text: 'Ankle sprain that has not healed',             specialties: ['Orthopedics', 'Sports Medicine'] },

  // Dermatology
  { text: 'Skin rash on forearm, itchy and spreading',    specialties: ['Dermatology'] },
  { text: 'Acne that has worsened over the past month',   specialties: ['Dermatology'] },
  { text: 'Mole that changed color and size',             specialties: ['Dermatology'] },
  { text: 'Dry, flaky patches on scalp and face',         specialties: ['Dermatology'] },

  // Neurology
  { text: 'Migraine headaches two to three times a week', specialties: ['Neurology', 'Family Medicine', 'Internal Medicine'] },
  { text: 'Numbness and tingling in hands and feet',      specialties: ['Neurology'] },
  { text: 'Memory lapses and difficulty concentrating',   specialties: ['Neurology', 'Psychiatry'] },

  // General / Family / Internal Medicine
  { text: 'Annual checkup and routine blood work',        specialties: ['Family Medicine', 'Internal Medicine', 'General Practice', 'Primary Care'] },
  { text: 'Follow-up on recent lab results',              specialties: ['Family Medicine', 'Internal Medicine', 'General Practice', 'Primary Care'] },
  { text: 'New patient consultation',                     specialties: ['Family Medicine', 'Internal Medicine', 'General Practice', 'Primary Care'] },
  { text: 'Persistent fatigue and low energy',            specialties: ['Family Medicine', 'Internal Medicine', 'General Practice', 'Primary Care'] },

  // Psychiatry / Psychology
  { text: 'Anxiety and difficulty sleeping',              specialties: ['Psychiatry', 'Psychology', 'Family Medicine', 'Internal Medicine'] },
  { text: 'Persistent low mood and loss of motivation',   specialties: ['Psychiatry', 'Psychology'] },

  // Dentistry
  { text: 'Routine dental cleaning and exam',             specialties: ['Dentistry', 'Dental'] },
  { text: 'Tooth pain and sensitivity to cold',           specialties: ['Dentistry', 'Dental'] },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomPhone(): string {
  return `+1650${Math.floor(1000000 + Math.random() * 9000000)}`;
}

function randomDob(): string {
  const year  = 1950 + Math.floor(Math.random() * 55);
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const day   = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  return `${month}/${day}/${year}`;
}

function buildTranscript(
  patientName:  string,
  providerName: string | null,
  specialty:    string,
  slotDisplay:  string | null,
  reason:       string,
): string {
  const [first] = patientName.split(' ');
  const lines = [
    `Agent: Thank you for calling. I'm the scheduling assistant. How can I help you today?`,
    `Patient: Hi, I need to book an appointment for ${reason.toLowerCase()}.`,
    `Agent: Of course! I can help you with that. Could I get your full name?`,
    `Patient: It's ${patientName}.`,
    `Agent: Thank you, ${first}. And your date of birth?`,
    `Patient: It's ${randomDob()}.`,
    `Agent: Great. What's the best phone number to reach you?`,
    `Patient: You can use the number I'm calling from.`,
    `Agent: And an email address for your confirmation?`,
    `Patient: Sure, it's ${first.toLowerCase()}@example.com.`,
  ];

  if (providerName && slotDisplay) {
    lines.push(
      `Agent: I'm looking for a ${specialty} provider for you. I have ${providerName} available on ${slotDisplay}. Does that work for you?`,
      `Patient: Yes, that works perfectly.`,
      `Agent: You are booked with ${providerName} on ${slotDisplay}. You'll receive a confirmation email shortly. Is there anything else I can help you with?`,
      `Patient: No, that's everything. Thank you!`,
      `Agent: You're welcome, ${first}. We look forward to seeing you. Have a great day!`,
    );
  } else if (providerName) {
    // Provider exists but no slot was available
    lines.push(
      `Agent: I checked and unfortunately ${providerName} doesn't have any openings in the next 7 days for ${specialty}. Would you like me to check back in another week, or is there anything else I can help with?`,
      `Patient: I'll try calling back later. Thank you.`,
      `Agent: Of course, ${first}. Have a great day!`,
    );
  } else {
    // No matching provider at all
    lines.push(
      `Agent: I checked our providers and unfortunately we don't currently have a ${specialty} specialist at this location. I'd be happy to take a message for the front desk who can refer you.`,
      `Patient: Oh I see. I'll look for another clinic then.`,
      `Agent: Of course, ${first}. I'm sorry we couldn't help today. Have a great day!`,
    );
  }

  return lines.join('\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, bookAppointment: shouldBook = true } = req.body as { slug?: string; bookAppointment?: boolean };
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  const org = await prisma.organization.findUnique({
    where:  { slug },
    select: { id: true, name: true, vogentAgentId: true, providers: { select: { id: true, name: true, specialties: true } } },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const firstName    = pick(FIRST_NAMES);
  const lastName     = pick(LAST_NAMES);
  const patientName  = `${firstName} ${lastName}`;
  const patientDob   = randomDob();
  const patientPhone = randomPhone();
  const patientEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;

  const dialId  = `mock-${uuidv4()}`;
  const agentId = org.vogentAgentId ?? `mock-agent-${org.id.slice(0, 8)}`;

  // Collect all specialties at this org (lowercase for matching)
  const orgSpecialtySet = new Set(
    org.providers.flatMap(p => p.specialties.map(s => s.toLowerCase())),
  );

  // Shuffle reasons and pick one whose specialty exists at this org.
  // Fall back to any reason if the org has no matching specialty.
  const shuffledReasons = shuffle(REASONS);
  const matchedReasons  = shuffledReasons.filter(r =>
    r.specialties.some(s => orgSpecialtySet.has(s.toLowerCase())),
  );
  const chosenReason = matchedReasons[0] ?? shuffledReasons[0];
  const reason       = chosenReason.text;

  // Find the provider who covers this reason's specialty
  const matchedProvider = org.providers.find(p =>
    p.specialties.some(s =>
      chosenReason.specialties.some(cs => cs.toLowerCase() === s.toLowerCase()),
    ),
  ) ?? null;

  let appointmentId:  string | undefined;
  let bookedSlotTime: Date   | undefined;
  let slotDisplay:    string | null = null;
  const providerName = matchedProvider?.name ?? null;
  const specialty    = matchedProvider?.specialties[0] ?? chosenReason.specialties[0] ?? 'General Medicine';

  if (shouldBook && matchedProvider) {
    // Ensure this provider has future availability — generate if missing
    const existingSlot = await prisma.availability.findFirst({
      where:  { providerId: matchedProvider.id, isBooked: false, datetime: { gt: new Date() } },
      select: { id: true },
    });

    if (!existingSlot) {
      await generateProviderSlots(matchedProvider.id, 14); // 2 weeks
    }

    // Find the first available slot
    const slot = await prisma.availability.findFirst({
      where:   { providerId: matchedProvider.id, isBooked: false, datetime: { gt: new Date() } },
      orderBy: { datetime: 'asc' },
      select:  { id: true, datetime: true },
    });

    if (slot) {
      const result = await bookAppointment({
        slotId:       slot.id,
        doctorId:     matchedProvider.id,
        datetime:     slot.datetime.toISOString(),
        patientName,
        firstName,
        lastName,
        patientDob,
        patientPhone,
        patientEmail,
        reason,
        isNewPatient: true,
        sessionId:    `simulate-${dialId}`,
      });

      if (result.success) {
        appointmentId  = result.appointmentId;
        slotDisplay    = result.formatted;
        bookedSlotTime = slot.datetime;
      }
    }
  }

  const bookingOutcome = appointmentId
    ? 'confirmed'
    : matchedProvider
      ? 'failed'
      : null;

  const transcript = buildTranscript(patientName, providerName, specialty, slotDisplay, reason);
  const summary    = appointmentId
    ? `Patient ${patientName} called to book a ${specialty.toLowerCase()} appointment. Reason: ${reason}. Appointment confirmed with ${providerName} for ${slotDisplay}.`
    : matchedProvider
      ? `Patient ${patientName} called about ${reason.toLowerCase()}. A ${specialty} provider exists but no slots were available.`
      : `Patient ${patientName} called about ${reason.toLowerCase()}. No ${specialty} provider is available at this clinic.`;
  const duration = 60 + Math.floor(Math.random() * 180); // 1–4 min

  const call = await prisma.vogentCall.create({
    data: {
      dialId,
      organizationId:  org.id,
      agentId,
      callerPhone:     patientPhone,
      status:          'completed',
      durationSeconds: duration,
      transcript,
      summary,
      patientName,
      patientDob,
      patientPhone,
      patientEmail,
      reason,
      appointmentId:   appointmentId ?? null,
      bookedAt:        appointmentId ? new Date() : null,
      bookingOutcome,
      scheduledTime:   bookedSlotTime ?? null,
      startedAt:       new Date(Date.now() - duration * 1000),
      endedAt:         new Date(),
    },
  });

  return res.status(200).json({
    callId:        call.id,
    patientName,
    appointmentId: appointmentId ?? null,
    phoneNumber:   patientPhone,
    duration,
  });
}

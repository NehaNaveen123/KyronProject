/**
 * POST /api/vogent/simulate-call
 *
 * Admin-only. Creates a mock inbound call record for an org, optionally
 * booking a real appointment, so the Call Log tab shows end-to-end data.
 *
 * Body: { slug: string, bookAppointment?: boolean }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { bookAppointment } from '../../../lib/booking';
import { v4 as uuidv4 } from 'uuid';

const FIRST_NAMES = ['James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'David', 'Jennifer', 'William', 'Barbara'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Moore'];
const REASONS = [
  'Annual checkup and blood pressure review',
  'Follow-up on recent lab results',
  'Persistent lower back pain for 3 weeks',
  'Skin rash on forearm, itchy and spreading',
  'Routine dental cleaning and exam',
  'Knee pain after running',
  'Migraine headaches, 2–3 times per week',
  'New patient consultation',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
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

function buildTranscript(patientName: string, providerName: string, specialty: string, slotDisplay: string, reason: string): string {
  const [first] = patientName.split(' ');
  return [
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
    `Agent: Perfect. I'm looking for ${specialty} providers for you. I have ${providerName} available on ${slotDisplay}. Does that work for you?`,
    `Patient: Yes, that works perfectly.`,
    `Agent: Great! I've booked your appointment with ${providerName} for ${slotDisplay}. You'll receive a confirmation email shortly. Is there anything else I can help you with?`,
    `Patient: No, that's everything. Thank you!`,
    `Agent: You're welcome, ${first}. We look forward to seeing you. Have a great day!`,
  ].join('\n');
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

  const firstName   = pick(FIRST_NAMES);
  const lastName    = pick(LAST_NAMES);
  const patientName = `${firstName} ${lastName}`;
  const patientDob  = randomDob();
  const patientPhone = randomPhone();
  const patientEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`;
  const reason       = pick(REASONS);

  const dialId  = `mock-${uuidv4()}`;
  const agentId = org.vogentAgentId ?? `mock-agent-${org.id.slice(0, 8)}`;

  // Try to find a real available slot and book it
  let appointmentId: string | undefined;
  let slotDisplay   = 'a convenient time';
  let providerName  = 'your provider';
  let specialty     = 'General Medicine';

  if (shouldBook && org.providers.length > 0) {
    const provider = pick(org.providers);
    providerName   = provider.name;
    specialty      = provider.specialties[0] ?? 'General Medicine';

    const slot = await prisma.availability.findFirst({
      where:   { providerId: provider.id, isBooked: false, datetime: { gt: new Date() } },
      orderBy: { datetime: 'asc' },
      select:  { id: true, datetime: true },
    });

    if (slot) {
      const sessionId = `simulate-${dialId}`;
      const result    = await bookAppointment({
        doctorId:     provider.id,
        datetime:     slot.datetime.toISOString(),
        patientName,
        firstName,
        lastName,
        patientDob,
        patientPhone,
        patientEmail,
        reason,
        isNewPatient: true,
        sessionId,
      });

      if (result.success) {
        appointmentId = result.appointmentId;
        slotDisplay   = result.formatted;
      }
    }
  }

  const transcript = buildTranscript(patientName, providerName, specialty, slotDisplay, reason);
  const summary    = `Patient ${patientName} called to book a ${specialty.toLowerCase()} appointment. Reason: ${reason}. ${appointmentId ? `Appointment confirmed with ${providerName} for ${slotDisplay}.` : 'No appointment booked.'}`;
  const duration   = 60 + Math.floor(Math.random() * 180); // 1–4 min

  const startedAt = new Date(Date.now() - duration * 1000);

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
      startedAt,
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

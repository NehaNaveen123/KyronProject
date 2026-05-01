/**
 * POST /api/chat
 *
 * Control flow (strictly in order on every request):
 *   1. Receive message, load session state
 *   2. Dispatch mid-flow states (showing_availability, confirming_booking, booked,
 *      returning_patient, confirming_cancel, rescheduling, confirming_reschedule)
 *   3. Check for returning patient (phone/email in message → DB lookup) → return if found
 *   4. Extract patient info from message, merge into state
 *   5. Log isInfoComplete() + all params
 *   6. If complete OR availability intent → getAvailability() → return (AI NOT called)
 *   7. If not complete → AI collects missing fields (no availability involved)
 *
 * HARD RULES:
 *   - Steps 6 and 7 are mutually exclusive. AI is never called when slots are fetched.
 *   - AI must never say "I'll check" — the collecting context explicitly forbids it.
 *   - getAvailability() always uses server-side new Date() for "today", never DOB.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { chat, BASE_SYSTEM_PROMPT } from '../../lib/ai';
import { getAvailability, bookAppointment, getDoctorBySpecialty } from '../../lib/booking';
import { prisma } from '../../lib/db';
import {
  emptyState,
  mapToSpecialty,
  detectTimeframe,
  isOpenTimeframe,
  extractEmail,
  extractPhone,
  extractDob,
  extractName,
  detectSlotSelection,
  isConfirmation,
  isCancellation,
  isKeepIntent,
  isRescheduleIntent,
  isCancelIntent,
  missingFields,
  isInfoComplete,
  type ConversationState,
  type TimeframeFilter,
  type ExistingAppointment,
} from '../../lib/intents';

interface StoredMessage { role: 'user' | 'assistant'; content: string; }

// ─── Availability intent keywords ─────────────────────────────────────────────
// These trigger a slot fetch even before all 6 intake fields are complete,
// provided specialty is already known.

function hasAvailabilityIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return ['when', 'today', 'tomorrow', 'available', 'come in',
          'appointment', 'schedule', 'times'].some(kw => lower.includes(kw));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionId, message } = req.body as { sessionId?: string; message?: string };
  if (!sessionId || !message?.trim()) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  const userText = message.trim();

  try {
    // ── 1. Load session state ───────────────────────────────────────────────
    const convo = await prisma.conversation.findUnique({ where: { sessionId } });
    const history: StoredMessage[] = convo
      ? (convo.messages as unknown as StoredMessage[])
      : [];
    const state: ConversationState = convo?.patientInfo
      ? (convo.patientInfo as unknown as ConversationState)
      : emptyState();

    history.push({ role: 'user', content: userText });

    // ── 2. Mid-flow dispatch ────────────────────────────────────────────────
    // Once a patient is in the funnel these states handle themselves and return
    // immediately — they never fall through to the intake path below.

    if (state.step === 'returning_patient') {
      return await handleReturningPatient(res, sessionId, history, state, userText);
    }
    if (state.step === 'confirming_cancel') {
      return await handleConfirmingCancel(res, sessionId, history, state, userText);
    }
    if (state.step === 'rescheduling') {
      return await handleRescheduling(res, sessionId, history, state, userText);
    }
    if (state.step === 'confirming_reschedule') {
      return await handleConfirmingReschedule(res, sessionId, history, state, userText);
    }
    if (state.step === 'showing_availability') {
      return await handleShowingAvailability(res, sessionId, history, state, userText);
    }
    if (state.step === 'confirming_booking') {
      return await handleConfirmingBooking(res, sessionId, history, state, userText);
    }
    if (state.step === 'booked') {
      return await respondWithAI(
        res, sessionId, history, state,
        `Appointment confirmed (ID: ${state.appointmentId}). ` +
        `Answer any follow-up questions. Remind patient of their details if asked.`,
      );
    }

    // ── 3. Returning patient check ──────────────────────────────────────────
    // Extract phone/email from this message only — never from accumulated state.
    // Server does the date math; DOB is never used here.
    const emailNow = extractEmail(userText);
    const phoneNow = extractPhone(userText);

    if (emailNow || phoneNow) {
      const existing = await prisma.appointment.findFirst({
        where: {
          OR: [
            ...(emailNow ? [{ patientEmail: emailNow }] : []),
            ...(phoneNow ? [{ patientPhone: phoneNow }] : []),
          ],
        },
        include: { doctor: { select: { id: true, name: true, specialty: true } } },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        const appt = buildExistingAppt(existing);
        state.step                = 'returning_patient';
        state.existingAppointment = appt;
        return sendDirect(res, sessionId, history, state, returningPatientMsg(appt));
      }
    }

    // ── 4. Extract patient info, merge into state ───────────────────────────
    const email     = extractEmail(userText);
    const phone     = extractPhone(userText);
    const dob       = extractDob(userText);
    const name      = extractName(userText);
    const specialty = mapToSpecialty(userText);
    const timeframe = detectTimeframe(userText);
    const openTf    = isOpenTimeframe(userText);

    if (email    && !state.patient.email)     state.patient.email    = email;
    if (phone    && !state.patient.phone)     state.patient.phone    = phone;
    if (dob      && !state.patient.dob)       state.patient.dob      = dob;
    if (name     && !state.patient.firstName) {
      state.patient.firstName = name.firstName;
      if (name.lastName) state.patient.lastName = name.lastName;
    }
    if (specialty && !state.patient.specialty) {
      state.patient.specialty = specialty;
      state.patient.reason    = userText;
    }
    if (timeframe)   state.timeframe = timeframe;
    else if (openTf) state.timeframe = null;

    // ── 5. Log isInfoComplete + all params ─────────────────────────────────
    const complete = isInfoComplete(state.patient);
    console.log('[chat] isInfoComplete:', complete, 'params:', {
      firstName: state.patient.firstName,
      lastName:  state.patient.lastName,
      dob:       state.patient.dob,
      phone:     state.patient.phone,
      email:     state.patient.email,
      specialty: state.patient.specialty,
      timeframe: state.timeframe?.label ?? null,
      serverNow: new Date().toISOString(),
    });

    // ── 6. Fetch slots (deterministic — AI NOT called) ──────────────────────
    // Triggered when info is complete OR the message asks about availability.
    // Requires specialty to call getAvailability().
    if ((complete || hasAvailabilityIntent(userText)) && state.patient.specialty) {
      return await fetchAndReturnSlots(res, sessionId, history, state);
    }

    // ── 7. Info incomplete — AI collects remaining fields ───────────────────
    // AI is explicitly forbidden from mentioning times, dates, or availability.
    if (!state.doctorName && state.patient.specialty) {
      const doc = await getDoctorBySpecialty(state.patient.specialty);
      if (doc) { state.doctorId = doc.id; state.doctorName = doc.name; }
    }

    return await respondWithAI(
      res, sessionId, history, state,
      buildCollectingContext(state.patient, state.doctorName),
    );

  } catch (err: unknown) {
    console.error('[/api/chat]', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}

// ─── Mid-flow handlers ────────────────────────────────────────────────────────

async function handleReturningPatient(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, userText: string,
): Promise<void> {
  const appt = state.existingAppointment!;

  if (isKeepIntent(userText)) {
    return sendDirect(res, sessionId, history, state,
      `Your appointment with ${appt.doctorName} on ${appt.formatted} is all set. ` +
      `Is there anything else I can help you with?`);
  }

  if (isRescheduleIntent(userText)) {
    state.step              = 'rescheduling';
    state.patient.specialty = appt.specialty;
    state.doctorId          = appt.doctorId;
    state.doctorName        = appt.doctorName;
    state.timeframe         = null;
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  if (isCancelIntent(userText)) {
    state.step = 'confirming_cancel';
    return sendDirect(res, sessionId, history, state,
      `Are you sure you want to cancel your appointment with ${appt.doctorName} ` +
      `on ${appt.formatted}? Reply "yes" to confirm or "no" to keep it.`);
  }

  return sendDirect(res, sessionId, history, state, returningPatientMsg(appt));
}

async function handleConfirmingCancel(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, userText: string,
): Promise<void> {
  const appt = state.existingAppointment!;

  if (isConfirmation(userText)) {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.delete({ where: { id: appt.id } });
      await tx.availability.updateMany({
        where: { doctorId: appt.doctorId, datetime: new Date(appt.datetime) },
        data:  { isBooked: false },
      });
    });
    state.step                = 'collecting_info';
    state.existingAppointment = null;
    return sendDirect(res, sessionId, history, state,
      `Your appointment with ${appt.doctorName} on ${appt.formatted} has been cancelled. ` +
      `If you'd like to schedule a new appointment, just let me know.`);
  }

  state.step = 'returning_patient';
  return sendDirect(res, sessionId, history, state, returningPatientMsg(appt));
}

async function handleRescheduling(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, userText: string,
): Promise<void> {
  if (isCancellation(userText)) {
    state.step = 'returning_patient';
    return sendDirect(res, sessionId, history, state, returningPatientMsg(state.existingAppointment!));
  }

  const timeframe = detectTimeframe(userText);
  const openTf    = isOpenTimeframe(userText);
  if (timeframe)   state.timeframe = timeframe;
  else if (openTf) state.timeframe = null;

  const slotIdx = detectSlotSelection(userText, state.slots);
  if (slotIdx !== null) {
    state.selectedSlot = state.slots[slotIdx];
    state.step         = 'confirming_reschedule';
    return sendDirect(res, sessionId, history, state,
      `To confirm: reschedule your appointment with ${state.doctorName} ` +
      `to ${state.selectedSlot.formatted}?\n\n` +
      `Reply "yes" to confirm or "no" to see other times.`);
  }

  // New timeframe or no selection yet — re-fetch
  if (timeframe || openTf || state.slots.length === 0) {
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  return sendDirect(res, sessionId, history, state,
    formatSlotsMessage(state.doctorName!, state.slots, state.timeframe));
}

async function handleConfirmingReschedule(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, userText: string,
): Promise<void> {
  const appt = state.existingAppointment!;

  if (isCancellation(userText)) {
    state.step         = 'rescheduling';
    state.selectedSlot = null;
    return sendDirect(res, sessionId, history, state,
      formatSlotsMessage(state.doctorName!, state.slots, state.timeframe));
  }

  if (isConfirmation(userText)) {
    await prisma.$transaction(async (tx) => {
      await tx.appointment.delete({ where: { id: appt.id } });
      await tx.availability.updateMany({
        where: { doctorId: appt.doctorId, datetime: new Date(appt.datetime) },
        data:  { isBooked: false },
      });
    });

    const result = await bookAppointment({
      patientName:  appt.patientName,
      patientDob:   appt.patientDob,
      patientPhone: appt.patientPhone,
      patientEmail: appt.patientEmail,
      reason:       appt.reason,
      doctorId:     state.doctorId!,
      datetime:     state.selectedSlot!.datetime,
      sessionId,
    });

    if ('appointmentId' in result) {
      state.step          = 'booked';
      state.appointmentId = result.appointmentId;
      return sendDirect(res, sessionId, history, state,
        `Your appointment has been rescheduled!\n\n` +
        `  Doctor: ${result.doctorName}\n` +
        `  Time:   ${result.formatted}\n\n` +
        `Is there anything else I can help you with?`);
    }

    // Slot taken — re-fetch fresh options
    state.step         = 'rescheduling';
    state.selectedSlot = null;
    state.timeframe    = null;
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  return sendDirect(res, sessionId, history, state,
    `Shall I reschedule your appointment with ${state.doctorName} ` +
    `to ${state.selectedSlot!.formatted}? Reply "yes" to confirm or "no" to see other times.`);
}

async function handleShowingAvailability(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, userText: string,
): Promise<void> {
  const timeframe = detectTimeframe(userText);
  const openTf    = isOpenTimeframe(userText);

  if (timeframe || openTf) {
    if (timeframe)   state.timeframe = timeframe;
    else if (openTf) state.timeframe = null;
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  const slotIdx = detectSlotSelection(userText, state.slots);
  if (slotIdx !== null) {
    state.selectedSlot = state.slots[slotIdx];
    state.step         = 'confirming_booking';
    return await respondWithAI(res, sessionId, history, state, buildConfirmContext(state));
  }

  if (isCancellation(userText)) {
    state.timeframe = null;
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  return sendDirect(res, sessionId, history, state,
    formatSlotsMessage(state.doctorName!, state.slots, state.timeframe));
}

async function handleConfirmingBooking(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, userText: string,
): Promise<void> {
  if (isCancellation(userText)) {
    state.selectedSlot = null;
    state.step         = 'showing_availability';
    state.timeframe    = null;
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  if (isConfirmation(userText)) {
    const result = await bookAppointment({
      patientName:  `${state.patient.firstName} ${state.patient.lastName}`,
      patientDob:   state.patient.dob!,
      patientPhone: state.patient.phone!,
      patientEmail: state.patient.email!,
      reason:       state.patient.reason ?? state.patient.specialty ?? 'General visit',
      doctorId:     state.doctorId!,
      datetime:     state.selectedSlot!.datetime,
      sessionId,
    });

    if (result.success) {
      state.step          = 'booked';
      state.appointmentId = result.appointmentId!;
      return sendDirect(res, sessionId, history, state,
        formatBookedMessage(result.doctorName!, result.formatted!, state.patient.firstName!));
    }

    // Slot was taken — re-fetch fresh options
    state.selectedSlot = null;
    state.step         = 'showing_availability';
    state.timeframe    = null;
    return await fetchAndReturnSlots(res, sessionId, history, state);
  }

  return await respondWithAI(res, sessionId, history, state,
    buildConfirmContext(state) +
    '\n\nPatient has not confirmed or declined. Ask again: "Shall I go ahead and confirm this appointment?"');
}

// ─── Slot fetch (deterministic — AI never called here) ────────────────────────

async function fetchAndReturnSlots(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState,
): Promise<void> {
  const specialty = state.patient.specialty!;

  console.log('[chat] getAvailability params:', {
    specialty,
    timeframe: state.timeframe ?? null,
    serverNow: new Date().toISOString(),
  });

  const avail = await getAvailability(specialty, state.timeframe ?? undefined);

  state.doctorId   = avail.doctorId;
  state.doctorName = avail.doctorName;
  state.step       = 'showing_availability';

  if (avail.slots.length === 0) {
    const label     = state.timeframe?.label ?? null;
    state.timeframe = null;

    const msg = label === 'today'
      ? `There are no available appointments today with ${avail.doctorName}. Would you like to check tomorrow or later this week?`
      : label
        ? `There are no available appointments for ${label} with ${avail.doctorName}. Would you like to try a different day or week?`
        : `There are currently no available appointments with ${avail.doctorName}. Please call (555) 123-4567 or try a different timeframe.`;

    return sendDirect(res, sessionId, history, state, msg);
  }

  state.slots = avail.slots;
  return sendDirect(res, sessionId, history, state,
    formatSlotsMessage(avail.doctorName, avail.slots, state.timeframe));
}

// ─── AI dispatch (conversational steps only — never for slot display) ─────────

async function respondWithAI(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, context: string,
): Promise<void> {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}

---
## SCHEDULING CONTEXT (guide your response with this — never repeat verbatim)

${context}
---`;

  const rawReply = await chat(systemPrompt, history);
  const reply    = guardAvailabilityResponse(rawReply, state);
  return sendDirect(res, sessionId, history, state, reply);
}

// ─── Persist & respond ────────────────────────────────────────────────────────

async function sendDirect(
  res: NextApiResponse, sessionId: string, history: StoredMessage[],
  state: ConversationState, reply: string,
): Promise<void> {
  history.push({ role: 'assistant', content: reply });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.conversation.upsert({
    where:  { sessionId },
    create: { sessionId, messages: history as any, patientInfo: state as any },
    update: { messages: history as any, patientInfo: state as any },
  });
  res.status(200).json({ message: reply, sessionId });
}

// ─── Guardrail ────────────────────────────────────────────────────────────────

function guardAvailabilityResponse(reply: string, state: ConversationState): string {
  const timeRe  = /\b(\d{1,2}:\d{2})\s*(AM|PM)\b/gi;
  const matches = [...reply.matchAll(timeRe)];
  if (matches.length === 0) return reply;

  // collecting_info: AI must never mention a time
  if (state.step === 'collecting_info' || state.step === 'awaiting_timeframe') {
    console.warn('[guardrail] AI hallucinated time during intake — stripping');
    return reply.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

  // confirming_booking: only the selected slot's time is valid
  if (state.step === 'confirming_booking' && state.selectedSlot) {
    const slotTime = state.selectedSlot.time.toUpperCase();
    const bad = matches.find(m => `${m[1]} ${m[2].toUpperCase()}` !== slotTime);
    if (bad) {
      console.warn(`[guardrail] wrong time in confirm ("${bad[0]}") → replacing with "${state.selectedSlot.time}"`);
      return reply.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi, state.selectedSlot.time);
    }
  }

  return reply;
}

// ─── Deterministic formatters ─────────────────────────────────────────────────

function formatSlotList(slots: ConversationState['slots']): string {
  return slots.slice(0, 10).map((s, i) => `${i + 1}. ${s.formatted}`).join('\n');
}

function formatSlotsMessage(
  doctorName: string,
  slots: ConversationState['slots'],
  timeframe: TimeframeFilter | null | undefined,
): string {
  const tfNote = timeframe?.label ? ` for ${timeframe.label}` : '';
  return (
    `Here are the available appointments with ${doctorName}${tfNote}:\n\n` +
    `${formatSlotList(slots)}\n\n` +
    `Which works best for you? Please reply with the number.`
  );
}

function formatBookedMessage(doctorName: string, formatted: string, firstName: string): string {
  return (
    `Your appointment has been confirmed, ${firstName}!\n\n` +
    `  Doctor: ${doctorName}\n` +
    `  Time:   ${formatted}\n\n` +
    `You'll receive a reminder before your visit. ` +
    `If you need to make changes, please call (555) 123-4567. ` +
    `Is there anything else I can help you with?`
  );
}

// ─── Returning patient helpers ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildExistingAppt(row: any): ExistingAppointment {
  const dt   = new Date(row.datetime);
  const day  = dt.toLocaleDateString('en-US', { weekday: 'long' });
  const mm   = String(dt.getMonth() + 1).padStart(2, '0');
  const dd   = String(dt.getDate()).padStart(2, '0');
  let h      = dt.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;

  return {
    id:           row.id,
    doctorId:     row.doctorId,
    doctorName:   row.doctor.name,
    specialty:    row.doctor.specialty,
    formatted:    `${day} (${mm}/${dd}) at ${h}:00 ${ampm}`,
    datetime:     row.datetime.toISOString(),
    patientName:  row.patientName,
    patientDob:   row.patientDob,
    patientPhone: row.patientPhone,
    patientEmail: row.patientEmail,
    reason:       row.reason,
  };
}

function returningPatientMsg(appt: ExistingAppointment): string {
  const firstName = appt.patientName.split(' ')[0];
  return (
    `Welcome back, ${firstName}! I found your existing appointment:\n\n` +
    `  Doctor: ${appt.doctorName} (${appt.specialty})\n` +
    `  Time:   ${appt.formatted}\n\n` +
    `What would you like to do?\n` +
    `  1. Keep my appointment\n` +
    `  2. Reschedule\n` +
    `  3. Cancel`
  );
}

// ─── AI context builders (collecting_info and confirming_booking only) ─────────

function buildCollectingContext(p: ConversationState['patient'], doctorName: string | null): string {
  const collected: string[] = [];
  const missing = missingFields(p);

  if (p.firstName)  collected.push(`First name: ${p.firstName}`);
  if (p.lastName)   collected.push(`Last name: ${p.lastName}`);
  if (p.dob)        collected.push(`Date of birth: ${p.dob}`);
  if (p.phone)      collected.push(`Phone: ${p.phone}`);
  if (p.email)      collected.push(`Email: ${p.email}`);
  if (doctorName)       collected.push(`Doctor (from database): ${doctorName} — use this exact name`);
  else if (p.specialty) collected.push(`Specialty: ${p.specialty}`);

  return [
    collected.length
      ? `Collected so far:\n${collected.map(s => `  ✓ ${s}`).join('\n')}`
      : 'No patient info collected yet.',
    missing.length
      ? `\nStill needed: ${missing.join(', ')}. Ask for 1–2 at a time.`
      : '',
    `\n⚠ ABSOLUTE RULES:\n` +
    `  - Doctor name: ${doctorName ? `"${doctorName}"` : '(not yet assigned — do not mention any name)'}.\n` +
    `  - Do NOT mention any appointment times, dates, or availability — not even to say you will check them.\n` +
    `  - Do NOT say "I'll look into that", "let me check", or any phrase that implies looking up times.\n` +
    `  - ONLY ask for the missing fields listed above. Nothing else.`,
  ].join('');
}

function buildConfirmContext(state: ConversationState): string {
  const p = state.patient;
  return `Patient selected a slot. Ask them to confirm these exact details:

  Patient:     ${p.firstName} ${p.lastName}
  DOB:         ${p.dob}
  Phone:       ${p.phone}
  Email:       ${p.email}
  Doctor:      ${state.doctorName} (${p.specialty})
  Appointment: ${state.selectedSlot!.formatted}

Ask: "Shall I go ahead and confirm this appointment?"`;
}

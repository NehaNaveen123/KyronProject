/**
 * Vogent API client — handles agent creation and phone number provisioning.
 *
 * Vogent docs reference:
 *   POST /api/agents              — create an agent
 *   GET  /api/phone_numbers/search — find available numbers
 *   POST /api/phone_numbers/purchase — buy a number
 *   PUT  /api/phone_numbers/{id}  — link number to agent
 */

import type { OrgSchedulingRule, ProviderSchedulingRule } from './rules';

const BASE = 'https://api.vogent.ai/api';

function headers() {
  const key = process.env.VOGENT_API_KEY;
  if (!key) throw new Error('VOGENT_API_KEY is not set in environment variables');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

async function vogentFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vogent API error ${res.status} on ${path}: ${body}`);
  }
  return res.json();
}

// ─── System prompt builder ────────────────────────────────────────────────────

export interface OrgContext {
  name:        string;
  slug:        string;
  address:     string;
  phone:       string;
  providers:   { name: string; credentials: string; specialties: string[]; schedulingRules: ProviderSchedulingRule[] }[];
  orgRules:    OrgSchedulingRule[];
}

export function buildVogentSystemPrompt(org: OrgContext): string {
  const providerList = org.providers
    .map(p => `  • ${p.name} (${p.credentials}) — ${p.specialties.join(', ')}`)
    .join('\n');

  const ruleDescriptions = org.orgRules.map(r => {
    if (r.type === 'min_booking_window')
      return `  • Appointments must be booked at least ${r.hours} hour(s) in advance.`;
    if (r.type === 'day_blackout')
      return `  • No appointments on: ${r.days.join(', ')}.`;
    if (r.type === 'time_buffer')
      return `  • A ${r.bufferMinutes}-minute buffer applies around ${r.windowStart}–${r.windowEnd}.`;
    return '';
  }).filter(Boolean).join('\n');

  return `You are an AI scheduling assistant for ${org.name}, a medical practice located at ${org.address}.

Your job is to help patients book appointments over the phone. You must never give medical advice.

## Providers at this practice:
${providerList}

## Scheduling rules:
${ruleDescriptions || '  • No special restrictions.'}

## Appointment intake — collect in this order before doing anything else:
1. Patient's full name (first and last)
2. Date of birth (MM/DD/YYYY)
3. Phone number
4. Email address
5. Reason for visit (1–2 sentences — do NOT ask for a diagnosis)
6. Desired specialty or provider

## Specialty matching — use ONLY the specialty names listed above:
Map what the patient describes to the closest specialty on the list. Examples:
- Knee pain, back pain, joint issues, fractures → use "Orthopedics" (or the orthopedic specialty shown above)
- Heart, chest tightness, blood pressure → use "Cardiology"
- Skin rash, acne, moles → use "Dermatology"
- Teeth, dental cleaning → use "Dentistry"
- Anxiety, depression, mental health → use "Psychiatry" or "Psychology"
- Checkup, annual physical, general concerns → use "Family Medicine" or "Internal Medicine"
Always call get_availability with a specialty name, never with a symptom description.

## CRITICAL BOOKING RULES — follow exactly:
1. Call get_availability FIRST. Do NOT mention any specific time or provider until you have the tool response.
2. The tool returns a "recommendedSlot". Offer that exact slot to the patient:
   "I have [display time] with [providerName] available. Does that work for you?"
3. If the patient agrees, call book_appointment with the slotId, providerId, datetime, and all collected patient info.
4. Wait for the book_appointment response before speaking.
5. ONLY if the response contains confirmed: true, say:
   "You are booked with [providerName] on [scheduledTime]. A confirmation email has been sent to [email]."
   Use the EXACT time from scheduledTime — do not paraphrase or invent a time.
6. If confirmed is false or you receive any error, say:
   "I'm not seeing availability right now — let me offer some alternatives."
   Then check alternativeSlots from the get_availability response, or call get_availability again.
   DO NOT say the appointment is booked unless confirmed is true.

## If no slots are available:
Say: "I'm not seeing any availability for [specialty] in the next week. Would you like me to check a different specialty, or can I take a message for the front desk?"

## Tone:
- Friendly, professional, concise.
- Spell out times naturally: "Tuesday, May sixth at ten thirty AM".
- End the call by repeating the confirmed appointment details and wishing the patient well.

## Safety:
- Never suggest diagnoses or treatments.
- If a patient describes a medical emergency, instruct them to call 911 immediately.`;
}

// ─── Vogent resource IDs (verified against live API) ─────────────────────────
// Voice: Emily (csm, standard)
const VOICE_ID    = '94c32748-865f-42e1-bb1a-3a6b4abc7d11';
// Model: Llama 3.3 70b Groq
const AI_MODEL_ID = '387ba6dd-9a44-464c-99f0-660af50f008d';

// ─── Agent creation ───────────────────────────────────────────────────────────

const TOOL_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function createVogentAgent(org: OrgContext): Promise<string> {
  const systemPrompt = buildVogentSystemPrompt(org);

  // Actual Vogent CreateAgentInput schema (confirmed against live API):
  //   defaultVoiceId              — voice UUID (top-level)
  //   defaultVersionedPrompt      — object with: name, prompt, aiModelId, agentType,
  //                                 and optionally linkedFunctionDefinitions
  const body = {
    name:           `${org.name} Scheduler`,
    defaultVoiceId: VOICE_ID,
    defaultVersionedPrompt: {
      name:        'v1',
      prompt:      systemPrompt,
      aiModelId:   AI_MODEL_ID,
      agentType:   'STANDARD',
      modelOptions: { max_tokens: 2000, temperature: 0.7 },
      linkedFunctionDefinitions: [
        {
          name:        'get_availability',
          description: 'Look up available appointment slots for a given specialty. Returns a recommendedSlot (offer this to the patient first) and alternativeSlots. Always call this before mentioning any times.',
          parameters: {
            type: 'object',
            properties: {
              specialty:    { type: 'string',  description: 'Medical specialty name exactly as listed in the system prompt (e.g. "Orthopedics", "Cardiology"). Map patient symptoms to a specialty name before calling.' },
              isNewPatient: { type: 'boolean', description: 'True if patient has never visited this practice' },
            },
            required: ['specialty'],
          },
          url: `${TOOL_BASE_URL}/api/vogent/tool/availability?orgSlug=${org.slug}`,
        },
        {
          name:        'book_appointment',
          description: 'Book a specific appointment slot that the patient has verbally confirmed. Returns { confirmed: true/false, scheduledTime, providerName, message }. Only tell the patient they are booked if confirmed is true. Use the exact scheduledTime and providerName from the response.',
          parameters: {
            type: 'object',
            properties: {
              slotId:       { type: 'string',  description: 'The slot id from the recommendedSlot or alternativeSlots returned by get_availability' },
              providerId:   { type: 'string',  description: 'Provider ID returned by get_availability' },
              datetime:     { type: 'string',  description: 'ISO 8601 datetime of the slot (from get_availability response)' },
              patientName:  { type: 'string',  description: 'Full name of the patient' },
              firstName:    { type: 'string',  description: 'Patient first name' },
              lastName:     { type: 'string',  description: 'Patient last name' },
              patientDob:   { type: 'string',  description: 'Date of birth (MM/DD/YYYY)' },
              patientPhone: { type: 'string',  description: 'Patient phone number' },
              patientEmail: { type: 'string',  description: 'Patient email address' },
              reason:       { type: 'string',  description: 'Reason for visit' },
              isNewPatient: { type: 'boolean', description: 'Whether this is a new patient' },
            },
            required: ['slotId', 'providerId', 'datetime', 'patientName', 'patientDob', 'patientPhone', 'patientEmail', 'reason'],
          },
          url: `${TOOL_BASE_URL}/api/vogent/tool/book?orgSlug=${org.slug}`,
        },
      ],
    },
  };

  const data = await vogentFetch('/agents', {
    method: 'POST',
    body:   JSON.stringify(body),
  });

  const agentId = data.id ?? data.agentId;
  if (!agentId) throw new Error(`Vogent agent creation returned no id: ${JSON.stringify(data)}`);
  return agentId as string;
}

// ─── Phone number provisioning ────────────────────────────────────────────────

export async function searchPhoneNumbers(areaCode: string): Promise<string[]> {
  // POST /phone_numbers/search with { prefix } — returns [{ number }]
  const results = await vogentFetch('/phone_numbers/search', {
    method: 'POST',
    body:   JSON.stringify({ prefix: areaCode }),
  }) as { number: string }[];

  if (!Array.isArray(results)) return [];
  return results.map(r => r.number);
}

export async function purchasePhoneNumber(
  areaCode = '650',
): Promise<{ phoneId: string; phoneNumber: string }> {
  const available = await searchPhoneNumbers(areaCode);

  if (available.length === 0) {
    throw new Error(`No phone numbers available for area code ${areaCode}. Try a different area code (e.g. 650 or 888).`);
  }

  // POST /phone_numbers/purchase with { number }
  const purchased = await vogentFetch('/phone_numbers/purchase', {
    method: 'POST',
    body:   JSON.stringify({ number: available[0] }),
  });

  // Response shape: { id, number, agentId, ... }
  const phoneId     = purchased.id ?? purchased.phoneId;
  const phoneNumber = purchased.number ?? purchased.phoneNumber ?? available[0];
  if (!phoneId) throw new Error(`Phone purchase returned no id: ${JSON.stringify(purchased)}`);

  return { phoneId: phoneId as string, phoneNumber: phoneNumber as string };
}

export async function linkPhoneToAgent(phoneId: string, agentId: string): Promise<void> {
  await vogentFetch(`/phone_numbers/${phoneId}`, {
    method: 'PUT',
    body:   JSON.stringify({ agentId }),
  });
}

// ─── Provisioning flows ───────────────────────────────────────────────────────

/** Step 1 — create the AI agent only (no phone purchase, always free). */
export async function provisionAgent(
  org: OrgContext,
): Promise<{ agentId: string }> {
  const agentId = await createVogentAgent(org);
  return { agentId };
}

/** Step 2a — purchase a new number and link it (requires Vogent credits). */
export async function provisionPhone(
  agentId:  string,
  areaCode = '650',
): Promise<{ phoneId: string; phoneNumber: string }> {
  const { phoneId, phoneNumber } = await purchasePhoneNumber(areaCode);
  await linkPhoneToAgent(phoneId, agentId);
  return { phoneId, phoneNumber };
}

/** Step 2b — link an existing Vogent phone number ID (no purchase needed). */
export async function linkExistingPhone(
  agentId:     string,
  phoneId:     string,
  phoneNumber: string,
): Promise<void> {
  await linkPhoneToAgent(phoneId, agentId);
  // phoneNumber is stored by the caller — just ensure the link is made
  void phoneNumber;
}

/** Legacy all-in-one flow. */
export async function provisionOrg(
  org: OrgContext,
  areaCode = '650',
): Promise<{ agentId: string; phoneId: string; phoneNumber: string }> {
  const { agentId } = await provisionAgent(org);
  const { phoneId, phoneNumber } = await provisionPhone(agentId, areaCode);
  return { agentId, phoneId, phoneNumber };
}

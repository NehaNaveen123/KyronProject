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

Your job is to help patients book, check, or cancel appointments over the phone. You must never give medical advice.

## Providers at this practice:
${providerList}

## Scheduling rules:
${ruleDescriptions || '  • No special restrictions.'}

## Appointment intake — collect in order:
1. Patient's full name
2. Date of birth (MM/DD/YYYY)
3. Phone number
4. Email address
5. Reason for visit (1–2 sentences, no diagnosis)
6. Desired specialty or provider

Once you have all information, use the get_availability function to find open slots, then use book_appointment to confirm.

## Tone:
- Friendly, professional, concise.
- Spell out times naturally: "ten AM on Tuesday May sixth".
- If no slots are available, explain briefly and offer to check a different day.
- End the call by summarizing the confirmed appointment and wishing the patient well.

## Safety:
- Never suggest diagnoses or treatments.
- If a patient describes a medical emergency, instruct them to call 911 immediately.`;
}

// ─── Agent creation ───────────────────────────────────────────────────────────

const TOOL_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function createVogentAgent(org: OrgContext): Promise<string> {
  const systemPrompt = buildVogentSystemPrompt(org);

  const body = {
    name: `${org.name} Scheduler`,
    prompt: systemPrompt,
    voice: {
      provider: 'deepgram',
      voiceId: 'aura-asteria-en',
    },
    model: {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
    },
    linkedFunctionDefinitions: [
      {
        name: 'get_availability',
        description: 'Look up available appointment slots for a given specialty.',
        parameters: {
          type: 'object',
          properties: {
            specialty: { type: 'string', description: 'Medical specialty requested (e.g. Cardiology)' },
            isNewPatient: { type: 'boolean', description: 'True if patient has never been to this practice before' },
          },
          required: ['specialty'],
        },
        url: `${TOOL_BASE_URL}/api/vogent/tool/availability?orgSlug=${org.slug}`,
      },
      {
        name: 'book_appointment',
        description: 'Book a specific appointment slot for the patient.',
        parameters: {
          type: 'object',
          properties: {
            slotId:      { type: 'string',  description: 'Availability slot ID returned by get_availability' },
            providerId:  { type: 'string',  description: 'Provider ID returned by get_availability' },
            datetime:    { type: 'string',  description: 'ISO 8601 datetime of the slot' },
            patientName: { type: 'string',  description: 'Full name of the patient' },
            firstName:   { type: 'string',  description: 'Patient first name' },
            lastName:    { type: 'string',  description: 'Patient last name' },
            patientDob:  { type: 'string',  description: 'Date of birth (MM/DD/YYYY)' },
            patientPhone:{ type: 'string',  description: 'Patient phone number' },
            patientEmail:{ type: 'string',  description: 'Patient email address' },
            reason:      { type: 'string',  description: 'Reason for visit' },
            isNewPatient:{ type: 'boolean', description: 'Whether this is a new patient' },
          },
          required: ['slotId', 'providerId', 'datetime', 'patientName', 'patientDob', 'patientPhone', 'patientEmail', 'reason'],
        },
        url: `${TOOL_BASE_URL}/api/vogent/tool/book?orgSlug=${org.slug}`,
      },
    ],
  };

  const data = await vogentFetch('/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const agentId = data.id ?? data.agentId;
  if (!agentId) throw new Error(`Vogent agent creation returned no id: ${JSON.stringify(data)}`);
  return agentId as string;
}

// ─── Phone number provisioning ────────────────────────────────────────────────

export async function purchasePhoneNumber(
  areaCode = '415',
): Promise<{ phoneId: string; phoneNumber: string }> {
  // Search for an available number
  const search = await vogentFetch(`/phone_numbers/search?areaCode=${areaCode}`);
  const available: string[] = search.numbers ?? search.availableNumbers ?? [];
  if (!available.length) {
    throw new Error(`No phone numbers available for area code ${areaCode}`);
  }

  // Purchase the first result
  const purchased = await vogentFetch('/phone_numbers/purchase', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber: available[0] }),
  });

  const phoneId = purchased.id ?? purchased.phoneNumberId;
  const phoneNumber = purchased.phoneNumber ?? purchased.number ?? available[0];
  if (!phoneId) throw new Error(`Phone purchase returned no id: ${JSON.stringify(purchased)}`);

  return { phoneId: phoneId as string, phoneNumber: phoneNumber as string };
}

export async function linkPhoneToAgent(phoneId: string, agentId: string): Promise<void> {
  await vogentFetch(`/phone_numbers/${phoneId}`, {
    method: 'PUT',
    body: JSON.stringify({ agentId }),
  });
}

// ─── Full provisioning flow ───────────────────────────────────────────────────

export async function provisionOrg(
  org: OrgContext,
  areaCode = '415',
): Promise<{ agentId: string; phoneId: string; phoneNumber: string }> {
  const agentId = await createVogentAgent(org);
  const { phoneId, phoneNumber } = await purchasePhoneNumber(areaCode);
  await linkPhoneToAgent(phoneId, agentId);
  return { agentId, phoneId, phoneNumber };
}

/**
 * Vapi voice handoff utilities (server-side).
 *
 * Vapi docs: https://docs.vapi.ai
 * We pass the full conversation history as context so the voice
 * assistant can pick up exactly where the text chat left off.
 */

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE    = 'https://api.vapi.ai';

export interface VoiceHandoffResult {
  callId?:  string;
  webUrl?:  string;  // for in-browser calls
  error?:   string;
}

/**
 * Builds the system prompt for the voice assistant, prepending
 * a summary of the chat conversation so it can resume seamlessly.
 */
export function buildVoiceSystemPrompt(conversationHistory: Array<{ role: string; content: string }>) {
  const chatSummary = conversationHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'Patient' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return `You are a medical appointment scheduling assistant continuing a conversation that started via text chat.

## Previous conversation
${chatSummary}

## Your task
Continue exactly where the text conversation left off. Do not re-introduce yourself or re-ask questions that have already been answered.

## Rules (same as text assistant)
- You schedule appointments only — no medical advice
- If asked about symptoms, treatments, or diagnoses, redirect: "I'm only able to help with scheduling. Please ask the doctor during your appointment."
- Be warm, concise, and professional

Greet the patient by referencing where you left off in the conversation.`;
}

/**
 * Creates a Vapi web call (browser-based, no phone number required).
 * Returns a token the frontend Vapi SDK uses to start the call.
 */
export async function createVapiWebCall(conversationHistory: Array<{ role: string; content: string }>) {
  const systemPrompt = buildVoiceSystemPrompt(conversationHistory);

  const response = await fetch(`${VAPI_BASE}/call/web`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      assistant: {
        name:         'Kyron Medical Scheduler',
        firstMessage: "Hi, I'm picking up from your text chat. How can I help you continue scheduling your appointment?",
        model: {
          provider: 'groq',
          model:    'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: systemPrompt }],
        },
        voice: {
          provider: '11labs',
          voiceId:  'EXAVITQu4vr4xnSDxMaL', // Sarah — warm, professional
        },
        silenceTimeoutSeconds:  30,
        maxDurationSeconds:     1800,
        backgroundSound:        'off',
        backchannelingEnabled:  false,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { error: `Vapi error: ${response.status} ${text}` };
  }

  const data = await response.json();
  return { callId: data.id, webUrl: data.webCallUrl };
}

/**
 * Creates an outbound phone call via Vapi.
 * Requires a phone number ID provisioned in your Vapi dashboard.
 */
export async function createVapiPhoneCall(
  patientPhone: string,
  conversationHistory: Array<{ role: string; content: string }>
) {
  const systemPrompt = buildVoiceSystemPrompt(conversationHistory);

  const response = await fetch(`${VAPI_BASE}/call/phone`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID, // set in dashboard
      customer:      { number: patientPhone },
      assistant: {
        name:         'Kyron Medical Scheduler',
        firstMessage: "Hello, this is the Kyron Medical scheduling assistant calling to continue helping you book an appointment. Is this a good time?",
        model: {
          provider: 'groq',
          model:    'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: systemPrompt }],
        },
        voice: {
          provider: '11labs',
          voiceId:  'EXAVITQu4vr4xnSDxMaL',
        },
        silenceTimeoutSeconds: 30,
        maxDurationSeconds:    1800,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { error: `Vapi error: ${response.status} ${text}` };
  }

  const data = await response.json();
  return { callId: data.id };
}

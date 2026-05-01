/**
 * POST /api/voice-handoff
 * Initiates a Vapi voice handoff continuing from the text chat.
 *
 * Request body: { sessionId: string, mode: 'web' | 'phone', phoneNumber?: string }
 * Response:
 *   web:   { assistantConfig: object }
 *   phone: { callId: string }
 *   error: { error: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../lib/db';
import { createVapiWebCall, createVapiPhoneCall } from '../../lib/vapi';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sessionId, mode = 'web', phoneNumber } = req.body as {
    sessionId?:   string;
    mode?:        'web' | 'phone';
    phoneNumber?: string;
  };

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  if (mode === 'phone' && !process.env.VAPI_API_KEY) {
    return res.status(503).json({ error: 'Voice service is not configured (VAPI_API_KEY missing).' });
  }

  if (mode !== 'phone' && !process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Voice service is not configured (NEXT_PUBLIC_VAPI_PUBLIC_KEY missing).' });
  }

  try {
    const conversation = await prisma.conversation.findUnique({ where: { sessionId } });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Only pass user/assistant text messages to voice context
    const history = (conversation.messages as unknown as ChatCompletionMessageParam[]).filter(
      m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    ) as Array<{ role: string; content: string }>;

    let result;
    if (mode === 'phone' && phoneNumber) {
      result = await createVapiPhoneCall(phoneNumber, history);
    } else {
      result = await createVapiWebCall(history);
    }

    if (result.error) {
      return res.status(502).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('[/api/voice-handoff]', err);
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}

/**
 * GET /api/conversation?sessionId=xxx
 * Returns visible message history for a session (used on page reload).
 * Messages are plain { role, content } objects — no tool internals to filter.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../lib/db';

interface StoredMessage { role: 'user' | 'assistant'; content: string; }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionId } = req.query;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId query param is required' });
  }

  const conversation = await prisma.conversation.findUnique({ where: { sessionId } });
  if (!conversation) return res.status(200).json({ messages: [] });

  const messages = (conversation.messages as unknown as StoredMessage[]).filter(
    m => (m.role === 'user' || m.role === 'assistant') && m.content
  );

  return res.status(200).json({ messages });
}

/**
 * POST /api/vogent/webhook
 *
 * Vogent lifecycle events — persisted to VogentCall in the DB.
 *
 * Expected events:
 *   dial.created  — new inbound call; create a VogentCall row
 *   dial.updated  — mid-call update; update transcript if present
 *   dial.ended    — call finished; store final transcript, summary, duration
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { verifyVogentSignature } from '../../../lib/vogentWebhook';

interface VogentEvent {
  event:               string;
  dialId?:             string;
  agentId?:            string;
  callerPhone?:        string;   // caller's number (E.164)
  callDurationSeconds?: number;
  transcript?:         string;
  summary?:            string;
  [key: string]: unknown;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyVogentSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body as VogentEvent;
  console.log('[vogent/webhook]', event.event, 'dialId:', event.dialId);

  try {
    switch (event.event) {
      case 'dial.created': {
        if (!event.dialId || !event.agentId) break;

        // Find which org this agent belongs to
        const org = await prisma.organization.findFirst({
          where:  { vogentAgentId: event.agentId },
          select: { id: true },
        });
        if (!org) {
          console.warn('[vogent/webhook] dial.created: no org found for agentId', event.agentId);
          break;
        }

        await prisma.vogentCall.upsert({
          where:  { dialId: event.dialId },
          create: {
            dialId:         event.dialId,
            organizationId: org.id,
            agentId:        event.agentId,
            callerPhone:    event.callerPhone ?? null,
            status:         'in_progress',
          },
          update: { agentId: event.agentId, callerPhone: event.callerPhone ?? undefined },
        });
        break;
      }

      case 'dial.updated': {
        if (!event.dialId) break;
        await prisma.vogentCall.updateMany({
          where: { dialId: event.dialId },
          data: {
            ...(event.transcript ? { transcript: event.transcript } : {}),
          },
        });
        break;
      }

      case 'dial.ended': {
        if (!event.dialId) break;

        // If we never saw dial.created (race or missed event), still create a stub row
        // We need the org — try to find by agentId
        if (event.agentId) {
          const org = await prisma.organization.findFirst({
            where:  { vogentAgentId: event.agentId },
            select: { id: true },
          });
          if (org) {
            await prisma.vogentCall.upsert({
              where:  { dialId: event.dialId },
              create: {
                dialId:          event.dialId,
                organizationId:  org.id,
                agentId:         event.agentId,
                callerPhone:     event.callerPhone ?? null,
                status:          'completed',
                durationSeconds: event.callDurationSeconds ?? null,
                transcript:      event.transcript ?? null,
                summary:         event.summary ?? null,
                endedAt:         new Date(),
              },
              update: {
                status:          'completed',
                durationSeconds: event.callDurationSeconds ?? undefined,
                transcript:      event.transcript ?? undefined,
                summary:         event.summary ?? undefined,
                endedAt:         new Date(),
              },
            });
          }
        } else {
          await prisma.vogentCall.updateMany({
            where: { dialId: event.dialId },
            data: {
              status:          'completed',
              durationSeconds: event.callDurationSeconds ?? undefined,
              transcript:      event.transcript ?? undefined,
              summary:         event.summary ?? undefined,
              endedAt:         new Date(),
            },
          });
        }
        break;
      }

      default:
        console.log('[vogent/webhook] unhandled event:', event.event);
    }
  } catch (err) {
    console.error('[vogent/webhook] DB error:', err);
    // Still return 200 so Vogent doesn't retry endlessly
  }

  return res.status(200).json({ received: true });
}

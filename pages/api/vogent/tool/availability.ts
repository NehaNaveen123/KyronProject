/**
 * POST /api/vogent/tool/availability?orgSlug=<slug>
 *
 * Vogent calls this webhook when the agent invokes get_availability.
 * We look up available slots for the requested specialty + org, then return
 * them in the format Vogent expects for function call responses.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { getAvailability } from '../../../../lib/booking';
import { verifyVogentSignature } from '../../../../lib/vogentWebhook';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Optional signature verification (skip if secret not configured)
  if (!verifyVogentSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { orgSlug } = req.query as { orgSlug: string };
  if (!orgSlug) return res.status(400).json({ error: 'orgSlug is required' });

  // Vogent wraps tool call params inside a `parameters` or `arguments` key
  const body = req.body as Record<string, unknown>;
  const params = (body.parameters ?? body.arguments ?? body) as Record<string, unknown>;
  const specialty   = (params.specialty   as string | undefined) ?? '';
  const isNewPatient = params.isNewPatient !== false; // default true

  if (!specialty) {
    return res.status(200).json({ result: 'Please specify a medical specialty.' });
  }

  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  try {
    const avail = await getAvailability(specialty, undefined, org.id, isNewPatient);

    if (avail.slots.length === 0) {
      const reasonText = avail.blockedReasons.length
        ? ' ' + avail.blockedReasons.join(' ')
        : '';
      return res.status(200).json({
        result: `No available slots found for ${specialty} in the next 7 days.${reasonText} Please ask the patient if they would like to try a different specialty or check back later.`,
      });
    }

    // Return a compact slot list so the voice agent can read them out
    const slotSummaries = avail.slots.slice(0, 5).map(s => ({
      id:        s.id,
      datetime:  s.datetime,
      display:   s.formatted,
    }));

    return res.status(200).json({
      result: {
        providerId:   avail.doctorId,
        providerName: avail.doctorName,
        specialty:    avail.specialty,
        slots:        slotSummaries,
        message:      `Found ${avail.slots.length} available slot(s) for ${avail.doctorName} (${specialty}). Here are the next available times: ${slotSummaries.map(s => s.display).join('; ')}.`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vogent/tool/availability] error:', message);
    return res.status(200).json({ result: `An error occurred while checking availability: ${message}` });
  }
}

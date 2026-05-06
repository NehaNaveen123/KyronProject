/**
 * POST /api/phone-numbers/register
 *
 * Admin-only. Registers (or re-registers) a phone number for an org.
 * Uses the configured PhoneProvider (mock by default, Vogent if PHONE_PROVIDER=vogent).
 *
 * Body: { slug: string, areaCode?: string }
 *
 * Response: { phoneNumber, type, phoneId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { getPhoneProvider } from '../../../lib/phoneProvider';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, areaCode } = req.body as { slug?: string; areaCode?: string };
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  const org = await prisma.organization.findUnique({
    where:  { slug },
    select: { id: true },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  try {
    const provider = getPhoneProvider();
    const { phoneId, phoneNumber, type } = await provider.register(org.id, { areaCode });

    // Mirror into the Organization fields so existing code (me endpoint, patient page) still works
    await prisma.organization.update({
      where: { id: org.id },
      data:  { vogentPhoneNumber: phoneNumber, vogentPhoneId: phoneId },
    });

    return res.status(200).json({ phoneId, phoneNumber, type });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[phone-numbers/register] error:', message);
    return res.status(500).json({ error: message });
  }
}

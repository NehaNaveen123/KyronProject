/**
 * GET /api/org/[slug]/phone-info — returns the PhoneNumber record for this org (admin only).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { slug } = req.query as { slug: string };
  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!org) return res.status(404).json({ error: 'Not found' });

  const phone = await prisma.phoneNumber.findUnique({ where: { organizationId: org.id } });
  if (!phone) return res.status(404).json({ error: 'No phone number registered' });

  return res.status(200).json({ type: phone.type, number: phone.number, createdAt: phone.createdAt });
}

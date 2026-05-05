/**
 * GET /api/org/[slug]/me
 * Returns the authenticated admin's org info.
 * Used by the admin dashboard to check auth state on mount.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { slug } = req.query as { slug: string };
  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  const org = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, address: true,
      phone: true, hours: true, adminEmail: true,
      vogentAgentId: true, vogentPhoneId: true, vogentPhoneNumber: true,
    },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  return res.status(200).json({ org });
}

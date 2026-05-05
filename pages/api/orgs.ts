/**
 * GET /api/orgs — public list of all organizations (name, slug, address, phone).
 * Used by the landing page to show available practices.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const orgs = await prisma.organization.findMany({
    orderBy: { name: 'asc' },
    select: {
      name:    true,
      slug:    true,
      address: true,
      phone:   true,
      vogentPhoneNumber: true,
      _count: { select: { providers: true } },
    },
  });
  return res.status(200).json({ orgs });
}

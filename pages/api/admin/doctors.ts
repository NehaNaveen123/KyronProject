/**
 * GET /api/admin/doctors
 * Returns all providers (across all orgs) with their upcoming unbooked availability count.
 * Used by the Kyron-level admin dashboard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const providers = await prisma.provider.findMany({
    include: {
      organization: { select: { name: true, slug: true } },
      availability: {
        where: { datetime: { gte: new Date() } },
        orderBy: { datetime: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Shape response to preserve the "doctors" key for backward compat with app/admin/page.tsx
  const doctors = providers.map(p => ({
    id:           p.id,
    name:         p.name,
    specialty:    p.specialties.join(', '),   // display string
    specialties:  p.specialties,
    credentials:  p.credentials,
    organization: p.organization,
    availability: p.availability,
  }));

  return res.status(200).json({ doctors });
}

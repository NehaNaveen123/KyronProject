/**
 * GET /api/admin/doctors
 * Returns all doctors with their upcoming unbooked availability count.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const doctors = await prisma.doctor.findMany({
    include: {
      availability: {
        where: { datetime: { gte: new Date() } },
        orderBy: { datetime: 'asc' },
      },
    },
    orderBy: { specialty: 'asc' },
  });

  return res.status(200).json({ doctors });
}

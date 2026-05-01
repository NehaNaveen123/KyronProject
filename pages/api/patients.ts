/**
 * GET /api/patients
 * Returns all appointments (each row = one patient booking) with doctor info.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const appointments = await prisma.appointment.findMany({
      include: { doctor: { select: { name: true, specialty: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json({ patients: appointments });
  } catch (err: unknown) {
    console.error('[/api/patients]', err);
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}

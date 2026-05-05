/**
 * GET /api/patients
 * Returns all appointments (each row = one patient booking) with provider info.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const appointments = await prisma.appointment.findMany({
      include: {
        provider: { select: { name: true, specialties: true, organization: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Shape to preserve "doctor" key so app/admin/page.tsx doesn't break
    const patients = appointments.map(a => ({
      ...a,
      doctor: {
        name:      a.provider.name,
        specialty: a.provider.specialties.join(', '),
      },
    }));

    return res.status(200).json({ patients });
  } catch (err: unknown) {
    console.error('[/api/patients]', err);
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}

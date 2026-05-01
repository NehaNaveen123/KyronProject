/**
 * DELETE /api/patients/[id]
 * Deletes the appointment and atomically frees the corresponding availability slot.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query as { id: string };

  try {
    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    const slot = await prisma.availability.findFirst({
      where: { doctorId: appointment.doctorId, datetime: appointment.datetime },
    });

    await prisma.$transaction([
      prisma.appointment.delete({ where: { id } }),
      ...(slot ? [prisma.availability.update({ where: { id: slot.id }, data: { isBooked: false } })] : []),
    ]);

    return res.status(200).json({ success: true });
  } catch (err: unknown) {
    console.error('[/api/patients/[id]]', err);
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}

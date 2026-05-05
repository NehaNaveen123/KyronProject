/**
 * Admin availability management.
 *
 * POST   /api/admin/availability  — add a new slot { providerId, datetime }
 * DELETE /api/admin/availability  — remove a slot  { slotId }
 * PATCH  /api/admin/availability  — toggle booked  { slotId, isBooked }
 *
 * Note: the body field is "providerId" (new) — "doctorId" is accepted as an alias for compat.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { isValidSlotTime, VALID_SLOT_HOURS } from '../../../lib/booking';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      const { providerId, doctorId, datetime } = req.body as {
        providerId?: string; doctorId?: string; datetime?: string;
      };
      const pid = providerId ?? doctorId;   // accept both field names
      if (!pid || !datetime) {
        return res.status(400).json({ error: 'providerId and datetime are required' });
      }

      const dt = new Date(datetime);
      if (!isValidSlotTime(dt)) {
        return res.status(400).json({
          error: `Invalid slot time. Hours must be one of: ${VALID_SLOT_HOURS.join(', ')}. Minutes and seconds must be 0.`,
        });
      }

      const slot = await prisma.availability.create({
        data: { providerId: pid, datetime: dt },
      });
      return res.status(201).json({ slot });
    }

    if (req.method === 'DELETE') {
      const { slotId } = req.body as { slotId?: string };
      if (!slotId) return res.status(400).json({ error: 'slotId is required' });

      const slot = await prisma.availability.findUnique({ where: { id: slotId } });
      if (!slot) return res.status(404).json({ error: 'Slot not found' });
      if (slot.isBooked) return res.status(409).json({ error: 'Cannot delete a booked slot' });

      await prisma.availability.delete({ where: { id: slotId } });
      return res.status(200).json({ success: true });
    }

    if (req.method === 'PATCH') {
      const { slotId, isBooked } = req.body as { slotId?: string; isBooked?: boolean };
      if (!slotId || isBooked === undefined) {
        return res.status(400).json({ error: 'slotId and isBooked are required' });
      }

      const slot = await prisma.availability.update({
        where: { id: slotId },
        data:  { isBooked },
      });
      return res.status(200).json({ slot });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    console.error('[/api/admin/availability]', err);
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}

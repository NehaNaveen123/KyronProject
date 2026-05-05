/**
 * GET /api/org/[slug]/calls/[id] — full detail of a single call (admin only).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, id } = req.query as { slug: string; id: string };
  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  const call = await prisma.vogentCall.findFirst({
    where: { id, organization: { slug } },
  });
  if (!call) return res.status(404).json({ error: 'Call not found' });

  // Fetch linked appointment if any
  let appointment = null;
  if (call.appointmentId) {
    appointment = await prisma.appointment.findUnique({
      where:  { id: call.appointmentId },
      select: {
        id: true, patientName: true, patientEmail: true, patientPhone: true,
        datetime: true, reason: true,
        provider: { select: { name: true, specialties: true } },
      },
    });
  }

  return res.status(200).json({ call, appointment });
}

/**
 * GET /api/org/[slug]/calls — list recent calls for this org (admin only).
 * Query params: limit (default 50), offset (default 0)
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
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const limit  = Math.min(Number(req.query.limit  ?? 50), 100);
  const offset = Number(req.query.offset ?? 0);

  const [calls, total] = await Promise.all([
    prisma.vogentCall.findMany({
      where:   { organizationId: org.id },
      orderBy: { startedAt: 'desc' },
      skip:    offset,
      take:    limit,
      select: {
        id:             true,
        dialId:         true,
        callerPhone:    true,
        status:         true,
        durationSeconds:true,
        patientName:    true,
        patientEmail:   true,
        reason:         true,
        appointmentId:  true,
        bookedAt:       true,
        startedAt:      true,
        endedAt:        true,
        summary:        true,
      },
    }),
    prisma.vogentCall.count({ where: { organizationId: org.id } }),
  ]);

  return res.status(200).json({ calls, total, limit, offset });
}

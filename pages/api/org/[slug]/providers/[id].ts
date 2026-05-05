/**
 * PUT    /api/org/[slug]/providers/[id] — update a provider (admin only)
 * DELETE /api/org/[slug]/providers/[id] — delete a provider (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../../lib/db';
import { requireAdmin } from '../../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { slug, id } = req.query as { slug: string; id: string };

  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  // Verify provider belongs to this org
  const existing = await prisma.provider.findFirst({
    where:  { id, organization: { slug } },
    select: { id: true, schedulingRules: true },
  });
  if (!existing) return res.status(404).json({ error: 'Provider not found' });

  if (req.method === 'PUT') {
    const { name, credentials, specialties, schedulingRules } =
      req.body as { name?: string; credentials?: string; specialties?: string[]; schedulingRules?: unknown[] };

    if (!name?.trim() || !credentials?.trim() || !Array.isArray(specialties) || specialties.length === 0) {
      return res.status(400).json({ error: 'name, credentials, and at least one specialty are required' });
    }

    const provider = await prisma.provider.update({
      where: { id },
      data: {
        name:            name.trim(),
        credentials:     credentials.trim(),
        specialties:     specialties.map((s: string) => s.trim()).filter(Boolean),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schedulingRules: (Array.isArray(schedulingRules) ? schedulingRules : existing.schedulingRules ?? []) as any,
      },
    });
    return res.status(200).json({ provider });
  }

  if (req.method === 'DELETE') {
    await prisma.provider.delete({ where: { id } });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

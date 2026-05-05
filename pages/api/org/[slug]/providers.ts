/**
 * GET  /api/org/[slug]/providers — list all providers for this org
 * POST /api/org/[slug]/providers — create a new provider (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { slug } = req.query as { slug: string };

  if (req.method === 'GET') {
    // Public — patients need to trigger this indirectly via the chat
    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const providers = await prisma.provider.findMany({
      where: { organizationId: org.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, credentials: true, specialties: true, schedulingRules: true },
    });
    return res.status(200).json({ providers });
  }

  if (req.method === 'POST') {
    const admin = requireAdmin(req, res, slug);
    if (!admin) return;

    const { name, credentials, specialties, schedulingRules } =
      req.body as { name?: string; credentials?: string; specialties?: string[]; schedulingRules?: unknown[] };

    if (!name?.trim() || !credentials?.trim() || !Array.isArray(specialties) || specialties.length === 0) {
      return res.status(400).json({ error: 'name, credentials, and at least one specialty are required' });
    }

    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const provider = await prisma.provider.create({
      data: {
        name:            name.trim(),
        credentials:     credentials.trim(),
        specialties:     specialties.map((s: string) => s.trim()).filter(Boolean),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schedulingRules: (Array.isArray(schedulingRules) ? schedulingRules : []) as any,
        organizationId:  org.id,
      },
    });
    return res.status(201).json({ provider });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

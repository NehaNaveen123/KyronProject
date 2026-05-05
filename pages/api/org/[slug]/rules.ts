/**
 * GET  /api/org/[slug]/rules — return the org's scheduling rules (public read)
 * PUT  /api/org/[slug]/rules — replace the org's scheduling rules (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { requireAdmin } from '../../../../lib/auth';
import { isValidOrgRule } from '../../../../lib/rules';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { slug } = req.query as { slug: string };

  const org = await prisma.organization.findUnique({
    where:  { slug },
    select: { id: true, schedulingRules: true },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  if (req.method === 'GET') {
    return res.status(200).json({ rules: org.schedulingRules ?? [] });
  }

  if (req.method === 'PUT') {
    const admin = requireAdmin(req, res, slug);
    if (!admin) return;

    const { rules } = req.body as { rules?: unknown[] };
    if (!Array.isArray(rules)) {
      return res.status(400).json({ error: 'rules must be an array' });
    }

    // Validate each rule shape before persisting
    const invalid = rules.filter(r => !isValidOrgRule(r));
    if (invalid.length > 0) {
      return res.status(400).json({ error: 'One or more rules have an invalid format', invalid });
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data:  { schedulingRules: rules as any },
      select: { schedulingRules: true },
    });
    return res.status(200).json({ rules: updated.schedulingRules });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

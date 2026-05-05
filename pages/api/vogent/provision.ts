/**
 * POST /api/vogent/provision — provision a Vogent phone agent for an org.
 *
 * Admin-only. Idempotent — re-running updates the stored IDs.
 *
 * Body: { areaCode?: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { provisionOrg, type OrgContext } from '../../../lib/vogent';
import type { OrgSchedulingRule, ProviderSchedulingRule } from '../../../lib/rules';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Slug comes from the body so this endpoint lives at /api/vogent/provision
  // and the admin page passes the org slug.
  const { slug, areaCode } = req.body as { slug?: string; areaCode?: string };
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  const admin = requireAdmin(req, res, slug);
  if (!admin) return;

  const org = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id:              true,
      name:            true,
      slug:            true,
      address:         true,
      phone:           true,
      schedulingRules: true,
      providers: {
        select: {
          name:            true,
          credentials:     true,
          specialties:     true,
          schedulingRules: true,
        },
      },
    },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const context: OrgContext = {
    name:     org.name,
    slug:     org.slug,
    address:  org.address,
    phone:    org.phone,
    orgRules: ((org.schedulingRules ?? []) as unknown) as OrgSchedulingRule[],
    providers: org.providers.map(p => ({
      name:            p.name,
      credentials:     p.credentials,
      specialties:     p.specialties,
      schedulingRules: ((p.schedulingRules ?? []) as unknown) as ProviderSchedulingRule[],
    })),
  };

  try {
    const { agentId, phoneId, phoneNumber } = await provisionOrg(context, areaCode ?? '415');

    await prisma.organization.update({
      where: { id: org.id },
      data:  { vogentAgentId: agentId, vogentPhoneId: phoneId, vogentPhoneNumber: phoneNumber },
    });

    return res.status(200).json({ agentId, phoneId, phoneNumber });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vogent/provision] error:', message);
    return res.status(500).json({ error: message });
  }
}

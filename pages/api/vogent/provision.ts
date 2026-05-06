/**
 * POST /api/vogent/provision
 *
 * Admin-only. Two modes controlled by the `step` field in the request body:
 *
 *   step: "agent"  — Create (or recreate) the Vogent AI agent for this org.
 *                    Free — no Vogent credits required.
 *                    Body: { slug, step: "agent" }
 *
 *   step: "phone"  — Purchase a new phone number and link it to the agent.
 *                    Requires Vogent credits.
 *                    Body: { slug, step: "phone", areaCode?: string }
 *
 *   step: "link"   — Link an existing Vogent phone number (bought on Vogent dashboard).
 *                    No purchase — just sets agentId on the number.
 *                    Body: { slug, step: "link", phoneId, phoneNumber }
 *
 * Omitting `step` runs the legacy all-in-one flow (agent + phone purchase).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import {
  provisionAgent,
  provisionPhone,
  linkExistingPhone,
  provisionOrg,
  type OrgContext,
} from '../../../lib/vogent';
import type { OrgSchedulingRule, ProviderSchedulingRule } from '../../../lib/rules';

async function buildContext(org: {
  name: string; slug: string; address: string; phone: string;
  schedulingRules: unknown;
  providers: { name: string; credentials: string; specialties: string[]; schedulingRules: unknown }[];
}): Promise<OrgContext> {
  return {
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
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, step, areaCode, phoneId: inputPhoneId, phoneNumber: inputPhoneNumber } =
    req.body as {
      slug?:        string;
      step?:        'agent' | 'phone' | 'link';
      areaCode?:    string;
      phoneId?:     string;
      phoneNumber?: string;
    };

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
      vogentAgentId:   true,
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

  try {
    // ── Step: agent only ───────────────────────────────────────────────────────
    if (step === 'agent') {
      const context  = await buildContext(org);
      const { agentId } = await provisionAgent(context);
      await prisma.organization.update({
        where: { id: org.id },
        data:  { vogentAgentId: agentId },
      });
      return res.status(200).json({ agentId });
    }

    // ── Step: purchase phone ───────────────────────────────────────────────────
    if (step === 'phone') {
      const agentId = org.vogentAgentId;
      if (!agentId) {
        return res.status(400).json({ error: 'Create the agent first (step: "agent") before purchasing a phone number.' });
      }
      const { phoneId, phoneNumber } = await provisionPhone(agentId, areaCode ?? '650');
      await prisma.organization.update({
        where: { id: org.id },
        data:  { vogentPhoneId: phoneId, vogentPhoneNumber: phoneNumber },
      });
      return res.status(200).json({ phoneId, phoneNumber });
    }

    // ── Step: link existing phone ──────────────────────────────────────────────
    if (step === 'link') {
      if (!inputPhoneId || !inputPhoneNumber) {
        return res.status(400).json({ error: 'phoneId and phoneNumber are required for step "link".' });
      }
      const agentId = org.vogentAgentId;
      if (!agentId) {
        return res.status(400).json({ error: 'Create the agent first before linking a phone number.' });
      }
      await linkExistingPhone(agentId, inputPhoneId, inputPhoneNumber);
      await prisma.organization.update({
        where: { id: org.id },
        data:  { vogentPhoneId: inputPhoneId, vogentPhoneNumber: inputPhoneNumber },
      });
      return res.status(200).json({ phoneId: inputPhoneId, phoneNumber: inputPhoneNumber });
    }

    // ── Legacy: all-in-one ─────────────────────────────────────────────────────
    const context  = await buildContext(org);
    const { agentId, phoneId, phoneNumber } = await provisionOrg(context, areaCode ?? '650');
    await prisma.organization.update({
      where: { id: org.id },
      data:  { vogentAgentId: agentId, vogentPhoneId: phoneId, vogentPhoneNumber: phoneNumber },
    });
    return res.status(200).json({ agentId, phoneId, phoneNumber });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vogent/provision] error:', message);

    // Surface a human-readable hint for the credits error
    const isCredits = message.toLowerCase().includes('credits');
    return res.status(500).json({
      error: message,
      hint: isCredits
        ? 'Your Vogent account does not have enough credits to purchase a phone number. Top up your balance at app.vogent.ai, or use "Link existing number" to enter a number you already own.'
        : undefined,
    });
  }
}

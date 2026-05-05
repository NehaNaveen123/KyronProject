/**
 * GET /api/org/[slug]/info — public org details for the patient-facing chat page.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { slug } = req.query as { slug: string };
  const org = await prisma.organization.findUnique({
    where:  { slug },
    select: { name: true, phone: true, address: true, vogentPhoneNumber: true },
  });
  if (!org) return res.status(404).json({ error: 'Not found' });
  return res.status(200).json({ org });
}

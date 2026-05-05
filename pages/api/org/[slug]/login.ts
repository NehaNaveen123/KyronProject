/**
 * POST /api/org/[slug]/login
 * Verifies admin credentials and sets an httpOnly auth cookie.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { prisma } from '../../../../lib/db';
import { signToken, setAuthCookie } from '../../../../lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug } = req.query as { slug: string };
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const valid = await bcrypt.compare(password, org.adminPassword);
  if (!valid || org.adminEmail !== email) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken({ orgId: org.id, slug: org.slug, email: org.adminEmail });
  setAuthCookie(res, token);

  return res.status(200).json({ orgId: org.id, slug: org.slug, name: org.name });
}

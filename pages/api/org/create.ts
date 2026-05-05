/**
 * POST /api/org/create
 * Self-serve organization registration. Creates the org + hashes the admin password.
 * No auth required — this is the public onboarding endpoint.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { prisma } from '../../../lib/db';
import { signToken, setAuthCookie } from '../../../lib/auth';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, slug: rawSlug, address, phone, hours, adminEmail, adminPassword } =
    req.body as {
      name?: string; slug?: string; address?: string; phone?: string;
      hours?: unknown; adminEmail?: string; adminPassword?: string;
    };

  if (!name || !address || !phone || !hours || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const slug = rawSlug?.trim() || slugify(name);
  if (!slug) {
    return res.status(400).json({ error: 'Could not generate a valid slug from the practice name' });
  }

  // Check uniqueness
  const existingSlug  = await prisma.organization.findUnique({ where: { slug } });
  const existingEmail = await prisma.organization.findUnique({ where: { adminEmail } });
  if (existingSlug)  return res.status(409).json({ error: 'That URL is already taken. Try a different practice name or slug.' });
  if (existingEmail) return res.status(409).json({ error: 'An organization with that email already exists.' });

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const org = await prisma.organization.create({
    data: { name, slug, address, phone, hours, adminEmail, adminPassword: hashedPassword },
  });

  // Log the admin in immediately after creating the org
  const token = signToken({ orgId: org.id, slug: org.slug, email: org.adminEmail });
  setAuthCookie(res, token);

  return res.status(201).json({ orgId: org.id, slug: org.slug, name: org.name });
}

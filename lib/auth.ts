/**
 * JWT-based admin authentication for organization admins.
 * Tokens are stored in httpOnly cookies so they're inaccessible to client JS.
 */

import jwt from 'jsonwebtoken';
import type { NextApiRequest, NextApiResponse } from 'next';

const JWT_SECRET = process.env.JWT_SECRET ?? 'kyron-dev-secret-change-in-prod';
export const COOKIE_NAME = 'kyron_admin_token';

export interface AdminPayload {
  orgId:  string;
  slug:   string;
  email:  string;
}

// ─── Token ops ────────────────────────────────────────────────────────────────

export function signToken(payload: AdminPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AdminPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AdminPayload;
  } catch {
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function buildCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function setAuthCookie(res: NextApiResponse, token: string): void {
  res.setHeader('Set-Cookie', buildCookie(token, 60 * 60 * 24 * 7)); // 7 days
}

export function clearAuthCookie(res: NextApiResponse): void {
  res.setHeader('Set-Cookie', buildCookie('', 0));
}

// ─── Request parsing ──────────────────────────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';').map(pair => {
      const [k, ...rest] = pair.trim().split('=');
      return [k.trim(), decodeURIComponent(rest.join('='))];
    }),
  );
}

export function getAdminFromRequest(req: NextApiRequest): AdminPayload | null {
  const header = req.headers.cookie ?? '';
  if (!header) return null;
  const cookies = parseCookies(header);
  const token   = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
}

/** Middleware: require valid admin cookie and matching slug. Returns payload or sends 401. */
export function requireAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
  slug: string,
): AdminPayload | null {
  const admin = getAdminFromRequest(req);
  if (!admin || admin.slug !== slug) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return admin;
}

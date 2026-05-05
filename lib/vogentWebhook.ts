/**
 * Vogent webhook signature verification.
 *
 * Vogent signs inbound webhook POSTs with HMAC-SHA256 over the raw request body,
 * using the shared secret set in VOGENT_WEBHOOK_SECRET. The signature is sent in
 * the X-Elto-Signature header.
 *
 * If VOGENT_WEBHOOK_SECRET is not set, verification is skipped (dev-friendly).
 */

import crypto from 'crypto';
import type { NextApiRequest } from 'next';

export function verifyVogentSignature(req: NextApiRequest): boolean {
  const secret = process.env.VOGENT_WEBHOOK_SECRET;
  if (!secret) return true; // not configured — allow (suitable for local dev)

  const signature = req.headers['x-elto-signature'] as string | undefined;
  if (!signature) return false;

  const rawBody =
    typeof (req as any).rawBody === 'string'
      ? (req as any).rawBody
      : JSON.stringify(req.body);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Phone number provider service — abstraction over mock and real (Vogent) provisioning.
 *
 * Set PHONE_PROVIDER=vogent in .env.local to use the real Vogent API.
 * Defaults to "mock" — generates realistic US numbers with no external calls.
 */

import { prisma } from './db';

export type PhoneProviderType = 'mock' | 'vogent';

export interface RegisteredNumber {
  phoneId:     string;   // internal PhoneNumber row ID
  phoneNumber: string;   // E.164 e.g. +16505554321
  type:        PhoneProviderType;
}

export interface PhoneProvider {
  /** Register (or re-register) a phone number for an org. Idempotent. */
  register(orgId: string, options?: { areaCode?: string }): Promise<RegisteredNumber>;
}

// ─── Mock provider ────────────────────────────────────────────────────────────

// Area codes confirmed to have available numbers (or just plausible US codes for demo)
const AREA_CODES = ['650', '408', '415', '510', '669', '707', '747', '805', '818', '888'];

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

async function generateUniqueNumber(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const area   = AREA_CODES[Math.floor(Math.random() * AREA_CODES.length)];
    const number = `+1${area}${randomDigits(7)}`;
    const exists = await prisma.phoneNumber.findUnique({ where: { number } });
    if (!exists) return number;
  }
  throw new Error('Could not generate a unique mock phone number after 20 attempts.');
}

class MockPhoneProvider implements PhoneProvider {
  async register(orgId: string, _options?: { areaCode?: string }): Promise<RegisteredNumber> {
    // If org already has a mock number, return it (idempotent)
    const existing = await prisma.phoneNumber.findUnique({ where: { organizationId: orgId } });
    if (existing) {
      return { phoneId: existing.id, phoneNumber: existing.number, type: 'mock' };
    }

    const number = await generateUniqueNumber();
    const row    = await prisma.phoneNumber.create({
      data: { organizationId: orgId, number, type: 'mock' },
    });
    return { phoneId: row.id, phoneNumber: row.number, type: 'mock' };
  }
}

// ─── Vogent provider ──────────────────────────────────────────────────────────

class VogentPhoneProvider implements PhoneProvider {
  async register(orgId: string, options?: { areaCode?: string }): Promise<RegisteredNumber> {
    // Lazy import so Vogent module is only loaded when this provider is active
    const { purchasePhoneNumber } = await import('./vogent');
    const { phoneId: externalId, phoneNumber } = await purchasePhoneNumber(options?.areaCode ?? '650');

    const row = await prisma.phoneNumber.upsert({
      where:  { organizationId: orgId },
      create: { organizationId: orgId, number: phoneNumber, type: 'vogent', externalId },
      update: { number: phoneNumber, type: 'vogent', externalId },
    });
    return { phoneId: row.id, phoneNumber: row.number, type: 'vogent' };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function getPhoneProvider(): PhoneProvider {
  const provider = process.env.PHONE_PROVIDER ?? 'mock';
  if (provider === 'vogent') return new VogentPhoneProvider();
  return new MockPhoneProvider();
}

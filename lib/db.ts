/**
 * Singleton Prisma client — prevents exhausting DB connections in dev
 * due to Next.js hot reload creating a new client on every module load.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['error'] : [] });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

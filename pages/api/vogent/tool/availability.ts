/**
 * POST /api/vogent/tool/availability?orgSlug=<slug>
 *
 * Vogent calls this webhook when the agent invokes get_availability.
 * Performs symptom-to-specialty mapping, queries availability, and returns a
 * single recommended slot so the agent can make a deterministic offer.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '../../../../lib/db';
import { getAvailability } from '../../../../lib/booking';
import { verifyVogentSignature } from '../../../../lib/vogentWebhook';

// Maps common symptom keywords → candidate specialty names.
// Entries are checked in order; first match wins.
const SYMPTOM_MAP: { keywords: string[]; specialties: string[] }[] = [
  { keywords: ['knee', 'hip', 'shoulder', 'fracture', 'bone', 'joint', 'ortho', 'ligament', 'tendon'], specialties: ['Orthopedics', 'Orthopedic Surgery', 'Sports Medicine'] },
  { keywords: ['heart', 'chest', 'cardio', 'palpitation', 'blood pressure', 'hypertension', 'cholesterol'], specialties: ['Cardiology'] },
  { keywords: ['skin', 'rash', 'acne', 'eczema', 'mole', 'derm'], specialties: ['Dermatology'] },
  { keywords: ['teeth', 'tooth', 'dental', 'cavity', 'gum', 'mouth'], specialties: ['Dentistry'] },
  { keywords: ['eye', 'vision', 'sight', 'glasses', 'ophthal', 'contact'], specialties: ['Ophthalmology', 'Optometry'] },
  { keywords: ['anxiety', 'depression', 'mental', 'psych', 'mood', 'stress'], specialties: ['Psychiatry', 'Psychology'] },
  { keywords: ['child', 'infant', 'baby', 'pediatric', 'kid'], specialties: ['Pediatrics'] },
  { keywords: ['neuro', 'headache', 'migraine', 'seizure', 'memory', 'nerve'], specialties: ['Neurology'] },
  { keywords: ['stomach', 'digestive', 'gastro', 'ibs', 'bowel', 'colon', 'acid reflux'], specialties: ['Gastroenterology'] },
  { keywords: ['lung', 'breath', 'asthma', 'pulmon', 'cough'], specialties: ['Pulmonology'] },
  { keywords: ['checkup', 'annual', 'physical', 'general', 'follow', 'primary', 'family'], specialties: ['Family Medicine', 'Internal Medicine', 'General Practice'] },
];

/**
 * Given a raw specialty/symptom string and the org's actual provider specialties,
 * return the best-matching specialty name as it appears in the DB.
 */
function resolveSpecialty(input: string, orgSpecialties: string[]): string | null {
  const lower = input.toLowerCase();

  // 1. Exact case-insensitive match against what's in the DB
  const exact = orgSpecialties.find(s => s.toLowerCase() === lower);
  if (exact) return exact;

  // 2. Symptom keyword → candidate specialties, then match against DB
  for (const { keywords, specialties } of SYMPTOM_MAP) {
    if (keywords.some(kw => lower.includes(kw))) {
      for (const candidate of specialties) {
        const match = orgSpecialties.find(s => s.toLowerCase() === candidate.toLowerCase());
        if (match) return match;
      }
    }
  }

  // 3. Substring match (e.g. "Ortho" matches "Orthopedics")
  const partial = orgSpecialties.find(s =>
    s.toLowerCase().includes(lower) || lower.includes(s.toLowerCase()),
  );
  if (partial) return partial;

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyVogentSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { orgSlug } = req.query as { orgSlug: string };
  if (!orgSlug) return res.status(400).json({ error: 'orgSlug is required' });

  const body   = req.body as Record<string, unknown>;
  const params = (body.parameters ?? body.arguments ?? body) as Record<string, unknown>;
  const rawSpecialty = (params.specialty as string | undefined) ?? '';
  const isNewPatient = params.isNewPatient !== false;

  if (!rawSpecialty) {
    return res.status(200).json({ result: 'Please specify a medical specialty or describe the patient\'s concern.' });
  }

  const org = await prisma.organization.findUnique({
    where:  { slug: orgSlug },
    select: {
      id:        true,
      providers: { select: { specialties: true } },
    },
  });
  if (!org) return res.status(404).json({ error: 'Organization not found' });

  // Collect all distinct specialties across this org's providers
  const orgSpecialties = [...new Set(org.providers.flatMap(p => p.specialties))];

  // Resolve the agent's input to a real specialty name
  const specialty = resolveSpecialty(rawSpecialty, orgSpecialties);
  if (!specialty) {
    return res.status(200).json({
      result: `No provider found for "${rawSpecialty}" at this practice. Available specialties: ${orgSpecialties.join(', ')}. Please ask the patient which one they need.`,
    });
  }

  try {
    const avail = await getAvailability(specialty, undefined, org.id, isNewPatient);

    if (avail.slots.length === 0) {
      const reasonText = avail.blockedReasons.length
        ? ' ' + avail.blockedReasons.join(' ')
        : '';
      return res.status(200).json({
        result: {
          available:    false,
          specialty,
          providerName: avail.doctorName || null,
          message:      `No available slots found for ${specialty} in the next 7 days.${reasonText} Tell the patient you are not seeing availability right now and offer to check a different time or specialty.`,
        },
      });
    }

    // Return the single best (first) slot as the recommended offer.
    // Also include up to 2 alternatives so the agent can offer backup times.
    const [recommended, ...alternatives] = avail.slots.slice(0, 3);

    return res.status(200).json({
      result: {
        available:    true,
        providerId:   avail.doctorId,
        providerName: avail.doctorName,
        specialty,
        // The agent should offer this slot to the patient first
        recommendedSlot: {
          id:       recommended.id,
          datetime: recommended.datetime,
          display:  recommended.formatted,
        },
        // Fallbacks if patient declines the first offer
        alternativeSlots: alternatives.map(s => ({
          id:       s.id,
          datetime: s.datetime,
          display:  s.formatted,
        })),
        message: `Found availability for ${avail.doctorName} (${specialty}). The next available slot is ${recommended.formatted}. Offer this time to the patient.`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vogent/tool/availability] error:', message);
    return res.status(200).json({ result: `An error occurred while checking availability: ${message}` });
  }
}

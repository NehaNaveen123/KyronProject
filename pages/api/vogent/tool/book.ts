/**
 * POST /api/vogent/tool/book?orgSlug=<slug>
 *
 * Vogent calls this webhook when the agent invokes book_appointment.
 * Returns a structured { confirmed, scheduledTime, message } object so the
 * agent can decide what to say based on whether the DB insert succeeded.
 *
 * IMPORTANT: The agent must ONLY say "you are booked" when confirmed === true.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { bookAppointment } from '../../../../lib/booking';
import { verifyVogentSignature } from '../../../../lib/vogentWebhook';
import { prisma } from '../../../../lib/db';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyVogentSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { orgSlug } = req.query as { orgSlug: string };

  const body   = req.body as Record<string, unknown>;
  // dialId sits at the top level of the Vogent webhook payload
  const dialId = (body.dialId ?? body.callId ?? body.dial_id) as string | undefined;

  const params = (body.parameters ?? body.arguments ?? body) as Record<string, unknown>;

  const {
    slotId,
    providerId,
    datetime,
    patientName,
    firstName,
    lastName,
    patientDob,
    patientPhone,
    patientEmail,
    reason,
    isNewPatient,
  } = params as {
    slotId?:       string;
    providerId?:   string;
    datetime?:     string;
    patientName?:  string;
    firstName?:    string;
    lastName?:     string;
    patientDob?:   string;
    patientPhone?: string;
    patientEmail?: string;
    reason?:       string;
    isNewPatient?: boolean;
  };

  const missing = ['providerId', 'datetime', 'patientName', 'patientDob', 'patientPhone', 'patientEmail', 'reason']
    .filter(k => !(params as Record<string, unknown>)[k]);

  if (missing.length > 0) {
    return res.status(200).json({
      result: {
        confirmed: false,
        message:   `Missing required information: ${missing.join(', ')}. Please collect this from the patient before booking.`,
      },
    });
  }

  // Persist patient info to the call record before attempting the booking
  if (dialId) {
    await prisma.vogentCall.updateMany({
      where: { dialId },
      data: {
        patientName:  patientName ?? undefined,
        patientDob:   patientDob  ?? undefined,
        patientPhone: patientPhone ?? undefined,
        patientEmail: patientEmail ?? undefined,
        reason:       reason ?? undefined,
      },
    }).catch(err => console.error('[vogent/tool/book] patient info update failed:', err));
  }

  try {
    const result = await bookAppointment({
      slotId,
      doctorId:     providerId,
      datetime,
      patientName,
      firstName,
      lastName,
      patientDob,
      patientPhone,
      patientEmail,
      reason,
      isNewPatient: isNewPatient !== false,
      sessionId:    `vogent-${orgSlug ?? 'unknown'}-${uuidv4()}`,
    });

    if (!result.success) {
      // Booking failed — update call record with "failed" outcome, then tell the agent
      if (dialId) {
        await prisma.vogentCall.updateMany({
          where: { dialId },
          data:  { bookingOutcome: 'failed' },
        }).catch(err => console.error('[vogent/tool/book] outcome update failed:', err));
      }

      return res.status(200).json({
        result: {
          confirmed: false,
          message:   `I'm not seeing availability right now—let me offer alternatives. (${result.error})`,
        },
      });
    }

    const scheduledTime = new Date(datetime!);

    // Link the appointment to the call record and record outcome
    if (dialId) {
      await prisma.vogentCall.updateMany({
        where: { dialId },
        data: {
          appointmentId:  result.appointmentId,
          bookedAt:       new Date(),
          bookingOutcome: 'confirmed',
          scheduledTime,
        },
      }).catch(err => console.error('[vogent/tool/book] appointment link failed:', err));
    }

    return res.status(200).json({
      result: {
        confirmed:     true,
        appointmentId: result.appointmentId,
        scheduledTime: result.formatted,  // human-readable e.g. "Tuesday (05/06) at 10:30 AM"
        providerName:  result.doctorName,
        // The agent must read this line verbatim to the patient
        message:       `You are booked with ${result.doctorName} on ${result.formatted}. A confirmation email has been sent to ${patientEmail}.`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vogent/tool/book] error:', message);

    if (dialId) {
      await prisma.vogentCall.updateMany({
        where: { dialId },
        data:  { bookingOutcome: 'failed' },
      }).catch(() => {});
    }

    return res.status(200).json({
      result: {
        confirmed: false,
        message:   `I'm not seeing availability right now—let me offer alternatives.`,
      },
    });
  }
}

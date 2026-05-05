/**
 * POST /api/vogent/tool/book?orgSlug=<slug>
 *
 * Vogent calls this webhook when the agent invokes book_appointment.
 * Delegates to the existing bookAppointment() function and then writes
 * the booking result back to the VogentCall record.
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

  const body = req.body as Record<string, unknown>;
  // dialId is at the top level of the webhook body (not inside parameters)
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
      result: `Missing required information: ${missing.join(', ')}. Please collect this from the patient before booking.`,
    });
  }

  // Update call record with patient info (even before we know if booking succeeds)
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
      return res.status(200).json({
        result: `Unable to book the appointment: ${result.error}. Please offer the patient an alternative slot.`,
      });
    }

    // Link the appointment to the call record
    if (dialId) {
      await prisma.vogentCall.updateMany({
        where: { dialId },
        data: {
          appointmentId: result.appointmentId,
          bookedAt:      new Date(),
        },
      }).catch(err => console.error('[vogent/tool/book] appointment link failed:', err));
    }

    return res.status(200).json({
      result: {
        appointmentId: result.appointmentId,
        message: `Appointment confirmed! ${result.patientFirstName}, your appointment with ${result.doctorName} is booked for ${result.formatted}. A confirmation email has been sent to ${patientEmail}.`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[vogent/tool/book] error:', message);
    return res.status(200).json({ result: `An error occurred while booking: ${message}` });
  }
}

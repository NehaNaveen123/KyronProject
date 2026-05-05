import { Resend } from 'resend';

export async function sendConfirmationEmail(email: string, details: {
  patientName: string;
  doctorName: string;
  time: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'no-reply@kyronmedical.com';
  
  if (!apiKey) {
    console.error('RESEND_API_KEY is missing from .env.local');
    return;
  }

  const resend = new Resend(apiKey);

  try {
    await resend.emails.send({
      from: `Kyron Medical <${fromEmail}>`,
      to: email,
      subject: 'Your Kyron Medical appointment is confirmed',
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;">
          <h1 style="font-size: 22px; margin-bottom: 16px;">Appointment Confirmed</h1>
          <p>Hello ${details.patientName},</p>
          <p>Your appointment with <strong>${details.doctorName}</strong> is confirmed.</p>
          <p>
            <strong>Appointment time:</strong><br />
            ${details.time}
          </p>
          <p>If you need to make changes, please call by clicking the Phone Icon above.</p>
          <p>Thank you,<br />Kyron Medical</p>
        </div>
      `,
      text: [
        `Hello ${details.patientName},`,
        '',
        `Your appointment with ${details.doctorName} is confirmed.`,
        `Appointment time: ${details.time}`,
        '',
        'If you need to make changes, please call by clicking the Phone Icon above.',
        '',
        'Thank you,',
        'Kyron Medical',
      ].join('\n'),
    });
    console.log(`Email sent successfully from ${fromEmail} to ${email}`);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}
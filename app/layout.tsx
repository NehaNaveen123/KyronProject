import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title:       'Kyron Medical — Schedule Your Appointment',
  description: 'AI-powered appointment scheduling for Kyron Medical Practice',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}

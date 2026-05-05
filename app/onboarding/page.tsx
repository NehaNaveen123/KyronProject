'use client';

/**
 * Self-serve organization onboarding — 4-step form.
 * Step 1: Admin account (email + password)
 * Step 2: Practice info  (name → auto-slug, address, phone)
 * Step 3: Hours of operation
 * Step 4: Success + org URL
 */

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayHours { open: string; close: string; closed: boolean }

type WeeklyHours = Record<
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  DayHours
>;

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;
const DAY_LABELS: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

function defaultHours(): WeeklyHours {
  return {
    monday:    { open: '09:00', close: '17:00', closed: false },
    tuesday:   { open: '09:00', close: '17:00', closed: false },
    wednesday: { open: '09:00', close: '17:00', closed: false },
    thursday:  { open: '09:00', close: '17:00', closed: false },
    friday:    { open: '09:00', close: '17:00', closed: false },
    saturday:  { open: '09:00', close: '17:00', closed: true  },
    sunday:    { open: '09:00', close: '17:00', closed: true  },
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all ${
            i < current
              ? 'w-8 bg-blue-600'
              : i === current
                ? 'w-8 bg-blue-400'
                : 'w-4 bg-slate-200'
          }`}
        />
      ))}
    </div>
  );
}

function Field({
  label, error, children,
}: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [createdSlug, setCreatedSlug] = useState('');

  // Step 1 — account
  const [adminEmail, setAdminEmail]       = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPass, setConfirmPass]     = useState('');

  // Step 2 — practice info
  const [orgName, setOrgName]   = useState('');
  const [slug, setSlug]         = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [address, setAddress]   = useState('');
  const [phone, setPhone]       = useState('');

  // Step 3 — hours
  const [hours, setHours] = useState<WeeklyHours>(defaultHours());

  function handleNameChange(val: string) {
    setOrgName(val);
    if (!slugEdited) setSlug(slugify(val));
  }

  function updateDay(day: keyof WeeklyHours, field: keyof DayHours, value: string | boolean) {
    setHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (step === 0) {
      if (!adminEmail.includes('@')) errs.adminEmail = 'Valid email required';
      if (adminPassword.length < 8)  errs.adminPassword = 'Password must be at least 8 characters';
      if (adminPassword !== confirmPass) errs.confirmPass = 'Passwords do not match';
    }
    if (step === 1) {
      if (!orgName.trim())  errs.orgName  = 'Practice name is required';
      if (!slug.trim())     errs.slug     = 'URL slug is required';
      if (!/^[a-z0-9-]+$/.test(slug)) errs.slug = 'Slug may only contain lowercase letters, numbers, and hyphens';
      if (!address.trim())  errs.address  = 'Address is required';
      if (!phone.trim())    errs.phone    = 'Phone number is required';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setSubmitting(true);
    setErrors({});

    try {
      const res = await fetch('/api/org/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName, slug, address, phone, hours, adminEmail, adminPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors({ submit: data.error ?? 'Something went wrong' });
        setSubmitting(false);
        return;
      }
      setCreatedSlug(data.slug);
      setStep(3);
    } catch {
      setErrors({ submit: 'Network error — please try again' });
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    if (!validate()) return;
    setStep(s => s + 1);
  }

  // ── Step 0: Account ─────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <Shell step={0}>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Create your admin account</h2>
        <p className="text-sm text-slate-500 mb-6">You'll use these credentials to manage your practice.</p>

        <div className="space-y-4">
          <Field label="Admin email" error={errors.adminEmail}>
            <input type="email" className={inputCls} value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)} placeholder="admin@valleyclinic.com" />
          </Field>
          <Field label="Password" error={errors.adminPassword}>
            <input type="password" className={inputCls} value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)} placeholder="8+ characters" />
          </Field>
          <Field label="Confirm password" error={errors.confirmPass}>
            <input type="password" className={inputCls} value={confirmPass}
              onChange={e => setConfirmPass(e.target.value)} placeholder="Re-enter password" />
          </Field>
        </div>

        <div className="mt-8 flex justify-end">
          <button onClick={next} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            Continue →
          </button>
        </div>
      </Shell>
    );
  }

  // ── Step 1: Practice info ───────────────────────────────────────────────────
  if (step === 1) {
    return (
      <Shell step={1}>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Practice information</h2>
        <p className="text-sm text-slate-500 mb-6">Patients will see this when they visit your scheduling page.</p>

        <div className="space-y-4">
          <Field label="Practice name" error={errors.orgName}>
            <input type="text" className={inputCls} value={orgName}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="Valley Family Medicine" />
          </Field>

          <Field label="Patient URL" error={errors.slug}>
            <div className="flex items-center gap-0">
              <span className="rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 whitespace-nowrap">
                {typeof window !== 'undefined' ? window.location.origin : ''}/org/
              </span>
              <input
                type="text"
                className="flex-1 rounded-r-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={slug}
                onChange={e => { setSlug(e.target.value); setSlugEdited(true); }}
                placeholder="valley-family-medicine"
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">Patients will use this URL to book appointments.</p>
          </Field>

          <Field label="Address" error={errors.address}>
            <input type="text" className={inputCls} value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="123 Main St, Springfield, IL 62701" />
          </Field>

          <Field label="Phone number" error={errors.phone}>
            <input type="tel" className={inputCls} value={phone}
              onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
          </Field>
        </div>

        <div className="mt-8 flex justify-between">
          <button onClick={() => setStep(0)} className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ← Back
          </button>
          <button onClick={next} className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            Continue →
          </button>
        </div>
      </Shell>
    );
  }

  // ── Step 2: Hours ───────────────────────────────────────────────────────────
  if (step === 2) {
    return (
      <Shell step={2}>
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Hours of operation</h2>
        <p className="text-sm text-slate-500 mb-6">
          Let patients know when you're open. Individual provider schedules are managed from your dashboard.
        </p>

        {errors.submit && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {errors.submit}
          </div>
        )}

        <div className="space-y-3">
          {DAYS.map(day => (
            <div key={day} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="w-24 text-sm font-medium text-slate-700 capitalize">{DAY_LABELS[day]}</div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!hours[day].closed}
                  onChange={e => updateDay(day, 'closed', !e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs text-slate-500">Open</span>
              </label>

              {!hours[day].closed && (
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="time"
                    value={hours[day].open}
                    onChange={e => updateDay(day, 'open', e.target.value)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <input
                    type="time"
                    value={hours[day].close}
                    onChange={e => updateDay(day, 'close', e.target.value)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
              {hours[day].closed && (
                <span className="ml-2 text-xs text-slate-400">Closed</span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-between">
          <button onClick={() => setStep(1)} className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ← Back
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create practice'}
          </button>
        </div>
      </Shell>
    );
  }

  // ── Step 3: Success ─────────────────────────────────────────────────────────
  return (
    <Shell step={3}>
      <div className="text-center py-4">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Your practice is live!</h2>
        <p className="text-sm text-slate-500 mb-8">
          Share the patient link below, then head to your dashboard to add providers.
        </p>

        <div className="rounded-xl border border-blue-100 bg-blue-50 px-6 py-4 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500 mb-2">Patient booking link</p>
          <a
            href={`/org/${createdSlug}`}
            className="text-blue-700 font-medium break-all hover:underline"
          >
            {typeof window !== 'undefined' ? window.location.origin : ''}/org/{createdSlug}
          </a>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            href={`/org/${createdSlug}/admin`}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Go to admin dashboard →
          </a>
          <a
            href={`/org/${createdSlug}`}
            className="rounded-lg border border-slate-200 px-6 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Preview patient view
          </a>
        </div>
      </div>
    </Shell>
  );
}

// ─── Shell layout ─────────────────────────────────────────────────────────────

function Shell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* Logo */}
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">K</div>
          <span className="text-sm font-semibold text-slate-700">Kyron Medical</span>
        </div>

        <StepIndicator current={step} total={4} />
        {children}
      </div>
    </div>
  );
}

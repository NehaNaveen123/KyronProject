'use client';

/**
 * /org/[slug]/admin — organization admin dashboard.
 *
 * Tabs:
 *   Providers  — add / edit / delete providers (with per-provider scheduling rules)
 *   Rules      — org-wide scheduling rules: min booking window, day blackouts, time buffers
 *   Practice   — read-only org details + patient link
 *
 * Gate: GET /api/org/[slug]/me — if not authenticated, shows login form.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

// ─── Shared types ─────────────────────────────────────────────────────────────

type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

const ALL_DAYS: DayOfWeek[] = [
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
];
const WEEKDAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday'];

const DAY_SHORT: Record<DayOfWeek, string> = {
  monday:'Mon', tuesday:'Tue', wednesday:'Wed', thursday:'Thu',
  friday:'Fri', saturday:'Sat', sunday:'Sun',
};

// ─── Org-level rule types (mirror lib/rules.ts) ───────────────────────────────

interface MinBookingWindowRule {
  type: 'min_booking_window';
  hours: number;
  label?: string;
}
interface DayBlackoutRule {
  type: 'day_blackout';
  days: DayOfWeek[];
  label?: string;
}
interface TimeBufferRule {
  type: 'time_buffer';
  windowStart: string;
  windowEnd: string;
  bufferMinutes: number;
  label?: string;
}
type OrgSchedulingRule = MinBookingWindowRule | DayBlackoutRule | TimeBufferRule;

// ─── Provider-level rule types ────────────────────────────────────────────────

interface NewPatientDaysRule {
  type: 'new_patient_days';
  days: DayOfWeek[];
  label?: string;
}
interface ProviderDayBlackoutRule {
  type: 'provider_day_blackout';
  days: DayOfWeek[];
  label?: string;
}
type ProviderSchedulingRule = NewPatientDaysRule | ProviderDayBlackoutRule;

// ─── Provider + Org types ─────────────────────────────────────────────────────

interface Provider {
  id:              string;
  name:            string;
  credentials:     string;
  specialties:     string[];
  schedulingRules: ProviderSchedulingRule[];
}

interface OrgInfo {
  id:         string;
  name:       string;
  slug:       string;
  address:    string;
  phone:      string;
  hours:      Record<string, { open: string; close: string; closed: boolean }>;
  adminEmail: string;
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function DayToggleGroup({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: DayOfWeek[];
  options: DayOfWeek[];
  onChange: (days: DayOfWeek[]) => void;
}) {
  function toggle(day: DayOfWeek) {
    onChange(
      selected.includes(day)
        ? selected.filter(d => d !== day)
        : [...selected, day],
    );
  }
  return (
    <div>
      <p className="text-xs font-medium text-slate-600 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(day => (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              selected.includes(day)
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {DAY_SHORT[day]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Provider Modal ───────────────────────────────────────────────────────────

function ProviderModal({
  initial,
  onSave,
  onClose,
  saving,
}: {
  initial?: Provider;
  onSave: (data: {
    name: string;
    credentials: string;
    specialties: string[];
    schedulingRules: ProviderSchedulingRule[];
  }) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const existingRules = initial?.schedulingRules ?? [];

  const existingNewPatientRule = existingRules.find(r => r.type === 'new_patient_days') as NewPatientDaysRule | undefined;
  const existingBlackoutRule   = existingRules.find(r => r.type === 'provider_day_blackout') as ProviderDayBlackoutRule | undefined;

  const [name,             setName]             = useState(initial?.name        ?? '');
  const [credentials,      setCredentials]       = useState(initial?.credentials ?? '');
  const [specInput,        setSpecInput]         = useState(initial?.specialties.join(', ') ?? '');
  const [newPatientOn,     setNewPatientOn]      = useState(existingNewPatientRule != null);
  const [newPatientDays,   setNewPatientDays]    = useState<DayOfWeek[]>(existingNewPatientRule?.days ?? WEEKDAYS);
  const [providerBlackout, setProviderBlackout]  = useState<DayOfWeek[]>(existingBlackoutRule?.days ?? []);
  const [error,            setError]             = useState('');

  function submit() {
    const specialties = specInput.split(',').map(s => s.trim()).filter(Boolean);
    if (!name.trim())        return setError('Name is required');
    if (!credentials.trim()) return setError('Credentials are required');
    if (!specialties.length) return setError('At least one specialty is required');
    if (newPatientOn && newPatientDays.length === 0) return setError('Select at least one day for new patients');
    setError('');

    const rules: ProviderSchedulingRule[] = [];
    if (newPatientOn && newPatientDays.length > 0) {
      rules.push({ type: 'new_patient_days', days: newPatientDays, label: 'New patient days' });
    }
    if (providerBlackout.length > 0) {
      rules.push({ type: 'provider_day_blackout', days: providerBlackout, label: 'Provider blackout' });
    }

    onSave({ name: name.trim(), credentials: credentials.trim(), specialties, schedulingRules: rules });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl overflow-y-auto max-h-[90vh]">
        <h3 className="text-base font-semibold text-slate-900 mb-4">
          {initial ? 'Edit provider' : 'Add provider'}
        </h3>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Basic info */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Full name</label>
            <input type="text" className={inputCls} value={name}
              onChange={e => setName(e.target.value)} placeholder="Dr. Sarah Chen" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Credentials</label>
            <input type="text" className={inputCls} value={credentials}
              onChange={e => setCredentials(e.target.value)} placeholder="MD, FACC" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Specialties / condition categories</label>
            <input type="text" className={inputCls} value={specInput}
              onChange={e => setSpecInput(e.target.value)}
              placeholder="Cardiology, Internal Medicine" />
            <p className="mt-1 text-xs text-slate-400">Comma-separated. The AI matches patient symptoms to these.</p>
          </div>
        </div>

        {/* Provider scheduling constraints */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Provider Scheduling Constraints
          </h4>

          {/* New patient days */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input type="checkbox" className="rounded"
                checked={newPatientOn} onChange={e => setNewPatientOn(e.target.checked)} />
              <span className="text-xs font-medium text-slate-700">
                New patients only accepted on specific days
              </span>
            </label>
            {newPatientOn && (
              <div className="ml-5">
                <DayToggleGroup
                  label="Allowed days for new patients"
                  selected={newPatientDays}
                  options={WEEKDAYS}
                  onChange={setNewPatientDays}
                />
              </div>
            )}
          </div>

          {/* Provider day blackout */}
          <DayToggleGroup
            label="Provider unavailable on (blackout days)"
            selected={providerBlackout}
            options={ALL_DAYS}
            onChange={setProviderBlackout}
          />
          <p className="mt-1 text-xs text-slate-400">Leave empty if the provider follows the org schedule.</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rules Tab ────────────────────────────────────────────────────────────────

function RulesTab({ slug }: { slug: string }) {
  const [rules,    setRules]    = useState<OrgSchedulingRule[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error,    setError]    = useState('');

  // Derived state for UI controls
  const [minWindow,        setMinWindow]        = useState<number | ''>('');
  const [blackoutDays,     setBlackoutDays]      = useState<DayOfWeek[]>([]);
  const [timeBuffers,      setTimeBuffers]       = useState<TimeBufferRule[]>([]);

  function flash(msg: string, isErr = false) {
    if (isErr) setError(msg); else setFeedback(msg);
    setTimeout(() => { setFeedback(''); setError(''); }, 4000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/org/${slug}/rules`);
    const data = await res.json();
    const loaded: OrgSchedulingRule[] = data.rules ?? [];
    setRules(loaded);
    // Decompose into UI state
    const mw = loaded.find(r => r.type === 'min_booking_window') as MinBookingWindowRule | undefined;
    setMinWindow(mw?.hours ?? '');
    const bo = loaded.find(r => r.type === 'day_blackout') as DayBlackoutRule | undefined;
    setBlackoutDays(bo?.days ?? []);
    setTimeBuffers(loaded.filter(r => r.type === 'time_buffer') as TimeBufferRule[]);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  function addBuffer() {
    setTimeBuffers(prev => [
      ...prev,
      { type: 'time_buffer', windowStart: '12:00', windowEnd: '13:00', bufferMinutes: 30, label: 'Lunch break' },
    ]);
  }

  function updateBuffer(idx: number, field: keyof TimeBufferRule, value: string | number) {
    setTimeBuffers(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  }

  function removeBuffer(idx: number) {
    setTimeBuffers(prev => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    setError('');

    const built: OrgSchedulingRule[] = [];

    if (minWindow !== '' && Number(minWindow) > 0) {
      built.push({ type: 'min_booking_window', hours: Number(minWindow), label: 'Min booking window' });
    }
    if (blackoutDays.length > 0) {
      built.push({ type: 'day_blackout', days: blackoutDays, label: 'Org blackout' });
    }
    for (const buf of timeBuffers) {
      if (buf.windowStart && buf.windowEnd && buf.bufferMinutes >= 0) {
        built.push(buf);
      }
    }

    const res  = await fetch(`/api/org/${slug}/rules`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ rules: built }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) return flash(data.error ?? 'Failed to save rules', true);
    setRules(built);
    flash('Scheduling rules saved. Changes take effect immediately.');
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {feedback && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Min booking window ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Minimum Booking Window</h3>
        <p className="text-xs text-slate-500 mb-4">
          Patients cannot book appointments within this many hours of the appointment time.
          Leave empty to disable.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={72}
            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={minWindow}
            onChange={e => setMinWindow(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="e.g. 2"
          />
          <span className="text-sm text-slate-500">hours in advance</span>
        </div>
        {minWindow !== '' && Number(minWindow) > 0 && (
          <p className="mt-2 text-xs text-blue-600">
            Patients must book at least {minWindow} hour{Number(minWindow) !== 1 ? 's' : ''} before their appointment.
          </p>
        )}
      </section>

      {/* ── Day blackouts ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Day Blackouts</h3>
        <p className="text-xs text-slate-500 mb-4">
          No appointments across <em>all</em> providers on these days.
          Per-provider blackouts can be set in the provider settings.
        </p>
        <DayToggleGroup
          label="Blocked days (org-wide)"
          selected={blackoutDays}
          options={ALL_DAYS}
          onChange={setBlackoutDays}
        />
      </section>

      {/* ── Time buffers ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-800">Time Buffer Windows</h3>
          <button
            onClick={addBuffer}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
          >
            + Add window
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Block appointments within N minutes of a named time window (e.g., lunch breaks, staff meetings).
          A 30-minute buffer around 12:00–13:00 blocks slots at 12:00 and 13:00.
        </p>

        {timeBuffers.length === 0 && (
          <p className="text-xs text-slate-400 italic">No buffer windows configured.</p>
        )}

        <div className="space-y-3">
          {timeBuffers.map((buf, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Label</label>
                <input
                  type="text"
                  className="w-32 rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={buf.label ?? ''}
                  onChange={e => updateBuffer(idx, 'label', e.target.value)}
                  placeholder="Lunch break"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Window start</label>
                <input
                  type="time"
                  className="rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={buf.windowStart}
                  onChange={e => updateBuffer(idx, 'windowStart', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Window end</label>
                <input
                  type="time"
                  className="rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={buf.windowEnd}
                  onChange={e => updateBuffer(idx, 'windowEnd', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Buffer (min)</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  className="w-20 rounded border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={buf.bufferMinutes}
                  onChange={e => updateBuffer(idx, 'bufferMinutes', Number(e.target.value))}
                />
              </div>
              <button
                onClick={() => removeBuffer(idx)}
                className="rounded px-2 py-1.5 text-xs text-red-500 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save scheduling rules'}
        </button>
      </div>
    </div>
  );
}

// ─── Providers Tab ────────────────────────────────────────────────────────────

function ProvidersTab({ slug }: { slug: string }) {
  const [providers,  setProviders]  = useState<Provider[]>([]);
  const [loadingData,setLoadingData]= useState(true);
  const [feedback,   setFeedback]   = useState('');
  const [showModal,  setShowModal]  = useState(false);
  const [editTarget, setEditTarget] = useState<Provider | undefined>();
  const [saving,     setSaving]     = useState(false);

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 3000);
  }

  const load = useCallback(async () => {
    setLoadingData(true);
    const res  = await fetch(`/api/org/${slug}/providers`);
    const data = await res.json();
    setProviders((data.providers ?? []).map((p: any) => ({
      ...p,
      schedulingRules: p.schedulingRules ?? [],
    })));
    setLoadingData(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  async function saveProvider(data: {
    name: string; credentials: string; specialties: string[];
    schedulingRules: ProviderSchedulingRule[];
  }) {
    setSaving(true);
    const url    = editTarget ? `/api/org/${slug}/providers/${editTarget.id}` : `/api/org/${slug}/providers`;
    const method = editTarget ? 'PUT' : 'POST';
    const res    = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { flash(`Error: ${json.error}`); return; }
    setShowModal(false);
    setEditTarget(undefined);
    flash(editTarget ? 'Provider updated.' : 'Provider added.');
    load();
  }

  async function deleteProvider(id: string, name: string) {
    if (!confirm(`Remove ${name}? Their availability slots will also be deleted.`)) return;
    const res  = await fetch(`/api/org/${slug}/providers/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) { flash('Provider removed.'); load(); }
    else flash(`Error: ${data.error}`);
  }

  if (loadingData) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      {feedback && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm font-medium text-green-800">
          {feedback}
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Providers</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            The AI dynamically matches patient symptoms to these providers.
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(undefined); setShowModal(true); }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add provider
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-slate-500 mb-4">No providers yet. Add your first provider to start accepting appointments.</p>
          <button
            onClick={() => { setEditTarget(undefined); setShowModal(true); }}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add first provider
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-50">
          {providers.map(p => {
            const npRule = p.schedulingRules.find(r => r.type === 'new_patient_days') as NewPatientDaysRule | undefined;
            const boRule = p.schedulingRules.find(r => r.type === 'provider_day_blackout') as ProviderDayBlackoutRule | undefined;
            return (
              <div key={p.id} className="flex items-start justify-between px-5 py-4">
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600">
                    {p.name.split(' ').slice(-1)[0]?.charAt(0) ?? 'P'}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.credentials}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.specialties.map(s => (
                        <span key={s} className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {s}
                        </span>
                      ))}
                    </div>
                    {/* Show active provider rules as badges */}
                    {(npRule || boRule) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {npRule && (
                          <span className="inline-block rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700">
                            New pts: {npRule.days.map(d => DAY_SHORT[d]).join(', ')}
                          </span>
                        )}
                        {boRule && (
                          <span className="inline-block rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs text-red-700">
                            Off: {boRule.days.map(d => DAY_SHORT[d]).join(', ')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 ml-4">
                  <button
                    onClick={() => { setEditTarget(p); setShowModal(true); }}
                    className="rounded px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteProvider(p.id, p.name)}
                    className="rounded px-2.5 py-1 text-xs text-red-500 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <ProviderModal
          initial={editTarget}
          onSave={saveProvider}
          onClose={() => { setShowModal(false); setEditTarget(undefined); }}
          saving={saving}
        />
      )}
    </>
  );
}

// ─── Phone Tab ────────────────────────────────────────────────────────────────

function PhoneTab({ slug }: { slug: string }) {
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [provisioning,setProvisioning]= useState(false);
  const [areaCode,    setAreaCode]    = useState('415');
  const [feedback,    setFeedback]    = useState('');
  const [error,       setError]       = useState('');

  function flash(msg: string, isErr = false) {
    if (isErr) setError(msg); else setFeedback(msg);
    setTimeout(() => { setFeedback(''); setError(''); }, 6000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const res  = await fetch(`/api/org/${slug}/me`);
    const data = await res.json();
    setPhoneNumber(data.org?.vogentPhoneNumber ?? null);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  async function provision() {
    if (!confirm(
      `This will purchase a dedicated phone number (area code ${areaCode}) for this organization and provision a Vogent AI agent. Continue?`
    )) return;
    setProvisioning(true);
    setError('');
    const res  = await fetch('/api/vogent/provision', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slug, areaCode }),
    });
    const data = await res.json();
    setProvisioning(false);
    if (!res.ok) return flash(data.error ?? 'Provisioning failed', true);
    setPhoneNumber(data.phoneNumber);
    flash(`Phone number provisioned: ${data.phoneNumber}. Patients can now call this number directly.`);
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      {feedback && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Dedicated Inbound Phone Line</h2>
        <p className="text-xs text-slate-500 mb-5">
          Give your patients a direct phone number to book appointments without a browser.
          An AI agent scoped to your providers, availability, and scheduling rules handles
          the entire call — collecting patient info, matching to the right provider, and
          confirming the booking.
        </p>

        {phoneNumber ? (
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-blue-600 mb-0.5">Active phone number</p>
              <p className="text-2xl font-bold text-blue-900 tracking-wide">{phoneNumber}</p>
              <p className="mt-1 text-xs text-blue-700">
                Patients can call this number any time to schedule an appointment.
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl shrink-0 ml-4">
              📞
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center">
            <div className="text-3xl mb-2">📵</div>
            <p className="text-sm text-slate-600 font-medium mb-1">No phone number provisioned yet</p>
            <p className="text-xs text-slate-400">
              Provision a number to enable inbound phone booking for this practice.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">
          {phoneNumber ? 'Re-provision' : 'Provision a number'}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {phoneNumber
            ? 'Purchase a new number and link it to a fresh agent. The old number will be replaced.'
            : 'Purchase a dedicated inbound number via Vogent. The AI agent is automatically configured with your current providers and scheduling rules.'}
        </p>

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Preferred area code</label>
            <input
              type="text"
              maxLength={3}
              className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              value={areaCode}
              onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="415"
            />
          </div>
          <button
            onClick={provision}
            disabled={provisioning || areaCode.length !== 3}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {provisioning ? 'Provisioning…' : phoneNumber ? 'Re-provision' : 'Provision number'}
          </button>
        </div>

        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
          <strong>Note:</strong> Provisioning requires a valid <code>VOGENT_API_KEY</code> in your
          server environment. Phone numbers incur usage charges billed through Vogent.
          Agent prompts are built from your <em>current</em> providers and rules — re-provision
          if you make significant changes.
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-2">How it works</h3>
        <ol className="space-y-2 text-xs text-slate-600 list-decimal list-inside">
          <li>Patient dials the number above.</li>
          <li>Vogent&apos;s AI answers and greets the patient on behalf of {`your practice`}.</li>
          <li>The agent collects name, date of birth, phone, email, and reason for visit.</li>
          <li>It checks real-time availability for the right provider and reads out open slots.</li>
          <li>Patient confirms a time — the appointment is booked instantly in your system.</li>
          <li>A confirmation email is sent to the patient automatically.</li>
        </ol>
      </section>
    </div>
  );
}

// ─── Calls Tab ────────────────────────────────────────────────────────────────

interface CallRow {
  id:             string;
  dialId:         string;
  callerPhone:    string | null;
  status:         string;
  durationSeconds: number | null;
  patientName:    string | null;
  patientEmail:   string | null;
  reason:         string | null;
  appointmentId:  string | null;
  bookedAt:       string | null;
  startedAt:      string;
  endedAt:        string | null;
  summary:        string | null;
}

interface CallDetail extends CallRow {
  patientDob:   string | null;
  patientPhone: string | null;
  transcript:   string | null;
}

interface AppointmentDetail {
  id:          string;
  patientName: string;
  patientEmail:string;
  patientPhone:string;
  datetime:    string;
  reason:      string;
  provider:    { name: string; specialties: string[] };
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    in_progress: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    completed:   'bg-green-50  border-green-200  text-green-700',
    no_answer:   'bg-slate-100 border-slate-200  text-slate-500',
  };
  const cls = map[status] ?? map.no_answer;
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function CallDetailPane({
  callId, slug, onClose,
}: { callId: string; slug: string; onClose: () => void }) {
  const [call,        setCall]        = useState<CallDetail | null>(null);
  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    fetch(`/api/org/${slug}/calls/${callId}`)
      .then(r => r.json())
      .then(data => {
        setCall(data.call);
        setAppointment(data.appointment);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [callId, slug]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Call detail</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100 text-slate-500 text-lg leading-none">×</button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : !call ? (
          <div className="p-6 text-sm text-slate-500">Call not found.</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Status + meta */}
            <section className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 mb-1">Status</p>
                <StatusBadge status={call.status} />
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 mb-1">Duration</p>
                <p className="text-sm font-medium text-slate-800">{formatDuration(call.durationSeconds)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 mb-1">Started</p>
                <p className="text-sm font-medium text-slate-800">{formatDate(call.startedAt)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 mb-1">Caller phone</p>
                <p className="text-sm font-medium text-slate-800">{call.callerPhone ?? '—'}</p>
              </div>
            </section>

            {/* Patient info */}
            {(call.patientName || call.patientEmail || call.patientPhone || call.patientDob) && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Patient information</h3>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {(
                    [
                      ['Name',          call.patientName],
                      ['Date of birth', call.patientDob],
                      ['Phone',         call.patientPhone],
                      ['Email',         call.patientEmail],
                      ['Reason',        call.reason],
                    ] as [string, string | null][]
                  ).filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="flex gap-4 px-4 py-3 text-sm">
                      <span className="w-28 shrink-0 text-slate-500">{label}</span>
                      <span className="text-slate-800">{value}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Booking outcome */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Booking outcome</h3>
              {appointment ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600 text-lg">✓</span>
                    <span className="text-sm font-semibold text-green-800">Appointment booked</span>
                  </div>
                  <div className="text-sm text-green-700 space-y-1">
                    <p><span className="font-medium">Provider:</span> {appointment.provider.name} ({appointment.provider.specialties.join(', ')})</p>
                    <p><span className="font-medium">Time:</span> {formatDate(appointment.datetime)}</p>
                    <p><span className="font-medium">Reason:</span> {appointment.reason}</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No appointment was booked during this call.
                </div>
              )}
            </section>

            {/* AI summary */}
            {call.summary && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Call summary</h3>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
                  {call.summary}
                </div>
              </section>
            )}

            {/* Full transcript */}
            {call.transcript && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Full transcript</h3>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {call.transcript}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CallsTab({ slug }: { slug: string }) {
  const [calls,      setCalls]      = useState<CallRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offset,     setOffset]     = useState(0);
  const LIMIT = 20;

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    const res  = await fetch(`/api/org/${slug}/calls?limit=${LIMIT}&offset=${off}`);
    const data = await res.json();
    setCalls(data.calls ?? []);
    setTotal(data.total ?? 0);
    setOffset(off);
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(0); }, [load]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Inbound Call Log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {total} call{total !== 1 ? 's' : ''} recorded on this org&apos;s Vogent line.
          </p>
        </div>
        <button onClick={() => load(offset)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {calls.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-2xl mb-2">📞</p>
          <p className="text-sm text-slate-500">No calls yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Provision a phone number in the Phone tab, then patients can call in.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3 text-left">Date / time</th>
                  <th className="px-4 py-3 text-left">Patient</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Duration</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Booking</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {calls.map(call => (
                  <tr key={call.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {formatDate(call.startedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-800">{call.patientName ?? <span className="text-slate-400">Unknown</span>}</div>
                      {call.callerPhone && <div className="text-xs text-slate-400">{call.callerPhone}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-[180px] truncate">
                      {call.reason ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {formatDuration(call.durationSeconds)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="px-4 py-3">
                      {call.appointmentId ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                          <span>✓</span> Booked
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedId(call.id)}
                        className="rounded px-2.5 py-1 text-xs text-blue-600 hover:bg-blue-50"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
              <div className="flex gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => load(Math.max(0, offset - LIMIT))}
                  className="rounded border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <button
                  disabled={offset + LIMIT >= total}
                  onClick={() => load(offset + LIMIT)}
                  className="rounded border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {selectedId && (
        <CallDetailPane
          callId={selectedId}
          slug={slug}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

// ─── Practice Info Tab ────────────────────────────────────────────────────────

function PracticeTab({ slug, org }: { slug: string; org: OrgInfo }) {
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 max-w-2xl">
      <h2 className="text-sm font-semibold text-slate-800 mb-4">Practice Details</h2>
      <InfoRow label="Practice name" value={org.name} />
      <InfoRow label="Address"       value={org.address} />
      <InfoRow label="Phone"         value={org.phone} />
      <InfoRow label="Admin email"   value={org.adminEmail} />

      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-medium text-slate-600 mb-3">Hours of operation</p>
        <div className="space-y-1.5">
          {DAYS.map(day => {
            const h = org.hours?.[day];
            return (
              <div key={day} className="flex items-center gap-4 text-xs text-slate-600">
                <span className="w-24 capitalize font-medium">{day.charAt(0).toUpperCase() + day.slice(1)}</span>
                {h?.closed ? <span className="text-slate-400">Closed</span> : <span>{h?.open} – {h?.close}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-medium text-slate-600 mb-2">Patient booking link</p>
        <a href={`/org/${slug}`} className="text-sm text-blue-600 hover:underline break-all">
          {typeof window !== 'undefined' ? window.location.origin : ''}/org/{slug}
        </a>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="w-36 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-800 font-medium">{value}</span>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────

function LoginForm({ slug, onLogin }: { slug: string; onLogin: () => void }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res  = await fetch(`/api/org/${slug}/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) return setError(data.error ?? 'Login failed');
    onLogin();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">K</div>
          <span className="text-sm font-semibold text-slate-700">Admin Login</span>
        </div>
        <p className="text-xs text-slate-500 mb-5">
          Sign in to manage <span className="font-medium text-slate-700">{slug}</span>.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <input type="password" className={inputCls} value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={loading}
            className="mt-2 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-xs text-slate-400 text-center">
          Don't have an account?{' '}
          <a href="/onboarding" className="text-blue-600 hover:underline">Register your practice</a>
        </p>
      </div>
    </div>
  );
}

// ─── Dashboard shell ──────────────────────────────────────────────────────────

type TabId = 'providers' | 'rules' | 'phone' | 'calls' | 'practice';

function Dashboard({ slug, org }: { slug: string; org: OrgInfo }) {
  const [activeTab, setActiveTab] = useState<TabId>('providers');

  async function logout() {
    await fetch(`/api/org/${slug}/logout`, { method: 'POST' });
    window.location.reload();
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'providers', label: 'Providers' },
    { id: 'rules',     label: 'Scheduling Rules' },
    { id: 'phone',     label: 'Phone' },
    { id: 'calls',     label: 'Call Log' },
    { id: 'practice',  label: 'Practice Info' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
              {org.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">{org.name}</h1>
              <p className="text-xs text-slate-500">Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href={`/org/${slug}`}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Patient view
            </a>
            <button onClick={logout}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        {/* Tab bar */}
        <div className="mb-6 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-5 py-2 text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'providers' && <ProvidersTab slug={slug} />}
        {activeTab === 'rules'     && <RulesTab     slug={slug} />}
        {activeTab === 'phone'     && <PhoneTab     slug={slug} />}
        {activeTab === 'calls'     && <CallsTab     slug={slug} />}
        {activeTab === 'practice'  && <PracticeTab  slug={slug} org={org} />}
      </main>
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function OrgAdminPage() {
  const params  = useParams();
  const orgSlug = params?.slug as string;

  const [state, setState] = useState<'loading' | 'login' | 'dashboard'>('loading');
  const [org,   setOrg]   = useState<OrgInfo | null>(null);

  const checkAuth = useCallback(async () => {
    if (!orgSlug) return;
    const res = await fetch(`/api/org/${orgSlug}/me`);
    if (res.ok) {
      const data = await res.json();
      setOrg(data.org);
      setState('dashboard');
    } else {
      setState('login');
    }
  }, [orgSlug]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (state === 'login') {
    return <LoginForm slug={orgSlug} onLogin={checkAuth} />;
  }

  return <Dashboard slug={orgSlug} org={org!} />;
}

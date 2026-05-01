'use client';

import { useEffect, useState } from 'react';

interface Slot {
  id:       string;
  datetime: string;
  isBooked: boolean;
}

interface Doctor {
  id:           string;
  name:         string;
  specialty:    string;
  availability: Slot[];
}

interface Patient {
  id:           string;
  patientName:  string;
  patientPhone: string;
  patientEmail: string;
  patientDob:   string;
  datetime:     string;
  doctor:       { name: string; specialty: string };
}

function formatDt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ── Doctors tab ───────────────────────────────────────────────────────────────

function DoctorsTab() {
  const [doctors, setDoctors]         = useState<Doctor[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<string>('');
  const [newSlotDate, setNewSlotDate] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('09:00');
  const [saving, setSaving]           = useState(false);
  const [feedback, setFeedback]       = useState('');

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 3000);
  }

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/doctors');
    const data = await res.json();
    setDoctors(data.doctors);
    if (!selected && data.doctors.length) setSelected(data.doctors[0].id);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const doctor = doctors.find(d => d.id === selected);

  async function addSlot() {
    if (!newSlotDate || !selected) return;
    setSaving(true);
    const datetime = `${newSlotDate}T${newSlotTime}:00`;
    const res = await fetch('/api/admin/availability', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ doctorId: selected, datetime }),
    });
    const data = await res.json();
    if (res.ok) { flash('Slot added!'); load(); }
    else flash(`Error: ${data.error}`);
    setSaving(false);
  }

  async function deleteSlot(slotId: string) {
    if (!confirm('Delete this slot?')) return;
    const res = await fetch('/api/admin/availability', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slotId }),
    });
    const data = await res.json();
    if (res.ok) { flash('Slot removed.'); load(); }
    else flash(`Error: ${data.error}`);
  }

  async function toggleBooked(slot: Slot) {
    const res = await fetch('/api/admin/availability', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slotId: slot.id, isBooked: !slot.isBooked }),
    });
    const data = await res.json();
    if (res.ok) { flash('Updated!'); load(); }
    else flash(`Error: ${data.error}`);
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Doctor selector sidebar */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Doctors</h2>
          {doctors.map(d => (
            <button
              key={d.id}
              onClick={() => setSelected(d.id)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                selected === d.id
                  ? 'border-blue-500 bg-blue-50 text-blue-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="font-medium text-sm">{d.name}</div>
              <div className="text-xs text-slate-500">{d.specialty}</div>
              <div className="mt-1 text-xs text-slate-400">
                {d.availability.filter(s => !s.isBooked && new Date(s.datetime) > new Date()).length} open slots
              </div>
            </button>
          ))}
        </div>

        {/* Availability panel */}
        {doctor && (
          <div className="lg:col-span-3 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold text-slate-800">Add availability slot for {doctor.name}</h2>
              <div className="flex flex-wrap gap-3">
                <input
                  type="date"
                  value={newSlotDate}
                  onChange={e => setNewSlotDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={newSlotTime}
                  onChange={e => setNewSlotTime(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  onClick={addSlot}
                  disabled={saving || !newSlotDate}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-blue-700"
                >
                  {saving ? 'Adding…' : 'Add slot'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-800">
                  Upcoming slots — {doctor.name}
                </h2>
              </div>
              <div className="divide-y divide-slate-50">
                {doctor.availability
                  .filter(s => new Date(s.datetime) >= new Date())
                  .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
                  .slice(0, 60)
                  .map(slot => (
                    <div key={slot.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <span className="text-sm text-slate-800">{formatDt(slot.datetime)}</span>
                        <span className={`ml-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          slot.isBooked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {slot.isBooked ? 'Booked' : 'Available'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleBooked(slot)}
                          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                        >
                          {slot.isBooked ? 'Mark open' : 'Mark booked'}
                        </button>
                        {!slot.isBooked && (
                          <button
                            onClick={() => deleteSlot(slot.id)}
                            className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                {doctor.availability.filter(s => new Date(s.datetime) >= new Date()).length === 0 && (
                  <p className="px-5 py-6 text-sm text-slate-400">No upcoming slots. Add one above.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Patients tab ──────────────────────────────────────────────────────────────

function PatientsTab() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading]   = useState(true);
  const [feedback, setFeedback] = useState('');

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 3000);
  }

  async function load() {
    setLoading(true);
    const res = await fetch('/api/patients');
    const data = await res.json();
    setPatients(data.patients ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function deletePatient(id: string, name: string) {
    if (!confirm(`Delete patient record for ${name}? This will also free their appointment slot.`)) return;
    const res = await fetch(`/api/patients/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) { flash('Patient deleted and slot freed.'); load(); }
    else flash(`Error: ${data.error}`);
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
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
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">All Patients ({patients.length})</h2>
        </div>
        {patients.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">No patient records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Date of Birth</th>
                  <th className="px-5 py-3">Appointment</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {patients.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">{p.patientName}</td>
                    <td className="px-5 py-3 text-slate-600">{p.patientPhone}</td>
                    <td className="px-5 py-3 text-slate-600">{p.patientEmail}</td>
                    <td className="px-5 py-3 text-slate-600">{p.patientDob}</td>
                    <td className="px-5 py-3">
                      <div className="text-slate-800">{p.doctor.name}</div>
                      <div className="text-xs text-slate-400">{formatDt(p.datetime)}</div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => deletePatient(p.id, p.patientName)}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

type Tab = 'doctors' | 'patients';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('doctors');

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
            <p className="text-sm text-slate-500">Manage doctor availability — changes take effect immediately</p>
          </div>
          <a href="/" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ← Back to chat
          </a>
        </div>

        {/* Tab bar */}
        <div className="mb-6 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
          {(['doctors', 'patients'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-5 py-2 text-sm font-medium capitalize transition ${
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'doctors' ? <DoctorsTab /> : <PatientsTab />}
      </div>
    </div>
  );
}

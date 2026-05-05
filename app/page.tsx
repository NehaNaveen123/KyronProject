/**
 * / — Kyron Medical landing page.
 *
 * Lists all registered organizations so patients can navigate to the
 * right org's scheduling page (/org/[slug]).
 */
'use client';

import { useEffect, useState } from 'react';

interface OrgCard {
  name:               string;
  slug:               string;
  address:            string;
  phone:              string;
  vogentPhoneNumber?: string | null;
  _count:             { providers: number };
}

export default function LandingPage() {
  const [orgs,    setOrgs]    = useState<OrgCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/orgs')
      .then(r => r.json())
      .then(data => { setOrgs(data.orgs ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* ── Nav ── */}
      <nav className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">K</div>
            <span className="text-sm font-semibold text-slate-800">Kyron Medical</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/onboarding"
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
              Register your practice
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-5xl px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-100 px-4 py-1.5 text-xs font-medium text-blue-700 mb-6">
          AI-Powered Medical Scheduling
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-4 leading-tight">
          Book appointments with<br />the right provider — instantly
        </h1>
        <p className="text-lg text-slate-500 max-w-xl mx-auto">
          Choose your practice below to start scheduling via chat or phone.
          No hold music. No web forms.
        </p>
      </section>

      {/* ── Org cards ── */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-500 mb-4">No practices registered yet.</p>
            <a href="/onboarding"
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
              Register the first practice →
            </a>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orgs.map(org => (
              <div key={org.slug}
                className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-blue-200 transition-all">
                {/* Avatar */}
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-lg font-bold text-blue-600">
                  {org.name.split(' ').slice(0, 2).map((w: string) => w[0]).join('')}
                </div>

                <h2 className="text-base font-semibold text-slate-900 mb-1">{org.name}</h2>
                <p className="text-xs text-slate-500 mb-1">{org.address}</p>
                <p className="text-xs text-slate-500 mb-3">{org.phone}</p>

                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                    {org._count.providers} provider{org._count.providers !== 1 ? 's' : ''}
                  </span>
                  {org.vogentPhoneNumber && (
                    <span className="inline-block rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs text-green-700">
                      Phone booking available
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <a href={`/org/${org.slug}`}
                    className="flex-1 rounded-lg bg-blue-600 py-2 text-center text-xs font-medium text-white hover:bg-blue-700 transition">
                    Book via chat →
                  </a>
                  {org.vogentPhoneNumber && (
                    <a href={`tel:${org.vogentPhoneNumber}`}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition">
                      📞
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 bg-white px-6 py-8">
        <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">K</div>
            <span className="text-sm text-slate-500">Kyron Medical © 2025</span>
          </div>
          <div className="flex gap-4 text-xs text-slate-400">
            <a href="/onboarding" className="hover:text-slate-600">Register a practice</a>
            <a href="/admin"      className="hover:text-slate-600">Platform admin</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

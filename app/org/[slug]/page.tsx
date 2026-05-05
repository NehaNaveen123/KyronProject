'use client';

/**
 * /org/[slug] — patient-facing chat + phone page for a specific organization.
 *
 * - Fetches real org name/phone/address from /api/org/[slug]/info
 * - Sends orgSlug with every message so the AI scopes to this org
 * - Shows the VoiceHandoffButton (Vapi browser call) in the header
 * - Shows the org's dedicated inbound phone number if provisioned
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import ChatBubble from '@/components/ChatBubble';
import ChatInput from '@/components/ChatInput';
import VoiceHandoffButton from '@/components/VoiceHandoffButton';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface OrgInfo {
  name:               string;
  phone:              string;
  address:            string;
  vogentPhoneNumber?: string | null;
}

export default function OrgChatPage() {
  const params  = useParams();
  const orgSlug = params?.slug as string;

  const [sessionId, setSessionId] = useState('');
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [orgInfo,   setOrgInfo]   = useState<OrgInfo | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [hydrated,  setHydrated]  = useState(false);
  const [notFound,  setNotFound]  = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orgSlug) return;

    fetch(`/api/org/${orgSlug}/info`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setOrgInfo(data.org);

        const welcome: Message = {
          role: 'assistant',
          content: `Hello! I'm the scheduling assistant for ${data.org.name}. I'm here to help you book an appointment with one of our providers. To get started, could I get your first and last name?`,
        };

        const key    = `kyron_session_${orgSlug}`;
        const stored = localStorage.getItem(key) ?? uuidv4();
        localStorage.setItem(key, stored);
        setSessionId(stored);

        fetch(`/api/conversation?sessionId=${stored}`)
          .then(r => r.json())
          .then(conv => {
            setMessages(conv.messages?.length ? conv.messages : [welcome]);
            setHydrated(true);
          })
          .catch(() => { setMessages([welcome]); setHydrated(true); });
      })
      .catch(() => { setNotFound(true); });
  }, [orgSlug]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, message: text.trim(), orgSlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  function startNewSession() {
    const key   = `kyron_session_${orgSlug}`;
    const newId = uuidv4();
    localStorage.setItem(key, newId);
    setSessionId(newId);
    setMessages([{
      role:    'assistant',
      content: `Hello! I'm the scheduling assistant for ${orgInfo?.name ?? orgSlug}. To get started, could I get your first and last name?`,
    }]);
  }

  if (notFound) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Practice not found</h1>
          <p className="text-slate-500 mb-6">The organization &quot;{orgSlug}&quot; doesn&apos;t exist on Kyron.</p>
          <a href="/onboarding" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
            Register your practice →
          </a>
        </div>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  const initials = orgInfo?.name
    ? orgInfo.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : 'K';

  return (
    <div className="flex h-screen flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
            {initials}
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">{orgInfo?.name ?? orgSlug}</h1>
            <p className="text-xs text-slate-500">Appointment Scheduling</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Vapi browser voice handoff */}
          <VoiceHandoffButton sessionId={sessionId} />

          {orgInfo?.vogentPhoneNumber && (
            <a
              href={`tel:${orgInfo.vogentPhoneNumber}`}
              className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" />
              </svg>
              Call {orgInfo.vogentPhoneNumber}
            </a>
          )}

          <button
            onClick={startNewSession}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            New session
          </button>
          <a
            href={`/org/${orgSlug}/admin`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Admin
          </a>
        </div>
      </header>

      {/* ── Chat history ── */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg, i) => (
            <ChatBubble key={i} role={msg.role} content={msg.content} />
          ))}

          {loading && (
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                AI
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                <span className="inline-flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── Input ── */}
      <div className="border-t border-slate-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <ChatInput onSend={sendMessage} disabled={loading} />
        </div>
      </div>
    </div>
  );
}

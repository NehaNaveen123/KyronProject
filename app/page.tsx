/**
 * Main chat page — loads session from localStorage, restores history on mount.
 * This is a client component because it manages localStorage + state.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ChatBubble from '@/components/ChatBubble';
import ChatInput from '@/components/ChatInput';
import VoiceHandoffButton from '@/components/VoiceHandoffButton';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME: Message = {
  role:    'assistant',
  content: "Hello! I'm the Kyron Medical scheduling assistant. I'm here to help you book an appointment with one of our specialists. To get started, could I get your first and last name?",
};

export default function ChatPage() {
  const [sessionId, setSessionId]   = useState<string>('');
  const [messages,  setMessages]    = useState<Message[]>([]);
  const [loading,   setLoading]     = useState(false);
  const [hydrated,  setHydrated]    = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Initialise session & restore history ────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('kyron_session_id') ?? uuidv4();
    localStorage.setItem('kyron_session_id', stored);
    setSessionId(stored);

    fetch(`/api/conversation?sessionId=${stored}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages?.length) {
          setMessages(data.messages);
        } else {
          setMessages([WELCOME]);
        }
        setHydrated(true);
      })
      .catch(() => {
        setMessages([WELCOME]);
        setHydrated(true);
      });
  }, []);

  // ── Auto-scroll on new messages ─────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── Send a message ──────────────────────────────────────────────────────────
  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, message: text.trim() }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? 'Request failed');

      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role:    'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // ── Reset session ───────────────────────────────────────────────────────────
  function startNewSession() {
    const newId = uuidv4();
    localStorage.setItem('kyron_session_id', newId);
    setSessionId(newId);
    setMessages([WELCOME]);
  }

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
            K
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Kyron Medical</h1>
            <p className="text-xs text-slate-500">Appointment Scheduling</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <VoiceHandoffButton sessionId={sessionId} />
          <button
            onClick={startNewSession}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            New session
          </button>
          <a
            href="/admin"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Admin
          </a>
        </div>
      </header>

      {/* ── Chat history ── */}
      <main className="chat-scroll flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg, i) => (
            <ChatBubble key={i} role={msg.role} content={msg.content} />
          ))}

          {/* Typing indicator */}
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

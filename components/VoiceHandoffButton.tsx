/**
 * Voice handoff button — initiates a Vapi voice call from the browser.
 *
 * Flow:
 *  1. User clicks "Continue via phone"
 *  2. We call /api/voice-handoff (server returns context-aware assistant config)
 *  3. We use the @vapi-ai/web SDK to create/start the call in-browser
 *  4. An overlay shows call state (connecting / in-call / ended)
 */
'use client';

import { useState } from 'react';

interface Props {
  sessionId: string;
}

type CallState = 'idle' | 'loading' | 'active' | 'ended' | 'error';

type VoiceHandoffResponse = {
  assistantConfig?: Record<string, unknown>;
  error?: string;
};

export default function VoiceHandoffButton({ sessionId }: Props) {
  const [state, setState]     = useState<CallState>('idle');
  const [error, setError]     = useState('');
  const [vapiInstance, setVapiInstance] = useState<unknown>(null);

  async function startVoiceCall() {
    if (!sessionId) return;
    setState('loading');
    setError('');

    try {
      // 1. Ask server to create a Vapi web call (gets us a token/URL)
      const res  = await fetch('/api/voice-handoff', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sessionId, mode: 'web' }),
      });
      const data = await res.json() as VoiceHandoffResponse;

      if (!res.ok) {
        setError(data.error ?? 'Failed to start voice call');
        setState('error');
        return;
      }

      if (!data.assistantConfig) {
        setError('Voice service did not return an assistant configuration.');
        setState('error');
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
      if (!publicKey) {
        setError('Voice service is not configured (NEXT_PUBLIC_VAPI_PUBLIC_KEY missing).');
        setState('error');
        return;
      }

      // 2. Dynamically import Vapi SDK (avoids SSR issues)
      const { default: Vapi } = await import('@vapi-ai/web');
      const vapi = new Vapi(publicKey);

      vapi.on('call-start', () => setState('active'));
      vapi.on('call-end',   () => setState('ended'));
      vapi.on('error',      (e: unknown) => {
        console.error('Vapi error', e);
        setError('Call encountered an error.');
        setState('error');
      });

      // 3. Start the call with an inline assistant config, per Vapi Web SDK docs.
      await vapi.start(data.assistantConfig as never);
      setVapiInstance(vapi);
      setState('active');
    } catch (err) {
      console.error(err);
      setError('Could not start voice call. Please try again.');
      setState('error');
    }
  }

  function endCall() {
    if (vapiInstance && typeof (vapiInstance as { stop?: () => void }).stop === 'function') {
      (vapiInstance as { stop: () => void }).stop();
    }
    setState('ended');
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={startVoiceCall}
        disabled={state === 'loading' || state === 'active'}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        {/* Phone icon */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-green-600">
          <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" />
        </svg>
        {state === 'loading' ? 'Connecting…' : 'Continue via phone'}
      </button>

      {/* Overlay modal when call is active */}
      {(state === 'active' || state === 'ended' || state === 'error') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-2xl">
            {state === 'active' && (
              <>
                <div className="mb-4 flex items-center justify-center">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <div className="absolute h-full w-full animate-ping rounded-full bg-green-200 opacity-75" />
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="relative h-8 w-8 text-green-600">
                      <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.465 1.175l.716 3.223a1.5 1.5 0 01-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 006.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 011.767-1.052l3.223.716A1.5 1.5 0 0118 15.352V16.5a1.5 1.5 0 01-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 012.43 8.326 13.019 13.019 0 012 5V3.5z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
                <h2 className="mb-1 text-center text-lg font-semibold text-slate-900">Voice call active</h2>
                <p className="mb-5 text-center text-sm text-slate-500">The AI is continuing your conversation via voice.</p>
                <button
                  onClick={endCall}
                  className="w-full rounded-xl bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600"
                >
                  End call
                </button>
              </>
            )}

            {state === 'ended' && (
              <>
                <h2 className="mb-2 text-center text-lg font-semibold text-slate-900">Call ended</h2>
                <p className="mb-5 text-center text-sm text-slate-500">Your conversation has been saved. You can continue in chat.</p>
                <button
                  onClick={() => setState('idle')}
                  className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Back to chat
                </button>
              </>
            )}

            {state === 'error' && (
              <>
                <h2 className="mb-2 text-center text-lg font-semibold text-slate-900">Connection failed</h2>
                <p className="mb-5 text-center text-sm text-slate-500">{error}</p>
                <button
                  onClick={() => setState('idle')}
                  className="w-full rounded-xl bg-slate-700 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

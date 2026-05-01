/**
 * A single chat message bubble.
 * User messages: right-aligned, blue background.
 * AI messages:   left-aligned, white card.
 */

interface Props {
  role:    'user' | 'assistant';
  content: string;
}

export default function ChatBubble({ role, content }: Props) {
  const isUser = role === 'user';

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          isUser
            ? 'bg-slate-700 text-white'
            : 'bg-blue-100 text-blue-700'
        }`}
      >
        {isUser ? 'You' : 'AI'}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'rounded-tr-sm bg-blue-600 text-white shadow-sm'
            : 'rounded-tl-sm bg-white text-slate-800 shadow-sm'
        }`}
        // Preserve newlines from the AI's response
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {content}
      </div>
    </div>
  );
}

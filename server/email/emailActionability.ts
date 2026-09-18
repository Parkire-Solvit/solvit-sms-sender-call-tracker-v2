import type { GraphMessage } from './graphClient';

// Do not blanket-exclude "noreply": insurer assignment messages can require action.
export function emailExclusionReason(message: GraphMessage): string | null {
  const sender=(message.from?.emailAddress?.address || '').trim().toLowerCase();
  const subject=message.subject || '';
  if (sender === 'no-reply@outlook.mail.microsoft' && /^Reaction Daily Digest\s*-/i.test(subject)) return 'Microsoft reaction digest';
  if (/^(?:automatic reply\s*:|out of office\b)/i.test(subject)) return 'Automatic out-of-office reply';
  const automatic=message.internetMessageHeaders?.find(h => h.name.toLowerCase()==='auto-submitted')?.value.trim().toLowerCase();
  if (automatic === 'auto-replied') return 'Auto-Submitted: auto-replied';
  return null;
}

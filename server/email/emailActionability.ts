import type { GraphMessage } from './graphClient';

export function emailExclusionReason(message: GraphMessage): string | null {
  const sender=(message.from?.emailAddress?.address || '').trim().toLowerCase();
  const subject=message.subject || '';
  const senderLocalPart=sender.split('@',1)[0] || '';
  if (/^(?:no[-._]?reply|do[-._]?not[-._]?reply)$/.test(senderLocalPart)) return 'No-reply sender';
  if (sender === 'no-reply@outlook.mail.microsoft' && /^Reaction Daily Digest\s*-/i.test(subject)) return 'Microsoft reaction digest';
  if (/^(?:automatic reply\s*:|out of office\b)/i.test(subject)) return 'Automatic out-of-office reply';
  const automatic=message.internetMessageHeaders?.find(h => h.name.toLowerCase()==='auto-submitted')?.value.trim().toLowerCase();
  if (automatic === 'auto-replied') return 'Auto-Submitted: auto-replied';
  return null;
}

export function emailDurationLabel(workingMinutes: number): string {
  const total = Math.max(0, Math.ceil(workingMinutes));
  const days = Math.floor(total / 540);
  const hours = Math.floor((total % 540) / 60);
  const minutes = total % 60;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : ''].filter(Boolean).join(' ') || '0m';
}

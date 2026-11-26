const dateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

/** "26 thg 11, 2026, 10:30". */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * "5 phút trước", "hôm qua"; "vừa xong" under a minute. Lowercase, since it is used mid-sentence
 * ("Hoạt động hôm qua") and ICU capitalizes some Vietnamese phrases ("Hôm qua").
 */
export function formatRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) {
      return relative.format(Math.round(diff / ms), unit).toLocaleLowerCase('vi-VN');
    }
  }
  return 'vừa xong';
}

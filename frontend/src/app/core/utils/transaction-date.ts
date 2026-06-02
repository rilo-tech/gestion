/** Valor YYYY-MM-DD para `<input type="date">`. */
export function toDateInputValue(value?: string | null): string {
  if (!value) return todayDateInputValue();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateInputValue(): string {
  return toDateInputValue(new Date().toISOString());
}

/** Valor HH:mm para `<input type="time">`. */
export function toTimeInputValue(value?: string | null): string {
  if (!value) return currentTimeInputValue();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '12:00';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function currentTimeInputValue(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Convierte YYYY-MM-DD (o ISO) a ISO con mediodía UTC. */
export function dateInputToIso(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`).toISOString();
  }
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

/** Combina YYYY-MM-DD y HH:mm en ISO (hora local). */
export function combineDateAndTimeToIso(
  dateValue: string | null | undefined,
  timeValue?: string | null
): string {
  const datePart = String(dateValue ?? '').trim().slice(0, 10);
  const timeRaw = String(timeValue ?? '12:00').trim() || '12:00';
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeRaw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const date = new Date(`${datePart}T00:00:00`);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  }
  return dateInputToIso(dateValue);
}

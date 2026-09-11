/**
 * Utilidades canónicas de manejo de fecha y hora local para BarberTrack PRO.
 * Garantiza que la hora y fecha mostradas y consultadas correspondan exactamente
 * a la zona horaria del usuario (ej: Perú UTC-5), evitando desfasajes producidos
 * por toISOString() que convierte a UTC (GMT+0).
 */

/**
 * Obtiene la fecha local en formato 'YYYY-MM-DD' respetando la zona horaria del dispositivo.
 * @param d Instancia de Date opcional (por defecto: ahora)
 */
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Obtiene la hora local en formato 'HH:mm' respetando la zona horaria del dispositivo.
 * @param d Instancia de Date opcional (por defecto: ahora)
 */
export function getLocalTimeString(d: Date = new Date()): string {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Suma o resta días a una fecha en formato 'YYYY-MM-DD' de forma determinista y libre de desfaces de zona horaria.
 */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
}

/**
 * Devuelve el nombre corto del día en español (ej: 'Lun', 'Mar', 'Mié').
 */
export function getDayName(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const names = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return names[date.getDay()];
}

/**
 * Devuelve el nombre corto del mes en español (ej: 'Ene', 'Feb', 'Mar').
 */
export function getMonthShortName(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return months[date.getMonth()];
}

/**
 * Formatea una fecha 'YYYY-MM-DD' en formato largo y elegante en español.
 * Ej: "Jueves, 10 de Septiembre 2026"
 */
export function formatDateReadable(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Determina si una fecha en formato 'YYYY-MM-DD' es estrictamente anterior al día de hoy.
 */
export function isDateInPast(dateStr: string, now: Date = new Date()): boolean {
  return dateStr < getLocalDateString(now);
}

/**
 * Determina si una fecha y hora específica ya transcurrió respecto a la hora local actual.
 * Si la fecha es pasada, devuelve true.
 * Si la fecha es futura, devuelve false.
 * Si la fecha es hoy, compara si la hora (HH:mm) es menor o igual a la hora actual.
 */
export function isPastDateTime(dateStr: string, timeStr: string, now: Date = new Date()): boolean {
  const today = getLocalDateString(now);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return timeStr <= getLocalTimeString(now);
}

/**
 * Convierte cualquier string de fecha (ISO, UTC, etc.) a fecha local 'YYYY-MM-DD'.
 */
export function getLocalDateFromIso(isoDateStr: string): string {
  if (!isoDateStr) return '';
  try {
    const d = new Date(isoDateStr);
    if (isNaN(d.getTime())) return isoDateStr.slice(0, 10);
    return getLocalDateString(d);
  } catch {
    return isoDateStr.slice(0, 10);
  }
}

/**
 * Determina si una fecha ISO o string corresponde exactamente a la fecha local indicada (por defecto hoy).
 */
export function isSameLocalDate(isoDateStr: string, targetDateStr: string = getLocalDateString()): boolean {
  if (!isoDateStr) return false;
  return getLocalDateFromIso(isoDateStr) === targetDateStr;
}

/**
 * Determina si una fecha ISO o string corresponde al mismo mes y año local (YYYY-MM).
 */
export function isSameLocalYearMonth(isoDateStr: string, targetYearMonth: string = getLocalDateString().slice(0, 7)): boolean {
  if (!isoDateStr) return false;
  return getLocalDateFromIso(isoDateStr).startsWith(targetYearMonth);
}

/**
 * Determina si una fecha ISO se encuentra dentro de los últimos N días desde hoy.
 */
export function isDateWithinPastDays(isoDateStr: string, days: number, now: Date = new Date()): boolean {
  if (!isoDateStr) return false;
  try {
    const targetDate = new Date(isoDateStr);
    const diffMs = now.getTime() - targetDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= days;
  } catch {
    return false;
  }
}


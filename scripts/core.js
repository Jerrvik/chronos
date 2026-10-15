/** Chronos pure state/time helpers. No Foundry or DOM dependency. */
export const MODULE_ID = 'chronos';
export const INITIAL_ISO = '1998-09-05T22:35:00.000Z';
export const PUBLIC_DEFAULT = Object.freeze({
  schema: 1,
  revision: 0,
  iso: INITIAL_ISO,
  dawn: '06:00',
  dusk: '19:00',
  nextNight: '20:00',
  events: [],
  timers: []
});
export const PRIVATE_DEFAULT = Object.freeze({events: [], timers: [], aliases: {}, spotlight: null});

export function clone(value) { return structuredClone(value); }
export function publicState(raw) {
  if (!raw || typeof raw !== 'object') return clone(PUBLIC_DEFAULT);
  return {
    ...clone(PUBLIC_DEFAULT),
    iso: validIso(raw.iso) ? raw.iso : INITIAL_ISO,
    revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    dawn: validClock(raw.dawn) ? raw.dawn : '06:00',
    dusk: validClock(raw.dusk) ? raw.dusk : '19:00',
    nextNight: validClock(raw.nextNight) ? raw.nextNight : '20:00',
    events: Array.isArray(raw.events) ? raw.events : [],
    timers: Array.isArray(raw.timers) ? raw.timers : []
  };
}
export function privateState(raw) {
  if (!raw || typeof raw !== 'object') return clone(PRIVATE_DEFAULT);
  return {
    events: Array.isArray(raw.events) ? raw.events : [],
    timers: Array.isArray(raw.timers) ? raw.timers : [],
    aliases: raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : {},
    spotlight: raw.spotlight && typeof raw.spotlight === 'object' ? raw.spotlight : null
  };
}
export function validIso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
export function validClock(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function safeText(value, max = 120) { return String(value ?? '').trim().slice(0, max); }
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
export function uuid() { return globalThis.crypto?.randomUUID?.() || `ch-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

/** UTC is an intentional timezone-neutral game calendar; clients never use their local zone. */
export function setDateTime(dateValue, hhmm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !validClock(hhmm)) throw new Error('Неверная дата или время');
  const iso = `${dateValue}T${hhmm}:00.000Z`;
  if (!validIso(iso) || new Date(iso).toISOString() !== iso) throw new Error('Несуществующая дата');
  return iso;
}
export function shiftMinutes(iso, minutes) {
  const ms = new Date(iso).getTime() + minutes * 60_000;
  if (!Number.isFinite(ms)) throw new Error('Неверный интервал');
  return new Date(ms).toISOString();
}
export function nextNight(iso, hhmm) {
  if (!validClock(hhmm)) throw new Error('Неверное время начала ночи');
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + 1);
  const [h, m] = hhmm.split(':').map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
}
export function isNight(iso, dawn, dusk) {
  const hhmm = new Date(iso).toISOString().slice(11, 16);
  return dawn < dusk ? hhmm < dawn || hhmm >= dusk : (hhmm >= dusk && hhmm < dawn);
}
export function formatGame(iso, full = false) {
  const options = full
    ? {weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'UTC', hour12:false}
    : {day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'UTC', hour12:false};
  return new Intl.DateTimeFormat('ru-RU', options).format(new Date(iso));
}
export function isoDate(iso) { return new Date(iso).toISOString().slice(0, 10); }
export function isoClock(iso) { return new Date(iso).toISOString().slice(11, 16); }
export function eventInstant(event) {
  return Date.parse(`${event.date}T${validClock(event.time) ? event.time : '00:00'}:00.000Z`);
}
export function crossedEvents(beforeIso, afterIso, events) {
  const before = Date.parse(beforeIso), after = Date.parse(afterIso);
  if (after <= before) return [];
  return events.filter(e => {const t = eventInstant(e); return Number.isFinite(t) && before < t && t <= after;});
}
export function timerRemaining(t, now = Date.now()) {
  if (t.mode !== 'real') return 0;
  return Math.max(0, t.running ? (Number(t.endsAt) || now) - now : Number(t.remainingMs) || 0);
}
export function timerProgress(t, now = Date.now()) {
  if (t.mode === 'real') {
    const duration = Math.max(1000, Number(t.durationMs) || 1000);
    return Math.max(0, Math.min(1, 1 - timerRemaining(t, now) / duration));
  }
  return Math.max(0, Math.min(1, (Number(t.value) || 0) / Math.max(1, Number(t.max) || 1)));
}
export function timerChange(t, action, now = Date.now()) {
  const next = clone(t);
  if (next.mode === 'real') {
    const remaining = timerRemaining(next, now);
    if (action === 'toggle') {
      if (next.running) { next.running = false; next.remainingMs = remaining; next.endsAt = null; }
      else if (remaining > 0) { next.running = true; next.endsAt = now + remaining; }
    }
    if (action === 'reset') { next.running = false; next.endsAt = null; next.remainingMs = next.durationMs; }
  } else {
    const delta = action === 'plus' ? 1 : action === 'minus' ? -1 : 0;
    next.value = action === 'reset' ? 0 : Math.max(0, Math.min(next.max, (next.value || 0) + delta));
  }
  return next;
}
export function timerCaption(t, now=Date.now()) {
  if (t.mode === 'real') {
    const s = Math.ceil(timerRemaining(t, now) / 1000);
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }
  return `${t.value ?? 0} / ${t.max ?? 1}`;
}
export function createTimer({name, mode='steps', visibility='named', max=6, minutes=5, numbers=false, effect='none'}, now=Date.now()) {
  const durationMs = Math.max(1, Math.min(240, Number(minutes)||5)) * 60_000;
  return {
    id: uuid(), name: safeText(name,80) || 'Без названия', mode,
    visibility, max: Math.max(2,Math.min(20, Number(max)||6)), value: 0,
    durationMs, remainingMs: durationMs, endsAt:null, running:false,
    numbers: Boolean(numbers), effect: ['none','bell','heartbeat','tension'].includes(effect) ? effect : 'none',
    createdAt: now
  };
}
/** Public synchronization must never contain private names, notes, or GM spotlight. */
export function publicTimer(timer) {
  const result = clone(timer);
  if (result.visibility === 'gm') return null;
  if (result.visibility === 'anonymous') result.name = 'Неизвестная угроза';
  delete result.description;
  return result;
}
export function spotlightRemaining(s, now = Date.now()) {
  if (!s) return 0;
  return Math.max(0, s.running ? (Number(s.endsAt) || now)-now : Number(s.remainingMs)||0);
}
export function spotlightChange(s, action, now=Date.now()) {
  const t = clone(s);
  const rem = spotlightRemaining(t, now);
  if (action === 'toggle') {
    if (t.running) {t.running = false; t.remainingMs = rem; t.endsAt = null;}
    else if(rem>0){t.running=true;t.endsAt=now+rem;}
  }
  if (action === 'reset') {t.running=false;t.remainingMs=t.durationMs;t.endsAt=null;t.notified=false;}
  if (action === 'plus') {t.remainingMs=rem+60_000;if(t.running)t.endsAt=now+t.remainingMs;}
  return t;
}

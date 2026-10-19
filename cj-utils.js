/* ============================================================
   Closer Journey: utilidades compartilhadas (sem dependencias)
   Usado por embarque.html e admin.html
   ============================================================ */

export const TZ = 'America/Sao_Paulo';

/* ---------- tipos de encontro ---------- */
export const EVENT_TYPES = {
  hotseat:  { label: 'Hotseat',      cls: 't-hotseat'  },
  roleplay: { label: 'Roleplay',     cls: 't-roleplay' },
  aula:     { label: 'Aula ao vivo', cls: 't-aula'     },
  outro:    { label: 'Outro',        cls: 't-outro'    }
};
export const typeLabel = (t) => (EVENT_TYPES[t] || EVENT_TYPES.outro).label;
export const typeCls   = (t) => (EVENT_TYPES[t] || EVENT_TYPES.outro).cls;

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/* ---------- texto seguro ---------- */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function linkify(text) {
  return esc(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

export function safeUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/* ---------- videos (YouTube / Vimeo) ---------- */
export function parseVideo(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  } catch {
    return { kind: 'link', url: input };
  }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = null;

  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0];
  } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') {
      id = u.searchParams.get('v');
    } else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{6,})/);
      if (m) id = m[2];
    }
  }
  if (id && /^[\w-]{6,}$/.test(id)) {
    return {
      kind: 'youtube',
      id,
      url: u.href,
      embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d{5,})(?:\/([\w]+))?/);
    if (m) {
      const h = m[2] || u.searchParams.get('h');
      return {
        kind: 'vimeo',
        id: m[1],
        url: u.href,
        embed: `https://player.vimeo.com/video/${m[1]}${h ? '?h=' + h : ''}`
      };
    }
  }
  return { kind: 'link', url: u.href };
}

/* ---------- datas (tudo em horario de Brasilia) ---------- */
const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

export function brParts(date) {
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/* Brasil nao tem horario de verao desde 2019: UTC-03:00 fixo */
export const fromBr = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr}:00-03:00`);

export const todayKey = () => brParts(new Date()).date;

export function fmtTime(date) {
  const [h, m] = brParts(date).time.split(':');
  return m === '00' ? `${h}h` : `${h}h${m}`;
}

export function fmtDMY(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDay(date) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

export function fmtShort(date) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' })
    .format(date).replace('.', '');
}

export function fmtLong(date) {
  return `${fmtDay(date)} às ${fmtTime(date)} (horário de Brasília)`;
}

export const dayLabel = (dateStr) => {
  const wd = WEEKDAYS[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
  return `${wd}, ${fmtDMY(dateStr)}`;
};

/* Gera datas recorrentes: primeira ocorrencia do dia da semana a partir de startDate */
export function genDates(startDate, weekday, stepDays, count) {
  const d = new Date(startDate + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return [];
  let guard = 0;
  while (d.getUTCDay() !== Number(weekday) && guard++ < 8) d.setUTCDate(d.getUTCDate() + 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + stepDays);
  }
  return out;
}

/* ---------- calendario mensal ---------- */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = first.getUTCDay();
  const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rows = Math.ceil((offset + dim) / 7);
  const cells = [];
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(Date.UTC(year, month, 1 - offset + i));
    cells.push({ key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month });
  }
  return cells;
}

export function monthLabel(year, month) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month, 1)));
}

export function renderCalendar({ year, month, events, today }) {
  const byDay = {};
  for (const ev of events) {
    const k = brParts(ev.start).date;
    (byDay[k] = byDay[k] || []).push(ev);
  }
  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  const body = monthGrid(year, month).map((c) => {
    const evs = (byDay[c.key] || []).sort((a, b) => a.start - b.start);
    const chips = evs.map((ev) =>
      `<button type="button" class="chip ${typeCls(ev.type)}" data-ev="${esc(ev.id)}" title="${esc(ev.title)}">${esc(fmtTime(ev.start))} ${esc(ev.title)}</button>`
    ).join('');
    return `<div class="cal-cell${c.inMonth ? '' : ' is-out'}${c.key === today ? ' is-today' : ''}" data-day="${c.key}">` +
           `<span class="cal-day">${c.day}</span><div class="cal-chips">${chips}</div></div>`;
  }).join('');
  return `<div class="cal-grid">${dows}${body}</div>`;
}

/* eventos de um mes (YYYY, 0-11) segundo o dia em Brasilia */
export function eventsOfMonth(events, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return events.filter((e) => brParts(e.start).date.startsWith(prefix)).sort((a, b) => a.start - b.start);
}

/* ---------- arquivo .ics ("adicionar ao meu calendario") ---------- */
export function buildICS(ev) {
  const pad = (n) => String(n).padStart(2, '0');
  const f = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const end = new Date(ev.start.getTime() + (ev.durationMin || 60) * 60000);
  const t = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const link = safeUrl(ev.link);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Closer Journey//Area de Embarque//PT',
    'BEGIN:VEVENT',
    `UID:${ev.id}@closerjourney`,
    `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(ev.start)}`,
    `DTEND:${f(end)}`,
    `SUMMARY:${t('Closer Journey: ' + ev.title)}`,
    `DESCRIPTION:${t([ev.notes, link].filter(Boolean).join('\n'))}`,
    link ? `URL:${link}` : '',
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}

export function downloadICS(ev) {
  const blob = new Blob([buildICS(ev)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `encontro-${ev.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------- trilha sequencial ---------- */
/* Uma etapa so libera quando TODAS as anteriores estao finalizadas.
   Etapas ja finalizadas continuam acessiveis. */
export function computeTrail(lessons, completed) {
  let allPrevDone = true;
  return lessons.map((l) => {
    const done = !!completed[l.id];
    const unlocked = allPrevDone || done;
    const current = !done && allPrevDone;
    allPrevDone = allPrevDone && done;
    return { ...l, done, unlocked, current };
  });
}

/* so da para desmarcar se nenhuma etapa posterior estiver finalizada */
export function canUnmark(trail, id) {
  const i = trail.findIndex((l) => l.id === id);
  if (i < 0) return false;
  return !trail.slice(i + 1).some((l) => l.done);
}

/* agrupa itens consecutivos do mesmo modulo */
export function groupByModule(items) {
  const groups = [];
  for (const it of items) {
    const name = (it.module || 'Sem módulo').trim() || 'Sem módulo';
    const last = groups[groups.length - 1];
    if (last && last.module === name) last.items.push(it);
    else groups.push({ module: name, items: [it] });
  }
  return groups;
}

/* ---------- erros amigaveis ---------- */
export function friendlyError(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Esse e-mail não parece válido.',
    'auth/missing-password': 'Digite a senha.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão. Verifique a internet e tente de novo.',
    'auth/email-already-in-use': 'Esse e-mail já tem um acesso criado.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/user-disabled': 'Este acesso foi desativado.',
    'auth/unauthorized-domain': 'Este endereço do site não está autorizado no Firebase (veja o guia, passo de domínios autorizados).',
    'permission-denied': 'Sem permissão para essa ação. Confira as regras do Firestore (veja o guia).',
    'unavailable': 'Serviço indisponível no momento. Tente novamente.',
    'failed-precondition': 'Falta uma configuração no Firestore. Abra o console do navegador para ver o detalhe.'
  };
  const short = code.replace(/^firestore\//, '');
  return map[code] || map[short] || (e && e.userMessage) || 'Algo deu errado. Tente novamente.';
}

/* ---------- senha provisoria legivel ---------- */
export function genPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

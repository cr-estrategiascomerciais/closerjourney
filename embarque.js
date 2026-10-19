import { configured, auth, db } from './cj-firebase.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, setDoc, collection, query, where, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  esc, linkify, safeUrl, firstName, parseVideo, typeLabel, typeCls, brParts, fmtTime, fmtDay,
  fmtLong, renderCalendar, eventsOfMonth, monthLabel, downloadICS, computeTrail, canUnmark,
  groupByModule, friendlyError, todayKey
} from './cj-utils.js';

const $ = (id) => document.getElementById(id);
const views = ['v-loading', 'v-setup', 'v-login', 'v-denied', 'v-app'];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

const state = {
  user: null, profile: null,
  lessons: [], events: [], completed: {},
  unsubs: [], openLesson: null,
  calYear: 0, calMonth: 0
};

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h9"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'
};

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

/* ============================================================
   Boot
   ============================================================ */
if (!configured) {
  show('v-setup');
} else {
  onAuthStateChanged(auth, async (user) => {
    cleanup();
    if (!user) { show('v-login'); return; }
    show('v-loading');
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const p = snap.exists() ? snap.data() : null;
      if (!p || p.active !== true) {
        $('denied-text').textContent = !p
          ? 'Seu login existe, mas ainda não está liberado para a Área de Embarque. Fale com a Cris.'
          : 'Seu acesso está desativado no momento. Fale com a Cris.';
        show('v-denied');
        return;
      }
      state.user = user; state.profile = p;
      startApp();
    } catch (e) {
      console.error(e);
      $('denied-text').textContent = friendlyError(e);
      show('v-denied');
    }
  });
}

function cleanup() {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.lessons = []; state.events = []; state.completed = {};
  state.openLesson = null;
}

/* ============================================================
   Login
   ============================================================ */
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('l-msg'); msg.hidden = true;
  const btn = $('l-btn'); btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    await signInWithEmailAndPassword(auth, $('l-email').value.trim(), $('l-pass').value);
  } catch (err) {
    msg.textContent = friendlyError(err); msg.className = 'msg err'; msg.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

$('l-forgot').addEventListener('click', async () => {
  const msg = $('l-msg');
  const email = $('l-email').value.trim();
  if (!email) {
    msg.textContent = 'Digite seu e-mail acima e clique de novo em "Esqueci minha senha".';
    msg.className = 'msg warn'; msg.hidden = false; return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err && err.code !== 'auth/user-not-found') {
      msg.textContent = friendlyError(err); msg.className = 'msg err'; msg.hidden = false; return;
    }
  }
  msg.textContent = 'Se esse e-mail tiver acesso, enviamos um link para criar uma nova senha. Olhe também a caixa de spam.';
  msg.className = 'msg ok'; msg.hidden = false;
});

$('logout').addEventListener('click', () => signOut(auth));
$('denied-out').addEventListener('click', () => signOut(auth));

/* ============================================================
   App
   ============================================================ */
function startApp() {
  const p = state.profile;
  $('who-name').textContent = firstName(p.name) || 'aluna';
  $('hello').textContent = `Bem-vinda a bordo${firstName(p.name) ? ', ' + firstName(p.name) : ''}`;
  $('admin-link').hidden = p.role !== 'admin';

  const now = brParts(new Date()).date.split('-');
  state.calYear = Number(now[0]); state.calMonth = Number(now[1]) - 1;

  const uid = state.user.uid;
  const onErr = (e) => { console.error(e); toast(friendlyError(e)); };

  state.unsubs.push(onSnapshot(
    query(collection(db, 'lessons'), where('published', '==', true)),
    (snap) => {
      state.lessons = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      render();
    }, onErr));

  state.unsubs.push(onSnapshot(collection(db, 'events'), (snap) => {
    state.events = snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, ...x, start: x.start.toDate() };
    });
    renderCal();
  }, onErr));

  state.unsubs.push(onSnapshot(doc(db, 'progress', uid), (snap) => {
    state.completed = (snap.exists() && snap.data().completed) || {};
    render();
  }, onErr));

  showHome();
  show('v-app');
}

/* ---------- abas ---------- */
function setTab(which) {
  const trilha = which === 'trilha';
  $('tab-trilha').setAttribute('aria-selected', trilha);
  $('tab-cal').setAttribute('aria-selected', !trilha);
  $('p-trilha').hidden = !trilha;
  $('p-cal').hidden = trilha;
}
$('tab-trilha').addEventListener('click', () => setTab('trilha'));
$('tab-cal').addEventListener('click', () => { setTab('cal'); renderCal(); });

function showHome() {
  state.openLesson = null;
  $('s-lesson').hidden = true; $('s-home').hidden = false;
  render();
}

/* ============================================================
   Trilha
   ============================================================ */
function trail() { return computeTrail(state.lessons, state.completed); }

function render() {
  if (state.openLesson) { renderLesson(); return; }
  renderTrail();
}

function renderTrail() {
  const items = trail();
  const box = $('trail');
  if (!items.length) {
    box.innerHTML = '<div class="empty">As primeiras etapas da sua jornada ainda estão sendo preparadas. Volte em breve.</div>';
    $('next-up').innerHTML = ''; $('pct').textContent = '0%'; $('bar').style.width = '0';
    return;
  }
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  $('pct').textContent = pct + '%';
  $('bar').style.width = pct + '%';

  const cur = items.find((i) => i.current);
  $('next-up').innerHTML = cur
    ? `<div class="next-up"><div><small>Próxima parada</small><strong>${esc(cur.title)}</strong></div>
       <button class="btn btn-primary small" data-open="${esc(cur.id)}" type="button">Continuar</button></div>`
    : `<div class="next-up"><div><small>Jornada</small><strong>Você finalizou todas as etapas liberadas até agora.</strong></div></div>`;

  box.innerHTML = groupByModule(items).map((g) => `
    <div class="module">
      <h3>${esc(g.module)}</h3>
      <ul class="stops">${g.items.map(stopRow).join('')}</ul>
    </div>`).join('');
}

function stopRow(l) {
  const cls = l.done ? 'done' : l.current ? 'current' : !l.unlocked ? 'locked' : '';
  const ico = l.done ? ICON.check : !l.unlocked ? ICON.lock : l.kind === 'atividade' ? ICON.task : ICON.play;
  const st = l.done ? 'Finalizada' : !l.unlocked ? 'Bloqueada' : l.current ? 'Liberada' : 'Revisar';
  return `<li><button type="button" class="stop-row ${cls}" ${l.unlocked ? `data-open="${esc(l.id)}"` : 'disabled aria-disabled="true"'}>
    <span class="ico">${ico}</span>
    <span><span class="t">${esc(l.title)}</span>
    <span class="m"><span class="kind-tag">${l.kind === 'atividade' ? 'Atividade' : 'Aula'}</span></span></span>
    <span class="st">${st}</span></button></li>`;
}

document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o && !o.disabled) openLesson(o.dataset.open);
});

/* ============================================================
   Aula
   ============================================================ */
function openLesson(id) {
  const l = trail().find((x) => x.id === id);
  if (!l || !l.unlocked) { toast('Finalize a etapa anterior para liberar esta.'); return; }
  state.openLesson = id;
  $('s-home').hidden = true; $('s-lesson').hidden = false;
  window.scrollTo({ top: 0 });
  renderLesson();
}

function renderLesson() {
  const items = trail();
  const idx = items.findIndex((x) => x.id === state.openLesson);
  const l = items[idx];
  const sec = $('s-lesson');
  if (!l || !l.unlocked) { showHome(); return; }

  const v = parseVideo(l.videoUrl);
  let media = '';
  if (v && v.embed) {
    media = `<div class="player"><iframe src="${esc(v.embed)}" title="${esc(l.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  } else if (v && v.kind === 'link' && safeUrl(v.url)) {
    media = `<p><a class="btn btn-ghost" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">Abrir vídeo</a></p>`;
  } else if (l.kind === 'aula') {
    media = '<div class="empty">O vídeo desta aula ainda não foi adicionado.</div>';
  }

  const link = safeUrl(l.linkUrl);
  const next = items[idx + 1];
  const unmarkable = l.done && canUnmark(items, l.id);

  sec.innerHTML = `
    <div class="lesson-head">
      <button class="link-btn" type="button" id="back">&larr; Voltar para a jornada</button>
      <span class="kind-tag">${esc(l.module)} · ${l.kind === 'atividade' ? 'Atividade' : 'Aula'}</span>
    </div>
    <h1 class="a-title">${esc(l.title)}</h1>
    ${media}
    <div class="lesson-body">
      ${l.description ? `<p>${linkify(l.description)}</p>` : ''}
      ${link ? `<p><a class="btn btn-primary small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${l.kind === 'atividade' ? 'Abrir atividade' : 'Abrir material'}</a></p>` : ''}
      <div class="lesson-actions">
        ${l.done
          ? `<span class="done-pill">${ICON.check.replace('<svg', '<svg width="20" height="20"')} Etapa finalizada</span>
             ${unmarkable ? '<button class="link-btn" id="unmark" type="button">Desmarcar</button>' : ''}`
          : '<button class="btn btn-primary" id="mark" type="button">Marcar como finalizada</button>'}
        ${l.done && next ? `<button class="btn ${next.unlocked ? 'btn-primary' : 'btn-ghost'}" id="go-next" type="button" ${next.unlocked ? '' : 'disabled'}>Próxima etapa</button>` : ''}
      </div>
    </div>`;

  $('back').onclick = showHome;
  const mark = $('mark'), unmark = $('unmark'), goNext = $('go-next');
  if (mark) mark.onclick = () => setDone(l.id, true, next);
  if (unmark) unmark.onclick = () => setDone(l.id, false);
  if (goNext) goNext.onclick = () => openLesson(next.id);
}

async function setDone(id, value, next) {
  const prev = { ...state.completed };
  const nextMap = { ...state.completed };
  if (value) nextMap[id] = true; else delete nextMap[id];
  state.completed = nextMap;
  render();
  try {
    await setDoc(doc(db, 'progress', state.user.uid), { completed: nextMap, updatedAt: serverTimestamp() });
    if (value) toast(next ? 'Etapa finalizada! A próxima foi liberada.' : 'Etapa finalizada!');
  } catch (e) {
    console.error(e);
    state.completed = prev; render();
    toast(friendlyError(e));
  }
}

/* ============================================================
   Calendario
   ============================================================ */
function renderCal() {
  if (!state.user) return;
  const { calYear: y, calMonth: m } = state;
  $('cal-title').textContent = monthLabel(y, m);
  $('cal').innerHTML = renderCalendar({
    year: y, month: m, today: todayKey(),
    events: eventsOfMonth(state.events, y, m)
  });

  const now = Date.now() - 60 * 60000;
  const up = state.events.filter((e) => e.start.getTime() >= now).sort((a, b) => a.start - b.start).slice(0, 12);
  $('agenda').innerHTML = up.length ? up.map((e) => {
    const d = brParts(e.start).date.split('-');
    return `<li>
      <div class="when"><b>${d[2]}/${d[1]}</b><span>${esc(fmtTime(e.start))}</span></div>
      <div class="what"><b>${esc(e.title)}</b><small>${esc(typeLabel(e.type))} · ${esc(fmtDay(e.start))}</small></div>
      <button class="btn btn-ghost small go" type="button" data-ev="${esc(e.id)}">Detalhes</button></li>`;
  }).join('') : '<li class="empty" style="display:block">Nenhum encontro agendado por enquanto.</li>';
}

$('cal-prev').onclick = () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderCal(); };
$('cal-next').onclick = () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderCal(); };
$('cal-today').onclick = () => {
  const n = brParts(new Date()).date.split('-');
  state.calYear = Number(n[0]); state.calMonth = Number(n[1]) - 1; renderCal();
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ev]');
  if (b) openEvent(b.dataset.ev);
});

function openEvent(id) {
  const ev = state.events.find((x) => x.id === id);
  if (!ev) return;
  const link = safeUrl(ev.link);
  $('ev-box').innerHTML = `
    <span class="kind-tag">${esc(typeLabel(ev.type))}</span>
    <h3>${esc(ev.title)}</h3>
    <p class="sub">${esc(fmtLong(ev.start))}${ev.durationMin ? ' · ' + esc(ev.durationMin) + ' min' : ''}</p>
    ${ev.notes ? `<p style="white-space:pre-line">${linkify(ev.notes)}</p>` : ''}
    <div class="foot">
      <button class="btn btn-ghost small" id="ev-ics" type="button">Adicionar ao meu calendário</button>
      <div class="btn-row">
        ${link ? `<a class="btn btn-primary small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Entrar no encontro</a>` : ''}
        <button class="btn btn-ghost small" id="ev-close" type="button">Fechar</button>
      </div>
    </div>`;
  $('ev-modal').hidden = false;
  $('ev-close').onclick = () => ($('ev-modal').hidden = true);
  $('ev-ics').onclick = () => downloadICS(ev);
}
$('ev-modal').addEventListener('click', (e) => { if (e.target === $('ev-modal')) $('ev-modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('ev-modal').hidden = true; });

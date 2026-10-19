import { configured, auth, db, firebaseConfig } from './cj-firebase.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, onSnapshot,
  writeBatch, Timestamp, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  esc, safeUrl, parseVideo, typeLabel, EVENT_TYPES, brParts, fromBr, fmtTime, dayLabel, fmtDMY,
  genDates, renderCalendar, eventsOfMonth, monthLabel, todayKey, groupByModule, friendlyError, genPassword
} from './cj-utils.js';
import { TRILHA_PADRAO } from './trilha-padrao.js';

const $ = (id) => document.getElementById(id);
const views = ['v-loading', 'v-setup', 'v-login', 'v-denied', 'v-app'];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

const S = { lessons: [], events: [], students: [], unsubs: [], calYear: 0, calMonth: 0 };

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3400);
}
function flash(el, text, kind) { el.textContent = text; el.className = 'msg ' + kind; el.hidden = false; }

/* ---------- modal ---------- */
function openModal(html) { $('box').innerHTML = html; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; $('box').innerHTML = ''; }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ============================================================
   Boot
   ============================================================ */
if (!configured) {
  show('v-setup');
} else {
  onAuthStateChanged(auth, async (user) => {
    S.unsubs.forEach((u) => u()); S.unsubs = [];
    if (!user) { show('v-login'); return; }
    show('v-loading');
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const p = snap.exists() ? snap.data() : null;
      if (!p || p.active !== true || p.role !== 'admin') { show('v-denied'); return; }
      start();
    } catch (e) {
      console.error(e); show('v-denied');
    }
  });
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('l-msg'); msg.hidden = true;
  const btn = $('l-btn'); btn.disabled = true;
  try { await signInWithEmailAndPassword(auth, $('l-email').value.trim(), $('l-pass').value); }
  catch (err) { flash(msg, friendlyError(err), 'err'); }
  finally { btn.disabled = false; }
});
$('logout').onclick = () => signOut(auth);
$('denied-out').onclick = () => signOut(auth);

function start() {
  const n = brParts(new Date()).date.split('-');
  S.calYear = Number(n[0]); S.calMonth = Number(n[1]) - 1;
  const onErr = (e) => { console.error(e); toast(friendlyError(e)); };

  S.unsubs.push(onSnapshot(collection(db, 'lessons'), (snap) => {
    S.lessons = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    renderLessons();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, 'events'), (snap) => {
    S.events = snap.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, start: x.start.toDate() }; });
    renderCal(); updatePreview();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
    S.students = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.role !== 'admin')
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
    renderStudents();
  }, onErr));

  $('s-pass').value = genPassword();
  show('v-app');
}

/* ---------- abas ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', x === t));
  ['aulas', 'cal', 'alunas'].forEach((k) => ($('t-' + k).hidden = k !== t.dataset.tab));
}));

/* ============================================================
   Aulas e atividades
   ============================================================ */
function renderLessons() {
  $('seed').hidden = S.lessons.length > 0;
  const box = $('lessons');
  if (!S.lessons.length) {
    box.innerHTML = '<div class="empty">Nenhuma aula ou atividade ainda. Clique em "Carregar trilha sugerida" para começar a partir do fluxograma da jornada, ou crie a primeira.</div>';
    return;
  }
  const idxOf = (id) => S.lessons.findIndex((l) => l.id === id);
  box.innerHTML = groupByModule(S.lessons).map((g) => `
    <div class="mod-title">${esc(g.module)}</div>
    <ul class="a-list">${g.items.map((l) => {
      const i = idxOf(l.id);
      const hasVideo = !!parseVideo(l.videoUrl);
      return `<li class="a-item ${l.published ? '' : 'draft'}">
        <div class="move">
          <button class="icon-btn" data-up="${l.id}" ${i === 0 ? 'disabled' : ''} title="Subir" type="button">&uarr;</button>
          <button class="icon-btn" data-down="${l.id}" ${i === S.lessons.length - 1 ? 'disabled' : ''} title="Descer" type="button">&darr;</button>
        </div>
        <div>
          <div class="t">${i + 1}. ${esc(l.title)}
            <span class="badge">${l.kind === 'atividade' ? 'Atividade' : 'Aula'}</span>
            <span class="badge ${l.published ? 'on' : 'off'}">${l.published ? 'Publicada' : 'Rascunho'}</span></div>
          <div class="m">${l.kind === 'aula' ? (hasVideo ? 'Vídeo cadastrado' : 'Sem vídeo ainda') : (safeUrl(l.linkUrl) ? 'Link da atividade cadastrado' : 'Sem link ainda')}</div>
        </div>
        <div class="acts">
          <button class="btn btn-ghost small" data-edit="${l.id}" type="button">Editar</button>
          <button class="btn danger small" data-del="${l.id}" type="button">Excluir</button>
        </div></li>`;
    }).join('')}</ul>`).join('');
}

$('lessons').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.up) moveLesson(t.dataset.up, -1);
  else if (t.dataset.down) moveLesson(t.dataset.down, 1);
  else if (t.dataset.edit) lessonModal(S.lessons.find((l) => l.id === t.dataset.edit));
  else if (t.dataset.del) delLesson(t.dataset.del);
});
$('new-aula').onclick = () => lessonModal(null, 'aula');
$('new-ativ').onclick = () => lessonModal(null, 'atividade');

async function moveLesson(id, dir) {
  const arr = S.lessons.slice();
  const i = arr.findIndex((l) => l.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  try {
    const b = writeBatch(db);
    arr.forEach((l, k) => { if (l.order !== k + 1) b.update(doc(db, 'lessons', l.id), { order: k + 1 }); });
    await b.commit();
  } catch (e) { toast(friendlyError(e)); }
}

async function delLesson(id) {
  const l = S.lessons.find((x) => x.id === id);
  if (!l || !confirm(`Excluir "${l.title}"? As alunas deixam de ver esta etapa.`)) return;
  try { await deleteDoc(doc(db, 'lessons', id)); toast('Etapa excluída.'); }
  catch (e) { toast(friendlyError(e)); }
}

$('seed').onclick = async () => {
  if (!confirm('Carregar a trilha sugerida como rascunho? Você poderá editar tudo depois.')) return;
  try {
    const b = writeBatch(db);
    TRILHA_PADRAO.forEach((t, i) => {
      b.set(doc(collection(db, 'lessons')), {
        ...t, order: i + 1, videoUrl: '', linkUrl: '', published: false, createdAt: serverTimestamp()
      });
    });
    await b.commit();
    toast('Trilha carregada como rascunho. Cole os vídeos e publique.');
  } catch (e) { toast(friendlyError(e)); }
};

function lessonModal(l, kindDefault) {
  const isNew = !l;
  const kind = l ? l.kind : kindDefault;
  const mods = [...new Set(S.lessons.map((x) => x.module).filter(Boolean))];
  openModal(`
    <h3>${isNew ? 'Nova' : 'Editar'} ${kind === 'atividade' ? 'atividade' : 'aula'}</h3>
    <p class="sub">Para trocar o vídeo, é só colar o novo link e salvar.</p>
    <form id="l-form" class="f">
      <div class="row">
        <label>Tipo
          <select id="m-kind"><option value="aula" ${kind === 'aula' ? 'selected' : ''}>Aula</option><option value="atividade" ${kind === 'atividade' ? 'selected' : ''}>Atividade</option></select>
        </label>
        <label>Módulo <input id="m-module" list="mods" required value="${esc(l ? l.module : (mods[mods.length - 1] || ''))}" placeholder="Ex.: Diário de Bordo">
          <datalist id="mods">${mods.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
      </div>
      <label>Título <input id="m-title" required value="${esc(l ? l.title : '')}"></label>
      <label>Descrição <textarea id="m-desc">${esc(l ? l.description : '')}</textarea></label>
      <label>Link do vídeo <span class="hint">YouTube (pode ser não listado) ou Vimeo</span>
        <input id="m-video" value="${esc(l ? l.videoUrl : '')}" placeholder="https://youtu.be/..."></label>
      <div id="m-vcheck" class="msg" hidden></div>
      <label>Link do material ou da atividade <span class="hint">Notion, Google Docs, formulário... (opcional)</span>
        <input id="m-link" value="${esc(l ? l.linkUrl : '')}" placeholder="https://"></label>
      <label class="check"><input type="checkbox" id="m-pub" ${!l || l.published ? 'checked' : ''}> Publicada (visível para as alunas)</label>
      <div id="m-msg" class="msg err" hidden></div>
      <div class="foot">
        <button class="btn btn-ghost small" type="button" id="m-cancel">Cancelar</button>
        <button class="btn btn-primary small" type="submit">Salvar</button>
      </div>
    </form>`);

  const vcheck = () => {
    const raw = $('m-video').value.trim(), el = $('m-vcheck');
    if (!raw) { el.hidden = true; return; }
    const v = parseVideo(raw);
    if (v && v.embed) flash(el, `Vídeo reconhecido (${v.kind === 'youtube' ? 'YouTube' : 'Vimeo'}).`, 'ok');
    else flash(el, 'Link não reconhecido como YouTube ou Vimeo. Na área da aluna ele abrirá como link externo.', 'warn');
  };
  $('m-video').addEventListener('input', vcheck); vcheck();
  $('m-cancel').onclick = closeModal;

  $('l-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      kind: $('m-kind').value,
      module: $('m-module').value.trim(),
      title: $('m-title').value.trim(),
      description: $('m-desc').value.trim(),
      videoUrl: $('m-video').value.trim(),
      linkUrl: $('m-link').value.trim(),
      published: $('m-pub').checked
    };
    if (data.linkUrl && !safeUrl(data.linkUrl)) { flash($('m-msg'), 'O link do material não parece válido.', 'err'); return; }
    try {
      if (isNew) {
        const order = S.lessons.reduce((m, x) => Math.max(m, x.order || 0), 0) + 1;
        await addDoc(collection(db, 'lessons'), { ...data, order, createdAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, 'lessons', l.id), data);
      }
      closeModal(); toast('Salvo.');
    } catch (err) { flash($('m-msg'), friendlyError(err), 'err'); }
  });
}

/* ============================================================
   Calendario: cadastro em lote
   ============================================================ */
const bulkVals = () => ({
  title: $('b-title').value.trim(), type: $('b-type').value, start: $('b-start').value,
  time: $('b-time').value, dur: Number($('b-dur').value) || 60, wd: Number($('b-wd').value),
  step: Number($('b-step').value), count: Math.max(1, Math.min(60, Number($('b-count').value) || 1)),
  link: $('b-link').value.trim(), notes: $('b-notes').value.trim()
});

function updatePreview() {
  const v = bulkVals(), ul = $('b-prev');
  if (!v.start || !v.time) { ul.innerHTML = '<li>Escolha a primeira data e o horário.</li>'; return; }
  ul.innerHTML = genDates(v.start, v.wd, v.step, v.count)
    .map((d) => `<li>${esc(dayLabel(d))} às ${esc(v.time.replace(':00', 'h').replace(':', 'h'))}</li>`).join('');
}
['b-start', 'b-time', 'b-wd', 'b-step', 'b-count'].forEach((id) => $(id).addEventListener('input', updatePreview));
$('b-start').addEventListener('change', () => {
  const v = $('b-start').value;
  if (v) { $('b-wd').value = String(new Date(v + 'T12:00:00Z').getUTCDay()); updatePreview(); }
});
updatePreview();

$('bulk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = bulkVals(), msg = $('b-msg');
  if (!v.title || !v.start || !v.time) { flash(msg, 'Preencha título, primeira data e horário.', 'err'); return; }
  if (v.link && !safeUrl(v.link)) { flash(msg, 'O link da sala não parece válido.', 'err'); return; }
  const dates = genDates(v.start, v.wd, v.step, v.count);
  const btn = $('b-go'); btn.disabled = true;
  try {
    const seriesId = 's' + Date.now().toString(36);
    const b = writeBatch(db);
    dates.forEach((d) => b.set(doc(collection(db, 'events')), {
      title: v.title, type: v.type, start: Timestamp.fromDate(fromBr(d, v.time)),
      durationMin: v.dur, link: v.link, notes: v.notes, seriesId, createdAt: serverTimestamp()
    }));
    await b.commit();
    flash(msg, `${dates.length} encontros criados. Eles já aparecem no calendário das alunas.`, 'ok');
    const first = dates[0].split('-'); S.calYear = Number(first[0]); S.calMonth = Number(first[1]) - 1; renderCal();
  } catch (err) { flash(msg, friendlyError(err), 'err'); }
  finally { btn.disabled = false; }
});

/* ============================================================
   Calendario: visualizacao e edicao individual
   ============================================================ */
function renderCal() {
  $('cal-title').textContent = monthLabel(S.calYear, S.calMonth);
  $('cal').innerHTML = renderCalendar({
    year: S.calYear, month: S.calMonth, today: todayKey(),
    events: eventsOfMonth(S.events, S.calYear, S.calMonth)
  });
}
$('cal-prev').onclick = () => { S.calMonth--; if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; } renderCal(); };
$('cal-next').onclick = () => { S.calMonth++; if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; } renderCal(); };
$('cal-today').onclick = () => { const n = brParts(new Date()).date.split('-'); S.calYear = +n[0]; S.calMonth = +n[1] - 1; renderCal(); };
$('cal').addEventListener('click', (e) => {
  const c = e.target.closest('[data-ev]');
  if (c) eventModal(S.events.find((x) => x.id === c.dataset.ev));
});
$('one-ev').onclick = () => eventModal(null);

function eventModal(ev) {
  const isNew = !ev;
  const p = ev ? brParts(ev.start) : { date: todayKey(), time: '14:00' };
  const seriesCount = ev && ev.seriesId ? S.events.filter((x) => x.seriesId === ev.seriesId).length : 0;
  openModal(`
    <h3>${isNew ? 'Novo encontro' : 'Editar encontro'}</h3>
    <p class="sub">${isNew ? 'Encontro avulso.' : esc(typeLabel(ev.type)) + ' · ' + esc(dayLabel(p.date))}</p>
    <form id="e-form" class="f">
      <div class="row">
        <label>Título <input id="e-title" required value="${esc(ev ? ev.title : '')}"></label>
        <label>Tipo <select id="e-type">${Object.entries(EVENT_TYPES).map(([k, t]) =>
          `<option value="${k}" ${ev && ev.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      </div>
      <div class="row3">
        <label>Data <input id="e-date" type="date" required value="${p.date}"></label>
        <label>Horário <input id="e-time" type="time" required value="${p.time}"></label>
        <label>Duração (min) <input id="e-dur" type="number" min="15" step="5" value="${ev ? ev.durationMin || 60 : 90}"></label>
      </div>
      <label>Link da sala <input id="e-link" value="${esc(ev ? ev.link : '')}" placeholder="https://"></label>
      <label>Observações <textarea id="e-notes">${esc(ev ? ev.notes : '')}</textarea></label>
      ${seriesCount > 1 ? `
      <label class="check"><input type="checkbox" id="e-future"> Aplicar este horário também aos próximos encontros da mesma série (mantém as datas deles)</label>` : ''}
      <div id="e-msg" class="msg err" hidden></div>
      <div class="foot">
        <div class="btn-row">
          ${isNew ? '' : '<button class="btn danger small" type="button" id="e-del">Excluir</button>'}
          ${seriesCount > 1 ? '<button class="btn danger small" type="button" id="e-delf">Excluir este e os próximos da série</button>' : ''}
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost small" type="button" id="e-cancel">Cancelar</button>
          <button class="btn btn-primary small" type="submit">Salvar</button>
        </div>
      </div>
    </form>`);
  $('e-cancel').onclick = closeModal;

  $('e-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = $('e-link').value.trim();
    if (link && !safeUrl(link)) { flash($('e-msg'), 'O link não parece válido.', 'err'); return; }
    const data = {
      title: $('e-title').value.trim(), type: $('e-type').value,
      start: Timestamp.fromDate(fromBr($('e-date').value, $('e-time').value)),
      durationMin: Number($('e-dur').value) || 60, link, notes: $('e-notes').value.trim()
    };
    try {
      if (isNew) {
        await addDoc(collection(db, 'events'), { ...data, createdAt: serverTimestamp() });
      } else {
        const b = writeBatch(db);
        b.update(doc(db, 'events', ev.id), data);
        const fut = $('e-future');
        if (fut && fut.checked) {
          S.events.filter((x) => x.seriesId === ev.seriesId && x.id !== ev.id && x.start > ev.start).forEach((x) => {
            b.update(doc(db, 'events', x.id), {
              start: Timestamp.fromDate(fromBr(brParts(x.start).date, $('e-time').value)),
              durationMin: data.durationMin, link: data.link
            });
          });
        }
        await b.commit();
      }
      closeModal(); toast('Encontro salvo.');
    } catch (err) { flash($('e-msg'), friendlyError(err), 'err'); }
  });

  if (!isNew) {
    $('e-del').onclick = async () => {
      if (!confirm('Excluir este encontro?')) return;
      try { await deleteDoc(doc(db, 'events', ev.id)); closeModal(); toast('Encontro excluído.'); }
      catch (err) { flash($('e-msg'), friendlyError(err), 'err'); }
    };
    const df = $('e-delf');
    if (df) df.onclick = async () => {
      const list = S.events.filter((x) => x.seriesId === ev.seriesId && x.start >= ev.start);
      if (!confirm(`Excluir ${list.length} encontros (este e os próximos da série)?`)) return;
      try {
        const b = writeBatch(db); list.forEach((x) => b.delete(doc(db, 'events', x.id)));
        await b.commit(); closeModal(); toast('Encontros excluídos.');
      } catch (err) { flash($('e-msg'), friendlyError(err), 'err'); }
    };
  }
}

/* ============================================================
   Alunas
   ============================================================ */
function renderStudents() {
  const ul = $('students');
  if (!S.students.length) { ul.innerHTML = '<li class="empty">Nenhuma aluna cadastrada ainda.</li>'; return; }
  ul.innerHTML = S.students.map((u) => `
    <li class="a-item" style="grid-template-columns:1fr auto">
      <div><div class="t">${esc(u.name)} <span class="badge ${u.active ? 'on' : 'off'}">${u.active ? 'Ativa' : 'Desativada'}</span></div>
      <div class="m">${esc(u.email)}</div></div>
      <div class="acts">
        <button class="btn btn-ghost small" data-reset="${esc(u.id)}" type="button">Enviar link de nova senha</button>
        <button class="btn ${u.active ? 'danger' : 'btn-ghost'} small" data-toggle="${esc(u.id)}" type="button">${u.active ? 'Desativar' : 'Reativar'}</button>
      </div></li>`).join('');
}

$('students').addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.reset) {
    const u = S.students.find((x) => x.id === t.dataset.reset);
    try { await sendPasswordResetEmail(auth, u.email); toast('Link enviado para ' + u.email); }
    catch (err) { toast(friendlyError(err)); }
  } else if (t.dataset.toggle) {
    const u = S.students.find((x) => x.id === t.dataset.toggle);
    if (u.active && !confirm(`Desativar o acesso de ${u.name}?`)) return;
    try { await updateDoc(doc(db, 'users', u.id), { active: !u.active }); }
    catch (err) { toast(friendlyError(err)); }
  }
});

$('s-gen').onclick = () => ($('s-pass').value = genPassword());

/* instancia secundaria: cria o login sem deslogar a Cris */
function secondaryAuth() {
  const app = getApps().find((a) => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary');
  return getAuth(app);
}

$('stu-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('s-msg'), btn = $('s-go');
  const name = $('s-name').value.trim(), email = $('s-email').value.trim(), pass = $('s-pass').value;
  btn.disabled = true; msg.hidden = true;
  const sec = secondaryAuth();
  try {
    const cred = await createUserWithEmailAndPassword(sec, email, pass);
    const uid = cred.user.uid;
    await signOut(sec);
    await setDoc(doc(db, 'users', uid), {
      name, email: email.toLowerCase(), role: 'student', active: true, createdAt: serverTimestamp()
    });
    const url = new URL('embarque.html', location.href).href;
    msg.className = 'msg ok'; msg.hidden = false;
    msg.innerHTML = `Acesso criado. Envie para a aluna:<div class="cred" style="margin-top:8px">${esc(
`Olá, ${name.split(' ')[0]}! Seu acesso à Área de Embarque da Closer Journey:
Link: ${url}
E-mail: ${email}
Senha provisória: ${pass}`)}</div>
      <p style="margin:8px 0 0"><button class="btn btn-ghost small" type="button" id="copy-cred">Copiar mensagem</button></p>`;
    $('copy-cred').onclick = async () => {
      try { await navigator.clipboard.writeText(msg.querySelector('.cred').textContent); toast('Copiado.'); }
      catch { toast('Selecione o texto e copie manualmente.'); }
    };
    $('s-name').value = ''; $('s-email').value = ''; $('s-pass').value = genPassword();
  } catch (err) {
    console.error(err);
    flash(msg, friendlyError(err), 'err');
  } finally { btn.disabled = false; }
});

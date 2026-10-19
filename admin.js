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
  esc, safeUrl, parseVideo, parseDriveFile, fmtStamp, parseFields, fieldsToText, groupFields, typeLabel, EVENT_TYPES, brParts, fromBr, fmtTime, dayLabel, fmtDMY,
  genDates, renderCalendar, eventsOfMonth, monthLabel, todayKey, groupByModule, friendlyError, genPassword
} from './cj-utils.js?v=5';
import { TRILHA_PADRAO } from './trilha-padrao.js';

const $ = (id) => document.getElementById(id);
const views = ['v-loading', 'v-setup', 'v-login', 'v-denied', 'v-app'];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

const S = { lessons: [], events: [], students: [], subs: [], subFilter: 'pend', unsubs: [], calYear: 0, calMonth: 0 };

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3400);
}
function flash(el, text, kind) { el.textContent = text; el.className = 'msg ' + kind; el.hidden = false; }

/* ---------- modal ---------- */
function openModal(html) { $('box').innerHTML = html; $('modal').hidden = false; }
function closeModal() { $('modal').hidden = true; $('box').innerHTML = ''; $('box').classList.remove('wide'); }
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
  S.unsubs.push(onSnapshot(collection(db, 'submissions'), (snap) => {
    S.subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderSubs();
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
  ['aulas', 'cal', 'corr', 'alunas'].forEach((k) => ($('t-' + k).hidden = k !== t.dataset.tab));
}));

/* ============================================================
   Aulas e atividades
   ============================================================ */
function renderLessons() {
  $('seed').hidden = S.lessons.length > 0;
  renderSideAdmin();
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
      return `<li class="a-item ${l.published ? '' : 'draft'}" id="li-${l.id}">
        <div class="move">
          <button class="icon-btn" data-up="${l.id}" ${i === 0 ? 'disabled' : ''} title="Subir" type="button">&uarr;</button>
          <button class="icon-btn" data-down="${l.id}" ${i === S.lessons.length - 1 ? 'disabled' : ''} title="Descer" type="button">&darr;</button>
        </div>
        <div>
          <div class="t">${i + 1}. ${esc(l.title)}
            <span class="badge">${l.kind === 'atividade' ? 'Atividade' : 'Aula'}</span>
            <span class="badge ${l.published ? 'on' : 'off'}">${l.published ? 'Publicada' : 'Rascunho'}</span>${l.kind === 'atividade' && l.feedbackEnabled ? '<span class="badge fb">Com feedback</span>' : ''}</div>
          <div class="m">${l.kind === 'aula' ? (hasVideo ? 'Vídeo cadastrado' : 'Sem vídeo ainda') : (safeUrl(l.linkUrl) ? 'Link da atividade cadastrado' : 'Sem link ainda')}</div>
        </div>
        <div class="acts">
          <button class="btn btn-ghost small" data-edit="${l.id}" type="button">Editar</button>
          <button class="btn danger small" data-del="${l.id}" type="button">Excluir</button>
        </div></li>`;
    }).join('')}</ul>`).join('');
}

/* ---------- menu lateral: nasce dos modulos e aulas cadastrados ---------- */
const collapsedMods = {};
function renderSideAdmin() {
  const box = $('a-side');
  if (!S.lessons.length) { box.innerHTML = '<p class="side-empty">Os módulos e aulas que você criar aparecem aqui.</p>'; return; }
  box.innerHTML = groupByModule(S.lessons).map((g) => {
    const closed = !!collapsedMods[g.module];
    return `<div class="side-mod${closed ? ' is-collapsed' : ''}">
      <div class="side-mod-row">
        <button type="button" class="side-mod-h" data-smod="${esc(g.module)}" aria-expanded="${!closed}">
          <span class="nm">${esc(g.module)}</span><small>${g.items.length}</small><i class="chev"></i></button>
        <button type="button" class="side-plus" data-addin="${esc(g.module)}" title="Nova aula neste módulo" aria-label="Nova aula neste módulo">+</button>
      </div>
      <ul>${g.items.map((l) => `<li><button type="button" class="side-item${l.published ? '' : ' draft'}" data-jump="${esc(l.id)}">
        <span class="tt">${esc(l.title)}</span></button></li>`).join('')}</ul></div>`;
  }).join('');
}
$('a-side').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.smod !== undefined) { collapsedMods[t.dataset.smod] = !collapsedMods[t.dataset.smod]; renderSideAdmin(); }
  else if (t.dataset.addin !== undefined) lessonModal(null, 'aula', t.dataset.addin);
  else if (t.dataset.jump) {
    const el = document.getElementById('li-' + t.dataset.jump);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
  }
});
$('new-mod').onclick = () => lessonModal(null, 'aula', '', true);

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

function lessonModal(l, kindDefault, moduleDefault, newModule) {
  const isNew = !l;
  const kind = l ? l.kind : kindDefault;
  const mods = [...new Set(S.lessons.map((x) => x.module).filter(Boolean))];
  const modVal = l ? l.module : (moduleDefault !== undefined ? moduleDefault : (mods[mods.length - 1] || ''));
  openModal(`
    <h3>${newModule ? 'Novo módulo' : (isNew ? 'Nova' : 'Editar') + ' ' + (kind === 'atividade' ? 'atividade' : 'aula')}</h3>
    <p class="sub">${newModule ? 'Digite o nome do módulo e cadastre a primeira aula dele. O módulo aparece no menu lateral.' : 'Para trocar o vídeo, é só colar o novo link e salvar.'}</p>
    <form id="l-form" class="f">
      <div class="row">
        <label>Tipo
          <select id="m-kind"><option value="aula" ${kind === 'aula' ? 'selected' : ''}>Aula</option><option value="atividade" ${kind === 'atividade' ? 'selected' : ''}>Atividade</option></select>
        </label>
        <label>Módulo <input id="m-module" list="mods" required value="${esc(modVal)}" placeholder="Ex.: Diário de Bordo">
          <datalist id="mods">${mods.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
      </div>
      <label>Título <input id="m-title" required value="${esc(l ? l.title : '')}"></label>
      <label>Descrição <textarea id="m-desc">${esc(l ? l.description : '')}</textarea></label>
      <div id="m-act" class="sub-grid" ${kind === 'atividade' ? '' : 'hidden'}>
        <label>Texto da atividade <span class="hint">Instruções, perguntas, exemplos. Linhas começando com "- " viram lista, "1. " lista numerada, "## " subtítulo e **texto** fica em negrito.</span>
          <textarea id="m-body" rows="9">${esc(l ? l.body : '')}</textarea></label>
        <label>PDF da atividade <span class="hint">Cole o link do PDF no Google Drive (compartilhado como "Qualquer pessoa com o link"). Ele aparece dentro da página da aluna.</span>
          <input id="m-pdf" value="${esc(l ? l.pdfUrl : '')}" placeholder="https://drive.google.com/file/d/..."></label>
        <div id="m-pdfcheck" class="msg" hidden></div>
        <label class="check"><input type="checkbox" id="m-fb" ${l && l.feedbackEnabled ? 'checked' : ''}> Permitir feedback da Cris (a aluna envia a resposta e você corrige)</label>
        <div id="m-fields" class="sub-grid" ${l && l.feedbackEnabled ? '' : 'hidden'}>
          <label>Campos da resposta (entregáveis) <span class="hint">Opcional. Um campo por linha. "## Nome" cria uma seção, "Campo | dica" adiciona uma dica e "(opcional)" no fim do nome dispensa o preenchimento. Sem campos, a aluna responde em um texto livre.</span>
            <textarea id="m-fields-text" rows="11" placeholder="## Descoberta&#10;Recuo Estratégico&#10;Perguntas de situação&#10;&#10;## Encantamento&#10;Abertura do encantamento&#10;Autoridade">${esc(l ? fieldsToText(l.fields) : '')}</textarea></label>
          <div id="m-fcount" class="msg ok" hidden></div>
        </div>
      </div>
      <label>Link do vídeo <span class="hint">Google Drive, YouTube (pode ser não listado) ou Vimeo</span>
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
    if (v && v.kind === 'drive') flash(el, 'Vídeo do Google Drive reconhecido. Confirme que o arquivo está compartilhado como "Qualquer pessoa com o link", senão as alunas não conseguem assistir.', 'ok');
    else if (v && v.embed) flash(el, `Vídeo reconhecido (${v.kind === 'youtube' ? 'YouTube' : 'Vimeo'}).`, 'ok');
    else flash(el, 'Link não reconhecido como Google Drive, YouTube ou Vimeo. Na área da aluna ele abrirá como link externo.', 'warn');
  };
  $('m-video').addEventListener('input', vcheck); vcheck();
  if (newModule) $('m-module').focus();
  const pdfcheck = () => {
    const raw = $('m-pdf').value.trim(), el = $('m-pdfcheck');
    if (!raw) { el.hidden = true; return; }
    if (parseDriveFile(raw)) flash(el, 'PDF do Google Drive reconhecido. Confirme o compartilhamento "Qualquer pessoa com o link".', 'ok');
    else flash(el, 'Link fora do Google Drive: a aluna verá um botão "Abrir PDF" em vez do PDF dentro da página.', 'warn');
  };
  $('m-pdf').addEventListener('input', pdfcheck); pdfcheck();
  const fcount = () => {
    const f = parseFields($('m-fields-text').value, l && l.fields);
    const el = $('m-fcount');
    if (!f.length) { el.hidden = true; return; }
    const secs = new Set(f.map((x) => x.section)).size;
    flash(el, `${f.length} campo${f.length > 1 ? 's' : ''} em ${secs} seç${secs > 1 ? 'ões' : 'ão'}.`, 'ok');
  };
  $('m-fields-text').addEventListener('input', fcount); fcount();
  $('m-fb').addEventListener('change', () => { $('m-fields').hidden = !$('m-fb').checked; });
  $('m-kind').addEventListener('change', () => { $('m-act').hidden = $('m-kind').value !== 'atividade'; });
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
    const isAct = data.kind === 'atividade';
    data.body = isAct ? $('m-body').value.trim() : '';
    data.pdfUrl = isAct ? $('m-pdf').value.trim() : '';
    data.feedbackEnabled = isAct && $('m-fb').checked;
    data.fields = data.feedbackEnabled ? parseFields($('m-fields-text').value, l && l.fields) : [];
    if (data.pdfUrl && !safeUrl(data.pdfUrl)) { flash($('m-msg'), 'O link do PDF não parece válido.', 'err'); return; }
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


/* ============================================================
   Correcoes: respostas das alunas e feedback da Cris
   ============================================================ */
function renderSubs() {
  const pend = S.subs.filter((x) => x.status !== 'corrigida');
  $('tab-corr').textContent = pend.length ? `Correções (${pend.length})` : 'Correções';
  const list = (S.subFilter === 'pend' ? pend : S.subs.slice())
    .sort((a, b) => ((b.submittedAt && b.submittedAt.seconds) || 9e9) - ((a.submittedAt && a.submittedAt.seconds) || 9e9));
  const ul = $('subs');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${S.subFilter === 'pend' ? 'Nenhuma resposta aguardando correção.' : 'Nenhuma resposta enviada ainda.'}</li>`;
    return;
  }
  ul.innerHTML = list.map((x) => `
    <li class="a-item" style="grid-template-columns:1fr auto">
      <div><div class="t">${esc(x.studentName || 'Aluna')}
        <span class="badge ${x.status === 'corrigida' ? 'on' : 'off'}">${x.status === 'corrigida' ? 'Corrigida' : 'Aguardando'}</span></div>
        <div class="m">${esc(x.lessonTitle || '')} · enviada em ${esc(fmtStamp(x.submittedAt))}</div></div>
      <div class="acts"><button class="btn ${x.status === 'corrigida' ? 'btn-ghost' : 'btn-primary'} small" data-sub="${esc(x.id)}" type="button">${x.status === 'corrigida' ? 'Ver / editar' : 'Corrigir'}</button></div>
    </li>`).join('');
}

document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  S.subFilter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('is-on', x === b));
  renderSubs();
}));
$('subs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sub]');
  if (b) subModal(S.subs.find((x) => x.id === b.dataset.sub));
});

function subModal(x) {
  if (!x) return;
  const link = safeUrl(x.link);
  const ans = x.answers || {};
  const ids = Object.keys(ans);
  const fbs = x.feedbacks || {};
  /* ordem dos campos: a da atividade, se existir; senao a ordem salva */
  const lesson = S.lessons.find((l) => l.id === x.lessonId);
  const ordered = [];
  ((lesson && lesson.fields) || []).forEach((f) => { if (ans[f.id]) ordered.push({ id: f.id, ...ans[f.id] }); });
  ids.forEach((id) => { if (!ordered.find((o) => o.id === id)) ordered.push({ id, ...ans[id] }); });

  let lastSec = null;
  const items = ordered.map((o) => {
    const head = (o.section || '') !== lastSec ? (lastSec = o.section || '', o.section ? `<h4 class="fld-sec">${esc(o.section)}</h4>` : '') : '';
    return `${head}<div class="ans-item">
      <div class="ans-label">${esc(o.label)}</div>
      <div class="ans-text">${o.text ? esc(o.text).replace(/\n/g, '<br>') : '<em>Sem resposta</em>'}</div>
      <textarea class="item-fb" data-fbid="${esc(o.id)}" rows="2" placeholder="Feedback deste item (opcional)">${esc(fbs[o.id] || '')}</textarea>
    </div>`;
  }).join('');

  openModal(`
    <h3>${esc(x.studentName || 'Aluna')}</h3>
    <p class="sub">${esc(x.lessonTitle || '')} · enviada em ${esc(fmtStamp(x.submittedAt))}</p>
    <div class="sub-answer">
      ${items || (x.text ? `<p style="white-space:pre-wrap;margin:0 0 10px">${esc(x.text)}</p>` : '<p class="m">Sem texto.</p>')}
      ${link ? `<p style="margin:10px 0 0"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a></p>` : ''}
    </div>
    <form id="fb-form" class="f" style="margin-top:14px">
      <label>${items ? 'Feedback geral' : 'Seu feedback'}
        <textarea id="fb-text" rows="${items ? 4 : 8}" placeholder="Escreva a correção e as orientações...">${esc(x.feedback || '')}</textarea></label>
      <div id="fb-msg" class="msg err" hidden></div>
      <div class="foot">
        <button class="btn btn-ghost small" type="button" id="fb-cancel">Cancelar</button>
        <button class="btn btn-primary small" type="submit">${x.status === 'corrigida' ? 'Atualizar feedback' : 'Enviar feedback'}</button>
      </div>
    </form>`);
  $('box').classList.toggle('wide', !!items);
  $('fb-cancel').onclick = closeModal;
  $('fb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('fb-text').value.trim();
    const feedbacks = {};
    document.querySelectorAll('[data-fbid]').forEach((t) => { const v = t.value.trim(); if (v) feedbacks[t.dataset.fbid] = v; });
    if (!feedback && !Object.keys(feedbacks).length) { flash($('fb-msg'), 'Escreva o feedback geral ou o de algum item antes de enviar.', 'err'); return; }
    try {
      await updateDoc(doc(db, 'submissions', x.id), { feedback, feedbacks, status: 'corrigida', feedbackAt: serverTimestamp() });
      closeModal(); toast('Feedback enviado para a aluna.');
    } catch (err) { flash($('fb-msg'), friendlyError(err), 'err'); }
  });
}

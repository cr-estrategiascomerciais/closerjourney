import { configured, auth, db } from './cj-firebase.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  reauthenticateWithCredential, EmailAuthProvider, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  esc, linkify, safeUrl, firstName, parseVideo, typeLabel, typeCls, brParts, fmtTime, fmtDay,
  fmtLong, renderCalendar, birthdayEvents, googleCalLink, fromBr, eventsOfMonth, monthLabel, downloadICS, computeTrail, canUnmark,
  groupByModule, fmtTs, friendlyError, todayKey, renderRich, parseDriveFile, fmtStamp, accessInfo, fmtDMY
} from './cj-utils.js?v=19';

const $ = (id) => document.getElementById(id);
const views = ['v-loading', 'v-setup', 'v-login', 'v-denied', 'v-app'];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

const state = {
  user: null, profile: null,
  lessons: [], events: [], completed: {}, collapsed: {}, subs: {}, notes: {}, imgs: {}, imgErr: '', descClosed: false, doneAt: {}, welcomed: false, welcomeShown: false, newStamp: '', ppOpen: false, ppPage: 0, tab: 'trilha', signups: [], hotseats: [], hsTab: 'mine', questions: [], birthdays: [], closerForm: false, qDraft: '', openEv: null, joining: false, rpError: '', editingSub: false,
  unsubs: [], openLesson: null,
  calYear: 0, calMonth: 0
};

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h9"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  aula: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor"/></svg>',
  ativ: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'
};

const modName = (m) => '✈︎ ' + String(m || 'Sem módulo').replace(/^[^\p{L}\p{N}]+/u, '');
const WA = 'https://web.whatsapp.com/send?phone=5531982298811';
function renderAccessNote() {
  const box = $('access-note');
  if (!box || !state.profile) return;
  const a = accessInfo(state.profile);
  if (!a.until || a.expired) { box.innerHTML = ''; return; }
  const warn = a.level === 'urgent' ? ' is-urgent' : a.level === 'soon' ? ' is-soon' : '';
  box.innerHTML = `<div class="access-note${warn}">Seu acesso vai até <b>${esc(fmtDMY(a.untilKey))}</b> <span>(${esc(a.label.toLowerCase())})</span>.${warn ? ` Quer continuar depois dessa data? <a href="${WA}" target="_blank" rel="noopener noreferrer">Fale com a equipe Closer Journey</a>.` : ''}</div>`;
}

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
          ? 'Seu login existe, mas ainda não está liberado para a Área de Embarque. Fale com a equipe Closer Journey.'
          : 'Seu acesso está desativado no momento. Fale com a equipe Closer Journey.';
        show('v-denied');
        return;
      }
      const acc = accessInfo(p);
      if (acc.expired) {
        $('denied-text').textContent = `Seu acesso à Área de Embarque terminou em ${fmtDMY(acc.untilKey)}. Para renovar, fale com a equipe Closer Journey.`;
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
  clearInterval(state.accessTimer);
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.lessons = []; state.events = []; state.completed = {}; state.subs = {}; state.notes = {}; state.doneAt = {}; state.welcomed = false; state.welcomeShown = false; state.newStamp = ''; state.signups = []; state.hotseats = []; state.questions = []; state.birthdays = []; state.openEv = null; state.editingSub = false;
  state.openLesson = null;
  const sl = $('s-lesson'); sl.innerHTML = ''; sl.dataset.lessonId = ''; sl.dataset.mediaKey = ''; sl.dataset.infoKey = ''; sl.dataset.subKey = '';
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

$('l-eye').addEventListener('click', () => {
  const p = $('l-pass'), show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  $('l-eye').setAttribute('aria-pressed', show); $('l-eye').setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
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
  msg.textContent = 'Se esse e-mail tiver acesso, enviamos um link para você criar uma nova senha. Abra o e-mail, clique no link e escolha a nova senha. Olhe também a caixa de spam.';
  msg.className = 'msg ok'; msg.hidden = false;
});

/* ============================================================
   Boas-vindas (primeiro acesso) e perfil da aluna
   ============================================================ */
const genClose = () => { $('gen-modal').hidden = true; $('gen-box').innerHTML = ''; $('gen-box').className = 'box'; };
function genOpen(html, cls = '') { $('gen-box').className = 'box ' + cls; $('gen-box').innerHTML = html; $('gen-modal').hidden = false; }
$('gen-modal').addEventListener('click', (ev) => { if (ev.target === $('gen-modal') && !$('gen-box').classList.contains('sticky')) genClose(); });

function renderAvatar(el, p, size) {
  if (p && p.photo) el.innerHTML = `<img src="${esc(p.photo)}" alt="">`;
  else el.textContent = (firstName(p && p.name) || '?').slice(0, 1).toUpperCase();
}

function maybeWelcome() {
  if (state.welcomeShown || state.welcomed) return;
  let seen = false; try { seen = localStorage.getItem('cj-welcome:' + state.user.uid) === '1'; } catch { /* ok */ }
  if (seen) return;
  state.welcomeShown = true;
  genOpen(`<div class="welcome">
      <img class="wl-logo" src="assets/logo-full-dark-on-transparent.png" alt="Closer Journey">
      <h3>Bem-vinda a bordo${firstName(state.profile.name) ? ', ' + esc(firstName(state.profile.name)) : ''}!</h3>
      <p>Essa não é só uma mentoria, é uma jornada de transformação, onde você vai desenvolver habilidades técnicas, construir confiança, entender o mercado e, principalmente, se reconectar com a sua potência!</p>
      <p>Aqui, você não vai caminhar sozinha. Vai ter acompanhamento, direcionamento e acesso ao que realmente importa para conquistar seu primeiro trabalho no digital com segurança e propósito!</p>
      <button class="btn btn-primary" id="wl-go" type="button">Começar minha jornada</button>
    </div>`, 'sticky');
  $('wl-go').onclick = () => {
    genClose();
    try { localStorage.setItem('cj-welcome:' + state.user.uid, '1'); } catch { /* ok */ }
    setDoc(doc(db, 'progress', state.user.uid), { welcomed: true }, { merge: true }).catch(() => {});
  };
}

/* corta no centro e reduz para um quadrado (cabe no Firestore) */
async function squarePhoto(file, size = 256) {
  if (!/^image\//.test(file.type)) throw new Error('escolha uma imagem');
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return cv.toDataURL('image/jpeg', 0.85);
}

function openProfile() {
  const p = state.profile || {};
  let photo = p.photo || '';
  genOpen(`<h3>Meu perfil</h3>
    <p class="sub">Atualize seus dados. O e-mail de acesso só pode ser alterado pela equipe.</p>
    <form id="pf-form" class="f">
      <div class="pf-photo"><span class="avatar big" id="pf-av"></span>
        <div><label class="btn btn-ghost small pf-pick">Escolher foto<input type="file" id="pf-file" accept="image/*" hidden></label>
        <button class="link-btn" type="button" id="pf-rm" ${photo ? '' : 'hidden'}>Remover foto</button></div></div>
      <label>Nome <input id="pf-name" required maxlength="80" value="${esc(p.name || '')}"></label>
      <label>Data de nascimento <input id="pf-birth" type="date" value="${esc(p.birth || '')}"></label>
      <label>E-mail <input value="${esc(p.email || state.user.email || '')}" disabled></label>
      <div id="pf-msg" class="msg err" hidden></div>
      <div class="btn-row"><button class="btn btn-primary small" type="submit" id="pf-save">Salvar</button>
      <button class="link-btn" type="button" id="pf-close">Fechar</button></div>
    </form>
    <hr class="pf-hr">
    <form id="pw-form" class="f">
      <b class="pf-sec">Alterar senha</b>
      <label>Senha atual <input id="pw-old" type="password" autocomplete="current-password"></label>
      <label>Nova senha <input id="pw-new" type="password" autocomplete="new-password" minlength="6"></label>
      <label>Repita a nova senha <input id="pw-new2" type="password" autocomplete="new-password"></label>
      <div id="pw-msg" class="msg err" hidden></div>
      <div class="btn-row"><button class="btn btn-ghost small" type="submit" id="pw-save">Alterar senha</button></div>
    </form>`, 'wide');
  const drawAv = () => renderAvatar($('pf-av'), { name: $('pf-name').value || p.name, photo }, 80);
  drawAv();
  $('pf-name').addEventListener('input', drawAv);
  $('pf-close').onclick = genClose;
  $('pf-rm').onclick = () => { photo = ''; $('pf-rm').hidden = true; drawAv(); };
  $('pf-file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try { photo = await squarePhoto(f); $('pf-rm').hidden = false; drawAv(); }
    catch (err) { const m = $('pf-msg'); m.textContent = 'Não consegui usar essa foto: ' + err.message; m.hidden = false; }
  });
  $('pf-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('pf-msg'); m.hidden = true;
    const name = $('pf-name').value.trim(), birth = $('pf-birth').value;
    if (!name) { m.textContent = 'Digite seu nome.'; m.hidden = false; return; }
    $('pf-save').disabled = true;
    try {
      await updateDoc(doc(db, 'users', state.user.uid), { name, photo, birth: birth || '' });
      const bd = birth ? { uid: state.user.uid, name: firstName(name) || name, month: Number(birth.slice(5, 7)), day: Number(birth.slice(8, 10)) } : null;
      if (bd) await setDoc(doc(db, 'birthdays', state.user.uid), bd);
      else await deleteDoc(doc(db, 'birthdays', state.user.uid)).catch(() => {});
      state.profile = { ...state.profile, name, photo, birth: birth || '' };
      $('who-name').textContent = firstName(name) || 'aluna';
      $('hello').textContent = `Bem-vinda a bordo${firstName(name) ? ', ' + firstName(name) : ''}`;
      renderAvatar($('who-av'), state.profile);
      toast('Perfil salvo.'); genClose();
    } catch (err) { m.textContent = friendlyError(err); m.hidden = false; }
    $('pf-save').disabled = false;
  });
  $('pw-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const m = $('pw-msg'); m.hidden = true; m.className = 'msg err';
    const o = $('pw-old').value, n1 = $('pw-new').value, n2 = $('pw-new2').value;
    if (!o || !n1) { m.textContent = 'Preencha a senha atual e a nova senha.'; m.hidden = false; return; }
    if (n1.length < 6) { m.textContent = 'A nova senha precisa ter ao menos 6 caracteres.'; m.hidden = false; return; }
    if (n1 !== n2) { m.textContent = 'A confirmação da nova senha não confere.'; m.hidden = false; return; }
    $('pw-save').disabled = true;
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(state.user.email, o));
      await updatePassword(auth.currentUser, n1);
      m.className = 'msg ok'; m.textContent = 'Senha alterada com sucesso.'; m.hidden = false;
      $('pw-old').value = $('pw-new').value = $('pw-new2').value = '';
    } catch (err) {
      m.textContent = (err && (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')) ? 'A senha atual não confere.' : friendlyError(err);
      m.hidden = false;
    }
    $('pw-save').disabled = false;
  });
}
$('who-btn').addEventListener('click', openProfile);

$('logout').addEventListener('click', () => signOut(auth));
$('denied-out').addEventListener('click', () => signOut(auth));

/* ============================================================
   App
   ============================================================ */
function startApp() {
  const p = state.profile;
  $('who-name').textContent = firstName(p.name) || 'aluna';
  renderAvatar($('who-av'), p);
  $('hello').textContent = `Bem-vinda a bordo${firstName(p.name) ? ', ' + firstName(p.name) : ''}`;
  $('admin-link').hidden = p.role !== 'admin';
  renderAccessNote();
  /* registra o acesso (o painel da Cris mostra "ultima atividade") */
  setDoc(doc(db, 'progress', state.user.uid), { lastSeen: serverTimestamp() }, { merge: true }).catch(() => {});
  /* se a data limite chegar com a aluna logada, o acesso e encerrado sem precisar recarregar */
  clearInterval(state.accessTimer);
  state.accessTimer = setInterval(async () => {
    if (!accessInfo(state.profile).expired) return;
    try { const fresh = await getDoc(doc(db, 'users', state.user.uid)); if (fresh.exists()) state.profile = fresh.data(); } catch { /* segue com o que tem */ }
    const acc = accessInfo(state.profile);
    if (acc.expired || state.profile.active !== true) {
      cleanup();
      $('denied-text').textContent = acc.expired ? `Seu acesso à Área de Embarque terminou em ${fmtDMY(acc.untilKey)}. Para renovar, fale com a equipe Closer Journey.` : 'Seu acesso está desativado no momento. Fale com a equipe Closer Journey.';
      show('v-denied');
    } else renderAccessNote();
  }, 60000);

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

  state.unsubs.push(onSnapshot(query(collection(db, 'hotseats'), where('published', '==', true)), (snap) => {
    state.hotseats = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    render();
  }, onErr));
  state.unsubs.push(onSnapshot(collection(db, 'eventQuestions'), (snap) => {
    state.questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (state.openEv && !$('ev-modal').hidden) openEvent(state.openEv);
  }, onErr));
  state.unsubs.push(onSnapshot(collection(db, 'birthdays'), (snap) => {
    state.birthdays = snap.docs.map((d) => d.data());
    renderCal();
  }, onErr));

  state.unsubs.push(onSnapshot(collection(db, 'signups'), (snap) => {
    state.signups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCal();
    if (state.openEv && !$('ev-modal').hidden) openEvent(state.openEv);
  }, onErr));

  state.unsubs.push(onSnapshot(query(collection(db, 'submissions'), where('uid', '==', uid)), (snap) => {
    const m = {};
    snap.docs.forEach((d) => { const x = d.data(); m[x.lessonId] = x; });
    state.subs = m;
    render();
  }, onErr));

  state.unsubs.push(onSnapshot(query(collection(db, 'notes'), where('uid', '==', uid)), (snap) => {
    const m = {};
    snap.docs.forEach((d) => { const x = d.data(); m[x.lessonId] = x; });
    state.notes = m;
    render();
  }, onErr));

  state.unsubs.push(onSnapshot(doc(db, 'progress', uid), (snap) => {
    state.completed = (snap.exists() && snap.data().completed) || {};
    state.doneAt = (snap.exists() && snap.data().doneAt) || {};
    state.welcomed = !!(snap.exists() && snap.data().welcomed);
    render();
    maybeWelcome();
  }, onErr));

  showHome();
  show('v-app');
}

/* ---------- abas ---------- */
function setTab(which) {
  $('tab-trilha').setAttribute('aria-selected', which === 'trilha');
  $('tab-cal').setAttribute('aria-selected', which === 'cal');
  $('tab-mat').setAttribute('aria-selected', which === 'mat');
  $('tab-pass').setAttribute('aria-selected', which === 'pass');
  $('tab-hs').setAttribute('aria-selected', which === 'hs');
  $('p-hs').hidden = which !== 'hs';
  $('p-pass').hidden = which !== 'pass';
  $('p-trilha').hidden = which !== 'trilha';
  $('p-cal').hidden = which !== 'cal';
  $('p-mat').hidden = which !== 'mat';
  state.tab = which;
  applySide();
}
$('tab-trilha').addEventListener('click', () => setTab('trilha'));
$('tab-cal').addEventListener('click', () => { setTab('cal'); renderCal(); });
$('tab-mat').addEventListener('click', () => { setTab('mat'); renderMaterial(); render(); });
$('tab-pass').addEventListener('click', () => { setTab('pass'); render(); });
$('tab-hs').addEventListener('click', () => { setTab('hs'); render(); });

function showHome() {
  state.openLesson = null;
  const sl = $('s-lesson');
  sl.hidden = true; sl.innerHTML = ''; sl.dataset.lessonId = ''; sl.dataset.mediaKey = ''; sl.dataset.infoKey = ''; sl.dataset.subKey = ''; sl.dataset.noteLesson = '';
  $('s-home').hidden = false;
  applySide();
  render();
}

/* ============================================================
   Trilha
   ============================================================ */
function trail() { return computeTrail(state.lessons, state.completed); }

function render() {
  renderSide();
  const nm = Object.values(state.notes).filter((n) => n.note || (n.answers && n.answers.length)).length;
  $('side-mat').innerHTML = `Material de apoio${nm ? ` <small>${nm}</small>` : ''}`;
  const mods = passportModules();
  const got = mods.filter((m) => m.complete).length;
  $('side-pass').innerHTML = `Meu passaporte${mods.length ? ` <small>${got}/${mods.length}</small>` : ''}`;
  syncNav();
  if (state.openLesson) { renderLesson(); return; }
  renderTrail();
  renderMaterial();
  renderPassport(mods);
  renderHotseatList();
}

/* ============================================================
   Passaporte: um carimbo por modulo concluido
   ============================================================ */
function passportModules(completed = state.completed, doneAt = state.doneAt) {
  const map = new Map();
  computeTrail(state.lessons, completed).forEach((l) => {
    const k = (l.module || 'Sem módulo').trim() || 'Sem módulo';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(l);
  });
  return [...map.entries()].map(([name, items]) => {
    const done = items.filter((i) => i.done).length;
    const complete = items.length > 0 && done === items.length;
    const stamps = items.map((i) => doneAt && doneAt[i.id]).filter(Boolean);
    const when = complete && stamps.length === items.length ? Math.max(...stamps) : null;
    return { name, total: items.length, done, complete, when };
  });
}

const STAMP_ROT = [-8, 5, -4, 9, -6, 3];
const MON = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
function stampSvg(m, i) {
  let nm = m.name.replace(/[^\p{L}\p{N}\s\-.,:&]/gu, '').replace(/\s+/g, ' ').trim().toUpperCase() || 'MÓDULO';
  if (nm.length > 24) nm = nm.slice(0, 23).trim() + '…';
  const fs = nm.length <= 12 ? 16 : nm.length <= 18 ? 13 : 11;
  let date = '';
  if (m.when) { const d = new Date(m.when - 3 * 3600e3); date = `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
  return `<svg class="stamp-svg" viewBox="0 0 200 200" role="img" aria-label="Carimbo do módulo ${esc(m.name)}">
    <defs><path id="sp${i}t" d="M 30,100 A 70,70 0 0 1 170,100"/><path id="sp${i}b" d="M 22,100 A 78,78 0 0 0 178,100"/></defs>
    <circle cx="100" cy="100" r="94" class="s-ring1"/><circle cx="100" cy="100" r="87" class="s-ring2"/><circle cx="100" cy="100" r="50" class="s-ring2"/>
    <text class="s-name" font-size="${fs}"><textPath href="#sp${i}t" startOffset="50%" text-anchor="middle">${esc(nm)}</textPath></text>
    <text class="s-sub" font-size="10"><textPath href="#sp${i}b" startOffset="50%" text-anchor="middle">CLOSER JOURNEY</textPath></text>
    <g class="s-plane" transform="translate(100 92) scale(1.5) translate(-12 -12)"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" fill="currentColor"/></g>
    ${date ? `<text x="100" y="128" class="s-date" text-anchor="middle">${date}</text>` : '<text x="100" y="128" class="s-date" text-anchor="middle">CONCLUÍDO</text>'}
    <text x="30" y="104" class="s-star">★</text><text x="170" y="104" class="s-star" text-anchor="end">★</text>
  </svg>`;
}

function renderPassport(mods) {
  const box = $('pass-body');
  if (!box) return;
  if (!mods.length) { box.innerHTML = '<div class="empty">Seu passaporte aparece quando os módulos da jornada forem publicados.</div>'; return; }
  const got = mods.filter((m) => m.complete).length;
  const fresh = state.newStamp;
  const PER = 4;
  const p = state.profile || {};
  const uid = (state.user && state.user.uid) || '';
  const num = 'CJ' + uid.slice(0, 7).toUpperCase().padEnd(7, '0');
  const issued = p.createdAt && p.createdAt.toDate ? fmtDMY(brParts(p.createdAt.toDate()).date) : '';
  const until = p.accessUntil && p.accessUntil.toDate ? fmtDMY(brParts(p.accessUntil.toDate()).date) : '';
  const nm = (p.name || '').trim();
  const mrz1 = ('P<BRA<CJ<' + nm.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z ]/g, '').trim().replace(/\s+/g, '<')).padEnd(34, '<').slice(0, 34);
  const mrz2 = (num + '<<' + got + 'DE' + mods.length + '<CARIMBOS<<<<<<<<<<<<<<<').slice(0, 34);
  const identity = `<div class="pp-page pp-id">
      <div class="pp-ph">Passaporte · Passport</div>
      <div class="pp-idrow">
        <div class="pp-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<span>${esc((firstName(nm) || '?').slice(0, 1).toUpperCase())}</span>`}</div>
        <dl>
          <dt>Nome / Name</dt><dd>${esc(nm || 'Aluna')}</dd>
          <dt>Nº do passaporte</dt><dd>${esc(num)}</dd>
          <dt>Emissão</dt><dd>${esc(issued || 'Embarque')}</dd>
          <dt>Válido até</dt><dd>${esc(until || 'Sem limite')}</dd>
        </dl>
      </div>
      <div class="pp-mrz"><span>${esc(mrz1)}</span><span>${esc(mrz2)}</span></div>
      <div class="pp-pn">Closer Journey</div>
    </div>`;
  const pages = [identity];
  for (let k = 0; k < mods.length; k += PER) {
    const chunk = mods.slice(k, k + PER);
    pages.push(`<div class="pp-page pp-vistos">
        <div class="pp-ph">Vistos · Carimbos</div>
        <div class="pp-grid">${chunk.map((m, j) => { const i = k + j; return m.complete
          ? `<div class="pp-slot has${fresh === m.name ? ' is-new' : ''}"><div class="stamp" style="--rot:${STAMP_ROT[i % 6]}deg">${stampSvg(m, i)}</div><div class="cap"><b>${esc(modName(m.name))}</b></div></div>`
          : `<div class="pp-slot"><div class="stamp empty"><span>${i + 1}</span></div><div class="cap"><b>${esc(modName(m.name))}</b><span>${m.done}/${m.total} etapas${m.done ? '' : ' · a conquistar'}</span></div></div>`; }).join('')}</div>
        <div class="pp-pn">${pages.length + 1}</div>
      </div>`);
  }
  if (pages.length % 2) pages.push('<div class="pp-page pp-vistos pp-blank"><div class="pp-ph">Vistos · Carimbos</div><div class="pp-wm">✈︎</div><div class="pp-pn">' + (pages.length + 1) + '</div></div>');
  pages[0] = pages[0].replace('<div class="pp-pn">Closer Journey</div>', '<div class="pp-pn">1</div>');
  const spreads = pages.length / 2;
  if (fresh) {
    const idx = mods.findIndex((m) => m.name === fresh);
    if (idx >= 0) { state.ppPage = Math.floor((idx + 1) / PER) ; state.ppOpen = true; }
  }
  state.ppPage = Math.max(0, Math.min(spreads - 1, state.ppPage || 0));
  const all = got === mods.length;
  if (!state.ppOpen) {
    box.innerHTML = `<div class="pp-wrap">
      <button class="pp-cover" type="button" data-pp="open" aria-label="Abrir passaporte">
        <span class="pp-edge"></span>
        <span class="pp-emblem"><svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="33" stroke-width=".8"/><path d="M50 10v80M10 50h80" stroke-width=".7"/><path d="M50 22l5 28 20 10-20 4-5 14-5-14-20-4 20-10z" fill="currentColor" stroke="none"/></svg></span>
        <span class="pp-ctitle">PASSAPORTE</span>
        <span class="pp-csub">Closer Journey</span>
        <span class="pp-ccount"><b>${got}</b> de ${mods.length} carimbo${mods.length > 1 ? 's' : ''}</span>
        <span class="pp-open">Toque para abrir</span>
      </button>
      <p class="pp-note">${all ? 'Passaporte completo! Você percorreu toda a jornada.' : 'Cada módulo finalizado vira um carimbo no seu passaporte.'}</p>
    </div>`;
  } else {
    const L = pages[state.ppPage * 2], R = pages[state.ppPage * 2 + 1];
    box.innerHTML = `<div class="pp-wrap">
      <div class="pp-book" data-spread="${state.ppPage}">
        <div class="pp-spread">${L}${R}</div>
      </div>
      <div class="pp-nav">
        <button class="btn btn-ghost" type="button" data-pp="prev"${state.ppPage === 0 ? ' disabled' : ''}>‹ Anterior</button>
        <span>${state.ppPage + 1} / ${spreads}</span>
        <button class="btn btn-ghost" type="button" data-pp="next"${state.ppPage >= spreads - 1 ? ' disabled' : ''}>Próxima ›</button>
      </div>
      <div class="pp-nav"><button class="link-btn" type="button" data-pp="close">Fechar passaporte</button></div>
    </div>`;
  }
  if (!box.dataset.ppBound) {
    box.dataset.ppBound = '1';
    box.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pp]');
      if (!t || t.disabled) return;
      const k = t.dataset.pp;
      if (k === 'open') state.ppOpen = true;
      else if (k === 'close') state.ppOpen = false;
      else if (k === 'prev') state.ppPage = Math.max(0, (state.ppPage || 0) - 1);
      else if (k === 'next') state.ppPage = (state.ppPage || 0) + 1;
      render();
    });
  }
  if (fresh && state.tab === 'pass') state.newStamp = '';
}

/* ---------- menu lateral (montado a partir dos modulos e aulas publicados) ---------- */
function renderSide() {
  const box = $('side-list');
  if (!box) return;
  const items = trail();
  if (!items.length) {
    box.innerHTML = '<p class="side-empty">Os módulos e aulas aparecem aqui conforme forem publicados.</p>';
    return;
  }
  box.innerHTML = groupByModule(items).map((g) => {
    const done = g.items.filter((i) => i.done).length;
    const closed = !!state.collapsed[g.module];
    return `<div class="side-mod${closed ? ' is-collapsed' : ''}">
      <button type="button" class="side-mod-h" data-mod="${esc(g.module)}" aria-expanded="${!closed}">
        <span class="nm">${esc(modName(g.module))}</span><small>${done}/${g.items.length}</small><i class="chev"></i>
      </button>
      <ul>${g.items.map(sideItem).join('')}</ul></div>`;
  }).join('');
}

function sideItem(l) {
  const ativ = l.kind === 'atividade';
  const cls = [l.done ? 'done' : '', l.current ? 'current' : '', !l.unlocked ? 'locked' : '', state.openLesson === l.id ? 'active' : '', ativ ? 'is-ativ' : 'is-aula'].join(' ');
  const st = l.done ? `<span class="sst ok" title="Finalizada">${ICON.check}</span>` : !l.unlocked ? `<span class="sst" title="Bloqueada">${ICON.lock}</span>` : '';
  return `<li><button type="button" class="side-item ${cls}" ${l.unlocked ? `data-open="${esc(l.id)}"` : 'disabled aria-disabled="true"'}>
    <span class="si ${ativ ? 'k-ativ' : 'k-aula'}" title="${ativ ? 'Atividade' : 'Aula'}">${ativ ? ICON.ativ : ICON.aula}</span><span class="tt">${esc(l.title)}</span>${st}</button></li>`;
}

document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-mod]');
  if (m) { state.collapsed[m.dataset.mod] = !state.collapsed[m.dataset.mod]; renderSide(); }
});
$('side-home').addEventListener('click', () => { setMenu(false); showHome(); setTab('trilha'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('side-pass').addEventListener('click', () => { setMenu(false); showHome(); setTab('pass'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('side-hs').addEventListener('click', () => { setMenu(false); showHome(); setTab('hs'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('side-mat').addEventListener('click', () => { setMenu(false); showHome(); setTab('mat'); renderMaterial(); render(); window.scrollTo(0, 0); });
$('side-cal').addEventListener('click', () => { setMenu(false); showHome(); setTab('cal'); renderCal(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
const setMenu = (open) => { document.body.classList.toggle('side-open', open); $('menu-btn').setAttribute('aria-expanded', open); $('menu-btn').setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu'); };
$('menu-btn').addEventListener('click', () => setMenu(!document.body.classList.contains('side-open')));
$('side-x').addEventListener('click', () => setMenu(false));
$('side-ov').addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setMenu(false); });
/* ao escolher qualquer item, o menu recolhe */
$('side').addEventListener('click', (ev) => { if (ev.target.closest('button') && !ev.target.closest('[data-mod]') && !ev.target.closest('#side-x')) setMenu(false); });

function renderBarDividers(items) {
  const wrap = $('bar-wrap'); if (!wrap) return;
  if (!items.length) { wrap.querySelector('.bar-ticks').innerHTML = ''; wrap.querySelector('.bar-legend').innerHTML = ''; return; }
  const groups = groupByModule(items);
  let acc = 0;
  const ticks = groups.slice(0, -1).map((g) => { acc += g.items.length; return `<b class="tick" style="left:${(acc / items.length) * 100}%"></b>`; }).join('');
  wrap.querySelector('.bar-ticks').innerHTML = ticks;
  wrap.querySelector('.bar-legend').innerHTML = groups.map((g) => {
    const d = g.items.filter((i) => i.done).length;
    const clean = g.module.replace(/^[^\p{L}\p{N}]+/u, '');
    return `<span class="${d === g.items.length ? 'ok' : ''}" style="flex:${g.items.length}" title="${esc(g.module)}: ${d}/${g.items.length}">${esc(clean)}</span>`;
  }).join('');
}

function renderTrail() {
  const items = trail();
  const box = $('trail');
  if (!items.length) {
    box.innerHTML = '<div class="empty">As primeiras etapas da sua jornada ainda estão sendo preparadas. Volte em breve.</div>';
    $('next-up').innerHTML = ''; $('pct').textContent = '0%'; $('bar').style.width = '0'; $('export-all').innerHTML = '';
    return;
  }
  const req = items;
  const done = req.filter((i) => i.done).length;
  const pct = req.length ? Math.round((done / req.length) * 100) : 0;
  $('pct').textContent = pct + '%';
  $('bar').style.width = pct + '%';
  renderBarDividers(items);

  const cur = items.find((i) => i.current);
  $('next-up').innerHTML = cur
    ? `<div class="next-up"><div><small>${done === 0 ? 'Sua primeira parada' : 'Próxima parada'}</small><strong>${esc(cur.title)}</strong></div>
       <button class="btn btn-primary small" data-open="${esc(cur.id)}" type="button">${done === 0 ? 'Comece aqui' : 'Continuar'}</button></div>`
    : `<div class="next-up"><div><small>Jornada</small><strong>Você finalizou todas as etapas liberadas até agora.</strong></div></div>`;

  const nSubs = items.filter((i) => i.kind === 'atividade' && state.subs[i.id]).length;
  $('export-all').innerHTML = nSubs
    ? `<div class="export-bar"><div><strong>Suas respostas</strong><small>${nSubs} atividade${nSubs > 1 ? 's' : ''} com resposta. Baixe em PDF para consultar como material de apoio.</small></div>
       <button class="btn btn-ghost small" id="pdf-all" type="button">Baixar todas (PDF)</button></div>`
    : '';
  const pa = $('pdf-all'); if (pa) pa.onclick = () => printAnswers();

  box.innerHTML = groupByModule(items).map((g) => `
    <div class="module">
      <h3>${esc(modName(g.module))}</h3>
      <ul class="stops">${g.items.map(stopRow).join('')}</ul>
    </div>`).join('');
}

function stopRow(l) {
  const cls = l.done ? 'done' : l.current ? 'current' : !l.unlocked ? 'locked' : '';
  const ico = l.done ? ICON.check : !l.unlocked ? ICON.lock : l.kind === 'atividade' ? ICON.task : ICON.play;
  const fb = state.subs[l.id] && state.subs[l.id].status === 'corrigida';
  const st = l.done ? (fb ? 'Finalizada · feedback' : 'Finalizada') : !l.unlocked ? 'Bloqueada' : l.current ? 'Liberada' : 'Revisar';
  return `<li><button type="button" class="stop-row ${cls}" ${l.unlocked ? `data-open="${esc(l.id)}"` : 'disabled aria-disabled="true"'}>
    <span class="ico">${ico}</span>
    <span><span class="t">${esc(l.title)}</span>
    <span class="m"><span class="kind-tag">${l.kind === 'atividade' ? 'Atividade' : 'Aula'}</span></span></span>
    <span class="st">${st}</span></button></li>`;
}

document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o && !o.disabled) { setMenu(false); openLesson(o.dataset.open); }
});

/* ============================================================
   Aula
   ============================================================ */
/* imagens da aula/atividade: buscadas uma vez e guardadas na memoria */
function loadLessonImages(l) {
  (l.images || []).forEach((id) => {
    if (id in state.imgs) return;
    state.imgs[id] = null;
    getDoc(doc(db, 'lessonImages', id)).then((s) => {
      if (!s.exists()) return;
      state.imgs[id] = s.data().data;
      if (state.openLesson === l.id) { const sec = $('s-lesson'); if (sec) sec.dataset.infoKey = ''; render(); }
    }).catch((err) => {
      delete state.imgs[id];
      state.imgErr = (err && err.code === 'permission-denied') ? 'Sem permissão para ver as imagens desta etapa. Avise a equipe Closer Journey.' : 'Não foi possível carregar as imagens agora. Atualize a página.';
      const sec = $('s-lesson'); if (sec) sec.dataset.infoKey = ''; if (state.openLesson === l.id) render();
    });
  });
}

/* clique na imagem abre ampliada */
document.addEventListener('click', (ev) => {
  const im = ev.target.closest && ev.target.closest('img[data-zoom]');
  if (im) {
    const o = document.createElement('div'); o.className = 'img-zoom';
    o.innerHTML = `<img src="${im.src}" alt="">`;
    o.onclick = () => o.remove(); document.body.appendChild(o);
  }
});

function openLesson(id) {
  const l = trail().find((x) => x.id === id);
  if (!l || !l.unlocked) { toast('Finalize a etapa anterior para liberar esta.'); return; }
  state.openLesson = id;
  applySide();
  $('s-home').hidden = true; $('s-lesson').hidden = false;
  window.scrollTo({ top: 0 });
  renderLesson();
}

/* ---------- player embutido (web view dentro do site) ---------- */
let ytApi;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    const sc = document.createElement('script');
    sc.src = 'https://www.youtube.com/iframe_api';
    sc.onerror = () => { ytApi = null; reject(new Error('yt-api')); };
    document.head.appendChild(sc);
  });
  return ytApi;
}

function seekVideo(box, v, sec) {
  if (!box || !v) return;
  if (v.kind === 'youtube') {
    if (box._yt && box._yt.seekTo) { box._yt.seekTo(sec, true); box._yt.playVideo(); }
    else { box._start = sec; const p = box.querySelector('.player-play'); if (p) p.click(); }
  } else if (v.kind === 'vimeo') {
    const f = box.querySelector('iframe'); if (f) f.src = `${v.embed}&title=0&byline=0&portrait=0&autoplay=1#t=${sec}s`;
  } else toast(`Neste formato de vídeo, avance manualmente até ${fmtTs(sec)}.`);
}

function mountVideo(box, v, title) {
  if (v.kind === 'vimeo') {
    box.innerHTML = `<iframe src="${esc(v.embed)}&title=0&byline=0&portrait=0" title="${esc(title)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    return;
  }
  if (v.kind === 'drive') {
    box.classList.add('is-drive');
    box.innerHTML = `<iframe src="${esc(v.embed)}" title="${esc(title)}" allow="autoplay; fullscreen" allowfullscreen></iframe><div class="drive-shield" aria-hidden="true"></div>`;
    return;
  }
  box.innerHTML = `
    <img class="player-thumb" src="https://img.youtube.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" onerror="this.style.display='none'">
    <button class="player-play" type="button" aria-label="Assistir aula">${ICON.play}</button>
    <div class="player-host"></div>
    <div class="player-err" hidden></div>`;
  const err = (msg) => {
    const e = box.querySelector('.player-err');
    e.textContent = msg; e.hidden = false;
    box.querySelector('.player-play').hidden = true;
  };
  box.querySelector('.player-play').addEventListener('click', async () => {
    box.classList.add('is-playing');
    try {
      await loadYT();
      box._yt = new window.YT.Player(box.querySelector('.player-host'), {
        host: 'https://www.youtube-nocookie.com',
        videoId: v.id, width: '100%', height: '100%',
        playerVars: {
          autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, start: box._start || 0,
          origin: location.origin
        },
        events: {
          onError: (ev) => {
            box.classList.remove('is-playing');
            const admin = state.profile && state.profile.role === 'admin';
            const hint = (ev.data === 101 || ev.data === 150)
              ? (admin ? 'O dono do vídeo bloqueou a reprodução em outros sites. No YouTube Studio, ative "Permitir incorporação" neste vídeo.' : 'Este vídeo ainda não está liberado para reprodução aqui. Avise a equipe Closer Journey.')
              : (admin ? 'Vídeo não encontrado ou privado. Confira o link e se a visibilidade é "Não listado".' : 'Não foi possível carregar este vídeo. Avise a equipe Closer Journey.');
            err(hint);
          },
          onStateChange: (ev) => {
            if (ev.data === window.YT.PlayerState.ENDED) toast('Aula assistida! Marque como finalizada para liberar a próxima.');
          }
        }
      });
    } catch (e) {
      box.classList.remove('is-playing');
      err('Não foi possível carregar o player. Verifique sua conexão e tente de novo.');
    }
  });
}

/* ============================================================
   Hotseats gravados
   ============================================================ */
const hsOpen = () => String(state.openLesson || '').startsWith('hs_');
const hsById = (id) => state.hotseats.find((x) => x.id === id);

/* "da sua jornada" = hotseats ocorridos enquanto a aluna tinha acesso */
function hsInJourney(h) {
  const p = state.profile || {};
  const s = p.createdAt && p.createdAt.toDate ? brParts(p.createdAt.toDate()).date : '';
  const en = p.accessUntil && p.accessUntil.toDate ? brParts(p.accessUntil.toDate()).date : '';
  return (!s || h.date >= s) && (!en || h.date <= en);
}

function renderHotseatList() {
  const box = $('hs-body'); if (!box) return;
  const mine = state.hotseats.filter(hsInJourney), others = state.hotseats.filter((h) => !hsInJourney(h));
  const list = state.hsTab === 'mine' ? mine : others;
  const card = (h) => `<li><button type="button" class="hs-card" data-open-hs="${esc(h.id)}">
      <span class="hs-play">${ICON.aula}</span>
      <span class="hs-t"><b>${esc(h.title)}</b><small>${esc(fmtDMY(h.date))}${(h.chapters || []).length ? ` · ${h.chapters.length} marcadores` : ''}</small></span>
      <span class="hs-go">Assistir</span></button></li>`;
  box.innerHTML = `
    <div class="hs-tabs" role="tablist">
      <button type="button" class="hs-tab" data-hstab="mine" aria-selected="${state.hsTab === 'mine'}">Hotseats da sua jornada <small>${mine.length}</small></button>
      <button type="button" class="hs-tab" data-hstab="others" aria-selected="${state.hsTab === 'others'}">Demais hotseats <small>${others.length}</small></button>
    </div>
    <p class="a-sub" style="margin-top:0">${state.hsTab === 'mine' ? 'Gravações dos hotseats que aconteceram durante o seu período de acesso.' : 'Gravações de hotseats de outros períodos.'}</p>
    ${list.length ? `<ul class="hs-list">${list.map(card).join('')}</ul>` : `<div class="empty">${state.hsTab === 'mine' ? 'Ainda não há hotseats gravados no seu período.' : 'Nenhum outro hotseat disponível por enquanto.'}</div>`}`;
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-hstab]');
  if (t) { state.hsTab = t.dataset.hstab; renderHotseatList(); return; }
  const o = ev.target.closest('[data-open-hs]');
  if (o) openHotseat(o.dataset.openHs);
});

function openHotseat(id) {
  if (!hsById(id)) return;
  state.openLesson = 'hs_' + id;
  applySide();
  $('s-home').hidden = true; $('s-lesson').hidden = false;
  window.scrollTo({ top: 0 });
  render();
}

function renderHotseatView() {
  const h = hsById(state.openLesson.slice(3));
  const sec = $('s-lesson');
  if (!h) { showHome(); setTab('hs'); render(); return; }
  if (sec.dataset.lessonId !== state.openLesson) {
    sec.dataset.lessonId = state.openLesson; sec.dataset.mediaKey = ''; sec.dataset.infoKey = ''; sec.dataset.noteLesson = '';
    sec.innerHTML = `
      <div class="lesson-head">
        <button class="link-btn" type="button" id="back">&larr; Voltar para os hotseats</button>
        <span class="kind-tag">Hotseat · ${esc(fmtDMY(h.date))}</span>
      </div>
      <h1 class="a-title" id="l-title"></h1>
      <div class="lesson-split">
        <div class="ls-media" id="l-media"></div>
        <div class="ls-notes" id="l-notes"></div>
      </div>
      <div id="l-info"></div>`;
    $('back').onclick = () => { showHome(); setTab('hs'); render(); };
    applySide();
  }
  $('l-title').textContent = h.title;
  const v = parseVideo(h.videoUrl);
  const mk = v ? `${v.kind}:${v.id || v.url}` : 'none';
  if (sec.dataset.mediaKey !== mk) {
    sec.dataset.mediaKey = mk;
    const m = $('l-media');
    if (v && v.embed) { m.innerHTML = '<div class="player"></div>'; mountVideo(m.firstChild, v, h.title); }
    else if (v && safeUrl(v.url)) m.innerHTML = `<div class="player-fallback"><p>Esta gravação é de uma plataforma que não permite exibição aqui.</p><a class="btn btn-ghost on-dark small" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">Abrir gravação em nova aba</a></div>`;
    else m.innerHTML = '<div class="empty">A gravação ainda não foi adicionada.</div>';
  }
  const ik = JSON.stringify([h.chapters, h.transcript]);
  if (sec.dataset.infoKey !== ik) {
    sec.dataset.infoKey = ik;
    const ch = (h.chapters || []);
    const parts = [];
    if (ch.length) parts.push(`<details class="desc-fold" open><summary>Minutagem</summary><ul class="chapters">${ch.map((c) => `<li><button type="button" class="chap" data-seek="${c.t}"><b>${esc(fmtTs(c.t))}</b><span>${esc(c.label)}</span></button></li>`).join('')}</ul></details>`);
    if (h.transcript) parts.push(`<details class="desc-fold"><summary>Transcrição</summary><div class="transcript">${esc(h.transcript).replace(/\n/g, '<br>')}</div></details>`);
    $('l-info').innerHTML = parts.length ? `<div class="lesson-body">${parts.join('')}</div>` : '';
    $('l-info').querySelectorAll('[data-seek]').forEach((b) => {
      b.onclick = () => { const pl = $('l-media').firstChild; seekVideo(pl, v, Number(b.dataset.seek)); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    });
  }
  renderNotes({ id: state.openLesson, kind: 'hotseat', title: h.title, module: 'Hotseats' });
}

const TAB_TITLE = { trilha: 'Visão geral', cal: 'Calendário', mat: 'Material de apoio', pass: 'Meu passaporte', hs: 'Hotseats' };
function syncNav() {
  const home = !state.openLesson;
  if (home) {
    $('page-title').textContent = TAB_TITLE[state.tab] || 'Visão geral';
    $('hello').hidden = state.tab !== 'trilha';
    $('access-note').hidden = state.tab !== 'trilha';
  }
  $('side-cal').classList.toggle('is-on', home && state.tab === 'cal');
  $('side-home').classList.toggle('is-on', home && state.tab === 'trilha');
  $('side-mat').classList.toggle('is-on', home && state.tab === 'mat');
  $('side-pass').classList.toggle('is-on', home && state.tab === 'pass');
  $('side-hs').classList.toggle('is-on', (home && state.tab === 'hs') || hsOpen());
}

function applySide() {
  syncNav();
}

function renderLesson() {
  if (hsOpen()) { renderHotseatView(); return; }
  const items = trail();
  const idx = items.findIndex((x) => x.id === state.openLesson);
  const l = items[idx];
  const sec = $('s-lesson');
  if (!l || !l.unlocked) { showHome(); return; }

  /* esqueleto fixo: player, PDF e formulario nao sao recriados quando algo atualiza */
  if (sec.dataset.lessonId !== l.id) {
    sec.dataset.lessonId = l.id; sec.dataset.mediaKey = ''; sec.dataset.infoKey = ''; sec.dataset.subKey = ''; sec.dataset.noteLesson = '';
    state.editingSub = false;
    sec.innerHTML = `
      <div class="lesson-head">
        <button class="link-btn" type="button" id="back">&larr; Voltar para a jornada</button>
        <span class="kind-tag" id="l-tag"></span>
      </div>
      <h1 class="a-title" id="l-title"></h1>
      <div class="lesson-split${l.kind === 'atividade' ? ' solo' : ''}">
        <div class="ls-media" id="l-media"></div>
        <div class="ls-notes" id="l-notes"></div>
      </div>
      <div id="l-info"></div>
      <div id="l-sub"></div>
      <div id="l-actions"></div>`;
    $('back').onclick = showHome;
    applySide();
  }
  $('l-tag').textContent = `${modName(l.module)} · ${l.kind === 'atividade' ? 'Atividade' : 'Aula'}`;
  $('l-title').textContent = l.title;

  /* ---- video ---- */
  const v = parseVideo(l.videoUrl);
  const mediaKey = v ? `${v.kind}:${v.id || v.url}` : 'none:' + l.kind;
  if (sec.dataset.mediaKey !== mediaKey) {
    sec.dataset.mediaKey = mediaKey;
    const m = $('l-media');
    if (v && v.embed) {
      m.innerHTML = '<div class="player"></div>';
      mountVideo(m.firstChild, v, l.title);
    } else if (v && v.kind === 'link' && safeUrl(v.url)) {
      m.innerHTML = `<div class="player-fallback"><p>Este vídeo é de uma plataforma que não permite exibição aqui.</p><a class="btn btn-ghost on-dark small" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">Abrir vídeo em nova aba</a></div>`;
    } else if (l.kind === 'aula') {
      m.innerHTML = '<div class="empty">O vídeo desta aula ainda não foi adicionado.</div>';
    } else m.innerHTML = '';
  }

  /* ---- conteudo: descricao, texto da atividade, PDF, link ---- */
  loadLessonImages(l);
  const imgList = (l.images || []).map((id) => state.imgs[id]).filter(Boolean);
  const infoKey = JSON.stringify([l.kind, l.description, l.body, l.pdfUrl, l.linkUrl, l.images, imgList.length, state.imgErr]);
  if (sec.dataset.infoKey !== infoKey) {
    sec.dataset.infoKey = infoKey;
    const link = safeUrl(l.linkUrl);
    const pdf = parseDriveFile(l.pdfUrl);
    const pdfOther = !pdf && safeUrl(l.pdfUrl);
    const parts = [];
    if (l.description) parts.push(`<div class="rich"><p>${linkify(l.description)}</p></div>`);
    if (l.body) parts.push(`<div class="rich">${renderRich(l.body)}</div>`);
    if ((l.images || []).length && !imgList.length && state.imgErr) parts.push(`<p class="hint-inline">${esc(state.imgErr)}</p>`);
    if (imgList.length) parts.push(`<div class="lesson-imgs">${imgList.map((d, i) => `<figure><img src="${d}" alt="Imagem ${i + 1} da etapa" loading="lazy" data-zoom></figure>`).join('')}</div>`);
    if (pdf) parts.push(`<div class="pdf-wrap"><div class="pdf-head"><span>Material em PDF</span><a href="${esc(pdf.open)}" target="_blank" rel="noopener noreferrer">Abrir em tela cheia</a></div><iframe class="pdf-frame" src="${esc(pdf.embed)}" title="PDF da atividade" loading="lazy"></iframe></div>`);
    else if (pdfOther) parts.push(`<p><a class="btn btn-ghost small" href="${esc(pdfOther)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a></p>`);
    if (link) parts.push(`<p><a class="btn btn-primary small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${l.kind === 'atividade' ? 'Abrir atividade' : 'Abrir material'}</a></p>`);
    if (!parts.length) $('l-info').innerHTML = '';
    else if (l.kind === 'aula') {
      $('l-info').innerHTML = `<div class="lesson-body"><details class="desc-fold" ${state.descClosed ? '' : 'open'}><summary>Sobre esta aula</summary>${parts.join('')}</details></div>`;
      $('l-info').querySelector('details').addEventListener('toggle', (ev) => { state.descClosed = !ev.target.open; });
    } else $('l-info').innerHTML = `<div class="lesson-body">${parts.join('')}</div>`;
  }

  /* ---- resposta + feedback (so em atividades com feedback) ---- */
  renderSub(l);
  renderNotes(l);

  /* ---- acoes ---- */
  const next = items[idx + 1];
  const unmarkable = l.done && canUnmark(items, l.id);
  const needsAnswer = l.kind === 'atividade' && !state.subs[l.id];
  $('l-actions').innerHTML = `
    <div class="lesson-body lesson-actions-box">
      <div class="lesson-actions">
        ${l.done
          ? `<span class="done-pill">${ICON.check.replace('<svg', '<svg width="20" height="20"')} Etapa finalizada</span>
             ${unmarkable ? '<button class="link-btn" id="unmark" type="button">Desmarcar</button>' : ''}`
          : `<button class="btn btn-primary" id="mark" type="button" ${needsAnswer ? 'disabled' : ''}>Marcar como finalizada</button>
             ${needsAnswer ? '<span class="hint-inline">Envie sua resposta para poder finalizar.</span>' : ''}`}
        ${l.done && next ? `<button class="btn ${next.unlocked ? 'btn-primary' : 'btn-ghost'}" id="go-next" type="button" ${next.unlocked ? '' : 'disabled'}>Próxima etapa</button>` : ''}
      </div>
    </div>`;

  const mark = $('mark'), unmark = $('unmark'), goNext = $('go-next');
  if (mark) mark.onclick = () => setDone(l.id, true, next);
  if (unmark) unmark.onclick = () => setDone(l.id, false);
  if (goNext) goNext.onclick = () => openLesson(next.id);
}

/* rascunho local da resposta (nao perde o que foi digitado ao recarregar) */
const draftKey = (l) => `cj-draft:${state.user.uid}:${l.id}`;
function loadDraft(l) { try { return JSON.parse(localStorage.getItem(draftKey(l)) || 'null') || {}; } catch { return {}; } }
function saveDraft(l, obj) { try { localStorage.setItem(draftKey(l), JSON.stringify(obj)); } catch { /* sem armazenamento: ok */ } }
function clearDraft(l) { try { localStorage.removeItem(draftKey(l)); } catch { /* ok */ } }

function renderSub(l) {
  const box = $('l-sub');
  const sec = $('s-lesson');
  if (l.kind !== 'atividade') { box.innerHTML = ''; sec.dataset.subKey = ''; return; }
  const sub = state.subs[l.id];
  const fields = Array.isArray(l.fields) ? l.fields : [];
  const key = JSON.stringify([sub ? [sub.status, sub.text, sub.link, sub.answers, sub.feedback, sub.feedbacks, sub.submittedAt && sub.submittedAt.seconds, sub.feedbackAt && sub.feedbackAt.seconds] : null, state.editingSub, fields, (state.notes[l.id] && state.notes[l.id].answers ? [state.notes[l.id].answers.length, state.notes[l.id].answersAt && state.notes[l.id].answersAt.seconds] : null)]);
  if (sec.dataset.subKey === key) return;
  sec.dataset.subKey = key;

  const showForm = !sub || state.editingSub;
  const sentLink = sub && safeUrl(sub.link);
  const fbs = (sub && sub.feedbacks) || {};
  const nl = (t) => esc(t || '').replace(/\n/g, '<br>');

  const okBadge = (o) => {
    if (o.type !== 'multipla' || typeof o.ok !== 'boolean') return '';
    if (o.ok) return ' <span class="ans-ok">Correta</span>';
    const f = fields.find((q) => q.id === o.id);
    const right = f && f.correct && (f.options || []).find((q) => q.id === f.correct);
    return ` <span class="ans-bad">Incorreta${right ? `. Certa: ${esc(right.text)}` : ''}</span>`;
  };
  /* resposta ja enviada (somente leitura), com o feedback de cada item */
  let answer = '';
  if (sub) {
    let body = '';
    const ans = sub.answers || {};
    const saved = Object.keys(ans).length > 0;
    if (saved) {
      const ordered = fields.length ? fields.filter((f) => ans[f.id]).map((f) => ({ id: f.id, ...ans[f.id] })) : [];
      Object.keys(ans).forEach((id) => { if (!ordered.find((o) => o.id === id)) ordered.push({ id, ...ans[id] }); });
      let lastSec = null;
      body = ordered.map((o) => {
        const head = (o.section || '') !== lastSec ? (lastSec = o.section || '', o.section ? `<h4 class="fld-sec">${esc(o.section)}</h4>` : '') : '';
        return `${head}<div class="ans-item"><div class="ans-label">${esc(o.label)}</div>
          <div class="ans-text">${o.text ? nl(o.text) : '<em>Sem resposta</em>'}${okBadge(o)}</div>
          ${fbs[o.id] ? `<div class="fb-item"><b>Feedback</b><br>${nl(fbs[o.id])}</div>` : ''}</div>`;
      }).join('');
    } else if (sub.text) body = `<div class="ans-text">${nl(sub.text)}</div>`;
    const graded = Object.values(sub.answers || {}).filter((o) => o.type === 'multipla' && typeof o.ok === 'boolean');
    const score = graded.length ? `<div class="score">Múltipla escolha: você acertou ${graded.filter((o) => o.ok).length} de ${graded.length}</div>` : '';
    answer = `<div class="sub-answer">
      ${score}
      <div class="sub-meta">Sua resposta, enviada em ${esc(fmtStamp(sub.submittedAt))}</div>
      ${body}
      ${sentLink ? `<p style="margin:10px 0 0"><a href="${esc(sentLink)}" target="_blank" rel="noopener noreferrer">${esc(sentLink)}</a></p>` : ''}
    </div>`;
  }

  let status = '';
  if (sub && sub.status === 'corrigida') {
    status = `<div class="feedback-card"><div class="fb-title">Feedback <small>${esc(fmtStamp(sub.feedbackAt))}</small></div>
      ${sub.feedback ? `<div class="rich"><p>${nl(sub.feedback)}</p></div>` : '<div class="rich"><p>Veja os comentários em cada item abaixo.</p></div>'}</div>`;
  } else if (sub) {
    status = l.feedbackEnabled ? '<div class="msg warn">Resposta enviada. Sua resposta será corrigida e o feedback aparece aqui.</div>' : '<div class="msg ok">Resposta enviada.</div>';
  }

  /* formulario */
  let form = '';
  if (showForm) {
    const draft = sub ? {} : loadDraft(l);
    let fieldsHtml;
    if (fields.length) {
      const prev = (sub && sub.answers) || {};
      let lastSec = null;
      fieldsHtml = fields.map((f) => {
        const head = (f.section || '') !== lastSec ? (lastSec = f.section || '', f.section ? `<h4 class="fld-sec">${esc(f.section)}</h4>` : '') : '';
        const val = (draft.a && draft.a[f.id] != null) ? draft.a[f.id] : (prev[f.id] ? (f.type === 'multipla' ? prev[f.id].choice : prev[f.id].text) : '');
        if (f.type === 'multipla') {
          return `${head}<fieldset class="fld q-fs">
            <legend class="fld-l">${esc(f.label)}${f.optional ? ' (opcional)' : ' <i class="req">*</i>'}</legend>
            ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}
            ${(f.options || []).map((o) => `<label class="opt"><input type="radio" name="q-${esc(f.id)}" data-fid="${esc(f.id)}" value="${esc(o.id)}" ${val === o.id ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('')}
          </fieldset>`;
        }
        return `${head}<label class="fld">
          <span class="fld-l">${esc(f.label)}${f.optional ? ' (opcional)' : ' <i class="req">*</i>'}</span>
          ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}
          <textarea data-fid="${esc(f.id)}" rows="4" maxlength="5000">${esc(val)}</textarea></label>`;
      }).join('');
    } else {
      fieldsHtml = `<label>Escreva aqui a sua resposta
        <textarea id="sub-text" rows="7" maxlength="10000" placeholder="Digite sua resposta...">${esc(draft.t != null ? draft.t : (sub ? sub.text : ''))}</textarea></label>`;
    }
    form = `<form id="sub-form" class="f">
        ${fieldsHtml}
        <div id="sub-msg" class="msg err" hidden></div>
        <div class="btn-row">
          <button class="btn btn-primary small" type="submit" id="sub-go">${sub ? 'Reenviar resposta' : (l.feedbackEnabled ? 'Enviar para correção' : 'Enviar resposta')}</button>
          ${sub ? '<button class="link-btn" type="button" id="sub-cancel">Cancelar</button>' : ''}
        </div>
      </form>`;
  }

  const afterBtns = `<div class="btn-row" style="margin-top:12px">
      <button class="btn btn-ghost small" type="button" id="sub-edit">Editar e reenviar</button>
      <button class="btn btn-primary small" type="button" id="sub-mat">${matAnswers(l) ? 'Atualizar no material de apoio' : 'Adicionar ao material de apoio'}</button>
      <button class="btn btn-ghost small" type="button" id="sub-pdf">Baixar respostas (PDF)</button></div>`;
  box.innerHTML = `<div class="lesson-body sub-box">
    <h3 class="sub-h">${l.feedbackEnabled ? 'Sua resposta' : 'Sua resposta'}</h3>
    ${status}${showForm ? '' : answer}${form}
    ${showForm ? '' : afterBtns}
  </div>`;

  const f = $('sub-form');
  if (f) {
    f.addEventListener('submit', (e) => { e.preventDefault(); submitAnswer(l); });
    f.addEventListener('input', () => {
      const d = {};
      if (fields.length) { d.a = {}; f.querySelectorAll('[data-fid]').forEach((t) => { if (t.type === 'radio') { if (t.checked) d.a[t.dataset.fid] = t.value; } else d.a[t.dataset.fid] = t.value; }); }
      else d.t = $('sub-text').value;
      if (!sub) saveDraft(l, d);
    });
  }
  const c = $('sub-cancel'); if (c) c.onclick = () => { state.editingSub = false; renderSub(l); };
  const ed = $('sub-edit'); if (ed) ed.onclick = () => { state.editingSub = true; renderSub(l); };
  const pd = $('sub-pdf'); if (pd) pd.onclick = () => printAnswers(l.id);
  const pm = $('sub-mat'); if (pm) pm.onclick = () => addAnswersToMaterial(l);
}


/* ============================================================
   Material de apoio (anotacoes + respostas por aula) e PDF
   ============================================================ */
const nl2br = (t) => esc(t || '').replace(/\n/g, '<br>');
const draftNoteKey = (id) => `cj-note:${state.user.uid}:${id}`;
const noteRef = (lid) => doc(db, 'notes', `${lid}_${state.user.uid}`);
const matAnswers = (l) => { const n = state.notes[l.id]; return !!(n && n.answers && n.answers.length); };

/* mine=true: so o que a aluna escreveu (sem feedback e sem correcao da Cris) */
function answerRows(l, sub, mine = false) {
  const fields = Array.isArray(l.fields) ? l.fields : [];
  const ans = sub.answers || {};
  const fbs = sub.feedbacks || {};
  const rows = [];
  fields.forEach((f) => { if (ans[f.id]) rows.push({ id: f.id, f, ...ans[f.id] }); });
  Object.keys(ans).forEach((id) => { if (!rows.find((r) => r.id === id)) rows.push({ id, f: null, ...ans[id] }); });
  if (!rows.length && sub.text) rows.push({ id: 'txt', section: '', label: 'Resposta', text: sub.text });
  const out = rows.map((r) => {
    let tag = '';
    if (!mine && r.type === 'multipla' && typeof r.ok === 'boolean') {
      const right = r.f && r.f.correct && (r.f.options || []).find((o) => o.id === r.f.correct);
      tag = r.ok ? 'Correta' : `Incorreta${right ? `. Certa: ${right.text}` : ''}`;
    }
    return { section: r.section || '', label: r.label || '', text: r.text || '', tag, fb: mine ? '' : (fbs[r.id] || '') };
  });
  const link = safeUrl(sub.link);
  if (link) out.push({ section: '', label: 'Link anexado', text: link, tag: '', fb: '' });
  if (!mine && sub.feedback) out.push({ section: '', label: 'Feedback geral', text: sub.feedback, tag: '', fb: '' });
  return out.slice(0, 120);
}

/* linhas (pergunta/resposta) em HTML; cls = prefixo de classes (pr = pdf, mat = tela) */
function rowsHtml(rows, cls, plain = false) {
  let lastSec = null;
  return rows.map((r) => {
    const head = (r.section || '') !== lastSec ? (lastSec = r.section || '', r.section ? `<h5 class="${cls}-sh">${esc(r.section)}</h5>` : '') : '';
    return `${head}<div class="${cls}-item"><div class="${cls}-q">${esc(r.label)}</div>
      <div class="${cls}-a">${r.text ? nl2br(r.text) : '<em>Sem resposta</em>'}${!plain && r.tag ? ` <span class="${cls}-tag">${esc(r.tag)}</span>` : ''}</div>
      ${!plain && r.fb ? `<div class="${cls}-fb"><b>Feedback:</b> ${nl2br(r.fb)}</div>` : ''}</div>`;
  }).join('');
}

/* abre a impressao do navegador (a aluna escolhe "Salvar como PDF") */
function openPrint(innerHtml, title, opts = {}) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  const name = (state.profile && state.profile.name) || '';
  root.innerHTML = opts.cover ? innerHtml : `<header class="pr-head"><img src="assets/logo-full-dark-on-transparent.png" alt="Closer Journey">
      <div><div class="pr-h1">${esc(title)}</div><div class="pr-meta">${esc(name)}${name ? ' · ' : ''}gerado em ${new Date().toLocaleDateString('pt-BR')}</div></div></header>${innerHtml}`;
  const oldTitle = document.title;
  document.title = `${title}${name ? ' - ' + name : ''}`;
  document.body.classList.add('printing');
  let ended = false;
  const done = () => { if (ended) return; ended = true; document.body.classList.remove('printing'); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const go = () => { try { window.print(); } catch { done(); } };
  const pend = [...root.querySelectorAll('img')].filter((i) => !i.complete);
  if (pend.length) {
    let fired = false; const once = () => { if (!fired) { fired = true; go(); } };
    Promise.all(pend.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))).then(once);
    setTimeout(once, opts.cover ? 6000 : 1500);
  } else setTimeout(go, 60);
  setTimeout(done, 10 * 60 * 1000);
}

function printAnswers(onlyId) {
  const list = state.lessons.filter((l) => l.kind === 'atividade' && state.subs[l.id] && (!onlyId || l.id === onlyId));
  if (!list.length) { toast('Você ainda não enviou respostas.'); return; }
  const acts = list.map((l) => {
    const sub = state.subs[l.id];
    return `<section class="pr-act"><div class="pr-mod">${esc(l.module || '')}</div>
      <h2 class="pr-title">${esc(l.title)}</h2>
      <div class="pr-meta">Enviada em ${esc(fmtStamp(sub.submittedAt))}</div>
      ${rowsHtml(answerRows(l, sub), 'pr')}</section>`;
  }).join('');
  openPrint(acts, 'Minhas respostas');
}

/* topicos do material, na ordem da jornada */
function topics() {
  const order = new Map(state.lessons.map((l, i) => [l.id, i]));
  return Object.values(state.notes)
    .filter((n) => n.note || (n.answers && n.answers.length))
    .sort((a, b) => (order.has(a.lessonId) ? order.get(a.lessonId) : 1e6) - (order.has(b.lessonId) ? order.get(b.lessonId) : 1e6));
}

/* ============================================================
   Apostila da mentoria: descricoes e imagens de todas as aulas
   ============================================================ */
async function printApostila() {
  const btn = $('apost-pdf');
  const lessons = state.lessons;
  if (!lessons.length) { toast('Ainda não há aulas publicadas.'); return; }
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Montando a apostila...';
  try {
    const ids = [...new Set(lessons.flatMap((l) => l.images || []))].filter((id) => !state.imgs[id]);
    await Promise.all(ids.map(async (id) => {
      try { const s = await getDoc(doc(db, 'lessonImages', id)); if (s.exists()) state.imgs[id] = s.data().data; } catch { /* segue sem a imagem */ }
    }));
    const name = (state.profile && state.profile.name) || '';
    const mods = new Map();
    lessons.forEach((l) => { const k = (l.module || 'Sem módulo').trim() || 'Sem módulo'; if (!mods.has(k)) mods.set(k, []); mods.get(k).push(l); });
    const today0 = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());
    const today = today0.charAt(0).toUpperCase() + today0.slice(1);
    let n = 0;
    const toc = [...mods.entries()].map(([m, ls]) => `<div class="ap-tm">${esc(modName(m))}</div><ol class="ap-tl">${ls.map((l) => `<li><span>${esc(l.title)}</span><i>${l.kind === 'atividade' ? 'Atividade' : 'Aula'}</i></li>`).join('')}</ol>`).join('');
    const body = [...mods.entries()].map(([m, ls]) => `<section class="ap-mod"><div class="ap-modh"><small>Módulo</small>${esc(modName(m))}</div>` + ls.map((l) => {
      n += 1;
      const imgs = (l.images || []).map((id) => state.imgs[id]).filter(Boolean);
      return `<article class="ap-les"><div class="ap-kind">${l.kind === 'atividade' ? 'Atividade' : 'Aula'} ${n}</div><h2>${esc(l.title)}</h2>
        ${l.description ? `<p class="ap-desc">${linkify(l.description)}</p>` : ''}
        ${l.body ? `<div class="ap-rich">${renderRich(l.body)}</div>` : ''}
        ${imgs.map((d) => `<figure class="ap-fig"><img src="${d}" alt=""></figure>`).join('')}</article>`;
    }).join('') + '</section>').join('');
    const html = `<section class="ap-cover"><img src="assets/logo-full-dark-on-transparent.png" alt="Closer Journey">
        <div class="ap-ck">Jornada de transformação</div><h1>Apostila da mentoria</h1><div class="ap-rule"></div>
        <p>${name ? `Preparada para <b>${esc(name)}</b>` : 'Closer Journey'}</p><div class="ap-cd">${esc(today)}</div></section>
      <section class="ap-toc"><h2>Sumário</h2>${toc}</section>${body}`;
    openPrint(html, 'Apostila da mentoria', { cover: true });
  } catch (err) { toast(friendlyError(err)); }
  btn.disabled = false; btn.textContent = old;
}
$('apost-pdf').addEventListener('click', printApostila);

function printMaterial(onlyId) {
  const list = topics().filter((n) => !onlyId || n.lessonId === onlyId);
  if (!list.length) { toast('Seu material de apoio ainda está vazio.'); return; }
  let lastMod = null;
  const html = list.map((n) => {
    const mod = n.module || '';
    const head = mod !== lastMod ? (lastMod = mod, `<h3 class="pr-modh">${esc(modName(mod))}</h3>`) : '';
    return `${head}<section class="pr-topic"><h2 class="pr-title">${esc(n.lessonTitle || '')}</h2>
      ${n.note ? `<div class="pr-lbl">Minhas anotações</div><div class="pr-a pr-note">${nl2br(n.note)}</div>` : ''}
      ${n.answers && n.answers.length ? `<div class="pr-lbl">Minhas respostas</div>${rowsHtml(n.answers, 'pr', true)}` : ''}</section>`;
  }).join('');
  openPrint(html, onlyId ? `Material de apoio - ${list[0].lessonTitle || 'aula'}` : 'Meu material de apoio');
}

async function writeTopic(lid, meta, patch) {
  await setDoc(noteRef(lid), { uid: state.user.uid, lessonId: lid, ...meta, ...patch, updatedAt: serverTimestamp() }, { merge: true });
}
const metaOf = (l) => ({ lessonTitle: l.title || '', module: l.module || '' });

async function clearPart(lid, part) {
  const n = state.notes[lid];
  if (!n) return;
  const otherHas = part === 'note' ? !!(n.answers && n.answers.length) : !!n.note;
  try {
    if (!otherHas) await deleteDoc(noteRef(lid));
    else await updateDoc(noteRef(lid), part === 'note' ? { note: '', noteAt: null, updatedAt: serverTimestamp() } : { answers: [], answersAt: null, updatedAt: serverTimestamp() });
    toast('Removido do material de apoio.');
  } catch (e) { toast(friendlyError(e)); }
}

async function addAnswersToMaterial(l) {
  const sub = state.subs[l.id];
  if (!sub) return;
  const was = matAnswers(l);
  const b = $('sub-mat'); if (b) b.disabled = true;
  try {
    await writeTopic(l.id, metaOf(l), { answers: answerRows(l, sub, true), answersAt: serverTimestamp() });
    toast(was ? 'Material de apoio atualizado.' : 'Respostas adicionadas ao material de apoio.');
  } catch (e) { toast(friendlyError(e)); if (b) b.disabled = false; }
}

/* anotacoes da aula/atividade */
function renderNotes(l) {
  const sec = $('s-lesson'), box = $('l-notes');
  if (!box) return;
  if (l.kind === 'atividade') { box.innerHTML = ''; sec.dataset.noteLesson = ''; return; }
  if (sec.dataset.noteLesson !== l.id) {
    sec.dataset.noteLesson = l.id;
    let draft = null; try { draft = localStorage.getItem(draftNoteKey(l.id)); } catch { /* ok */ }
    const saved = (state.notes[l.id] && state.notes[l.id].note) || '';
    box.innerHTML = `<div class="lesson-body notes-box">
      <h3 class="sub-h">Minhas anotações</h3>
      <p class="hint-line">Escreva o que quiser guardar ${l.kind === 'hotseat' ? 'deste hotseat' : 'desta aula'}. Só você vê. Ao salvar, o texto vai para o seu Material de apoio.</p>
      <textarea id="n-text" rows="6" maxlength="20000" placeholder="Suas anotações...">${esc(draft != null ? draft : saved)}</textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-primary small" type="button" id="n-save"></button>
        <button class="link-btn" type="button" id="n-rm" hidden>Remover anotações do material</button>
        <span class="hint-inline" id="n-status"></span></div></div>`;
    $('n-text').addEventListener('input', () => {
      try { localStorage.setItem(draftNoteKey(l.id), $('n-text').value); } catch { /* ok */ }
      renderNotes(l);
    });
    $('n-save').onclick = async () => {
      const text = $('n-text').value.trim();
      if (!text) { toast('Escreva algo antes de salvar.'); return; }
      $('n-save').disabled = true;
      try {
        await writeTopic(l.id, metaOf(l), { note: text, noteAt: serverTimestamp() });
        try { localStorage.removeItem(draftNoteKey(l.id)); } catch { /* ok */ }
        toast('Anotações salvas no material de apoio.');
      } catch (e) { toast(friendlyError(e)); }
      $('n-save').disabled = false;
    };
    $('n-rm').onclick = () => { if (confirm('Remover as anotações desta aula do material de apoio?')) { clearPart(l.id, 'note'); $('n-text').value = ''; try { localStorage.removeItem(draftNoteKey(l.id)); } catch { /* ok */ } } };
  }
  /* so o estado dos botoes e atualizado, o texto digitado nunca e recriado */
  const n = state.notes[l.id];
  const saved = (n && n.note) || '';
  const cur = $('n-text').value.trim();
  const dirty = cur !== saved.trim();
  $('n-save').textContent = saved ? 'Atualizar no material de apoio' : 'Salvar no material de apoio';
  $('n-rm').hidden = !saved;
  $('n-status').textContent = dirty ? (cur ? 'Alterações ainda não salvas no material.' : '') : (saved ? `No material${n.noteAt ? ' desde ' + fmtStamp(n.noteAt) : ''}.` : '');
}

/* tela do material de apoio */
function renderMaterial() {
  const box = $('mat-body');
  if (!box) return;
  const list = topics();
  if (!list.length) {
    box.innerHTML = `<div class="empty">Seu material de apoio está vazio. Em cada aula ou atividade você pode escrever suas anotações e, nas atividades, clicar em "Adicionar ao material de apoio" para guardar as suas respostas aqui.</div>`;
    return;
  }
  let lastMod = null;
  box.innerHTML = `<div class="export-bar"><div><strong>Material de apoio completo</strong><small>${list.length} tópico${list.length > 1 ? 's' : ''}. Cada aula ou atividade é um tópico. Adicionar de novo atualiza o tópico.</small></div>
      <button class="btn btn-primary small" id="mat-pdf" type="button">Baixar material de apoio completo (PDF)</button></div>` +
    list.map((n) => {
      const mod = n.module || '';
      const head = mod !== lastMod ? (lastMod = mod, `<h3 class="mat-mod">${esc(modName(mod))}</h3>`) : '';
      const hsId = String(n.lessonId).startsWith('hs_') ? n.lessonId.slice(3) : '';
      const canOpen = hsId ? !!hsById(hsId) : state.lessons.some((l) => l.id === n.lessonId);
      return `${head}<article class="mat-topic" data-lid="${esc(n.lessonId)}">
        <header><h4>${esc(n.lessonTitle || '')}</h4><span class="mat-ops">${canOpen ? `<button class="link-btn" type="button" ${hsId ? `data-open-hs="${esc(hsId)}"` : `data-open="${esc(n.lessonId)}"`}>Abrir</button>` : ''}<button class="link-btn" type="button" data-pdf="${esc(n.lessonId)}">Baixar este tópico (PDF)</button></span></header>
        ${n.note ? `<div class="mat-sec"><div class="mat-lbl">Minhas anotações${n.noteAt ? ` <small>${esc(fmtStamp(n.noteAt))}</small>` : ''}</div>
          <div class="mat-note">${nl2br(n.note)}</div>
          <button class="link-btn" type="button" data-rm="note">Remover anotações</button></div>` : ''}
        ${n.answers && n.answers.length ? `<div class="mat-sec"><div class="mat-lbl">Minhas respostas${n.answersAt ? ` <small>${esc(fmtStamp(n.answersAt))}</small>` : ''}</div>
          ${rowsHtml(n.answers, 'mat', true)}
          <button class="link-btn" type="button" data-rm="answers">Remover respostas</button></div>` : ''}
      </article>`;
    }).join('');
}
$('mat-body').addEventListener('click', (e) => {
  if (e.target.closest('#mat-pdf')) { printMaterial(); return; }
  const pt = e.target.closest('[data-pdf]'); if (pt) { printMaterial(pt.dataset.pdf); return; }
  const rm = e.target.closest('[data-rm]');
  if (rm) { const art = rm.closest('[data-lid]'); if (art && confirm('Remover do material de apoio?')) clearPart(art.dataset.lid, rm.dataset.rm); }
});

async function submitAnswer(l) {
  const msg = $('sub-msg'), btn = $('sub-go');
  const fields = Array.isArray(l.fields) ? l.fields : [];
  const link = '';
  msg.hidden = true;
  const fail = (t) => { msg.textContent = t; msg.hidden = false; };

  const payload = { link };
  if (fields.length) {
    const answers = {}, missing = [];
    fields.forEach((f) => {
      if (f.type === 'multipla') {
        const sel = $('sub-form').querySelector(`input[data-fid="${f.id}"]:checked`);
        const opt = sel && (f.options || []).find((o) => o.id === sel.value);
        answers[f.id] = { section: f.section || '', label: f.label, text: opt ? opt.text : '', type: 'multipla', choice: opt ? opt.id : '' };
        if (opt && f.correct) answers[f.id].ok = opt.id === f.correct;
        if (!opt && !f.optional) missing.push(f.label);
        return;
      }
      const t = ($('sub-form').querySelector(`textarea[data-fid="${f.id}"]`).value || '').trim();
      answers[f.id] = { section: f.section || '', label: f.label, text: t };
      if (!t && !f.optional) missing.push(f.label);
    });
    if (missing.length) { fail(`Falta preencher: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` e mais ${missing.length - 4}` : ''}.`); return; }
    payload.text = ''; payload.answers = answers;
  } else {
    const text = $('sub-text').value.trim();
    if (!text && !link) { fail('Escreva a resposta ou cole um link antes de enviar.'); return; }
    payload.text = text;
  }

  btn.disabled = true;
  const uid = state.user.uid, id = `${l.id}_${uid}`, ref = doc(db, 'submissions', id);
  try {
    if (state.subs[l.id]) {
      await updateDoc(ref, { ...payload, status: 'enviada', submittedAt: serverTimestamp() });
    } else {
      await setDoc(ref, {
        lessonId: l.id, uid, studentName: state.profile.name || '', lessonTitle: l.title,
        ...payload, status: 'enviada', submittedAt: serverTimestamp()
      });
    }
    clearDraft(l);
    state.editingSub = false;
    /* se a atividade ja esta no material de apoio, o material acompanha a nova resposta */
    let synced = false;
    if (matAnswers(l)) {
      try { await writeTopic(l.id, metaOf(l), { answers: answerRows(l, { answers: payload.answers, text: payload.text, link: payload.link }, true), answersAt: serverTimestamp() }); synced = true; }
      catch (e2) { console.error(e2); }
    }
    toast(synced ? 'Resposta enviada e material de apoio atualizado.' : (l.feedbackEnabled ? 'Resposta enviada para correção.' : 'Resposta enviada.'));
  } catch (e) {
    console.error(e);
    fail(friendlyError(e)); btn.disabled = false;
  }
}

function showStampModal(m) {
  const mods = passportModules();
  const allDone = mods.length > 0 && mods.every((x) => x.complete);
  const nm = m.name.replace(/^[^\p{L}\p{N}]+/u, '');
  genOpen(`<div class="stamp-pop">
      <div class="sp-book"><div class="sp-page"><div class="sp-lines"></div>
        <div class="stamp sp-stamp" style="--rot:-7deg">${stampSvg(m, 'pop')}</div></div><div class="sp-impact"></div></div>
      <h3>Parabéns!</h3>
      <p>${allDone ? 'Você chegou ao destino final e completou o seu passaporte!' : 'Você está mais próxima do destino final e acaba de conquistar o seu carimbo'} <b>${esc(nm)}</b> ${allDone ? '' : 'dessa jornada!'}</p>
      <div class="btn-row sp-btns"><button class="btn btn-primary" id="sp-pass" type="button">Ver meu passaporte</button><button class="link-btn" id="sp-ok" type="button">Continuar</button></div>
    </div>`, 'sticky');
  $('sp-ok').onclick = genClose;
  $('sp-pass').onclick = () => { state.ppOpen = true; genClose(); showHome(); setTab('pass'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
}

async function setDone(id, value, next) {
  const prev = { ...state.completed }, prevAt = { ...state.doneAt };
  const nextMap = { ...state.completed }, nextAt = { ...state.doneAt };
  if (value) { nextMap[id] = true; nextAt[id] = Date.now(); } else { delete nextMap[id]; delete nextAt[id]; }
  const before = new Set(passportModules(prev, prevAt).filter((m) => m.complete).map((m) => m.name));
  const won = value ? passportModules(nextMap, nextAt).find((m) => m.complete && !before.has(m.name)) : null;
  state.completed = nextMap; state.doneAt = nextAt;
  if (won) state.newStamp = won.name;
  render();
  try {
    await setDoc(doc(db, 'progress', state.user.uid), { completed: nextMap, doneAt: nextAt, updatedAt: serverTimestamp() }, { mergeFields: ['completed', 'doneAt', 'updatedAt'] });
    if (won) showStampModal(won);
    else if (value) toast(next ? 'Etapa finalizada! A próxima foi liberada.' : 'Etapa finalizada!');
  } catch (e) {
    console.error(e);
    state.completed = prev; state.doneAt = prevAt; state.newStamp = ''; render();
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
    events: eventsOfMonth([...state.events, ...birthdayEvents(state.birthdays, y)], y, m)
  });

  const now = Date.now() - 60 * 60000;
  const up = state.events.filter((e) => e.start.getTime() >= now).sort((a, b) => a.start - b.start).slice(0, 12);
  $('agenda').innerHTML = up.length ? up.map((e) => {
    const d = brParts(e.start).date.split('-');
    return `<li>
      <div class="when"><b>${d[2]}/${d[1]}</b><span>${esc(fmtTime(e.start))}</span></div>
      <div class="what"><b>${esc(e.title)}</b><small>${esc(typeLabel(e.type))} · ${esc(fmtDay(e.start))}${e.type === 'roleplay' && mySignup(e.id) ? ` · <span class="rp-chip">Você: ${esc(ROLE_LABEL[mySignup(e.id).role])}</span>` : ''}</small></div>
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

const ROLE_LABEL = { closer: 'Closer', cliente: 'Cliente', observadora: 'Observadora', participante: 'Participante' };
const mySignup = (evId) => state.signups.find((x) => x.eventId === evId && x.uid === state.user.uid);

/* inscricao no roleplay: 1 vaga de closer, 1 de cliente, observadoras sem limite */
function roleplayBlock(ev) {
  const mine = mySignup(ev.id);
  const slot = (role) => state.signups.find((x) => x.eventId === ev.id && x.role === role);
  const obs = state.signups.filter((x) => x.eventId === ev.id && x.role === 'observadora');
  const past = ev.start.getTime() < Date.now() - 60 * 60000;
  const card = (role, desc) => {
    const taken = role === 'observadora' ? null : slot(role);
    const isMine = mine && mine.role === role;
    let body;
    if (isMine) body = '<span class="rp-me">Você está aqui</span>';
    else if (taken) body = `<span class="rp-taken">Ocupada por ${esc(taken.name || 'outra aluna')}</span>`;
    else if (past) body = '<span class="rp-taken">Encerrado</span>';
    else body = `<button class="btn btn-ghost small" type="button" ${role === 'closer' ? 'data-closer-form="1"' : `data-role="${role}"`} ${state.joining ? 'disabled' : ''}>${state.joining ? 'Aguarde...' : (role === 'observadora' ? 'Quero assistir' : `Quero ser ${role === 'closer' ? 'a closer' : 'a cliente'}`)}</button>`;
    const brief = role === 'closer' && taken && taken.product && !isMine ? `<small class="rp-info">Produto: ${esc(taken.product)}<br>Quem compra: ${esc(taken.persona || '')}</small>` : '';
    return `<div class="rp-card${isMine ? ' is-mine' : ''}${taken && !isMine ? ' is-taken' : ''}">
      <b>${ROLE_LABEL[role]}</b><small>${desc}</small>${body}${brief}</div>`;
  };
  return `<div class="rp-box">
    <div class="rp-h">Inscrição no roleplay</div>
    <p class="rp-sub">Cada roleplay tem 1 vaga de closer e 1 de cliente. As demais alunas entram como observadoras${obs.length ? ` (${obs.length} inscrita${obs.length > 1 ? 's' : ''})` : ''}.</p>
    <div class="rp-grid">
      ${card('closer', 'Conduz a venda')}
      ${card('cliente', 'Interpreta o lead')}
      ${card('observadora', 'Assiste e comenta')}
    </div>
    ${state.closerForm && !mine ? `<div class="rp-form"><b>Para reservar a vaga de closer, conte sobre a venda que você vai conduzir:</b>
      <label>Qual produto você vai vender? <input id="rp-product" maxlength="120" value="${esc(state.cfProduct || '')}" placeholder="Ex.: mentoria de emagrecimento"></label>
      <label>Quem é a pessoa que compra esse produto? <input id="rp-persona" maxlength="200" value="${esc(state.cfPersona || '')}" placeholder="Ex.: mulher de 35 anos que quer voltar a treinar"></label>
      <div class="btn-row"><button class="btn btn-primary small" type="button" id="rp-confirm">Confirmar vaga de closer</button><button class="link-btn" type="button" id="rp-cancel-form">Cancelar</button></div></div>` : ''}
    ${mine && mine.role === 'closer' && mine.product ? `<div class="rp-brief"><b>Produto:</b> ${esc(mine.product)}<br><b>Quem compra:</b> ${esc(mine.persona || '')}</div>` : ''}
    ${mine ? `<div class="rp-mine">Sua inscrição: <b>${ROLE_LABEL[mine.role]}</b>${past ? '' : ' <button class="link-btn" type="button" data-role-cancel="1">Cancelar inscrição</button>'}</div>` : ''}
    ${state.rpError ? `<div id="rp-msg" class="msg err">${esc(state.rpError)}</div>` : ''}
  </div>`;
}

async function roleplayJoin(ev, role, extra = {}) {
  if (state.joining) return;
  const uid = state.user.uid;
  state.joining = true; state.rpError = '';
  openEvent(ev.id);
  try {
    /* le o que a aluna tem de fato no banco (nao so o que esta na tela) e troca tudo de uma vez: so existe 1 papel por aluna */
    const cur = await getDocs(query(collection(db, 'signups'), where('eventId', '==', ev.id), where('uid', '==', uid)));
    const id = role === 'observadora' ? `${ev.id}_obs_${uid}` : role === 'participante' ? `${ev.id}_part_${uid}` : `${ev.id}_${role}`;
    if (!cur.docs.some((d) => d.id === id)) {
      const b = writeBatch(db);
      cur.docs.forEach((d) => b.delete(doc(db, 'signups', d.id)));
      b.set(doc(db, 'signups', id), { eventId: ev.id, role, uid, name: (state.profile && state.profile.name) || '', ...extra, createdAt: serverTimestamp() });
      await b.commit();
    }
    state.closerForm = false;
    toast(role === 'participante' ? 'Presença confirmada.' : `Inscrição confirmada como ${ROLE_LABEL[role].toLowerCase()}.`);
  } catch (e) {
    console.error('inscricao roleplay', e);
    const denied = e && e.code === 'permission-denied';
    if (denied && role === 'observadora') state.rpError = 'Sem permissão para gravar a inscrição. Avise a equipe Closer Journey.';
    else if (denied) state.rpError = 'Não foi possível reservar. A vaga pode ter acabado de ser ocupada por outra aluna. Se ela aparece livre e o erro continua, as regras do Firestore (versão mais recente) precisam ser publicadas no Firebase.';
    else state.rpError = friendlyError(e);
  }
  state.joining = false;
  if (state.openEv === ev.id) openEvent(ev.id);
}

/* confirmar presenca em encontros que nao sao roleplay (so quando a caixa de duvidas esta aberta) */
function partBlock(ev) {
  const mine = mySignup(ev.id);
  const past = ev.start.getTime() < Date.now() - 60 * 60000;
  if (mine) return `<div class="rp-mine">Presença confirmada. <button class="link-btn" type="button" data-role-cancel="1">Cancelar inscrição</button></div>`;
  if (past) return '';
  return `<div class="rp-box"><div class="rp-h">Inscrição no encontro</div><p class="rp-sub">Inscreva-se para poder deixar dúvidas para este encontro.</p>
    <button class="btn btn-ghost small" type="button" data-role="participante" ${state.joining ? 'disabled' : ''}>${state.joining ? 'Aguarde...' : 'Quero participar'}</button>
    ${state.rpError ? `<div class="msg err" style="margin-top:10px">${esc(state.rpError)}</div>` : ''}</div>`;
}

/* caixa de duvidas: aberta ate o dia anterior ao encontro, todas as alunas veem */
function questionsBlock(ev) {
  const list = state.questions.filter((q) => q.eventId === ev.id)
    .sort((a, b) => ((a.createdAt && a.createdAt.seconds) || 0) - ((b.createdAt && b.createdAt.seconds) || 0));
  const deadline = fromBr(brParts(ev.start).date, '00:00');
  const open = Date.now() < deadline.getTime();
  const mine = !!mySignup(ev.id);
  const dl = brParts(new Date(deadline.getTime() - 1)).date.split('-').reverse().join('/');
  const form = !open ? '<p class="q-note">O prazo para enviar dúvidas já terminou.</p>'
    : !mine ? '<p class="q-note">Inscreva-se no encontro para deixar a sua dúvida.</p>'
    : `<textarea id="q-text" rows="3" maxlength="500" placeholder="Escreva a sua dúvida..."></textarea>
       <div class="btn-row"><button class="btn btn-primary small" type="button" id="q-send">Enviar dúvida</button><small class="q-note">Você pode enviar até ${esc(dl)}.</small></div>`;
  return `<div class="q-box"><div class="rp-h">Dúvidas para o encontro (${list.length})</div>
    ${list.length ? `<ul class="q-list-s">${list.map((q) => `<li><b>${esc(q.name || 'Aluna')}</b><span>${esc(q.text)}</span>${q.uid === state.user.uid && open ? ` <button class="link-btn" type="button" data-rmq="${esc(q.id)}">remover</button>` : ''}</li>`).join('')}</ul>` : '<p class="q-note">Nenhuma dúvida enviada ainda.</p>'}
    ${form}</div>`;
}

function openEvent(id) {
  const ev = state.events.find((x) => x.id === id);
  if (!ev) return;
  if (state.openEv !== id) { state.rpError = ''; state.joining = false; }
  state.openEv = id;
  const link = safeUrl(ev.link);
  $('ev-box').innerHTML = `
    <span class="kind-tag">${esc(typeLabel(ev.type))}</span>
    <h3>${esc(ev.title)}</h3>
    <p class="sub">${esc(fmtLong(ev.start))}${ev.durationMin ? ' · ' + esc(ev.durationMin) + ' min' : ''}</p>
    ${ev.notes ? `<p style="white-space:pre-line">${linkify(ev.notes)}</p>` : ''}
    ${ev.rules ? `<div class="ev-rules"><b>Regras do encontro</b>${linkify(ev.rules)}</div>` : ''}
    ${ev.type === 'roleplay' ? roleplayBlock(ev) : (ev.questionsEnabled ? partBlock(ev) : '')}
    ${ev.questionsEnabled ? questionsBlock(ev) : ''}
    <div class="foot">
      <div class="btn-row">
        ${link ? `<a class="btn btn-ghost small" href="${esc(googleCalLink(ev))}" target="_blank" rel="noopener noreferrer">Adicionar ao Google Agenda</a>` : ''}
        <button class="btn btn-ghost small" id="ev-ics" type="button">Baixar .ics</button>
      </div>
      <div class="btn-row">
        ${link ? `<a class="btn btn-primary small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Entrar no encontro</a>` : ''}
        <button class="btn btn-ghost small" id="ev-close" type="button">Fechar</button>
      </div>
    </div>`;
  $('ev-modal').hidden = false;
  $('ev-close').onclick = () => { $('ev-modal').hidden = true; state.openEv = null; state.rpError = ''; };
  $('ev-ics').onclick = () => downloadICS(ev);
  $('ev-box').querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => roleplayJoin(ev, b.dataset.role); });
  const cf = $('ev-box').querySelector('[data-closer-form]'); if (cf) cf.onclick = () => { state.closerForm = true; openEvent(ev.id); };
  const rc = $('rp-cancel-form'); if (rc) rc.onclick = () => { state.closerForm = false; openEvent(ev.id); };
  const ok = $('rp-confirm'); if (ok) ok.onclick = () => {
    const pr = $('rp-product').value.trim(), pe = $('rp-persona').value.trim();
    state.cfProduct = pr; state.cfPersona = pe;
    if (!pr || !pe) { state.rpError = 'Preencha o produto e quem é a pessoa que compra para reservar a vaga de closer.'; openEvent(ev.id); return; }
    roleplayJoin(ev, 'closer', { product: pr, persona: pe });
  };
  const qt = $('q-text');
  if (qt) {
    qt.value = state.qDraft; qt.addEventListener('input', () => { state.qDraft = qt.value; });
    $('q-send').onclick = async () => {
      const text = qt.value.trim(); if (!text) return;
      $('q-send').disabled = true;
      try {
        await addDoc(collection(db, 'eventQuestions'), { eventId: ev.id, uid: state.user.uid, name: (state.profile && state.profile.name) || '', text, createdAt: serverTimestamp() });
        state.qDraft = ''; toast('Dúvida enviada.');
      } catch (err) { toast(friendlyError(err)); $('q-send').disabled = false; }
    };
  }
  $('ev-box').querySelectorAll('[data-rmq]').forEach((b) => { b.onclick = async () => { if (confirm('Remover sua dúvida?')) { try { await deleteDoc(doc(db, 'eventQuestions', b.dataset.rmq)); } catch (err) { toast(friendlyError(err)); } } }; });
  const cx = $('ev-box').querySelector('[data-role-cancel]');
  if (cx) cx.onclick = async () => {
    const m = mySignup(ev.id); if (!m) return;
    try { await deleteDoc(doc(db, 'signups', m.id)); state.rpError = ''; toast('Inscrição cancelada.'); } catch (e) { toast(friendlyError(e)); }
  };
}
$('ev-modal').addEventListener('click', (e) => { if (e.target === $('ev-modal')) $('ev-modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('ev-modal').hidden = true; });

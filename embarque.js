import { configured, auth, db } from './cj-firebase.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  esc, linkify, safeUrl, firstName, parseVideo, typeLabel, typeCls, brParts, fmtTime, fmtDay,
  fmtLong, renderCalendar, eventsOfMonth, monthLabel, downloadICS, computeTrail, canUnmark,
  groupByModule, friendlyError, todayKey, renderRich, parseDriveFile, fmtStamp, accessInfo, fmtDMY
} from './cj-utils.js?v=14';

const $ = (id) => document.getElementById(id);
const views = ['v-loading', 'v-setup', 'v-login', 'v-denied', 'v-app'];
const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

const state = {
  user: null, profile: null,
  lessons: [], events: [], completed: {}, collapsed: {}, subs: {}, notes: {}, imgs: {}, imgErr: '', signups: [], openEv: null, joining: false, rpError: '', editingSub: false,
  unsubs: [], openLesson: null,
  calYear: 0, calMonth: 0
};

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h9"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>'
};

function renderAccessNote() {
  const box = $('access-note');
  if (!box || !state.profile) return;
  const a = accessInfo(state.profile);
  if (!a.until || a.expired) { box.innerHTML = ''; return; }
  const warn = a.level === 'urgent' ? ' is-urgent' : a.level === 'soon' ? ' is-soon' : '';
  box.innerHTML = `<div class="access-note${warn}">Seu acesso vai até <b>${esc(fmtDMY(a.untilKey))}</b> <span>(${esc(a.label.toLowerCase())})</span>.${warn ? ' Quer continuar depois dessa data? Fale com a Cris.' : ''}</div>`;
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
          ? 'Seu login existe, mas ainda não está liberado para a Área de Embarque. Fale com a Cris.'
          : 'Seu acesso está desativado no momento. Fale com a Cris.';
        show('v-denied');
        return;
      }
      const acc = accessInfo(p);
      if (acc.expired) {
        $('denied-text').textContent = `Seu acesso à Área de Embarque terminou em ${fmtDMY(acc.untilKey)}. Para renovar, fale com a Cris.`;
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
  state.lessons = []; state.events = []; state.completed = {}; state.subs = {}; state.notes = {}; state.signups = []; state.openEv = null; state.editingSub = false;
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
      $('denied-text').textContent = acc.expired ? `Seu acesso à Área de Embarque terminou em ${fmtDMY(acc.untilKey)}. Para renovar, fale com a Cris.` : 'Seu acesso está desativado no momento. Fale com a Cris.';
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
    render();
  }, onErr));

  showHome();
  show('v-app');
}

/* ---------- abas ---------- */
function setTab(which) {
  $('tab-trilha').setAttribute('aria-selected', which === 'trilha');
  $('tab-cal').setAttribute('aria-selected', which === 'cal');
  $('tab-mat').setAttribute('aria-selected', which === 'mat');
  $('p-trilha').hidden = which !== 'trilha';
  $('p-cal').hidden = which !== 'cal';
  $('p-mat').hidden = which !== 'mat';
  $('layout').classList.toggle('no-side', which === 'cal');
  state.tab = which;
}
$('tab-trilha').addEventListener('click', () => setTab('trilha'));
$('tab-cal').addEventListener('click', () => { setTab('cal'); renderCal(); });
$('tab-mat').addEventListener('click', () => { setTab('mat'); renderMaterial(); });

function showHome() {
  state.openLesson = null;
  const sl = $('s-lesson');
  sl.hidden = true; sl.innerHTML = ''; sl.dataset.lessonId = ''; sl.dataset.mediaKey = ''; sl.dataset.infoKey = ''; sl.dataset.subKey = ''; sl.dataset.noteLesson = '';
  $('s-home').hidden = false;
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
  if (state.openLesson) { renderLesson(); return; }
  renderTrail();
  renderMaterial();
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
        <span class="nm">${esc(g.module)}</span><small>${done}/${g.items.length}</small><i class="chev"></i>
      </button>
      <ul>${g.items.map(sideItem).join('')}</ul></div>`;
  }).join('');
}

function sideItem(l) {
  const cls = [l.done ? 'done' : '', l.current ? 'current' : '', !l.unlocked ? 'locked' : '', state.openLesson === l.id ? 'active' : ''].join(' ');
  const ico = l.done ? ICON.check : !l.unlocked ? ICON.lock : l.kind === 'atividade' ? ICON.task : ICON.play;
  return `<li><button type="button" class="side-item ${cls}" ${l.unlocked ? `data-open="${esc(l.id)}"` : 'disabled aria-disabled="true"'}>
    <span class="si">${ico}</span><span class="tt">${esc(l.title)}</span></button></li>`;
}

document.addEventListener('click', (e) => {
  const m = e.target.closest('[data-mod]');
  if (m) { state.collapsed[m.dataset.mod] = !state.collapsed[m.dataset.mod]; renderSide(); }
});
$('side-home').addEventListener('click', () => { document.body.classList.remove('side-open'); showHome(); });
$('side-mat').addEventListener('click', () => { document.body.classList.remove('side-open'); showHome(); setTab('mat'); renderMaterial(); window.scrollTo(0, 0); });
$('side-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('side-open');
  $('side-toggle').setAttribute('aria-expanded', open);
});

function renderTrail() {
  const items = trail();
  const box = $('trail');
  if (!items.length) {
    box.innerHTML = '<div class="empty">As primeiras etapas da sua jornada ainda estão sendo preparadas. Volte em breve.</div>';
    $('next-up').innerHTML = ''; $('pct').textContent = '0%'; $('bar').style.width = '0'; $('export-all').innerHTML = '';
    return;
  }
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  $('pct').textContent = pct + '%';
  $('bar').style.width = pct + '%';

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
      <h3>${esc(g.module)}</h3>
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
  if (o && !o.disabled) { document.body.classList.remove('side-open'); openLesson(o.dataset.open); }
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
      state.imgErr = (err && err.code === 'permission-denied') ? 'Sem permissão para ver as imagens desta etapa. Avise a Cris para republicar as regras do Firestore.' : 'Não foi possível carregar as imagens agora. Atualize a página.';
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
  $('layout').classList.remove('no-side');
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
      new window.YT.Player(box.querySelector('.player-host'), {
        host: 'https://www.youtube-nocookie.com',
        videoId: v.id, width: '100%', height: '100%',
        playerVars: {
          autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
          origin: location.origin
        },
        events: {
          onError: (ev) => {
            box.classList.remove('is-playing');
            const admin = state.profile && state.profile.role === 'admin';
            const hint = (ev.data === 101 || ev.data === 150)
              ? (admin ? 'O dono do vídeo bloqueou a reprodução em outros sites. No YouTube Studio, ative "Permitir incorporação" neste vídeo.' : 'Este vídeo ainda não está liberado para reprodução aqui. Avise a Cris.')
              : (admin ? 'Vídeo não encontrado ou privado. Confira o link e se a visibilidade é "Não listado".' : 'Não foi possível carregar este vídeo. Avise a Cris.');
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

function renderLesson() {
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
      <div id="l-media"></div>
      <div id="l-info"></div>
      <div id="l-sub"></div>
      <div id="l-notes"></div>
      <div id="l-actions"></div>`;
    $('back').onclick = showHome;
  }
  $('l-tag').textContent = `${l.module} · ${l.kind === 'atividade' ? 'Atividade' : 'Aula'}`;
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
    $('l-info').innerHTML = parts.length ? `<div class="lesson-body">${parts.join('')}</div>` : '';
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
          ${fbs[o.id] ? `<div class="fb-item"><b>Feedback da Cris</b><br>${nl(fbs[o.id])}</div>` : ''}</div>`;
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
    status = `<div class="feedback-card"><div class="fb-title">Feedback da Cris <small>${esc(fmtStamp(sub.feedbackAt))}</small></div>
      ${sub.feedback ? `<div class="rich"><p>${nl(sub.feedback)}</p></div>` : '<div class="rich"><p>Veja os comentários em cada item abaixo.</p></div>'}</div>`;
  } else if (sub) {
    status = l.feedbackEnabled ? '<div class="msg warn">Resposta enviada. A Cris vai corrigir e o feedback aparece aqui.</div>' : '<div class="msg ok">Resposta enviada.</div>';
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
        <label>Link de um arquivo ou documento <span class="hint">Opcional. Google Drive, Notion, Docs... (deixe o acesso liberado para quem tem o link)</span>
          <input id="sub-link" type="url" placeholder="https://" value="${esc(draft.k != null ? draft.k : (sub ? sub.link : ''))}"></label>
        <div id="sub-msg" class="msg err" hidden></div>
        <div class="btn-row">
          <button class="btn btn-primary small" type="submit" id="sub-go">${sub ? 'Reenviar resposta' : (l.feedbackEnabled ? 'Enviar para a Cris' : 'Enviar resposta')}</button>
          ${sub ? '<button class="link-btn" type="button" id="sub-cancel">Cancelar</button>' : ''}
        </div>
      </form>`;
  }

  const afterBtns = `<div class="btn-row" style="margin-top:12px">
      <button class="btn btn-ghost small" type="button" id="sub-edit">Editar e reenviar</button>
      <button class="btn btn-primary small" type="button" id="sub-mat">${matAnswers(l) ? 'Atualizar no material de apoio' : 'Adicionar ao material de apoio'}</button>
      <button class="btn btn-ghost small" type="button" id="sub-pdf">Baixar respostas (PDF)</button></div>`;
  box.innerHTML = `<div class="lesson-body sub-box">
    <h3 class="sub-h">${l.feedbackEnabled ? 'Sua resposta para a Cris' : 'Sua resposta'}</h3>
    ${status}${showForm ? '' : answer}${form}
    ${showForm ? '' : afterBtns}
  </div>`;

  const f = $('sub-form');
  if (f) {
    f.addEventListener('submit', (e) => { e.preventDefault(); submitAnswer(l); });
    f.addEventListener('input', () => {
      const d = { k: $('sub-link').value };
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
  if (!mine && sub.feedback) out.push({ section: '', label: 'Feedback geral da Cris', text: sub.feedback, tag: '', fb: '' });
  return out.slice(0, 120);
}

/* linhas (pergunta/resposta) em HTML; cls = prefixo de classes (pr = pdf, mat = tela) */
function rowsHtml(rows, cls, plain = false) {
  let lastSec = null;
  return rows.map((r) => {
    const head = (r.section || '') !== lastSec ? (lastSec = r.section || '', r.section ? `<h5 class="${cls}-sh">${esc(r.section)}</h5>` : '') : '';
    return `${head}<div class="${cls}-item"><div class="${cls}-q">${esc(r.label)}</div>
      <div class="${cls}-a">${r.text ? nl2br(r.text) : '<em>Sem resposta</em>'}${!plain && r.tag ? ` <span class="${cls}-tag">${esc(r.tag)}</span>` : ''}</div>
      ${!plain && r.fb ? `<div class="${cls}-fb"><b>Feedback da Cris:</b> ${nl2br(r.fb)}</div>` : ''}</div>`;
  }).join('');
}

/* abre a impressao do navegador (a aluna escolhe "Salvar como PDF") */
function openPrint(innerHtml, title) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  const name = (state.profile && state.profile.name) || '';
  root.innerHTML = `<header class="pr-head"><img src="assets/logo-full-dark-on-transparent.png" alt="Closer Journey">
      <div><div class="pr-h1">${esc(title)}</div><div class="pr-meta">${esc(name)}${name ? ' · ' : ''}gerado em ${new Date().toLocaleDateString('pt-BR')}</div></div></header>${innerHtml}`;
  const oldTitle = document.title;
  document.title = `${title}${name ? ' - ' + name : ''}`;
  document.body.classList.add('printing');
  let ended = false;
  const done = () => { if (ended) return; ended = true; document.body.classList.remove('printing'); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const img = root.querySelector('img');
  const go = () => { try { window.print(); } catch { done(); } };
  if (img && !img.complete) { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); setTimeout(() => { if (!ended) go(); }, 1500); }
  else setTimeout(go, 60);
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

function printMaterial() {
  const list = topics();
  if (!list.length) { toast('Seu material de apoio ainda está vazio.'); return; }
  let lastMod = null;
  const html = list.map((n) => {
    const mod = n.module || '';
    const head = mod !== lastMod ? (lastMod = mod, `<h3 class="pr-modh">${esc(mod)}</h3>`) : '';
    return `${head}<section class="pr-topic"><h2 class="pr-title">${esc(n.lessonTitle || '')}</h2>
      ${n.note ? `<div class="pr-lbl">Minhas anotações</div><div class="pr-a pr-note">${nl2br(n.note)}</div>` : ''}
      ${n.answers && n.answers.length ? `<div class="pr-lbl">Minhas respostas</div>${rowsHtml(n.answers, 'pr', true)}` : ''}</section>`;
  }).join('');
  openPrint(html, 'Meu material de apoio');
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
  if (sec.dataset.noteLesson !== l.id) {
    sec.dataset.noteLesson = l.id;
    let draft = null; try { draft = localStorage.getItem(draftNoteKey(l.id)); } catch { /* ok */ }
    const saved = (state.notes[l.id] && state.notes[l.id].note) || '';
    box.innerHTML = `<div class="lesson-body notes-box">
      <h3 class="sub-h">Minhas anotações</h3>
      <p class="hint-line">Escreva o que quiser guardar desta ${l.kind === 'atividade' ? 'atividade' : 'aula'}. Só você vê. Ao salvar, o texto vai para o seu Material de apoio.</p>
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
  box.innerHTML = `<div class="export-bar"><div><strong>${list.length} tópico${list.length > 1 ? 's' : ''}</strong><small>Cada aula ou atividade é um tópico. Adicionar de novo atualiza o tópico.</small></div>
      <button class="btn btn-primary small" id="mat-pdf" type="button">Baixar material (PDF)</button></div>` +
    list.map((n) => {
      const mod = n.module || '';
      const head = mod !== lastMod ? (lastMod = mod, `<h3 class="mat-mod">${esc(mod)}</h3>`) : '';
      const canOpen = state.lessons.some((l) => l.id === n.lessonId);
      return `${head}<article class="mat-topic" data-lid="${esc(n.lessonId)}">
        <header><h4>${esc(n.lessonTitle || '')}</h4>${canOpen ? `<button class="link-btn" type="button" data-open="${esc(n.lessonId)}">Abrir</button>` : ''}</header>
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
  const rm = e.target.closest('[data-rm]');
  if (rm) { const art = rm.closest('[data-lid]'); if (art && confirm('Remover do material de apoio?')) clearPart(art.dataset.lid, rm.dataset.rm); }
});

async function submitAnswer(l) {
  const msg = $('sub-msg'), btn = $('sub-go');
  const fields = Array.isArray(l.fields) ? l.fields : [];
  const link = $('sub-link').value.trim();
  msg.hidden = true;
  const fail = (t) => { msg.textContent = t; msg.hidden = false; };
  if (link && !safeUrl(link)) { fail('O link não parece válido.'); return; }

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
    toast(synced ? 'Resposta enviada e material de apoio atualizado.' : (l.feedbackEnabled ? 'Resposta enviada para a Cris.' : 'Resposta enviada.'));
  } catch (e) {
    console.error(e);
    fail(friendlyError(e)); btn.disabled = false;
  }
}

async function setDone(id, value, next) {
  const prev = { ...state.completed };
  const nextMap = { ...state.completed };
  if (value) nextMap[id] = true; else delete nextMap[id];
  state.completed = nextMap;
  render();
  try {
    await setDoc(doc(db, 'progress', state.user.uid), { completed: nextMap, updatedAt: serverTimestamp() }, { mergeFields: ['completed', 'updatedAt'] });
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

const ROLE_LABEL = { closer: 'Closer', cliente: 'Cliente', observadora: 'Observadora' };
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
    else body = `<button class="btn btn-ghost small" type="button" data-role="${role}" ${state.joining ? 'disabled' : ''}>${state.joining ? 'Aguarde...' : (role === 'observadora' ? 'Quero assistir' : `Quero ser ${role === 'closer' ? 'a closer' : 'a cliente'}`)}</button>`;
    return `<div class="rp-card${isMine ? ' is-mine' : ''}${taken && !isMine ? ' is-taken' : ''}">
      <b>${ROLE_LABEL[role]}</b><small>${desc}</small>${body}</div>`;
  };
  return `<div class="rp-box">
    <div class="rp-h">Inscrição no roleplay</div>
    <p class="rp-sub">Cada roleplay tem 1 vaga de closer e 1 de cliente. As demais alunas entram como observadoras${obs.length ? ` (${obs.length} inscrita${obs.length > 1 ? 's' : ''})` : ''}.</p>
    <div class="rp-grid">
      ${card('closer', 'Conduz a venda')}
      ${card('cliente', 'Interpreta o lead')}
      ${card('observadora', 'Assiste e comenta')}
    </div>
    ${mine ? `<div class="rp-mine">Sua inscrição: <b>${ROLE_LABEL[mine.role]}</b>${past ? '' : ' <button class="link-btn" type="button" data-role-cancel="1">Cancelar inscrição</button>'}</div>` : ''}
    ${state.rpError ? `<div id="rp-msg" class="msg err">${esc(state.rpError)}</div>` : ''}
  </div>`;
}

async function roleplayJoin(ev, role) {
  if (state.joining) return;
  const uid = state.user.uid;
  state.joining = true; state.rpError = '';
  openEvent(ev.id);
  try {
    /* le o que a aluna tem de fato no banco (nao so o que esta na tela) e troca tudo de uma vez: so existe 1 papel por aluna */
    const cur = await getDocs(query(collection(db, 'signups'), where('eventId', '==', ev.id), where('uid', '==', uid)));
    const id = role === 'observadora' ? `${ev.id}_obs_${uid}` : `${ev.id}_${role}`;
    if (!cur.docs.some((d) => d.id === id)) {
      const b = writeBatch(db);
      cur.docs.forEach((d) => b.delete(doc(db, 'signups', d.id)));
      b.set(doc(db, 'signups', id), { eventId: ev.id, role, uid, name: (state.profile && state.profile.name) || '', createdAt: serverTimestamp() });
      await b.commit();
    }
    toast(`Inscrição confirmada como ${ROLE_LABEL[role].toLowerCase()}.`);
  } catch (e) {
    console.error('inscricao roleplay', e);
    const denied = e && e.code === 'permission-denied';
    if (denied && role === 'observadora') state.rpError = 'Sem permissão para gravar a inscrição. Avise a Cris: as regras do Firestore (versão mais recente) precisam ser publicadas no Firebase.';
    else if (denied) state.rpError = 'Não foi possível reservar. A vaga pode ter acabado de ser ocupada por outra aluna. Se ela aparece livre e o erro continua, as regras do Firestore (versão mais recente) precisam ser publicadas no Firebase.';
    else state.rpError = friendlyError(e);
  }
  state.joining = false;
  if (state.openEv === ev.id) openEvent(ev.id);
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
    ${ev.type === 'roleplay' ? roleplayBlock(ev) : ''}
    <div class="foot">
      <button class="btn btn-ghost small" id="ev-ics" type="button">Adicionar ao meu calendário</button>
      <div class="btn-row">
        ${link ? `<a class="btn btn-primary small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Entrar no encontro</a>` : ''}
        <button class="btn btn-ghost small" id="ev-close" type="button">Fechar</button>
      </div>
    </div>`;
  $('ev-modal').hidden = false;
  $('ev-close').onclick = () => { $('ev-modal').hidden = true; state.openEv = null; state.rpError = ''; };
  $('ev-ics').onclick = () => downloadICS(ev);
  $('ev-box').querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => roleplayJoin(ev, b.dataset.role); });
  const cx = $('ev-box').querySelector('[data-role-cancel]');
  if (cx) cx.onclick = async () => {
    const m = mySignup(ev.id); if (!m) return;
    try { await deleteDoc(doc(db, 'signups', m.id)); state.rpError = ''; toast('Inscrição cancelada.'); } catch (e) { toast(friendlyError(e)); }
  };
}
$('ev-modal').addEventListener('click', (e) => { if (e.target === $('ev-modal')) $('ev-modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('ev-modal').hidden = true; });

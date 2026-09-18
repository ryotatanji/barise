import {
  clearSession,
  createLearningProvider,
  getAiEvaluationLabel,
  getAiWorkStatusLabel,
  getLastEmail,
  getStatusLabel,
  getStoredSession,
  normalizeEmail,
  saveSession
} from "./data-provider.js?v=9-0-0-live";

const app = document.querySelector("#app");
const provider = createLearningProvider();

const config = {
  supportLineUrl: "https://lin.ee/7JnzBxE",
  brandLogo: "./assets/barise-logo-white.png"
};

const LEARNER_FORBIDDEN_PATTERN = /\b(good|needs_more|support_needed|reviewing|failed|debug|mock|internal|pass|retry|review|evaluate-work|gpt-4o-mini|OPENAI_API_KEY|learner_theme|current_situation|current_actions|available_metrics|target_result|strategy_tactic_execution)\b/i;
const MINI_WORK_INPUT_ERROR_MESSAGE = "もう少し具体的に書いてください。選んだ行動・理由・いつ/どこで試すかを入れると評価できます。";
const LEARNER_TRANSIENT_ERROR_MESSAGE = "混み合っています。1分ほど待って再度お試しください。入力内容は画面に残っています。";

function safeLearnerErrorMessage(message, fallback = LEARNER_TRANSIENT_ERROR_MESSAGE) {
  const text = String(message || "").trim();
  const containsJapanese = /[ぁ-んァ-ヶ一-龠]/.test(text);
  if (!text || !containsJapanese || LEARNER_FORBIDDEN_PATTERN.test(text)) {
    return fallback;
  }
  return text;
}

const state = {
  email: "",
  learning: null,
  pendingRoute: "",
  selectedPhaseId: ""
};

/* ============================================================
   ことば：章番号・語彙
   ============================================================ */

const KANJI_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function kanjiChapter(order) {
  const n = Number(order) || 0;
  if (n >= 1 && n <= 10) return `第${KANJI_NUM[n]}章`;
  return `第${n}章`;
}

function padChapter(order) {
  return String(Number(order) || 0).padStart(2, "0");
}

function isFinalPhase(phase) {
  return phase?.phase_id === "FINAL";
}

function phaseNumberLabel(phase) {
  return isFinalPhase(phase) ? "" : padChapter(phase?.phase_order);
}

function phaseChapterLabel(phase) {
  return isFinalPhase(phase) ? "" : kanjiChapter(phase?.phase_order);
}

function getLessonDisplayNumber(lessonId) {
  const context = state.learning ? findLessonContext(state.learning, lessonId) : null;
  if (!context) return lessonId;
  return `${context.phase.phase_id}-${String(context.lesson.lesson_order).padStart(2, "0")}`;
}

/* ============================================================
   トゥイーンエンジン（デモのGSAP演出タイミングを移植・依存ゼロ）
   ============================================================ */

const easePower2Out = (t) => 1 - Math.pow(1 - t, 3);
const easeBackOut = (s = 1.7) => (t) => {
  const c = s + 1;
  return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

function tween({ from = 0, to = 1, duration = 1000, delay = 0, ease = easePower2Out, onUpdate }) {
  return new Promise((resolve) => {
    if (duration <= 0) {
      onUpdate?.(to);
      resolve();
      return;
    }
    const start = performance.now() + delay;
    const step = (now) => {
      if (now < start) {
        requestAnimationFrame(step);
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      onUpdate?.(from + (to - from) * ease(t));
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/* ============================================================
   標高リング（計器盤の中心）
   ============================================================ */

const HOME_RING_R = 64;
const HOME_RING_C = 2 * Math.PI * HOME_RING_R;
const JUDGE_RING_R = 82;
const JUDGE_RING_C = 2 * Math.PI * JUDGE_RING_R;

function ringOffset(circumference, pct) {
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  return circumference * (1 - safe / 100);
}

function setHomeRing(pct) {
  const ring = document.getElementById("homeRing");
  const label = document.getElementById("homePct");
  if (ring) ring.style.strokeDashoffset = ringOffset(HOME_RING_C, pct);
  if (label) label.textContent = String(Math.round(pct));
}

let homeRingShown = false;
let pendingGrowth = null;

function svgElevationRing(startPct) {
  const offset = ringOffset(HOME_RING_C, startPct);
  return `
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle class="ring-bg" cx="75" cy="75" r="${HOME_RING_R}"></circle>
      <circle class="ring-fg" id="homeRing" cx="75" cy="75" r="${HOME_RING_R}"
        style="stroke-dasharray:${HOME_RING_C};stroke-dashoffset:${offset};"></circle>
    </svg>
  `;
}

/* ============================================================
   画面遷移方向（横スライド+フェード .38s／デモgoto()準拠）
   ============================================================ */

const ROUTE_LEVEL = { login: 0, home: 0, learning: 1, works: 1, lesson: 2, work: 2 };
let lastRouteLevel = 0;

function enterDirection(routeName) {
  const level = ROUTE_LEVEL[routeName] ?? 0;
  const dir = level >= lastRouteLevel ? "fwd" : "back";
  lastRouteLevel = level;
  return dir;
}

/* ============================================================
   AI採点オーバーレイ・トースト（#app外の常設DOM）
   ============================================================ */

let judgeDom = null;
let toastDom = null;
let toastTimer = 0;
let judgeOnNext = null;
let judgeResultGeneration = 0;

function ensureOverlayDom() {
  if (judgeDom) return;

  judgeDom = document.createElement("div");
  judgeDom.className = "judge";
  judgeDom.id = "judge";
  judgeDom.innerHTML = `
    <div class="judge-in">
      <p class="thinking" id="judgeThinking">AIが回答を確認しています<span class="dots"><i>.</i><i>.</i><i>.</i></span></p>
      <div id="judgeResult" style="display:none;">
        <div class="judge-ring" id="judgeRingWrap">
          <svg width="190" height="190" viewBox="0 0 190 190">
            <circle class="jr-bg" cx="95" cy="95" r="${JUDGE_RING_R}"></circle>
            <circle class="jr-fg" id="judgeRing" cx="95" cy="95" r="${JUDGE_RING_R}"
              style="stroke-dasharray:${JUDGE_RING_C};stroke-dashoffset:${JUDGE_RING_C};"></circle>
          </svg>
          <div class="judge-center"><b id="judgeScore">0</b><span id="judgeScoreNote">SCORE / 合格80</span></div>
          <div class="spark" id="judgeSpark"></div>
        </div>
        <span class="judge-stamp" id="judgeStamp" hidden>★ クリア</span>
        <p class="judge-fb" id="judgeFb"></p>
        <button class="judge-next" id="judgeNext" type="button">次の一歩へ →</button>
      </div>
    </div>
  `;
  document.body.appendChild(judgeDom);

  document.getElementById("judgeNext").addEventListener("click", () => {
    const handler = judgeOnNext;
    judgeOnNext = null;
    if (handler) {
      handler();
    } else {
      closeJudgeOverlay();
    }
  });

  toastDom = document.createElement("div");
  toastDom.className = "toast";
  document.body.appendChild(toastDom);
}

/* 表示前に必ず全リセット（点数・リング・スタンプ・コメント・ボタン）
   ※承認デモ submitWork ハンドラ冒頭のリセット規律を移植。省略禁止。
     再提出時に前回の表示が一瞬でも見えたらバグ扱い。 */
function resetJudgeOverlay() {
  const ring = document.getElementById("judgeRing");
  const ringWrap = document.getElementById("judgeRingWrap");
  const stamp = document.getElementById("judgeStamp");
  const fb = document.getElementById("judgeFb");
  const next = document.getElementById("judgeNext");
  const spark = document.getElementById("judgeSpark");

  document.getElementById("judgeScore").textContent = "0";
  ring.style.strokeDashoffset = JUDGE_RING_C;
  ringWrap.style.opacity = "1";
  ringWrap.style.transform = "scale(1)";
  stamp.style.opacity = "0";
  stamp.style.transform = "scale(.8)";
  stamp.hidden = true;
  fb.style.opacity = "0";
  fb.textContent = "";
  next.style.opacity = "0";
  next.style.transform = "translateY(10px)";
  next.style.pointerEvents = "none";
  spark.innerHTML = "";
  judgeOnNext = null;
}

function openJudgeOverlay(message = "AIが回答を確認しています") {
  ensureOverlayDom();
  resetJudgeOverlay();
  document.getElementById("judgeThinking").innerHTML =
    `${escapeHtml(message)}<span class="dots"><i>.</i><i>.</i><i>.</i></span>`;
  document.getElementById("judgeThinking").style.display = "block";
  document.getElementById("judgeResult").style.display = "none";
  judgeDom.classList.add("on");
  document.body.style.overflow = "hidden";
}

function closeJudgeOverlay() {
  if (!judgeDom) return;
  judgeResultGeneration += 1;
  judgeDom.classList.remove("on");
  document.body.style.overflow = "";
  resetJudgeOverlay();
}

async function showJudgeResult({ score, passed, feedback, scoreNote, buttonLabel, onNext, generation = judgeResultGeneration }) {
  ensureOverlayDom();
  const ringWrap = document.getElementById("judgeRingWrap");
  const ring = document.getElementById("judgeRing");
  const scoreEl = document.getElementById("judgeScore");
  const stamp = document.getElementById("judgeStamp");
  const fb = document.getElementById("judgeFb");
  const next = document.getElementById("judgeNext");

  document.getElementById("judgeThinking").style.display = "none";
  document.getElementById("judgeResult").style.display = "block";
  document.getElementById("judgeScoreNote").textContent = scoreNote || "SCORE / 合格80";
  fb.textContent = feedback || "";
  next.textContent = buttonLabel || "次の一歩へ →";
  judgeOnNext = onNext || null;

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) throw new Error("評価点を確認できませんでした。");
  const target = Math.max(0, Math.min(100, numericScore));
  const isCurrent = () => generation === judgeResultGeneration && judgeDom?.classList.contains("on");

  /* リング立ち上がり（back.out(1.6) / .45s） */
  await tween({
    from: 0, to: 1, duration: 450, ease: easeBackOut(1.6),
    onUpdate: (v) => {
      ringWrap.style.opacity = String(Math.max(0, Math.min(1, v)));
      ringWrap.style.transform = `scale(${.85 + .15 * v})`;
    }
  });
  if (!isCurrent()) return;

  /* スコアは必ず0から実スコアへ満ちる（1.2s） */
  await tween({
    from: 0, to: target, duration: 1200, ease: easePower2Out,
    onUpdate: (v) => {
      scoreEl.textContent = String(Math.round(v));
      ring.style.strokeDashoffset = ringOffset(JUDGE_RING_C, v);
    }
  });
  if (!isCurrent()) return;
  // requestAnimationFrameの最終丸めに依存せず、確定値を必ずDOMへ残す。
  scoreEl.textContent = String(Math.round(target));
  ring.style.strokeDashoffset = ringOffset(JUDGE_RING_C, target);

  /* 金のクリアスタンプ（back.out(2.2)）＋粒子22個は good のときだけ */
  if (passed) {
    stamp.hidden = false;
    sparkBurst();
    await tween({
      from: 0, to: 1, duration: 450, ease: easeBackOut(2.2),
      onUpdate: (v) => {
        stamp.style.opacity = String(Math.max(0, Math.min(1, v)));
        stamp.style.transform = `scale(${.8 + .2 * v})`;
      }
    });
    if (!isCurrent()) return;
  }

  await tween({
    from: 0, to: 1, duration: 500,
    onUpdate: (v) => { fb.style.opacity = String(Math.max(0, Math.min(1, v))); }
  });
  if (!isCurrent()) return;

  await tween({
    from: 0, to: 1, duration: 450,
    onUpdate: (v) => {
      next.style.opacity = String(Math.max(0, Math.min(1, v)));
      next.style.transform = `translateY(${10 * (1 - v)}px)`;
    }
  });
  if (!isCurrent()) return;
  next.style.pointerEvents = "auto";
}

function sparkBurst() {
  const wrap = document.getElementById("judgeSpark");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (let i = 0; i < 22; i++) {
    const s = document.createElement("i");
    const a = (Math.PI * 2 * i) / 22 + Math.random() * .4;
    const dist = 60 + Math.random() * 90;
    s.style.setProperty("--x", `${Math.cos(a) * dist}px`);
    s.style.setProperty("--y", `${Math.sin(a) * dist * .8}px`);
    s.style.setProperty("--d", `${.7 + Math.random() * .6}s`);
    if (i % 4 === 0) s.style.background = "#e0503f";
    wrap.appendChild(s);
  }
}

function showToast(html, duration = 3200) {
  ensureOverlayDom();
  toastDom.innerHTML = html;
  toastDom.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastDom.classList.remove("on"), duration);
}

/* ============================================================
   起動・ルーティング（ロジックは V5 準拠・変更禁止）
   ============================================================ */

async function boot() {
  renderLoading();

  try {
    await provider.init();
    state.email = getStoredSession();

    if (state.email) {
      const result = await provider.login(state.email);
      if (result.ok) {
        await refreshLearningState();
      } else {
        clearSession();
        state.email = "";
      }
    }

    mountDLive();
    render();
  } catch (error) {
    renderError(error.message);
  }
}

function render() {
  const route = parseRoute();

  if (!state.email) {
    if (!["login", "home"].includes(route.name)) {
      state.pendingRoute = window.location.hash || "#/home";
    }
    renderLogin();
    return;
  }

  if (route.name === "login") {
    window.location.hash = "#/home";
    return;
  }

  if (route.name === "learning") {
    renderLearningPage();
    return;
  }

  if (route.name === "works") {
    renderWorksPage();
    return;
  }

  if (route.name === "work") {
    renderAiWorkPage(route.workId);
    return;
  }

  if (route.name === "lesson") {
    renderLesson(route.lessonId, route.section);
    return;
  }

  renderHome();
  requestAnimationFrame(() => scrollToPageTop());
}

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, "");
  const [path, queryString = ""] = hash.split("?");
  const params = new URLSearchParams(queryString);
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "login") {
    return { name: "login" };
  }
  if (parts[0] === "learning") {
    return { name: "learning" };
  }
  if (parts[0] === "works") {
    return { name: "works" };
  }
  if (parts[0] === "work" && parts[1]) {
    return { name: "work", workId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "lesson" && parts[1]) {
    return { name: "lesson", lessonId: decodeURIComponent(parts[1]), section: params.get("section") || "" };
  }
  return { name: "home" };
}

/* ============================================================
   画面：ローディング／エラー／ログイン
   ============================================================ */

function renderLoading() {
  app.innerHTML = `
    <main class="loading-screen">
      <span class="loading-ring" aria-hidden="true"></span>
      <p>学習ページをひらいています</p>
    </main>
  `;
}

function renderError(message) {
  const safeMessage = safeLearnerErrorMessage(message);
  app.innerHTML = `
    <main class="login-screen">
      <img src="${config.brandLogo}" alt="Barise" class="login-brand">
      <section class="login-panel" aria-labelledby="error-title">
        <p class="eyebrow">CONSOLE</p>
        <h1 id="error-title">ページをひらけませんでした</h1>
        <p class="lead">${escapeHtml(safeMessage)}</p>
        <button class="primary-button" type="button" data-action="reload">もう一度ひらく</button>
      </section>
    </main>
  `;
}

function renderLogin(errorMessage = "", emailValue = getLastEmail(), showSupport = false) {
  app.innerHTML = `
    <main class="login-screen">
      <img src="${config.brandLogo}" alt="Barise" class="login-brand">
      <p class="login-tag">BASE + RISE — 土台から、確かな一歩を</p>
      <section class="login-panel" aria-labelledby="login-title">
        <p class="eyebrow">MEMBER LEARNING</p>
        <h1 id="login-title">おかえりなさい</h1>
        <p class="lead">ここは、あなた専用の学びの基地です。動画・ワーク・フィードバックのすべてが、この場所から始まります。</p>
        <form id="login-form" class="login-form">
          <label for="email">メールアドレス</label>
          <input id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="公式LINEに登録したメールアドレス" value="${escapeHtml(emailValue)}" required>
          ${errorMessage ? `<div class="form-error">${escapeHtml(errorMessage)}</div>` : ""}
          ${showSupport ? `<a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEでサポートに相談する</a>` : ""}
          <button class="primary-button" type="submit">学習をはじめる</button>
        </form>
        <p class="login-support-note">うまく入れないときも、サポートが確認しますのでご安心ください。</p>
      </section>
      ${renderLand("fixed")}
    </main>
  `;
}

/* ============================================================
   共通：ヘッダー・タブナビ
   ============================================================ */

function renderHomeTop(learning) {
  const d = new Date();
  const currentPhase = learning.currentPhase;
  const chapterLabel = phaseChapterLabel(currentPhase);
  const sub = `${d.getMonth() + 1}/${d.getDate()}${chapterLabel ? ` ・ ${escapeHtml(chapterLabel)}` : ""}`;
  return `
    <div class="top">
      <a href="#/home" aria-label="Barise ホーム"><img class="brand-img" src="${config.brandLogo}" alt="Barise" width="108"></a>
      <span class="top-sub">${sub}</span>
    </div>
  `;
}

function renderBackTop(href, label, sub = "") {
  return `
    <div class="top">
      <a class="back" href="${escapeAttribute(href)}">← ${escapeHtml(label)}</a>
      ${sub ? `<span class="top-sub">${escapeHtml(sub)}</span>` : ""}
    </div>
  `;
}

function renderTabbar(current) {
  return `
    <nav class="tabbar" aria-label="主要ナビゲーション">
      <a href="#/home" ${current === "home" ? 'aria-current="page"' : ""}>ホーム</a>
      <a href="#/learning" ${current === "learning" ? 'aria-current="page"' : ""}>学習</a>
      <a href="#/works" ${current === "works" ? 'aria-current="page"' : ""}>ワーク</a>
      <span class="tab-spacer"></span>
      <button class="text-button" type="button" data-action="logout">ログアウト</button>
    </nav>
  `;
}

const D_CONTOUR_SVG = `<svg  viewBox="0 0 375 680" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="rgba(163,174,192,.07)" stroke-width="1"><path d="M147.8,180.0 L148.2,181.6 L148.3,183.1 L148.0,184.7 L147.5,186.2 L146.8,187.7 L145.8,189.0 L144.7,190.3 L143.4,191.4 L142.1,192.5 L140.7,193.5 L139.4,194.4 L138.0,195.2 L136.7,196.1 L135.3,196.9 L134.0,197.7 L132.6,198.4 L131.1,199.1 L129.7,199.8 L128.1,200.3 L126.6,200.7 L124.9,201.0 L123.3,201.1 L121.6,201.2 L120.0,201.1 L118.4,200.9 L116.8,200.7 L115.2,200.5 L113.6,200.2 L112.0,199.9 L110.4,199.6 L108.7,199.3 L107.0,199.0 L105.3,198.6 L103.5,198.1 L101.8,197.5 L100.2,196.8 L98.6,195.9 L97.2,194.8 L96.1,193.5 L95.2,192.1 L94.5,190.6 L94.1,189.1 L94.0,187.5 L94.1,185.9 L94.4,184.3 L94.9,182.8 L95.3,181.4 L95.8,180.0 L96.3,178.7 L96.7,177.4 L97.0,176.1 L97.3,174.9 L97.5,173.5 L97.8,172.2 L98.0,170.8 L98.4,169.4 L98.8,168.0 L99.5,166.7 L100.3,165.4 L101.2,164.1 L102.4,163.0 L103.7,162.0 L105.1,161.1 L106.6,160.3 L108.2,159.7 L109.8,159.1 L111.4,158.6 L113.1,158.2 L114.8,157.8 L116.5,157.5 L118.2,157.3 L120.0,157.1 L121.8,157.0 L123.6,157.1 L125.3,157.3 L127.1,157.7 L128.7,158.2 L130.3,159.0 L131.7,159.9 L133.0,160.9 L134.2,162.0 L135.2,163.2 L136.1,164.5 L136.9,165.7 L137.7,166.9 L138.5,168.0 L139.3,169.1 L140.2,170.1 L141.1,171.2 L142.2,172.2 L143.3,173.3 L144.4,174.5 L145.4,175.7 L146.4,177.1 L147.2,178.5Z"/><path d="M176.2,180.0 L177.0,183.2 L177.1,186.4 L176.7,189.5 L175.7,192.6 L174.1,195.5 L172.0,198.2 L169.4,200.6 L166.6,202.8 L163.7,204.7 L160.6,206.4 L157.6,207.9 L154.7,209.4 L151.9,210.8 L149.2,212.2 L146.6,213.6 L144.0,215.1 L141.4,216.6 L138.7,218.2 L135.9,219.6 L133.0,220.9 L129.9,222.0 L126.7,222.9 L123.4,223.6 L120.0,223.9 L116.6,223.9 L113.2,223.7 L109.8,223.2 L106.5,222.6 L103.2,221.8 L100.0,220.9 L96.8,219.9 L93.6,218.8 L90.4,217.5 L87.2,216.2 L84.1,214.7 L81.0,213.0 L78.2,211.0 L75.6,208.8 L73.4,206.3 L71.6,203.7 L70.2,200.8 L69.4,197.7 L69.0,194.6 L69.1,191.5 L69.6,188.5 L70.3,185.5 L71.3,182.7 L72.2,180.0 L73.2,177.4 L74.0,174.9 L74.7,172.4 L75.2,169.8 L75.6,167.2 L75.9,164.5 L76.2,161.7 L76.6,158.8 L77.2,155.8 L78.1,152.8 L79.4,149.9 L81.2,147.1 L83.3,144.6 L85.9,142.4 L88.8,140.5 L92.0,138.9 L95.4,137.7 L98.9,136.9 L102.5,136.3 L106.0,135.9 L109.6,135.7 L113.1,135.7 L116.6,135.8 L120.0,135.9 L123.4,136.1 L126.8,136.5 L130.1,136.9 L133.4,137.6 L136.7,138.5 L139.8,139.6 L142.8,140.9 L145.6,142.5 L148.1,144.4 L150.5,146.4 L152.6,148.5 L154.6,150.7 L156.4,153.0 L158.1,155.2 L159.9,157.5 L161.6,159.7 L163.5,161.8 L165.5,164.1 L167.5,166.4 L169.6,168.8 L171.6,171.3 L173.4,174.0 L175.0,176.9Z"/><path d="M203.7,180.0 L204.5,184.7 L204.6,189.4 L203.9,194.1 L202.4,198.7 L200.1,203.0 L197.0,207.0 L193.3,210.6 L189.1,213.8 L184.6,216.5 L180.0,219.0 L175.4,221.1 L170.9,223.0 L166.6,224.9 L162.5,226.9 L158.7,228.9 L154.9,231.2 L151.2,233.6 L147.5,236.1 L143.6,238.7 L139.4,241.3 L135.0,243.6 L130.2,245.7 L125.2,247.3 L120.0,248.4 L114.7,249.0 L109.3,248.9 L103.9,248.3 L98.7,247.2 L93.7,245.6 L88.8,243.6 L84.2,241.4 L79.7,239.0 L75.5,236.4 L71.3,233.7 L67.3,230.8 L63.4,227.9 L59.8,224.7 L56.3,221.3 L53.2,217.8 L50.5,213.9 L48.3,209.9 L46.7,205.7 L45.6,201.4 L45.1,197.0 L45.2,192.6 L45.7,188.3 L46.6,184.1 L47.7,180.0 L48.8,176.1 L50.0,172.2 L50.9,168.4 L51.7,164.5 L52.4,160.6 L52.9,156.5 L53.4,152.2 L54.0,147.8 L54.9,143.2 L56.2,138.6 L58.1,134.1 L60.6,129.7 L63.7,125.7 L67.6,122.2 L72.0,119.2 L76.9,116.9 L82.2,115.2 L87.8,114.2 L93.4,113.7 L99.0,113.8 L104.5,114.2 L109.9,114.8 L115.0,115.6 L120.0,116.4 L124.9,117.3 L129.6,118.1 L134.4,118.9 L139.1,119.7 L143.8,120.6 L148.5,121.7 L153.2,123.0 L157.7,124.7 L162.1,126.6 L166.3,129.0 L170.2,131.6 L173.8,134.5 L177.1,137.7 L180.1,141.0 L182.9,144.4 L185.6,147.9 L188.2,151.5 L190.8,155.2 L193.3,158.9 L195.8,162.8 L198.2,166.8 L200.4,171.0 L202.3,175.4Z"/><path d="M228.8,180.0 L229.2,186.1 L229.0,192.1 L228.0,198.2 L226.2,204.1 L223.4,209.7 L219.9,215.0 L215.5,219.9 L210.5,224.2 L205.1,228.1 L199.3,231.5 L193.4,234.5 L187.6,237.2 L182.0,239.8 L176.6,242.4 L171.5,245.2 L166.5,248.2 L161.6,251.4 L156.7,254.9 L151.5,258.6 L146.1,262.3 L140.2,265.9 L133.9,269.2 L127.1,271.9 L120.0,273.9 L112.6,275.1 L105.2,275.3 L97.8,274.5 L90.6,272.9 L83.8,270.3 L77.4,267.1 L71.4,263.4 L66.0,259.2 L60.9,254.8 L56.2,250.3 L51.8,245.8 L47.6,241.3 L43.5,236.8 L39.5,232.2 L35.8,227.6 L32.2,222.9 L28.9,218.0 L26.1,212.9 L23.7,207.6 L22.0,202.2 L20.8,196.7 L20.3,191.1 L20.3,185.5 L20.8,180.0 L21.7,174.5 L22.8,169.2 L24.0,163.8 L25.2,158.5 L26.5,153.1 L27.7,147.7 L29.0,142.0 L30.4,136.2 L32.1,130.3 L34.3,124.3 L37.1,118.4 L40.6,112.8 L44.9,107.5 L50.0,102.8 L55.9,98.9 L62.5,95.8 L69.6,93.6 L77.1,92.3 L84.7,91.9 L92.2,92.3 L99.6,93.3 L106.7,94.7 L113.5,96.3 L120.0,97.9 L126.2,99.5 L132.3,100.8 L138.4,101.9 L144.4,102.9 L150.6,103.7 L157.0,104.5 L163.4,105.5 L170.0,106.8 L176.5,108.5 L182.8,110.7 L188.9,113.5 L194.6,116.8 L199.9,120.7 L204.6,125.1 L208.7,129.8 L212.3,134.9 L215.5,140.2 L218.3,145.6 L220.7,151.1 L222.9,156.7 L224.8,162.4 L226.5,168.1 L227.9,174.0Z"/><path d="M251.1,180.0 L250.5,187.2 L249.6,194.4 L248.3,201.6 L246.3,208.6 L243.6,215.5 L240.1,222.1 L235.9,228.4 L231.0,234.2 L225.4,239.6 L219.2,244.4 L212.8,248.8 L206.1,252.9 L199.4,256.6 L192.8,260.2 L186.2,263.8 L179.8,267.6 L173.4,271.6 L166.9,275.7 L160.2,280.1 L153.1,284.6 L145.6,288.9 L137.6,292.9 L129.0,296.3 L120.0,298.9 L110.7,300.5 L101.2,300.9 L91.8,300.0 L82.7,297.8 L74.1,294.4 L66.2,289.9 L59.0,284.6 L52.6,278.8 L46.9,272.6 L41.8,266.2 L37.2,259.9 L32.8,253.8 L28.6,247.8 L24.3,242.1 L20.0,236.5 L15.6,231.0 L11.2,225.4 L6.8,219.7 L2.7,213.7 L-1.0,207.4 L-4.1,200.9 L-6.5,194.1 L-8.2,187.1 L-8.9,180.0 L-8.9,172.9 L-8.1,165.7 L-6.8,158.7 L-4.9,151.7 L-2.6,144.8 L-0.1,137.9 L2.7,131.1 L5.8,124.2 L9.2,117.3 L13.0,110.5 L17.3,103.8 L22.3,97.3 L28.0,91.2 L34.5,85.7 L41.8,80.9 L49.8,77.1 L58.4,74.2 L67.4,72.5 L76.6,71.8 L85.8,72.1 L94.9,73.1 L103.6,74.8 L112.0,76.8 L120.0,78.9 L127.7,81.0 L135.1,82.7 L142.5,84.2 L150.0,85.3 L157.7,86.0 L165.7,86.7 L174.0,87.3 L182.6,88.3 L191.4,89.6 L200.1,91.7 L208.6,94.5 L216.7,98.2 L224.1,102.8 L230.6,108.2 L236.2,114.3 L240.8,121.0 L244.3,128.1 L247.0,135.5 L248.9,143.0 L250.1,150.5 L250.9,158.0 L251.2,165.4 L251.3,172.7Z"/><path d="M271.1,180.0 L269.2,188.3 L267.4,196.4 L265.6,204.5 L263.6,212.6 L261.3,220.6 L258.5,228.6 L255.1,236.4 L251.0,244.0 L246.1,251.3 L240.4,258.2 L234.0,264.6 L226.9,270.5 L219.4,275.9 L211.5,280.9 L203.5,285.7 L195.2,290.2 L186.8,294.7 L178.3,299.1 L169.6,303.5 L160.5,307.9 L151.1,312.2 L141.2,316.1 L130.8,319.4 L120.0,321.9 L108.9,323.4 L97.6,323.7 L86.5,322.5 L75.7,320.0 L65.5,316.0 L56.0,310.7 L47.5,304.4 L40.0,297.2 L33.5,289.6 L27.8,281.7 L22.7,273.9 L18.0,266.3 L13.5,259.0 L8.9,252.1 L4.0,245.6 L-1.3,239.2 L-6.9,233.0 L-12.8,226.6 L-18.9,219.9 L-24.7,212.8 L-30.1,205.3 L-34.8,197.2 L-38.5,188.8 L-40.9,180.0 L-42.1,171.0 L-41.9,162.0 L-40.4,153.0 L-37.8,144.2 L-34.1,135.7 L-29.7,127.5 L-24.7,119.6 L-19.2,112.0 L-13.3,104.6 L-7.1,97.4 L-0.6,90.5 L6.3,83.8 L13.7,77.4 L21.6,71.5 L30.1,66.2 L39.2,61.6 L48.8,57.9 L58.9,55.2 L69.3,53.6 L79.8,52.9 L90.2,53.2 L100.4,54.3 L110.4,56.0 L120.0,57.9 L129.3,60.0 L138.4,61.9 L147.4,63.6 L156.4,65.0 L165.7,66.0 L175.4,66.8 L185.5,67.6 L196.0,68.6 L206.8,70.1 L217.7,72.3 L228.4,75.4 L238.6,79.6 L248.1,85.0 L256.4,91.4 L263.4,98.9 L268.9,107.2 L272.9,116.2 L275.4,125.5 L276.6,135.0 L276.6,144.5 L275.9,153.8 L274.5,162.8 L272.9,171.5Z"/><path d="M290.4,180.0 L287.3,189.3 L284.6,198.3 L282.3,207.3 L280.3,216.3 L278.5,225.5 L276.6,234.9 L274.4,244.4 L271.5,254.0 L267.7,263.5 L262.9,272.8 L257.0,281.6 L249.9,289.9 L241.8,297.5 L232.7,304.3 L222.9,310.4 L212.6,315.7 L201.9,320.5 L190.8,324.7 L179.6,328.5 L168.1,332.0 L156.5,335.2 L144.6,337.9 L132.4,340.2 L120.0,341.8 L107.4,342.6 L94.7,342.4 L82.2,340.9 L69.9,338.1 L58.2,334.0 L47.3,328.6 L37.3,322.0 L28.3,314.4 L20.4,306.2 L13.4,297.5 L7.3,288.7 L1.7,280.1 L-3.6,271.7 L-8.9,263.7 L-14.6,256.1 L-20.8,248.8 L-27.5,241.5 L-34.7,234.2 L-42.3,226.6 L-50.0,218.5 L-57.4,209.9 L-64.0,200.5 L-69.6,190.5 L-73.6,180.0 L-75.9,169.1 L-76.3,158.1 L-74.7,147.2 L-71.3,136.6 L-66.2,126.5 L-59.7,117.0 L-52.1,108.2 L-43.7,100.0 L-34.9,92.4 L-25.9,85.3 L-16.7,78.6 L-7.5,72.1 L1.8,65.9 L11.1,59.9 L20.7,54.3 L30.6,49.0 L40.9,44.2 L51.5,40.2 L62.6,36.9 L73.9,34.5 L85.5,33.1 L97.1,32.6 L108.6,32.9 L120.0,33.8 L131.2,35.3 L142.2,37.0 L153.2,38.8 L164.1,40.6 L175.2,42.4 L186.6,44.0 L198.2,45.7 L210.3,47.7 L222.6,50.1 L235.0,53.1 L247.3,57.2 L259.1,62.3 L270.1,68.6 L279.8,76.2 L288.1,85.0 L294.5,94.8 L299.0,105.3 L301.6,116.4 L302.4,127.6 L301.6,138.8 L299.6,149.8 L296.9,160.3 L293.7,170.4Z"/><path d="M311.3,180.0 L307.4,190.4 L304.0,200.5 L301.3,210.5 L299.3,220.6 L297.8,231.1 L296.5,241.9 L295.2,253.1 L293.3,264.7 L290.6,276.4 L286.6,288.1 L281.1,299.5 L274.0,310.3 L265.3,320.2 L255.0,328.9 L243.5,336.4 L230.9,342.6 L217.6,347.5 L203.8,351.3 L189.8,354.0 L175.7,356.0 L161.7,357.3 L147.7,358.1 L133.8,358.5 L120.0,358.5 L106.2,358.0 L92.5,356.8 L78.9,355.0 L65.5,352.2 L52.4,348.5 L39.9,343.6 L28.1,337.6 L17.2,330.6 L7.3,322.8 L-1.7,314.3 L-9.9,305.3 L-17.3,296.1 L-24.2,287.0 L-30.9,278.0 L-37.7,269.1 L-44.7,260.5 L-52.3,251.9 L-60.3,243.2 L-68.7,234.2 L-77.2,224.7 L-85.5,214.6 L-93.2,203.8 L-99.8,192.2 L-104.7,180.0 L-107.7,167.4 L-108.4,154.6 L-106.7,141.8 L-102.5,129.5 L-96.1,117.9 L-87.8,107.2 L-77.9,97.4 L-67.0,88.7 L-55.3,80.9 L-43.5,73.9 L-31.7,67.4 L-20.2,61.4 L-9.0,55.5 L1.8,49.7 L12.4,43.7 L22.9,37.8 L33.6,31.8 L44.6,26.1 L56.1,20.7 L68.1,16.0 L80.5,12.0 L93.4,9.1 L106.6,7.2 L120.0,6.5 L133.4,6.7 L146.8,7.9 L160.0,9.8 L173.1,12.2 L186.1,15.1 L199.1,18.4 L212.1,21.9 L225.2,25.8 L238.4,30.1 L251.5,35.0 L264.4,40.6 L276.9,47.2 L288.6,54.9 L299.1,63.7 L308.2,73.6 L315.5,84.5 L320.8,96.2 L324.1,108.5 L325.3,121.0 L324.6,133.6 L322.5,145.9 L319.2,157.8 L315.3,169.2Z"/><path d="M335.9,180.0 L332.1,191.8 L328.6,203.2 L325.6,214.6 L323.3,226.1 L321.5,237.9 L320.1,250.1 L318.8,262.9 L317.1,276.3 L314.5,290.0 L310.6,303.8 L305.1,317.3 L297.6,330.3 L288.1,342.2 L276.6,352.7 L263.4,361.6 L248.6,368.5 L232.9,373.6 L216.4,376.9 L199.7,378.5 L183.0,378.8 L166.6,378.1 L150.6,376.7 L135.1,374.8 L120.0,372.8 L105.2,370.7 L90.7,368.5 L76.2,366.2 L61.9,363.6 L47.6,360.5 L33.5,356.8 L19.7,352.2 L6.3,346.6 L-6.4,340.0 L-18.3,332.5 L-29.3,324.1 L-39.5,315.0 L-48.9,305.3 L-57.6,295.3 L-65.9,285.1 L-73.9,274.7 L-81.9,264.3 L-90.0,253.6 L-98.1,242.6 L-106.2,231.3 L-114.0,219.4 L-121.2,206.9 L-127.4,193.7 L-132.1,180.0 L-134.9,165.9 L-135.4,151.5 L-133.4,137.3 L-128.8,123.6 L-121.7,110.6 L-112.3,98.6 L-101.0,87.8 L-88.2,78.3 L-74.7,69.9 L-60.7,62.7 L-46.8,56.2 L-33.3,50.2 L-20.5,44.4 L-8.3,38.5 L3.4,32.3 L14.6,25.6 L25.9,18.5 L37.3,11.0 L49.2,3.6 L61.8,-3.7 L75.3,-10.3 L89.5,-15.9 L104.5,-20.3 L120.0,-23.2 L135.8,-24.5 L151.8,-24.1 L167.5,-22.2 L183.0,-18.9 L198.0,-14.5 L212.6,-9.1 L226.7,-3.0 L240.3,3.6 L253.6,10.8 L266.6,18.3 L279.3,26.3 L291.4,34.9 L303.0,44.2 L313.7,54.3 L323.2,65.1 L331.4,76.7 L337.8,89.1 L342.4,102.0 L345.1,115.3 L345.9,128.8 L345.0,142.1 L342.8,155.2 L339.6,167.8Z"/><path d="M365.6,180.0 L362.9,193.5 L359.9,206.7 L356.7,219.8 L353.8,233.0 L351.0,246.3 L348.4,260.1 L345.8,274.2 L342.8,288.8 L339.0,303.8 L334.0,318.9 L327.4,333.9 L318.8,348.3 L308.2,361.6 L295.4,373.4 L280.6,383.3 L264.0,391.1 L246.2,396.5 L227.5,399.7 L208.5,400.7 L189.6,399.8 L171.1,397.6 L153.3,394.3 L136.3,390.6 L120.0,386.8 L104.3,383.2 L88.9,380.0 L73.6,377.2 L58.3,374.8 L42.8,372.5 L27.0,370.0 L11.0,367.0 L-5.0,363.2 L-20.9,358.4 L-36.2,352.3 L-50.8,344.8 L-64.5,336.1 L-77.0,326.2 L-88.3,315.2 L-98.4,303.5 L-107.4,291.1 L-115.6,278.3 L-122.9,265.1 L-129.7,251.7 L-136.0,238.1 L-141.8,224.1 L-147.0,209.7 L-151.2,195.0 L-154.4,180.0 L-156.0,164.7 L-155.7,149.3 L-153.3,134.0 L-148.5,119.1 L-141.4,104.9 L-132.0,91.7 L-120.6,79.6 L-107.6,68.8 L-93.4,59.4 L-78.5,51.1 L-63.6,43.8 L-48.9,37.1 L-34.7,30.8 L-21.2,24.3 L-8.3,17.5 L4.0,10.0 L16.2,1.9 L28.5,-6.8 L41.4,-16.0 L55.0,-25.2 L69.7,-34.0 L85.5,-41.9 L102.3,-48.5 L120.0,-53.2 L138.3,-55.9 L156.8,-56.3 L175.1,-54.3 L192.9,-50.2 L209.9,-44.2 L226.0,-36.5 L241.0,-27.6 L255.0,-17.8 L268.0,-7.5 L280.3,3.2 L292.0,14.0 L303.2,25.0 L314.0,36.1 L324.3,47.4 L334.0,59.0 L342.9,71.1 L350.8,83.7 L357.5,96.8 L362.7,110.3 L366.2,124.2 L368.2,138.2 L368.6,152.3 L367.6,166.3Z"/><path d="M400.4,180.0 L399.7,195.5 L397.6,210.9 L394.4,226.2 L390.5,241.3 L386.0,256.4 L381.1,271.5 L375.8,286.7 L369.9,302.1 L363.3,317.6 L355.8,333.1 L346.9,348.4 L336.4,363.1 L324.0,376.9 L309.8,389.3 L293.7,399.9 L275.9,408.4 L256.7,414.6 L236.6,418.2 L216.1,419.5 L195.6,418.6 L175.5,416.0 L156.1,412.2 L137.6,407.6 L120.0,402.8 L103.1,398.3 L86.6,394.4 L70.3,391.3 L53.9,388.9 L36.9,387.1 L19.4,385.5 L1.2,383.8 L-17.5,381.5 L-36.4,378.1 L-55.3,373.3 L-73.5,366.7 L-90.8,358.3 L-106.6,348.1 L-120.6,336.2 L-132.6,322.8 L-142.7,308.3 L-150.8,293.0 L-157.1,277.1 L-161.9,261.0 L-165.6,244.7 L-168.2,228.5 L-170.1,212.3 L-171.2,196.2 L-171.6,180.0 L-171.1,163.9 L-169.5,147.7 L-166.6,131.8 L-162.0,116.1 L-155.6,100.8 L-147.4,86.3 L-137.2,72.7 L-125.5,60.1 L-112.3,48.7 L-98.0,38.4 L-83.2,29.2 L-68.1,20.8 L-53.1,13.0 L-38.4,5.3 L-24.1,-2.5 L-10.1,-10.7 L3.7,-19.5 L17.7,-28.9 L32.2,-38.8 L47.5,-48.9 L63.9,-58.7 L81.5,-67.7 L100.2,-75.4 L120.0,-81.2 L140.5,-84.6 L161.3,-85.4 L181.9,-83.4 L201.9,-78.6 L220.8,-71.2 L238.3,-61.6 L254.2,-50.3 L268.5,-37.7 L281.4,-24.3 L293.0,-10.7 L303.6,2.8 L313.7,16.1 L323.5,29.0 L333.2,41.6 L343.0,53.9 L352.7,66.3 L362.2,78.9 L371.3,91.9 L379.7,105.4 L387.0,119.5 L392.8,134.1 L397.0,149.1 L399.6,164.5Z"/><path d="M438.5,180.0 L440.2,197.8 L439.4,215.6 L436.3,233.2 L431.3,250.6 L424.5,267.5 L416.4,283.9 L407.3,299.9 L397.3,315.5 L386.7,330.8 L375.2,345.7 L363.0,360.3 L349.7,374.4 L335.2,387.7 L319.5,400.0 L302.3,410.9 L283.8,420.0 L264.1,427.2 L243.5,432.2 L222.3,435.0 L200.9,435.6 L179.8,434.3 L159.1,431.4 L139.2,427.6 L120.0,423.2 L101.5,418.7 L83.5,414.7 L65.6,411.3 L47.6,408.7 L29.0,406.7 L9.7,405.2 L-10.4,403.8 L-31.4,401.9 L-52.9,399.0 L-74.6,394.6 L-95.9,388.3 L-116.2,379.8 L-134.8,369.1 L-151.3,356.2 L-165.2,341.2 L-176.2,324.7 L-184.3,307.0 L-189.6,288.5 L-192.5,269.8 L-193.3,251.0 L-192.6,232.6 L-190.8,214.6 L-188.3,197.1 L-185.5,180.0 L-182.5,163.2 L-179.3,146.7 L-175.7,130.2 L-171.5,113.9 L-166.4,97.7 L-160.1,81.8 L-152.4,66.4 L-143.1,51.5 L-132.2,37.4 L-119.8,24.3 L-106.2,12.2 L-91.5,1.0 L-76.2,-9.3 L-60.4,-18.9 L-44.4,-28.2 L-28.2,-37.2 L-11.9,-46.3 L4.7,-55.6 L21.7,-65.0 L39.4,-74.4 L58.0,-83.6 L77.7,-92.0 L98.4,-99.3 L120.0,-104.8 L142.3,-108.1 L164.9,-108.8 L187.4,-106.6 L209.1,-101.4 L229.6,-93.3 L248.5,-82.6 L265.6,-69.8 L280.6,-55.4 L293.8,-40.0 L305.3,-24.3 L315.5,-8.7 L325.1,6.5 L334.3,21.0 L343.7,34.7 L353.6,47.9 L364.2,60.7 L375.3,73.5 L386.9,86.5 L398.4,100.0 L409.4,114.4 L419.4,129.6 L427.9,145.7 L434.3,162.6Z"/><path d="M477.0,180.0 L480.8,200.0 L481.3,220.2 L478.3,240.3 L472.1,259.8 L463.0,278.5 L451.5,296.2 L438.2,312.8 L423.7,328.3 L408.2,343.0 L392.3,356.8 L376.1,370.0 L359.6,382.7 L342.7,394.9 L325.3,406.4 L307.4,417.3 L288.6,427.1 L269.0,435.7 L248.6,442.7 L227.5,448.1 L206.0,451.6 L184.2,453.2 L162.5,453.1 L141.0,451.6 L120.0,449.0 L99.4,445.8 L79.2,442.2 L59.2,438.7 L39.1,435.5 L18.6,432.7 L-2.4,430.1 L-24.2,427.4 L-46.8,424.4 L-69.9,420.5 L-93.3,415.2 L-116.4,408.0 L-138.5,398.7 L-159.0,387.1 L-177.2,373.0 L-192.5,356.7 L-204.4,338.5 L-212.8,318.9 L-217.7,298.4 L-219.3,277.5 L-218.2,256.7 L-214.9,236.4 L-210.2,216.8 L-204.7,198.0 L-199.0,180.0 L-193.7,162.6 L-188.9,145.6 L-184.7,128.7 L-180.9,111.8 L-177.2,94.6 L-173.0,77.3 L-168.1,59.8 L-161.8,42.3 L-153.8,25.2 L-144.0,8.6 L-132.2,-7.1 L-118.5,-21.8 L-103.0,-35.2 L-86.2,-47.4 L-68.2,-58.3 L-49.4,-68.3 L-30.0,-77.3 L-10.1,-85.7 L10.2,-93.6 L31.0,-101.0 L52.3,-107.8 L74.3,-114.0 L96.8,-119.2 L120.0,-123.0 L143.6,-125.0 L167.4,-124.9 L191.1,-122.3 L214.0,-117.0 L235.9,-109.0 L256.3,-98.4 L274.8,-85.6 L291.2,-71.0 L305.7,-55.1 L318.3,-38.6 L329.4,-22.0 L339.5,-5.7 L349.2,9.9 L359.1,24.8 L369.6,38.9 L381.0,52.5 L393.5,65.9 L406.8,79.5 L420.8,93.6 L434.8,108.6 L448.1,124.8 L460.1,142.1 L469.9,160.6Z"/></g></svg>`;

/* ============================================================
   VISUAL PHASE 4 — 生きた背景（app.js へ追記するブロック）
   OFFスイッチ: D_LIVE=false にすると markup も class も出ない。
   ============================================================ */

const D_LIVE = true;
const D_EASE = "cubic-bezier(.22,.61,.36,1)";
const D_MOTION = true;
const D_RM = !D_MOTION;
document.documentElement.dataset.motion = D_MOTION ? "on" : "off";

/* ---- 1. 時刻の判定は「1か所」だけ ---------------------------
   既存 greetingByHour() の境界（4 / 11 / 18）をそのまま使い、
   「こんばんは」の帯だけ 18-22 / 22-4 に割って夕と夜を作る。
   → 挨拶の文言は全24時間で現行と1文字も変わらない（§7-9 に検証結果）。 */
function timeOfDay(hour = new Date().getHours()) {
  if (hour < 4) return "night";
  if (hour < 11) return "morning";
  if (hour < 18) return "day";
  if (hour < 22) return "evening";
  return "night";
}

/* 置き換え後の greetingByHour（返り値は現行と完全一致） */
function greetingByHour() {
  const t = timeOfDay();
  if (t === "morning") return "おはようございます";
  if (t === "day") return "こんにちは";
  return "こんばんは";            // evening / night
}

/* ---- 2. 背景の土台を1回だけ作る ------------------------------ */
let dAtmoReady = false;
function mountDLive() {
  if (!D_LIVE || dAtmoReady) return;
  dAtmoReady = true;
  document.body.classList.add("d-live");
  document.body.classList.add("tod-" + timeOfDay());
  const atmo = document.createElement("div");
  atmo.className = "d-atmo";
  atmo.setAttribute("aria-hidden", "true");
  atmo.innerHTML = `<div class="lyr" data-p=".06"><div class="cstat">${D_CONTOUR_SVG}</div></div>`;
  document.body.appendChild(atmo);
  if (!D_RM) bindDParallax();
  setInterval(() => {              /* 日をまたいでも空が追随する */
    const t = "tod-" + timeOfDay();
    if (!document.body.classList.contains(t)) {
      document.body.className = document.body.className.replace(/tod-\w+/, t);
    }
  }, 600000);
}

/* ---- 3. 視差：コンテンツと同方向・より遅く --------------------
   固定層(.d-atmo .lyr) は内容が上へ y 動くあいだ 0。層を -y*p で「同方向・遅く」。
   窓(.land .ll) は内容と一緒に上へ y 動く。+y*k を足して「同方向・遅く」。
   どちらも符号が逆に見えるが、基準が固定か流れるかの違いで意味は同じ。 */
function bindDParallax() {
  let ticking = false, idle = null;
  window.addEventListener("scroll", () => {
    document.body.classList.add("scrolling");
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.remove("scrolling"), 220);
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      document.querySelectorAll(".d-atmo .lyr").forEach((l) => {
        l.style.transform = `translate3d(0,${(-y * parseFloat(l.dataset.p || 0)).toFixed(1)}px,0)`;
      });
      document.querySelectorAll(".land:not(.fixed) .ll").forEach((l) => {
        l.style.transform = `translate3d(0,${(y * parseFloat(l.dataset.k || 0)).toFixed(1)}px,0)`;
      });
      ticking = false;
    });
  }, { passive: true });
}

/* ---- 4. 窓のマークアップ（全画面で同一。差は variant クラスだけ）-- */
function renderLand(variant = "") {
  if (!D_LIVE) return "";
  return `
    <div class="land${variant ? " " + variant : ""}" aria-hidden="true">
      <div class="ll far" data-k=".18">
        <svg viewBox="0 0 420 200" preserveAspectRatio="none"><path d="M0,200 L0,118 C28,110 58,86 94,90 C120,93 138,54 168,44 C188,38 204,60 226,54 C258,46 282,10 308,20 C332,30 352,64 384,56 C400,52 410,50 420,58 L420,200 Z"/></svg>
        <div class="glint"></div>
      </div>
      <div class="ll mid" data-k=".10">
        <svg viewBox="0 0 420 200" preserveAspectRatio="none"><path d="M0,200 L0,144 C34,134 70,114 110,118 C140,121 164,90 198,82 C224,76 246,104 276,98 C302,93 322,70 352,78 C382,86 402,108 420,102 L420,200 Z"/></svg>
        <div class="mist"></div>
      </div>
      <div class="ll near" data-k=".04">
        <svg viewBox="0 0 420 200" preserveAspectRatio="none">
          <path d="M0,200 L0,170 C40,162 80,154 118,146 C150,139 175,114 196,94 L214,76 L226,90 C244,114 270,134 300,144 C340,158 380,164 420,160 L420,200 Z"/>
          <path class="crest" d="M196,94 L214,76 L226,90" fill="none" stroke="url(#crestGrad)" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
  `;
}

/* ---- 5. 稜線の帯（ホームの進捗パネル内）---------------------- */
function renderRidgeBand() {
  if (!D_LIVE) return "";
  return `
    <svg class="ridge-band" viewBox="0 0 340 56" preserveAspectRatio="none" aria-hidden="true">
      <path class="fill" d="M0,56 L0,52 C60,51 120,49 180,44 C220,40 250,34 280,24 C300,16 322,8 340,4 L340,56 Z"/>
      <path class="rim2" d="M0,52 C60,51 120,49 180,44 C220,40 250,34 280,24 C300,16 322,8 340,4"/>
      <path class="rim" pathLength="100" d="M0,52 C60,51 120,49 180,44 C220,40 250,34 280,24 C300,16 322,8 340,4"/>
      <g class="head-g"><circle class="head" r="2.8" cx="0" cy="0"/></g>
    </svg>
  `;
}

/* ---- 6. 稜線の光：頭は経路上を歩く（cx/cy は使わない：Firefox）-- */
function ridgeHeadKeyframes(rim, fromPct, toPct) {
  const L = rim.getTotalLength(), kf = [], n = 14;
  for (let i = 0; i <= n; i++) {
    const p = rim.getPointAtLength(L * (fromPct + (toPct - fromPct) * i / n) / 100);
    kf.push({ transform: `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)` });
  }
  return kf;
}
function setRidgeHead(pct) {
  const rim = document.querySelector(".ridge-band .rim");
  const g = document.querySelector(".ridge-band .head-g");
  if (!rim || !g) return;
  const p = rim.getPointAtLength(rim.getTotalLength() * pct / 100);
  g.style.transform = `translate(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px)`;
  g.classList.toggle("hide", pct <= 0);
}

/* 読込時：リング／数字は既存 tween() が担当。稜線と頭だけ同じ所作に合わせる */
let ridgePctShown = null;
function playRidge(pct, fromPct = 0) {
  const rim = document.querySelector(".ridge-band .rim");
  const g = document.querySelector(".ridge-band .head-g");
  if (!rim) return;
  ridgePctShown = pct;
  const to = String(100 - pct);
  if (D_RM) {
    rim.style.transition = "";
    rim.style.strokeDashoffset = to;
    setRidgeHead(pct);
    return;
  }
  rim.style.transition = "none";
  setTimeout(() => { rim.style.transition = ""; }, 900);
  rim.style.strokeDashoffset = to;
  setRidgeHead(pct);
  rim.animate([{ strokeDashoffset: String(100 - fromPct) }, { strokeDashoffset: to }],
    { duration: 620, delay: 180, easing: D_EASE, fill: "backwards" });
  if (g && pct > 0) {
    g.animate(ridgeHeadKeyframes(rim, fromPct, pct),
      { duration: 620, delay: 180, easing: D_EASE, fill: "backwards" });
  }
}

/* 進捗が変わったとき：リング・数字（既存 tween）と同時・同イージング */
function setRidgeProgress(pct) {
  const rim = document.querySelector(".ridge-band .rim");
  const g = document.querySelector(".ridge-band .head-g");
  if (!rim) return;
  if (D_RM) rim.style.transition = "";
  const prev = ridgePctShown == null ? pct : ridgePctShown;
  ridgePctShown = pct;
  rim.style.strokeDashoffset = String(100 - pct);
  if (!g) return;
  if (D_RM) { setRidgeHead(pct); return; }
  g.classList.remove("hide");
  const a = g.animate(ridgeHeadKeyframes(rim, prev, pct),
    { duration: 900, easing: D_EASE, fill: "forwards" });
  a.onfinish = () => { a.cancel(); setRidgeHead(pct); };
}

/* ============================================================
   ホーム（#/home）＝計器盤
   ============================================================ */

function renderHome() {
  const learning = state.learning;
  if (!learning) {
    renderLoading();
    return;
  }

  const summary = learning.progressSummary;
  const percent = Math.max(0, Math.min(100, Number(summary.percent) || 0));
  const name = String(learning.user.nickname || learning.user.display_name || "受講者").replace(/(さん|様)\s*$/, "");
  const lesson = learning.currentLesson;
  const cta = lesson ? getLessonCta(lesson) : null;
  const dir = enterDirection("home");

  const growth = pendingGrowth;
  pendingGrowth = null;
  const startPct = growth ? growth.from : (homeRingShown ? percent : 0);
  const passCount = summary.miniDone + summary.workDone;
  const passTotal = summary.miniTotal + summary.workTotal;

  app.innerHTML = `
    <div class="stage" data-enter="${dir}">
      ${renderHomeTop(learning)}
      ${renderTabbar("home")}
      <main>
        <p class="greet">${escapeHtml(greetingByHour())}、<b>${escapeHtml(name)}さん</b>。今日も一段、登りましょう。</p>

        <section class="gauge-card rise" aria-label="全体の進捗">
          <div class="ring-wrap">
            ${svgElevationRing(startPct)}
            <div class="ring-center">
              <b><span id="homePct">${Math.round(startPct)}</span><small>%</small></b>
              <span>全行程</span>
            </div>
          </div>
          <div class="gauge-stats">
            <div class="gs"><b>${summary.doneSteps}<em> /${summary.totalSteps}</em></b><small>クリアステップ</small></div>
            <div class="gs"><b>${summary.videoDone}<em> /${summary.videoTotal}</em></b><small>視聴した動画</small></div>
            <div class="gs hot"><b>${passCount}<em> /${passTotal}</em></b><small>クリアしたワーク</small></div>
          </div>
          ${renderRidgeBand()}
        </section>

        ${renderLand("h")}

        ${cta ? `
          <section class="today2 rise rise-1" aria-label="今日の一歩">
            <p class="t2-k">今日の一歩</p>
            <h2>${escapeHtml(lesson.lesson_title)}</h2>
            <p class="t2-sub">${escapeHtml(cta.summary)}</p>
            <a class="t2-btn" href="${escapeAttribute(cta.href)}">${escapeHtml(cta.label)} →</a>
          </section>
        ` : `
          <section class="today2 rise rise-1" aria-label="今日の一歩">
            <p class="t2-k">今日の一歩</p>
            <h2>すべての行程を登りきりました</h2>
            <p class="t2-sub">ここまでの歩みは、あなたの確かな土台です。復習やワークの振り返りにいつでも戻れます。</p>
            <a class="t2-btn" href="#/learning">学習をふり返る →</a>
          </section>
        `}

        ${renderClearedWorksSection(learning.clearedWorks || [])}

        <section class="ch-list rise rise-2" aria-label="章の一覧">
          <p class="ch-h">CHAPTERS</p>
          ${learning.phases
            .slice()
            .sort((a, b) => (a.phase_order || 0) - (b.phase_order || 0))
            .map((phase) => renderChapterRow(learning, phase))
            .join("")}
        </section>

        <div class="page-foot">
          <a class="text-link" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
        </div>
      </main>
    </div>
  `;

  requestAnimationFrame(() => {
    if (growth) {
      homeRingShown = true;
      setTimeout(() => {
        tween({
          from: growth.from, to: growth.to, duration: 1100, ease: easePower2Out,
          onUpdate: (v) => setHomeRing(v)
        });
        setRidgeProgress(growth.to);          // リング・数字と同時に、同じ長さで動く
        showToast(`標高が上がりました <span class="g">${growth.from}% → ${growth.to}%</span>`);
      }, 450);
      playRidge(growth.from, growth.from);    // 変化前の位置で静かに置いておく
    } else if (!homeRingShown) {
      homeRingShown = true;
      tween({
        from: 0, to: percent, duration: 1300, delay: 250, ease: easePower2Out,
        onUpdate: (v) => setHomeRing(v)
      });
      playRidge(percent, 0);                  // 0 → 現在値。リングと同じ所作
    } else {
      setHomeRing(percent);
      playRidge(percent, percent);            // 再訪時は再生しない（値だけ置く）
    }
  });
}

function renderClearedWorksSection(clearedWorks = []) {
  const cards = clearedWorks.map((work) => renderClearedWorkCard(work)).join("");
  return `
    <section class="cleared-works rise rise-2" aria-labelledby="cleared-works-title">
      <div class="sec-h-row">
        <h2 class="sec-h" id="cleared-works-title">クリア済みワーク</h2>
        ${clearedWorks.length ? `<span class="sec-count">${clearedWorks.length}件</span>` : ""}
      </div>
      ${cards || `<p class="empty-note">クリア済みワークはまだありません</p>`}
    </section>
  `;
}

function renderClearedWorkCard(work = {}) {
  const phaseLabel = work.phase_id === "FINAL" ? "最終まとめ" : `フェーズ${String(work.phase_id || "").replace(/^P/, "")}`;
  const typeLabel = work.target_type === "mini_work" ? "ミニワーク" : "ワーク";
  const hasScore = work.score !== null && work.score !== undefined && String(work.score).trim() !== "";
  const score = hasScore && Number.isFinite(Number(work.score)) ? Number(work.score) : null;
  const question = Array.isArray(work.question)
    ? `<ol>${work.question.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
    : `<p class="cleared-work-text">${escapeHtml(work.question || "")}</p>`;
  const href = getClearedWorkHref(work);
  return `
    <details class="cleared-work-card" data-cleared-work-id="${escapeAttribute(work.target_id || "")}">
      <summary>
        <span class="cleared-work-meta">${escapeHtml(phaseLabel)} ・ ${escapeHtml(typeLabel)}</span>
        <strong>${escapeHtml(work.title || work.target_id || "ワーク")}</strong>
        <span class="cleared-work-result">${score === null ? "完了" : `${score}点`} ・ ${work.target_type === "mini_work" ? "合格" : "完了"}</span>
      </summary>
      <div class="cleared-work-body">
        ${work.question && (Array.isArray(work.question) ? work.question.length : String(work.question).trim()) ? `<section><h3>設問</h3>${question}</section>` : ""}
        <section><h3>自分の回答</h3><p class="cleared-work-text">${escapeHtml(work.answer_text || "")}</p></section>
        <dl class="cleared-work-judgement">
          ${score === null ? "" : `<div><dt>点数</dt><dd>${score}点</dd></div>`}
          <div><dt>判定</dt><dd>${work.target_type === "mini_work" ? "合格" : "完了"}</dd></div>
          ${work.submitted_at ? `<div><dt>提出</dt><dd>${escapeHtml(formatDate(work.submitted_at))}</dd></div>` : ""}
        </dl>
        ${renderClearedWorkFeedback(work.evaluation || {}, work.target_type)}
        <a class="cleared-work-link" data-cleared-work-link href="${escapeAttribute(href)}">このワークを開く <span aria-hidden="true">→</span></a>
      </div>
    </details>
  `;
}

function getClearedWorkHref(work = {}) {
  if (work.target_type === "mini_work") {
    const fallbackLessonId = String(work.target_id || "").replace(/^MW-/, "");
    const lessonId = String(work.lesson_id || fallbackLessonId).trim();
    return hashForLesson(lessonId, "mini-work");
  }
  return hashForWork(work.target_id || work.work_id || "");
}

function renderClearedWorkFeedback(evaluation = {}, targetType = "") {
  const feedback = evaluation.feedback && typeof evaluation.feedback === "object" ? evaluation.feedback : {};
  const goodPoints = uniqueLearnerItems(evaluation.good_points || evaluation.goodPoints || feedback.goodPoints || evaluation.good_materials || []);
  const missingPoints = uniqueLearnerItems(evaluation.missing_points || evaluation.missingPoints || feedback.missingPoints || []);
  const rewritePoints = uniqueLearnerItems(evaluation.rewrite_points || evaluation.rewritePoints || feedback.rewritePoints || []);
  const growthPoints = uniqueLearnerItems(evaluation.growth_points || evaluation.growthPoints || feedback.growthPoints || []);
  const improvementPoints = uniqueLearnerItems(evaluation.improvement_points || evaluation.improvementPoints || feedback.improvementPoints || []);
  const summary = String(feedback.summary || evaluation.reason || evaluation.summary || "").trim();
  const isV2 = targetType === "mini_work" && hasMiniWorkV2Feedback(evaluation);
  if (isV2) {
    const sections = [
      ["良かった材料", goodPoints],
      ["改善余地", missingPoints],
      ["改善のヒント", rewritePoints],
      ["次の成長ポイント", growthPoints]
    ].filter(([, items]) => items.length);
    return `
      <section class="cleared-work-feedback" aria-label="フィードバック">
        <h3>フィードバック</h3>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
        ${sections.map(([heading, items]) => `<div><h4>${heading}</h4><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`).join("")}
      </section>
    `;
  }

  const fallbackGoodPoints = goodPoints.length ? goodPoints : ["回答を出して、考える材料を言葉にできています。"];
  return `
    <section class="cleared-work-feedback" aria-label="フィードバック">
      <h3>フィードバック</h3>
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
      <div><h4>良い点</h4><ul>${fallbackGoodPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      ${improvementPoints.length ? `<div><h4>改善ポイント</h4><ul>${improvementPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
    </section>
  `;
}

function chapterState(learning, phase) {
  if (!phase.isAccessible) return "locked";
  const done = Number(phase.completedCount || 0);
  const total = Number(phase.lessonCount || 0);
  if (total > 0 && done >= total) return "done";
  if (phase.phase_id === learning.currentPhase?.phase_id) return "current";
  if (done > 0) return "current";
  return "open";
}

function chapterTargetLesson(learning, phase) {
  if (learning.currentLesson && phase.lessons.some((item) => item.lesson_id === learning.currentLesson.lesson_id)) {
    return learning.currentLesson;
  }
  return phase.lessons.find((item) => !item.isComplete) || phase.lessons[0] || null;
}

function renderChapterRow(learning, phase) {
  const stateName = chapterState(learning, phase);
  const done = Number(phase.completedCount || 0);
  const total = Number(phase.lessonCount || 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const no = phaseNumberLabel(phase);

  let stateMarkup = `<span class="ch-state">これから</span>`;
  if (stateName === "done") stateMarkup = `<span class="ch-state done">★ クリア</span>`;
  if (stateName === "current") stateMarkup = `<span class="ch-state here"><span class="here-dot" aria-hidden="true"></span>いまここ</span>`;
  if (stateName === "locked") stateMarkup = `<span class="ch-state lock">🔒 解放待ち</span>`;

  const inner = `
    <b>${no ? `<span class="no">${no}</span>` : ""}${escapeHtml(phase.phase_title)}</b>
    ${stateMarkup}
    <div class="ch-mini"><div class="mbar"><span style="width:${pct}%"></span></div><em>${done}/${total}</em></div>
  `;

  if (stateName === "locked") {
    return `
      <div>
        <button class="ch-row is-locked" type="button" disabled aria-disabled="true" aria-label="${escapeAttribute(phase.phase_title)}（解放待ち）">${inner}</button>
        ${phase.gateMessage ? `<p class="phase-locked-note">${escapeHtml(phase.gateMessage)}</p>` : ""}
      </div>
    `;
  }

  const target = chapterTargetLesson(learning, phase);
  const href = target ? hashForLesson(target.lesson_id) : "#/learning";
  return `<a class="ch-row" href="${escapeAttribute(href)}">${inner}</a>`;
}

/* ============================================================
   学習一覧（#/learning）
   ============================================================ */

/* ---- C-2 ルートライン（v2.2 修正）---------------------------- */

/* 節点の中心は border 込みで実測。各節点の担当区間を中点で分ける。 */
function layoutRouteSegments(route) {
  if (!D_LIVE || !document.body.classList.contains("d-live")) return;
  const rail = route.querySelector(":scope > .route-rail");
  const rows = [...route.querySelectorAll(":scope > .ls-row")];
  if (!rail) return;
  const rr = route.getBoundingClientRect();
  const routeStyle = getComputedStyle(route);
  const scale = rr.width / parseFloat(routeStyle.width) || 1;
  const railStyle = getComputedStyle(rail);
  const top = parseFloat(railStyle.top);
  const end = Math.max(top, parseFloat(routeStyle.height) - parseFloat(railStyle.bottom));
  const centers = rows.map((row) => {
    const box = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const dot = getComputedStyle(row, "::before");
    return (box.top - rr.top) / scale + parseFloat(style.borderTopWidth)
      + parseFloat(dot.top) + parseFloat(dot.height) / 2;
  });
  /* 共通の境界を1/64px単位へ揃え、隣接区間の丸め方による隙間を防ぐ。 */
  const edges = [top, ...centers.slice(1).map((center, i) => (centers[i] + center) / 2), end]
    .map((value) => Math.round(value * 64) / 64);
  const segments = rows.map((row, i) => {
    const start = edges[i];
    const stop = edges[i + 1];
    const segment = document.createElement("span");
    segment.className = "route-segment";
    segment.dataset.state = row.dataset.state;
    segment.style.top = Math.max(0, start - top) + "px";
    segment.style.height = Math.max(0, Math.min(end, stop) - Math.max(top, start)) + "px";
    return segment;
  });
  rail.replaceChildren(...segments);
  const currentIndex = rows.findIndex((row) => row.classList.contains("is-current"));
  if (currentIndex >= 0) {
    route.style.setProperty("--trail", Math.max(0, centers[currentIndex] - top) + "px");
  }
}

/* 光は現在地の章で1回だけ。色は全章で更新し、文字折返しにも追従する。 */
let routeSparkShown = false;
let routeResizeObserver = null;
function playRouteSpark() {
  if (!D_LIVE || !document.body.classList.contains("d-live")) return;
  const routes = [...document.querySelectorAll(".route")];
  routes.forEach(layoutRouteSegments);
  if (typeof ResizeObserver !== "undefined") {
    if (!routeResizeObserver) routeResizeObserver = new ResizeObserver((entries) => {
      const changed = new Set(entries.map((entry) => entry.target.closest(".route")));
      changed.forEach((route) => { if (route?.isConnected) layoutRouteSegments(route); });
    });
    routeResizeObserver.disconnect();
    routes.forEach((route) => {
      routeResizeObserver.observe(route);
      route.querySelectorAll(":scope > .ls-row").forEach((row) => routeResizeObserver.observe(row));
    });
  }
  const route = document.querySelector(".route .ls-row.is-current")?.closest(".route");
  if (!route) return;
  const spark = route.querySelector(":scope > .spark");
  if (!spark || D_RM || routeSparkShown) return;
  routeSparkShown = true;
  route.classList.add("route-play");
}

function renderLearningPage() {
  const learning = state.learning;
  if (!learning) {
    renderLoading();
    return;
  }

  const dir = enterDirection("learning");
  const phases = learning.phases
    .slice()
    .sort((a, b) => (a.phase_order || 0) - (b.phase_order || 0));

  app.innerHTML = `
    <div class="stage" data-enter="${dir}">
      ${renderHomeTop(learning)}
      ${renderTabbar("learning")}
      <main>
        <p class="page-kicker">ROUTE</p>
        <h1 class="page-title">登頂ルート</h1>
        <p class="page-lead">動画を見て、ミニワークで言葉にする。その一歩ずつが、次の章への道になります。</p>
        ${renderLand("r")}
        ${phases.map((phase, index) => renderPhaseGroup(learning, phase, index)).join("")}
        <div class="page-foot">
          <a class="text-link" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
        </div>
      </main>
    </div>
  `;

  app.querySelectorAll(".route").forEach((route) => {
    route.closest(".stage")?.classList.add("d-route-static");
    route.closest(".phase-group")?.classList.add("d-route-static");
  });

  requestAnimationFrame(() => scrollToPageTop());
  requestAnimationFrame(() => playRouteSpark());
}

function renderPhaseGroup(learning, phase, index) {
  const stateName = chapterState(learning, phase);
  const done = Number(phase.completedCount || 0);
  const total = Number(phase.lessonCount || 0);
  const no = phaseNumberLabel(phase);
  const riseClass = index < 4 ? ` rise rise-${index}` : "";

  if (stateName === "locked") {
    return `
      <section class="phase-group${riseClass}" aria-label="${escapeAttribute(phase.phase_title)}（解放待ち）">
        <div class="phase-head">
          <span class="ph-title">${no ? `<span class="no">${no}</span>` : ""}${escapeHtml(phase.phase_title)}</span>
          <span class="ph-count">🔒 解放待ち</span>
        </div>
        <p class="phase-locked-note">${escapeHtml(phase.gateMessage || phase.phase_summary || "前の章を登りきると、この章の景色がひらけます。")}</p>
      </section>
    `;
  }

  return `
    <section class="phase-group${riseClass}" aria-label="${escapeAttribute(phase.phase_title)}">
      <div class="phase-head">
        <span class="ph-title">${no ? `<span class="no">${no}</span>` : ""}${escapeHtml(phase.phase_title)}</span>
        <span class="ph-count${stateName === "done" ? " done" : ""}">${stateName === "done" ? "★ クリア " : ""}${done}/${total}</span>
      </div>
      ${phase.lessons.length ? `
        <div class="route">
          <span class="route-rail" aria-hidden="true"></span>
          <span class="spark" aria-hidden="true"></span>
          ${phase.lessons.map((lesson) => renderLessonRow(learning, phase, lesson)).join("")}
        </div>
      ` : `<p class="phase-locked-note">この章の教材は順次ひらいていきます。</p>`}
    </section>
  `;
}

function stationState(learning, phase, lesson) {
  if (!phase.isAccessible) return "locked";
  if (lesson.isComplete) return "complete";
  if (learning.currentLesson?.lesson_id === lesson.lesson_id) return "current";
  if ([lesson.progress.video_status, lesson.progress.mini_work_status, lesson.progress.work_status]
    .some((status) => ["watched", "submitted", "reviewing", "needs_more", "support_needed", "unlocked"].includes(status))) {
    return "progress";
  }
  return "not-started";
}

function stationSubText(lesson) {
  const duration = lesson.estimated_duration || "約10分";
  const pieces = [`動画 ${duration}`];
  if (lesson.miniWork) pieces.push("ミニワーク");
  if (lesson.work) pieces.push("本ワーク");
  return pieces.join(" ・ ");
}

function rowEntryStyle(index) {
  const enabled = Number.isInteger(index) && index >= 0 && index < 6;
  const delay = enabled ? 180 + index * 40 : 0;
  return `--d:${delay}ms;--row-entry:${enabled ? "dRowEnter" : "none"};`;
}

function lessonEntryStyle(learning, lesson) {
  const lessons = learning.phases
    .filter((phase) => phase.isAccessible)
    .flatMap((phase) => phase.lessons);
  return rowEntryStyle(lessons.findIndex((item) => item.lesson_id === lesson.lesson_id));
}

function renderLessonRow(learning, phase, lesson) {
  const stateName = stationState(learning, phase, lesson);
  const cta = getLearningLessonCta(lesson);

  let stateMarkup = `<span class="ls-state">これから</span>`;
  if (stateName === "complete") stateMarkup = `<span class="ls-state done">★ クリア</span>`;
  if (stateName === "current") stateMarkup = `<span class="ls-state here"><span class="here-dot" aria-hidden="true"></span>いまここ</span>`;
  if (stateName === "progress") stateMarkup = `<span class="ls-state watched">進行中</span>`;
  if (stateName === "locked") stateMarkup = `<span class="ls-state lock">🔒 解放待ち</span>`;

  let ctaMarkup = "";
  if (stateName === "complete") ctaMarkup = `<span class="ls-cta ls-cta--calm">ふり返る</span>`;
  if (stateName === "current") ctaMarkup = `<span class="ls-cta">${escapeHtml(cta.label)}</span>`;
  if (stateName === "progress") ctaMarkup = `<span class="ls-cta">つづきへ</span>`;
  if (stateName === "not-started") ctaMarkup = `<span class="ls-cta ls-cta--calm">ひらく</span>`;

  const inner = `
    <span class="ls-id">${escapeHtml(getLessonDisplayNumber(lesson.lesson_id))}</span>
    <div class="ls-side">
      ${stateMarkup}
      ${ctaMarkup}
    </div>
    <h4>${escapeHtml(lesson.lesson_title)}</h4>
    <p class="ls-sub">${escapeHtml(stationSubText(lesson))}${stateName === "locked" ? " ・ 前の教材をクリアするとひらきます" : ""}</p>
  `;

  if (stateName === "locked") {
    return `<div class="ls-row is-locked" data-state="locked" style="${lessonEntryStyle(learning, lesson)}">${inner}</div>`;
  }
  return `<a class="ls-row${stateName === "current" ? " is-current" : ""}" data-state="${stateName}" style="${lessonEntryStyle(learning, lesson)}" href="${escapeAttribute(cta.href)}">${inner}</a>`;
}

/* ============================================================
   レッスン（#/lesson/:id）
   ============================================================ */

function renderLesson(lessonId, section = "") {
  const learning = state.learning;
  const lessonContext = findLessonContext(learning, lessonId);
  const lesson = lessonContext?.lesson;
  const phase = lessonContext?.phase;

  if (!lesson) {
    renderHome();
    return;
  }

  const dir = enterDirection("lesson");

  app.innerHTML = `
    <div class="stage" data-enter="${dir}">
      ${renderBackTop("#/learning", "戻る", [phaseChapterLabel(phase), getLessonDisplayNumber(lesson.lesson_id)].filter(Boolean).join(" ・ "))}
      <main>
        <div class="lesson-title">
          <p class="lt-k">${isFinalPhase(phase) ? "最終まとめ" : `CHAPTER ${padChapter(phase?.phase_order)}`}</p>
          <h1>${escapeHtml(lesson.lesson_title)}</h1>
        </div>

        ${renderLand("t")}

        ${renderVideoBlock(lesson)}
        ${renderQuizBlock(lesson)}
        ${renderMiniWorkBlock(lesson)}
        ${renderWorkBlock(lesson)}
        ${renderLearningDetailBlock(lesson)}
        ${renderLessonBottomNav(learning, lesson)}
      </main>
    </div>
  `;

  requestAnimationFrame(() => focusLessonSection(section));
}

function renderVideoBlock(lesson) {
  const hasVideo = Boolean(lesson.video_url);
  const isWatched = lesson.progress.video_status === "watched";
  const duration = lesson.estimated_duration || "約10分";
  const videoMarkup = hasVideo
    ? `<iframe src="${escapeAttribute(toEmbedUrl(lesson.video_url))}" title="${escapeAttribute(lesson.lesson_title)}" allowfullscreen></iframe>`
    : `<div class="video-placeholder"><span>▶</span><strong>このレッスンの動画</strong></div>`;

  return `
    <section id="section-video" data-section="video" tabindex="-1" aria-label="動画">
      <div class="video2">${videoMarkup}</div>
      ${isWatched ? `<p class="watch-note"><i>✓</i> 視聴済み ・ 目安 ${escapeHtml(duration)}</p>` : ""}
      <button class="primary-button watch-button" type="button" data-action="toggle-video-completion" data-lesson-id="${escapeHtml(lesson.lesson_id)}" data-completed="${isWatched ? "true" : "false"}" aria-pressed="${isWatched ? "true" : "false"}">
        ${isWatched ? "視聴完了を取り消す" : "動画を見たら視聴完了にする"}
      </button>
      ${isWatched ? "" : `<p class="submission-note">目安 ${escapeHtml(duration)}</p>`}
    </section>
  `;
}

function renderMiniWorkBlock(lesson) {
  if (!lesson.miniWork) return "";
  if (lesson.quiz && !lesson.quizState?.passed) {
    return `
      <section id="section-mini-work" class="mini-panel is-locked" data-section="mini-work" tabindex="-1" aria-labelledby="mini-work-title">
        <p class="mp-k">MINI WORK ${renderStatusBadge("locked")}</p>
        <h3 id="mini-work-title">${escapeHtml(lesson.miniWork.title)}</h3>
        <div class="mp-callout"><span>先に理解度を確認</span>動画後の○×テストで5問中4問以上正解すると、回答欄がひらきます。</div>
      </section>
    `;
  }
  const submission = lesson.latestMiniSubmission;
  const value = submission?.answer_text || "";
  const placeholder = getMiniWorkPlaceholder(lesson.miniWork);
  const submitLabel = submission ? "もう一度確認してもらう" : "AIに確認してもらう";

  return `
    <section id="section-mini-work" class="mini-panel" data-section="mini-work" tabindex="-1" aria-labelledby="mini-work-title">
      <p class="mp-k">MINI WORK ${renderStatusBadge(lesson.progress.mini_work_status)}</p>
      <h3 id="mini-work-title">${escapeHtml(lesson.miniWork.title)}</h3>
      <p class="mp-hint">${escapeHtml(lesson.miniWork.prompt)}</p>
      <p class="mp-hint">${escapeHtml(lesson.miniWork.helper_text || "いつ・どこで・何をするかを、1つに絞って書くと評価されやすくなります。")}</p>
      <form class="work-form" data-form="mini-work" data-target-id="${escapeHtml(lesson.miniWork.mini_work_id)}">
        <label class="field-label" for="mini-${escapeAttribute(lesson.miniWork.mini_work_id)}">回答</label>
        <textarea id="mini-${escapeAttribute(lesson.miniWork.mini_work_id)}" name="answer" rows="6" placeholder="${escapeAttribute(placeholder)}" required>${escapeHtml(value)}</textarea>
        <button class="submit2 work-submit-button" type="submit">${submitLabel}</button>
      </form>
      ${submission ? renderSubmissionNote(submission) : ""}
      ${lesson.latestMiniEvaluation ? renderEvaluationResultCard(lesson.latestMiniEvaluation, "ミニワーク") : ""}
    </section>
  `;
}

function renderQuizBlock(lesson) {
  const quiz = lesson.quiz;
  const quizState = lesson.quizState || {};
  if (!quiz) return "";
  if (!quizState.unlocked) {
    return `
      <section id="section-quiz" class="mini-panel quiz-panel is-locked" data-section="quiz" tabindex="-1" aria-labelledby="quiz-title">
        <p class="mp-k">CHECK TEST ${renderStatusBadge("locked")}</p>
        <h3 id="quiz-title">動画後の○×テスト</h3>
        <div class="mp-callout"><span>視聴後にひらきます</span>動画を見て視聴完了にすると、5問の理解度テストに進めます。</div>
      </section>
    `;
  }

  const attempt = quizState.latestAttempt || null;
  const result = attempt ? renderQuizAttemptResult(quiz, attempt, quizState.passed) : "";
  const form = renderQuizForm(quiz, Boolean(attempt));
  const legacyNotice = quizState.legacyExempt
    ? `<div class="mp-callout"><span>受講済み</span>このテスト導入前の学習進捗を保持しているため、次の学習へそのまま進めます。必要なら理解度確認として受験できます。</div>`
    : "";
  return `
    <section id="section-quiz" class="mini-panel quiz-panel" data-section="quiz" tabindex="-1" aria-labelledby="quiz-title">
      <p class="mp-k">CHECK TEST ${quizState.passed ? renderStatusBadge("good") : renderStatusBadge("not_submitted")}</p>
      <h3 id="quiz-title">動画後の○×テスト</h3>
      <p class="mp-hint">5問すべてに○か×で回答してください。4問以上正解でクリアです。</p>
      ${legacyNotice}
      ${result}
      ${attempt ? `<details class="quiz-retry"><summary>もう一度挑戦する</summary>${form}</details>` : form}
    </section>
  `;
}

function renderQuizForm(quiz, isRetry = false) {
  return `
    <form class="quiz-form" data-form="quiz" data-quiz-id="${escapeAttribute(quiz.quiz_id)}">
      <ol class="quiz-question-list">
        ${(quiz.questions || []).map((question, index) => `
          <li class="quiz-question" data-quiz-question="${escapeAttribute(question.question_id)}" style="${rowEntryStyle(index)}">
            <p><span>問${index + 1}</span>${escapeHtml(question.statement)}</p>
            <fieldset>
              <legend class="sr-only">問${index + 1}の回答</legend>
              <label><input type="radio" name="${escapeAttribute(question.question_id)}" value="circle" required> ○</label>
              <label><input type="radio" name="${escapeAttribute(question.question_id)}" value="cross" required> ×</label>
            </fieldset>
          </li>
        `).join("")}
      </ol>
      <button class="submit2 quiz-submit-button" type="submit" disabled aria-disabled="true">${isRetry ? "再採点する" : "5問を採点する"}</button>
    </form>
  `;
}

function renderQuizAttemptResult(quiz, attempt, hasStickyPass) {
  const answerMap = new Map((attempt.answers || []).map((item) => [item.question_id, item]));
  return `
    <div class="quiz-result" data-quiz-result="${attempt.passed ? "pass" : "retry"}" role="status">
      <div class="quiz-result-head">
        <strong>${attempt.correct_count} / ${attempt.total_count}問正解</strong>
        <span>${attempt.passed ? "クリア" : (hasStickyPass ? "クリア済み（今回の結果）" : "もう一度挑戦")}</span>
      </div>
      <ol class="quiz-explanation-list">
        ${(quiz.questions || []).map((question, index) => {
          const row = answerMap.get(question.question_id) || {};
          const answerLabel = row.answer === "circle" ? "○" : row.answer === "cross" ? "×" : "未回答";
          const correctLabel = question.correct_answer === "circle" ? "○" : "×";
          return `<li class="${row.is_correct ? "is-correct" : "is-wrong"}"><strong>問${index + 1}: あなたの回答 ${answerLabel}／正解 ${correctLabel}</strong><p>${escapeHtml(question.explanation)}</p></li>`;
        }).join("")}
      </ol>
    </div>
  `;
}

function getMiniWorkPlaceholder(miniWork = {}) {
  if (miniWork.answer_placeholder) return miniWork.answer_placeholder;
  if (miniWork.placeholder) return miniWork.placeholder;
  if (miniWork.learner_prompt_full) {
    return `${miniWork.learner_prompt_full.replace(/\s+/g, " ").slice(0, 90)}${miniWork.learner_prompt_full.length > 90 ? "…" : ""}`;
  }
  return "動画で学んだ考え方を、自分の実際の場面に置き換えて書いてください。";
}

function renderWorkBlock(lesson) {
  if (!lesson.work) return "";
  const questions = Array.isArray(lesson.work.questions) ? lesson.work.questions.filter(Boolean) : [];
  const aiStatus = lesson.aiWorkStatus || "not_started";
  const isUnlocked = lesson.canSubmitWork || lesson.progress.work_status === "good" || aiStatus === "completed";

  return `
    <section id="section-work" class="mini-panel" data-section="work" tabindex="-1" aria-labelledby="work-title">
      <p class="mp-k">WORK ${renderAiWorkStatusBadge(aiStatus)}</p>
      <h3 id="work-title">${escapeHtml(lesson.work.title)}</h3>
      <p class="mp-hint">${escapeHtml(lesson.work.entry_description || lesson.work.purpose)}</p>
      ${questions.length ? `<div class="mp-callout"><span>問い</span><ol style="padding-left:18px;">${questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div>` : ""}
      ${isUnlocked ? `
        <a class="submit2" href="${escapeAttribute(hashForWork(lesson.work.work_id))}">${escapeHtml(getLessonWorkCtaLabel(aiStatus))}</a>
        <a class="ghost-button" href="#/works">ワーク一覧へ</a>
      ` : renderLockedWorkNote(lesson)}
    </section>
  `;
}

function renderLockedWorkNote(lesson) {
  const remaining = lesson.workUnlockRemainingLessonIds || [];
  const lessonNames = remaining
    .map((lessonId) => findLessonContext(state.learning, lessonId)?.lesson?.lesson_title || getLessonDisplayNumber(lessonId))
    .filter(Boolean);

  return `
    <div class="mp-callout">
      <span>ひらくための条件</span>
      関連するミニワークをクリアすると、この本ワークがひらきます。
      ${lessonNames.length ? `<ul style="padding-left:18px;margin-top:4px;">${lessonNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>` : ""}
    </div>
  `;
}

function renderLearningDetailBlock(lesson) {
  const normalizeText = (value) => String(value || "").replace(/[\s　]+/g, "").replace(/[。．.!！?？]/g, "");
  const learningPurpose = String(lesson.hook || lesson.lesson_summary || lesson.purpose_watch || "").trim();
  const learningOutcome = String(lesson.learning_outcome || lesson.category_or_work || lesson.purpose_write || "").trim();
  const reservedTexts = new Set([learningPurpose, learningOutcome].map(normalizeText).filter(Boolean));
  const seenPoints = new Set();
  const points = (Array.isArray(lesson.material_points) ? lesson.material_points : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const normalized = normalizeText(item);
      if (!normalized || reservedTexts.has(normalized) || seenPoints.has(normalized)) return false;
      seenPoints.add(normalized);
      return true;
    });
  const thinkText = String(lesson.purpose_think || "").trim();
  const showThink = Boolean(thinkText) && !reservedTexts.has(normalizeText(thinkText)) && !seenPoints.has(normalizeText(thinkText));
  const writeText = String(lesson.purpose_write || "").trim();
  const showWrite = Boolean(writeText) && !reservedTexts.has(normalizeText(writeText)) && !seenPoints.has(normalizeText(writeText)) && (!showThink || normalizeText(writeText) !== normalizeText(thinkText));

  return `
    <section id="section-purpose" data-section="purpose" tabindex="-1" aria-labelledby="purpose-title">
      <details class="learn-details">
        <summary>
          <span id="purpose-title">このレッスンで学ぶこと</span>
          <small class="closed-label">ひらいて確認</small>
          <small class="open-label">閉じる</small>
        </summary>
        <div class="ld-body">
          ${learningPurpose ? `<div class="ld-item">
            <span>学習目的</span>
            <p>${escapeHtml(learningPurpose)}</p>
          </div>` : ""}
          ${points.length ? `
            <div class="ld-item">
              <span>主な内容</span>
              <ul>${points.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
          ` : ""}
          ${learningOutcome ? `<div class="ld-item">
            <span>視聴後にできるようになること</span>
            <p>${escapeHtml(learningOutcome)}</p>
          </div>` : ""}
          ${showThink ? `<div class="ld-item"><span>考えるポイント</span><p>${escapeHtml(thinkText)}</p></div>` : ""}
          ${showWrite ? `<div class="ld-item"><span>書く</span><p>${escapeHtml(writeText)}</p></div>` : ""}
        </div>
      </details>
    </section>
  `;
}

function renderLessonBottomNav(learning, lesson) {
  // 本ワークが紐づくレッスン（例: P1-05 目標・目的設定→W-P1-05、P1-10 まとめ→統括ワーク W-P1-09）は、
  // その本ワークが「解放済み かつ 未完了」なら「次の一歩」を本ワークへ導く（A/B是正）。
  // 完了済みなら次レッスンへ（従来どおり）。未解放（ロック）で要約レッスンは条件表示のまま。
  if (lesson.work) {
    const aiStatus = lesson.aiWorkStatus || "not_started";
    const workCompleted = ["completed", "final_feedback_ready"].includes(aiStatus) || lesson.progress.work_status === "good";
    const workUnlocked = lesson.canSubmitWork || lesson.progress.work_status === "good" || aiStatus === "completed";
    if (workUnlocked && !workCompleted) {
      return `
    <nav class="lesson-nav" aria-label="レッスン下部ナビゲーション">
      <a class="primary-button" href="${escapeAttribute(hashForWork(lesson.work.work_id))}">${escapeHtml(lesson.work.title)}へ進む</a>
      <a class="ghost-button" href="#/learning">登頂ルートへ戻る</a>
      <a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
    </nav>
  `;
    }
    // 要約レッスン（ミニワーク無し＋本ワーク紐付き）で未解放のときは条件を表示（次フェーズへ飛ばさない）。
    if (!lesson.miniWork && !workUnlocked && !workCompleted) {
      return `
    <nav class="lesson-nav" aria-label="レッスン下部ナビゲーション">
      <span class="locked-next-note">この章のミニワークをクリアすると、${escapeHtml(lesson.work.title)}がひらきます。</span>
      <a class="ghost-button" href="#/learning">登頂ルートへ戻る</a>
      <a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
    </nav>
  `;
    }
    // 完了済み等はこの下の汎用（次レッスン）へフォールスルー。
  }
  const nextLesson = getNextLesson(learning, lesson);
  const nextLock = getLessonNextLockState(learning, lesson);
  return `
    <nav class="lesson-nav" aria-label="レッスン下部ナビゲーション">
      ${nextLesson && !nextLock.locked ? `<a class="primary-button" href="${escapeAttribute(hashForLesson(nextLesson.lesson_id, "video"))}">次の一歩へ進む</a>` : ""}
      ${nextLesson && nextLock.locked ? `<span class="locked-next-note">${escapeHtml(nextLock.detail || nextLock.label)}</span>` : ""}
      <a class="ghost-button" href="#/learning">登頂ルートへ戻る</a>
      <a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
    </nav>
  `;
}

function renderSubmissionNote(submission) {
  return `
    <div class="submission-note">
      <span>${escapeHtml(learnerStatusLabel(submission.status))}</span>
      <time datetime="${escapeAttribute(submission.submitted_at)}">${escapeHtml(formatDate(submission.submitted_at))}</time>
    </div>
  `;
}

function getLessonNextLockState(learning, lesson) {
  const nextLesson = getNextLesson(learning, lesson);
  if (!nextLesson) return { locked: false, label: "最終教材です" };
  if (lesson.quiz && !lesson.quizState?.passed) {
    return {
      locked: true,
      label: "○×テストをクリアするとひらきます",
      detail: "この教材の○×テストで4問以上正解すると、次の動画への道がひらきます。"
    };
  }
  if (lesson.miniWork && lesson.progress.mini_work_status !== "good") {
    return {
      locked: true,
      label: "ミニワークをクリアするとひらきます",
      detail: "この教材のミニワークをクリアすると、次の動画への道がひらきます。"
    };
  }
  return { locked: false, label: "進めます" };
}

/* ============================================================
   評価結果カード（インライン・再訪時表示用）
   ============================================================ */

function renderEvaluationResultCard(evaluation, label) {
  const score = Number.isFinite(Number(evaluation.score)) ? Number(evaluation.score) : null;
  const resultHelp = getEvaluationResultHelp(evaluation.result_status);
  const isPassed = evaluation.result_status === "good";
  const resultKind = label === "ミニワーク" ? "mini-work" : "work";
  if (resultKind === "mini-work" && hasMiniWorkV2Feedback(evaluation)) {
    return renderMiniWorkScoreCard(evaluation, label);
  }
  const resultId = resultKind === "mini-work" ? ` id="mini-work-evaluation-result"` : "";
  const goodPoints = uniqueLearnerItems(evaluation.good_points || []).slice(0, 3);
  const improvementPoints = isPassed ? [] : uniqueLearnerItems(evaluation.improvement_points || []).filter((item) => !goodPoints.includes(item)).slice(0, 3);
  const nextQuestion = !isPassed && evaluation.next_question
    ? evaluation.next_question
    : "";

  return `
    <section${resultId} class="evaluation-card" data-result="${escapeAttribute(evaluation.result_status)}" data-evaluation-result="${escapeAttribute(resultKind)}" aria-label="${escapeAttribute(label)}の評価結果">
      <p class="ev-k">FEEDBACK ${renderStatusBadge(evaluation.result_status)}</p>
      <div class="ev-score">
        <strong>${score === null ? "—" : score}</strong>
        <small>SCORE / 合格80</small>
      </div>
      <p class="ev-help">${escapeHtml(resultHelp)}</p>
      <div class="ev-cols">
        <div>
          <h4>良い点</h4>
          <ul>${goodPoints.length ? goodPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li>回答を出して、考える材料を言葉にできています。</li>`}</ul>
        </div>
        ${improvementPoints.length ? `
          <div>
            <h4>改善ポイント</h4>
            <ul>${improvementPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </div>
        ` : ""}
      </div>
      ${nextQuestion ? `<div class="ev-next-question"><h4>追加質問</h4><p>${escapeHtml(nextQuestion)}</p></div>` : ""}
      ${renderEvaluationNextAction(isPassed)}
    </section>
  `;
}

function renderEvaluationNextAction(isPassed) {
  const heading = isPassed ? "合格です。次のレッスンへ進めます" : "再提出でクリアを目指しましょう";
  const body = isPassed
    ? "点数とフィードバックを確認したら、次のレッスンへ進んでください。"
    : "不足している材料・書き直し方・追加質問を確認し、回答に足して再提出してください。";
  const cta = isPassed ? "次のレッスンへ" : "回答を書き直す";
  return `
    <div class="ev-next" data-evaluation-next-action="${isPassed ? "pass" : "retry"}">
      <h4>${heading}</h4>
      <p>${body}</p>
      <button class="ghost-button" type="button" data-action="${isPassed ? "go-next-lesson" : "rewrite-mini-work"}">${cta}</button>
    </div>
  `;
}

function renderMiniWorkScoreCard(evaluation, label) {
  const score = Number.isFinite(Number(evaluation.score)) ? Number(evaluation.score) : 70;
  const passed = score >= 80 && evaluation.result_status === "good";
  const feedback = evaluation.feedback && typeof evaluation.feedback === "object" ? evaluation.feedback : {};
  const layerResults = evaluation.layer_results || evaluation.layerResults || feedback.layerResults || {};
  const layerDecisions = evaluation.layer_decisions || evaluation.layerDecisions || feedback.layerDecisions || {};
  const layerKeys = ["L1", "L2", "L3", "L4a", "L4b"];
  const rows = layerKeys.filter((key) => layerResults[key] || layerDecisions[key]).map((key) => {
    const item = layerResults[key] || {};
    const decision = item.decision || layerDecisions[key] || "No";
    const labelText = item.label || key;
    return `<li><strong>${escapeHtml(labelText)}</strong><span>${decision === "Yes" ? "満たしています" : "次の伸びしろです"}</span></li>`;
  });
  const goodPoints = uniqueLearnerItems(evaluation.good_points || evaluation.goodPoints || feedback.goodPoints || evaluation.good_materials || []).slice(0, 4);
  const missingPoints = uniqueLearnerItems(evaluation.missing_points || evaluation.missingPoints || feedback.missingPoints || []).slice(0, 4);
  const rewritePoints = uniqueLearnerItems(evaluation.rewrite_points || evaluation.rewritePoints || feedback.rewritePoints || []).slice(0, 4);
  const growthPoints = uniqueLearnerItems(evaluation.growth_points || evaluation.growthPoints || feedback.growthPoints || []).slice(0, 4);
  const failedLayer = evaluation.failed_layer_label || evaluation.failedLayerLabel || feedback.failedLayerLabel || evaluation.failed_layer || evaluation.failedLayer || feedback.failedLayer || "";
  const additionalQuestions = passed
    ? []
    : uniqueLearnerItems([
      ...(Array.isArray(evaluation.followup_questions) ? evaluation.followup_questions : []),
      evaluation.next_question || evaluation.nextQuestion || ""
    ]).slice(0, 4);

  return `
    <section id="mini-work-evaluation-result" class="evaluation-card" data-result="${escapeAttribute(evaluation.result_status)}" data-evaluation-result="mini-work" aria-label="${escapeAttribute(label)}の評価結果">
      <p class="ev-k">FEEDBACK <span class="status-badge" data-tone="${passed ? "positive" : "attention"}">${passed ? "合格" : "再提出"}</span></p>
      <div class="ev-score">
        <strong>${score}</strong>
        <small>SCORE / 合格80</small>
      </div>
      <p class="ev-help">${escapeHtml(evaluation.reason || `${score}点・${passed ? "合格" : "再提出"}です。`)}</p>
      ${!passed && failedLayer && failedLayer !== "なし" ? `<p class="ev-help"><strong>最初に見直す層:</strong> ${escapeHtml(failedLayer)}</p>` : ""}
      <div class="ev-cols">
        ${rows.length ? `<div>
          <h4>点数の根拠</h4>
          <ul class="ev-layer-list">${rows.join("")}</ul>
        </div>` : ""}
        ${goodPoints.length ? `<div><h4>良かった材料</h4><ul>${goodPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${missingPoints.length ? `<div><h4>${passed ? "改善余地" : "不足している材料"}</h4><ul>${missingPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${rewritePoints.length ? `<div><h4>${passed ? "改善のヒント" : "書き直し方"}</h4><ul>${rewritePoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${growthPoints.length ? `<div><h4>次の成長ポイント</h4><ul>${growthPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        ${additionalQuestions.length ? `<div><h4>追加質問</h4><ol>${additionalQuestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></div>` : ""}
      </div>
      ${renderEvaluationNextAction(passed)}
    </section>
  `;
}

function hasMiniWorkV2Feedback(evaluation = {}) {
  const feedback = evaluation.feedback && typeof evaluation.feedback === "object" ? evaluation.feedback : {};
  const schemaVersion = String(evaluation.schema_version || evaluation.schemaVersion || "");
  const layerDecisions = evaluation.layer_decisions || evaluation.layerDecisions || feedback.layerDecisions || {};
  const detailGroups = [
    evaluation.missing_points,
    evaluation.missingPoints,
    feedback.missingPoints,
    evaluation.rewrite_points,
    evaluation.rewritePoints,
    feedback.rewritePoints,
    evaluation.growth_points,
    evaluation.growthPoints,
    feedback.growthPoints
  ];
  return schemaVersion === "barise-mini-work-evaluation-v2" ||
    Object.keys(layerDecisions).length > 0 ||
    detailGroups.some((items) => Array.isArray(items) && items.some((item) => String(item || "").trim()));
}

function uniqueLearnerItems(items = []) {
  const seen = new Set();
  return items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

/* ============================================================
   ワーク一覧（#/works）
   ============================================================ */

function renderWorksPage() {
  const learning = state.learning;
  if (!learning) {
    renderLoading();
    return;
  }

  const dir = enterDirection("works");
  const works = learning.works || [];
  const activeStatuses = ["theme_intake", "intake_required", "intake_reviewing", "intake_followup_required", "prompt_generated", "answering", "ai_reviewing", "followup_required", "revision_required", "final_feedback_ready", "error"];
  const nextWork =
    works.find((work) => activeStatuses.includes(work.aiStatus)) ||
    works.find((work) => work.aiStatus === "not_started" && Number(work.miniRemainingCount || 0) === 0) ||
    works.find((work) => work.aiStatus !== "completed") ||
    works[0] ||
    null;
  const sectionWorks = works.filter((work) => work.work_id !== nextWork?.work_id);
  const activeWorks = sectionWorks.filter((work) => activeStatuses.includes(work.aiStatus));
  const readyWorks = sectionWorks.filter((work) => work.aiStatus === "not_started" && Number(work.miniRemainingCount || 0) === 0);
  const notStartedWorks = sectionWorks.filter((work) => work.aiStatus === "not_started" && Number(work.miniRemainingCount || 0) > 0);
  const completedWorks = sectionWorks.filter((work) => work.aiStatus === "completed");

  app.innerHTML = `
    <div class="stage" data-enter="${dir}">
      ${renderHomeTop(learning)}
      ${renderTabbar("works")}
      <main>
        <p class="page-kicker">WORKS</p>
        <h1 class="page-title">実践ワーク</h1>
        <p class="page-lead">学んだ視点を、あなたの実務に落とし込む場所です。AIが伴走し、テーマ整理から最終フィードバックまでこのページ内で完結します。</p>

        ${renderLand("r")}

        ${nextWork ? `
          <div class="sec-h-row rise">
            <span class="sec-h">いま取り組むワーク</span>
            ${renderAiWorkStatusBadge(nextWork.aiStatus)}
          </div>
          <div class="rise rise-1">${renderWorkCard(nextWork, true)}</div>
        ` : `<p class="empty-note">取り組めるワークは、学習が進むとここにひらきます。</p>`}

        ${renderWorkSection("進行中のワーク", activeWorks)}
        ${renderWorkSection("挑戦できるワーク", readyWorks)}
        ${renderWorkSection("この先のワーク", notStartedWorks, { collapsed: true })}
        ${renderWorkSection("クリアしたワーク", completedWorks, { collapsed: true })}
        <div class="page-foot">
          <a class="text-link" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
        </div>
      </main>
    </div>
  `;

  requestAnimationFrame(() => scrollToPageTop());
}

function renderWorkSection(title, works, options = {}) {
  if (!works.length) return "";
  const body = works.map((work) => renderWorkCard(work)).join("");

  if (options.collapsed) {
    return `
      <section class="works-section">
        <details>
          <summary>
            <span class="sec-h">${escapeHtml(title)}</span>
            <span class="sec-count">${works.length}件</span>
          </summary>
          ${body}
        </details>
      </section>
    `;
  }

  return `
    <section class="works-section">
      <div class="sec-h-row">
        <span class="sec-h">${escapeHtml(title)}</span>
        <span class="sec-count">${works.length}件</span>
      </div>
      ${body}
    </section>
  `;
}

function renderWorkCard(work, featured = false) {
  const relatedLessons = work.relatedLessons || [];
  const requirementLabel = getWorkRequirementLabel(work);
  return `
    <article class="work-card${featured ? " work-card--featured" : ""}">
      <div class="wc-top">
        <span>${escapeHtml(work.work_id)}</span>
        ${renderAiWorkStatusBadge(work.aiStatus)}
      </div>
      <h3>${escapeHtml(work.title)}</h3>
      ${featured ? `<p class="wc-desc">${escapeHtml(work.entry_description || work.purpose)}</p>` : ""}
      <dl class="wc-meta">
        <div><dt>関連</dt><dd>${escapeHtml(work.phaseTitle || work.phase_id || "Barise")}</dd></div>
        <div><dt>条件</dt><dd>${escapeHtml(requirementLabel)}</dd></div>
      </dl>
      ${featured && relatedLessons.length ? `
        <dl class="wc-meta" style="margin-top:8px;">
          ${relatedLessons.map((lesson) => `<div><dt>教材</dt><dd><a class="text-link" href="${escapeAttribute(hashForLesson(lesson.lesson_id, "video"))}">${escapeHtml(getLessonDisplayNumber(lesson.lesson_id))} ${escapeHtml(lesson.lesson_title)}</a></dd></div>`).join("")}
        </dl>
      ` : ""}
      <a class="submit2" href="${escapeAttribute(hashForWork(work.work_id))}">${escapeHtml(getWorkCtaLabel(work))}</a>
      ${featured && work.primaryLessonId ? `<a class="ghost-button" href="${escapeAttribute(hashForLesson(work.primaryLessonId, "video"))}">関連動画へ</a>` : ""}
    </article>
  `;
}

/* ============================================================
   AIワーク（#/work/:id）
   ============================================================ */

function renderAiWorkPage(workId) {
  const learning = state.learning;
  const work = (learning?.works || []).find((item) => item.work_id === workId);
  if (!work) {
    renderWorksPage();
    return;
  }

  const dir = enterDirection("work");

  app.innerHTML = `
    <div class="stage" data-enter="${dir}">
      ${renderBackTop("#/works", "戻る", work.work_id)}
      <main>
        ${renderAiWorkMain(work)}
        ${renderAiWorkRelatedPanel(work)}
        <nav class="lesson-nav">
          <a class="ghost-button" href="#/works">ワーク一覧へ戻る</a>
          <a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
        </nav>
      </main>
    </div>
  `;

  requestAnimationFrame(() => scrollToPageTop());
}

function renderAiWorkMain(work) {
  const session = work.aiSession || null;
  const status = work.aiStatus || "not_started";
  const locked = !work.canStartAiWork && !["completed", "final_feedback_ready"].includes(status);
  return `
    <div class="lesson-title">
      <p class="lt-k">WORK</p>
      <h1>${escapeHtml(work.title)}</h1>
      <p class="lt-sub">${escapeHtml(work.work_goal || work.purpose)}</p>
    </div>
    ${renderLand("t")}
    <div class="meta-chips">
      ${renderAiWorkStatusBadge(status)}
      ${renderMetaChip("鍛える力", work.target_skill || "判断力 / 仮説検証 / PDCA")}
      ${renderMetaChip("完了条件", work.completion_condition || "AIフィードバックが届いた状態")}
    </div>
    <div class="ai-context-grid">
      ${renderAiWorkContextItem("このワークで作る成果物", work.learner_output || "自分の状況を構造化した回答")}
      ${renderAiWorkContextItem("前ワークとのつながり", work.previous_work_connection || "ここまでの学習内容を踏まえて整理します。")}
      ${renderAiWorkContextItem("次への接続", work.next_work_connection || "整理した内容を次の学習や実践へつなげます。")}
    </div>
    <section class="ai-panel" aria-label="ワークの進行">
      ${locked ? renderAiWorkLockedGate(work) : renderAiWorkStep(work, session)}
    </section>
  `;
}

function renderAiWorkLockedGate(work) {
  const missingLessons = work.missingRequiredLessonIds || [];
  const missingMiniWorks = work.missingRequiredMiniWorkIds || [];
  return `
    <div class="ai-block ai-block--focus">
      <span>ひらくための条件があります</span>
      <p>${escapeHtml(work.unlockReason || "関連する動画の視聴とミニワークのクリア後に始められます。")}</p>
      ${missingLessons.length ? `
        <p style="margin-top:8px;"><strong style="font-size:11px;">視聴が必要な動画</strong></p>
        <ul>${missingLessons.map((lessonId) => `<li><a class="text-link" href="${escapeAttribute(hashForLesson(lessonId, "video"))}">${escapeHtml(getLessonDisplayNumber(lessonId))} の動画へ</a></li>`).join("")}</ul>
      ` : ""}
      ${missingMiniWorks.length ? `
        <p style="margin-top:8px;"><strong style="font-size:11px;">クリアが必要なミニワーク</strong></p>
        <ul>${missingMiniWorks.map((miniWorkId) => `<li>${escapeHtml(miniWorkId)}</li>`).join("")}</ul>
      ` : ""}
    </div>
    <a class="submit2" href="#/learning">登頂ルートへ戻る</a>
  `;
}

function renderAiWorkStep(work, session) {
  const status = session?.status || "not_started";
  if (status === "completed" || status === "final_feedback_ready") {
    return renderAiFinalFeedback(work, session);
  }
  if (status === "intake_followup_required") {
    return renderAiIntakeFollowupForm(work, session);
  }
  if (status === "followup_required") {
    return renderAiFollowupForm(work, session);
  }
  if (status === "revision_required") {
    return renderAiRevisionForm(work, session);
  }
  if (status === "answering" || status === "prompt_generated" || status === "ai_reviewing") {
    return `${renderAiWorkAchievementNotice(work)}${renderAiWorkLatestResult(work)}${renderAiWorkAttemptHistory(work)}${renderAiAnswerForm(work, session)}`;
  }
  if (status === "error") {
    return `
      <div class="ai-block ai-block--focus">
        <span>一時的に処理できませんでした</span>
        <p>保存済みの内容から再実行できます。</p>
      </div>
      ${renderAiEvaluationSummary(session)}
      <button class="submit2" type="button" data-action="retry-ai-work" data-work-id="${escapeAttribute(work.work_id)}">再実行する</button>
    `;
  }
  return renderAiThemeForm(work, session);
}

function renderAiThemeForm(work, session = null) {
  const fields = getAiIntakeFields(work);
  // 共通プロフィール項目は初回に一度だけ収集し、以降は保存値をプリフィルして再質問しない。
  // 値が入っているプロフィール項目は「基本情報（確認・編集）」に畳んで置き、
  // 未入力のプロフィール項目＋このワーク固有の新項目だけを主に質問する。
  const profileCtx = work.commonProfileContext || {};
  const resolveValue = (key) => {
    const v = getAiContextValue(session, key);
    if (String(v || "").trim() !== "") return v;
    // セッション未作成でも、保存済み共通プロフィールからプリフィルする
    return isProfileIntakeField(key) ? (profileCtx[key] || "") : "";
  };
  const withValue = fields.map((field) => ({ field, value: resolveValue(field.key) }));
  const prefilledProfile = withValue.filter((item) => isProfileIntakeField(item.field.key) && String(item.value || "").trim() !== "");
  const asked = withValue.filter((item) => !prefilledProfile.includes(item));
  const renderField = (item) => renderTextAreaField(item.field.key, item.field.label, item.value, item.field.placeholder, item.field.rows || 4);
  return `
    <form class="ai-work-form" data-form="ai-theme" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderLearnerGuidance(work)}
      ${prefilledProfile.length ? `
        <details class="ai-details profile-recap">
          <summary>あなたの基本情報（確認・編集）<small class="closed-label">前回の内容を引き継いでいます</small></summary>
          <div class="ai-history">
            ${prefilledProfile.map(renderField).join("")}
          </div>
        </details>
      ` : ""}
      ${asked.map(renderField).join("")}
      <button class="submit2 work-submit-button" type="submit">AIに問いを整えてもらう</button>
    </form>
  `;
}

// 共通プロフィールの6項目（key が profile_ で始まる）。ワーク横断で使い回す。
function isProfileIntakeField(key) {
  return typeof key === "string" && key.startsWith("profile_");
}

function renderAiAnswerForm(work, session) {
  return `
    ${renderAiGeneratedPrompt(work, session)}
    ${renderAiCriteriaGuide(work)}
    <form class="ai-work-form" data-form="ai-answer" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("answer", "回答", session.initial_answer || "", work.answer_placeholder || "場面、数字、判断理由、次の行動を具体的に書いてください", 8)}
      <button class="submit2 work-submit-button" type="submit">回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiIntakeFollowupForm(work, session) {
  return `
    <div class="ai-block ai-block--focus">
      <span>今回答える質問</span>
      <p>${escapeHtml(session.ai_summary || "ワークを始めるために、もう少し材料を集めます。")}</p>
    </div>
    ${renderFollowupQuestionPanel(session.followup_questions)}
    ${renderMissingPoints(session.missing_points, "追記すべき観点")}
    ${session.intake_placeholder_notice ? `<div class="ai-block"><p>${escapeHtml(session.intake_placeholder_notice)}</p></div>` : ""}
    ${renderFollowupHistory(session.followup_history)}
    <form class="ai-work-form" data-form="ai-intake-followup" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("intake_followup_answer", "今回答える内容", "", "上の質問に対して、あなたの実際の状況・数字・判断理由を追記してください", 7)}
      <button class="submit2 work-submit-button" type="submit">追加回答を送る</button>
    </form>
    ${session.can_continue_with_placeholders ? `
      <button class="ghost-button" type="button" data-action="continue-ai-work-placeholders" data-work-id="${escapeAttribute(work.work_id)}">不足を仮置きしてワークへ進む</button>
    ` : ""}
  `;
}

function renderAiFollowupForm(work, session) {
  const isGoalSettingWork = work.work_id === "W-P1-05";
  const followupQuestions = getAiFollowupQuestions(session);
  return `
    ${renderAiWorkAchievementNotice(work)}
    ${renderAiWorkLatestResult(work)}
    ${renderAiWorkAttemptHistory(work)}
    ${renderAiGeneratedPrompt(work, session)}
    ${renderAiCriteriaProgress(session)}
    ${renderAiEvaluationSummary(session)}
    <div class="ai-block ai-block--focus">
      <span>${isGoalSettingWork ? "フィードバック" : "今回答える質問"}</span>
      <p>${escapeHtml(session.ai_summary || "追加質問に回答してください。")}</p>
    </div>
    ${isGoalSettingWork ? renderAdditionalQuestions(followupQuestions) : renderFollowupQuestionPanel(followupQuestions)}
    ${renderMissingPoints(session.unmet_criteria, "追記すべき観点")}
    ${renderFollowupHistory(session.followup_history)}
    <form class="ai-work-form" data-form="ai-followup" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("followup_answer", "今回答える内容", "", "上の質問に対して、具体場面・数字・判断理由を足して回答してください", 8)}
      <button class="submit2 work-submit-button" type="submit">追加回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiRevisionForm(work, session) {
  const followupQuestions = getAiFollowupQuestions(session);
  return `
    ${renderAiWorkAchievementNotice(work)}
    ${renderAiWorkLatestResult(work)}
    ${renderAiWorkAttemptHistory(work)}
    ${renderAiGeneratedPrompt(work, session)}
    <div class="ai-block ai-block--focus">
      <span>もう一度、いっしょに整理しましょう</span>
      <p class="multiline-text">${escapeHtml(session.ai_feedback || session.ai_summary || "回答の観点を整えて、もう一度送ってください。")}</p>
    </div>
    ${renderMissingPoints(session.unmet_criteria, "追記すべき観点")}
    ${renderStaffFeedbackNotice(session)}
    ${work.work_id === "W-P1-05" ? renderAdditionalQuestions(followupQuestions) : renderFollowupQuestionPanel(followupQuestions, "今回答える質問")}
    ${renderAiEvaluationSummary(session, { compact: true })}
    ${renderRevisionHistory(session.revision_history, { collapsed: true })}
    <form class="ai-work-form" data-form="ai-revision" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("revision_answer", "再回答", session.latest_revision_answer || "", work.answer_placeholder || "不足している観点を足して、もう一度整理してください", 8)}
      <button class="submit2 work-submit-button" type="submit">再回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiFinalFeedback(work, session) {
  const nextLesson = getNextLessonAfterWork(work);
  return `
    <div class="ai-block ai-block--gold">
      <span>AI最終フィードバック ${renderAiWorkStatusBadge(session.status)}</span>
      <p class="multiline-text">${escapeHtml(session.ai_final_feedback || "フィードバックを生成しました。")}</p>
    </div>
    ${renderAiEvaluationSummary(session)}
    ${renderStaffFeedbackNotice(session)}
    ${renderAiCriteriaProgress(session, "完了できた観点")}
    ${(session.good_points || []).length ? `
      <div class="ai-block">
        <h4>良い点</h4>
        <ul>${(session.good_points || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    ` : ""}
    ${(session.next_actions || []).length ? `
      <div class="ai-block">
        <h4>次アクション</h4>
        <ul>${(session.next_actions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    ` : ""}
    ${renderAiWorkAchievementNotice(work)}
    ${renderAiWorkLatestResult(work)}
    ${renderAiWorkAttemptHistory(work)}
    ${work.hasPassed ? `<button class="submit2 ai-work-reattempt" type="button" data-action="restart-ai-work" data-work-id="${escapeAttribute(work.work_id)}">もう一度取り組む</button>` : ""}
    ${nextLesson ? `<a class="submit2" href="${escapeAttribute(hashForLesson(nextLesson.lesson_id, "video"))}">次のレッスン「${escapeHtml(nextLesson.lesson_title || "")}」へ進む</a>` : `<a class="submit2" href="#/learning">次の学習へ進む</a>`}
  `;
}

function renderAiWorkAchievementNotice(work) {
  if (!work?.hasPassed) return "";
  const bestScore = work.achievementSummary?.best_score;
  const scoreText = bestScore !== null && bestScore !== undefined && String(bestScore).trim() !== "" && Number.isFinite(Number(bestScore))
    ? ` / 最高${Number(bestScore)}点`
    : "";
  return `
    <div class="ai-block ai-block--gold ai-work-achievement" aria-label="合格実績">
      <strong>クリア済み（合格実績あり）${escapeHtml(scoreText)}</strong>
      <p>今回の再挑戦結果にかかわらず、クリア状態と進行は維持されます。</p>
    </div>
  `;
}

function renderAiWorkLatestResult(work) {
  const latest = work?.achievementSummary?.latest_result;
  if (!latest) return "";
  const scoreText = latest.score !== null && latest.score !== undefined && String(latest.score).trim() !== "" && Number.isFinite(Number(latest.score))
    ? `${Number(latest.score)}点・`
    : "";
  const label = getAiEvaluationLabel({
    standard_status: latest.standard_status,
    result_status: latest.result_status,
    score: latest.score
  });
  return `<p class="ai-work-latest-result">今回の結果: ${escapeHtml(`${scoreText}${label}`)}</p>`;
}

function renderAiWorkAttemptHistory(work) {
  const attempts = Array.isArray(work?.attemptHistory) ? work.attemptHistory.slice(0, 3) : [];
  if (!attempts.length) return "";
  return `
    <section class="ai-work-attempts" aria-label="これまでの提出" data-work-attempt-history>
      <h3>これまでの提出</h3>
      ${attempts.map((attempt, index) => {
        const scoreText = attempt.score !== null && attempt.score !== undefined && String(attempt.score).trim() !== "" && Number.isFinite(Number(attempt.score))
          ? `${Number(attempt.score)}点`
          : "点数なし";
        const label = getAiEvaluationLabel({
          ...(attempt.evaluation || {}),
          standard_status: attempt.standard_status || attempt.evaluation?.standard_status,
          result_status: attempt.result_status || attempt.evaluation?.result_status
        });
        const evaluation = attempt.evaluation && typeof attempt.evaluation === "object" ? attempt.evaluation : null;
        return `
          <details class="ai-details ai-work-attempt" data-work-attempt${index === 0 ? " open" : ""}>
            <summary>
              <span>${escapeHtml(formatDate(attempt.submitted_at) || "日時なし")}</span>
              <strong>${escapeHtml(scoreText)}・${escapeHtml(label)}</strong>
            </summary>
            <div class="ai-work-attempt-body">
              <h4>自分の回答</h4>
              <p class="multiline-text">${escapeHtml(attempt.answer_text || "回答は保存されていません。")}</p>
              ${evaluation ? renderAiEvaluationSummary({
                work_id: work.work_id,
                status: attempt.result_status || "",
                ai_evaluation_result: evaluation
              }, { compact: true }) : ""}
            </div>
          </details>
        `;
      }).join("")}
    </section>
  `;
}

function renderAiWorkRelatedPanel(work) {
  const relatedLessons = work.relatedLessons || [];
  if (!relatedLessons.length) return "";
  return `
    <section class="ch-list" aria-label="関連の動画・ミニワーク">
      <p class="ch-h">RELATED</p>
      ${relatedLessons.map((lesson) => `
        <a class="ls-row" href="${escapeAttribute(hashForLesson(lesson.lesson_id, "video"))}">
          <span class="ls-id">${escapeHtml(getLessonDisplayNumber(lesson.lesson_id))}</span>
          <div class="ls-side"><span class="ls-state${lesson.video_status === "watched" ? " watched" : ""}">${escapeHtml(getVideoWatchLabel(lesson.video_status))}</span></div>
          <h4>${escapeHtml(lesson.lesson_title)}</h4>
          <p class="ls-sub">ミニワーク: ${escapeHtml(lesson.mini_work_status === "none" ? "対象なし" : learnerStatusLabel(lesson.mini_work_status))}</p>
        </a>
      `).join("")}
    </section>
  `;
}

function renderAiWorkContextItem(label, value) {
  return `
    <article>
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(value)}</p>
    </article>
  `;
}

function renderLearnerGuidance(work) {
  const guidance = Array.isArray(work.learner_guidance) ? work.learner_guidance : [
    "あなたの職種に合わせて、ワークの問いかけを調整します",
    "回答が足りない場合は、AIが追加で質問します",
    "正解を当てるワークではなく、自分の状況を構造化するワークです",
    "抽象的な回答の場合は、もう一度整理してもらうことがあります"
  ];
  return `
    <div class="ai-guidance" aria-label="ワークの進め方">
      ${guidance.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </div>
  `;
}

/* ============================================================
   AIプロンプト表示・整形（V5ロジック準拠）
   ============================================================ */

function renderAiGeneratedPrompt(work, session) {
  const parts = normalizeAiPromptParts(session);
  // Sheets復元セッションには生成済み問題文が保存されていないため、
  // 再挑戦中は現行教材の問いを表示フォールバックにして空欄を防ぐ。
  if (!parts.questionItems.length && Array.isArray(work?.questions)) {
    parts.questionItems = sanitizePromptList(work.questions);
  }
  if (!parts.title && !parts.questionItems.length && !parts.inputRows.length) return "";

  return `
    <section class="ai-prompt-box" aria-label="個別ワーク問題文">
      <span>あなたのための問題文</span>
      ${parts.title ? `<strong>${escapeHtml(parts.title)}</strong>` : ""}
      ${parts.purpose ? `<p>${escapeHtml(parts.purpose)}</p>` : ""}
      ${(parts.essence || parts.previousConnection) ? `
        <div class="apb-block">
          ${parts.essence ? `<span>守る本質</span><p style="font-size:11.5px;color:rgba(245,245,247,.55);">${escapeHtml(parts.essence)}</p>` : ""}
          ${parts.previousConnection ? `<span style="margin-top:6px;">前ワークとのつながり</span><p style="font-size:11.5px;color:rgba(245,245,247,.55);">${escapeHtml(parts.previousConnection)}</p>` : ""}
        </div>
      ` : ""}
      ${parts.inputRows.length ? `
        <details class="apb-block" open>
          <summary>あなたの入力を確認</summary>
          <dl style="margin-top:8px;">
            ${parts.inputRows.map((row) => `
              <div>
                <dt>${escapeHtml(row.label)}</dt>
                <dd>${escapeHtml(row.value)}</dd>
              </div>
            `).join("")}
          </dl>
        </details>
      ` : ""}
      ${parts.questionItems.length ? `
        <div class="apb-block">
          <span>今回の問い</span>
          <ol>
            ${parts.questionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ol>
        </div>
      ` : ""}
      ${parts.criteria.length ? `
        <div class="apb-block">
          <span>完了の目安</span>
          <ul>
            ${parts.criteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
    </section>
  `;
}

function normalizeAiPromptParts(session) {
  const structured = session?.generated_work_prompt_parts;
  if (structured && typeof structured === "object") {
    return {
      title: sanitizeLearnerText(structured.title),
      purpose: stripLabelPrefix(sanitizeLearnerText(structured.purpose), "目的"),
      essence: stripLabelPrefix(sanitizeLearnerText(structured.essence), "守る本質"),
      previousConnection: stripLabelPrefix(sanitizeLearnerText(structured.previousConnection), "前ワークとのつながり"),
      inputRows: sanitizePromptRows(structured.inputRows || []),
      questionItems: sanitizePromptList(structured.questionItems || []),
      criteria: sanitizePromptList(structured.criteria || [])
    };
  }

  return parsePromptText(session?.generated_work_prompt || "");
}

function parsePromptText(promptText) {
  const lines = String(promptText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parts = {
    title: sanitizeLearnerText(lines[0] || ""),
    purpose: "",
    essence: "",
    previousConnection: "",
    inputRows: [],
    questionItems: [],
    criteria: []
  };
  let section = "";

  lines.slice(1).forEach((line) => {
    if (line.startsWith("目的:")) {
      parts.purpose = stripLabelPrefix(sanitizeLearnerText(line), "目的");
      section = "";
      return;
    }
    if (line.startsWith("守る本質:")) {
      parts.essence = stripLabelPrefix(sanitizeLearnerText(line), "守る本質");
      section = "";
      return;
    }
    if (line.startsWith("前ワークとのつながり:")) {
      parts.previousConnection = stripLabelPrefix(sanitizeLearnerText(line), "前ワークとのつながり");
      section = "";
      return;
    }
    if (line === "あなたの入力:") {
      section = "input";
      return;
    }
    if (line === "今回の問い:") {
      section = "question";
      return;
    }
    if (line === "完了の目安:") {
      section = "criteria";
      return;
    }
    if (line.startsWith("AIは")) {
      section = "";
      return;
    }

    if (section === "input") {
      const item = line.replace(/^-\s*/, "");
      const separatorIndex = item.indexOf(":");
      const label = separatorIndex >= 0 ? item.slice(0, separatorIndex).trim() : "";
      const value = separatorIndex >= 0 ? item.slice(separatorIndex + 1).trim() : item;
      if (label && value && !containsLearnerForbiddenText(label) && !containsLearnerForbiddenText(value)) {
        parts.inputRows.push({ label, value });
      }
      return;
    }

    if (section === "question") {
      const item = line.replace(/^\d+[.)]\s*/, "");
      if (item && !containsLearnerForbiddenText(item)) parts.questionItems.push(item);
      return;
    }

    if (section === "criteria") {
      const item = line.replace(/^-\s*/, "");
      if (item && !containsLearnerForbiddenText(item)) parts.criteria.push(item);
    }
  });

  return parts;
}

function sanitizePromptRows(rows) {
  return rows
    .map((row) => ({
      label: sanitizeLearnerText(row.label),
      value: sanitizeLearnerText(row.value)
    }))
    .filter((row) => row.label && row.value && !containsLearnerForbiddenText(row.label) && !containsLearnerForbiddenText(row.value));
}

function sanitizePromptList(items) {
  return items
    .map((item) => sanitizeLearnerText(item))
    .filter((item) => item && !containsLearnerForbiddenText(item));
}

function sanitizeLearnerText(value) {
  const text = String(value || "").trim();
  if (!text || containsLearnerForbiddenText(text)) return "";
  return text;
}

function stripLabelPrefix(value, label) {
  return String(value || "").replace(new RegExp(`^${label}:\\s*`), "").trim();
}

function containsLearnerForbiddenText(value) {
  return LEARNER_FORBIDDEN_PATTERN.test(String(value || ""));
}

function renderAiCriteriaGuide(work) {
  const criteria = work.completion_criteria || [];
  if (!criteria.length) return "";
  return `
    <div class="ai-block">
      <span>このワークで見る観点</span>
      <ul>
        ${criteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderAiCriteriaProgress(session, title = "現在満たせている観点") {
  const met = session?.met_criteria || [];
  const unmet = session?.unmet_criteria || [];
  if (!met.length && !unmet.length) return "";
  return `
    <div class="ai-block">
      ${met.length ? `
        <span>${escapeHtml(title)}</span>
        <ul>${met.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
      ${unmet.length ? `
        <span style="margin-top:8px;">もう一度整理する観点</span>
        <ul>${unmet.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
    </div>
  `;
}

function renderAiEvaluationSummary(session, options = {}) {
  const evaluation = session?.ai_evaluation_result;
  if (!evaluation) return "";
  const feedback = evaluation.feedback && typeof evaluation.feedback === "object" ? evaluation.feedback : {};
  const isLayeredConceptWork = session?.work_id === "W-P1-07" || evaluation.work_id === "W-P1-07" || evaluation.schema_version === "barise-main-work-evaluation-v2-2026-08-30";
  const goodPoints = evaluation.good_points || feedback.goodPoints || [];
  const improvementPoints = evaluation.improvement_points || feedback.improvementPoints || [];
  const unmetCriteria = evaluation.unmet_criteria || [];
  const missingPoints = evaluation.missing_points || feedback.missingPoints || [];
  const rewritePoints = evaluation.rewrite_points || feedback.rewritePoints || [];
  const growthPoints = evaluation.growth_points || feedback.growthPoints || [];
  const additionalQuestions = evaluation.additional_questions || evaluation.followup_questions || feedback.additionalQuestions || [];
  const resultLabel = getAiEvaluationLabel(evaluation, session?.status || "");
  const scoreText = Number.isFinite(Number(evaluation.score)) && Number(evaluation.score) > 0
    ? `${Number(evaluation.score)}点`
    : "評価中";
  const details = isLayeredConceptWork
    ? renderLayeredConceptWorkSummary(goodPoints, missingPoints, rewritePoints, growthPoints, additionalQuestions)
    : renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria);

  return `
    <div class="ai-block" aria-label="評価結果">
      <div class="ai-summary-head">
        <strong>${escapeHtml(scoreText)}</strong>
        <em>${escapeHtml(resultLabel)}</em>
      </div>
      <p>${escapeHtml(evaluation.summary || "評価結果を保存しました。")}</p>
      ${options.compact ? `
        <details class="ai-details">
          <summary>評価の詳細を見る</summary>
          ${details}
        </details>
      ` : details}
      ${evaluation.next_action ? `<p style="margin-top:6px;">${escapeHtml(evaluation.next_action)}</p>` : ""}
    </div>
  `;
}

function renderLayeredConceptWorkSummary(goodPoints, missingPoints, rewritePoints, growthPoints, additionalQuestions) {
  const sections = [
    ["良かった材料", goodPoints],
    ["不足材料", missingPoints],
    ["書き直し方", rewritePoints],
    ["伸びしろ", growthPoints],
    ["追加質問", additionalQuestions]
  ].filter(([, items]) => Array.isArray(items) && items.length);
  if (!sections.length) return "";
  return `
    <div class="ai-evaluation-detail-grid">
      ${sections.map(([heading, items]) => `
        <section>
          <h4>${escapeHtml(heading)}</h4>
          <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
      `).join("")}
    </div>
  `;
}

function renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria) {
  if (!goodPoints.length && !improvementPoints.length && !unmetCriteria.length) return "";
  return `
    <div style="display:grid;gap:8px;margin-top:8px;">
      ${goodPoints.length ? `
        <section>
          <h4>良い点</h4>
          <ul>${goodPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
      ` : ""}
      ${improvementPoints.length ? `
        <section>
          <h4>改善ポイント</h4>
          <ul>${improvementPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
      ` : ""}
      ${unmetCriteria.length ? `
        <section>
          <h4>もう一度整理する観点</h4>
          <ul>${unmetCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
      ` : ""}
    </div>
  `;
}

function renderStaffFeedbackNotice(session) {
  const feedback = session?.staff_feedback;
  if (!feedback?.recommended) return "";
  return `
    <div class="ai-block ai-block--gold">
      <p><strong>${escapeHtml(feedback.message || "作成されたワークをもとに、担当者からフィードバックをいたします。")}</strong></p>
      ${feedback.reason ? `<p>${escapeHtml(feedback.reason)}</p>` : ""}
    </div>
  `;
}

function renderMissingPoints(points = [], title = "追加で確認したいこと") {
  if (!points.length) return "";
  return `
    <div class="ai-block">
      <span>${escapeHtml(title)}</span>
      <ul>${points.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

// retry/追加質問時に表示する「今回答える質問」。
// AI応答の nextQuestion は followup_questions に載るのが基本だが、
// 経路によって空になり得るため next_action / next_question / ai_summary へ順にフォールバックし、
// 「今回答える質問」欄が必ず埋まるようにする（③ の要件）。
function getAiFollowupQuestions(session) {
  if (Array.isArray(session?.followup_questions) && session.followup_questions.length) {
    return session.followup_questions.filter(Boolean);
  }
  const fallback = session?.next_action || session?.next_question || "";
  return String(fallback).trim() ? [String(fallback).trim()] : [];
}

function renderFollowupQuestionPanel(questions = [], title = "今回答える質問") {
  if (!questions.length) return "";
  return `
    <div class="ai-block ai-block--focus">
      <span>${escapeHtml(title)}</span>
      <ol>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol>
    </div>
  `;
}

function renderAdditionalQuestions(questions = []) {
  const items = uniqueLearnerItems(questions);
  if (!items.length) return "";
  return `
    <section class="ai-block ai-block--focus" aria-labelledby="additional-questions-heading">
      <span id="additional-questions-heading">追加質問</span>
      <p>以下の質問に答えて再提出してください。</p>
      <ol>${items.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol>
    </section>
  `;
}

function getAiIntakeFields(work) {
  if (Array.isArray(work.intake_fields) && work.intake_fields.length) return work.intake_fields;
  return [
    { key: "learner_theme", label: "今回改善したいテーマ", placeholder: "営業の提案力を上げたい、CS対応を改善したいなど", rows: 4 },
    { key: "current_situation", label: "現在の状況", placeholder: "いま起きていること、数字、場面を入力してください", rows: 4 },
    { key: "goal", label: "理想の状態", placeholder: "どんな状態になれば良いかを書いてください", rows: 4 },
    { key: "problem", label: "今いちばん困っていること", placeholder: "何がボトルネックになっているかを書いてください", rows: 4 }
  ];
}

function getAiContextValue(session, key) {
  if (!session) return "";
  return session.learner_context?.[key] || session[key] || "";
}

function renderTextAreaField(name, label, value, placeholder, rows = 5) {
  return `
    <label>
      <span class="field-label">${escapeHtml(label)}</span>
      <textarea name="${escapeAttribute(name)}" rows="${rows}" placeholder="${escapeAttribute(placeholder)}" required>${escapeHtml(value)}</textarea>
    </label>
  `;
}

function renderFollowupHistory(history = []) {
  if (!history.length) return "";
  return `
    <details class="ai-details">
      <summary>前回までの回答を確認する</summary>
      <div class="ai-history">
        ${history.map((item) => `
          <article>
            <span>${escapeHtml(formatDate(item.created_at))}</span>
            <p class="multiline-text">${escapeHtml(item.answer)}</p>
          </article>
        `).join("")}
      </div>
    </details>
  `;
}

function renderRevisionHistory(history = [], options = {}) {
  if (!history.length) return "";
  const content = `
    <div class="ai-history">
      ${history.map((item) => `
        <article>
          <span>${escapeHtml(formatDate(item.created_at))}</span>
          <p class="multiline-text">${escapeHtml(item.after)}</p>
        </article>
      `).join("")}
    </div>
  `;
  if (!options.collapsed) return content;
  return `
    <details class="ai-details">
      <summary>これまでの再回答を見る</summary>
      ${content}
    </details>
  `;
}

/* ============================================================
   小さな表示ヘルパー
   ============================================================ */

function renderMetaChip(label, value) {
  return `
    <span class="meta-chip">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `;
}

/* 受講者向けの状態ラベル。data-provider.js の statusLabels（データ層・変更禁止）は
   Sheets値の解釈にも使われるため触らず、表示名だけをここで上書きする。 */
const LEARNER_STATUS_LABEL = {
  good: "クリア"
};

function learnerStatusLabel(status) {
  return LEARNER_STATUS_LABEL[status] || getStatusLabel(status);
}

function renderStatusBadge(status) {
  const label = learnerStatusLabel(status);
  const tone = status === "good" ? "gold" : getStatusTone(status);
  return `<span class="status-badge" data-tone="${escapeAttribute(tone)}">${escapeHtml(label)}</span>`;
}

function renderAiWorkStatusBadge(status) {
  const tone = (status === "completed" || status === "final_feedback_ready") ? "gold" : getAiWorkStatusTone(status);
  return `<span class="status-badge" data-tone="${escapeAttribute(tone)}">${escapeHtml(getAiWorkStatusLabel(status))}</span>`;
}

function getVideoWatchLabel(status) {
  return status === "watched" ? "視聴済み" : "これから";
}

function getStatusTone(status) {
  if (["good", "watched", "submitted", "unlocked"].includes(status)) return "positive";
  if (status === "support_needed") return "support";
  if (["needs_more", "failed"].includes(status)) return "attention";
  if (status === "reviewing") return "pending";
  return "neutral";
}

function getAiWorkStatusTone(status) {
  if (status === "completed" || status === "final_feedback_ready") return "positive";
  if (status === "followup_required" || status === "intake_followup_required" || status === "revision_required") return "attention";
  if (status === "ai_reviewing" || status === "answering" || status === "prompt_generated" || status === "intake_reviewing" || status === "theme_intake" || status === "intake_required") return "pending";
  if (status === "error") return "support";
  return "neutral";
}

function getWorkCtaLabel(work) {
  if (work.aiStatus === "completed" || work.aiStatus === "final_feedback_ready") return "内容を確認";
  if (work.aiStatus === "revision_required") return "修正する";
  if (["theme_intake", "intake_required", "intake_reviewing", "intake_followup_required", "answering", "prompt_generated", "followup_required", "error"].includes(work.aiStatus)) return "続きから";
  if (Number(work.miniRemainingCount || 0) > 0) return "条件を見る";
  if (Number(work.videoRemainingCount || 0) > 0) return "条件を見る";
  if (work.canStartAiWork === false) return "条件を見る";
  return "挑戦する";
}

function getWorkRequirementLabel(work) {
  const miniRemaining = Number(work.miniRemainingCount || 0);
  const videoRemaining = Number(work.videoRemainingCount || 0);
  if (work.hasPassed || work.aiStatus === "completed") return "クリア済み";
  if (miniRemaining > 0) return `関連ミニワーク あと${miniRemaining}件`;
  if (videoRemaining > 0) return `関連動画 あと${videoRemaining}件`;
  return "挑戦できます";
}

function getLessonWorkCtaLabel(status) {
  if (status === "completed" || status === "final_feedback_ready") return "ワーク内容を確認";
  if (!status || ["not_started", "theme_intake", "intake_required"].includes(status)) return "ワークに挑戦する";
  return "ワークを再開する";
}

function getEvaluationResultHelp(status) {
  if (status === "good") return "クリア: 基準を満たしています。次の教材へ進めます。";
  if (status === "needs_more" || status === "failed") return "もう少し具体化: 数字・場面・行動を足すとクリアに近づきます。";
  if (status === "support_needed") return "サポート相談: 一人で抱えず、公式LINEで相談しながら整えましょう。";
  return "評価中: 提出内容を確認しています。";
}

function getLearningLessonCta(lesson) {
  const nextAction = getLessonCta(lesson);
  if (lesson.isComplete) return { ...nextAction, label: "ふり返る", href: hashForLesson(lesson.lesson_id) };
  if (lesson.progress.video_status === "watched") return { ...nextAction, label: "続きから登る" };
  return { ...nextAction, label: "ここから登る" };
}

function getLessonCta(lesson) {
  if (lesson.progress.video_status !== "watched") {
    return {
      label: "動画からはじめる",
      href: hashForLesson(lesson.lesson_id, "video"),
      shortNote: "動画から開始",
      summary: `「${lesson.lesson_title}」の動画を視聴しましょう。`
    };
  }

  if (lesson.miniWork && lesson.progress.mini_work_status === "not_submitted") {
    return {
      label: "ミニワークへ進む",
      href: hashForLesson(lesson.lesson_id, "mini-work"),
      shortNote: "学びを言語化",
      summary: `「${lesson.lesson_title}」のミニワークで、学びを言葉にしましょう。`
    };
  }

  if (lesson.miniWork && ["needs_more", "failed"].includes(lesson.progress.mini_work_status)) {
    return {
      label: "ミニワークを仕上げる",
      href: hashForLesson(lesson.lesson_id, "mini-work"),
      shortNote: "具体化して再提出",
      summary: `「${lesson.lesson_title}」のミニワークを、もう少し具体化すればクリアです。`
    };
  }

  if (lesson.miniWork && lesson.progress.mini_work_status === "support_needed") {
    return {
      label: "ミニワークを確認する",
      href: hashForLesson(lesson.lesson_id, "mini-work"),
      shortNote: "提出内容を確認",
      summary: `「${lesson.lesson_title}」の提出内容を確認し、続きから取り組みましょう。`
    };
  }

  if (lesson.work && lesson.progress.work_status === "unlocked") {
    return {
      label: "本ワークへ挑む",
      href: hashForWork(lesson.work.work_id),
      shortNote: "実践ワークへ",
      summary: `「${lesson.lesson_title}」の本ワークへ進みましょう。`
    };
  }

  if (lesson.work && lesson.progress.work_status === "locked" && lesson.nextUnlockLessonId) {
    const nextContext = findLessonContext(state.learning, lesson.nextUnlockLessonId);
    return {
      label: "次の動画へ進む",
      href: hashForLesson(lesson.nextUnlockLessonId, "video"),
      shortNote: "解放条件を進める",
      summary: `関連ミニワークをクリアするとワークがひらきます。次は「${nextContext?.lesson?.lesson_title || getLessonDisplayNumber(lesson.nextUnlockLessonId)}」へ進みましょう。`
    };
  }

  if (lesson.work && ["needs_more", "failed"].includes(lesson.progress.work_status)) {
    return {
      label: "ワークを仕上げる",
      href: hashForWork(lesson.work.work_id),
      shortNote: "精度を上げる",
      summary: `「${lesson.lesson_title}」のワークを具体化しましょう。`
    };
  }

  if (lesson.work && ["good", "support_needed"].includes(lesson.progress.work_status)) {
    return {
      label: "提出内容を確認する",
      href: hashForWork(lesson.work.work_id),
      shortNote: "フィードバック確認",
      summary: `「${lesson.lesson_title}」の提出内容を確認できます。`
    };
  }

  return {
    label: "レッスンをひらく",
    href: hashForLesson(lesson.lesson_id),
    shortNote: "内容を確認",
    summary: `「${lesson.lesson_title}」を確認しましょう。`
  };
}

function hashForLesson(lessonId, section = "") {
  const suffix = section ? `?section=${encodeURIComponent(section)}` : "";
  return `#/lesson/${encodeURIComponent(lessonId)}${suffix}`;
}

function hashForWork(workId) {
  return `#/work/${encodeURIComponent(workId)}`;
}

// ワーク完了後は「次のワーク」ではなく、ワークが紐づくレッスンの“次レッスン動画”へ導く。
// （例：W-P1-05＝ビジョン整理→ 次はP1-06の動画。間のP1-06/07/08を飛ばさない。レッスン順序に沿わせる）
function getNextLessonAfterWork(work) {
  const anchorLessonId = work.primaryLessonId
    || work.related_lesson_id
    || (Array.isArray(work.related_lesson_ids) ? work.related_lesson_ids[0] : "");
  if (!anchorLessonId || !state.learning) return null;
  const ctx = findLessonContext(state.learning, anchorLessonId);
  if (!ctx) return null;
  return getNextLesson(state.learning, ctx.lesson);
}

function findLessonContext(learning, lessonId) {
  for (const phase of learning.phases) {
    const lesson = phase.lessons.find((item) => item.lesson_id === lessonId);
    if (lesson) return { phase, lesson };
  }
  return null;
}

function findLessonByMiniWorkId(miniWorkId) {
  for (const phase of state.learning?.phases || []) {
    const lesson = phase.lessons.find((item) => item.miniWork?.mini_work_id === miniWorkId);
    if (lesson) return lesson;
  }
  return null;
}

function getNextLesson(learning, lesson) {
  const lessons = learning.phases
    .filter((phase) => phase.isAccessible)
    .flatMap((phase) => phase.lessons.map((item) => ({ ...item, phaseOrder: phase.phase_order })))
    .sort((a, b) => a.phaseOrder - b.phaseOrder || a.lesson_order - b.lesson_order);
  const index = lessons.findIndex((item) => item.lesson_id === lesson.lesson_id);
  return index >= 0 ? lessons[index + 1] || null : null;
}

function focusLessonSection(section) {
  if (!section) {
    scrollToPageTop();
    return;
  }

  const target = document.querySelector(`[data-section="${CSS.escape(section)}"]`);
  if (!target) return;
  scrollToTarget(target);
  target.focus({ preventScroll: true });
}

function scrollToPageTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToTarget(target) {
  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 16);
  window.scrollTo({ top, behavior: "smooth" });
}

function scheduleMiniWorkEvaluationScroll() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = document.querySelector('[data-evaluation-result="mini-work"]');
      if (!target) return;
      scrollToTarget(target);
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });
}

function toEmbedUrl(url) {
  if (url.includes("youtube.com/watch?v=")) {
    return url.replace("watch?v=", "embed/");
  }
  if (url.includes("youtu.be/")) {
    return url.replace("youtu.be/", "www.youtube.com/embed/");
  }
  return url;
}

/* ============================================================
   状態同期
   ============================================================ */

async function refreshLearningState() {
  state.learning = await provider.getLearningState(state.email);
  if (!state.selectedPhaseId) {
    state.selectedPhaseId = state.learning.currentPhase?.phase_id || "";
  }
}

/* ============================================================
   ハンドラ（V5ロジック準拠・変更禁止領域）
   ============================================================ */

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  if (!button || button.disabled) return;
  const originalMarkup = button.innerHTML;
  let email = "";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "確認しています\u2026";

  try {
    email = normalizeEmail(new FormData(form).get("email"));
    const result = await provider.login(email);
    if (!result.ok) {
      renderLogin(loginErrorMessage(result), email, true);
      return;
    }

    state.email = email;
    saveSession(email);
    await refreshLearningState();
    const nextRoute = state.pendingRoute || "#/home";
    state.pendingRoute = "";
    window.location.hash = nextRoute;
    render();
  } catch (error) {
    renderLogin(loginErrorMessage({ reason: "auth_unavailable" }), email, true);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = originalMarkup;
  }
}

function loginErrorMessage(result = {}) {
  if (result.message) return result.message;
  if (result.reason === "empty") return "メールアドレスを入力してください。";
  if (result.reason === "invalid_email") return "メールアドレスの形式を確認してください。";
  if (result.reason === "inactive") return "このメールアドレスは現在利用できません。公式LINEからサポートへお問い合わせください。";
  if (result.reason === "auth_unavailable") return "ログイン確認に時間がかかっています。少し時間を置いて再度お試しください。";
  return "登録情報が見つかりませんでした。公式LINEで登録したメールアドレスをご確認ください。";
}

function buildJudgeFeedback(evaluation) {
  if (!evaluation) return "";
  const isPassed = evaluation.result_status === "good";
  const points = isPassed
    ? uniqueLearnerItems(evaluation.good_points || []).slice(0, 2)
    : uniqueLearnerItems(evaluation.improvement_points || []).slice(0, 2);
  const lines = points.length ? points : [getEvaluationResultHelp(evaluation.result_status)];
  return lines.join("\n");
}

async function handleSubmitWork(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) return;
  const isMiniWork = form.dataset.form === "mini-work";

  if (isMiniWork && !validateMiniWorkAnswer(answer, form.dataset.targetId)) {
    showMiniWorkInputError(form, form.dataset.targetId);
    return;
  }

  clearMiniWorkInputError(form);
  const targetId = form.dataset.targetId;
  const submitButton = form.querySelector("button[type='submit']");
  const originalButtonText = submitButton.textContent;
  clearFormSubmissionError(form);
  submitButton.disabled = true;
  submitButton.classList.add("is-loading");
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "回答を確認しています";

  const route = parseRoute();
  const prevPercent = Math.max(0, Math.min(100, Number(state.learning?.progressSummary?.percent) || 0));

  if (isMiniWork) {
    openJudgeOverlay("AIが回答を確認しています");
  }

  try {
    if (isMiniWork) {
      await provider.submitMiniWork(state.email, targetId, answer);
      if (route.name === "lesson") {
        window.location.hash = hashForLesson(route.lessonId, "mini-work");
      }
    } else {
      await provider.submitWork(state.email, targetId, answer, form.dataset.lessonId || "");
      if (route.name === "lesson") {
        window.location.hash = hashForLesson(route.lessonId, "work");
      }
    }

    await refreshLearningState();
    render();

    if (isMiniWork) {
      const lesson = findLessonByMiniWorkId(targetId);
      const evaluation = lesson?.latestMiniEvaluation || null;
      const newPercent = Math.max(0, Math.min(100, Number(state.learning?.progressSummary?.percent) || 0));
      const grew = newPercent > prevPercent;
      const passed = evaluation?.result_status === "good";
      const hasScore = Number.isFinite(Number(evaluation?.score));

      if (!evaluation || !hasScore) {
        closeJudgeOverlay();
        scheduleMiniWorkEvaluationScroll();
      } else {
        showJudgeResult({
          score: Number(evaluation.score),
          passed,
          feedback: buildJudgeFeedback(evaluation),
          scoreNote: "SCORE / 合格80",
          buttonLabel: passed
            ? "次のレッスンへ"
            : (evaluation.result_status === "support_needed" ? "内容を確認する" : "回答を書き直す"),
          onNext: () => {
            closeJudgeOverlay();
            if (passed && grew) {
              pendingGrowth = { from: prevPercent, to: newPercent };
              if (window.location.hash === "#/home") {
                render();
              } else {
                window.location.hash = "#/home";
              }
            } else {
              scheduleMiniWorkEvaluationScroll();
            }
          }
        });
      }
    }
  } catch (error) {
    if (isMiniWork) closeJudgeOverlay();
    showFormSubmissionError(form, error.message);
  } finally {
    if (document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.classList.remove("is-loading");
      submitButton.removeAttribute("aria-busy");
      submitButton.textContent = originalButtonText;
    }
  }
}

async function handleSubmitQuiz(event) {
  event.preventDefault();
  const form = event.target;
  const quizId = form.dataset.quizId;
  const answers = formDataToObject(new FormData(form));
  const questionCount = form.querySelectorAll("[data-quiz-question]").length;
  const submitButton = form.querySelector("button[type='submit']");
  if (Object.keys(answers).length !== questionCount || questionCount !== 5) {
    showFormSubmissionError(form, "5問すべてに回答してください。");
    return;
  }

  const originalButtonText = submitButton.textContent;
  clearFormSubmissionError(form);
  submitButton.disabled = true;
  submitButton.setAttribute("aria-disabled", "true");
  submitButton.classList.add("is-loading");
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "保存して採点しています";
  try {
    await provider.submitQuizAttempt(state.email, quizId, answers);
    await refreshLearningState();
    const route = parseRoute();
    if (route.name === "lesson") window.location.hash = hashForLesson(route.lessonId, "quiz");
    render();
  } catch (error) {
    // 失敗時は再描画しないため、選択内容をそのまま残す。
    showFormSubmissionError(form, error.message);
  } finally {
    if (document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.setAttribute("aria-disabled", "false");
      submitButton.classList.remove("is-loading");
      submitButton.removeAttribute("aria-busy");
      submitButton.textContent = originalButtonText;
    }
  }
}

// 入力ゲートの検知器（設問の①②③の「形」を軽く確認する。合否採点ではない＝空・超短文・無関係作文の足切り用。
// 実際の合否は evaluate-work.js の AI評価＋決定論フロアが担う。ここでは設問ごとに必要な要素だけを見る）
const MINI_WORK_GATE_DETECTORS = {
  action: (t) => /(する|します|試す|試し|実行|改善|設定|決め|伝え|記録|見直|共有|使う|使い|行う|充て|回す|据え|繋げ|つなげ|振り分け|購入|特定|着手|分ける|片付け|整理|見送|差し替え|送る|渡す|作る|作成|進め|活用|導入|徹底|標準化|仕組み化|棚卸|添付|提示|提案|検証|割り当て|割く|ブロック|片付|取る|入れる|持参|確認|問い直|絞る)/.test(t),
  choice: (t) => /(選ん|選び|選択|決め|「[^」]{1,40}」|１つに|一つに|1つに|に絞|絞り|絞る|最優先|マストワン|一番)/.test(t),
  reason: (t) => /(なぜ|理由|ため|から|なので|目的|狙い|背景|きっかけ|効く|効果|優先|直結|最も|一番[^」]{0,6}(高い|大きい|重要))/.test(t),
  scene: (t) => /(今日|明日|今週|来週|今月|来月|毎週|毎日|月曜|火曜|水曜|木曜|金曜|土曜|日曜|午前|午後|朝|昼|夕方|夜|商談|会議|面談|顧客|上司|同僚|チーム|現場|店舗|サロン|電話|メール|LINE|資料|画面|来店|予約|施術|カルテ|投稿|SNS|案件|受注|提案|架電|請求|見積|納品|会計|カウンセリング|リマインド|セミナー|台帳|スプレッドシート|[0-9０-９]+[日月週時分件回%％人本円名割])/.test(t),
  wish: (t) => /(したい|叶え|なりたい|欲しい|ほしい|過ごしたい|会いたい|言いたい|回りたい|築きたい|育てたい|状態になりたい|お礼を)/.test(t),
  deadline: (t) => /(期限|まで(に|は)?[^。]{0,6}(に|作る|始め|達成)|[0-9０-９]+\s*(年|月|日|ヶ月|か月|週間)後?|年内|今年中|来年|再来年|20[0-9][0-9]年)/.test(t),
  self: (t) => /(自分にできる|自分の|私が|僕が|していなかった|やっていなかった|べきだった|次から|次回から|しておらず|打診を|同席|自分の行動|反省)/.test(t),
  structure: (t) => /(構造|環境|仕組み|要因|周り|周囲|外部|状況|前提|条件|サイクル|タイミング|予算|相手の|先方|市場|制度|フロー|導線)/.test(t),
  narrow: (t) => /(絞|部署|時間帯|工程|範囲|に限|のうち|だけ|平日|休日|土日|午前|午後|夕方|フェーズ|プロセス)/.test(t),
  common: (t) => /(共通点|共通|抽象|まとめると|本質|つまり|要は|どちらも|いずれも|同じ|一般化)/.test(t),
  quantify: (t) => /[0-9０-９]+\s*[件回%％人本円名割日月週時分]/.test(t),
  struct3: (t) => ((/目的/.test(t) ? 1 : 0) + (/戦略/.test(t) ? 1 : 0) + (/戦術/.test(t) ? 1 : 0)) >= 2,
  hypothesis: (t) => /(ではないか|のでは|かもしれ|仮説|と考え|メカニズム|原因は|見せかけ|検証)/.test(t),
  kpi: (t) => /(KPI|KGI|KDI|指標|目標値|追跡|計測|測定|数値化|数字で見|数値で)/i.test(t),
  issue: (t) => /(課題|イシュー|問題|論点|事象)/.test(t),
  kpt: (t) => (((/keep/i.test(t) || /続け/.test(t)) ? 1 : 0) + ((/problem/i.test(t) || /課題|問題/.test(t)) ? 1 : 0) + ((/try/i.test(t) || /試す|やってみ/.test(t)) ? 1 : 0)) >= 2 || /(やったこと|わかったこと|次にやること|期待.*効果)/.test(t),
  tree: (t) => /(ツリー|分解|why|how|段階|階層|枝分|下位|→)/i.test(t),
  whychain: (t) => ((t.match(/→/g) || []).length >= 1) || ((t.match(/なぜ/g) || []).length >= 2) || /真因|根本原因|本質的な原因/.test(t),
  ground3: (t) => ((t.match(/[①-⑨]/g) || []).length >= 2) || /根拠|事実/.test(t),
  enum: (t) => ((t.match(/[①-⑨]/g) || []).length >= 3) || ((t.match(/、/g) || []).length >= 3) || /【[^】]+】/.test(t)
};

// 設問ごとに「必ず入っていてほしい要素」（実設問の①②③の形に対応。全て満たすと通過）
const MINI_WORK_GATE_PROFILE = {
  "MW-P1-01": ["choice", "reason", "scene"],
  "MW-P1-02": ["choice", "reason", "scene"],
  "MW-P1-03": ["choice", "reason", "scene"],
  "MW-P1-04": ["enum", "reason"],
  "MW-P1-05": ["wish", "deadline"],
  "MW-P1-06": ["self", "structure"],
  "MW-P1-07": ["narrow", "common"],
  "MW-P1-08": ["choice", "reason", "scene"],
  "MW-P2-01": ["quantify", "scene"],
  "MW-P2-02": ["struct3"],
  "MW-P2-03": ["kpi", "quantify"],
  "MW-P2-04": ["kpi", "choice"],
  "MW-P2-05": ["issue", "hypothesis"],
  "MW-P2-06": ["issue", "hypothesis"],
  "MW-P2-07": ["issue", "whychain"],
  "MW-P2-08": ["kpt"],
  "MW-P2-09": ["ground3", "scene"],
  "MW-P2-10": ["issue", "tree"]
};

// 却下メッセージ（当該設問に沿う文言）
const MINI_WORK_GATE_MESSAGE = {
  "MW-P1-01": "選んだ行動・その理由・いつ/どんな場面で試すかを入れると評価できます。",
  "MW-P1-02": "選んだ方法・その理由・試す場面を入れると評価できます。",
  "MW-P1-03": "選んだ方法・その理由・どのタスク/場面で試すかを入れると評価できます。",
  "MW-P1-04": "やること一覧と、一番に選んだ理由を書いてください。",
  "MW-P1-05": "①制限がなければ何をしたいか ②最後の1日なら何をするか ③本当に叶えたいこと1つと期限、を書いてください。",
  "MW-P1-06": "①自分にできること ②構造・環境などの要因、の両面を書いてください。",
  "MW-P1-07": "①課題を部署・時間帯・工程などで絞り ②2つのものの共通点、を書いてください。",
  "MW-P1-08": "選んだ練習・その理由・試す場面を入れると評価できます。",
  "MW-P2-01": "取り組む仕事と、行動量を数値で（いつ振り返るかも）書いてください。",
  "MW-P2-02": "目的・戦略・戦術の3層で整理して書いてください。",
  "MW-P2-03": "具体的なKPIと現状の数値、KGIとのつながりを書いてください。",
  "MW-P2-04": "複数のKPIを挙げ、最優先の1つに絞ってその理由を書いてください。",
  "MW-P2-05": "課題と『〜ではないか？』の問いの形で書いてください。",
  "MW-P2-06": "課題と、その原因の仮説『〜ではないか？』を書いてください。",
  "MW-P2-07": "具体的な事象と、なぜの連鎖・真因を書いてください。",
  "MW-P2-08": "Keep・Problem・Try など振り返りの要素を書いてください。",
  "MW-P2-09": "テーマと、それを支える根拠3点を書いてください。",
  "MW-P2-10": "課題と、それをWhy/Howで分解した内容を書いてください。"
};

function validateMiniWorkAnswer(answer, miniWorkId) {
  const text = String(answer || "").trim();
  const normalized = text.replace(/\s+/g, "");
  const placeholderPattern = /^(テスト|test|TEST|仮|仮入力|サンプル|sample|aaa|aaaa|あああ|いいい|ううう|確認|入力|未定|なし|特になし|特にない|とりあえず|ダミー|dummy|asdf|qwer|123|１２３|頑張ります|がんばります|分かりました|わかりました|やります|意識します|改善します)[。.!！]*$/i;

  // 足切り（空・超短文・プレースホルダ・同一文字連打）＝ここは全設問共通で維持
  if (normalized.length < 24) return false;
  if (placeholderPattern.test(normalized)) return false;
  if (/^(.)\1{4,}$/.test(normalized)) return false;

  // 設問ごとに必要な要素を確認。未知IDは汎用（行動・理由・場面）にフォールバック
  const profile = MINI_WORK_GATE_PROFILE[miniWorkId] || ["action", "reason", "scene"];
  for (const key of profile) {
    const detect = MINI_WORK_GATE_DETECTORS[key];
    if (typeof detect === "function" && !detect(text)) return false;
  }
  return true;
}

function showMiniWorkInputError(form, miniWorkId) {
  clearMiniWorkInputError(form);
  const textarea = form.querySelector("textarea[name='answer']");
  const message = document.createElement("div");
  message.className = "form-error mini-work-input-error";
  message.setAttribute("role", "alert");
  const hint = MINI_WORK_GATE_MESSAGE[miniWorkId] || MINI_WORK_INPUT_ERROR_MESSAGE;
  message.textContent = `もう少し具体的に書いてください。${hint}`;
  if (textarea) {
    textarea.setAttribute("aria-invalid", "true");
    textarea.insertAdjacentElement("afterend", message);
    textarea.focus();
  } else {
    form.prepend(message);
  }
  document.querySelector('[data-evaluation-result="mini-work"]')?.remove();
}

function clearMiniWorkInputError(form) {
  form.querySelector(".mini-work-input-error")?.remove();
  const textarea = form.querySelector("textarea[name='answer']");
  textarea?.removeAttribute("aria-invalid");
}

function showFormSubmissionError(form, message) {
  clearFormSubmissionError(form);
  const error = document.createElement("div");
  error.className = "form-error form-submit-error";
  error.setAttribute("role", "alert");
  error.textContent = safeLearnerErrorMessage(message);
  const textarea = form.querySelector("textarea");
  if (textarea) {
    textarea.insertAdjacentElement("afterend", error);
    textarea.focus();
  } else {
    form.prepend(error);
  }
}

function clearFormSubmissionError(form) {
  form.querySelector(".form-submit-error")?.remove();
}

const AI_FORM_WAIT_MESSAGE = {
  "ai-theme": "AIがあなた専用の問いを整えています",
  "ai-answer": "AIが回答を確認しています",
  "ai-intake-followup": "AIが内容を確認しています",
  "ai-followup": "AIが回答を確認しています",
  "ai-revision": "AIが回答を確認しています"
};

async function handleSubmitAiWork(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const workId = form.dataset.workId;
  const formKind = form.dataset.form;
  const submitButton = form.querySelector("button[type='submit']");
  const originalButtonText = submitButton.textContent;
  clearFormSubmissionError(form);
  submitButton.disabled = true;
  submitButton.classList.add("is-loading");
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "AIが確認しています";

  const evaluationForms = ["ai-answer", "ai-followup", "ai-revision"];
  const overlayGeneration = ++judgeResultGeneration;
  openJudgeOverlay(AI_FORM_WAIT_MESSAGE[formKind] || "AIが確認しています");

  try {
    let submittedSession = null;
    if (formKind === "ai-theme") {
      submittedSession = await provider.startAiWork(state.email, workId, formDataToObject(formData));
    }

    if (formKind === "ai-answer") {
      submittedSession = await provider.submitAiWorkAnswer(state.email, workId, formData.get("answer"));
    }

    if (formKind === "ai-intake-followup") {
      submittedSession = await provider.submitAiWorkIntakeFollowup(state.email, workId, formData.get("intake_followup_answer"));
    }

    if (formKind === "ai-followup") {
      submittedSession = await provider.submitAiWorkFollowup(state.email, workId, formData.get("followup_answer"));
    }

    if (formKind === "ai-revision") {
      submittedSession = await provider.submitAiWorkRevision(state.email, workId, formData.get("revision_answer"));
    }

    await refreshLearningState();
    window.location.hash = hashForWork(workId);
    render();

    const work = (state.learning?.works || []).find((item) => item.work_id === workId);
    const refreshedSession = work?.aiSession || null;
    // submit APIの確定結果を捨ててrefresh後の再構成sessionだけを見ると、
    // 復元・再描画のタイミング次第でリングが初期値0のままになる。
    // 今回のsubmission IDを持つ返却sessionを優先し、後着の古い状態を表示しない。
    const session = submittedSession?.work_id === workId && submittedSession?.ai_evaluation_result
      ? submittedSession
      : refreshedSession;
    const evaluation = session?.ai_evaluation_result || null;
    const hasScore = evaluation?.score !== undefined && evaluation?.score !== null &&
      String(evaluation.score).trim() !== "" && Number.isFinite(Number(evaluation.score));

    if (evaluationForms.includes(formKind) && evaluation && hasScore) {
      const passed = ["completed", "final_feedback_ready"].includes(session.status);
      await showJudgeResult({
        score: Number(evaluation.score),
        passed,
        feedback: evaluation.summary || "",
        scoreNote: "SCORE",
        buttonLabel: passed
          ? "次の一歩へ →"
          : (session.status === "revision_required" ? "もう一度整理する" : "続きへ"),
        onNext: () => {
          closeJudgeOverlay();
          scrollToPageTop();
        },
        generation: overlayGeneration
      });
    } else {
      closeJudgeOverlay();
    }
  } catch (error) {
    closeJudgeOverlay();
    showFormSubmissionError(form, error.message);
  } finally {
    if (document.body.contains(submitButton)) {
      submitButton.disabled = false;
      submitButton.classList.remove("is-loading");
      submitButton.removeAttribute("aria-busy");
      submitButton.textContent = originalButtonText;
    }
  }
}

async function handleToggleVideoCompletion(button) {
  const originalButtonText = button.textContent;
  const completed = button.dataset.completed === "true";
  clearInlineActionError(button);
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  button.textContent = completed ? "取り消しています" : "記録しています";
  try {
    await provider.setVideoCompletion(state.email, button.dataset.lessonId, !completed);
    await refreshLearningState();
    render();
  } catch (error) {
    showInlineActionError(button, error.message);
  } finally {
    if (document.body.contains(button)) {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
      button.textContent = originalButtonText;
    }
  }
}

function showInlineActionError(target, message) {
  clearInlineActionError(target);
  const error = document.createElement("div");
  error.className = "form-error inline-action-error";
  error.setAttribute("role", "alert");
  error.textContent = safeLearnerErrorMessage(message);
  target.insertAdjacentElement("afterend", error);
  target.focus();
}

function clearInlineActionError(target) {
  target.parentElement?.querySelector(".inline-action-error")?.remove();
}

document.addEventListener("submit", async (event) => {
  try {
    if (event.target.matches("#login-form")) {
      await handleLogin(event);
    }

    if (event.target.matches(".quiz-form")) {
      await handleSubmitQuiz(event);
    }

    if (event.target.matches(".work-form")) {
      await handleSubmitWork(event);
    }

    if (event.target.matches(".ai-work-form")) {
      await handleSubmitAiWork(event);
    }
  } catch (error) {
    renderError(error.message);
  }
});

document.addEventListener("change", (event) => {
  const form = event.target.closest?.(".quiz-form");
  if (!form) return;
  form.querySelectorAll('.quiz-question label').forEach((label) => {
    const input = label.querySelector('input[type="radio"]');
    label.classList.toggle("is-selected", Boolean(input?.checked));
  });
  const questionCount = form.querySelectorAll("[data-quiz-question]").length;
  const answeredCount = new FormData(form).entries
    ? Array.from(new FormData(form).keys()).length
    : 0;
  const button = form.querySelector(".quiz-submit-button");
  const ready = questionCount === 5 && answeredCount === 5;
  if (button) {
    button.disabled = !ready;
    button.setAttribute("aria-disabled", ready ? "false" : "true");
  }
});

document.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;

  if (action === "logout") {
    clearSession();
    state.email = "";
    state.learning = null;
    homeRingShown = false;
    pendingGrowth = null;
    window.location.hash = "#/login";
    renderLogin();
  }

  if (action === "reload") {
    window.location.reload();
  }

  if (action === "toggle-video-completion") {
    try {
      await handleToggleVideoCompletion(actionTarget);
    } catch (error) {
      renderError(error.message);
    }
  }

  if (action === "retry-ai-work") {
    try {
      await provider.retryAiWork(state.email, actionTarget.dataset.workId);
      await refreshLearningState();
      render();
    } catch (error) {
      renderError(error.message);
    }
  }

  if (action === "restart-ai-work") {
    try {
      await provider.restartAiWork(state.email, actionTarget.dataset.workId);
      await refreshLearningState();
      window.location.hash = hashForWork(actionTarget.dataset.workId);
      render();
    } catch (error) {
      renderError(error.message);
    }
  }

  if (action === "continue-ai-work-placeholders") {
    try {
      await provider.continueAiWorkWithIntakePlaceholders(state.email, actionTarget.dataset.workId);
      await refreshLearningState();
      window.location.hash = hashForWork(actionTarget.dataset.workId);
      render();
    } catch (error) {
      renderError(error.message);
    }
  }

  if (action === "go-next-lesson") {
    const route = parseRoute();
    const lesson = route.name === "lesson" ? findLessonContext(state.learning, route.lessonId)?.lesson : null;
    const nextLesson = lesson ? getNextLesson(state.learning, lesson) : null;
    window.location.hash = nextLesson ? hashForLesson(nextLesson.lesson_id, "video") : "#/learning";
  }

  if (action === "rewrite-mini-work") {
    const textarea = document.querySelector('.work-form[data-form="mini-work"] textarea[name="answer"]');
    if (textarea) {
      scrollToTarget(textarea);
      textarea.focus({ preventScroll: true });
    }
  }
});

window.addEventListener("hashchange", render);

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formDataToObject(formData) {
  const values = {};
  formData.forEach((value, key) => {
    values[key] = String(value || "").trim();
  });
  return values;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

boot();

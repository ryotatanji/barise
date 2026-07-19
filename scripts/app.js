import {
  clearSession,
  createLearningProvider,
  getAiWorkStatusLabel,
  getLastEmail,
  getStatusLabel,
  getStoredSession,
  normalizeEmail,
  saveSession
} from "./data-provider.js?v=7-2-10";

const app = document.querySelector("#app");
const provider = createLearningProvider();

const config = {
  supportLineUrl: "https://lin.ee/7JnzBxE",
  brandLogo: "./assets/barise-logo-white.png"
};

const LEARNER_FORBIDDEN_PATTERN = /\b(good|needs_more|support_needed|reviewing|failed|debug|mock|internal|pass|retry|review|evaluate-work|gpt-4o-mini|OPENAI_API_KEY|learner_theme|current_situation|current_actions|available_metrics|target_result|strategy_tactic_execution)\b/i;
const MINI_WORK_INPUT_ERROR_MESSAGE = "もう少し具体的に書いてください。選んだ行動・理由・いつ/どこで試すかを入れると評価できます。";

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
        <span class="judge-stamp" id="judgeStamp">★ クリア</span>
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
  judgeDom.classList.remove("on");
  document.body.style.overflow = "";
  resetJudgeOverlay();
}

async function showJudgeResult({ score, passed, feedback, scoreNote, buttonLabel, onNext }) {
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

  const target = Math.max(0, Math.min(100, Number(score) || 0));

  /* リング立ち上がり（back.out(1.6) / .45s） */
  await tween({
    from: 0, to: 1, duration: 450, ease: easeBackOut(1.6),
    onUpdate: (v) => {
      ringWrap.style.opacity = String(Math.max(0, Math.min(1, v)));
      ringWrap.style.transform = `scale(${.85 + .15 * v})`;
    }
  });

  /* スコアは必ず0から実スコアへ満ちる（1.2s） */
  await tween({
    from: 0, to: target, duration: 1200, ease: easePower2Out,
    onUpdate: (v) => {
      scoreEl.textContent = String(Math.round(v));
      ring.style.strokeDashoffset = ringOffset(JUDGE_RING_C, v);
    }
  });

  /* 金のクリアスタンプ（back.out(2.2)）＋粒子22個は good のときだけ */
  if (passed) {
    sparkBurst();
    await tween({
      from: 0, to: 1, duration: 450, ease: easeBackOut(2.2),
      onUpdate: (v) => {
        stamp.style.opacity = String(Math.max(0, Math.min(1, v)));
        stamp.style.transform = `scale(${.8 + .2 * v})`;
      }
    });
  }

  await tween({
    from: 0, to: 1, duration: 500,
    onUpdate: (v) => { fb.style.opacity = String(Math.max(0, Math.min(1, v))); }
  });

  await tween({
    from: 0, to: 1, duration: 450,
    onUpdate: (v) => {
      next.style.opacity = String(Math.max(0, Math.min(1, v)));
      next.style.transform = `translateY(${10 * (1 - v)}px)`;
    }
  });
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
  app.innerHTML = `
    <main class="login-screen">
      <img src="${config.brandLogo}" alt="Barise" class="login-brand">
      <section class="login-panel" aria-labelledby="error-title">
        <p class="eyebrow">CONSOLE</p>
        <h1 id="error-title">ページをひらけませんでした</h1>
        <p class="lead">${escapeHtml(message)}</p>
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
    </main>
  `;
}

/* ============================================================
   共通：ヘッダー・タブナビ
   ============================================================ */

function renderHomeTop(learning) {
  const d = new Date();
  const currentPhase = learning.currentPhase;
  const sub = `${d.getMonth() + 1}/${d.getDate()}${currentPhase ? ` ・ ${escapeHtml(kanjiChapter(currentPhase.phase_order))}` : ""}`;
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

function greetingByHour() {
  const hour = new Date().getHours();
  if (hour < 4) return "こんばんは";
  if (hour < 11) return "おはようございます";
  if (hour < 18) return "こんにちは";
  return "こんばんは";
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
        </section>

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
        showToast(`標高が上がりました <span class="g">${growth.from}% → ${growth.to}%</span>`);
      }, 450);
    } else if (!homeRingShown) {
      homeRingShown = true;
      tween({
        from: 0, to: percent, duration: 1300, delay: 250, ease: easePower2Out,
        onUpdate: (v) => setHomeRing(v)
      });
    } else {
      setHomeRing(percent);
    }
  });
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
  const no = padChapter(phase.phase_order);

  let stateMarkup = `<span class="ch-state">これから</span>`;
  if (stateName === "done") stateMarkup = `<span class="ch-state done">★ クリア</span>`;
  if (stateName === "current") stateMarkup = `<span class="ch-state here"><span class="here-dot" aria-hidden="true"></span>いまここ</span>`;
  if (stateName === "locked") stateMarkup = `<span class="ch-state lock">🔒 解放待ち</span>`;

  const inner = `
    <b><span class="no">${no}</span>${escapeHtml(phase.phase_title)}</b>
    ${stateMarkup}
    <div class="ch-mini"><div class="mbar"><span style="width:${pct}%"></span></div><em>${done}/${total}</em></div>
  `;

  if (stateName === "locked") {
    return `<div class="ch-row is-locked" aria-label="${escapeAttribute(phase.phase_title)}（解放待ち）">${inner}</div>`;
  }

  const target = chapterTargetLesson(learning, phase);
  const href = target ? hashForLesson(target.lesson_id) : "#/learning";
  return `<a class="ch-row" href="${escapeAttribute(href)}">${inner}</a>`;
}

/* ============================================================
   学習一覧（#/learning）
   ============================================================ */

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
        ${phases.map((phase, index) => renderPhaseGroup(learning, phase, index)).join("")}
        <div class="page-foot">
          <a class="text-link" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
        </div>
      </main>
    </div>
  `;

  requestAnimationFrame(() => scrollToPageTop());
}

function renderPhaseGroup(learning, phase, index) {
  const stateName = chapterState(learning, phase);
  const done = Number(phase.completedCount || 0);
  const total = Number(phase.lessonCount || 0);
  const no = padChapter(phase.phase_order);
  const riseClass = index < 4 ? ` rise rise-${index}` : "";

  if (stateName === "locked") {
    return `
      <section class="phase-group${riseClass}" aria-label="${escapeAttribute(phase.phase_title)}（解放待ち）">
        <div class="phase-head">
          <span class="ph-title"><span class="no">${no}</span>${escapeHtml(phase.phase_title)}</span>
          <span class="ph-count">🔒 解放待ち</span>
        </div>
        <p class="phase-locked-note">${escapeHtml(phase.phase_summary || "前の章を登りきると、この章の景色がひらけます。")}</p>
      </section>
    `;
  }

  return `
    <section class="phase-group${riseClass}" aria-label="${escapeAttribute(phase.phase_title)}">
      <div class="phase-head">
        <span class="ph-title"><span class="no">${no}</span>${escapeHtml(phase.phase_title)}</span>
        <span class="ph-count${stateName === "done" ? " done" : ""}">${stateName === "done" ? "★ クリア " : ""}${done}/${total}</span>
      </div>
      ${phase.lessons.map((lesson) => renderLessonRow(learning, phase, lesson)).join("") || `<p class="phase-locked-note">この章の教材は順次ひらいていきます。</p>`}
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
    <span class="ls-id">${escapeHtml(lesson.lesson_id)}</span>
    <div class="ls-side">
      ${stateMarkup}
      ${ctaMarkup}
    </div>
    <h4>${escapeHtml(lesson.lesson_title)}</h4>
    <p class="ls-sub">${escapeHtml(stationSubText(lesson))}${stateName === "locked" ? " ・ 前の教材をクリアするとひらきます" : ""}</p>
  `;

  if (stateName === "locked") {
    return `<div class="ls-row is-locked">${inner}</div>`;
  }
  return `<a class="ls-row${stateName === "current" ? " is-current" : ""}" href="${escapeAttribute(cta.href)}">${inner}</a>`;
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
      ${renderBackTop("#/learning", "戻る", `${phase ? kanjiChapter(phase.phase_order) : ""} ・ ${lesson.lesson_id}`)}
      <main>
        <div class="lesson-title">
          <p class="lt-k">CHAPTER ${padChapter(phase?.phase_order)}</p>
          <h1>${escapeHtml(lesson.lesson_title)}</h1>
          <p class="lt-sub">${escapeHtml(lesson.lesson_summary || lesson.purpose_watch || "この教材の目的を確認します。")}</p>
        </div>

        ${renderVideoBlock(lesson)}
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
      ${isWatched
        ? `<p class="watch-note"><i>✓</i> 視聴済み ・ 目安 ${escapeHtml(duration)}</p>`
        : `
          <button class="primary-button watch-button" type="button" data-action="mark-video" data-lesson-id="${escapeHtml(lesson.lesson_id)}">
            動画を見たら視聴完了にする
          </button>
          <p class="submission-note">目安 ${escapeHtml(duration)}</p>
        `}
    </section>
  `;
}

function renderMiniWorkBlock(lesson) {
  if (!lesson.miniWork) return "";
  const submission = lesson.latestMiniSubmission;
  const value = submission?.answer_text || "";
  const placeholder = getMiniWorkPlaceholder(lesson.miniWork);
  const submitLabel = submission ? "もう一度確認してもらう" : "AIに確認してもらう";

  return `
    <section id="section-mini-work" class="mini-panel" data-section="mini-work" tabindex="-1" aria-labelledby="mini-work-title">
      <p class="mp-k">MINI WORK ${renderStatusBadge(lesson.progress.mini_work_status)}</p>
      <h3 id="mini-work-title">${escapeHtml(lesson.miniWork.title)}</h3>
      <p class="mp-hint">${escapeHtml(lesson.miniWork.prompt)}</p>
      ${lesson.practice_part ? `
        <div class="mp-callout">
          <span>実践の問い</span>
          ${escapeHtml(lesson.practice_part)}
        </div>
      ` : ""}
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
    .map((lessonId) => findLessonContext(state.learning, lessonId)?.lesson?.lesson_title || lessonId)
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
  const points = Array.isArray(lesson.material_points) ? lesson.material_points.filter(Boolean) : [];

  return `
    <section id="section-purpose" data-section="purpose" tabindex="-1" aria-labelledby="purpose-title">
      <details class="learn-details">
        <summary>
          <span id="purpose-title">このレッスンで学ぶこと</span>
          <small class="closed-label">ひらいて確認</small>
          <small class="open-label">閉じる</small>
        </summary>
        <div class="ld-body">
          <div class="ld-item">
            <span>学習目的</span>
            <p>${escapeHtml(lesson.lesson_summary || lesson.purpose_watch || "この教材の目的を確認します。")}</p>
          </div>
          ${points.length ? `
            <div class="ld-item">
              <span>主な内容</span>
              <ul>${points.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
          ` : ""}
          <div class="ld-item">
            <span>視聴後にできるようになること</span>
            <p>${escapeHtml(lesson.learning_outcome || lesson.category_or_work || lesson.purpose_write || "現場で使える視点を整理できます。")}</p>
          </div>
          ${lesson.purpose_watch ? `<div class="ld-item"><span>見る</span><p>${escapeHtml(lesson.purpose_watch)}</p></div>` : ""}
          ${lesson.purpose_think ? `<div class="ld-item"><span>考える</span><p>${escapeHtml(lesson.purpose_think)}</p></div>` : ""}
          ${lesson.purpose_write ? `<div class="ld-item"><span>書く</span><p>${escapeHtml(lesson.purpose_write)}</p></div>` : ""}
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
  const nextTitle = isPassed ? "次に進む前に" : "次に意識すること";
  const resultKind = label === "ミニワーク" ? "mini-work" : "work";
  const resultId = resultKind === "mini-work" ? ` id="mini-work-evaluation-result"` : "";
  const goodPoints = uniqueLearnerItems(evaluation.good_points || []).slice(0, 3);
  const improvementPoints = isPassed ? [] : uniqueLearnerItems(evaluation.improvement_points || []).filter((item) => !goodPoints.includes(item)).slice(0, 3);
  const nextActionText = evaluation.next_action_text || (isPassed ? "次へ進みましょう" : "もう一度具体化する");
  const nextQuestion = !isPassed && evaluation.next_question && evaluation.next_question !== nextActionText
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
      <div class="ev-next">
        <span>${escapeHtml(nextTitle)}</span>
        <strong>${escapeHtml(nextActionText)}</strong>
        ${nextQuestion ? `<p>${escapeHtml(nextQuestion)}</p>` : ""}
      </div>
    </section>
  `;
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
          ${relatedLessons.map((lesson) => `<div><dt>教材</dt><dd><a class="text-link" href="${escapeAttribute(hashForLesson(lesson.lesson_id, "video"))}">${escapeHtml(lesson.lesson_id)} ${escapeHtml(lesson.lesson_title)}</a></dd></div>`).join("")}
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
        <ul>${missingLessons.map((lessonId) => `<li><a class="text-link" href="${escapeAttribute(hashForLesson(lessonId, "video"))}">${escapeHtml(lessonId)} の動画へ</a></li>`).join("")}</ul>
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
    return renderAiAnswerForm(work, session);
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
    ${renderAiGeneratedPrompt(session)}
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
  return `
    ${renderAiGeneratedPrompt(session)}
    ${renderAiCriteriaProgress(session)}
    ${renderAiEvaluationSummary(session)}
    <div class="ai-block ai-block--focus">
      <span>今回答える質問</span>
      <p>${escapeHtml(session.ai_summary || "追加質問に回答してください。")}</p>
    </div>
    ${renderFollowupQuestionPanel(getAiFollowupQuestions(session))}
    ${renderMissingPoints(session.unmet_criteria, "追記すべき観点")}
    ${renderFollowupHistory(session.followup_history)}
    <form class="ai-work-form" data-form="ai-followup" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("followup_answer", "今回答える内容", "", "上の質問に対して、具体場面・数字・判断理由を足して回答してください", 8)}
      <button class="submit2 work-submit-button" type="submit">追加回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiRevisionForm(work, session) {
  return `
    ${renderAiGeneratedPrompt(session)}
    <div class="ai-block ai-block--focus">
      <span>もう一度、いっしょに整理しましょう</span>
      <p class="multiline-text">${escapeHtml(session.ai_feedback || session.ai_summary || "回答の観点を整えて、もう一度送ってください。")}</p>
    </div>
    ${renderMissingPoints(session.unmet_criteria, "追記すべき観点")}
    ${renderStaffFeedbackNotice(session)}
    ${renderFollowupQuestionPanel(getAiFollowupQuestions(session), "今回答える質問")}
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
    ${nextLesson ? `<a class="submit2" href="${escapeAttribute(hashForLesson(nextLesson.lesson_id, "video"))}">次のレッスン「${escapeHtml(nextLesson.lesson_title || "")}」へ進む</a>` : `<a class="submit2" href="#/learning">次の学習へ進む</a>`}
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
          <span class="ls-id">${escapeHtml(lesson.lesson_id)}</span>
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

function renderAiGeneratedPrompt(session) {
  const parts = normalizeAiPromptParts(session);
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
  const goodPoints = evaluation.good_points || [];
  const improvementPoints = evaluation.improvement_points || [];
  const unmetCriteria = evaluation.unmet_criteria || [];
  const scoreText = Number.isFinite(Number(evaluation.score)) && Number(evaluation.score) > 0
    ? `${Number(evaluation.score)}点`
    : "評価中";

  return `
    <div class="ai-block" aria-label="評価結果">
      <div class="ai-summary-head">
        <strong>${escapeHtml(scoreText)}</strong>
        <em>${escapeHtml(evaluation.label || "確認中")}</em>
      </div>
      <p>${escapeHtml(evaluation.summary || "評価結果を保存しました。")}</p>
      ${options.compact ? `
        <details class="ai-details">
          <summary>評価の詳細を見る</summary>
          ${renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria)}
        </details>
      ` : renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria)}
      ${evaluation.next_action ? `<p style="margin-top:6px;">${escapeHtml(evaluation.next_action)}</p>` : ""}
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
  if (work.aiStatus === "completed") return "クリア済み";
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
  if (lesson.isComplete) return { ...nextAction, label: "ふり返る" };
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
      label: "サポートに相談する",
      href: config.supportLineUrl,
      shortNote: "公式LINEで相談",
      summary: `「${lesson.lesson_title}」について、公式LINEで一緒に整理しましょう。`
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
      summary: `関連ミニワークをクリアするとワークがひらきます。次は「${nextContext?.lesson?.lesson_title || lesson.nextUnlockLessonId}」へ進みましょう。`
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
  const email = normalizeEmail(new FormData(form).get("email"));
  const result = await provider.login(email);

  if (!result.ok) {
    const message = loginErrorMessage(result);
    renderLogin(message, email, true);
    return;
  }

  state.email = email;
  saveSession(email);
  await refreshLearningState();
  const nextRoute = state.pendingRoute || "#/home";
  state.pendingRoute = "";
  window.location.hash = nextRoute;
  render();
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
            ? "次の一歩へ →"
            : (evaluation.result_status === "support_needed" ? "内容を確認する" : "もう一度整理する"),
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
  error.textContent = message || "保存に失敗しました。通信状況を確認して、もう一度お試しください。入力内容は画面に残っています。";
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
  openJudgeOverlay(AI_FORM_WAIT_MESSAGE[formKind] || "AIが確認しています");

  try {
    if (formKind === "ai-theme") {
      await provider.startAiWork(state.email, workId, formDataToObject(formData));
    }

    if (formKind === "ai-answer") {
      await provider.submitAiWorkAnswer(state.email, workId, formData.get("answer"));
    }

    if (formKind === "ai-intake-followup") {
      await provider.submitAiWorkIntakeFollowup(state.email, workId, formData.get("intake_followup_answer"));
    }

    if (formKind === "ai-followup") {
      await provider.submitAiWorkFollowup(state.email, workId, formData.get("followup_answer"));
    }

    if (formKind === "ai-revision") {
      await provider.submitAiWorkRevision(state.email, workId, formData.get("revision_answer"));
    }

    await refreshLearningState();
    window.location.hash = hashForWork(workId);
    render();

    const work = (state.learning?.works || []).find((item) => item.work_id === workId);
    const session = work?.aiSession || null;
    const evaluation = session?.ai_evaluation_result || null;
    const hasScore = Number.isFinite(Number(evaluation?.score)) && Number(evaluation?.score) > 0;

    if (evaluationForms.includes(formKind) && evaluation && hasScore) {
      const passed = ["completed", "final_feedback_ready"].includes(session.status);
      showJudgeResult({
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
        }
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

async function handleMarkVideo(button) {
  const originalButtonText = button.textContent;
  clearInlineActionError(button);
  button.disabled = true;
  button.classList.add("is-loading");
  button.setAttribute("aria-busy", "true");
  button.textContent = "記録しています";
  try {
    await provider.markVideoWatched(state.email, button.dataset.lessonId);
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
  error.textContent = message || "保存に失敗しました。通信状況を確認して、もう一度お試しください。";
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

  if (action === "mark-video") {
    try {
      await handleMarkVideo(actionTarget);
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

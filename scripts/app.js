import {
  clearSession,
  createLearningProvider,
  getAiWorkStatusLabel,
  getLastEmail,
  getStatusLabel,
  getStoredSession,
  normalizeEmail,
  saveSession
} from "./data-provider.js?v=5-1-2";

const app = document.querySelector("#app");
const provider = createLearningProvider();

const config = {
  supportLineUrl: "https://line.me/R/",
  brandLogo: "./assets/barise-logo.png",
  heroImage: "./assets/barise-key-visual-quiet.png"
};

const LEARNER_FORBIDDEN_PATTERN = /\b(good|needs_more|support_needed|reviewing|failed|debug|mock|internal|pass|retry|review|evaluate-work|gpt-4o-mini|OPENAI_API_KEY|learner_theme|current_situation|current_actions|available_metrics|target_result|strategy_tactic_execution)\b/i;
const MINI_WORK_INPUT_ERROR_MESSAGE = "もう少し具体的に書いてください。選んだ行動・理由・いつ/どこで試すかを入れると評価できます。";

const state = {
  email: "",
  learning: null,
  pendingRoute: "",
  selectedPhaseId: ""
};

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

function renderLoading() {
  app.innerHTML = `
    <main class="loading-screen">
      <img src="${config.brandLogo}" alt="Barise" class="loading-logo">
      <p>学習ページを開いています</p>
    </main>
  `;
}

function renderError(message) {
  app.innerHTML = `
    <main class="login-screen">
      <div class="login-visual" style="background-image: url('${config.heroImage}')"></div>
      <section class="login-panel" aria-labelledby="error-title">
        <img src="${config.brandLogo}" alt="Barise" class="brand-logo">
        <h1 id="error-title">ページを開けませんでした</h1>
        <p>${escapeHtml(message)}</p>
        <button class="primary-button" type="button" data-action="reload">再読み込み</button>
      </section>
    </main>
  `;
}

function renderLogin(errorMessage = "", emailValue = getLastEmail(), showSupport = false) {
  app.innerHTML = `
    <main class="login-screen">
      <div class="login-visual" style="background-image: url('${config.heroImage}')"></div>
      <section class="login-panel" aria-labelledby="login-title">
        <img src="${config.brandLogo}" alt="Barise" class="brand-logo">
        <p class="eyebrow">Member Learning</p>
        <h1 id="login-title">学習ページへログイン</h1>
        <p class="lead">会員専用学習ページです。学習進捗・提出ワーク・フィードバックをここで確認できます。</p>
        <form id="login-form" class="login-form">
          <label for="email">メールアドレス</label>
          <input id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="公式LINEに登録したメールアドレス" value="${escapeHtml(emailValue)}" required>
          ${errorMessage ? `<div class="form-error">${escapeHtml(errorMessage)}</div>` : ""}
          ${showSupport ? `<a class="line-button support-login-cta" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEでサポートに相談する</a>` : ""}
          <button class="primary-button" type="submit">ログイン</button>
        </form>
        <p class="login-support-note">うまく入れない場合も、サポートが確認します。</p>
      </section>
    </main>
  `;
}

function renderHome() {
  const learning = state.learning;
  if (!learning) {
    renderLoading();
    return;
  }

  const selectedPhaseId = state.selectedPhaseId || learning.currentPhase?.phase_id;
  const selectedPhase = learning.phases.find((phase) => phase.phase_id === selectedPhaseId) || learning.currentPhase;
  const continueLesson = learning.currentLesson;
  const continueCta = continueLesson ? getLessonCta(continueLesson) : null;

  app.innerHTML = `
    ${renderHeader(learning.user)}
    <main class="main-shell">
      <section class="home-hero" style="background-image: linear-gradient(90deg, rgba(255,255,255,.96), rgba(255,255,255,.78), rgba(255,255,255,.36)), url('${config.heroImage}')">
        <div class="hero-copy">
          <p class="eyebrow">Barise Learning</p>
          <h1>${escapeHtml(learning.user.display_name || "受講者さん")}、続きから始めましょう</h1>
          <p>${escapeHtml(selectedPhase?.phase_summary || "今日の学習を進めましょう。")}</p>
          ${continueCta ? `
            <div class="next-action-panel">
              <span>次にやること</span>
              <strong>${escapeHtml(continueCta.summary)}</strong>
              ${renderProgressBar(learning.progressSummary.percent, "総合進捗")}
            </div>
          ` : ""}
          <div class="hero-actions">
            ${continueCta ? `<a class="primary-button primary-button--main" href="${escapeAttribute(continueCta.href)}"><span>続きから再開</span><small>${escapeHtml(continueCta.shortNote || "今日の教材へ進む")}</small></a>` : ""}
            <a class="ghost-button" href="#/learning">学習へ</a>
            <a class="ghost-button" href="#/works">ワークへ</a>
            <a class="ghost-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
          </div>
        </div>
      </section>

      <section class="summary-grid" aria-label="学習状況">
        ${renderSummaryCard("総合進捗", `${learning.progressSummary.percent}%`, `${learning.progressSummary.doneSteps}/${learning.progressSummary.totalSteps}項目`, learning.progressSummary.percent, "総")}
        ${renderSummaryCard("動画", `${learning.progressSummary.videoDone}/${learning.progressSummary.videoTotal}`, "視聴完了", null, "視")}
        ${renderSummaryCard("ミニワーク", `${learning.progressSummary.miniDone}/${learning.progressSummary.miniTotal}`, "提出済み", null, "書")}
        ${renderSummaryCard("ワーク", `${learning.progressSummary.workDone}/${learning.progressSummary.workTotal}`, "提出済み", null, "実")}
      </section>

      <section class="learning-layout">
        <aside class="phase-nav" aria-label="フェーズ一覧">
          <div class="section-heading">
            <p class="eyebrow">Phase</p>
            <h2>フェーズ一覧</h2>
          </div>
          <div class="phase-list">
            ${learning.phases.map(renderPhaseButton).join("")}
          </div>
        </aside>

        <section class="lesson-area" aria-labelledby="lesson-area-title">
          <div class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">${escapeHtml(selectedPhase?.phase_id || "")}</p>
              <h2 id="lesson-area-title">${escapeHtml(selectedPhase?.phase_title || "現在のフェーズ")}</h2>
            </div>
            <span class="soft-badge">${selectedPhase?.completedCount || 0}/${selectedPhase?.lessonCount || 0} 完了</span>
          </div>
          <div class="lesson-grid">
            ${(selectedPhase?.lessons || []).map(renderLessonCard).join("") || renderEmptyLessons()}
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderLearningPage() {
  const learning = state.learning;
  if (!learning) {
    renderLoading();
    return;
  }

  const nextLesson = learning.currentLesson;

  app.innerHTML = `
    ${renderHeader(learning.user)}
    <main class="main-shell route-page">
      ${renderRouteHero("Learning", "学習一覧", "公式LINEの学習メニューから直接入れる、動画教材の一覧です。", [
        { label: "マイページへ戻る", href: "#/home" },
        { label: "ワーク一覧へ", href: "#/works" }
      ])}

      ${nextLesson ? `
        <section class="content-panel route-feature" aria-labelledby="next-video-title">
          <div class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">Next Video</p>
              <h2 id="next-video-title">次に見るべき動画</h2>
            </div>
            ${renderVideoStatusBadge(nextLesson.progress.video_status)}
          </div>
          <h3>${escapeHtml(nextLesson.lesson_title)}</h3>
          <p>${escapeHtml(nextLesson.lesson_summary)}</p>
          <div class="route-card-actions">
            <a class="primary-button" href="${escapeAttribute(hashForLesson(nextLesson.lesson_id, "video"))}">動画へ進む</a>
            ${nextLesson.work ? `<a class="ghost-button" href="${escapeAttribute(hashForWork(nextLesson.work.work_id))}">関連ワークへ</a>` : ""}
          </div>
        </section>
      ` : ""}

      <section class="route-section" aria-labelledby="learning-list-title">
        <div class="section-heading">
          <p class="eyebrow">Video List</p>
          <h2 id="learning-list-title">フェーズ別の動画一覧</h2>
        </div>
        <div class="phase-learning-list">
          ${learning.phases.map((phase) => renderLearningPhaseBlock(phase)).join("")}
        </div>
      </section>
    </main>
  `;

  requestAnimationFrame(() => scrollToPageTop());
}

function renderLearningPhaseBlock(phase) {
  return `
    <section class="content-panel learning-phase-block" aria-labelledby="learning-${escapeAttribute(phase.phase_id)}">
      <div class="section-heading section-heading-row">
        <div>
          <p class="eyebrow">${escapeHtml(phase.phase_id)}</p>
          <h3 id="learning-${escapeAttribute(phase.phase_id)}">${escapeHtml(phase.phase_title)}</h3>
        </div>
        <span class="soft-badge">${escapeHtml(String(phase.completedCount || 0))}/${escapeHtml(String(phase.lessonCount || 0))} 完了</span>
      </div>
      <div class="learning-row-list">
        ${phase.lessons.map(renderLearningLessonRow).join("")}
      </div>
    </section>
  `;
}

function renderLearningLessonRow(lesson) {
  const relatedWork = findAiWorkForLesson(lesson.lesson_id);
  const miniStatus = lesson.miniWork ? getStatusLabel(lesson.progress.mini_work_status) : "対象なし";
  const workStatus = relatedWork ? relatedWork.aiStatusLabel : "対象なし";
  const meta = getLessonMeta(lesson);
  const cta = getLearningLessonCta(lesson);
  return `
    <article class="learning-row learning-row--compact">
      <div class="learning-row-main">
        <div class="learning-row-title">
          <span>${escapeHtml(lesson.lesson_id)}</span>
          <h4>${escapeHtml(lesson.lesson_title)}</h4>
        </div>
        <p class="learning-row-note">${escapeHtml(meta.duration)} / ${escapeHtml(lesson.lesson_summary)}</p>
      </div>
      <div class="learning-row-status">
        ${renderMetaChip("動画", getVideoWatchLabel(lesson.progress.video_status))}
        ${lesson.miniWork ? renderMetaChip("ミニワーク", miniStatus) : ""}
        ${relatedWork ? renderMetaChip("関連ワーク", workStatus) : ""}
      </div>
      <div class="route-card-actions learning-row-actions">
        <a class="primary-button" href="${escapeAttribute(cta.href)}">${escapeHtml(cta.label)}</a>
        ${relatedWork ? `<a class="ghost-button" href="${escapeAttribute(hashForWork(relatedWork.work_id))}">ワーク</a>` : ""}
      </div>
    </article>
  `;
}

function renderWorksPage() {
  const learning = state.learning;
  if (!learning) {
    renderLoading();
    return;
  }

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
    ${renderHeader(learning.user)}
    <main class="main-shell route-page">
      ${renderRouteHero("Works", "ワーク一覧", "AIヒアリングで、テーマ整理から最終フィードバックまで学習ページ内で進めます。", [
        { label: "マイページへ戻る", href: "#/home" },
        { label: "学習一覧へ", href: "#/learning" }
      ])}

      ${nextWork ? `
        <section class="route-section route-feature" aria-labelledby="next-work-title">
          <div class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">Next Work</p>
              <h2 id="next-work-title">今取り組むべきワーク</h2>
            </div>
            ${renderAiWorkStatusBadge(nextWork.aiStatus)}
          </div>
          ${renderWorkCard(nextWork, true)}
        </section>
      ` : renderEmptyLessons()}

      ${renderWorkSection("進行中ワーク", activeWorks)}
      ${renderWorkSection("解放済みワーク", readyWorks, { compact: true })}
      ${renderWorkSection("未着手ワーク", notStartedWorks, { collapsed: true, compact: true })}
      ${renderWorkSection("完了済みワーク", completedWorks, { collapsed: true, compact: true })}
    </main>
  `;

  requestAnimationFrame(() => scrollToPageTop());
}

function renderWorkSection(title, works, options = {}) {
  const sectionId = `work-section-${title}`;
  const gridClass = `work-card-grid${options.compact ? " work-card-grid--compact" : ""}`;
  const body = `
    <div class="${gridClass}">
      ${works.length ? works.map((work) => renderWorkCard(work, false, options)).join("") : `<p class="empty-route-note">該当するワークはありません。</p>`}
    </div>
  `;

  if (options.collapsed && works.length) {
    return `
      <section class="route-section work-section" aria-labelledby="${escapeAttribute(sectionId)}">
        <details class="work-section-details">
          <summary class="section-heading section-heading-row">
            <div>
              <p class="eyebrow">Work</p>
              <h2 id="${escapeAttribute(sectionId)}">${escapeHtml(title)}</h2>
            </div>
            <span class="soft-badge">${works.length}件</span>
          </summary>
          ${body}
        </details>
      </section>
    `;
  }

  return `
    <section class="route-section work-section" aria-labelledby="${escapeAttribute(sectionId)}">
      <div class="section-heading section-heading-row">
        <div>
          <p class="eyebrow">Work</p>
          <h2 id="${escapeAttribute(sectionId)}">${escapeHtml(title)}</h2>
        </div>
        <span class="soft-badge">${works.length}件</span>
      </div>
      ${body}
    </section>
  `;
}

function renderWorkCard(work, featured = false, options = {}) {
  const relatedLessons = work.relatedLessons || [];
  const compactClass = options.compact && !featured ? " work-card--compact" : "";
  const requirementLabel = getWorkRequirementLabel(work);
  return `
    <article class="work-card${featured ? " work-card--featured" : ""}${compactClass}">
      <div class="work-card-top">
        <span>${escapeHtml(work.work_id)}</span>
        ${renderAiWorkStatusBadge(work.aiStatus)}
      </div>
      <h3>${escapeHtml(work.title)}</h3>
      ${featured ? `<p>${escapeHtml(work.entry_description || work.purpose)}</p>` : ""}
      <dl class="lesson-meta work-card-meta">
        <div><dt>関連</dt><dd>${escapeHtml(work.phaseTitle || work.phase_id || "Barise")}</dd></div>
        <div><dt>条件</dt><dd>${escapeHtml(requirementLabel)}</dd></div>
        <div><dt>状態</dt><dd>${escapeHtml(work.aiStatusLabel)}</dd></div>
      </dl>
      ${featured && relatedLessons.length ? `
        <div class="related-link-list">
          ${relatedLessons.map((lesson) => `<a href="${escapeAttribute(hashForLesson(lesson.lesson_id, "video"))}">${escapeHtml(lesson.lesson_id)} ${escapeHtml(lesson.lesson_title)}</a>`).join("")}
        </div>
      ` : ""}
      <div class="route-card-actions">
        <a class="primary-button" href="${escapeAttribute(hashForWork(work.work_id))}">${escapeHtml(getWorkCtaLabel(work))}</a>
        ${work.primaryLessonId ? `<a class="ghost-button" href="${escapeAttribute(hashForLesson(work.primaryLessonId, "video"))}">関連動画へ</a>` : ""}
      </div>
    </article>
  `;
}

function renderAiWorkPage(workId) {
  const learning = state.learning;
  const work = (learning?.works || []).find((item) => item.work_id === workId);
  if (!work) {
    renderWorksPage();
    return;
  }

  app.innerHTML = `
    ${renderHeader(learning.user)}
    <main class="lesson-page">
      <nav class="breadcrumb" aria-label="ページ移動">
        <a href="#/works">ワーク一覧へ戻る</a>
        <span>${escapeHtml(work.title)}</span>
      </nav>

      <section class="lesson-detail-grid ai-work-layout">
        <div class="lesson-main">
          ${renderAiWorkMain(work)}
        </div>
        <aside class="progress-panel" aria-label="関連教材">
          <div class="section-heading">
            <p class="eyebrow">Related</p>
            <h2>関連動画/ミニワーク</h2>
          </div>
          ${renderAiWorkRelatedPanel(work)}
          <a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
        </aside>
      </section>
    </main>
  `;

  requestAnimationFrame(() => scrollToPageTop());
}

function renderAiWorkMain(work) {
  const session = work.aiSession || null;
  const status = work.aiStatus || "not_started";
  const locked = !work.canStartAiWork && !["completed", "final_feedback_ready"].includes(status);
  return `
    <section class="content-panel ai-work-panel" aria-labelledby="ai-work-title">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Work</p>
          <h1 id="ai-work-title">${escapeHtml(work.title)}</h1>
        </div>
        ${renderAiWorkStatusBadge(status)}
      </div>
      <p class="work-purpose">${escapeHtml(work.work_goal || work.purpose)}</p>
      <div class="ai-work-overview">
        ${renderMetaChip("鍛える力", work.target_skill || "判断力 / 仮説検証 / PDCA")}
        ${renderMetaChip("完了条件", work.completion_condition || "AIフィードバックが届いた状態")}
      </div>
      <div class="ai-work-context-grid">
        ${renderAiWorkContextItem("このワークで作る成果物", work.learner_output || "自分の状況を構造化した回答")}
        ${renderAiWorkContextItem("前ワークとのつながり", work.previous_work_connection || "ここまでの学習内容を踏まえて整理します。")}
        ${renderAiWorkContextItem("次への接続", work.next_work_connection || "整理した内容を次の学習や実践へつなげます。")}
      </div>
      ${locked ? renderAiWorkLockedGate(work) : renderAiWorkStep(work, session)}
    </section>
  `;
}

function renderAiWorkLockedGate(work) {
  const missingLessons = work.missingRequiredLessonIds || [];
  const missingMiniWorks = work.missingRequiredMiniWorkIds || [];
  return `
    <div class="locked-note ai-work-lock-gate">
      <span>開始条件があります</span>
      <p>${escapeHtml(work.unlockReason || "関連する動画視聴とミニワーク通過後に開始できます。")}</p>
      ${missingLessons.length ? `
        <div>
          <strong>視聴が必要な動画</strong>
          <ul>${missingLessons.map((lessonId) => `<li><a href="${escapeAttribute(hashForLesson(lessonId, "video"))}">${escapeHtml(lessonId)} の動画へ</a></li>`).join("")}</ul>
        </div>
      ` : ""}
      ${missingMiniWorks.length ? `
        <div>
          <strong>通過が必要なミニワーク</strong>
          <ul>${missingMiniWorks.map((miniWorkId) => `<li>${escapeHtml(miniWorkId)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      <div class="route-card-actions">
        <a class="primary-button" href="#/learning">学習一覧へ戻る</a>
        <a class="ghost-button" href="#/works">ワーク一覧へ戻る</a>
      </div>
    </div>
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
      <div class="locked-note">
        <p>一時的に処理できませんでした。保存済みの内容から再実行できます。</p>
        ${renderAiEvaluationSummary(session)}
        <button class="primary-button" type="button" data-action="retry-ai-work" data-work-id="${escapeAttribute(work.work_id)}">再実行する</button>
      </div>
    `;
  }
  return renderAiThemeForm(work, session);
}

function renderAiThemeForm(work, session = null) {
  const fields = getAiIntakeFields(work);
  return `
    <form class="ai-work-form" data-form="ai-theme" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderLearnerGuidance(work)}
      <div class="ai-form-grid">
        ${fields.map((field) => renderTextAreaField(
          field.key,
          field.label,
          getAiContextValue(session, field.key),
          field.placeholder,
          field.rows || 4
        )).join("")}
      </div>
      <button class="primary-button work-submit-button" type="submit">AIに問いを整えてもらう</button>
    </form>
  `;
}

function renderAiAnswerForm(work, session) {
  return `
    ${renderAiGeneratedPrompt(session)}
    ${renderAiCriteriaGuide(work)}
    <form class="ai-work-form" data-form="ai-answer" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("answer", "回答", session.initial_answer || "", work.answer_placeholder || "場面、数字、判断理由、次の行動を具体的に書いてください", 8)}
      <button class="primary-button work-submit-button" type="submit">回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiIntakeFollowupForm(work, session) {
  return `
    <div class="ai-followup-history ai-followup-focus">
      <h3>今回答える質問</h3>
      <p>${escapeHtml(session.ai_summary || "ワークを始めるために、もう少し材料を集めます。")}</p>
      ${renderFollowupQuestionPanel(session.followup_questions)}
      ${renderMissingPoints(session.missing_points, "追記すべき観点")}
      ${session.intake_placeholder_notice ? `<p class="ai-placeholder-note">${escapeHtml(session.intake_placeholder_notice)}</p>` : ""}
      ${renderFollowupHistory(session.followup_history)}
    </div>
    <form class="ai-work-form" data-form="ai-intake-followup" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("intake_followup_answer", "今回答える内容", "", "上の質問に対して、あなたの実際の状況・数字・判断理由を追記してください", 7)}
      <button class="primary-button work-submit-button" type="submit">追加回答を送る</button>
    </form>
    ${session.can_continue_with_placeholders ? `
      <div class="route-card-actions ai-placeholder-actions">
        <button class="ghost-button" type="button" data-action="continue-ai-work-placeholders" data-work-id="${escapeAttribute(work.work_id)}">不足を仮置きしてワークへ進む</button>
      </div>
    ` : ""}
  `;
}

function renderAiFollowupForm(work, session) {
  return `
    ${renderAiGeneratedPrompt(session)}
    ${renderAiCriteriaProgress(session)}
    ${renderAiEvaluationSummary(session)}
    <div class="ai-followup-history ai-followup-focus">
      <h3>今回答える質問</h3>
      <p>${escapeHtml(session.ai_summary || "追加質問に回答してください。")}</p>
      ${renderFollowupQuestionPanel(session.followup_questions)}
      ${renderMissingPoints(session.unmet_criteria, "追記すべき観点")}
      ${renderFollowupHistory(session.followup_history)}
    </div>
    <form class="ai-work-form" data-form="ai-followup" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("followup_answer", "今回答える内容", "", "上の質問に対して、具体場面・数字・判断理由を足して回答してください", 8)}
      <button class="primary-button work-submit-button" type="submit">追加回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiRevisionForm(work, session) {
  return `
    ${renderAiGeneratedPrompt(session)}
    <section class="ai-revision-focus" aria-label="もう一度整理する内容">
      <div class="ai-revision-focus__head">
        <span>もう一度整理しましょう</span>
        <p class="multiline-text">${escapeHtml(session.ai_feedback || session.ai_summary || "回答の観点を整えて、もう一度送ってください。")}</p>
      </div>
      ${renderMissingPoints(session.unmet_criteria, "追記すべき観点")}
      ${renderStaffFeedbackNotice(session)}
      ${(session.followup_questions || []).length ? `
        ${renderFollowupQuestionPanel(session.followup_questions, "今回答える質問")}
      ` : ""}
      ${renderAiEvaluationSummary(session, { compact: true })}
      ${renderRevisionHistory(session.revision_history, { collapsed: true })}
    </section>
    <form class="ai-work-form" data-form="ai-revision" data-work-id="${escapeAttribute(work.work_id)}">
      ${renderTextAreaField("revision_answer", "再回答", session.latest_revision_answer || "", work.answer_placeholder || "不足している観点を足して、もう一度整理してください", 8)}
      <button class="primary-button work-submit-button" type="submit">再回答をAIに確認してもらう</button>
    </form>
  `;
}

function renderAiFinalFeedback(work, session) {
  const nextWork = getNextWorkAfter(work);
  return `
    <section class="evaluation-card ai-final-card" aria-label="AI最終フィードバック">
      <div class="evaluation-head">
        <span class="evaluation-icon" aria-hidden="true">✓</span>
        <div>
          <p class="eyebrow">AI Feedback</p>
          <h3>AI最終フィードバック</h3>
        </div>
        ${renderAiWorkStatusBadge(session.status)}
      </div>
      <p class="multiline-text">${escapeHtml(session.ai_final_feedback || "フィードバックを生成しました。")}</p>
      ${renderAiEvaluationSummary(session)}
      ${renderStaffFeedbackNotice(session)}
      ${renderAiCriteriaProgress(session, "完了できた観点")}
      <div class="evaluation-columns">
        <div>
          <h4>良い点</h4>
          <ul>${(session.good_points || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>次アクション</h4>
          <ul>${(session.next_actions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      </div>
      <div class="route-card-actions">
        ${nextWork ? `<a class="primary-button" href="${escapeAttribute(hashForWork(nextWork.work_id))}">${escapeHtml(nextWork.title)}へ進む</a>` : `<a class="primary-button" href="#/learning">次の学習へ進む</a>`}
        <a class="ghost-button" href="#/works">ワーク一覧へ戻る</a>
      </div>
    </section>
  `;
}

function renderAiWorkRelatedPanel(work) {
  const relatedLessons = work.relatedLessons || [];
  return `
    <div class="related-link-list related-link-list--panel">
      ${relatedLessons.length ? relatedLessons.map((lesson) => `
        <a href="${escapeAttribute(hashForLesson(lesson.lesson_id, "video"))}">
          <span>${escapeHtml(lesson.lesson_id)}</span>
          <strong>${escapeHtml(lesson.lesson_title)}</strong>
          <small>動画: ${escapeHtml(getVideoWatchLabel(lesson.video_status))} / ミニワーク: ${escapeHtml(lesson.mini_work_status === "none" ? "対象なし" : getStatusLabel(lesson.mini_work_status))}</small>
        </a>
      `).join("") : `<p class="empty-route-note">関連教材はありません。</p>`}
    </div>
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
    <div class="ai-guidance-list" aria-label="ワークの進め方">
      ${guidance.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    </div>
  `;
}

function renderAiGeneratedPrompt(session) {
  const parts = normalizeAiPromptParts(session);
  if (!parts.title && !parts.questionItems.length && !parts.inputRows.length) return "";

  return `
    <section class="ai-generated-prompt ai-generated-prompt--structured" aria-label="個別ワーク問題文">
      <div class="ai-generated-prompt__head">
        <span>個別ワーク問題文</span>
        ${parts.title ? `<strong>${escapeHtml(parts.title)}</strong>` : ""}
        ${parts.purpose ? `<p>${escapeHtml(parts.purpose)}</p>` : ""}
      </div>
      ${(parts.essence || parts.previousConnection) ? `
        <div class="ai-prompt-meta">
          ${parts.essence ? `<p><small>守る本質</small>${escapeHtml(parts.essence)}</p>` : ""}
          ${parts.previousConnection ? `<p><small>前ワークとのつながり</small>${escapeHtml(parts.previousConnection)}</p>` : ""}
        </div>
      ` : ""}
      ${parts.inputRows.length ? `
        <details class="ai-prompt-context" open>
          <summary>あなたの入力を確認</summary>
          <dl>
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
        <div class="ai-prompt-question">
          <span>今回の問い</span>
          <ol>
            ${parts.questionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ol>
        </div>
      ` : ""}
      ${parts.criteria.length ? `
        <div class="ai-prompt-criteria">
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
    <div class="ai-criteria-card">
      <h3>このワークで見る観点</h3>
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
    <div class="ai-criteria-card ai-criteria-card--progress">
      ${met.length ? `
        <div>
          <h3>${escapeHtml(title)}</h3>
          <ul>${met.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${unmet.length ? `
        <div>
          <h3>もう一度整理する観点</h3>
          <ul>${unmet.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
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
    <div class="ai-evaluation-summary${options.compact ? " ai-evaluation-summary--compact" : ""}" aria-label="評価結果">
      <div class="ai-evaluation-summary__head">
        <div>
          <span>評価結果</span>
          <strong>${escapeHtml(scoreText)}</strong>
        </div>
        <em>${escapeHtml(evaluation.label || "確認中")}</em>
      </div>
      <p>${escapeHtml(evaluation.summary || "評価結果を保存しました。")}</p>
      ${options.compact ? `
        <details class="ai-evaluation-summary__details">
          <summary>評価の詳細を見る</summary>
          ${renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria)}
        </details>
      ` : renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria)}
      ${evaluation.next_action ? `<p class="ai-evaluation-next">${escapeHtml(evaluation.next_action)}</p>` : ""}
    </div>
  `;
}

function renderAiEvaluationSummaryGrid(goodPoints, improvementPoints, unmetCriteria) {
  if (!goodPoints.length && !improvementPoints.length && !unmetCriteria.length) return "";
  return `
    <div class="ai-evaluation-summary__grid">
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
    <div class="staff-feedback-notice">
      <strong>${escapeHtml(feedback.message || "作成されたワークをもとに、担当者からフィードバックをいたします。")}</strong>
      ${feedback.reason ? `<p>${escapeHtml(feedback.reason)}</p>` : ""}
    </div>
  `;
}

function renderMissingPoints(points = [], title = "追加で確認したいこと") {
  if (!points.length) return "";
  return `
    <div class="ai-missing-points">
      <span>${escapeHtml(title)}</span>
      <ul>${points.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderFollowupQuestionPanel(questions = [], title = "今回答える質問") {
  if (!questions.length) return "";
  return `
    <div class="ai-followup-question-panel">
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
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeAttribute(name)}" rows="${rows}" placeholder="${escapeAttribute(placeholder)}" required>${escapeHtml(value)}</textarea>
    </label>
  `;
}

function renderFollowupHistory(history = []) {
  if (!history.length) return "";
  return `
    <details class="ai-history-list ai-history-list--collapsed">
      <summary>前回までの回答を確認する</summary>
      <div>
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
    <div class="ai-history-list">
      <h4>これまでの再回答</h4>
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
    <details class="ai-revision-details">
      <summary>これまでの再回答を見る</summary>
      ${content}
    </details>
  `;
}

function renderRouteHero(kicker, title, lead, actions = []) {
  return `
    <section class="route-hero">
      <div>
        <p class="eyebrow">${escapeHtml(kicker)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(lead)}</p>
      </div>
      <div class="hero-actions">
        ${actions.map((action) => `<a class="ghost-button" href="${escapeAttribute(action.href)}">${escapeHtml(action.label)}</a>`).join("")}
      </div>
    </section>
  `;
}

function renderLesson(lessonId, section = "") {
  const learning = state.learning;
  const lessonContext = findLessonContext(learning, lessonId);
  const lesson = lessonContext?.lesson;
  const phase = lessonContext?.phase;

  if (!lesson) {
    renderHome();
    return;
  }

  app.innerHTML = `
    ${renderHeader(learning.user)}
    <main class="lesson-page">
      <nav class="breadcrumb" aria-label="ページ移動">
        <a href="#/home">マイページへ戻る</a>
        <span>${escapeHtml(lesson.lesson_title)}</span>
      </nav>

      <section class="lesson-detail-grid">
        <div class="lesson-main">
          ${renderVideoBlock(lesson, phase)}
          ${renderLearningDetailBlock(lesson)}
          ${renderMiniWorkBlock(lesson)}
          ${renderWorkBlock(lesson)}
          ${renderLessonBottomNav(learning, lesson)}
        </div>

        ${renderLessonProgressPanel(learning, lesson, phase)}
      </section>
    </main>
  `;

  requestAnimationFrame(() => focusLessonSection(section));
}

function renderHeader(user) {
  return `
    <header class="site-header">
      <a href="#/home" class="header-brand" aria-label="Barise 学習ページ">
        <img src="${config.brandLogo}" alt="Barise">
      </a>
      <nav class="header-nav" aria-label="主要ナビゲーション">
        <a href="#/learning">学習</a>
        <a href="#/works">ワーク</a>
      </nav>
      <div class="header-actions">
        <span>${escapeHtml(user.enrolled_course || "Barise")}</span>
        <button class="text-button" type="button" data-action="logout">ログアウト</button>
      </div>
    </header>
  `;
}

function renderSummaryCard(label, value, note, percent = null, icon = "") {
  return `
    <article class="summary-card">
      <div class="summary-card-head">
        <p>${escapeHtml(label)}</p>
        ${icon ? `<span aria-hidden="true">${escapeHtml(icon)}</span>` : ""}
      </div>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
      ${Number.isFinite(percent) ? renderProgressBar(percent, label) : ""}
    </article>
  `;
}

function renderMetaChip(label, value) {
  return `
    <span class="meta-chip">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `;
}

function renderLessonProgressPanel(learning, lesson, phase) {
  const nextLesson = getNextLesson(learning, lesson);
  const nextLock = getLessonNextLockState(learning, lesson);
  const phaseDone = Number(phase?.completedCount || 0);
  const phaseTotal = Number(phase?.lessonCount || 0);
  const chips = [
    { label: "フェーズ", value: `${phase?.phase_id || "Phase"} ${phaseDone}/${phaseTotal}完了` },
    { label: "動画", value: getVideoWatchLabel(lesson.progress.video_status) }
  ];

  if (lesson.miniWork) {
    chips.push({ label: "ミニワーク", value: getStatusLabel(lesson.progress.mini_work_status) });
  }

  chips.push({
    label: "次の教材",
    value: nextLesson ? (nextLock.locked ? nextLock.label : "次へ進めます") : "最終教材です"
  });

  return `
    <aside class="progress-panel progress-panel--compact" aria-label="この教材の進捗">
      <div class="section-heading">
        <p class="eyebrow">Progress</p>
        <h2>この教材の進捗</h2>
      </div>
      <div class="lesson-progress-chip-list">
        ${chips.map((chip) => `
          <span class="lesson-progress-chip">
            <small>${escapeHtml(chip.label)}</small>
            <strong>${escapeHtml(chip.value)}</strong>
          </span>
        `).join("")}
      </div>
      <a class="line-button" href="${config.supportLineUrl}" target="_blank" rel="noopener">公式LINEへ戻る</a>
    </aside>
  `;
}

function getLessonNextLockState(learning, lesson) {
  const nextLesson = getNextLesson(learning, lesson);
  if (!nextLesson) return { locked: false, label: "最終教材です" };
  if (lesson.miniWork && lesson.progress.mini_work_status !== "good") {
    return {
      locked: true,
      label: "ミニワーク通過後に進めます",
      detail: "この教材のミニワークが通過すると次の動画へ進めます。"
    };
  }
  return { locked: false, label: "次へ進めます" };
}

function renderProgressBar(percent, label) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="progress-bar" aria-label="${escapeAttribute(label)} ${safePercent}%">
      <span style="width: ${safePercent}%"></span>
    </div>
  `;
}

function renderPhaseButton(phase) {
  const isActive = state.selectedPhaseId ? state.selectedPhaseId === phase.phase_id : phase.isCurrent;
  const activeClass = isActive ? " is-active" : "";
  const lockedClass = phase.isAccessible ? "" : " is-locked";
  const label = phase.isAccessible ? `${phase.completedCount}/${phase.lessonCount}` : "準備中";

  return `
    <button class="phase-button${activeClass}${lockedClass}" type="button" data-action="select-phase" data-phase-id="${escapeHtml(phase.phase_id)}" ${phase.isAccessible ? "" : "disabled"}>
      <span>${escapeHtml(phase.phase_id)}</span>
      <strong>${escapeHtml(phase.phase_title)}</strong>
      <small>${escapeHtml(label)}</small>
      ${phase.isAccessible ? renderProgressBar(phase.lessonCount ? Math.round((phase.completedCount / phase.lessonCount) * 100) : 0, `${phase.phase_title}の進捗`) : ""}
      ${!phase.isAccessible ? `<em>${escapeHtml(phase.phase_summary)}</em>` : ""}
    </button>
  `;
}

function renderLessonCard(lesson) {
  const cta = getLessonEntryCta(lesson);
  const meta = getLessonMeta(lesson);

  return `
    <article class="lesson-card">
      <div class="lesson-card-top">
        <span>${escapeHtml(lesson.lesson_id)}</span>
        ${renderStatusBadge(lesson.progress.video_status)}
      </div>
      <h3>${escapeHtml(lesson.lesson_title)}</h3>
      <p>${escapeHtml(lesson.lesson_summary)}</p>
      <dl class="lesson-meta">
        <div><dt>目安</dt><dd>${escapeHtml(meta.duration)}</dd></div>
        <div><dt>講師</dt><dd>${escapeHtml(meta.instructor)}</dd></div>
        <div><dt>到達点</dt><dd>${escapeHtml(meta.benefit)}</dd></div>
      </dl>
      <div class="lesson-card-status">
        ${lesson.miniWork ? renderCompactStatus("ミニワーク", lesson.progress.mini_work_status) : ""}
        ${lesson.work ? renderCompactStatus("ワーク", lesson.progress.work_status) : ""}
      </div>
      <div class="lesson-card-actions">
        <a class="primary-button lesson-cta" href="${escapeAttribute(cta.href)}">${escapeHtml(cta.label)}</a>
      </div>
    </article>
  `;
}

function renderEmptyLessons() {
  return `
    <div class="empty-state">
      <p>このフェーズのレッスンは順次公開されます。</p>
    </div>
  `;
}

function renderVideoBlock(lesson, phase) {
  const hasVideo = Boolean(lesson.video_url);
  const isWatched = lesson.progress.video_status === "watched";
  const meta = getLessonMeta(lesson);
  const videoMarkup = hasVideo
    ? `<iframe src="${escapeAttribute(toEmbedUrl(lesson.video_url))}" title="${escapeAttribute(lesson.lesson_title)}" allowfullscreen></iframe>`
    : `<div class="video-placeholder"><span>▶</span><strong>このレッスンの動画</strong></div>`;

  return `
    <section id="section-video" class="content-panel video-panel video-lesson-card" aria-labelledby="video-title" data-section="video" tabindex="-1">
      <div class="video-card-head">
        <div class="video-card-title-group">
          <p class="eyebrow">${escapeHtml(phase?.phase_title || "現在のフェーズ")}｜${escapeHtml(lesson.lesson_id)}</p>
          <h1 id="video-title">${escapeHtml(lesson.lesson_title)}</h1>
        </div>
        ${renderVideoStatusBadge(lesson.progress.video_status)}
      </div>
      <div class="video-card-meta" aria-label="教材情報">
        ${renderMetaChip("目安", meta.duration)}
        ${lesson.miniWork ? renderMetaChip("ミニワーク", getStatusLabel(lesson.progress.mini_work_status)) : ""}
        ${lesson.work ? renderMetaChip("ワーク", getStatusLabel(lesson.progress.work_status)) : ""}
      </div>
      <div class="video-frame">${videoMarkup}</div>
      <button class="primary-button wide-button video-complete-button" type="button" data-action="mark-video" data-lesson-id="${escapeHtml(lesson.lesson_id)}" ${isWatched ? "disabled" : ""}>
        ${isWatched ? "視聴完了済み" : "動画を見たら視聴完了にする"}
      </button>
    </section>
  `;
}

function renderLearningDetailBlock(lesson) {
  const points = Array.isArray(lesson.material_points) ? lesson.material_points.filter(Boolean) : [];

  return `
    <section id="section-purpose" class="content-panel purpose-panel" aria-labelledby="purpose-title" data-section="purpose" tabindex="-1">
      <details class="purpose-details">
        <summary>
          <div>
            <p class="eyebrow">Learning Point</p>
            <h2 id="purpose-title">このレッスンで学ぶこと</h2>
            <small>このレッスンの目的・扱う内容を確認できます</small>
          </div>
          <strong>
            <span class="summary-open">開いて確認する</span>
            <span class="summary-close">閉じる</span>
          </strong>
        </summary>
        <div class="learning-detail-list">
          <div>
            <span>学習目的</span>
            <p>${escapeHtml(lesson.lesson_summary || lesson.purpose_watch || "この教材の目的を確認します。")}</p>
          </div>
          ${points.length ? `
            <div>
              <span>主な内容</span>
              <ul>${points.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
          ` : ""}
          <div>
            <span>視聴後にできるようになること</span>
            <p>${escapeHtml(lesson.learning_outcome || lesson.category_or_work || lesson.purpose_write || "現場で使える視点を整理できます。")}</p>
          </div>
        </div>
        <div class="purpose-grid">
          ${renderPurposeItem("見る", lesson.purpose_watch)}
          ${renderPurposeItem("考える", lesson.purpose_think)}
          ${renderPurposeItem("書く", lesson.purpose_write)}
        </div>
      </details>
    </section>
  `;
}

function renderPurposeItem(label, text) {
  return `
    <div class="purpose-item">
      <span>${escapeHtml(label)}</span>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function renderMiniWorkBlock(lesson) {
  if (!lesson.miniWork) return "";
  const submission = lesson.latestMiniSubmission;
  const value = submission?.answer_text || "";
  const placeholder = getMiniWorkPlaceholder(lesson.miniWork);

  return `
    <section id="section-mini-work" class="content-panel" aria-labelledby="mini-work-title" data-section="mini-work" tabindex="-1">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Mini Work</p>
          <h2 id="mini-work-title">ミニワーク</h2>
        </div>
        ${renderStatusBadge(lesson.progress.mini_work_status)}
      </div>
      <h3 class="work-title">${escapeHtml(lesson.miniWork.title)}</h3>
      <p class="work-prompt">${escapeHtml(lesson.miniWork.prompt)}</p>
      ${lesson.practice_part ? `
        <div class="mini-practice-callout">
          <span>実践の問い</span>
          <p>${escapeHtml(lesson.practice_part)}</p>
        </div>
      ` : ""}
      ${renderCoachTip("書くポイント", lesson.miniWork.helper_text || "いつ・どこで・何をするかを、1つに絞って書くと評価されやすくなります。")}
      <form class="work-form" data-form="mini-work" data-target-id="${escapeHtml(lesson.miniWork.mini_work_id)}">
        <label for="mini-${escapeAttribute(lesson.miniWork.mini_work_id)}">回答</label>
        <textarea id="mini-${escapeAttribute(lesson.miniWork.mini_work_id)}" name="answer" rows="6" placeholder="${escapeAttribute(placeholder)}" required>${escapeHtml(value)}</textarea>
        <button class="primary-button work-submit-button" type="submit">ミニワークを提出</button>
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
    <section id="section-work" class="content-panel ${isUnlocked ? "is-unlocked" : "is-locked"}" aria-labelledby="work-title" data-section="work" tabindex="-1">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Work</p>
          <h2 id="work-title">ワーク</h2>
        </div>
        ${renderAiWorkStatusBadge(aiStatus)}
      </div>
      <h3 class="work-title">${escapeHtml(lesson.work.title)}</h3>
      <p class="work-purpose">${escapeHtml(lesson.work.entry_description || lesson.work.purpose)}</p>
      <div class="ai-work-overview">
        ${renderMetaChip("状態", getAiWorkStatusLabel(aiStatus))}
        ${renderMetaChip("鍛える力", lesson.work.target_skill || "判断力 / 仮説検証 / PDCA")}
      </div>
      ${questions.length ? `<ol class="work-question-list">${questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : ""}
      ${isUnlocked ? `
        ${renderCoachTip("進め方", "このワークは学習ページ内でAIが追加質問しながら進みます。テーマ入力から最終フィードバックまでこのページ内で完結します。")}
        <div class="route-card-actions">
          <a class="primary-button" href="${escapeAttribute(hashForWork(lesson.work.work_id))}">${escapeHtml(getLessonWorkCtaLabel(aiStatus))}</a>
          <a class="ghost-button" href="#/works">ワーク一覧へ</a>
        </div>
      ` : renderLockedWorkNote(lesson)}
    </section>
  `;
}

function renderCoachTip(title, text) {
  return `
    <div class="coach-tip">
      <span>${escapeHtml(title)}</span>
      <p class="multiline-text">${escapeHtml(text)}</p>
    </div>
  `;
}

function renderUnlockedMessage() {
  return `
    <div class="unlock-banner">
      <span aria-hidden="true">✓</span>
      <div>
        <strong>ワークが解放されました</strong>
        <p>関連するミニワークを通過したため、このワークに進めます。</p>
      </div>
    </div>
  `;
}

function renderLockedWorkNote(lesson) {
  const remaining = lesson.workUnlockRemainingLessonIds || [];
  const lessonNames = remaining
    .map((lessonId) => findLessonContext(state.learning, lessonId)?.lesson?.lesson_title || lessonId)
    .filter(Boolean);

  return `
    <div class="locked-note">
      <p>関連するミニワークが通過すると入力できます。</p>
      ${lessonNames.length ? `
        <span>まだ通過が必要な教材</span>
        <ul class="unlock-checklist">${lessonNames.map((name) => `<li><span aria-hidden="true"></span>${escapeHtml(name)}</li>`).join("")}</ul>
      ` : ""}
    </div>
  `;
}

function renderEvaluationResultCard(evaluation, label) {
  const score = Number.isFinite(Number(evaluation.score)) ? Number(evaluation.score) : null;
  const scoreText = score === null ? "確認中" : `${score}/100`;
  const resultHelp = getEvaluationResultHelp(evaluation.result_status);
  const isPassed = evaluation.result_status === "good";
  const nextTitle = isPassed ? "次に進む前に" : "次に意識すること";
  const resultKind = label === "ミニワーク" ? "mini-work" : "work";
  const resultId = resultKind === "mini-work" ? ` id="mini-work-evaluation-result"` : "";
  const passLine = "合格ライン: 80点";
  const goodPoints = uniqueLearnerItems(evaluation.good_points || []).slice(0, 3);
  const improvementPoints = isPassed ? [] : uniqueLearnerItems(evaluation.improvement_points || []).filter((item) => !goodPoints.includes(item)).slice(0, 3);
  const nextActionText = evaluation.next_action_text || (isPassed ? "次へ進みましょう" : "もう一度具体化する");
  const nextQuestion = !isPassed && evaluation.next_question && evaluation.next_question !== nextActionText
    ? evaluation.next_question
    : "";

  return `
    <section${resultId} class="evaluation-card" data-result="${escapeAttribute(evaluation.result_status)}" data-evaluation-result="${escapeAttribute(resultKind)}" aria-label="${escapeAttribute(label)}の評価結果">
      <div class="evaluation-head">
        <span class="evaluation-icon" aria-hidden="true">${evaluation.result_status === "good" ? "✓" : "!"}</span>
        <div>
          <p class="eyebrow">Feedback</p>
          <h3>${escapeHtml(label)}の評価結果</h3>
        </div>
        ${renderStatusBadge(evaluation.result_status)}
      </div>
      <div class="evaluation-score">
        <div>
          <span>スコア</span>
          <strong>${escapeHtml(scoreText)}</strong>
        </div>
        <small>${escapeHtml(passLine)}</small>
        <p>${escapeHtml(resultHelp)}</p>
      </div>
      <div class="evaluation-columns">
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
      <div class="evaluation-next">
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

function renderLessonBottomNav(learning, lesson) {
  const nextLesson = getNextLesson(learning, lesson);
  const nextLock = getLessonNextLockState(learning, lesson);
  return `
    <nav class="bottom-lesson-nav" aria-label="レッスン下部ナビゲーション">
      ${nextLesson && !nextLock.locked ? `<a class="primary-button lesson-nav-cta" href="${escapeAttribute(hashForLesson(nextLesson.lesson_id, "video"))}">次の動画へ進む</a>` : ""}
      ${nextLesson && nextLock.locked ? `<span class="locked-next-note">${escapeHtml(nextLock.detail || nextLock.label)}</span>` : ""}
      <a class="ghost-button" href="#/home">マイページへ戻る</a>
    </nav>
  `;
}

function renderSubmissionNote(submission) {
  return `
    <div class="submission-note">
      <span>${escapeHtml(getStatusLabel(submission.status))}</span>
      <time datetime="${escapeAttribute(submission.submitted_at)}">${escapeHtml(formatDate(submission.submitted_at))}</time>
    </div>
  `;
}

function renderProgressList(learning) {
  const rows = learning.phases.flatMap((phase) => phase.lessons.map((lesson) => ({ phase, lesson })));
  return `
    <div class="progress-list">
      ${rows.map(({ phase, lesson }) => {
        const rowState = getProgressRowState(learning, phase, lesson);
        return `
        <a class="progress-row" data-state="${escapeAttribute(rowState.state)}" href="#/lesson/${escapeHtml(lesson.lesson_id)}" aria-current="${rowState.state === "current" ? "step" : "false"}">
          <span class="progress-row-icon" aria-hidden="true">${escapeHtml(rowState.icon)}</span>
          <span class="progress-row-id">${escapeHtml(lesson.lesson_id)}</span>
          <strong>${escapeHtml(lesson.lesson_title)}</strong>
          <small>${escapeHtml(rowState.label)}</small>
        </a>
      `;
      }).join("")}
    </div>
  `;
}

function getProgressRowState(learning, phase, lesson) {
  if (!phase.isAccessible) return { state: "locked", icon: "🔒", label: "未解放" };
  if (lesson.isComplete) return { state: "complete", icon: "✓", label: "完了" };
  if (learning.currentLesson?.lesson_id === lesson.lesson_id) return { state: "current", icon: "●", label: "次にやること" };
  if ([lesson.progress.video_status, lesson.progress.mini_work_status, lesson.progress.work_status]
    .some((status) => ["watched", "submitted", "reviewing", "needs_more", "support_needed", "unlocked"].includes(status))) {
    return { state: "progress", icon: "◐", label: "進行中" };
  }
  return { state: "not-started", icon: "○", label: "未着手" };
}

function renderStatusPill(label, status) {
  return `
    <div class="status-pill">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(getStatusLabel(status))}</strong>
    </div>
  `;
}

function renderStatusBadge(status) {
  const label = getStatusLabel(status);
  return `<span class="status-badge" data-tone="${escapeAttribute(getStatusTone(status))}">${escapeHtml(label)}</span>`;
}

function renderAiWorkStatusBadge(status) {
  return `<span class="status-badge" data-tone="${escapeAttribute(getAiWorkStatusTone(status))}">${escapeHtml(getAiWorkStatusLabel(status))}</span>`;
}

function renderVideoStatusBadge(status) {
  return `<span class="status-badge video-status-badge" data-tone="${escapeAttribute(getVideoStatusTone(status))}">${escapeHtml(getVideoWatchLabel(status))}</span>`;
}

function getVideoWatchLabel(status) {
  return status === "watched" ? "視聴済み" : "未視聴";
}

function getVideoStatusTone(status) {
  return status === "watched" ? "positive" : "neutral";
}

function renderCompactStatus(label, status) {
  return `
    <span class="compact-status">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(getStatusLabel(status))}</strong>
    </span>
  `;
}

function getLessonEntryCta(lesson) {
  return {
    label: lesson.progress.video_status === "watched" ? "この教材を進める" : "この教材を始める",
    href: hashForLesson(lesson.lesson_id),
  };
}

function getLearningLessonCta(lesson) {
  const nextAction = getLessonCta(lesson);
  if (lesson.isComplete) return { ...nextAction, label: "復習" };
  if (lesson.progress.video_status === "watched") return { ...nextAction, label: "続きから" };
  return { ...nextAction, label: "開始" };
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
  if (work.aiStatus === "completed" || work.aiStatus === "final_feedback_ready") return "確認";
  if (work.aiStatus === "revision_required") return "修正する";
  if (["theme_intake", "intake_required", "intake_reviewing", "intake_followup_required", "answering", "prompt_generated", "followup_required", "error"].includes(work.aiStatus)) return "続きから";
  if (Number(work.miniRemainingCount || 0) > 0) return "条件を見る";
  if (Number(work.videoRemainingCount || 0) > 0) return "条件を見る";
  if (work.canStartAiWork === false) return "条件を見る";
  return "開始";
}

function getWorkRequirementLabel(work) {
  const miniRemaining = Number(work.miniRemainingCount || 0);
  const videoRemaining = Number(work.videoRemainingCount || 0);
  if (work.aiStatus === "completed") return "完了済み";
  if (miniRemaining > 0) return `関連ミニワーク あと${miniRemaining}件`;
  if (videoRemaining > 0) return `関連動画 あと${videoRemaining}件`;
  return "開始できます";
}

function getLessonWorkCtaLabel(status) {
  if (status === "completed" || status === "final_feedback_ready") return "ワーク内容を確認";
  if (!status || ["not_started", "theme_intake", "intake_required"].includes(status)) return "ワークを開始";
  return "ワークを再開";
}

function getEvaluationResultHelp(status) {
  if (status === "good") return "通過: 基準を満たしています。次の教材へ進めます。";
  if (status === "needs_more" || status === "failed") return "もう少し具体化: 数字・場面・行動を足すと通過に近づきます。";
  if (status === "support_needed") return "サポート相談: 一人で抱えず、公式LINEで相談しながら整えましょう。";
  return "評価中: 提出内容を確認しています。";
}

function getLessonCta(lesson) {
  if (lesson.progress.video_status !== "watched") {
    return {
      label: "この教材を始める",
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
      summary: `「${lesson.lesson_title}」のミニワークに取り組みましょう。`
    };
  }

  if (lesson.miniWork && ["needs_more", "failed"].includes(lesson.progress.mini_work_status)) {
    return {
      label: "ミニワークを修正する",
      href: hashForLesson(lesson.lesson_id, "mini-work"),
      shortNote: "具体化して再提出",
      summary: `「${lesson.lesson_title}」のミニワークをもう少し具体化しましょう。`
    };
  }

  if (lesson.miniWork && lesson.progress.mini_work_status === "support_needed") {
    return {
      label: "サポート相談へ進む",
      href: config.supportLineUrl,
      shortNote: "公式LINEで相談",
      summary: `「${lesson.lesson_title}」について公式LINEで相談しましょう。`
    };
  }

  if (lesson.work && lesson.progress.work_status === "unlocked") {
    return {
      label: "ワークへ進む",
      href: hashForWork(lesson.work.work_id),
      shortNote: "実践ワークへ",
      summary: `「${lesson.lesson_title}」のワークへ進みましょう。`
    };
  }

  if (lesson.work && lesson.progress.work_status === "locked" && lesson.nextUnlockLessonId) {
    const nextContext = findLessonContext(state.learning, lesson.nextUnlockLessonId);
    return {
      label: "次の動画へ進む",
      href: hashForLesson(lesson.nextUnlockLessonId, "video"),
      shortNote: "解放条件を進める",
      summary: `関連ミニワーク通過後にワークが開きます。次は「${nextContext?.lesson?.lesson_title || lesson.nextUnlockLessonId}」へ進みましょう。`
    };
  }

  if (lesson.work && ["needs_more", "failed"].includes(lesson.progress.work_status)) {
    return {
      label: "ワークを修正する",
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
    label: "レッスンを開く",
    href: hashForLesson(lesson.lesson_id),
    shortNote: "内容を確認",
    summary: `「${lesson.lesson_title}」を確認しましょう。`
  };
}

function getLessonMeta(lesson) {
  return {
    duration: lesson.estimated_duration || "約10分",
    instructor: "Barise講師",
    benefit: lesson.category_or_work || lesson.learning_outcome || "現場で使える視点を得る"
  };
}

function hashForLesson(lessonId, section = "") {
  const suffix = section ? `?section=${encodeURIComponent(section)}` : "";
  return `#/lesson/${encodeURIComponent(lessonId)}${suffix}`;
}

function hashForWork(workId) {
  return `#/work/${encodeURIComponent(workId)}`;
}

function getNextWorkAfter(work) {
  return (state.learning?.works || [])
    .filter((item) => item.phase_id === work.phase_id && (item.work_order || 0) > (work.work_order || 0))
    .sort((a, b) => (a.work_order || 0) - (b.work_order || 0))[0] || null;
}

function findAiWorkForLesson(lessonId) {
  return (state.learning?.works || []).find((work) => (work.relatedLessons || []).some((lesson) => lesson.lesson_id === lessonId)) || null;
}

function findLessonContext(learning, lessonId) {
  for (const phase of learning.phases) {
    const lesson = phase.lessons.find((item) => item.lesson_id === lessonId);
    if (lesson) return { phase, lesson };
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
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  window.scrollTo({ top: 0, behavior });
}

function scrollToTarget(target) {
  const header = document.querySelector(".site-header");
  const headerOffset = (header?.offsetHeight || 0) + 12;
  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerOffset);
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  window.scrollTo({ top, behavior });
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

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
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

async function refreshLearningState() {
  state.learning = await provider.getLearningState(state.email);
  if (!state.selectedPhaseId) {
    state.selectedPhaseId = state.learning.currentPhase?.phase_id || "";
  }
}

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

async function handleSubmitWork(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) return;
  const isMiniWork = form.dataset.form === "mini-work";

  if (isMiniWork && !validateMiniWorkAnswer(answer)) {
    showMiniWorkInputError(form);
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
      scheduleMiniWorkEvaluationScroll();
    }
  } catch (error) {
    showFormSubmissionError(form, error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-loading");
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = originalButtonText;
  }
}

function validateMiniWorkAnswer(answer) {
  const text = String(answer || "").trim();
  const normalized = text.replace(/\s+/g, "");
  const placeholderPattern = /^(テスト|test|TEST|仮|仮入力|サンプル|sample|aaa|aaaa|あああ|いいい|ううう|確認|入力|未定|なし|特になし|特にない|とりあえず|ダミー|dummy|asdf|qwer|123|１２３|頑張ります|がんばります|分かりました|わかりました|やります|意識します|改善します)[。.!！]*$/i;
  const hasAction = /(する|します|試す|試し|確認|書く|書き|聞く|聞き|見る|見て|測る|測り|比べ|分解|相談|実行|改善|設定|決め|伝え|記録|選ぶ|選び|答え|見直|共有|使う|使い|行う|行い)/.test(text);
  const hasReason = /(なぜ|理由|ため|なので|から|目的|狙い|課題|必要|大切|改善|困って|選びました|選ぶ)/.test(text);
  const hasWhenWhere = /(今日|明日|今週|来週|月曜|火曜|水曜|木曜|金曜|土曜|日曜|午前|午後|朝|昼|夕方|夜|商談|会議|面談|顧客|上司|同僚|チーム|現場|店舗|電話|メール|LINE|資料|画面|[0-9０-９]+[日月週時分件回%％]?)/.test(text);

  if (normalized.length < 24) return false;
  if (placeholderPattern.test(normalized)) return false;
  if (/^(.)\1{4,}$/.test(normalized)) return false;
  if (!hasAction || !hasReason || !hasWhenWhere) return false;
  return true;
}

function showMiniWorkInputError(form) {
  clearMiniWorkInputError(form);
  const textarea = form.querySelector("textarea[name='answer']");
  const message = document.createElement("div");
  message.className = "form-error mini-work-input-error";
  message.setAttribute("role", "alert");
  message.textContent = MINI_WORK_INPUT_ERROR_MESSAGE;
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

async function handleSubmitAiWork(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const workId = form.dataset.workId;
  const submitButton = form.querySelector("button[type='submit']");
  const originalButtonText = submitButton.textContent;
  clearFormSubmissionError(form);
  submitButton.disabled = true;
  submitButton.classList.add("is-loading");
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "AIが確認しています";

  try {
    if (form.dataset.form === "ai-theme") {
      await provider.startAiWork(state.email, workId, formDataToObject(formData));
    }

    if (form.dataset.form === "ai-answer") {
      await provider.submitAiWorkAnswer(state.email, workId, formData.get("answer"));
    }

    if (form.dataset.form === "ai-intake-followup") {
      await provider.submitAiWorkIntakeFollowup(state.email, workId, formData.get("intake_followup_answer"));
    }

    if (form.dataset.form === "ai-followup") {
      await provider.submitAiWorkFollowup(state.email, workId, formData.get("followup_answer"));
    }

    if (form.dataset.form === "ai-revision") {
      await provider.submitAiWorkRevision(state.email, workId, formData.get("revision_answer"));
    }

    await refreshLearningState();
    window.location.hash = hashForWork(workId);
    render();
  } catch (error) {
    showFormSubmissionError(form, error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove("is-loading");
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = originalButtonText;
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
    window.location.hash = "#/login";
    renderLogin();
  }

  if (action === "reload") {
    window.location.reload();
  }

  if (action === "select-phase") {
    state.selectedPhaseId = actionTarget.dataset.phaseId;
    renderHome();
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

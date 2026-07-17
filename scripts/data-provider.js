import { AiEvaluationClient } from "./ai-evaluation-client.js?v=5-1-2";

const DATA_URL = "./data/learning-data.json?v=5-1-2";
const STORAGE_KEY = "barise-learning-local-state:v11";
const SESSION_KEY = "barise-learning-session:v4";
const LAST_EMAIL_KEY = "barise-learning-last-email:v4";
const MINI_WORK_PASS_THRESHOLD = 80;
const MINI_WORK_REVIEW_THRESHOLD = 60;
const MINI_WORK_MAX_RETRY_BEFORE_REVIEW = 3;
const SYNC_ENDPOINT_URL = "/.netlify/functions/learning-sync";
const SAVE_FAILURE_MESSAGE = "保存に失敗しました。通信状況を確認して、もう一度お試しください。入力内容は画面に残っています。";

export const statusLabels = {
  good: "通過",
  needs_more: "もう少し具体化",
  support_needed: "サポート相談",
  reviewing: "評価中",
  failed: "評価に失敗しました",
  submitted: "提出済み",
  not_submitted: "未提出",
  not_started: "未視聴",
  in_progress: "視聴中",
  watched: "視聴完了",
  locked: "未解放",
  unlocked: "提出できます",
  none: "対象なし"
};

export const aiWorkStatusLabels = {
  not_started: "未着手",
  theme_intake: "ヒアリング入力中",
  intake_required: "ヒアリング入力中",
  intake_reviewing: "AIが確認中",
  intake_followup_required: "追加質問があります",
  prompt_generated: "ワーク準備完了",
  answering: "回答中",
  ai_reviewing: "AIが確認中",
  followup_required: "追加質問があります",
  revision_required: "もう一度整理しましょう",
  final_feedback_ready: "フィードバックが届きました",
  completed: "完了",
  error: "一時的に処理できませんでした"
};

const SAFE_FIELD_LABELS = {
  profile_role_industry: "職種 / 業種",
  profile_current_work: "現在の主な業務",
  profile_theme: "今回扱いたいテーマ",
  profile_problem: "いま困っていること / 改善したいこと",
  profile_goal: "目標・達成したい状態",
  profile_case_example: "具体例に使ってよい業務ケース",
  learner_role: "現在の立場・役割",
  current_activity: "現在取り組んでいる業務・活動",
  learner_theme: "今回改善したいテーマ",
  current_situation: "現在の状況",
  current_actions: "現在行っている行動",
  available_metrics: "測定できそうな数値",
  target_result: "成果として見たいもの",
  strategy_tactic_execution: "戦略・戦術・実行の仮分解",
  goal: "理想の状態",
  problem: "今いちばん困っていること",
  ideal_state: "理想の状態",
  kgi_candidate: "最終成果の候補",
  kpi_candidate: "途中経過の指標候補",
  kdi_candidate: "行動指標の候補",
  vanity_metric_risk: "見せかけの数字になりそうなもの",
  failure_case: "直近でうまくいかなかった場面",
  why_analysis: "なぜを重ねた整理",
  root_cause_candidate: "根本原因の候補",
  issue_candidate: "取り組むべき課題の候補",
  key_metric: "確認したい重要指標",
  issue: "検証したい課題",
  hypothesis: "仮説",
  hypothesis_reason: "仮説の根拠",
  verification_plan: "検証計画",
  required_data: "確認に使うデータ",
  deadline: "確認期限",
  next_action_by_result: "結果別の次アクション",
  target_person: "対象者",
  target_problem: "相手が困っていること",
  evidence: "根拠",
  w1_w4_stage: "W1〜W4のどの段階か",
  intervention_point: "働きかけるポイント",
  expected_change: "期待する変化",
  explanation_summary: "説明の要約",
  result_or_learning: "結果または学び",
  intake_followup_answer: "追加ヒアリング回答"
};

const INTERNAL_LEARNER_TEXT_PATTERN = /\b(good|needs_more|support_needed|reviewing|failed|debug|mock|internal|hidden_from_learner|pass|retry|review|evaluate-work|gpt-4o-mini|OPENAI_API_KEY|learner_theme|current_situation|current_actions|available_metrics|target_result|strategy_tactic_execution)\b/i;
const AUTH_ENDPOINT_URL = "/.netlify/functions/auth-login";

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function isSupportRequestedText(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return false;

  if (/(相談され|相談された|相談されました|と言われ|と言っていた|と言われた|確認できませんでした|確認できなかった|聞けていませんでした|聞けませんでした|聞けていない|分からない状態を解消したい|わからない状態を解消したい)/.test(text)) {
    return false;
  }
  if (/(不安にさせない|不安を与えない|不安にしない|不安を減ら|不安を解消|不安なく|不安にさせたくない)/.test(text)) {
    return false;
  }

  return /(相談したい|相談したいです|相談させてください|担当者に相談|サポートしてほしい|サポートしてください|サポート相談したい|一緒に確認してほしい|一緒に確認してください|助けてください|自分では進められません|一人では進められません|一人では難しいので相談|分からないので相談したい|わからないので相談したい|どうしていいか分からないので相談|不安なので相談したい|不安だから相談したい|不安で進められません|不安なのでサポートしてほしい|不安なので一緒に確認してほしい)/.test(text);
}

export function getStatusLabel(status) {
  return statusLabels[status] || "確認中";
}

export function getAiWorkStatusLabel(status) {
  return aiWorkStatusLabels[status] || "未着手";
}

export function saveSession(email) {
  localStorage.setItem(SESSION_KEY, normalizeEmail(email));
  localStorage.setItem(LAST_EMAIL_KEY, normalizeEmail(email));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredSession() {
  return localStorage.getItem(SESSION_KEY) || "";
}

export function getLastEmail() {
  return localStorage.getItem(LAST_EMAIL_KEY) || "";
}

export function createLearningProvider(config = {}) {
  return new LocalJsonLearningProvider(config.dataUrl || DATA_URL);
}

export class LocalJsonLearningProvider {
  constructor(dataUrl = DATA_URL) {
    this.dataUrl = dataUrl;
    this.source = null;
    this.aiClient = new AiEvaluationClient();
    this.authEndpointUrl = AUTH_ENDPOINT_URL;
    this.syncEndpointUrl = "";
    this.syncFallbackToLocal = true;
    this.restoreCache = new Map();
    this.lastRestoreError = null;
  }

  async init() {
    const response = await fetch(this.dataUrl);
    if (!response.ok) {
      throw new Error("学習データを読み込めませんでした。");
    }

    this.source = await response.json();
    this.aiClient = new AiEvaluationClient(this.source.aiGateway || {});
    this.authEndpointUrl = this.source.authGateway?.endpointUrl || AUTH_ENDPOINT_URL;
    this.syncEndpointUrl = this.source.syncGateway?.endpointUrl || "";
    this.syncFallbackToLocal = this.source.syncGateway?.fallbackToLocalOnWriteFailure !== false;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      this._write(this._createInitialState());
      return;
    }

    this._write(this._mergeWithSource(JSON.parse(stored)));
  }

  async login(email) {
    const emailNormalized = normalizeEmail(email);
    if (!emailNormalized) {
      return { ok: false, reason: "empty" };
    }
    if (!isValidEmailFormat(emailNormalized)) {
      return {
        ok: false,
        reason: "invalid_email",
        message: "メールアドレスの形式を確認してください。"
      };
    }

    const auth = await this._authenticateEmail(emailNormalized);
    if (!auth.ok) {
      return auth;
    }

    const db = this._read();
    const user = this._ensureAuthenticatedUser(db, emailNormalized, auth.user || {});

    user.last_accessed_at = this._now();
    user.updated_at = this._now();
    this._write(db);

    await this._restoreLearningState(emailNormalized, { force: true });
    const restoredDb = this._read();
    const restoredUser = restoredDb.users.find((item) => item.email_normalized === emailNormalized) || user;

    return { ok: true, user: structuredClone(restoredUser) };
  }

  async _authenticateEmail(emailNormalized) {
    try {
      const response = await fetch(this.authEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailNormalized })
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || !body.ok) {
        return {
          ok: false,
          reason: body.reason || "auth_failed",
          message: body.message || "登録情報を確認できませんでした。公式LINEで登録したメールアドレスをご確認ください。"
        };
      }

      return {
        ok: true,
        user: body.user || {
          email: emailNormalized,
          email_key: body.email_key || emailNormalized,
          account_status: "active"
        }
      };
    } catch (error) {
      return {
        ok: false,
        reason: "auth_unavailable",
        message: "ログイン確認に時間がかかっています。少し時間を置いて再度お試しください。"
      };
    }
  }

  async getLearningState(email) {
    const emailNormalized = normalizeEmail(email);
    await this._restoreLearningState(emailNormalized);
    const db = this._read();
    const user = db.users.find((item) => item.email_normalized === emailNormalized);

    if (!user) {
      throw new Error("受講者情報が見つかりません。");
    }

    const submissions = db.submissions
      .filter((submission) => submission.email_normalized === emailNormalized)
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    const latestSubmissionByTarget = submissions.reduce((acc, submission) => {
      const key = `${submission.target_type}:${submission.target_id}`;
      if (!acc[key]) acc[key] = submission;
      return acc;
    }, {});
    const evaluationBySubmissionId = new Map(
      (db.evaluationResults || []).map((evaluation) => [evaluation.submission_id, evaluation])
    );

    const progressByLesson = new Map(
      db.progress
        .filter((item) => item.email_normalized === emailNormalized)
        .map((item) => [item.lesson_id, item])
    );
    const aiSessions = (db.aiWorkSessions || [])
      .filter((session) => session.email_normalized === emailNormalized)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    const aiSessionsByWork = new Map(aiSessions.map((session) => [session.work_id, session]));

    const currentPhaseId = user.current_phase_id || db.phases[0]?.phase_id;
    const currentPhase = db.phases.find((phase) => phase.phase_id === currentPhaseId) || db.phases[0];
    const currentPhaseOrder = currentPhase?.phase_order || 1;

    const phases = db.phases
      .slice()
      .sort((a, b) => a.phase_order - b.phase_order)
      .map((phase) => {
        const lessons = db.lessons
          .filter((lesson) => lesson.phase_id === phase.phase_id)
          .sort((a, b) => a.lesson_order - b.lesson_order)
          .map((lesson) => this._enrichLesson(db, lesson, emailNormalized, progressByLesson, latestSubmissionByTarget, evaluationBySubmissionId, aiSessionsByWork));

        const completedCount = lessons.filter((lesson) => lesson.isComplete).length;
        const isCurrent = phase.phase_id === currentPhaseId;

        return {
          ...phase,
          lessons,
          isCurrent,
          isAccessible: !phase.unlock_condition || phase.phase_order <= currentPhaseOrder,
          completedCount,
          lessonCount: lessons.length
        };
      });

    const allLessons = phases.flatMap((phase) => phase.lessons);
    const works = this._buildWorkList(db, emailNormalized, phases, progressByLesson, aiSessionsByWork);
    const currentLesson =
      allLessons.find((lesson) => !lesson.isComplete) ||
      allLessons.find((lesson) => lesson.lesson_id === user.current_lesson_id) ||
      allLessons[0] ||
      null;

    return {
      user: structuredClone(user),
      phases,
      currentPhase: phases.find((phase) => phase.phase_id === currentPhaseId) || phases[0],
      currentLesson,
      works,
      aiWorkSessions: structuredClone(aiSessions),
      aiEvaluationLogs: structuredClone((db.aiEvaluationLogs || []).filter((log) => log.email_normalized === emailNormalized)),
      staffFeedbackQueue: structuredClone((db.staffFeedbackQueue || []).filter((item) => item.email_normalized === emailNormalized)),
      submissions: structuredClone(submissions),
      evaluationResults: structuredClone(db.evaluationResults || []),
      progressSummary: this._buildProgressSummary(allLessons, works)
    };
  }

  async markVideoWatched(email, lessonId) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const lesson = db.lessons.find((item) => item.lesson_id === lessonId);
    if (!lesson) throw new Error("レッスンが見つかりません。");
    const now = this._now();

    await this._syncLearningEvent("markVideoWatched", {
      email: emailNormalized,
      lessonId: lesson.lesson_id,
      videoId: lesson.lesson_id,
      videoTitle: lesson.lesson_title || "",
      phaseId: lesson.phase_id,
      watchedAt: now,
      clientEventId: this._createId("VID")
    });

    const progress = this._getOrCreateProgress(db, emailNormalized, lesson);
    progress.video_status = "watched";
    progress.updated_at = now;

    this._touchUser(db, emailNormalized, lesson.phase_id, lesson.lesson_id);
    this._write(db);
  }

  async submitMiniWork(email, miniWorkId, answerText) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const miniWork = db.miniWorks.find((item) => item.mini_work_id === miniWorkId);
    if (!miniWork) throw new Error("ミニワークが見つかりません。");

    const lesson = db.lessons.find((item) => item.lesson_id === miniWork.lesson_id);
    const progress = this._getOrCreateProgress(db, emailNormalized, lesson);
    const now = this._now();
    const wasMiniWorkPassed = progress.mini_work_status === "good";
    db.evaluationResults = db.evaluationResults || [];
    db.aiEvaluationLogs = db.aiEvaluationLogs || [];
    db.staffFeedbackQueue = db.staffFeedbackQueue || [];

    const submission = {
      submission_id: this._createId("SUB"),
      email_normalized: emailNormalized,
      target_type: "mini_work",
      target_id: miniWorkId,
      answer_text: answerText.trim(),
      status: "reviewing",
      score: null,
      submitted_at: now
    };
    const criteria = this._findEvaluationCriteria(db, miniWork.evaluation_criteria_id, miniWork.mini_work_id);
    const submissionCount = this._miniWorkSubmissionCount(db, emailNormalized, miniWorkId) + 1;
    const retryCountBefore = this._miniWorkRetryCount(db, emailNormalized, miniWorkId);
    const localReview = this._reviewMiniWorkAnswer(miniWork, lesson, answerText, criteria);
    const user = db.users.find((item) => item.email_normalized === emailNormalized) || null;
    const payload = this._createMiniWorkEvaluationPayload(
      db,
      emailNormalized,
      user,
      miniWork,
      lesson,
      submission,
      criteria,
      localReview,
      submissionCount,
      now
    );
    const aiEvaluation = await this.aiClient.evaluateWork(payload);
    const evaluation = this._convertMiniAiEvaluationToResult(
      miniWork,
      lesson,
      submission,
      criteria,
      localReview,
      aiEvaluation,
      retryCountBefore,
      now
    );
    submission.status = evaluation.result_status;
    submission.score = evaluation.score;
    db.submissions.push(submission);
    db.evaluationResults.push(evaluation);
    this._storeMiniWorkEvaluationLog(db, emailNormalized, miniWork, lesson, submission, payload, aiEvaluation, evaluation, now);
    if (evaluation.result_status === "support_needed") {
      this._queueMiniWorkStaffFeedback(db, emailNormalized, user, miniWork, lesson, payload, aiEvaluation, evaluation, now);
    }

    const protectedFromDowngrade = wasMiniWorkPassed && evaluation.result_status !== "good";
    const effectiveResultStatus = protectedFromDowngrade ? "good" : evaluation.result_status;
    if (protectedFromDowngrade) {
      evaluation.progress_protected = true;
      evaluation.progress_status_after_submission = "good";
    }

    await this._syncLearningEvent("submitMiniWork", {
      email: emailNormalized,
      workType: "miniWork",
      miniWorkId,
      workId: miniWorkId,
      lessonId: lesson.lesson_id,
      phaseId: lesson.phase_id,
      workTitle: miniWork.workTitle || `${lesson.lesson_id} ミニワーク：${miniWork.title}`,
      answerText: submission.answer_text,
      submittedAt: now,
      retryCount: evaluation.retry_count,
      evaluation: this._syncEvaluationPayload(evaluation, effectiveResultStatus),
      clientSubmissionId: submission.submission_id
    });

    progress.mini_work_status = effectiveResultStatus;
    if (!protectedFromDowngrade || progress.last_score === null || progress.last_score === undefined) {
      progress.last_score = evaluation.score;
    }
    if (!protectedFromDowngrade) {
      progress.mini_work_retry_count = evaluation.retry_count;
    }
    progress.mini_work_passed_at = effectiveResultStatus === "good" ? (progress.mini_work_passed_at || now) : "";
    progress.updated_at = now;

    const relatedWorks = this._visibleWorksForLesson(db, lesson.lesson_id);
    if (effectiveResultStatus === "good") {
      relatedWorks.forEach((work) => {
        if (!this._isWorkUnlocked(db, emailNormalized, work)) return;
        this._relatedLessonIdsForWork(work).forEach((relatedLessonId) => {
          const relatedLesson = db.lessons.find((item) => item.lesson_id === relatedLessonId);
          if (!relatedLesson) return;
          const relatedProgress = this._getOrCreateProgress(db, emailNormalized, relatedLesson);
          if (["locked", "none"].includes(relatedProgress.work_status)) {
            relatedProgress.work_status = "unlocked";
          }
          relatedProgress.updated_at = now;
        });
      });
    }
    const hasUnlockedWork = relatedWorks.some((work) => this._isWorkUnlocked(db, emailNormalized, work));
    if (effectiveResultStatus === "good" && evaluation.result_status === "good") {
      evaluation.next_action_text = hasUnlockedWork ? "ワークへ進む" : "次の動画へ進む";
    }
    progress.next_action = this._nextActionForMiniWork(
      effectiveResultStatus,
      hasUnlockedWork
    );

    this._touchUser(db, emailNormalized, lesson.phase_id, lesson.lesson_id);
    this._write(db);
  }

  async submitWork(email, workId, answerText, lessonId = "") {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = db.works.find((item) => item.work_id === workId);
    if (!work) throw new Error("ワークが見つかりません。");
    if (work.hidden_from_learner || work.is_candidate) {
      throw new Error("このワークは現在提出できません。");
    }

    if (!this._isWorkUnlocked(db, emailNormalized, work)) {
      throw new Error("ワークは関連するミニワーク通過後に提出できます。");
    }

    const fallbackLessonId = this._relatedLessonIdsForWork(work)[0];
    const lesson = db.lessons.find((item) => item.lesson_id === lessonId) ||
      db.lessons.find((item) => item.lesson_id === fallbackLessonId);
    if (!lesson) throw new Error("レッスンが見つかりません。");
    const now = this._now();
    db.evaluationResults = db.evaluationResults || [];

    const submission = {
      submission_id: this._createId("SUB"),
      email_normalized: emailNormalized,
      target_type: "work",
      target_id: workId,
      answer_text: answerText.trim(),
      status: "reviewing",
      score: null,
      submitted_at: now
    };
    const evaluation = this._createMockEvaluation(submission, "work", now, work);
    submission.status = evaluation.result_status;
    submission.score = evaluation.score;

    await this._syncLearningEvent("submitWork", {
      email: emailNormalized,
      workType: "work",
      workId,
      lessonId: lesson.lesson_id,
      phaseId: lesson.phase_id,
      workTitle: work.title,
      questionText: work.prompt || "",
      answerText: submission.answer_text,
      submittedAt: now,
      evaluation: this._syncEvaluationPayload(evaluation),
      clientSubmissionId: submission.submission_id
    });

    db.submissions.push(submission);
    db.evaluationResults.push(evaluation);

    this._relatedLessonIdsForWork(work).forEach((relatedLessonId) => {
      const relatedLesson = db.lessons.find((item) => item.lesson_id === relatedLessonId);
      if (!relatedLesson) return;
      const relatedProgress = this._getOrCreateProgress(db, emailNormalized, relatedLesson);
      relatedProgress.work_status = evaluation.result_status;
      relatedProgress.last_score = evaluation.score;
      relatedProgress.next_action = evaluation.result_status === "good" ? "next_lesson" : "revise_work";
      relatedProgress.updated_at = now;
    });

    this._touchUser(db, emailNormalized, lesson.phase_id, lesson.lesson_id);
    this._write(db);
  }

  async startAiWork(email, workId, input) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const user = db.users.find((item) => item.email_normalized === emailNormalized);
    const now = this._now();
    const session = this._getOrCreateAiWorkSession(db, emailNormalized, work, user, now);

    this._applyAiWorkInput(session, input);
    session.previous_work_context = this._summarizePreviousAiWorkSessions(db, emailNormalized, work);
    const intakeReview = this._reviewIntake(work, session);

    if (intakeReview.needsFollowup) {
      session.status = "intake_followup_required";
      session.generated_work_prompt = "";
      session.ai_summary = intakeReview.summary;
      session.missing_points = intakeReview.missingPoints;
      session.followup_questions = intakeReview.followupQuestions;
      session.last_intake_missing_keys = intakeReview.missingKeys;
      session.can_continue_with_placeholders = false;
      session.intake_placeholder_notice = "";
      session.next_action = "追加質問に回答してください。";
    } else {
      this._prepareAiWorkPrompt(work, session);
    }

    session.updated_at = now;

    this._write(db);
    return structuredClone(session);
  }

  async submitAiWorkIntakeFollowup(email, workId, answerText) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const user = db.users.find((item) => item.email_normalized === emailNormalized);
    const now = this._now();
    const session = this._getOrCreateAiWorkSession(db, emailNormalized, work, user, now);
    const answer = String(answerText || "").trim();
    const questions = Array.isArray(session.followup_questions) && session.followup_questions.length
      ? session.followup_questions
      : this._reviewIntake(work, session).followupQuestions;

    session.followup_history = session.followup_history || [];
    session.followup_history.push({
      type: "intake",
      question: questions.join("\n"),
      answer,
      reason: (session.missing_points || []).join(" / "),
      created_at: now
    });
    session.learner_context = {
      ...(session.learner_context || {}),
      intake_followup_answer: [session.learner_context?.intake_followup_answer, answer].filter(Boolean).join("\n")
    };
    session.intake_followup_attempts = (session.intake_followup_attempts || 0) + 1;

    const intakeReview = this._reviewIntake(work, session);
    const repeatedMissing = this._isSameMissingKeys(session.last_intake_missing_keys, intakeReview.missingKeys);

    if (!intakeReview.needsFollowup) {
      session.can_continue_with_placeholders = false;
      session.intake_placeholder_notice = "";
      this._prepareAiWorkPrompt(work, session);
    } else {
      session.status = "intake_followup_required";
      const canContinueWithPlaceholders = session.intake_followup_attempts >= 2 && intakeReview.missingKeys.length > 0;
      session.ai_summary = canContinueWithPlaceholders
        ? "入力ありがとうございます。同じ観点の材料がまだ不足しています。もう一度だけ具体化するか、仮置きで進めて回答中に補うこともできます。"
        : "入力ありがとうございます。まだワークを始める材料が少ないため、もう一段だけ具体化しましょう。";
      session.missing_points = intakeReview.missingPoints;
      session.followup_questions = intakeReview.followupQuestions;
      session.last_intake_missing_keys = intakeReview.missingKeys;
      session.can_continue_with_placeholders = canContinueWithPlaceholders;
      session.intake_placeholder_notice = session.can_continue_with_placeholders
        ? "不足している観点は仮置きで進められます。回答欄では、未確定の部分を自分の言葉で補ってください。"
        : "";
      session.next_action = "追加質問に回答してください。";
    }

    session.updated_at = now;
    await this._syncAiWorkSessionEvent("submitAiWorkIntakeFollowup", emailNormalized, work, session, answer, "intake_followup", now);
    this._write(db);
    return structuredClone(session);
  }

  async continueAiWorkWithIntakePlaceholders(email, workId) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const user = db.users.find((item) => item.email_normalized === emailNormalized);
    const now = this._now();
    const session = this._getOrCreateAiWorkSession(db, emailNormalized, work, user, now);
    const intakeReview = this._reviewIntake(work, session);

    session.intake_placeholder_notice = intakeReview.needsFollowup
      ? `${intakeReview.missingPoints.slice(0, 3).join("、")}は仮置きです。回答欄で、分かる範囲から具体化してください。`
      : "";
    session.can_continue_with_placeholders = false;
    this._prepareAiWorkPrompt(work, session);
    session.ai_summary = intakeReview.needsFollowup
      ? "不足している材料を仮置きし、ワーク回答の中で補う形で進めます。"
      : session.ai_summary;
    session.updated_at = now;

    this._write(db);
    return structuredClone(session);
  }

  async submitAiWorkAnswer(email, workId, answerText) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const user = db.users.find((item) => item.email_normalized === emailNormalized);
    const now = this._now();
    const session = this._getOrCreateAiWorkSession(db, emailNormalized, work, user, now);

    session.initial_answer = String(answerText || "").trim();
    const review = this._reviewWorkAnswer(work, session, session.initial_answer, "initial");
    await this._evaluateAndApplyAiWorkReview(db, emailNormalized, work, session, session.initial_answer, "initial", review, now);
    session.updated_at = now;

    await this._syncAiWorkSessionEvent("submitAiWorkAnswer", emailNormalized, work, session, session.initial_answer, "initial", now);
    this._write(db);
    return structuredClone(session);
  }

  async submitAiWorkFollowup(email, workId, answerText) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const user = db.users.find((item) => item.email_normalized === emailNormalized);
    const now = this._now();
    const session = this._getOrCreateAiWorkSession(db, emailNormalized, work, user, now);
    const answer = String(answerText || "").trim();
    const questions = Array.isArray(session.followup_questions) && session.followup_questions.length
      ? session.followup_questions
      : this._createAiFollowupQuestions(work, session);

    session.followup_history = session.followup_history || [];
    session.followup_history.push({
      type: "followup",
      question: questions.join("\n"),
      answer,
      reason: (session.unmet_criteria || []).join(" / "),
      created_at: now
    });

    const review = this._reviewWorkAnswer(work, session, answer, "followup");
    await this._evaluateAndApplyAiWorkReview(db, emailNormalized, work, session, answer, "followup", review, now);

    await this._syncAiWorkSessionEvent("submitAiWorkFollowup", emailNormalized, work, session, answer, "followup", now);
    this._write(db);
    return structuredClone(session);
  }

  async submitAiWorkRevision(email, workId, answerText) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const user = db.users.find((item) => item.email_normalized === emailNormalized);
    const now = this._now();
    const session = this._getOrCreateAiWorkSession(db, emailNormalized, work, user, now);
    const answer = String(answerText || "").trim();

    session.revision_history = session.revision_history || [];
    session.revision_history.push({
      before: session.revision_source_answer || session.initial_answer || "",
      ai_feedback: session.ai_feedback || session.ai_summary || "",
      after: answer,
      created_at: now
    });
    session.latest_revision_answer = answer;

    const review = this._reviewWorkAnswer(work, session, answer, "revision");
    await this._evaluateAndApplyAiWorkReview(db, emailNormalized, work, session, answer, "revision", review, now);

    await this._syncAiWorkSessionEvent("submitAiWorkRevision", emailNormalized, work, session, answer, "revision", now);
    this._write(db);
    return structuredClone(session);
  }

  async retryAiWork(email, workId) {
    const db = this._read();
    const emailNormalized = normalizeEmail(email);
    const session = (db.aiWorkSessions || []).find((item) => item.email_normalized === emailNormalized && item.work_id === workId);
    if (!session) throw new Error("保存中のワークが見つかりません。");
    const work = this._findWork(db, workId);
    if (!work) throw new Error("ワークが見つかりません。");
    const answer = session.latest_revision_answer || session.initial_answer || "";
    if (session.ai_error_info && answer) {
      const now = this._now();
      const review = this._reviewWorkAnswer(work, session, answer, "retry");
      await this._evaluateAndApplyAiWorkReview(db, emailNormalized, work, session, answer, "retry", review, now);
      session.updated_at = now;
      await this._syncAiWorkSessionEvent("retryAiWork", emailNormalized, work, session, answer, "retry", now);
      this._write(db);
      return structuredClone(session);
    }
    session.status = session.initial_answer ? "revision_required" : "prompt_generated";
    session.updated_at = this._now();
    this._write(db);
    return structuredClone(session);
  }

  _createInitialState() {
    const data = this.source.sampleData || {};
    return {
      users: structuredClone(data.users || []),
      phases: structuredClone(data.phases || []),
      lessons: structuredClone(data.lessons || []),
      miniWorks: structuredClone(data.miniWorks || []),
      works: structuredClone(data.works || []),
      progress: structuredClone(data.progress || []),
      submissions: structuredClone(data.submissions || []),
      evaluationResults: structuredClone(data.evaluationResults || []),
      aiWorkSessions: structuredClone(data.aiWorkSessions || []),
      aiEvaluationLogs: structuredClone(data.aiEvaluationLogs || []),
      staffFeedbackQueue: structuredClone(data.staffFeedbackQueue || []),
      evaluationCriteria: structuredClone(data.evaluationCriteria || []),
      workEvaluationCriteria: structuredClone(data.workEvaluationCriteria || []),
      mappings: structuredClone(data.mappings || []),
      sourceMaterials: structuredClone(data.sourceMaterials || []),
      extractionWarnings: structuredClone(data.extractionWarnings || []),
      implementationNotes: structuredClone(data.implementationNotes || {})
    };
  }

  _mergeWithSource(stored) {
    const initial = this._createInitialState();
    return {
      users: this._mergeByKey(initial.users, stored.users, "user_id"),
      phases: this._mergeByKey(initial.phases, stored.phases, "phase_id"),
      lessons: initial.lessons, // V5.1.1 fix: content lessons always from source JSON (prevents stale localStorage from wiping video_url)
      miniWorks: this._mergeByKey(initial.miniWorks, stored.miniWorks, "mini_work_id"),
      works: this._mergeByKey(initial.works, stored.works, "work_id"),
      progress: stored.progress || initial.progress,
      submissions: stored.submissions || initial.submissions,
      evaluationResults: stored.evaluationResults || initial.evaluationResults,
      aiWorkSessions: stored.aiWorkSessions || initial.aiWorkSessions,
      aiEvaluationLogs: stored.aiEvaluationLogs || initial.aiEvaluationLogs,
      staffFeedbackQueue: stored.staffFeedbackQueue || initial.staffFeedbackQueue,
      evaluationCriteria: initial.evaluationCriteria,
      workEvaluationCriteria: initial.workEvaluationCriteria,
      mappings: initial.mappings,
      sourceMaterials: initial.sourceMaterials,
      extractionWarnings: initial.extractionWarnings,
      implementationNotes: initial.implementationNotes
    };
  }

  _mergeByKey(sourceRows, storedRows = [], key) {
    const rows = new Map(sourceRows.map((row) => [row[key], row]));
    storedRows.forEach((row) => rows.set(row[key], { ...(rows.get(row[key]) || {}), ...row }));
    return Array.from(rows.values());
  }

  _enrichLesson(db, lesson, email, progressByLesson, latestSubmissionByTarget, evaluationBySubmissionId, aiSessionsByWork = new Map()) {
    const progress = progressByLesson.get(lesson.lesson_id) || this._createDefaultProgress(email, lesson);
    const miniWork = db.miniWorks.find((item) => item.lesson_id === lesson.lesson_id) || null;
    const work = this._visibleWorksForLesson(db, lesson.lesson_id)[0] || null;
    const miniSubmission = miniWork ? latestSubmissionByTarget[`mini_work:${miniWork.mini_work_id}`] || null : null;
    const workSubmission = work ? latestSubmissionByTarget[`work:${work.work_id}`] || null : null;
    const miniEvaluation = miniSubmission ? evaluationBySubmissionId.get(miniSubmission.submission_id) || null : null;
    const workEvaluation = workSubmission ? evaluationBySubmissionId.get(workSubmission.submission_id) || null : null;
    const aiWorkSession = work ? aiSessionsByWork.get(work.work_id) || null : null;
    const workUnlocked = work ? this._isWorkUnlocked(db, email, work, progressByLesson) : false;
    const savedWorkStatus = workEvaluation?.result_status || progress.work_status;
    const computedWorkStatus = work
      ? workUnlocked
        ? (savedWorkStatus === "locked" ? "unlocked" : savedWorkStatus)
        : (savedWorkStatus === "good" ? "good" : "locked")
      : progress.work_status;
    const progressForView = { ...structuredClone(progress), work_status: computedWorkStatus };
    const miniPassed = progressForView.mini_work_status === "good";
    const remainingLessonIds = work ? this._remainingMiniLessonIdsForWork(db, email, work, progressByLesson) : [];
    const nextUnlockLessonId = remainingLessonIds.find((lessonId) => lessonId !== lesson.lesson_id) || "";
    const canSubmitWork = Boolean(work) && workUnlocked && ["unlocked", "needs_more", "support_needed"].includes(computedWorkStatus);
    const workPassed = !work || computedWorkStatus === "good";

    return {
      ...lesson,
      progress: progressForView,
      miniWork: miniWork ? structuredClone(miniWork) : null,
      work: work ? structuredClone(work) : null,
      latestMiniSubmission: miniSubmission ? structuredClone(miniSubmission) : null,
      latestWorkSubmission: workSubmission ? structuredClone(workSubmission) : null,
      latestMiniEvaluation: miniEvaluation ? structuredClone(miniEvaluation) : null,
      latestWorkEvaluation: workEvaluation ? structuredClone(workEvaluation) : null,
      latestAiWorkSession: aiWorkSession ? structuredClone(aiWorkSession) : null,
      aiWorkStatus: aiWorkSession?.status || "not_started",
      aiWorkStatusLabel: getAiWorkStatusLabel(aiWorkSession?.status || "not_started"),
      workUnlockRemainingLessonIds: remainingLessonIds,
      nextUnlockLessonId,
      canSubmitWork,
      isComplete: progress.video_status === "watched" && (!lesson.mini_work_required || miniPassed) && workPassed
    };
  }

  _buildProgressSummary(lessons, works = []) {
    const videoTotal = lessons.length;
    const miniTotal = lessons.filter((lesson) => lesson.mini_work_required).length;
    const videoDone = lessons.filter((lesson) => lesson.progress.video_status === "watched").length;
    const miniDone = lessons.filter((lesson) => lesson.mini_work_required && lesson.progress.mini_work_status === "good").length;
    const workTotal = works.length;
    const workDone = works.filter((work) => work.aiStatus === "completed").length;
    const totalSteps = videoTotal + miniTotal + workTotal;
    const doneSteps = videoDone + miniDone + workDone;

    return {
      videoDone,
      videoTotal,
      miniDone,
      miniTotal,
      workDone,
      workTotal,
      doneSteps,
      totalSteps,
      percent: totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0
    };
  }

  _getOrCreateProgress(db, email, lesson) {
    let progress = db.progress.find((item) => item.email_normalized === email && item.lesson_id === lesson.lesson_id);
    if (!progress) {
      progress = this._createDefaultProgress(email, lesson);
      db.progress.push(progress);
    }
    return progress;
  }

  _createDefaultProgress(email, lesson) {
    return {
      progress_id: `PRG-${email}-${lesson.lesson_id}`,
      email_normalized: email,
      user_id: "",
      phase_id: lesson.phase_id,
      lesson_id: lesson.lesson_id,
      video_status: "not_started",
      mini_work_status: lesson.mini_work_required ? "not_submitted" : "none",
      work_status: lesson.work_required ? "locked" : "none",
      last_score: null,
      next_action: "watch_video",
      mini_work_retry_count: 0,
      mini_work_passed_at: "",
      updated_at: this._now()
    };
  }

  _visibleWorksForLesson(db, lessonId) {
    return (db.works || []).filter((work) => {
      if (work.show_to_learner === false) return false;
      return this._relatedLessonIdsForWork(work).includes(lessonId);
    });
  }

  _relatedLessonIdsForWork(work) {
    if (Array.isArray(work.related_lesson_ids) && work.related_lesson_ids.length) {
      return work.related_lesson_ids;
    }
    return work.related_lesson_id ? [work.related_lesson_id] : [];
  }

  _isWorkUnlocked(db, email, work, progressByLesson = null) {
    return this._workUnlockState(db, email, work, progressByLesson).unlocked;
  }

  _remainingMiniLessonIdsForWork(db, email, work, progressByLesson = null) {
    return this._workUnlockState(db, email, work, progressByLesson).missingMiniLessonIds;
  }

  _workUnlockState(db, email, work, progressByLesson = null) {
    if (!work || work.hidden_from_learner || work.show_to_learner === false) {
      return this._createWorkUnlockState(false, [], [], "このワークは現在表示されていません。");
    }

    const requiredLessonIds = this._requiredLessonIdsForWork(work);
    const requiredMiniWorkIds = this._requiredMiniWorkIdsForWork(work);
    const relatedMiniWorks = this._relatedLessonIdsForWork(work)
      .map((lessonId) => db.miniWorks.find((miniWork) => miniWork.lesson_id === lessonId))
      .filter(Boolean);
    const allRequiredMiniWorks = [
      ...relatedMiniWorks,
      ...requiredMiniWorkIds.map((miniWorkId) => db.miniWorks.find((miniWork) => miniWork.mini_work_id === miniWorkId)).filter(Boolean)
    ].filter((miniWork, index, rows) => rows.findIndex((item) => item.mini_work_id === miniWork.mini_work_id) === index);

    const missingLessonIds = requiredLessonIds.filter((lessonId) => {
      const progress = progressByLesson?.get(lessonId) ||
        db.progress.find((item) => item.email_normalized === email && item.lesson_id === lessonId);
      return progress?.video_status !== "watched";
    });
    const missingMiniWorks = allRequiredMiniWorks.filter((miniWork) => {
      const progress = progressByLesson?.get(miniWork.lesson_id) ||
        db.progress.find((item) => item.email_normalized === email && item.lesson_id === miniWork.lesson_id);
      return progress?.mini_work_status !== "good";
    });
    const missingMiniLessonIds = missingMiniWorks.map((miniWork) => miniWork.lesson_id);
    const missingMiniWorkIds = missingMiniWorks.map((miniWork) => miniWork.mini_work_id);
    const unlocked = !missingLessonIds.length && !missingMiniWorkIds.length;
    const reason = unlocked
      ? "開始できます"
      : [
          missingLessonIds.length ? `関連動画 あと${missingLessonIds.length}件` : "",
          missingMiniWorkIds.length ? `関連ミニワーク あと${missingMiniWorkIds.length}件` : ""
        ].filter(Boolean).join(" / ");

    return this._createWorkUnlockState(unlocked, missingLessonIds, missingMiniLessonIds, reason, missingMiniWorkIds);
  }

  _createWorkUnlockState(unlocked, missingLessonIds = [], missingMiniLessonIds = [], reason = "", missingMiniWorkIds = []) {
    return {
      unlocked,
      missingLessonIds,
      missingMiniLessonIds,
      missingMiniWorkIds,
      reason
    };
  }

  _requiredLessonIdsForWork(work) {
    const explicit = [
      ...(Array.isArray(work.required_lesson_ids) ? work.required_lesson_ids : []),
      ...(Array.isArray(work.unlock_policy?.required_lesson_ids) ? work.unlock_policy.required_lesson_ids : [])
    ].filter(Boolean);
    if (explicit.length) return Array.from(new Set(explicit));
    return this._relatedLessonIdsForWork(work);
  }

  _requiredMiniWorkIdsForWork(work) {
    const explicit = [
      ...(Array.isArray(work.required_mini_work_ids) ? work.required_mini_work_ids : []),
      ...(Array.isArray(work.unlock_policy?.required_mini_work_ids) ? work.unlock_policy.required_mini_work_ids : [])
    ].filter(Boolean);
    return Array.from(new Set(explicit));
  }

  _findEvaluationCriteria(db, criteriaId, targetId) {
    return (db.evaluationCriteria || []).find((item) => item.criteria_id === criteriaId) ||
      (db.evaluationCriteria || []).find((item) => item.target_id === targetId) ||
      null;
  }

  _findWorkEvaluationKnowledge(workId, work = null) {
    const sampleCriteria = this.source?.sampleData?.workEvaluationCriteria || [];
    const knowledge = work?.evaluation_knowledge ||
      sampleCriteria.find((item) => item.workId === workId || item.work_id === workId) ||
      {};
    return {
      workId: knowledge.workId || knowledge.work_id || workId,
      title: knowledge.title || work?.title || "",
      workGoal: knowledge.workGoal || knowledge.work_goal || work?.work_goal || work?.purpose || "",
      passRequiredElements: this._safeStringArray(knowledge.passRequiredElements || knowledge.pass_required_elements),
      aCriteria: this._safeStringArray(knowledge.aCriteria || knowledge.a_criteria),
      bCriteria: this._safeStringArray(knowledge.bCriteria || knowledge.b_criteria),
      cCriteria: this._safeStringArray(knowledge.cCriteria || knowledge.c_criteria),
      commonMisconceptions: this._safeStringArray(knowledge.commonMisconceptions || knowledge.common_misconceptions),
      modelAnswerChecklist: this._safeStringArray(knowledge.modelAnswerChecklist || knowledge.model_answer_checklist),
      badAnswerPatterns: this._safeStringArray(knowledge.badAnswerPatterns || knowledge.bad_answer_patterns),
      modelAnswerExample: String(knowledge.modelAnswerExample || knowledge.model_answer_example || "")
    };
  }

  _workRubricFromKnowledge(knowledge = {}) {
    return [
      { grade: "A", label: "よくできました", criteria: (knowledge.aCriteria || []).join(" / ") },
      { grade: "B", label: "もう一歩", criteria: (knowledge.bCriteria || []).join(" / ") },
      { grade: "C", label: "再挑戦しよう", criteria: (knowledge.cCriteria || []).join(" / ") }
    ].filter((item) => item.criteria);
  }

  _miniWorkCriteria(miniWork, criteria = null) {
    const requiredElements = this._miniWorkRequiredElements(miniWork, criteria);
    if (requiredElements.length) return requiredElements;

    const rubricCriteria = (criteria?.rubric || [])
      .map((item) => item.criteria)
      .filter(Boolean);
    if (rubricCriteria.length) {
      return rubricCriteria;
    }

    if (Array.isArray(miniWork.criteria) && miniWork.criteria.length) {
      return miniWork.criteria.filter(Boolean);
    }

    return [
      "動画内容と関係する観点で回答している",
      "自分の業務・状況に置き換えている",
      "具体的な場面・数値・行動のいずれかが含まれている"
    ];
  }

  _miniWorkRubric(criteria = null) {
    return (criteria?.rubric || [])
      .map((item, index) => ({
        grade: item.grade || this._inferRubricGrade(item, index),
        label: item.label || this._rubricLabel(item.grade || this._inferRubricGrade(item, index)),
        criteria: item.criteria || ""
      }))
      .filter((item) => item.grade && item.criteria);
  }

  _miniWorkRequiredElements(miniWork, criteria = null) {
    const elements = Array.isArray(criteria?.required_elements)
      ? criteria.required_elements
      : Array.isArray(miniWork.required_elements)
        ? miniWork.required_elements
        : [];
    if (elements.length) return elements.filter(Boolean);

    const aCriteria = (criteria?.rubric || [])
      .find((item, index) => (item.grade || this._inferRubricGrade(item, index)) === "A")
      ?.criteria || "";
    return aCriteria
      .split(/[／/]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  _inferRubricGrade(item = {}, index = 0) {
    const text = `${item.grade || ""} ${item.level || ""} ${item.label || ""}`;
    if (/A|★★★/.test(text)) return "A";
    if (/B|★★（/.test(text)) return "B";
    if (/C|★（/.test(text)) return "C";
    return ["A", "B", "C"][index] || "C";
  }

  _rubricLabel(grade) {
    if (grade === "A") return "よくできました";
    if (grade === "B") return "もう一歩";
    return "再挑戦しよう";
  }

  _miniWorkCriteriaBundle(miniWork, criteria = null) {
    return {
      criteria: this._miniWorkCriteria(miniWork, criteria),
      rubric: this._miniWorkRubric(criteria),
      required_elements: this._miniWorkRequiredElements(miniWork, criteria),
      core_messages: this._safeStringArray(criteria?.core_messages || miniWork.core_messages),
      common_misconceptions: this._safeStringArray(criteria?.common_misconceptions || miniWork.common_misconceptions),
      learner_prompt_full: criteria?.learner_prompt_full || miniWork.learner_prompt_full || miniWork.prompt || "",
      feedback_template_summary: criteria?.feedback_template_summary || miniWork.feedback_template_summary || {}
    };
  }

  _safeStringArray(values) {
    return Array.isArray(values)
      ? values.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  }

  _miniWorkSubmissionCount(db, email, miniWorkId) {
    return (db.submissions || []).filter((submission) =>
      submission.email_normalized === email &&
      submission.target_type === "mini_work" &&
      submission.target_id === miniWorkId
    ).length;
  }

  _miniWorkRetryCount(db, email, miniWorkId) {
    const submissionIds = new Set((db.submissions || [])
      .filter((submission) =>
        submission.email_normalized === email &&
        submission.target_type === "mini_work" &&
        submission.target_id === miniWorkId
      )
      .map((submission) => submission.submission_id));

    return (db.evaluationResults || []).filter((evaluation) =>
      submissionIds.has(evaluation.submission_id) &&
      ["needs_more", "failed"].includes(evaluation.result_status)
    ).length;
  }

  _reviewMiniWorkAnswer(miniWork, lesson, answerText, criteria = null) {
    const answer = String(answerText || "").trim();
    const criteriaTexts = this._miniWorkCriteria(miniWork, criteria);
    const supportRequested = isSupportRequestedText(answer);
    const emptyOrAvoiding = /^(なし|特になし|特にない|未定|全部|頑張ります|がんばります|意識します|やります|改善します)。?$/i.test(answer);
    const hasAction = /(する|試す|確認|書く|聞く|見る|測る|比べる|分解|相談|実行|改善|設定|決める|伝える|記録|選ぶ|答える)/.test(answer);
    const hasConcrete = this._hasConcreteDetail(answer) || this._hasMetricWords(answer);
    const lessonWords = [lesson?.lesson_title, miniWork.theme, miniWork.title, miniWork.goal]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/[／・、\s]+/))
      .filter((value) => value.length >= 2)
      .slice(0, 8);
    const hasLessonConnection = lessonWords.length
      ? lessonWords.some((word) => answer.includes(word)) || answer.length >= 45
      : answer.length >= 45;

    const metCriteria = [];
    const unmetCriteria = [];
    if (hasLessonConnection) {
      metCriteria.push(criteriaTexts[0]);
    } else {
      unmetCriteria.push(criteriaTexts[0]);
    }
    if (hasConcrete || answer.length >= 45) {
      metCriteria.push(criteriaTexts[1]);
    } else {
      unmetCriteria.push(criteriaTexts[1]);
    }
    if (hasAction && (hasConcrete || answer.length >= 32)) {
      metCriteria.push(criteriaTexts[2]);
    } else {
      unmetCriteria.push(criteriaTexts[2]);
    }

    const tooThin = answer.length < 24 || emptyOrAvoiding || (!hasConcrete && !hasAction);
    const completed = !supportRequested && !tooThin && unmetCriteria.length === 0;
    const summary = completed
      ? `${miniWork.title}の目的に沿って、動画内容をご自身の状況へ置き換えられています。`
      : supportRequested
        ? "一人で整理しにくい状態が含まれています。担当者確認につなげると進めやすそうです。"
        : "方向性はあります。実際の場面・数字・次に取る行動のどれかをもう一段足すと通過に近づきます。";

    return {
      status: completed ? "completed" : (supportRequested ? "review" : "retry"),
      summary,
      goodPoints: metCriteria.length
        ? metCriteria.slice(0, 3).map((item) => `${item}点が見えています。`)
        : ["ミニワークに向き合い、回答を出せています。"],
      improvementPoints: completed
        ? []
        : (unmetCriteria.length ? unmetCriteria : ["具体的な場面・数字・行動を1つ足してください。"]).slice(0, 3),
      metCriteria,
      unmetCriteria: completed ? [] : (unmetCriteria.length ? unmetCriteria : ["具体的な場面・数字・行動を1つ足してください。"]),
      followupQuestions: completed ? [] : [this._miniWorkNextQuestion(miniWork, unmetCriteria)],
      flags: {
        needsSupport: supportRequested,
        tooAbstract: tooThin,
        missingConcreteExample: !hasConcrete,
        missingLessonConnection: !hasLessonConnection
      }
    };
  }

  _miniWorkNextQuestion(miniWork, unmetCriteria = []) {
    const focus = unmetCriteria[0] || "具体的な場面・数字・行動";
    if (/動画|関係|観点/.test(focus)) {
      return "動画で扱った考え方のうち、今回の回答ではどの部分を使いますか？";
    }
    if (/業務|状況|置き換/.test(focus)) {
      return "あなたの実際の業務では、いつ・誰に対して・何をする場面に置き換えられますか？";
    }
    return `${miniWork.title}について、実際の場面・数字・次に取る行動を1つ足して書いてみましょう。`;
  }

  _createMiniWorkEvaluationPayload(db, email, user, miniWork, lesson, submission, criteria, localReview, submissionCount, now) {
    const criteriaTexts = this._miniWorkCriteria(miniWork, criteria);
    const criteriaBundle = this._miniWorkCriteriaBundle(miniWork, criteria);
    const requestId = this._createId("AI-MW-REQ");
    const profile = this._latestCommonProfile(db, email);
    const workPurpose = miniWork.workPurpose || miniWork.goal || miniWork.expected_output || "動画内容を自分の業務に置き換え、短く言語化する";

    return {
      schema_version: "barise-mini-work-evaluation-request-v1",
      request_id: requestId,
      requestId,
      submission_id: submission.submission_id,
      submissionId: submission.submission_id,
      user_id: user?.user_id || "",
      user: {
        userId: user?.user_id || "",
        email,
        displayName: user?.display_name || ""
      },
      email_normalized: email,
      workType: "miniWork",
      contentType: "miniWork",
      isMiniWork: true,
      miniWorkId: miniWork.mini_work_id,
      mini_work_id: miniWork.mini_work_id,
      parentLessonId: lesson.lesson_id,
      parent_lesson_id: lesson.lesson_id,
      work_id: miniWork.mini_work_id,
      workId: miniWork.mini_work_id,
      phase_id: miniWork.phase_id,
      workTitle: miniWork.workTitle || `${lesson.lesson_id} ミニワーク：${miniWork.title}`,
      workPurpose,
      criteria: criteriaTexts,
      rubric: criteriaBundle.rubric,
      requiredElements: criteriaBundle.required_elements,
      required_elements: criteriaBundle.required_elements,
      coreMessages: criteriaBundle.core_messages,
      core_messages: criteriaBundle.core_messages,
      commonMisconceptions: criteriaBundle.common_misconceptions,
      common_misconceptions: criteriaBundle.common_misconceptions,
      learnerPromptFull: criteriaBundle.learner_prompt_full,
      learner_prompt_full: criteriaBundle.learner_prompt_full,
      originalQuestion: criteriaBundle.learner_prompt_full,
      original_question: criteriaBundle.learner_prompt_full,
      feedbackTemplateSummary: criteriaBundle.feedback_template_summary,
      feedback_template_summary: criteriaBundle.feedback_template_summary,
      passThreshold: Number(miniWork.passThreshold || miniWork.pass_threshold || miniWork.passing_score || MINI_WORK_PASS_THRESHOLD),
      retryThreshold: Number(miniWork.retryThreshold || miniWork.retry_threshold || MINI_WORK_REVIEW_THRESHOLD),
      maxRetryBeforeReview: Number(miniWork.maxRetryBeforeReview || miniWork.max_retry_before_review || MINI_WORK_MAX_RETRY_BEFORE_REVIEW),
      profile: {
        roleIndustry: profile.role_industry || "",
        currentWork: profile.current_work || "",
        theme: profile.theme || "",
        currentProblem: profile.current_problem || "",
        goal: profile.goal || "",
        caseExample: profile.case_example || ""
      },
      work: {
        work_id: miniWork.mini_work_id,
        title: miniWork.title,
        core_essence: workPurpose,
        completion_criteria: criteriaTexts,
        rubric: criteriaBundle.rubric,
        required_elements: criteriaBundle.required_elements,
        core_messages: criteriaBundle.core_messages,
        common_misconceptions: criteriaBundle.common_misconceptions,
        learner_prompt_full: criteriaBundle.learner_prompt_full,
        feedback_template_summary: criteriaBundle.feedback_template_summary,
        passing_score: Number(miniWork.passThreshold || miniWork.passing_score || MINI_WORK_PASS_THRESHOLD),
        work_type: "mini_work"
      },
      context: {
        phaseId: miniWork.phase_id,
        lessonId: lesson.lesson_id,
        lessonTitle: lesson.lesson_title,
        sectionId: "mini-work",
        workCriteria: criteriaTexts,
        rubric: criteriaBundle.rubric,
        requiredElements: criteriaBundle.required_elements,
        coreMessages: criteriaBundle.core_messages,
        commonMisconceptions: criteriaBundle.common_misconceptions,
        learnerPromptFull: criteriaBundle.learner_prompt_full,
        feedbackTemplateSummary: criteriaBundle.feedback_template_summary,
        previousAnswers: this._previousMiniWorkAnswers(db, email, miniWork.mini_work_id),
        profile,
        localReview: {
          status: localReview.status,
          summary: localReview.summary,
          good_points: localReview.goodPoints,
          improvement_points: localReview.improvementPoints,
          met_criteria: localReview.metCriteria,
          unmet_criteria: localReview.unmetCriteria,
          followup_questions: localReview.followupQuestions,
          flags: localReview.flags
        }
      },
      local_review: {
        status: localReview.status,
        summary: localReview.summary,
        good_points: localReview.goodPoints,
        improvement_points: localReview.improvementPoints,
        met_criteria: localReview.metCriteria,
        unmet_criteria: localReview.unmetCriteria,
        followup_questions: localReview.followupQuestions,
        flags: localReview.flags
      },
      answer_text: submission.answer_text,
      userAnswer: submission.answer_text,
      submission_count: submissionCount,
      submissionCount,
      submittedAt: now,
      submitted_at: now,
      guardrails: [
        "受講者の完成回答を代筆しない",
        "受講者の経験・数値・業務実態を捏造しない",
        "内部ステータス、API名、モデル名を受講者向け文面に出さない",
        "ミニワークはpassになるまで完了扱いにしない"
      ]
    };
  }

  _previousMiniWorkAnswers(db, email, miniWorkId) {
    return (db.submissions || [])
      .filter((submission) =>
        submission.email_normalized === email &&
        submission.target_type === "mini_work" &&
        submission.target_id === miniWorkId
      )
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))
      .slice(0, 3)
      .map((submission) => ({
        submittedAt: submission.submitted_at,
        answer: submission.answer_text,
        status: submission.status,
        score: submission.score
      }));
  }

  _convertMiniAiEvaluationToResult(miniWork, lesson, submission, criteria, localReview, aiEvaluation, retryCountBefore, now) {
    const standardStatus = aiEvaluation.standard_status || this._miniWorkStandardStatusFromInternal(aiEvaluation.status);
    const isAiError = aiEvaluation.status === "ai_error" || aiEvaluation.flags?.aiError;
    const retryCount = retryCountBefore + (standardStatus === "retry" || isAiError ? 1 : 0);
    const shouldReview = standardStatus === "review" || retryCount >= Number(miniWork.maxRetryBeforeReview || miniWork.max_retry_before_review || MINI_WORK_MAX_RETRY_BEFORE_REVIEW);
    const resultStatus = isAiError
      ? "failed"
      : standardStatus === "pass"
        ? "good"
        : shouldReview
          ? "support_needed"
          : "needs_more";
    const improvementPoints = resultStatus === "good"
      ? []
      : this._safeLearnerList(aiEvaluation.improvement_points || localReview.improvementPoints, ["実際の場面・数字・次に取る行動を1つ足してください。"]);

    return {
      evaluation_id: this._createId("EV"),
      submission_id: submission.submission_id,
      criteria_id: criteria?.criteria_id || miniWork.evaluation_criteria_id || null,
      target_type: "mini_work",
      target_id: miniWork.mini_work_id,
      work_type: "miniWork",
      mini_work_id: miniWork.mini_work_id,
      parent_lesson_id: lesson.lesson_id,
      work_id: miniWork.mini_work_id,
      work_title: miniWork.workTitle || `${lesson.lesson_id} ミニワーク：${miniWork.title}`,
      work_purpose: miniWork.workPurpose || miniWork.goal || "",
      result_status: resultStatus,
      standard_status: isAiError ? "retry" : (shouldReview && standardStatus !== "pass" ? "review" : standardStatus),
      abc_grade: aiEvaluation.abc_grade || aiEvaluation.abcGrade || "",
      needs_followup: Boolean(aiEvaluation.needsFollowup || aiEvaluation.needs_followup),
      followup_reason: aiEvaluation.followup_reason || aiEvaluation.followupReason || "",
      score: Number.isFinite(Number(aiEvaluation.score)) ? Number(aiEvaluation.score) : null,
      reason: aiEvaluation.reason || aiEvaluation.summary || localReview.summary,
      good_points: this._safeLearnerList(aiEvaluation.good_points || localReview.goodPoints, ["回答を自分の言葉で整理できています。"]),
      improvement_points: improvementPoints,
      unmet_criteria: resultStatus === "good" ? [] : this._safeLearnerList(aiEvaluation.unmet_criteria || localReview.unmetCriteria, ["具体的な場面・数字・行動を1つ足してください。"]),
      next_question: aiEvaluation.next_question || aiEvaluation.next_action || localReview.followupQuestions?.[0] || this._miniWorkNextQuestion(miniWork, localReview.unmetCriteria),
      next_action_text: this._miniWorkNextActionText(resultStatus, aiEvaluation),
      retry_count: retryCount,
      submission_count: retryCountBefore + 1,
      passed_at: resultStatus === "good" ? now : "",
      evaluated_at: aiEvaluation.evaluated_at || now,
      feedback_json: JSON.stringify({
        summary: aiEvaluation.summary || localReview.summary || "",
        goodPoints: aiEvaluation.good_points || localReview.goodPoints || [],
        improvementPoints,
        abcGrade: aiEvaluation.abc_grade || aiEvaluation.abcGrade || "",
        needsFollowup: Boolean(aiEvaluation.needsFollowup || aiEvaluation.needs_followup),
        followupReason: aiEvaluation.followup_reason || aiEvaluation.followupReason || ""
      }),
      criteria_json: JSON.stringify(this._miniWorkCriteriaBundle(miniWork, criteria)),
      flags_json: JSON.stringify(aiEvaluation.flags || {}),
      normalized_response_json: JSON.stringify(aiEvaluation),
      error_type: aiEvaluation.error_type || "",
      error_message_safe: aiEvaluation.error_message_safe || ""
    };
  }

  _miniWorkStandardStatusFromInternal(status) {
    const map = {
      passed: "pass",
      revision_required: "retry",
      followup_required: "retry",
      staff_feedback_ready: "review",
      support_suggested: "review",
      ai_error: "retry"
    };
    return map[status] || "retry";
  }

  _miniWorkNextActionText(resultStatus, evaluation) {
    if (resultStatus === "good") return "次へ進みましょう";
    if (resultStatus === "support_needed") return "公式LINEで相談する";
    if (resultStatus === "failed") return "時間を置いて再送信する";
    if (evaluation.needsFollowup || evaluation.needs_followup) return "不足している観点を追記する";
    return "もう一度具体化する";
  }

  _safeLearnerList(values, fallback) {
    const list = Array.isArray(values) ? values : (values ? [values] : []);
    const safeItems = list
      .map((item) => String(item || "").trim())
      .filter((item) => item && !this._containsInternalLearnerText(item))
      .slice(0, 4);
    return safeItems.length ? safeItems : fallback;
  }

  _storeMiniWorkEvaluationLog(db, email, miniWork, lesson, submission, payload, aiEvaluation, evaluation, now) {
    db.aiEvaluationLogs = db.aiEvaluationLogs || [];
    db.aiEvaluationLogs.push({
      log_id: this._createId("AI-MW-LOG"),
      submission_id: submission.submission_id,
      request_id: payload.request_id,
      user_id: payload.user_id || "",
      email_normalized: email,
      work_type: "miniWork",
      target_type: "mini_work",
      mini_work_id: miniWork.mini_work_id,
      parent_lesson_id: lesson.lesson_id,
      work_id: miniWork.mini_work_id,
      work_title: evaluation.work_title,
      work_purpose: evaluation.work_purpose,
      answer_text: submission.answer_text,
      user_answer: submission.answer_text,
      score: evaluation.score,
      status: evaluation.result_status,
      ai_status: evaluation.standard_status,
      abc_grade: evaluation.abc_grade,
      needs_followup: evaluation.needs_followup,
      followup_reason: evaluation.followup_reason,
      retry_count: evaluation.retry_count,
      submission_count: evaluation.submission_count,
      passed_at: evaluation.passed_at,
      evaluated_at: evaluation.evaluated_at,
      feedback_json: evaluation.feedback_json,
      next_question: evaluation.next_question,
      criteria_json: evaluation.criteria_json,
      flags_json: evaluation.flags_json,
      request_payload: structuredClone(payload),
      request_payload_json: JSON.stringify(payload),
      response_json: structuredClone(aiEvaluation),
      raw_ai_response_json: JSON.stringify(aiEvaluation),
      normalized_response_json: evaluation.normalized_response_json,
      error_type: evaluation.error_type,
      error_message_safe: evaluation.error_message_safe,
      created_at: now,
      updated_at: now
    });
  }

  _queueMiniWorkStaffFeedback(db, email, user, miniWork, lesson, payload, aiEvaluation, evaluation, now) {
    const existing = db.staffFeedbackQueue.find((item) =>
      item.email_normalized === email &&
      item.mini_work_id === miniWork.mini_work_id &&
      item.status === "pending"
    );
    const queueItem = {
      queue_id: existing?.queue_id || this._createId("SFQ-MW"),
      session_id: payload.request_id,
      user_id: user?.user_id || "",
      email_normalized: email,
      work_type: "miniWork",
      mini_work_id: miniWork.mini_work_id,
      parent_lesson_id: lesson.lesson_id,
      work_id: miniWork.mini_work_id,
      work_title: evaluation.work_title,
      status: "pending",
      score: evaluation.score,
      trigger_status: evaluation.result_status,
      message: aiEvaluation.staff_feedback?.message || "担当者確認に進みます。回答は保存されています。",
      reason: aiEvaluation.staff_feedback?.reason || evaluation.reason || "",
      created_at: existing?.created_at || now,
      updated_at: now
    };

    if (existing) {
      Object.assign(existing, queueItem);
    } else {
      db.staffFeedbackQueue.push(queueItem);
    }
  }

  _findWork(db, workId) {
    return (db.works || []).find((work) => work.work_id === workId && work.show_to_learner !== false) || null;
  }

  _buildWorkList(db, email, phases, progressByLesson, aiSessionsByWork) {
    const lessonById = new Map(phases.flatMap((phase) => phase.lessons.map((lesson) => [lesson.lesson_id, lesson])));
    const phaseById = new Map(phases.map((phase) => [phase.phase_id, phase]));
    return (db.works || [])
      .filter((work) => work.show_to_learner !== false)
      .map((work) => {
        const relatedLessonIds = this._relatedLessonIdsForWork(work);
        const relatedLessons = relatedLessonIds.map((lessonId) => lessonById.get(lessonId)).filter(Boolean);
        const relatedMiniWorks = relatedLessonIds
          .map((lessonId) => db.miniWorks.find((miniWork) => miniWork.lesson_id === lessonId))
          .filter(Boolean);
        const session = aiSessionsByWork.get(work.work_id) || null;
        const aiStatus = session?.status || "not_started";
        const phase = phaseById.get(work.phase_id);
        const videoRemaining = relatedLessons.filter((lesson) => lesson.progress.video_status !== "watched");
        const miniRemaining = relatedLessons.filter((lesson) => {
          if (!lesson.miniWork) return false;
          return lesson.progress.mini_work_status !== "good";
        });
        const unlockState = this._workUnlockState(db, email, work, progressByLesson);

        return {
          ...structuredClone(work),
          phaseTitle: phase?.phase_title || work.phase_id,
          relatedLessons: relatedLessons.map((lesson) => ({
            lesson_id: lesson.lesson_id,
            lesson_title: lesson.lesson_title,
            video_status: lesson.progress.video_status,
            mini_work_status: lesson.progress.mini_work_status
          })),
          relatedMiniWorks: relatedMiniWorks.map((miniWork) => ({
            mini_work_id: miniWork.mini_work_id,
            lesson_id: miniWork.lesson_id,
            title: miniWork.title
          })),
          aiSession: session ? structuredClone(session) : null,
          aiStatus,
          aiStatusLabel: getAiWorkStatusLabel(aiStatus),
          videoRemainingCount: unlockState.missingLessonIds.length || videoRemaining.length,
          miniRemainingCount: unlockState.missingMiniWorkIds.length || miniRemaining.length,
          missingRequiredLessonIds: unlockState.missingLessonIds,
          missingRequiredMiniWorkIds: unlockState.missingMiniWorkIds,
          missingRequiredMiniLessonIds: unlockState.missingMiniLessonIds,
          unlockReason: unlockState.reason,
          primaryLessonId: relatedLessonIds[0] || "",
          canStartAiWork: unlockState.unlocked || ["completed", "final_feedback_ready"].includes(aiStatus)
        };
      })
      .sort((a, b) => {
        const phaseDiff = (phaseById.get(a.phase_id)?.phase_order || 99) - (phaseById.get(b.phase_id)?.phase_order || 99);
        return phaseDiff || (a.work_order || 0) - (b.work_order || 0);
      });
  }

  _getOrCreateAiWorkSession(db, email, work, user, now) {
    db.aiWorkSessions = db.aiWorkSessions || [];
    let session = db.aiWorkSessions.find((item) => item.email_normalized === email && item.work_id === work.work_id);
    if (!session) {
      const commonProfile = this._latestCommonProfile(db, email);
      session = {
        session_id: this._createId(`AWS-${user?.user_id || "USER"}-${work.work_id}`),
        user_id: user?.user_id || "",
        email_normalized: email,
        phase_id: work.phase_id,
        lesson_id: this._relatedLessonIdsForWork(work)[0] || "",
        work_id: work.work_id,
        work_title: work.title,
        status: "theme_intake",
        common_profile: commonProfile,
        learner_context: this._commonProfileToContext(commonProfile),
        learner_theme: "",
        learner_role: "",
        current_activity: "",
        current_situation: "",
        goal: "",
        problem: "",
        available_metrics: "",
        target_result: "",
        previous_work_context: "",
        generated_work_prompt: "",
        generated_work_prompt_parts: null,
        personalized_question_text: "",
        initial_answer: "",
        latest_revision_answer: "",
        followup_questions: [],
        followup_history: [],
        revision_history: [],
        missing_points: [],
        met_criteria: [],
        unmet_criteria: [],
        last_intake_missing_keys: [],
        intake_followup_attempts: 0,
        can_continue_with_placeholders: false,
        intake_placeholder_notice: "",
        ai_summary: "",
        ai_feedback: "",
        ai_final_feedback: "",
        ai_evaluation_result: null,
        ai_score: null,
        ai_label: "",
        ai_prompt_text: "",
        ai_raw_model: "",
        ai_error_info: null,
        good_points: [],
        improvement_points: [],
        next_actions: [],
        next_action: "",
        staff_feedback: { recommended: false, message: "", reason: "" },
        safety_notes: [],
        created_at: now,
        updated_at: now,
        completed_at: ""
      };
      db.aiWorkSessions.push(session);
    }
    return session;
  }

  _latestCommonProfile(db, email) {
    const sessions = (db.aiWorkSessions || [])
      .filter((item) => item.email_normalized === email && item.common_profile)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    return sessions[0]?.common_profile ? structuredClone(sessions[0].common_profile) : {
      role_industry: "",
      current_work: "",
      theme: "",
      current_problem: "",
      goal: "",
      case_example: ""
    };
  }

  _commonProfileToContext(profile = {}) {
    return {
      profile_role_industry: profile.role_industry || "",
      profile_current_work: profile.current_work || "",
      profile_theme: profile.theme || "",
      profile_problem: profile.current_problem || "",
      profile_goal: profile.goal || "",
      profile_case_example: profile.case_example || ""
    };
  }

  _extractCommonProfile(session) {
    const context = session.learner_context || {};
    return {
      role_industry: context.profile_role_industry || session.learner_role || context.learner_role || "",
      current_work: context.profile_current_work || session.current_activity || context.current_activity || "",
      theme: context.profile_theme || session.learner_theme || context.learner_theme || context.theme || "",
      current_problem: context.profile_problem || session.problem || context.problem || context.target_problem || context.issue || "",
      goal: context.profile_goal || session.goal || context.goal || context.ideal_state || "",
      case_example: context.profile_case_example || session.current_situation || context.current_situation || context.failure_case || ""
    };
  }

  _applyAiWorkInput(session, input = {}) {
    const context = {};
    Object.entries(input || {}).forEach(([key, value]) => {
      context[key] = String(value || "").trim();
    });

    session.learner_context = {
      ...(session.learner_context || {}),
      ...context
    };
    session.common_profile = this._extractCommonProfile(session);
    session.learner_theme = context.profile_theme || context.learner_theme || context.theme || session.learner_theme || "";
    session.learner_role = context.profile_role_industry || context.learner_role || session.learner_role || "";
    session.current_activity = context.profile_current_work || context.current_activity || session.current_activity || "";
    session.current_situation = context.profile_case_example || context.current_situation || session.current_situation || "";
    session.goal = context.profile_goal || context.goal || context.ideal_state || session.goal || "";
    session.problem = context.profile_problem || context.problem || context.target_problem || context.issue || session.problem || "";
    session.available_metrics = context.available_metrics || context.key_metric || context.kpi_candidate || session.available_metrics || "";
    session.target_result = context.target_result || context.kgi_candidate || context.expected_change || session.target_result || "";
  }

  _reviewIntake(work, session) {
    const requiredKeys = Array.isArray(work.required_intake_keys) ? work.required_intake_keys : [];
    if (!requiredKeys.length) {
      return { needsFollowup: false, summary: "", missingPoints: [], followupQuestions: [] };
    }

    const context = session.learner_context || {};
    const missingKeys = requiredKeys.filter((key) => !this._hasRequiredIntakeMaterial(work, session, key));
    const missingPoints = missingKeys.slice(0, 3).map((key) => this._fieldLabel(work, key));
    const followupQuestions = missingKeys.slice(0, 3).map((key) => this._intakeFollowupQuestion(work, key));

    return {
      needsFollowup: missingKeys.length > 0,
      summary: missingKeys.length
        ? `${work.title}を始めるには、${missingPoints.slice(0, 3).join("、")}をもう少し具体化すると進めやすくなります。`
        : "入力内容に合わせて、ワークの問いを整えました。",
      missingKeys,
      missingPoints,
      followupQuestions
    };
  }

  _prepareAiWorkPrompt(work, session) {
    session.status = "prompt_generated";
    session.generated_work_prompt_parts = this._createAiWorkPromptParts(work, session);
    session.generated_work_prompt = this._createAiWorkPrompt(work, session);
    session.personalized_question_text = session.generated_work_prompt;
    session.ai_summary = "入力内容に合わせて、ワークの問いを整えました。";
    session.missing_points = [];
    session.followup_questions = [];
    session.next_action = "生成された問いに回答してください。";
  }

  _reviewWorkAnswer(work, session, answerText, stage) {
    const latestAnswer = String(answerText || "").trim();
    const evaluation = this._evaluateCompletionCriteria(work, session);
    const hasCriteria = Array.isArray(work.completion_criteria) && work.completion_criteria.length > 0;
    const answerIsTooThin = this._isVagueText(latestAnswer) || latestAnswer.length < 70;
    const thinAnswerReason = "回答本文が短く、具体的な場面・数字・判断理由が不足しています";

    if ((!hasCriteria && latestAnswer.length >= 95 && this._hasConcreteDetail(latestAnswer)) || (hasCriteria && evaluation.unmet.length === 0 && !answerIsTooThin)) {
      return {
        status: "completed",
        summary: `${work.title}の完了条件を満たせています。`,
        goodPoints: this._createAiGoodPoints(work, evaluation.met),
        improvementPoints: ["次のワークでは、今回の整理を前提にもう一段深く考えていきましょう。"],
        metCriteria: evaluation.met,
        unmetCriteria: [],
        followupQuestions: [],
        feedback: ""
      };
    }

    const status = answerIsTooThin || stage !== "initial" ? "revision_required" : "followup_required";
    const unmetCriteria = this._ensureUnmetCriteria(
      hasCriteria ? evaluation.unmet : ["具体的な場面・数字・次の行動が不足しています"],
      answerIsTooThin ? thinAnswerReason : "",
      work
    );
    const followupQuestions = this._createAiFollowupQuestions(work, session, unmetCriteria);
    const feedback = this._createRevisionFeedback(work, unmetCriteria, latestAnswer);

    return {
      status,
      summary: status === "followup_required"
        ? "方向性は合っていますが、完了条件に照らすとまだ材料が足りません。追加質問で具体化しましょう。"
        : "回答はありますが、このワークの完了条件にはまだ届いていません。観点を絞ってもう一度整理しましょう。",
      goodPoints: this._createAiGoodPoints(work, evaluation.met),
      improvementPoints: unmetCriteria.slice(0, 3).map((item) => `${item}をもう一段具体化しましょう。`),
      metCriteria: evaluation.met,
      unmetCriteria,
      followupQuestions,
      feedback,
      sourceAnswer: latestAnswer
    };
  }

  async _evaluateAndApplyAiWorkReview(db, email, work, session, answerText, stage, localReview, now) {
    const payload = this._createAiEvaluationPayload(email, work, session, answerText, stage, localReview, now);
    const evaluation = await this.aiClient.evaluateWork(payload);
    const review = this._convertAiEvaluationToReview(work, evaluation, localReview, answerText);

    this._applyAiWorkReview(db, email, work, session, review, now);
    this._applyAiEvaluationMeta(session, evaluation, payload, now);
    this._storeAiEvaluationLog(db, email, work, session, payload, evaluation, now);

    if (evaluation.staff_feedback?.recommended) {
      this._queueStaffFeedback(db, email, work, session, evaluation, now);
    }
  }

  _createAiEvaluationPayload(email, work, session, answerText, stage, localReview, now) {
    session.common_profile = this._extractCommonProfile(session);
    const requestId = this._createId("AI-REQ");
    const submissionId = this._createId("AI-SUB");
    const submissionCount = this._aiSubmissionCount(session);
    const answer = String(answerText || "").trim();
    const relatedLessonId = this._relatedLessonIdsForWork(work)[0] || "";
    const relatedLesson = relatedLessonId ? this._findLessonById(this._read(), relatedLessonId) : null;
    const workKnowledge = this._findWorkEvaluationKnowledge(work.work_id, work);
    const workRubric = this._workRubricFromKnowledge(workKnowledge);
    const requiredElements = workKnowledge.passRequiredElements.length
      ? workKnowledge.passRequiredElements
      : (work.completion_criteria || []);
    const localReviewPayload = {
      status: localReview.status || "",
      summary: localReview.summary || "",
      good_points: localReview.goodPoints || [],
      improvement_points: localReview.improvementPoints || [],
      met_criteria: localReview.metCriteria || [],
      unmet_criteria: localReview.unmetCriteria || [],
      followup_questions: localReview.followupQuestions || []
    };
    const promptText = this._createAiEvaluationPrompt(work, session, answerText, stage, localReviewPayload);

    return {
      schema_version: "barise-ai-evaluation-request-v1",
      request_id: requestId,
      requestId,
      submission_id: submissionId,
      submissionId,
      session_id: session.session_id,
      sessionId: session.session_id,
      user_id: session.user_id || "",
      user: {
        userId: session.user_id || "",
        email,
        displayName: ""
      },
      email_normalized: email,
      profile: {
        roleIndustry: session.common_profile?.role_industry || "",
        currentWork: session.common_profile?.current_work || "",
        theme: session.common_profile?.theme || "",
        currentProblem: session.common_profile?.current_problem || "",
        goal: session.common_profile?.goal || "",
        caseExample: session.common_profile?.case_example || ""
      },
      work_id: work.work_id,
      workId: work.work_id,
      phase_id: work.phase_id,
      workTitle: work.title,
      workPurpose: work.core_essence || work.work_goal || work.purpose || "",
      workEvaluationKnowledge: workKnowledge,
      work_evaluation_knowledge: workKnowledge,
      requiredElements,
      required_elements: requiredElements,
      passRequiredElements: requiredElements,
      pass_required_elements: requiredElements,
      rubric: workRubric,
      commonMisconceptions: workKnowledge.commonMisconceptions,
      common_misconceptions: workKnowledge.commonMisconceptions,
      modelAnswerChecklist: workKnowledge.modelAnswerChecklist,
      badAnswerPatterns: workKnowledge.badAnswerPatterns,
      modelAnswerExample: workKnowledge.modelAnswerExample,
      questions: work.questions || [],
      completionCondition: work.completion_condition || "",
      completion_condition: work.completion_condition || "",
      aiWorkPromptTemplate: work.ai_work_prompt_template || "",
      ai_work_prompt_template: work.ai_work_prompt_template || "",
      learnerPromptFull: work.prompt || work.ai_work_prompt_template || "",
      originalQuestion: work.prompt || work.ai_work_prompt_template || "",
      stage,
      common_profile: structuredClone(session.common_profile || {}),
      work: {
        work_id: work.work_id,
        title: work.title,
        core_essence: work.core_essence || work.work_goal || work.purpose || "",
        required_intake_keys: work.required_intake_keys || [],
        completion_criteria: requiredElements,
        evaluation_knowledge: workKnowledge,
        required_elements: requiredElements,
        rubric: workRubric,
        questions: work.questions || [],
        completion_condition: work.completion_condition || "",
        ai_work_prompt_template: work.ai_work_prompt_template || "",
        learner_output: work.learner_output || "",
        passing_score: 80,
        w4_allows_plan_without_result: work.work_id === "W-P2-04"
      },
      context: {
        phaseId: work.phase_id,
        lessonId: relatedLessonId,
        lessonTitle: relatedLesson?.lesson_title || "",
        workCriteria: requiredElements,
        workEvaluationKnowledge: workKnowledge,
        requiredElements,
        rubric: workRubric,
        commonMisconceptions: workKnowledge.commonMisconceptions,
        learnerPromptFull: work.prompt || work.ai_work_prompt_template || "",
        questions: work.questions || [],
        completionCondition: work.completion_condition || "",
        aiWorkPromptTemplate: work.ai_work_prompt_template || "",
        previousAnswers: [],
        hearingHistory: structuredClone(session.followup_history || []),
        localReview: localReviewPayload,
        w4AllowsPlanWithoutResult: work.work_id === "W-P2-04"
      },
      hearing_history: structuredClone(session.followup_history || []),
      answer_text: answer,
      userAnswer: answer,
      generated_work_prompt: session.generated_work_prompt || "",
      prompt_text: promptText,
      local_review: localReviewPayload,
      submission_count: submissionCount,
      submissionCount,
      requested_at: now,
      submittedAt: now,
      guardrails: [
        "受講者の完成回答を代筆しない",
        "受講者の経験・数値・業務実態を捏造しない",
        "外部AIや外部ファイルへ誘導しない",
        "必須基準未達の場合、点数が80点以上でも通過扱いにしない"
      ]
    };
  }

  _findLessonById(db, lessonId) {
    return (db.lessons || []).find((lesson) => lesson.lesson_id === lessonId) || null;
  }

  _aiSubmissionCount(session) {
    const followupCount = (session.followup_history || []).filter((item) => item.type === "followup").length;
    const revisionCount = (session.revision_history || []).length;
    return Math.max(1, 1 + followupCount + revisionCount);
  }

  _createAiEvaluationPrompt(work, session, answerText, stage, localReviewPayload) {
    const workKnowledge = this._findWorkEvaluationKnowledge(work.work_id, work);
    const schemaKeys = [
      "work_id",
      "status",
      "score",
      "label",
      "summary",
      "good_points",
      "improvement_points",
      "unmet_criteria",
      "next_action",
      "followup_questions",
      "staff_feedback",
      "safety_notes",
      "raw_model",
      "evaluated_at"
    ].join(", ");

    return [
      "あなたはBarise学習ページ内のAI評価ゲートウェイです。",
      "受講者の回答を、ワーク本来の本質と完了条件に沿って評価してください。",
      "禁止: 完成回答の代筆、経験や数値の捏造、外部AI/外部ファイルへの誘導、人間対応要否の断定。",
      "通過条件: 必須基準達成 + 80点以上。必須基準未達なら80点以上でも revision_required または followup_required にしてください。",
      work.work_id === "W-P2-04" ? "W4は検証計画までで通過可能です。検証結果そのものは作成段階では必須にしません。" : "",
      `返却は固定JSONのみです。必須キー: ${schemaKeys}`,
      `対象ワーク: ${work.work_id} / ${work.title}`,
      `本質: ${work.core_essence || work.work_goal || work.purpose || ""}`,
      `W別必須要素:\n${(workKnowledge.passRequiredElements.length ? workKnowledge.passRequiredElements : work.completion_criteria || []).map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      `A基準:\n${(workKnowledge.aCriteria || []).map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      `B基準:\n${(workKnowledge.bCriteria || []).map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      `C基準/NG例:\n${[...(workKnowledge.cCriteria || []), ...(workKnowledge.badAnswerPatterns || [])].map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      `モデル回答チェックリスト:\n${(workKnowledge.modelAnswerChecklist || []).map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      `完了条件:\n${(work.completion_criteria || []).map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
      `共通プロフィール:\n${this._formatCommonProfile(session.common_profile)}`,
      `ヒアリング履歴:\n${this._formatHistory(session.followup_history || [])}`,
      `受講者回答(${stage}):\n${String(answerText || "").trim()}`,
      `ローカル補助判定:\n${JSON.stringify(localReviewPayload, null, 2)}`
    ].filter(Boolean).join("\n\n");
  }

  _convertAiEvaluationToReview(work, evaluation, localReview, answerText) {
    const nextQuestions = evaluation.followup_questions?.length
      ? evaluation.followup_questions
      : (localReview.followupQuestions || []);
    const unmetCriteria = evaluation.unmet_criteria?.length
      ? evaluation.unmet_criteria
      : (localReview.unmetCriteria || []);
    const statusMap = {
      passed: "completed",
      staff_feedback_ready: "revision_required",
      followup_required: "followup_required",
      revision_required: "revision_required",
      support_suggested: "revision_required",
      ai_error: "error"
    };
    const reviewStatus = statusMap[evaluation.status] || "revision_required";

    return {
      status: reviewStatus,
      summary: evaluation.summary || localReview.summary || "",
      goodPoints: evaluation.good_points || localReview.goodPoints || [],
      improvementPoints: evaluation.improvement_points || localReview.improvementPoints || [],
      metCriteria: localReview.metCriteria || evaluation.local_met_criteria || [],
      unmetCriteria: reviewStatus === "completed" ? [] : unmetCriteria,
      followupQuestions: reviewStatus === "completed" ? [] : nextQuestions,
      feedback: this._createAiEvaluationFeedbackText(work, evaluation, unmetCriteria),
      sourceAnswer: String(answerText || "").trim(),
      nextActions: [evaluation.next_action].filter(Boolean)
    };
  }

  _createAiEvaluationFeedbackText(work, evaluation, unmetCriteria = []) {
    if (evaluation.status === "ai_error") {
      return "一時的に評価できませんでした。回答は保存されているため、再評価できます。";
    }

    return [
      `このワークで守る観点: ${work.core_essence || work.work_goal || work.purpose}`,
      evaluation.summary,
      evaluation.good_points?.length ? `良い点: ${evaluation.good_points.join(" / ")}` : "",
      evaluation.improvement_points?.length ? `追記すると良い観点: ${evaluation.improvement_points.join(" / ")}` : "",
      unmetCriteria.length ? `もう一度整理する観点: ${unmetCriteria.slice(0, 3).join(" / ")}` : "",
      evaluation.next_action,
      "AIが答えを作るのではなく、あなたの実際の場面・数字・判断理由を引き出すための再回答です。"
    ].filter(Boolean).join("\n");
  }

  _applyAiEvaluationMeta(session, evaluation, payload, now) {
    session.ai_evaluation_result = structuredClone(evaluation);
    session.ai_score = evaluation.score;
    session.ai_label = evaluation.label;
    session.ai_prompt_text = payload.prompt_text;
    session.ai_raw_model = evaluation.raw_model;
    session.ai_last_evaluated_at = evaluation.evaluated_at || now;
    session.ai_error_info = evaluation.status === "ai_error"
      ? { message: evaluation.error_message || "AI評価に失敗しました", occurred_at: now }
      : null;
    session.staff_feedback = evaluation.staff_feedback || { recommended: false, message: "", reason: "" };
    session.safety_notes = evaluation.safety_notes || [];
    if (evaluation.next_action) {
      session.next_action = evaluation.next_action;
    }
  }

  _storeAiEvaluationLog(db, email, work, session, payload, evaluation, now) {
    db.aiEvaluationLogs = db.aiEvaluationLogs || [];
    db.aiEvaluationLogs.push({
      log_id: this._createId("AI-LOG"),
      submission_id: payload.submission_id || "",
      request_id: payload.request_id,
      session_id: session.session_id,
      user_id: session.user_id || "",
      email_normalized: email,
      common_profile: structuredClone(payload.common_profile || {}),
      work_id: work.work_id,
      work_title: work.title,
      stage: payload.stage,
      hearing_history: structuredClone(payload.hearing_history || []),
      answer_text: payload.answer_text,
      user_answer: payload.userAnswer || payload.answer_text,
      submission_count: payload.submission_count || payload.submissionCount || 1,
      prompt_text: payload.prompt_text,
      request_payload: structuredClone(payload),
      request_payload_json: JSON.stringify(payload),
      response_json: structuredClone(evaluation),
      raw_ai_response_json: JSON.stringify(evaluation),
      normalized_response_json: JSON.stringify(evaluation),
      score: evaluation.score,
      status: evaluation.status,
      ai_status: evaluation.standard_status || evaluation.status,
      reason: evaluation.reason || evaluation.summary || "",
      feedback_json: JSON.stringify({
        summary: evaluation.summary || "",
        goodPoints: evaluation.good_points || [],
        improvementPoints: evaluation.improvement_points || []
      }),
      unmet_criteria: evaluation.unmet_criteria || [],
      next_action: evaluation.next_action || "",
      staff_feedback_recommended: Boolean(evaluation.staff_feedback?.recommended),
      error_type: evaluation.error_type || "",
      error_message_safe: evaluation.error_message_safe || evaluation.error_message || "",
      error_message: evaluation.error_message_safe || evaluation.error_message || "",
      created_at: now,
      updated_at: now
    });
  }

  _queueStaffFeedback(db, email, work, session, evaluation, now) {
    db.staffFeedbackQueue = db.staffFeedbackQueue || [];
    const existing = db.staffFeedbackQueue.find((item) => item.session_id === session.session_id && item.work_id === work.work_id && item.status === "pending");
    const queueItem = {
      queue_id: existing?.queue_id || this._createId("SFQ"),
      session_id: session.session_id,
      user_id: session.user_id || "",
      email_normalized: email,
      work_id: work.work_id,
      work_title: work.title,
      status: "pending",
      score: evaluation.score,
      trigger_status: evaluation.status,
      message: evaluation.staff_feedback?.message || "作成されたワークをもとに、担当者からフィードバックをいたします。",
      reason: evaluation.staff_feedback?.reason || "",
      created_at: existing?.created_at || now,
      updated_at: now
    };

    if (existing) {
      Object.assign(existing, queueItem);
    } else {
      db.staffFeedbackQueue.push(queueItem);
    }
  }

  _applyAiWorkReview(db, email, work, session, review, now) {
    session.met_criteria = review.metCriteria || [];
    session.unmet_criteria = review.unmetCriteria || [];
    session.good_points = review.goodPoints || [];
    session.improvement_points = review.improvementPoints || [];
    session.ai_summary = review.summary || "";
    session.ai_feedback = review.feedback || "";
    session.revision_source_answer = review.sourceAnswer || session.initial_answer || "";
    session.followup_questions = review.followupQuestions || [];
    session.next_actions = review.nextActions?.length ? review.nextActions : session.next_actions || [];
    session.updated_at = now;

    if (review.status === "completed") {
      this._completeAiWork(db, email, work, session, now);
      return;
    }

    if (review.status === "error") {
      session.status = "error";
      session.next_action = "保存済みの回答から再評価できます。";
      return;
    }

    session.status = review.status;
    session.next_action = review.nextActions?.[0] || (review.status === "followup_required" ? "追加質問に回答してください。" : "再回答してください。");
  }

  _completeAiWork(db, email, work, session, now) {
    session.status = "completed";
    session.ai_summary = "完了条件を満たし、最終フィードバックを生成しました。";
    session.ai_final_feedback = session.ai_final_feedback || this._createAiFinalFeedback(work, session);
    session.good_points = session.good_points?.length ? session.good_points : this._createAiGoodPoints(work, session.met_criteria);
    session.improvement_points = session.improvement_points?.length ? session.improvement_points : [
      "次のワークでは、今回の整理を前提にして考える対象を広げていきましょう。"
    ];
    session.next_actions = session.next_actions?.length ? session.next_actions : this._createAiNextActions(work, session);
    session.next_action = session.next_actions[0] || "次の学習へ進みましょう。";
    session.completed_at = now;
    session.updated_at = now;

    this._relatedLessonIdsForWork(work).forEach((relatedLessonId) => {
      const relatedLesson = db.lessons.find((item) => item.lesson_id === relatedLessonId);
      if (!relatedLesson) return;
      const relatedProgress = this._getOrCreateProgress(db, email, relatedLesson);
      relatedProgress.work_status = "good";
      relatedProgress.next_action = "next_lesson";
      relatedProgress.updated_at = now;
    });
    this._touchUser(db, email, work.phase_id, this._relatedLessonIdsForWork(work)[0] || "");
  }

  _createAiWorkPrompt(work, session) {
    const parts = session.generated_work_prompt_parts || this._createAiWorkPromptParts(work, session);
    const contextSummary = parts.inputRows.length
      ? parts.inputRows.map((row) => `- ${row.label}: ${row.value}`).join("\n")
      : "- 入力内容をもとに進めます。";

    return [
      `${parts.title}`,
      `目的: ${parts.purpose}`,
      `守る本質: ${parts.essence}`,
      `前ワークとのつながり: ${parts.previousConnection}`,
      `あなたの入力:\n${contextSummary}`,
      "今回の問い:",
      ...parts.questionItems.map((question, index) => `${index + 1}. ${question}`),
      parts.criteria.length ? `完了の目安:\n${parts.criteria.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      "AIは答えを代筆しません。あなた自身の場面・数字・判断理由を入れて回答してください。"
    ].filter(Boolean).join("\n\n");
  }

  _createAiWorkPromptParts(work, session) {
    const questions = Array.isArray(work.questions) && work.questions.length ? work.questions : [];
    const criteria = Array.isArray(work.completion_criteria) && work.completion_criteria.length ? work.completion_criteria : [];
    return {
      title: work.title || "",
      purpose: work.work_goal || work.purpose || "",
      essence: work.core_essence || "受講者の状況を構造化し、次の行動へつなげる",
      previousConnection: session.previous_work_context || "このワーク内で入力した内容を起点に進めます。",
      inputRows: this._formatLearnerContextRows(work, session),
      questionItems: questions,
      criteria
    };
  }

  _createAiFollowupQuestions(work, session, unmetCriteria = []) {
    const criteria = unmetCriteria.length ? unmetCriteria : (work.completion_criteria || []);
    return criteria.slice(0, 3).map((criterion) => this._criterionQuestion(work, criterion));
  }

  _createAiFinalFeedback(work, session) {
    const criteriaText = (session.met_criteria || []).slice(0, 5).map((item) => `・${item}`).join("\n");
    return [
      `${work.title}では、${work.core_essence || work.work_goal || work.purpose}という観点で整理できています。`,
      criteriaText ? `満たせている観点:\n${criteriaText}` : "",
      session.previous_work_context ? "前ワークの文脈も踏まえて、次のワークへ接続できる状態になりました。" : "今回の整理を次のワークへ接続できる状態になりました。",
      "このまま終わらせず、決めた観点を実際の場面で一度確認してください。"
    ].filter(Boolean).join("\n");
  }

  _createAiNextActions(work, session) {
    const nextByWork = {
      "W-P2-01": ["W2で理想状態とKGI/KPI/KDIを定義する。", "今日の業務で見る数字を1つ決めて記録する。"],
      "W-P2-02": ["W3で理想に届かない原因を深掘りする。", "KGI/KPI/KDIのうち、自分の行動で変えられる指標を1つ選ぶ。"],
      "W-P2-03": ["W4でイシューに対する仮説と検証計画を作る。", "真因候補が実行可能な改善につながるかを現場で確認する。"],
      "W-P2-04": ["検証期限までに結果を記録する。", "W5でこの思考プロセスを他者ケースへ適用する。"],
      "W-P2-05": ["第三者へ結論・根拠・介入ポイントを短く説明する。", "公式LINEで必要に応じてサポート相談する。"]
    };
    return nextByWork[work.work_id] || [
      "24時間以内に、今回決めた行動を1つ試す。",
      "実行後に、数字・相手の反応・自分の判断をメモする。"
    ];
  }

  _createAiGoodPoints(work, metCriteria = []) {
    if (metCriteria.length) {
      return metCriteria.slice(0, 3).map((criterion) => `${criterion}が整理できています。`);
    }
    return [`${work.title}に向き合い、考える材料を書き始められています。`];
  }

  _createRevisionFeedback(work, unmetCriteria, latestAnswer) {
    const focusItems = this._createRevisionFocusItems(work, unmetCriteria);
    return [
      `このワークで守る観点: ${work.core_essence || work.work_goal || work.purpose}`,
      "良い点: 回答を出して、考える対象を外に出せています。",
      `追記すると良い観点: ${focusItems.join(" / ")}`,
      "AIが答えを作るのではなく、あなたの実際の場面・数字・判断理由を引き出すための再回答です。",
      latestAnswer && latestAnswer.length < 70 ? "短い結論だけで終わらせず、いつ・誰に対して・何を見てそう判断したかを足してください。" : ""
    ].filter(Boolean).join("\n");
  }

  _ensureUnmetCriteria(unmetCriteria, fallbackReason, work) {
    const uniqueCriteria = Array.from(new Set((unmetCriteria || []).filter(Boolean)));
    if (fallbackReason && !uniqueCriteria.includes(fallbackReason)) {
      uniqueCriteria.unshift(fallbackReason);
    }
    if (uniqueCriteria.length) return uniqueCriteria;
    return [
      fallbackReason ||
      work.completion_criteria?.[0] ||
      "具体的な場面・数字・判断理由が不足しています"
    ];
  }

  _createRevisionFocusItems(work, unmetCriteria = []) {
    const items = unmetCriteria.length ? unmetCriteria : (work.completion_criteria || []);
    const focusByWork = {
      "W-P2-01": ["実際の業務場面", "測定する数字", "戦略・戦術・実行の分け方"],
      "W-P2-02": ["理想状態", "KGI/KPI/KDIの違い", "見せかけの数字の確認"],
      "W-P2-03": ["うまくいかなかった具体例", "なぜを重ねた真因", "取り組むべきイシュー"],
      "W-P2-04": ["仮説と根拠", "検証方法・期限・必要データ", "結果別の次アクション"],
      "W-P2-05": ["対象者の具体的な課題", "結論と根拠", "介入ポイントと期待変化"]
    };
    const defaults = focusByWork[work.work_id] || ["具体的な場面", "確認する数字", "判断理由"];
    return items.slice(0, 3).map((item, index) => {
      if (/短く|場面・数字・判断理由/.test(item)) return defaults[index] || item;
      return item;
    });
  }

  _evaluateCompletionCriteria(work, session) {
    const criteria = Array.isArray(work.completion_criteria) ? work.completion_criteria : [];
    const text = this._combinedAiWorkText(session);
    const met = [];
    const unmet = [];

    criteria.forEach((criterion, index) => {
      if (this._criterionMet(work.work_id, index, criterion, text)) {
        met.push(criterion);
      } else {
        unmet.push(criterion);
      }
    });

    return { met, unmet };
  }

  _criterionMet(workId, index, criterion, text) {
    const normalized = text || "";
    const whyCount = (normalized.match(/なぜ/g) || []).length;
    const checks = {
      "W-P2-01": [
        () => this._hasConcreteDetail(normalized),
        () => this._hasMetricWords(normalized),
        () => /戦略/.test(normalized) && /戦術/.test(normalized) && /実行/.test(normalized),
        () => /(行動|実行).*(成果|結果|売上|改善|受注|解決|変化)|なぜ.*(成果|結果).*つなが/.test(normalized)
      ],
      "W-P2-02": [
        () => /(理想|うまくいっている|状態|できている|目標)/.test(normalized) && this._hasConcreteDetail(normalized),
        () => /(KGI|KPI|KDI|成果指標|中間指標|行動指標)/i.test(normalized),
        () => /(行動|KDI|変えられる|自分で|件数|率|時間|金額)/.test(normalized),
        () => /(見せかけ|表面的|意味のない|虚栄|数字だけ|チェック)/.test(normalized)
      ],
      "W-P2-03": [
        () => /(うまくいかな|失敗|具体例|場面|直近|商談|対応|案件|問い合わせ)/.test(normalized),
        () => whyCount >= 2 || /(なぜなぜ|深掘|真因|構造|プロセス|環境)/.test(normalized),
        () => /(真因|原因).*(改善|変える|実行|仕組み|手順|準備|粒度)/.test(normalized),
        () => /(イシュー|最重要|取り組むべき|KPI|白黒|課題を特定)/.test(normalized)
      ],
      "W-P2-04": [
        () => /(仮説|もし|変えれば|原因は|ではないか)/.test(normalized),
        () => /(根拠|理由|データ|事実|観察|なぜそう考える)/.test(normalized),
        () => /(検証|必要データ|期限|いつまで|測定|記録|日|週|月)/.test(normalized),
        () => /(次アクション|次に|当たった|外れた|場合|Try|修正|実行)/.test(normalized),
        () => /(構造|修正ポイント|KPT|YWTM|Keep|Problem|Try|戦略|戦術|実行)/i.test(normalized)
      ],
      "W-P2-05": [
        () => /(対象者|相手|顧客|部下|チーム|現場|課題|困って)/.test(normalized),
        () => /(結論|根拠|理由|事実|データ|観察)/.test(normalized),
        () => /(W1|W2|W3|W4|現状|理想|イシュー|仮説|検証)/.test(normalized),
        () => /(介入|働きかけ|支援|提案|期待変化|変化|サポート)/.test(normalized),
        () => /(第三者|説明|伝える|構造|ピラミッド|論理|まとめ)/.test(normalized)
      ]
    };
    const check = checks[workId]?.[index];
    if (check) return check();
    return this._hasUsefulText(normalized) && this._hasConcreteDetail(normalized) && criterion;
  }

  _combinedAiWorkText(session) {
    const contextValues = Object.values(session.learner_context || {});
    const followups = (session.followup_history || []).flatMap((item) => [item.question, item.answer, item.reason]);
    const revisions = (session.revision_history || []).flatMap((item) => [item.before, item.ai_feedback, item.after]);
    return [
      ...contextValues,
      session.initial_answer,
      session.latest_revision_answer,
      ...followups,
      ...revisions
    ].filter(Boolean).join("\n");
  }

  _formatLearnerContext(work, session) {
    const rows = this._formatLearnerContextRows(work, session);
    return rows
      .map((row) => `- ${row.label}: ${row.value}`)
      .join("\n") || "- 入力内容をもとに進めます。";
  }

  _formatLearnerContextRows(work, session) {
    const context = session.learner_context || {};
    const fields = Array.isArray(work.intake_fields) ? work.intake_fields : [];
    const keys = fields.length ? fields.map((field) => field.key) : Object.keys(context);
    return keys
      .map((key) => {
        const value = this._learnerDisplayValue(context[key]);
        const label = this._learnerDisplayLabel(work, key);
        if (!value || !label) return null;
        return { label, value };
      })
      .filter(Boolean);
  }

  _learnerDisplayLabel(work, key) {
    const label = this._fieldLabel(work, key);
    if (this._containsInternalLearnerText(label)) return SAFE_FIELD_LABELS[key] || "";
    return label;
  }

  _learnerDisplayValue(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (statusLabels[text] || aiWorkStatusLabels[text]) return statusLabels[text] || aiWorkStatusLabels[text];
    if (this._containsInternalLearnerText(text)) return "";
    return text;
  }

  _containsInternalLearnerText(value) {
    return INTERNAL_LEARNER_TEXT_PATTERN.test(String(value || ""));
  }

  _formatCommonProfile(profile = {}) {
    const rows = [
      ["職種 / 業種", profile.role_industry],
      ["現在の主な業務", profile.current_work],
      ["今回扱いたいテーマ", profile.theme],
      ["いま困っていること / 改善したいこと", profile.current_problem],
      ["目標・達成したい状態", profile.goal],
      ["具体例に使ってよい業務ケース", profile.case_example]
    ];
    return rows
      .map(([label, value]) => `- ${label}: ${value || "未入力"}`)
      .join("\n");
  }

  _formatHistory(history = []) {
    if (!history.length) return "- まだ追加ヒアリングはありません。";
    return history
      .map((item, index) => [
        `${index + 1}. 種別: ${item.type || "followup"}`,
        `質問: ${item.question || ""}`,
        `回答: ${item.answer || ""}`,
        `理由: ${item.reason || ""}`
      ].join("\n"))
      .join("\n\n");
  }

  _summarizePreviousAiWorkSessions(db, email, work) {
    const works = (db.works || [])
      .filter((item) => item.phase_id === work.phase_id && (item.work_order || 0) < (work.work_order || 0))
      .sort((a, b) => (a.work_order || 0) - (b.work_order || 0));
    const sessions = works
      .map((previousWork) => (db.aiWorkSessions || []).find((session) => session.email_normalized === email && session.work_id === previousWork.work_id && session.status === "completed"))
      .filter(Boolean);

    return sessions
      .map((session) => `${session.work_title}: ${this._shorten(session.learner_theme || session.initial_answer || "")} / ${this._shorten(session.ai_final_feedback || session.next_action || "")}`)
      .join("\n");
  }

  _fieldLabel(work, key) {
    return (work.intake_fields || []).find((field) => field.key === key)?.label || SAFE_FIELD_LABELS[key] || "確認したい内容";
  }

  _hasRequiredIntakeMaterial(work, session, key) {
    const contextValue = session.learner_context?.[key] || "";
    const intakeText = this._combinedIntakeText(session);
    if (!this._hasUsefulText(contextValue) && !this._hasUsefulText(intakeText)) return false;

    const checks = {
      learner_role: () => /(営業|CS|看護|管理職|副業|フリーランス|会社員|担当|責任者|リーダー)/.test(intakeText),
      current_activity: () => /(商談|問い合わせ|対応|提案|受注|集客|育成|申し送り|業務|活動|担当)/.test(intakeText),
      learner_theme: () => /(改善|上げたい|増やしたい|減らしたい|できるように|テーマ|課題)/.test(intakeText),
      current_situation: () => this._hasConcreteDetail(intakeText),
      current_actions: () => /(準備|聞く|確認|記録|対応|実行|試す|行って|やって|質問)/.test(intakeText),
      available_metrics: () => this._hasMetricWords(intakeText),
      target_result: () => /(成果|結果|受注|提案率|解決率|満足度|売上|改善|変化|状態)/.test(intakeText),
      strategy_tactic_execution: () => /戦略/.test(intakeText) && /戦術/.test(intakeText) && /実行/.test(intakeText),
      ideal_state: () => /(理想|うまくいっている|状態|できている|目標)/.test(intakeText),
      kgi_candidate: () => /(KGI|最終成果|受注率|売上|月間|件数)/i.test(intakeText),
      kpi_candidate: () => /(KPI|途中|提案率|解決率|返信|率)/i.test(intakeText),
      kdi_candidate: () => /(KDI|行動指標|準備した件数|聞けた件数|自分の行動)/i.test(intakeText),
      vanity_metric_risk: () => /(見せかけ|表面的|数字だけ|本質的.*改善とは限らない)/.test(intakeText),
      failure_case: () => /(うまくいかな|失敗|直近|場面|トラブル|停滞)/.test(intakeText),
      why_analysis: () => ((intakeText.match(/なぜ/g) || []).length >= 2) || /(真因|深掘|原因)/.test(intakeText),
      root_cause_candidate: () => /(真因|原因|構造|プロセス|環境|準備|手順)/.test(intakeText),
      issue_candidate: () => /(イシュー|取り組むべき|最重要|課題を絞る)/.test(intakeText),
      key_metric: () => this._hasMetricWords(intakeText),
      issue: () => /(イシュー|課題|問題|検証したい)/.test(intakeText),
      hypothesis: () => /(仮説|もし|変えれば|ではないか)/.test(intakeText),
      hypothesis_reason: () => /(根拠|理由|データ|観察|事実)/.test(intakeText),
      verification_plan: () => /(検証|確認|測定|記録|試す)/.test(intakeText),
      required_data: () => /(データ|数字|反応|記録|率|件数|時間|金額)/.test(intakeText),
      deadline: () => /(今日|明日|今週|来週|日|週|月|期限|まで)/.test(intakeText),
      next_action_by_result: () => /(当たった|外れた|場合|次アクション|次に|修正|Try)/i.test(intakeText),
      target_person: () => /(対象者|相手|顧客|上司|部下|チーム|現場|患者)/.test(intakeText),
      target_problem: () => /(課題|困って|問題|できていない|詰まって)/.test(intakeText),
      evidence: () => /(根拠|事実|データ|観察|発言|数字)/.test(intakeText),
      w1_w4_stage: () => /(W1|W2|W3|W4|現状|理想|イシュー|仮説|検証)/.test(intakeText),
      intervention_point: () => /(介入|働きかけ|支援|提案|サポート)/.test(intakeText),
      expected_change: () => /(期待|変化|改善|状態|結果)/.test(intakeText),
      explanation_summary: () => /(結論|根拠|説明|伝える|まとめ)/.test(intakeText)
    };

    if (checks[key]) return checks[key]();
    return this._hasUsefulText(contextValue);
  }

  _combinedIntakeText(session) {
    const intakeAnswers = (session.followup_history || [])
      .filter((item) => item.type === "intake")
      .map((item) => item.answer);
    return [
      ...Object.values(session.learner_context || {}),
      ...intakeAnswers
    ].filter(Boolean).join("\n");
  }

  _isSameMissingKeys(previous = [], current = []) {
    if (!previous.length || !current.length) return false;
    const previousKey = previous.slice().sort().join("|");
    const currentKey = current.slice().sort().join("|");
    return previousKey === currentKey;
  }

  _intakeFollowupQuestion(work, key) {
    const label = this._fieldLabel(work, key);
    const questions = {
      available_metrics: "このテーマで成果に近づいているかを見るなら、件数・率・時間・金額のどれが近いですか？",
      strategy_tactic_execution: "戦略・戦術・実行に分けると、それぞれ何にあたりますか？",
      kgi_candidate: "最終成果として一番見たい数字や状態は何ですか？",
      kpi_candidate: "成果に近づいている途中経過として見たい数字は何ですか？",
      kdi_candidate: "自分の行動で直接変えられる指標は何ですか？",
      vanity_metric_risk: "増えても本質的な改善とは限らない数字があるとしたら何ですか？",
      failure_case: "直近でうまくいかなかった場面を、いつ・誰に対して・何が起きたかで1つ教えてください。",
      why_analysis: "その出来事が起きた理由を、なぜを2回重ねて整理するとどうなりますか？",
      root_cause_candidate: "その原因は、準備・手順・環境・判断のどこにありそうですか？",
      issue_candidate: "白黒つけるべき最重要課題を1つに絞るなら何ですか？",
      hypothesis: "何を変えれば、どの結果が変わるという仮説ですか？",
      verification_plan: "その仮説を、いつ・何のデータで検証しますか？",
      intervention_point: "相手のどこに働きかけると、期待する変化が起きそうですか？"
    };
    return questions[key] || `${label}について、具体的な場面・数字・相手の反応を1つ足して教えてください。`;
  }

  _criterionQuestion(work, criterion) {
    if (/短く|場面・数字・判断理由/.test(criterion)) {
      return "その回答について、いつ・誰に対して・何を見てそう判断したのかを1つ具体的に足してください。";
    }
    if (/数値|KPI|KGI|KDI|指標|データ|期限/.test(criterion)) {
      return "この観点を数字や確認期限で見るなら、何をどう測りますか？";
    }
    if (/戦略|戦術|実行/.test(criterion)) {
      return "戦略・戦術・実行に分けると、それぞれ何になりますか？";
    }
    if (/なぜ|真因|イシュー/.test(criterion)) {
      return "その原因は本当に原因と言えますか。もう一段、なぜ起きたのかを掘ると何が見えますか？";
    }
    if (/仮説|検証|修正/.test(criterion)) {
      return "仮説を検証するために、いつ・何を・どのデータで確認しますか？";
    }
    if (/他者|介入|第三者|根拠/.test(criterion)) {
      return "第三者に説明するとしたら、結論・根拠・介入ポイントをどう伝えますか？";
    }
    return `${criterion}について、具体的な場面や判断理由を足してください。`;
  }

  _hasUsefulText(value) {
    const text = String(value || "").trim();
    if (text.length < 4) return false;
    if (/^(なし|特になし|特にない|未定|不明|わからない|分からない|思いつかない)$/i.test(text)) return false;
    if (/(わからない|分からない|思いつかない|まだない)/.test(text) && text.length < 24) return false;
    return true;
  }

  _isVagueText(value) {
    const text = String(value || "").trim();
    if (!this._hasUsefulText(text)) return true;
    if (text.length < 40) return true;
    if (/^(頑張る|がんばる|意識する|売上を伸ばす|仕事力を上げる|改善するだけ|ちゃんとやる)$/i.test(text)) return true;
    return !this._hasConcreteDetail(text) && !this._hasMetricWords(text);
  }

  _hasConcreteDetail(text) {
    return /(今日|明日|今週|来週|直近|初回|商談|顧客|上司|同僚|チーム|患者|問い合わせ|提案|受注|案件|準備|手順|質問|対応|件|率|時間|金額|[0-9０-９]+)/.test(text || "");
  }

  _hasMetricWords(text) {
    return /(KGI|KPI|KDI|数値|数字|件数|率|時間|金額|売上|受注|成約|返信|満足度|ミス|次回|提案率|[0-9０-９]+%?)/i.test(text || "");
  }

  _ensureAuthenticatedUser(db, email, authUser = {}) {
    const now = this._now();
    const firstPhaseId = db.phases?.[0]?.phase_id || "";
    const firstLessonId = db.lessons?.[0]?.lesson_id || "";
    let user = db.users.find((item) => item.email_normalized === email);

    if (!user) {
      user = {
        user_id: this._createStableUserId(email),
        email,
        email_normalized: email,
        display_name: this._displayNameFromAuthUser(authUser, email),
        nickname: String(authUser.nickname || "").trim(),
        account_status: "active",
        current_phase_id: firstPhaseId,
        current_lesson_id: firstLessonId,
        created_at: now,
        last_accessed_at: now,
        updated_at: now,
        source: "registration_sheet"
      };
      db.users.push(user);
      return user;
    }

    user.email = email;
    user.email_normalized = email;
    user.account_status = "active";
    user.display_name = user.display_name || this._displayNameFromAuthUser(authUser, email);
    user.nickname = String(authUser.nickname || user.nickname || "").trim();
    user.current_phase_id = user.current_phase_id || firstPhaseId;
    user.current_lesson_id = user.current_lesson_id || firstLessonId;
    user.updated_at = now;
    return user;
  }

  _createStableUserId(email) {
    const key = String(email || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42) || "user";
    return `USR-${key}`;
  }

  _displayNameFromAuthUser(authUser = {}, email = "") {
    const name = authUser.display_name || authUser.displayName || authUser.name || authUser.user_name || "";
    if (String(name).trim()) return String(name).trim();
    const localPart = String(email || "").split("@")[0] || "受講者";
    return `${localPart}さん`;
  }

  _touchUser(db, email, phaseId, lessonId) {
    const user = db.users.find((item) => item.email_normalized === email);
    if (!user) return;
    user.current_phase_id = phaseId;
    user.current_lesson_id = lessonId;
    user.last_accessed_at = this._now();
    user.updated_at = this._now();
  }

  _createMockEvaluation(submission, targetType, now, target = null, criteria = null) {
    const answer = submission.answer_text;
    const concretePattern = /(月曜|火曜|水曜|木曜|金曜|土曜|日曜|今日|明日|今週|来週|午前|午後|朝|昼|夕方|夜|[0-9０-９]+|一つ|1つ|１つ|件|率|表|確認|改善|見直|追加|実行|行う|試す|相談|成約|問い合わせ|売上|KPI|数値|場面|理由|期限|画面|資料|手順)/;
    const actionPattern = /(する|試す|確認|書く|聞く|見る|測る|比べる|分解|相談|実行|改善|設定|決める|伝える|記録)/;
    const emptyPattern = /(特になし|特にない|全部|未定|まだない|思いつかない)/;
    const lengthTarget = targetType === "work" ? 95 : 42;
    const hasEnoughLength = answer.length >= lengthTarget;
    const hasConcreteWords = concretePattern.test(answer);
    const hasActionWords = actionPattern.test(answer);
    const needsSupport = isSupportRequestedText(answer);
    const invalidAnswer = answer.length < 12 || emptyPattern.test(answer);
    const resultStatus = needsSupport ? "support_needed" : hasEnoughLength && hasConcreteWords && hasActionWords && !invalidAnswer ? "good" : "needs_more";
    const score = resultStatus === "good" ? (targetType === "work" ? 88 : 86) : resultStatus === "support_needed" ? 52 : 66;
    const isMiniWork = targetType === "mini_work";
    const primaryCriterion = this._criteriaText(criteria, 0);
    const secondaryCriterion = this._criteriaText(criteria, 1);

    return {
      evaluation_id: this._createId("EV"),
      submission_id: submission.submission_id,
      criteria_id: criteria?.criteria_id || null,
      result_status: resultStatus,
      score,
      good_points: resultStatus === "good"
        ? [
            primaryCriterion ? `評価基準に沿って、${this._shorten(primaryCriterion)}が書けています。` : "現場の数字や行動に結びつけて書けています。",
            isMiniWork ? "次に試す場面が見えています。" : "複数の観点をつなげて整理できています。"
          ]
        : [
            `「${target?.title || "今回の課題"}」に向き合って書き始められています。`
          ],
      improvement_points: resultStatus === "good"
        ? [
            "実行後に振り返る日を決めておくと、次の改善につながります。"
          ]
        : [
            secondaryCriterion ? `もう一段、${this._shorten(secondaryCriterion)}を具体化しましょう。` : "いつ、どの数字を、どの画面や資料で確認するかをもう一段具体化しましょう。",
            isMiniWork ? "通過すると関連するワークに進めます。" : "実行する順番と確認日を追記しましょう。"
          ],
      next_action_text: resultStatus === "good"
        ? (isMiniWork ? "次の動画へ進む" : "次の動画へ進む")
        : (resultStatus === "support_needed" ? "公式LINEで相談する" : "回答を修正する"),
      evaluated_at: now
    };
  }

  _criteriaText(criteria, index) {
    return criteria?.rubric?.[index]?.criteria || "";
  }

  _shorten(text, limit = 56) {
    if (!text) return "";
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  _nextActionForMiniWork(resultStatus, hasUnlockedWork) {
    if (resultStatus === "good") {
      return hasUnlockedWork ? "go_to_work" : "next_lesson";
    }
    if (resultStatus === "support_needed") {
      return "contact_support";
    }
    return "revise_mini_work";
  }

  async _syncLearningEvent(action, payload) {
    if (!this.syncEndpointUrl) return { ok: true, skipped: true };

    try {
      const response = await fetch(this.syncEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.message || SAVE_FAILURE_MESSAGE);
      }
      return body;
    } catch (error) {
      if (this.syncFallbackToLocal) {
        return { ok: false, skipped: true, reason: "sync_failed_local_fallback" };
      }
      throw new Error(SAVE_FAILURE_MESSAGE);
    }
  }

  async _restoreLearningState(email, options = {}) {
    const emailNormalized = normalizeEmail(email);
    if (!this.syncEndpointUrl || !emailNormalized || !isValidEmailFormat(emailNormalized)) return { ok: true, skipped: true };

    const now = Date.now();
    const lastRestoreAt = this.restoreCache.get(emailNormalized) || 0;
    if (!options.force && now - lastRestoreAt < 30000) {
      return { ok: true, skipped: true, reason: "restore_throttled" };
    }

    try {
      const response = await fetch(this.syncEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restoreLearningState", payload: { email: emailNormalized } })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        throw new Error(body.message || "Sheetsから進捗を復元できませんでした。");
      }
      this._applyRestoredLearningState(emailNormalized, body.restored || {});
      this.restoreCache.set(emailNormalized, now);
      this.lastRestoreError = null;
      return body;
    } catch (error) {
      this.lastRestoreError = {
        message: "Sheetsから進捗を復元できませんでした。ローカルに残っている状態で表示します。",
        occurred_at: this._now()
      };
      if (this.syncFallbackToLocal) {
        return { ok: false, skipped: true, reason: "restore_failed_local_fallback" };
      }
      throw new Error(this.lastRestoreError.message);
    }
  }

  _applyRestoredLearningState(email, restored = {}) {
    const db = this._read();
    db.progress = db.progress || [];
    db.submissions = db.submissions || [];
    db.evaluationResults = db.evaluationResults || [];
    db.aiWorkSessions = db.aiWorkSessions || [];

    (restored.clearedTargets || []).forEach((target) => this._clearRestoredTarget(db, email, target));

    const restoredTargets = new Set();
    (restored.submissions || []).forEach((submission) => {
      const normalized = this._normalizeRestoredSubmission(email, submission);
      if (!normalized.target_id) return;
      restoredTargets.add(`${normalized.target_type}:${normalized.target_id}`);
      this._removeSubmissionsForTarget(db, email, normalized.target_type, normalized.target_id);
      db.submissions.push(normalized);
    });

    (restored.evaluationResults || []).forEach((evaluation) => {
      const normalized = this._normalizeRestoredEvaluation(evaluation);
      if (!normalized.submission_id && !normalized.target_id) return;
      db.evaluationResults = db.evaluationResults.filter((item) => {
        if (normalized.submission_id && item.submission_id === normalized.submission_id) return false;
        if (normalized.target_id && item.target_id === normalized.target_id && item.target_type === normalized.target_type) return false;
        return true;
      });
      db.evaluationResults.push(normalized);
    });

    (restored.aiWorkSessions || []).forEach((session) => {
      const workId = String(session.work_id || session.workId || "").trim();
      if (!workId) return;
      db.aiWorkSessions = db.aiWorkSessions.filter((item) => !(item.email_normalized === email && item.work_id === workId));
      db.aiWorkSessions.push({
        ...structuredClone(session),
        email_normalized: email,
        work_id: workId,
        restored_from_sheets: true
      });
    });

    (restored.progress || []).forEach((progress) => this._applyRestoredProgress(db, email, progress));

    const user = db.users.find((item) => item.email_normalized === email);
    if (user) {
      user.updated_at = this._now();
      user.restore_status = "restored_from_sheets";
      user.restore_last_synced_at = restored.restoredAt || this._now();
    }

    this._write(db);
    return { restoredTargets: Array.from(restoredTargets) };
  }

  _normalizeRestoredSubmission(email, submission = {}) {
    const targetType = this._normalizeRestoredTargetType(submission.target_type || submission.work_type || "");
    const targetId = String(submission.target_id || submission.work_id || submission.mini_work_id || "").trim();
    return {
      submission_id: submission.submission_id || this._createId("RESTORE-SUB"),
      email_normalized: email,
      target_type: targetType,
      target_id: targetId,
      answer_text: String(submission.answer_text || ""),
      status: this._normalizeRestoredUiStatus(submission.status || submission.result_status || ""),
      score: Number.isFinite(Number(submission.score)) ? Number(submission.score) : null,
      submitted_at: submission.submitted_at || submission.updated_at || this._now(),
      restored_from_sheets: true
    };
  }

  _normalizeRestoredEvaluation(evaluation = {}) {
    const targetType = this._normalizeRestoredTargetType(evaluation.target_type || evaluation.work_type || "");
    const resultStatus = this._normalizeRestoredUiStatus(evaluation.result_status || evaluation.status || "");
    return {
      ...structuredClone(evaluation),
      evaluation_id: evaluation.evaluation_id || this._createId("RESTORE-EV"),
      submission_id: evaluation.submission_id || "",
      target_type: targetType,
      target_id: String(evaluation.target_id || evaluation.work_id || evaluation.mini_work_id || ""),
      result_status: resultStatus,
      status: resultStatus,
      score: Number.isFinite(Number(evaluation.score)) ? Number(evaluation.score) : null,
      good_points: this._safeLearnerList(evaluation.good_points || evaluation.goodPoints, []),
      improvement_points: resultStatus === "good" ? [] : this._safeLearnerList(evaluation.improvement_points || evaluation.improvementPoints, []),
      unmet_criteria: resultStatus === "good" ? [] : this._safeLearnerList(evaluation.unmet_criteria || evaluation.unmetCriteria, []),
      restored_from_sheets: true
    };
  }

  _applyRestoredProgress(db, email, progress = {}) {
    const miniWorkId = String(progress.mini_work_id || progress.miniWorkId || "").trim();
    const workId = String(progress.work_id || progress.workId || "").trim();
    let lessonId = String(progress.lesson_id || progress.lessonId || progress.video_id || progress.videoId || "").trim();

    if (!lessonId && miniWorkId) {
      lessonId = db.miniWorks.find((miniWork) => miniWork.mini_work_id === miniWorkId)?.lesson_id || "";
    }
    if (!lessonId && workId) {
      const work = db.works.find((item) => item.work_id === workId);
      lessonId = this._relatedLessonIdsForWork(work || {})[0] || "";
    }
    const lesson = db.lessons.find((item) => item.lesson_id === lessonId);
    if (!lesson) return;

    const local = this._getOrCreateProgress(db, email, lesson);
    if (progress.video_status) local.video_status = progress.video_status;
    if (progress.mini_work_status) {
      local.mini_work_status = progress.mini_work_status;
      local.mini_work_passed_at = progress.mini_work_status === "good" ? (progress.mini_work_passed_at || progress.updated_at || local.mini_work_passed_at || this._now()) : "";
    }
    if (progress.work_status) local.work_status = progress.work_status;
    if (progress.last_score !== undefined && progress.last_score !== null) local.last_score = progress.last_score;
    local.updated_at = progress.updated_at || this._now();
    local.restored_from_sheets = true;
  }

  _clearRestoredTarget(db, email, target = {}) {
    const rawTargetType = String(target.target_type || target.type || "").trim().toLowerCase();
    if (/video|lesson|動画|教材/.test(rawTargetType)) {
      const lessonId = String(target.lesson_id || target.lessonId || target.video_id || target.videoId || target.target_id || "").trim();
      const lesson = db.lessons.find((item) => item.lesson_id === lessonId);
      if (!lesson) return;
      const progress = this._getOrCreateProgress(db, email, lesson);
      progress.video_status = "not_started";
      progress.updated_at = this._now();
      return;
    }

    const targetType = this._normalizeRestoredTargetType(target.target_type || "");
    const targetId = String(target.target_id || target.work_id || target.mini_work_id || target.lesson_id || "").trim();
    if (!targetId) return;

    this._removeSubmissionsForTarget(db, email, targetType, targetId);

    if (targetType === "mini_work") {
      const miniWork = db.miniWorks.find((item) => item.mini_work_id === targetId || item.mini_work_id === target.mini_work_id);
      const lesson = miniWork ? db.lessons.find((item) => item.lesson_id === miniWork.lesson_id) : null;
      if (lesson) {
        const progress = this._getOrCreateProgress(db, email, lesson);
        progress.mini_work_status = "not_submitted";
        progress.last_score = null;
        progress.mini_work_retry_count = 0;
        progress.mini_work_passed_at = "";
        progress.updated_at = this._now();
      }
      return;
    }

    const work = db.works.find((item) => item.work_id === targetId || item.work_id === target.work_id);
    if (!work) return;
    db.aiWorkSessions = db.aiWorkSessions.filter((session) => !(session.email_normalized === email && session.work_id === work.work_id));
    this._relatedLessonIdsForWork(work).forEach((lessonId) => {
      const lesson = db.lessons.find((item) => item.lesson_id === lessonId);
      if (!lesson) return;
      const progress = this._getOrCreateProgress(db, email, lesson);
      progress.work_status = this._isWorkUnlocked(db, email, work) ? "unlocked" : "locked";
      progress.last_score = null;
      progress.updated_at = this._now();
    });
  }

  _removeSubmissionsForTarget(db, email, targetType, targetId) {
    const relatedSubmissionIds = new Set(
      (db.submissions || [])
        .filter((submission) =>
          submission.email_normalized === email &&
          submission.target_type === targetType &&
          submission.target_id === targetId
        )
        .map((submission) => submission.submission_id)
    );
    db.submissions = (db.submissions || []).filter((submission) =>
      !(submission.email_normalized === email && submission.target_type === targetType && submission.target_id === targetId)
    );
    db.evaluationResults = (db.evaluationResults || []).filter((evaluation) =>
      !relatedSubmissionIds.has(evaluation.submission_id) &&
      !(evaluation.target_type === targetType && evaluation.target_id === targetId)
    );
  }

  _normalizeRestoredTargetType(value) {
    const text = String(value || "").trim();
    if (/mini|ミニ|mini_work|miniWork/i.test(text)) return "mini_work";
    return "work";
  }

  _normalizeRestoredUiStatus(value) {
    const text = String(value || "").trim().toLowerCase();
    if (["pass", "passed", "good", "completed", "通過", "完了"].includes(text)) return "good";
    if (["review", "support_needed", "staff_feedback_ready", "サポート相談", "担当者確認"].includes(text)) return "support_needed";
    if (["failed", "ai_error", "error", "評価に失敗しました"].includes(text)) return "failed";
    if (!text || ["not_submitted", "not_started", "未提出", "未着手"].includes(text)) return "not_submitted";
    return "needs_more";
  }

  async _syncAiWorkSessionEvent(action, email, work, session, answerText, stage, now) {
    const relatedLessonId = this._relatedLessonIdsForWork(work)[0] || "";
    const evaluation = session.ai_evaluation_result || {
      status: session.status || "",
      score: session.ai_score || "",
      summary: session.ai_summary || "",
      reason: session.ai_summary || "",
      feedback: {
        summary: session.ai_summary || "",
        goodPoints: session.good_points || [],
        improvementPoints: session.improvement_points || []
      },
      flags: {}
    };

    return this._syncLearningEvent(action, {
      email,
      workType: "aiWork",
      workId: work.work_id,
      lessonId: relatedLessonId,
      phaseId: work.phase_id,
      workTitle: work.title,
      questionText: session.generated_work_prompt || work.prompt || "",
      answerText: String(answerText || "").trim(),
      submittedAt: now,
      retryCount: this._aiSubmissionCount(session),
      evaluation: this._syncEvaluationPayload(evaluation),
      clientSubmissionId: this._createId(`AI-SUB-${stage}`)
    });
  }

  _syncEvaluationPayload(evaluation, overrideStatus = "") {
    const status = overrideStatus || evaluation.standard_status || evaluation.status || evaluation.result_status || "";
    return {
      ...structuredClone(evaluation || {}),
      status,
      result_status: evaluation.result_status || status,
      standard_status: evaluation.standard_status || status,
      abcGrade: evaluation.abc_grade || evaluation.abcGrade || "",
      abc_grade: evaluation.abc_grade || evaluation.abcGrade || "",
      score: evaluation.score,
      needsFollowup: Boolean(evaluation.needs_followup || evaluation.needsFollowup),
      needs_followup: Boolean(evaluation.needs_followup || evaluation.needsFollowup),
      reason: evaluation.reason || evaluation.summary || "",
      feedback: {
        summary: evaluation.summary || evaluation.reason || "",
        goodPoints: evaluation.good_points || evaluation.goodPoints || [],
        improvementPoints: evaluation.improvement_points || evaluation.improvementPoints || []
      },
      flags: evaluation.flags || {}
    };
  }

  _createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  _now() {
    return new Date().toISOString();
  }

  _read() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  }

  _write(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export class SpreadsheetApiLearningProvider {
  constructor(endpointUrl) {
    this.endpointUrl = endpointUrl;
  }

  async init() {}

  async login(email) {
    return this._request("login", { email });
  }

  async getLearningState(email) {
    return this._request("getLearningState", { email });
  }

  async markVideoWatched(email, lessonId) {
    return this._request("markVideoWatched", { email, lessonId });
  }

  async submitMiniWork(email, miniWorkId, answerText) {
    return this._request("submitMiniWork", { email, miniWorkId, answerText });
  }

  async submitWork(email, workId, answerText, lessonId = "") {
    return this._request("submitWork", { email, workId, answerText, lessonId });
  }

  async startAiWork(email, workId, input) {
    return this._request("startAiWork", { email, workId, input });
  }

  async submitAiWorkAnswer(email, workId, answerText) {
    return this._request("submitAiWorkAnswer", { email, workId, answerText });
  }

  async submitAiWorkIntakeFollowup(email, workId, answerText) {
    return this._request("submitAiWorkIntakeFollowup", { email, workId, answerText });
  }

  async continueAiWorkWithIntakePlaceholders(email, workId) {
    return this._request("continueAiWorkWithIntakePlaceholders", { email, workId });
  }

  async submitAiWorkFollowup(email, workId, answerText) {
    return this._request("submitAiWorkFollowup", { email, workId, answerText });
  }

  async submitAiWorkRevision(email, workId, answerText) {
    return this._request("submitAiWorkRevision", { email, workId, answerText });
  }

  async retryAiWork(email, workId) {
    return this._request("retryAiWork", { email, workId });
  }

  async _request(action, payload) {
    const response = await fetch(this.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload })
    });

    if (!response.ok) {
      throw new Error("保存先との通信に失敗しました。");
    }

    return response.json();
  }
}

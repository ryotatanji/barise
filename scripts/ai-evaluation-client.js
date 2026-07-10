export const AI_EVALUATION_SCHEMA_VERSION = "barise-work-evaluation-v1";
export const MINI_WORK_EVALUATION_SCHEMA_VERSION = "barise-mini-work-evaluation-v1";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_UNMET_REASON = "回答本文が短く、具体的な場面・数字・判断理由が不足しています";
const STAFF_FEEDBACK_MESSAGE = "作成されたワークをもとに、担当者からフィードバックをいたします。";

const INTERNAL_STATUS_LABELS = {
  passed: "通過",
  revision_required: "もう一度整理",
  followup_required: "追加質問があります",
  staff_feedback_ready: "担当者フィードバックへ",
  support_suggested: "サポート相談",
  ai_error: "一時的に評価できませんでした"
};

const CRITERIA_KEYS = [
  "specificity",
  "problemUnderstanding",
  "businessApplication",
  "thinkingProcess",
  "nextAction",
  "workPurposeFit",
  "lessonConnection",
  "missingConcreteExample",
  "missingLessonConnection"
];

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

export class AiEvaluationClient {
  constructor(config = {}) {
    this.endpointUrl = String(config.endpointUrl || config.endpoint_url || "").trim();
    this.useMockAi = config.useMockAi !== false;
    this.requestAction = config.requestAction || "evaluateAiWork";
    this.timeoutMs = Number(config.timeoutMs || 15000);
    this.mode = this.endpointUrl && !this.useMockAi ? "gateway" : "mock";
  }

  async evaluateWork(payload) {
    if (!this.endpointUrl || this.useMockAi) {
      return this._createMockEvaluation(payload);
    }

    try {
      const body = await this._postToGateway(payload);
      const rawEvaluation = body?.evaluation || body?.result || body;
      return this.normalizeEvaluation(rawEvaluation, payload, "gateway");
    } catch (error) {
      return this.createErrorEvaluation(payload, error);
    }
  }

  async _postToGateway(payload) {
    const controller = new AbortController();
    const timerId = window.setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: this.requestAction, payload }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`AI評価の通信に失敗しました: ${response.status}`);
      }

      return await response.json();
    } finally {
      window.clearTimeout(timerId);
    }
  }

  _createMockEvaluation(payload) {
    const answerText = String(payload?.userAnswer || payload?.answer_text || "");
    const localReview = payload?.local_review || payload?.context?.localReview || {};
    const localUnmet = toStringArray(localReview.unmet_criteria || localReview.unmetCriteria);
    const localMet = toStringArray(localReview.met_criteria || localReview.metCriteria);
    const criteriaCount = Number(payload?.work?.completion_criteria?.length || payload?.context?.workCriteria?.length || 0);
    const requiredCriteriaMet = localUnmet.length === 0 && localReview.status === "completed";
    const answerIsThin = isThinAnswer(answerText);
    const isMiniWork = payload?.workType === "miniWork" || payload?.isMiniWork || payload?.contentType === "miniWork";
    const supportRequested = isSupportRequestedText(answerText);
    const completionRatio = criteriaCount ? localMet.length / criteriaCount : (requiredCriteriaMet ? 1 : 0.35);
    const submissionCount = Number(payload?.submissionCount || payload?.submission_count || 1);

    let score = requiredCriteriaMet
      ? Math.max(82, Math.min(94, Math.round(80 + completionRatio * 14)))
      : Math.max(42, Math.min(79, Math.round(48 + completionRatio * 26)));

    if (answerIsThin) score = isMiniWork ? Math.min(score, 64) : Math.min(score, 58);

    let status = "retry";
    if (supportRequested) {
      status = "review";
    } else if (requiredCriteriaMet && score >= 80) {
      status = "pass";
    }
    if (submissionCount >= 3 && status !== "pass") {
      status = "review";
    }

    return this.normalizeEvaluation({
      status,
      score,
      abcGrade: abcGradeForScore(status, score),
      needsFollowup: status === "retry" && score >= 60,
      followupReason: status === "retry" && score >= 60 ? "A基準に近いですが、具体場面や理由の補足が必要です。" : "",
      reason: buildMockReason(status, payload, score),
      feedback: {
        summary: buildMockSummary(status, payload, score),
        goodPoints: ensureArray(toStringArray(localReview.good_points || localReview.goodPoints), "ワークに向き合い、考える材料を言葉にできています").slice(0, 3),
        improvementPoints: status === "pass"
          ? []
          : ensureArray(toStringArray(localReview.improvement_points || localReview.improvementPoints || localUnmet), "ご自身の実際の場面・数字・判断理由をもう一段足してください").slice(0, 3)
      },
      nextQuestion: nextQuestionForStandardStatus(status),
      flags: {
        needsHumanReview: status === "review" && !supportRequested,
        needsSupport: supportRequested,
        aiError: false,
        policyWarning: false,
        tooAbstract: answerIsThin,
        missingNextAction: status !== "pass"
      },
      criteria: buildCriteriaScores(score),
      meta: {
        model: "mock-fixed-json-v4.10.1",
        schemaVersion: isMiniWork ? MINI_WORK_EVALUATION_SCHEMA_VERSION : AI_EVALUATION_SCHEMA_VERSION,
        evaluatedAt: new Date().toISOString()
      }
    }, payload, "mock-fixed-json-v4.10.1");
  }

  normalizeEvaluation(rawEvaluation = {}, payload = {}, rawModel = "") {
    const standard = normalizeStandardEvaluation(rawEvaluation, payload, rawModel);
    const localMet = toStringArray(payload?.local_review?.met_criteria || payload?.context?.localReview?.met_criteria);
    let standardStatus = standard.status;
    let unmetCriteria = toStringArray(rawEvaluation.unmet_criteria || rawEvaluation.unmetCriteria);
    const isMiniWork = payload?.workType === "miniWork" || payload?.isMiniWork || payload?.contentType === "miniWork";
    const workKnowledge = payload?.workEvaluationKnowledge ||
      payload?.work_evaluation_knowledge ||
      payload?.context?.workEvaluationKnowledge ||
      payload?.context?.work_evaluation_knowledge ||
      payload?.work?.evaluation_knowledge ||
      null;
    const hasWorkKnowledge = !isMiniWork && hasEvaluationKnowledge(workKnowledge);
    const genericDowngradeFlags = standard.flags.tooAbstract || standard.flags.missingNextAction || standard.flags.missingConcreteExample || standard.flags.missingLessonConnection;

    if (standardStatus === "pass") {
      if (hasWorkKnowledge) {
        const criticalFailure = standard.score < 80 || standard.flags.policyWarning || standard.flags.aiError || standard.flags.needsSupport;
        if (criticalFailure || (standard.abcGrade !== "A" && unmetCriteria.length)) {
          standardStatus = "retry";
        }
      } else if (standard.score < 80 || unmetCriteria.length || genericDowngradeFlags) {
        standardStatus = "retry";
      }
    }

    if (standardStatus !== "pass" && !unmetCriteria.length) {
      unmetCriteria = ensureArray(standard.feedback.improvementPoints, DEFAULT_UNMET_REASON);
    }

    const internalStatus = mapStandardStatusToInternal(standardStatus, standard.flags);
    const staffFeedback = normalizeStaffFeedback(standardStatus, standard.flags);

    return {
      schema_version: payload?.workType === "miniWork" || payload?.isMiniWork
        ? MINI_WORK_EVALUATION_SCHEMA_VERSION
        : AI_EVALUATION_SCHEMA_VERSION,
      work_type: rawEvaluation.workType || rawEvaluation.work_type || payload.workType || payload.work_type || "",
      mini_work_id: rawEvaluation.miniWorkId || rawEvaluation.mini_work_id || payload.miniWorkId || payload.mini_work_id || "",
      parent_lesson_id: rawEvaluation.parentLessonId || rawEvaluation.parent_lesson_id || payload.parentLessonId || payload.parent_lesson_id || "",
      work_id: String(rawEvaluation.work_id || rawEvaluation.workId || payload.work_id || payload.workId || ""),
      status: internalStatus,
      standard_status: standardStatus,
      abc_grade: standard.abcGrade,
      abcGrade: standard.abcGrade,
      needsFollowup: standard.needsFollowup,
      needs_followup: standard.needsFollowup,
      followup_reason: standard.followupReason,
      followupReason: standard.followupReason,
      score: standard.score,
      label: INTERNAL_STATUS_LABELS[internalStatus] || "確認中",
      summary: standard.feedback.summary || standard.reason,
      reason: standard.reason,
      good_points: ensureArray(standard.feedback.goodPoints, "回答を言葉にして整理を始められています").slice(0, 4),
      improvement_points: standardStatus === "pass" ? [] : ensureArray(standard.feedback.improvementPoints, "場面・数字・判断理由をもう一段具体化しましょう").slice(0, 4),
      unmet_criteria: standardStatus === "pass" ? [] : unmetCriteria,
      next_action: standard.nextQuestion || nextQuestionForStandardStatus(standardStatus),
      next_question: standard.nextQuestion || "",
      followup_questions: standardStatus === "pass" ? [] : [standard.nextQuestion].filter(Boolean).slice(0, 3),
      staff_feedback: staffFeedback,
      safety_notes: ["AIは受講者の経験や数値を捏造せず、入力内容に基づいて評価します"],
      flags: standard.flags,
      criteria: standard.criteria,
      raw_model: standard.meta.model || rawModel || DEFAULT_MODEL,
      evaluated_at: standard.meta.evaluatedAt || new Date().toISOString(),
      local_met_criteria: localMet,
      error_type: rawEvaluation.errorType || rawEvaluation.error_type || "",
      error_message_safe: rawEvaluation.errorMessageSafe || rawEvaluation.error_message_safe || ""
    };
  }

  createErrorEvaluation(payload, error) {
    const now = new Date().toISOString();
    return this.normalizeEvaluation({
      status: "retry",
      score: 0,
      reason: "一時的にAI判定ができませんでした。回答は保存されているため、再評価できます。",
      feedback: {
        summary: "通信状況により判定できませんでした。入力内容は失われていません。",
        goodPoints: [],
        improvementPoints: ["少し時間を置いて再評価してください。"]
      },
      nextQuestion: "保存済みの回答から再評価してください。",
      flags: {
        needsHumanReview: false,
        needsSupport: false,
        aiError: true,
        policyWarning: false,
        tooAbstract: false,
        missingNextAction: false
      },
      criteria: buildCriteriaScores(0),
      meta: {
        model: DEFAULT_MODEL,
        schemaVersion: AI_EVALUATION_SCHEMA_VERSION,
        evaluatedAt: now
      },
      errorType: error?.name === "AbortError" ? "openai_timeout" : "openai_error",
      errorMessageSafe: "AI判定に一時的な問題が発生しました。"
    }, payload, "gateway-error");
  }
}

function normalizeStandardEvaluation(rawEvaluation = {}, payload = {}, rawModel = "") {
  const raw = rawEvaluation && typeof rawEvaluation === "object" ? rawEvaluation : {};
  const feedback = raw.feedback && typeof raw.feedback === "object" ? raw.feedback : {};
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
  const flags = normalizeFlags(raw.flags);
  const answerText = String(payload?.userAnswer || payload?.answer_text || "");
  const supportRequested = isSupportRequestedText(answerText);
  const submissionCount = Number(payload?.submissionCount || payload?.submission_count || 1);

  let status = normalizeStandardStatus(raw.status);
  if (supportRequested) {
    status = "review";
    flags.needsSupport = true;
  }
  if (submissionCount >= 3 && status !== "pass") {
    status = "review";
    flags.needsHumanReview = true;
  }
  if (raw.status === "ai_error" || flags.aiError) {
    status = "retry";
    flags.aiError = true;
  }

  const score = clampScore(raw.score);
  const abcGrade = normalizeAbcGrade(raw.abcGrade || raw.abc_grade, status, score);
  const needsFollowup = Boolean(raw.needsFollowup || raw.needs_followup || flags.needsFollowup);
  const followupReason = String(raw.followupReason || raw.followup_reason || "").trim();
  return {
    status,
    abcGrade,
    needsFollowup,
    followupReason,
    score,
    reason: String(raw.reason || raw.summary || fallbackReason(status)).trim(),
    feedback: {
      summary: String(feedback.summary || raw.summary || fallbackSummary(status)).trim(),
      goodPoints: toStringArray(feedback.goodPoints || feedback.good_points || raw.good_points),
      improvementPoints: toStringArray(feedback.improvementPoints || feedback.improvement_points || raw.improvement_points)
    },
    nextQuestion: String(raw.nextQuestion || raw.next_question || raw.next_action || nextQuestionForStandardStatus(status)).trim(),
    flags,
    criteria: normalizeCriteria(raw.criteria),
    meta: {
      model: String(meta.model || raw.raw_model || rawModel || DEFAULT_MODEL),
      schemaVersion: String(meta.schemaVersion || meta.schema_version || raw.schema_version || AI_EVALUATION_SCHEMA_VERSION),
      evaluatedAt: String(meta.evaluatedAt || meta.evaluated_at || raw.evaluated_at || new Date().toISOString())
    }
  };
}

function normalizeStandardStatus(value) {
  const status = String(value || "").trim();
  const map = {
    pass: "pass",
    passed: "pass",
    retry: "retry",
    revision_required: "retry",
    followup_required: "retry",
    review: "review",
    staff_feedback_ready: "review",
    support_suggested: "review",
    ai_error: "retry"
  };
  return map[status] || "retry";
}

function mapStandardStatusToInternal(status, flags = {}) {
  if (flags.aiError) return "ai_error";
  if (status === "pass") return "passed";
  if (status === "review" && flags.needsSupport) return "support_suggested";
  if (status === "review") return "staff_feedback_ready";
  if (flags.needsFollowup) return "followup_required";
  return "revision_required";
}

function normalizeFlags(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    needsHumanReview: Boolean(source.needsHumanReview),
    needsSupport: Boolean(source.needsSupport),
    needsFollowup: Boolean(source.needsFollowup || source.needs_followup),
    aiError: Boolean(source.aiError),
    policyWarning: Boolean(source.policyWarning),
    tooAbstract: Boolean(source.tooAbstract),
    missingNextAction: Boolean(source.missingNextAction),
    missingConcreteExample: Boolean(source.missingConcreteExample),
    missingLessonConnection: Boolean(source.missingLessonConnection)
  };
}

function normalizeAbcGrade(value, status, score) {
  const grade = String(value || "").trim().toUpperCase();
  if (["A", "B", "C"].includes(grade)) return grade;
  return abcGradeForScore(status, score);
}

function abcGradeForScore(status, score) {
  if (status === "pass") return "A";
  if (Number(score) >= 60) return "B";
  return "C";
}

function normalizeCriteria(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(CRITERIA_KEYS.map((key) => [key, clampScore(source[key])]));
}

function buildCriteriaScores(score) {
  const base = clampScore(score);
  return Object.fromEntries(CRITERIA_KEYS.map((key) => [key, base]));
}

function buildMockReason(status, payload, score) {
  const title = payload?.work?.title || payload?.workTitle || "このワーク";
  if (status === "pass") return `${title}は通過基準を満たしています。点数は${score}点です。`;
  if (status === "review") return "整理しにくい部分があるため、担当者確認またはサポート相談に進める状態です。";
  return `${title}の完了条件に照らすと、もう一度整理すると良くなります。`;
}

function buildMockSummary(status, payload, score) {
  if (status === "pass") return `通過ラインです。点数は${score}点です。`;
  if (status === "review") return "一人で無理に整えず、担当者確認に回せる状態です。";
  return "方向性はあります。具体的な場面・数字・判断理由を足すと通過に近づきます。";
}

function fallbackReason(status) {
  if (status === "pass") return "ワーク目的に沿って整理できています。";
  if (status === "review") return "担当者確認またはサポート相談が有効です。";
  return "具体性・課題理解・次アクションのいずれかが不足しています。";
}

function fallbackSummary(status) {
  if (status === "pass") return "通過ラインです。";
  if (status === "review") return "担当者確認に回しましょう。";
  return "もう一度整理しましょう。";
}

function nextQuestionForStandardStatus(status) {
  if (status === "pass") return "次のワークへ進みましょう。";
  if (status === "review") return "必要に応じて公式LINEで相談し、担当者確認に進めましょう。";
  return "直近の具体的な場面、数字、次に取る行動を1つずつ足して書き直してください。";
}

function normalizeStaffFeedback(status, flags = {}) {
  const recommended = status === "review" && !flags.aiError;
  return {
    recommended,
    message: recommended
      ? (flags.needsSupport ? "公式LINEで相談しながら整理できます。" : STAFF_FEEDBACK_MESSAGE)
      : "",
    reason: recommended
      ? (flags.needsSupport ? "相談希望または詰まりが強い内容が含まれています。" : "担当者が確認すると前進しやすい状態です。")
      : ""
  };
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function ensureArray(items, fallback) {
  return items.length ? items : [fallback];
}

function hasEvaluationKnowledge(value) {
  if (!value || typeof value !== "object") return false;
  const arrays = [
    value.passRequiredElements,
    value.pass_required_elements,
    value.modelAnswerChecklist,
    value.model_answer_checklist,
    value.badAnswerPatterns,
    value.bad_answer_patterns
  ];
  if (arrays.some((items) => Array.isArray(items) && items.length > 0)) return true;
  return Boolean(value.aCriteria || value.a_criteria || value.bCriteria || value.b_criteria || value.cCriteria || value.c_criteria);
}

function mergeArrays(first = [], second = []) {
  return Array.from(new Set([...first, ...second].filter(Boolean)));
}

function isThinAnswer(value) {
  const text = String(value || "").trim();
  if (text.length < 70) return true;
  return /^(頑張ります|がんばります|意識します|改善します|やります)。?$/i.test(text);
}

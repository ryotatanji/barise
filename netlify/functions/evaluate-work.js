const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";
const WORK_SCHEMA_VERSION = "barise-work-evaluation-v1";
const MINI_WORK_SCHEMA_VERSION = "barise-mini-work-evaluation-v1";
const DEFAULT_TIMEOUT_MS = 20000; // V7.1採点是正: 12s→20s（偶発タイムアウトで良回答が0点になる事故を防ぐ）

const ALLOWED_WORK_IDS = new Set([
  "W-P1-05",
  "W-P1-09",
  "W-P2-01",
  "W-P2-02",
  "W-P2-03",
  "W-P2-04",
  "W-P2-05"
]);

const CRITERIA_KEYS = [
  "specificity",
  "problemUnderstanding",
  "businessApplication",
  "thinkingProcess",
  "nextAction",
  "workPurposeFit",
  "lessonConnection"
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async function handler(event) {
  const startedAt = new Date().toISOString();
  let payload = null;

  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, {});
    }

    if (event.httpMethod !== "POST") {
      return response(405, { ok: false, error: "method_not_allowed" });
    }

    const request = parseRequestBody(event);
    payload = normalizePayload(request.payload || request);
    validatePayload(payload);

    const useMock = String(process.env.USE_MOCK_AI || "false").toLowerCase() === "true";
    const apiKey = process.env.OPENAI_API_KEY || "";

    if (useMock) {
      return response(200, {
        ok: true,
        evaluation: normalizeEvaluation(createHeuristicEvaluation(payload, startedAt), payload, startedAt, "mock-fixed-json")
      });
    }

    if (!apiKey) {
      return response(200, {
        ok: true,
        evaluation: createFallbackEvaluation(payload, "missing_api_key", startedAt)
      });
    }

    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const rawBody = await callOpenAi(payload, apiKey, model);
    const rawText = extractOutputText(rawBody);
    const parsed = JSON.parse(rawText);
    const rawEvaluation = parsed && parsed.evaluation ? parsed.evaluation : parsed;
    const evaluation = normalizeEvaluation(rawEvaluation, payload, startedAt, model);

    return response(200, { ok: true, evaluation });
  } catch (error) {
    return response(200, {
      ok: true,
      evaluation: createFallbackEvaluation(payload, safeErrorType(error), startedAt)
    });
  }
};

function parseRequestBody(event) {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "{}";
  return JSON.parse(body);
}

function normalizePayload(source = {}) {
  const user = source.user || {};
  const profile = source.profile || source.common_profile || {};
  const work = source.work || {};
  const context = source.context || {};
  const workId = source.workId || source.work_id || work.work_id || "";
  const miniWorkId = source.miniWorkId || source.mini_work_id || (source.workType === "miniWork" ? workId : "");
  const workType = source.workType || source.work_type || source.contentType || source.content_type || (miniWorkId ? "miniWork" : "work");
  const isMiniWork = Boolean(source.isMiniWork || source.is_mini_work || workType === "miniWork" || miniWorkId);
  const answer = source.userAnswer || source.answer_text || source.answer || "";
  const now = new Date().toISOString();
  const workEvaluationKnowledge = normalizeWorkKnowledge(source.workEvaluationKnowledge || source.work_evaluation_knowledge || context.workEvaluationKnowledge || context.work_evaluation_knowledge || work.evaluation_knowledge || {});
  const criteria = source.criteria || context.workCriteria || context.work_criteria || work.completion_criteria || (!isMiniWork ? workEvaluationKnowledge.passRequiredElements : []);
  const rubric = normalizeRubricPayload(source.rubric || context.rubric || work.rubric || (!isMiniWork ? buildRubricFromWorkKnowledge(workEvaluationKnowledge) : []));
  const requiredElements = asArray(source.requiredElements || source.required_elements || source.passRequiredElements || source.pass_required_elements || context.requiredElements || context.required_elements || work.required_elements || (!isMiniWork ? workEvaluationKnowledge.passRequiredElements : []));
  const coreMessages = asArray(source.coreMessages || source.core_messages || context.coreMessages || context.core_messages || work.core_messages);
  const commonMisconceptions = asArray(source.commonMisconceptions || source.common_misconceptions || context.commonMisconceptions || context.common_misconceptions || work.common_misconceptions || (!isMiniWork ? workEvaluationKnowledge.commonMisconceptions : []));
  const learnerPromptFull = safeText(source.learnerPromptFull || source.learner_prompt_full || source.originalQuestion || source.original_question || context.learnerPromptFull || context.learner_prompt_full || work.learner_prompt_full || work.prompt || "");
  const feedbackTemplateSummary = source.feedbackTemplateSummary || source.feedback_template_summary || context.feedbackTemplateSummary || context.feedback_template_summary || work.feedback_template_summary || {};
  const questions = asArray(source.questions || context.questions || work.questions);
  const completionCondition = safeText(source.completionCondition || source.completion_condition || context.completionCondition || context.completion_condition || work.completion_condition || "");
  const aiWorkPromptTemplate = safeText(source.aiWorkPromptTemplate || source.ai_work_prompt_template || context.aiWorkPromptTemplate || context.ai_work_prompt_template || work.ai_work_prompt_template || "");

  return {
    requestId: source.requestId || source.request_id || createId("REQ"),
    sessionId: source.sessionId || source.session_id || "",
    workType,
    contentType: source.contentType || source.content_type || workType,
    isMiniWork,
    miniWorkId,
    parentLessonId: source.parentLessonId || source.parent_lesson_id || context.parentLessonId || context.parent_lesson_id || context.lessonId || context.lesson_id || "",
    user: {
      userId: user.userId || user.user_id || source.user_id || "",
      email: user.email || source.email || source.email_normalized || "",
      displayName: user.displayName || user.display_name || ""
    },
    profile: {
      roleIndustry: profile.roleIndustry || profile.role_industry || "",
      currentWork: profile.currentWork || profile.current_work || "",
      theme: profile.theme || "",
      currentProblem: profile.currentProblem || profile.current_problem || "",
      goal: profile.goal || "",
      caseExample: profile.caseExample || profile.case_example || ""
    },
    workId,
    workTitle: source.workTitle || source.work_title || work.title || "",
    workPurpose: source.workPurpose || source.work_purpose || work.core_essence || work.purpose || "",
    criteria: Array.isArray(criteria) ? criteria.filter(Boolean) : [],
    rubric,
    requiredElements,
    passRequiredElements: requiredElements,
    workEvaluationKnowledge,
    work_evaluation_knowledge: workEvaluationKnowledge,
    aCriteria: workEvaluationKnowledge.aCriteria || [],
    bCriteria: workEvaluationKnowledge.bCriteria || [],
    cCriteria: workEvaluationKnowledge.cCriteria || [],
    badAnswerPatterns: workEvaluationKnowledge.badAnswerPatterns || [],
    modelAnswerChecklist: workEvaluationKnowledge.modelAnswerChecklist || [],
    modelAnswerExample: workEvaluationKnowledge.modelAnswerExample || "",
    coreMessages,
    commonMisconceptions,
    learnerPromptFull,
    originalQuestion: learnerPromptFull,
    questions,
    completionCondition,
    aiWorkPromptTemplate,
    feedbackTemplateSummary,
    passThreshold: Number(source.passThreshold || source.pass_threshold || work.passing_score || 80),
    retryThreshold: Number(source.retryThreshold || source.retry_threshold || 60),
    maxRetryBeforeReview: Number(source.maxRetryBeforeReview || source.max_retry_before_review || 3),
    isModelAnswer: Boolean(source.isModelAnswer || source.is_model_answer || source.debugExpectedModel || source.debug_expected_model || context.isModelAnswer || context.debugExpectedModel),
    userAnswer: String(answer || "").trim(),
    context: {
      phaseId: context.phaseId || context.phase_id || source.phase_id || "",
      lessonId: context.lessonId || context.lesson_id || source.lesson_id || "",
      lessonTitle: context.lessonTitle || context.lesson_title || "",
      sectionId: context.sectionId || context.section_id || "",
      workCriteria: Array.isArray(criteria) ? criteria.filter(Boolean) : [],
      rubric,
      requiredElements,
      workEvaluationKnowledge,
      coreMessages,
      commonMisconceptions,
      learnerPromptFull,
      questions,
      completionCondition,
      aiWorkPromptTemplate,
      feedbackTemplateSummary,
      previousAnswers: context.previousAnswers || context.previous_answers || [],
      hearingHistory: context.hearingHistory || context.hearing_history || source.hearing_history || [],
      localReview: context.localReview || context.local_review || source.local_review || {},
      w4AllowsPlanWithoutResult: Boolean(context.w4AllowsPlanWithoutResult || work.w4_allows_plan_without_result || workId === "W-P2-04")
    },
    submissionCount: Number(source.submissionCount || source.submission_count || 1),
    submittedAt: source.submittedAt || source.submitted_at || source.requested_at || now
  };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("validation_error");
  }
  if (payload.isMiniWork) {
    if (!/^MW-P[0-9]+-[0-9]+/.test(payload.miniWorkId || payload.workId || "")) {
      throw new Error("validation_error");
    }
  } else if (!ALLOWED_WORK_IDS.has(payload.workId)) {
    throw new Error("validation_error");
  }
  if (!payload.userAnswer) {
    throw new Error("validation_error");
  }
  if (payload.userAnswer.length > 10000) {
    throw new Error("validation_error");
  }
}

async function callOpenAi(payload, apiKey, model) {
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  try {
    return await postOpenAiPrompt(payload, apiKey, model, buildUserPrompt(payload), timeoutMs);
  } catch (error) {
    if (error && error.name === "AbortError") {
      // V7.1採点是正: タイムアウト時は1回リトライ（MW-P2-05は圧縮プロンプト、他は同プロンプトで再試行）
      try {
        if (payload?.miniWorkId === "MW-P2-05") {
          return await postOpenAiPrompt(payload, apiKey, model, buildMiniWorkCompactUserPrompt(payload), Math.max(timeoutMs, 20000));
        }
        return await postOpenAiPrompt(payload, apiKey, model, buildUserPrompt(payload), timeoutMs);
      } catch (retryError) {
        throw new Error("openai_timeout");
      }
    }
    throw error;
  }
}

async function postOpenAiPrompt(payload, apiKey, model, userPrompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(process.env.OPENAI_RESPONSES_ENDPOINT || OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: userPrompt }
        ],
        text: {
          format: { type: "json_object" }
        }
      })
    });

    if (!res.ok) {
      throw new Error(`openai_error_${res.status}`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildSystemPrompt() {
  return [
    "あなたはBarise学習ページ内のワーク判定AIです。",
    "受講者の回答を、目的と判定基準に沿って評価してください。",
    "完成回答を代筆しないでください。",
    "受講者の経験、数値、業務実態を捏造しないでください。",
    "必須基準が未達なら、点数が高くてもpassにしないでください。",
    "受講者向け文面は優しく具体的にしてください。",
    "statusはpass、retry、reviewのいずれかにしてください。",
    "返却はJSONのみです。",
    "APIキー、Secret、内部実装には触れないでください。"
  ].join("\n");
}

function buildUserPrompt(payload) {
  if (payload.isMiniWork) return buildMiniWorkUserPrompt(payload);
  return buildWorkUserPrompt(payload);
}

function buildWorkUserPrompt(payload) {
  const knowledge = payload.workEvaluationKnowledge || {};
  return [
    "以下のBariseワーク回答を判定してください。",
    "",
    "最優先評価材料:",
    `- workId: ${payload.workId}`,
    `- title: ${payload.workTitle}`,
    `- work_goal: ${knowledge.workGoal || payload.workPurpose || ""}`,
    "",
    "W別passRequiredElements（最優先）:",
    JSON.stringify(knowledge.passRequiredElements || payload.requiredElements || [], null, 2),
    "",
    "W別A/B/C基準:",
    JSON.stringify({
      A: knowledge.aCriteria || [],
      B: knowledge.bCriteria || [],
      C: knowledge.cCriteria || []
    }, null, 2),
    "",
    "よくある誤解 / NG例:",
    JSON.stringify({
      commonMisconceptions: knowledge.commonMisconceptions || payload.commonMisconceptions || [],
      badAnswerPatterns: knowledge.badAnswerPatterns || []
    }, null, 2),
    "",
    "モデル回答チェックリスト:",
    JSON.stringify(knowledge.modelAnswerChecklist || [], null, 2),
    "",
    "受講者への問い・完了条件:",
    JSON.stringify({
      questions: payload.questions || [],
      completionCondition: payload.completionCondition || "",
      aiWorkPromptTemplate: payload.aiWorkPromptTemplate || "",
      generatedWorkPrompt: payload.generatedWorkPrompt || payload.generated_work_prompt || ""
    }, null, 2),
    "",
    // V7.2 few-shot較正: A水準の見本回答を提示
    ...(knowledge.modelAnswerExample || payload.modelAnswerExample ? [
      "合格(A)水準の見本回答（この見本と同等以上の具体性・論理・観点があれば、表現や題材が違ってもA=passとする。丸暗記一致は不要・意味の同等で判定する）:",
      knowledge.modelAnswerExample || payload.modelAnswerExample,
      ""
    ] : []),
    "判定方針:",
    "- W別passRequiredElementsとA/B/C基準を最優先してください。",
    "- 汎用的な『もっと具体的に』だけを理由に、W別必須要素を満たす回答をC/retryへ落とさないでください。",
    "- 汎用6観点は補助評価です。W別基準と矛盾する場合はW別基準を優先してください。",
    "- A判定は原則status=pass、B/C判定は原則status=retryにしてください。",
    "- reviewは、明示的な相談希望、AI判断困難、センシティブ内容、または3回以上未通過の場合だけにしてください。",
    "- 引用・過去状況・他者発言に含まれる『分からない』『確認できませんでした』は相談希望として扱わないでください。",
    payload.workId === "W-P2-04"
      ? "- W-P2-04は検証結果そのものを必須にしません。仮説・根拠・検証方法・必要データ・期限・結果別次アクションが具体的ならA/pass候補です。"
      : "",
    "",
    "補助評価観点:",
    "1. 具体性",
    "2. 課題理解",
    "3. 自己業務への落とし込み",
    "4. 思考プロセス",
    "5. 次アクション",
    "6. ワーク目的への適合",
    "",
    "返却JSONスキーマ:",
    JSON.stringify(createEmptyEvaluation(payload, "retry", new Date().toISOString()), null, 2),
    "",
    "評価対象データ:",
    JSON.stringify(compactWorkPromptPayload(payload), null, 2)
  ].filter(Boolean).join("\n");
}

function buildMiniWorkUserPrompt(payload) {
  return [
    "以下のBariseミニワーク回答を判定してください。",
    "",
    "対象:",
    `- miniWorkId: ${payload.miniWorkId || payload.workId}`,
    `- title: ${payload.workTitle}`,
    `- lesson: ${payload.parentLessonId || payload.context.lessonId} ${payload.context.lessonTitle || ""}`,
    "",
    "受講者への問い:",
    payload.learnerPromptFull || payload.workPurpose || "",
    "",
    "A/B/C評価基準:",
    JSON.stringify(payload.rubric || [], null, 2),
    "",
    "必須要素:",
    JSON.stringify(payload.requiredElements || payload.criteria || [], null, 2),
    "",
    "動画の核心メッセージ:",
    JSON.stringify(payload.coreMessages || [], null, 2),
    "",
    "よくある誤解:",
    JSON.stringify(payload.commonMisconceptions || [], null, 2),
    "",
    "フィードバックテンプレート要点:",
    JSON.stringify(payload.feedbackTemplateSummary || {}, null, 2),
    "",
    // V7.2 few-shot較正: A水準の見本を提示（丸暗記一致でなく"意味の同等"で判定）
    ...(payload.modelAnswerExample ? [
      "合格(A)水準の見本回答（この見本と同等以上の具体性・観点があれば、表現や題材が違ってもA=passとする。丸暗記一致は不要・意味の同等で判定する）:",
      payload.modelAnswerExample,
      ""
    ] : []),
    // V7.2 設問タイプ別のA水準（P1一律減点の是正）
    "設問タイプ別のA水準（重要）:",
    "- P1系（基礎・行動習慣: 挨拶/自己管理/タスク/マスト/ビジョン/自責/言葉定義/クリティカル）は、行動が1つに絞られ・選んだ理由・実践場面が具体的なら、P2相当の数値密度や指標設計がなくてもAとする。P1にKPI・戦略水準の定量性を一律要求しないこと。",
    "- P2系（KPI/戦略/イシュー/仮説/なぜなぜ/構造化）は、枠組みの適用と数値・論理の一貫を見る。",
    "",
    "ミニワーク判定方針:",
    "重要: ミニワークでは、汎用評価軸よりも対象ミニワーク固有のA/B/Cルーブリックを優先してください。",
    "重要: A基準の必須要素がすべて満たされている場合、追加の数字・詳細・判断理由を要求してB/Cに落とさないでください。",
    "重要: 数字や定量情報は、そのミニワークのA基準または必須要素に含まれる場合のみ必須として扱ってください。",
    "重要(V7.1): 必須要素は【意味】で判定してください。特定の語句（例: 『します』『ため』『なぜ』）の有無で機械的に減点せず、言い換え・同義表現・文脈から要素が実質的に満たされていればA基準を満たしたと判定してください（例: 『充てる/回す/据える/繋げる/振り分ける/購入する』も行動、『主因/削っていた/効果が薄い/優先度が低い』も理由）。",
    "重要(V7.1): 内容が具体的で必須要素を実質的に満たす回答は、表現が定型でなくても積極的にpass（A）としてください。判断に迷う場合、要素が読み取れるなら合格側に倒してください。",
    "- 対象ミニワーク固有のA/B/C評価基準を最優先する",
    "- 必須要素を満たさない場合は、点数が高くてもpassにしない",
    "- 動画の核心メッセージに沿っているかを見る",
    "- よくある誤解に該当する回答は、その観点を改善点に含める",
    "- 抽象論だけの回答はpassにしない",
    "- 短くても、具体的な状況・行動・気づきがあればpass可能",
    "- P1-01のようにA基準が「行動・理由・場面」の場合、それらが揃っていればpass候補にする",
    "- MW-P1-01では「全部やります」「全部大事」「頑張ります」「しっかりやります」のような、行動を1つに絞っていない抽象回答・選択放棄回答はC寄りに判定する",
    "- MW-P1-01で「上司を不安にさせないため」のように通常業務文脈で使われる不安は、support/review扱いにしない",
    "- MW-P1-01では「明日から」「朝から」「会社から」の単独の「から」を理由扱いしない",
    "- MW-P1-01のA/passには、誰に・どの場面で・どう実行するか・なぜ選ぶかが揃っている必要がある",
    "- MW-P2-05は、課題1つ、問い/仮説の形、サブイシュー、優先順位または最初に確かめる項目が揃っていればA/pass候補にする",
    "- MW-P2-05では『〜ではないか？』だけでなく『〜か？』も問い形として許容する",
    "- MW-P2-08は、KPTのTryとYWTMの次にやることが同一または言い換えならTry 1件として扱う",
    "- MW-P2-08のTry 1件判定では、理由の有無を必須にしない",
    "- P2-07のようにA基準が「具体的事象・なぜ5回・真因が構造/仕組み/習慣レベル」の場合、それらが揃っていればpass候補にする",
    "- 「頑張ります」「分かりました」だけの回答はretry",
    "- reviewは、明確な相談希望、強い詰まり、AI判断困難、センシティブ内容、または3回以上未通過の場合だけにする",
    `- pass条件は必須基準達成かつ${payload.passThreshold || 80}点以上`,
    "- A判定はstatus=pass、B/C判定は原則status=retry",
    "- B判定で追加質問1つで補えそうな場合はneedsFollowup=trueとfollowupReasonを返す",
    "- C判定でも3回未満なら原則retry。人の確認が有効な場合のみreview",
    "- abcGradeはA/B/Cのいずれかで返す",
    "",
    "返却JSONスキーマ:",
    JSON.stringify(createEmptyEvaluation(payload, "retry", new Date().toISOString()), null, 2),
    "",
    "入力データ:",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function buildMiniWorkCompactUserPrompt(payload) {
  return [
    "以下のBariseミニワーク回答を短縮評価してください。返却はJSONのみです。",
    `miniWorkId: ${payload.miniWorkId || payload.workId}`,
    `title: ${payload.workTitle}`,
    "",
    "必須要素:",
    JSON.stringify(payload.requiredElements || payload.criteria || [], null, 2),
    "",
    "判定方針:",
    "- 対象ミニワーク固有のA/B/C基準を最優先する",
    "- MW-P2-05は、課題が1つ、問い/仮説の形、サブイシュー、優先順位または最初に確かめる項目が揃えばA/pass候補",
    "- MW-P2-05では『〜ではないか？』だけでなく『〜か？』も問い形として許容する",
    "- AI一時エラーの場合はC/0点固定にせず、aiError=trueの再評価可能状態にする",
    "",
    "返却JSONスキーマ:",
    JSON.stringify(createEmptyEvaluation(payload, "retry", new Date().toISOString()), null, 2),
    "",
    "受講者回答:",
    payload.userAnswer || ""
  ].join("\n");
}

function compactWorkPromptPayload(payload) {
  return {
    workId: payload.workId,
    workTitle: payload.workTitle,
    workPurpose: payload.workPurpose,
    profile: payload.profile,
    questions: payload.questions || [],
    completionCondition: payload.completionCondition || "",
    aiWorkPromptTemplate: payload.aiWorkPromptTemplate || "",
    hearingHistory: payload.context?.hearingHistory || [],
    localReview: payload.context?.localReview || {},
    submissionCount: payload.submissionCount,
    userAnswer: payload.userAnswer
  };
}

function extractOutputText(body) {
  if (body && typeof body.output_text === "string") return body.output_text;
  if (body && Array.isArray(body.output)) {
    return body.output
      .flatMap((item) => item.content || [])
      .map((content) => content.text || content.output_text || "")
      .join("");
  }
  if (body && body.choices && body.choices[0] && body.choices[0].message) {
    return body.choices[0].message.content || "";
  }
  throw new Error("invalid_json");
}

function normalizeEvaluation(raw = {}, payload, evaluatedAt, rawModel) {
  const source = raw && typeof raw === "object" ? raw : {};
  const flags = normalizeFlags(source.flags);
  let score = clampScore(source.score);
  const supportRequested = isSupportRequested(payload.userAnswer);
  let status = normalizeStatus(source.status);
  let abcGrade = normalizeAbcGrade(source.abcGrade || source.abc_grade, status, score);
  const miniAssessment = payload.isMiniWork ? assessMiniWorkRubric(payload) : null;
  const workAssessment = !payload.isMiniWork ? assessWorkRubric(payload) : null;
  const reviewAllowed = !payload.isMiniWork || isMiniWorkReviewAllowed(source, flags, payload, supportRequested);
  // V7.1採点是正: AI判断（gpt-4o-mini）を主軸に、決定論rubricを"最低保証フロア"にする。
  //   実質ルール = 「AI合格 もしくは 決定論合格 なら合格」。
  const aiStatus = normalizeStatus(source.status);
  const aiScore = clampScore(source.score);
  const passThresholdNum = Number(payload.passThreshold) || 80;
  const aiPass = !flags.aiError && (aiStatus === "pass" || (abcGrade === "A" && aiScore >= passThresholdNum));
  const aiGaveImprovement = asArray(source.feedback && source.feedback.improvementPoints || source.improvement_points).length > 0;

  if (supportRequested) {
    status = "review";
    flags.needsSupport = true;
  } else if (payload.isMiniWork) {
    flags.needsSupport = false;
  }
  if (payload.submissionCount >= payload.maxRetryBeforeReview && status !== "pass") {
    status = "review";
    flags.needsHumanReview = true;
  }

  if (payload.isMiniWork) {
    // 決定論フロア（安全網）: 全required_elements検知でA相当なら最低合格を保証
    const floorPass = Boolean(miniAssessment && miniAssessment.abcGrade === "A");
    const floorScore = miniAssessment ? miniAssessment.score : 0;
    const passByEither = (aiPass || floorPass) && !supportRequested && !flags.policyWarning;

    if (passByEither) {
      status = "pass";
      abcGrade = "A";
      // AIスコア主軸。フロア/合格閾値/82で下限を保証
      score = Math.max(aiScore, floorScore, passThresholdNum, 82);
      flags.tooAbstract = false;
      flags.missingNextAction = false;
      flags.missingConcreteExample = false;
      flags.missingLessonConnection = false;
      flags.needsHumanReview = false;
      flags.needsSupport = false;
    } else if (supportRequested || (reviewAllowed && (aiStatus === "review" || payload.submissionCount >= payload.maxRetryBeforeReview))) {
      status = "review";
      score = Math.max(aiScore, floorScore);
      if (abcGrade === "A") abcGrade = "B";
    } else {
      status = "retry";
      // 合格に届かない分はAI主軸のスコア（フロアで救済しつつ合格閾値未満に留める）
      score = Math.min(Math.max(aiScore, floorScore, 1), passThresholdNum - 1);
      abcGrade = abcGradeForScore("retry", score);
      flags.needsHumanReview = false;
    }
  } else if (workAssessment) {
    // 本ワークも AI判断ベース＋決定論フロア
    const floorPass = Boolean(workAssessment.abcGrade === "A");
    const floorScore = workAssessment.score || 0;
    const passByEither = (aiPass || floorPass) && !supportRequested && !flags.policyWarning;

    if (passByEither) {
      status = "pass";
      abcGrade = "A";
      score = Math.max(aiScore, floorScore, passThresholdNum, 84);
      flags.tooAbstract = false;
      flags.missingNextAction = false;
      flags.missingConcreteExample = false;
      flags.missingLessonConnection = false;
      flags.needsHumanReview = false;
      flags.needsSupport = false;
    } else if (supportRequested || (payload.submissionCount >= payload.maxRetryBeforeReview && aiStatus !== "pass")) {
      status = "review";
      score = Math.max(aiScore, floorScore);
    } else {
      status = "retry";
      score = Math.min(Math.max(aiScore, floorScore, 1), passThresholdNum - 1);
      abcGrade = abcGradeForScore("retry", score);
      flags.needsHumanReview = false;
    }
  }

  const workKnowledgePass = workAssessment?.abcGrade === "A";
  if (!payload.isMiniWork && status === "pass" && (score < payload.passThreshold || flags.policyWarning || flags.aiError || (!workKnowledgePass && flags.missingLessonConnection))) {
    status = "retry";
  }
  if (payload.isMiniWork && status === "pass") {
    score = Math.max(score, payload.passThreshold, 82);
    abcGrade = "A";
  }
  if (status === "pass" && payload.isModelAnswer) {
    score = 100;
    abcGrade = "A";
  }

  const evaluation = createEmptyEvaluation(payload, status, evaluatedAt);
  evaluation.abcGrade = abcGrade;
  evaluation.abc_grade = evaluation.abcGrade;
  evaluation.needsFollowup = status === "retry" && (abcGrade === "B" || Boolean(source.needsFollowup || source.needs_followup || flags.needsFollowup || miniAssessment?.needsFollowup || workAssessment?.needsFollowup));
  evaluation.needs_followup = evaluation.needsFollowup;
  evaluation.followupReason = safeText(source.followupReason || source.followup_reason || miniAssessment?.followupReason || workAssessment?.followupReason || "");
  evaluation.followup_reason = evaluation.followupReason;
  evaluation.score = score;
  // V7.1採点是正: 不合格理由はAIの具体フィードバックを優先（決定論文言はフォールバック）
  evaluation.reason = safeText(source.reason || source.summary || miniAssessment?.reason || workAssessment?.reason || evaluation.reason);
  evaluation.feedback.summary = safeText(source.feedback && source.feedback.summary || source.summary || evaluation.feedback.summary);
  evaluation.feedback.goodPoints = limitArray(asArray(source.feedback && source.feedback.goodPoints || source.good_points), 3);
  evaluation.feedback.improvementPoints = limitArray(asArray(source.feedback && source.feedback.improvementPoints || source.improvement_points), 3);
  evaluation.nextQuestion = safeText(source.nextQuestion || source.next_question || source.next_action || evaluation.nextQuestion);
  evaluation.flags = flags;
  evaluation.criteria = normalizeCriteria(source.criteria);
  evaluation.meta.model = rawModel || DEFAULT_MODEL;
  evaluation.meta.evaluatedAt = evaluatedAt;
  evaluation.meta.schemaVersion = payload.isMiniWork ? MINI_WORK_SCHEMA_VERSION : WORK_SCHEMA_VERSION;

  if (!evaluation.feedback.goodPoints.length && workAssessment?.goodPoints?.length) {
    evaluation.feedback.goodPoints = workAssessment.goodPoints.slice(0, 3);
  }
  if (!evaluation.feedback.goodPoints.length) {
    evaluation.feedback.goodPoints = ["回答に向き合い、自分の言葉で整理を始められています。"];
  }
  if (status !== "pass" && !evaluation.feedback.improvementPoints.length) {
    evaluation.feedback.improvementPoints = [miniWorkRetryMessage(payload, miniAssessment)];
  }
  // V7.1採点是正: AIが改善点を返した場合はそれを優先し、決定論unmetは補完のみ
  if (status !== "pass" && !aiGaveImprovement && workAssessment?.unmetCriteria?.length) {
    evaluation.feedback.improvementPoints = workAssessment.unmetCriteria.slice(0, 3);
    evaluation.nextQuestion = workFollowupQuestion(workAssessment);
  }
  if (status !== "pass" && !aiGaveImprovement && miniAssessment?.unmetCriteria?.length) {
    evaluation.feedback.improvementPoints = payload.miniWorkId === "MW-P1-01"
      ? [miniWorkRetryMessage(payload, miniAssessment)]
      : miniAssessment.unmetCriteria.slice(0, 2);
    evaluation.nextQuestion = miniWorkFollowupQuestion(miniAssessment, payload);
  }
  evaluation.feedback.goodPoints = uniqueArray(evaluation.feedback.goodPoints).slice(0, 3);
  evaluation.feedback.improvementPoints = status === "pass"
    ? []
    : uniqueArray(evaluation.feedback.improvementPoints)
      .filter((item) => !evaluation.feedback.goodPoints.includes(item))
      .slice(0, 3);
  if (evaluation.nextQuestion && evaluation.nextQuestion === evaluation.nextAction) {
    evaluation.nextAction = status === "pass" ? "次へ進みましょう。" : "もう一度具体化しましょう。";
  }
  if (status === "review") {
    evaluation.flags.needsHumanReview = evaluation.flags.needsHumanReview || !evaluation.flags.needsSupport;
  }
  if (evaluation.needsFollowup) {
    evaluation.flags.needsFollowup = true;
  }

  return evaluation;
}

function createEmptyEvaluation(payload, status, evaluatedAt) {
  const retryReason = payload.isMiniWork
    ? "このワークのA基準に足りない要素があります。"
    : "具体的な場面・数字・判断理由をもう一段足す必要があります。";
  const retryQuestion = payload.isMiniWork
    ? "このワークのA基準に足りない要素を1〜2点足してください。"
    : "直近の具体的な場面、数字、次に取る行動を1つずつ足して書き直してください。";
  return {
    workType: payload.isMiniWork ? "miniWork" : "work",
    miniWorkId: payload.miniWorkId || "",
    parentLessonId: payload.parentLessonId || payload.context?.lessonId || "",
    status,
    abcGrade: abcGradeForScore(status, status === "pass" ? 82 : 58),
    abc_grade: abcGradeForScore(status, status === "pass" ? 82 : 58),
    needsFollowup: false,
    needs_followup: false,
    followupReason: "",
    followup_reason: "",
    score: status === "pass" ? 82 : 58,
    reason: status === "pass"
      ? "目的に沿って必要な材料が整理されています。"
      : retryReason,
    feedback: {
      summary: status === "pass"
        ? (payload.isMiniWork ? "通過ラインです。次へ進めます。" : "通過ラインです。次のワークへ進めます。")
        : "方向性はあります。次の質問に答える形で、もう一度整理しましょう。",
      goodPoints: [],
      improvementPoints: []
    },
    nextQuestion: status === "pass"
      ? "次のワークへ進みましょう。"
      : retryQuestion,
    flags: {
      needsHumanReview: status === "review",
      needsSupport: false,
      needsFollowup: false,
      aiError: false,
      policyWarning: false,
      tooAbstract: status !== "pass",
      missingNextAction: status !== "pass",
      missingConcreteExample: status !== "pass",
      missingLessonConnection: false
    },
    criteria: normalizeCriteria({}),
    meta: {
      model: DEFAULT_MODEL,
      schemaVersion: payload.isMiniWork ? MINI_WORK_SCHEMA_VERSION : WORK_SCHEMA_VERSION,
      evaluatedAt
    },
    workId: payload.workId
  };
}

function createHeuristicEvaluation(payload, evaluatedAt) {
  if (payload.isMiniWork) {
    const assessment = assessMiniWorkRubric(payload);
    const supportRequested = isSupportRequested(payload.userAnswer || "");
    const review = supportRequested || (payload.submissionCount >= payload.maxRetryBeforeReview && assessment.status !== "pass");
    const status = review ? "review" : assessment.status;
    const evaluation = createEmptyEvaluation(payload, status, evaluatedAt);
    evaluation.score = status === "review" ? 58 : assessment.score;
    evaluation.abcGrade = status === "review" ? assessment.abcGrade : assessment.abcGrade;
    evaluation.abc_grade = evaluation.abcGrade;
    evaluation.needsFollowup = status === "retry" && assessment.needsFollowup;
    evaluation.needs_followup = evaluation.needsFollowup;
    evaluation.followupReason = assessment.followupReason;
    evaluation.followup_reason = evaluation.followupReason;
    evaluation.reason = assessment.reason;
    evaluation.feedback.goodPoints = assessment.goodPoints;
    evaluation.feedback.improvementPoints = status === "pass" ? [] : (
      payload.miniWorkId === "MW-P1-01"
        ? [miniWorkRetryMessage(payload, assessment)]
        : assessment.unmetCriteria.slice(0, 2)
    );
    evaluation.nextQuestion = status === "pass" ? "次へ進みましょう。" : miniWorkFollowupQuestion(assessment, payload);
    evaluation.flags.needsSupport = supportRequested;
    evaluation.flags.needsHumanReview = status === "review" && !supportRequested;
    evaluation.flags.tooAbstract = assessment.abcGrade !== "A";
    evaluation.flags.missingConcreteExample = assessment.abcGrade !== "A";
    evaluation.flags.missingLessonConnection = false;
    evaluation.flags.needsFollowup = evaluation.needsFollowup;
    evaluation.meta.model = "mock-fixed-json";
    return evaluation;
  }

  const workAssessment = assessWorkRubric(payload);
  if (workAssessment) {
    const supportRequested = isSupportRequested(payload.userAnswer || "");
    const review = supportRequested || (payload.submissionCount >= payload.maxRetryBeforeReview && workAssessment.status !== "pass");
    const status = review ? "review" : workAssessment.status;
    const evaluation = createEmptyEvaluation(payload, status, evaluatedAt);
    evaluation.score = status === "review" ? Math.min(workAssessment.score, 58) : workAssessment.score;
    evaluation.abcGrade = workAssessment.abcGrade;
    evaluation.abc_grade = evaluation.abcGrade;
    evaluation.needsFollowup = status === "retry" && workAssessment.needsFollowup;
    evaluation.needs_followup = evaluation.needsFollowup;
    evaluation.followupReason = workAssessment.followupReason;
    evaluation.followup_reason = evaluation.followupReason;
    evaluation.reason = workAssessment.reason;
    evaluation.feedback.goodPoints = workAssessment.goodPoints;
    evaluation.feedback.improvementPoints = status === "pass" ? [] : workAssessment.unmetCriteria.slice(0, 3);
    evaluation.nextQuestion = status === "pass" ? "次のワークへ進みましょう。" : workFollowupQuestion(workAssessment);
    evaluation.flags.needsSupport = supportRequested;
    evaluation.flags.needsHumanReview = status === "review" && !supportRequested;
    evaluation.flags.tooAbstract = workAssessment.abcGrade !== "A";
    evaluation.flags.missingConcreteExample = workAssessment.abcGrade !== "A";
    evaluation.flags.missingNextAction = workAssessment.abcGrade !== "A";
    evaluation.flags.missingLessonConnection = false;
    evaluation.flags.needsFollowup = evaluation.needsFollowup;
    evaluation.meta.model = "mock-fixed-json";
    return evaluation;
  }

  const answer = payload.userAnswer || "";
  const supportRequested = isSupportRequested(answer);
  const hasDetail = /(今日|明日|今週|来週|商談|顧客|提案|対応|件|率|時間|金額|期限|[0-9０-９])/.test(answer);
  const hasAction = /(確認|測る|記録|聞く|試す|実行|見直|決める|伝える)/.test(answer);
  const thinLimit = payload.isMiniWork ? 24 : 70;
  const thin = answer.length < thinLimit || /^(頑張ります|がんばります|意識します|改善します|やります|分かりました|わかりました)。?$/.test(answer.trim());
  let status = supportRequested ? "review" : (!thin && hasDetail && hasAction ? "pass" : "retry");
  if (payload.submissionCount >= 3 && status !== "pass") status = "review";
  const evaluation = createEmptyEvaluation(payload, status, evaluatedAt);
  evaluation.score = status === "pass" ? 86 : status === "review" ? 52 : (payload.isMiniWork ? 64 : 58);
  evaluation.abcGrade = abcGradeForScore(status, evaluation.score);
  evaluation.abc_grade = evaluation.abcGrade;
  evaluation.needsFollowup = payload.isMiniWork && status === "retry" && evaluation.score >= payload.retryThreshold;
  evaluation.needs_followup = evaluation.needsFollowup;
  evaluation.followupReason = evaluation.needsFollowup ? "A基準に近いですが、具体場面や理由の補足が必要です。" : "";
  evaluation.followup_reason = evaluation.followupReason;
  evaluation.reason = status === "pass"
    ? "具体的な場面・数字・次アクションが含まれており、目的に沿っています。"
    : "回答の方向性はありますが、具体的な場面・数字・次アクションが不足しています。";
  evaluation.feedback.goodPoints = [payload.isMiniWork ? "学んだ内容を自分の言葉で受け止められています。" : "扱いたいテーマを自分の言葉で出せています。"];
  evaluation.feedback.improvementPoints = status === "pass" ? [] : ["場面・数字・次に取る行動を具体化してください。"];
  evaluation.nextQuestion = payload.isMiniWork && status !== "pass"
    ? "実際の業務では、いつ・誰に対して・何を試しますか？"
    : evaluation.nextQuestion;
  evaluation.flags.needsSupport = supportRequested;
  evaluation.flags.needsHumanReview = status === "review" && !supportRequested;
  evaluation.flags.tooAbstract = thin;
  evaluation.flags.missingConcreteExample = !hasDetail;
  evaluation.flags.missingLessonConnection = payload.isMiniWork && answer.length < 18;
  evaluation.flags.needsFollowup = evaluation.needsFollowup;
  evaluation.meta.model = "mock-fixed-json";
  return evaluation;
}

function createFallbackEvaluation(payload, errorType, evaluatedAt) {
  const source = payload || { workId: "" };
  // V7.1採点是正: タイムアウト/失敗時は「0点」にせず、決定論フロアのスコアで安全側に判定する。
  //   良い回答（必須要素充足=A相当）はAI確認が失敗しても合格を保証し、偶発的な0点不合格を根治。
  const assessment = payload && payload.isMiniWork
    ? assessMiniWorkRubric(payload)
    : (payload ? assessWorkRubric(payload) : null);
  const supportRequested = isSupportRequested(payload?.userAnswer || "");
  const floorPass = Boolean(assessment && assessment.abcGrade === "A") && !supportRequested;
  const passThresholdNum = Number(payload?.passThreshold) || 80;
  const status = floorPass ? "pass" : (supportRequested ? "review" : "retry");

  const evaluation = createEmptyEvaluation(source, status, evaluatedAt);
  evaluation.score = floorPass
    ? Math.max(assessment.score || 0, passThresholdNum, payload?.isMiniWork ? 82 : 84)
    : (assessment ? assessment.score : (payload?.isMiniWork ? 64 : 58));
  evaluation.abcGrade = floorPass ? "A" : abcGradeForScore(status, evaluation.score);
  evaluation.abc_grade = evaluation.abcGrade;
  evaluation.needsFollowup = false;
  evaluation.needs_followup = false;
  evaluation.followupReason = "";
  evaluation.followup_reason = "";
  evaluation.reason = floorPass
    ? "AIの確認が一時的に混み合ったため、必須要素の充足を確認して判定しました。"
    : "AIの確認が一時的にできませんでした。必須要素をもう一度確認して整理しましょう。";
  evaluation.feedback.summary = floorPass
    ? "必須要素を満たしているため通過としました（AI確認は混み合っていました）。"
    : "AI確認が混み合っていました。入力内容は失われていません。";
  evaluation.feedback.goodPoints = floorPass ? (assessment.goodPoints || []).slice(0, 3) : [];
  evaluation.feedback.improvementPoints = floorPass
    ? []
    : (assessment?.unmetCriteria?.length ? assessment.unmetCriteria.slice(0, 2) : ["具体的な場面・数字・行動を1つ足してください。"]);
  evaluation.nextQuestion = floorPass ? "次へ進みましょう。" : "実際の業務では、いつ・誰に対して・何を試しますか？";
  // aiError は立てない（クライアントが result_status="failed" に落とすのを避け、安全側スコアを活かす）。
  evaluation.flags.aiError = false;
  evaluation.flags.needsSupport = supportRequested;
  evaluation.flags.needsHumanReview = status === "review";
  evaluation.flags.tooAbstract = false;
  evaluation.flags.missingNextAction = false;
  evaluation.meta.model = DEFAULT_MODEL;
  evaluation.errorType = errorType || "openai_error"; // ログ/透明性のため保持（判定には使わない）
  evaluation.errorMessageSafe = safeErrorMessage(errorType);
  return evaluation;
}

function assessWorkRubric(payload) {
  const knowledge = payload.workEvaluationKnowledge || {};
  if (!knowledge.passRequiredElements?.length && !knowledge.modelAnswerChecklist?.length) return null;

  const answer = safeText(payload.userAnswer || "");
  const requiredElements = knowledge.passRequiredElements?.length ? knowledge.passRequiredElements : payload.requiredElements || [];
  const thin = isThinWorkAnswer(answer);
  const bad = matchesBadWorkAnswer(answer, knowledge);
  const checks = requiredElements.map((element) => ({
    element: safeText(element),
    met: workRequirementMet(payload.workId, answer, element)
  })).filter((item) => item.element);
  const metCriteria = checks.filter((item) => item.met).map((item) => item.element);
  const unmetCriteria = checks.filter((item) => !item.met).map((item) => item.element);
  const metRatio = checks.length ? metCriteria.length / checks.length : 0;

  if (thin || bad || !answer) {
    return {
      abcGrade: "C",
      status: "retry",
      score: 45,
      needsFollowup: false,
      followupReason: "",
      goodPoints: metCriteria.slice(0, 2),
      unmetCriteria: (unmetCriteria.length ? unmetCriteria : requiredElements).slice(0, 3),
      reason: "回答の材料が不足しているため、ワーク別のA基準に沿って書き直す必要があります。"
    };
  }

  if (checks.length && unmetCriteria.length === 0) {
    return {
      abcGrade: "A",
      status: "pass",
      score: Math.max(Number(payload.passThreshold || 80), 84),
      needsFollowup: false,
      followupReason: "",
      goodPoints: metCriteria.slice(0, 4),
      unmetCriteria: [],
      reason: "対象ワークのW別必須要素が揃っています。"
    };
  }

  if (metRatio >= 0.45 || hasWorkAttempt(answer, payload.workId)) {
    return {
      abcGrade: "B",
      status: "retry",
      score: Math.max(Number(payload.retryThreshold || 60), 70),
      needsFollowup: true,
      followupReason: "A基準に近づけるため、足りないW別必須要素を1〜2点補足してください。",
      goodPoints: metCriteria.slice(0, 3),
      unmetCriteria: (unmetCriteria.length ? unmetCriteria : requiredElements).slice(0, 3),
      reason: "方向性は合っていますが、W別A基準に足りない要素があります。"
    };
  }

  return {
    abcGrade: "C",
    status: "retry",
    score: 45,
    needsFollowup: false,
    followupReason: "",
    goodPoints: metCriteria.slice(0, 2),
    unmetCriteria: (unmetCriteria.length ? unmetCriteria : requiredElements).slice(0, 3),
    reason: "ワークの目的に対する材料が不足しています。"
  };
}

function workRequirementMet(workId, answer, element) {
  const text = safeText(element);
  if (!text) return false;
  const normalized = safeText(answer);
  const byWork = {
    "W-P1-05": [
      () => /(テーマ|改善|講座|営業|商談|提案|問い合わせ|育成|AI|業務)/.test(normalized) && /(1つ|一つ|テーマは|対象は)/.test(normalized),
      () => /(現状|現在|先週|直近|今).*?(理想|目標|GAP|差分)|GAP|理想/.test(normalized),
      () => /(理由|なぜ|目的|価値|ため|したい|意味|仕事上)/.test(normalized),
      () => /(3ヶ月|３ヶ月|三ヶ月|月以内|期限|成果物|到達|モニター|初回講座)/.test(normalized),
      () => /(今週|次回|明日|今日|金曜|月曜|[0-9０-９]+:[0-9０-９]+|実行|作り|まとめ|確認)/.test(normalized)
    ],
    "W-P1-09": [
      () => /(フェーズ1|学び|習慣|重要タスク|報連相|着手|中間|完了)/.test(normalized),
      () => /(続ける|継続|毎朝|毎週|報告|記録|確認).*(行動|習慣|こと)?/.test(normalized),
      () => /(やめる|減らす|停止|見続ける|後回し|削る)/.test(normalized),
      () => /(次フェーズ|次のフェーズ|W2|W3|数字|実行計画|計画)/.test(normalized),
      () => /(毎週|毎朝|確認|指標|頻度|期限|金曜|[0-9０-９]+:[0-9０-９]+|数|率)/.test(normalized)
    ],
    "W-P2-01": [
      () => hasConcreteWorkDetail(normalized),
      () => hasMetricEvidence(normalized),
      () => /戦略/.test(normalized) && /戦術/.test(normalized) && /実行/.test(normalized),
      () => /(なぜ|理由|ため|成果|KGI|提案化率|受注|改善|上がる|つながる)/.test(normalized)
    ],
    "W-P2-02": [
      // V7.2.4: KGI/KPI/KDI体系＋数値を「定量化された理想状態」として許容
      () => /(理想|状態|目標|KGI|ゴール|到達)/i.test(normalized) && hasMetricEvidence(normalized),
      () => /(KGI|最終成果)/i.test(normalized) && /(KPI|途中成果)/i.test(normalized) && /(KDI|行動指標|行動量|行動品質)/i.test(normalized),
      () => /(自分|行動|変えられる|KDI|準備|確認|件数|項目数)/.test(normalized),
      () => /(見せかけ|表面的|直結しない|除外|注意|架電数だけ|フォロワー)/.test(normalized)
    ],
    "W-P2-03": [
      // V7.2.4: 具体例・なぜなぜ/イシュー+仮説+根拠形式・実行可能な改善への接続を許容
      () => /(うまくいかな|失敗|止まり|直近|先週|商談|対応|案件|問い合わせ|リピート|新規|来店|伸びない|繋がらない|頭打ち|失注|受注)/.test(normalized),
      () => countWhy(normalized) >= 2 || (normalized.match(/→/g) || []).length >= 3 || /(なぜなぜ|深掘|真因|構造|プロセス|仮説質問準備)/.test(normalized) || (/(仮説|イシュー)/.test(normalized) && /(根拠|ため|データ|議事|memo|メモ|転換率|確認)/.test(normalized)),
      // V5是正: 構造的真因(型/仕組み/欠如等)も「実行可能な改善につながる粒度」として許容
      () => /(真因|原因)/.test(normalized) && /(型|仕組み|構造|手順|プロセス|欠如|未整備|未定義|フロー|導線|ルール|習慣|改善|変える|実行|準備|標準化|テンプレ|検証|組み込)/.test(normalized),
      () => /(イシュー|取り組むべき|白黒|ではないか|最重要課題)/.test(normalized),
      () => /(KPI|提案化率|改善確認|指標|転換率|リピート率|件|率|%|％|[0-9０-９])/.test(normalized)
    ],
    "W-P2-04": [
      // V7.2.3: 振り返り型（なぜなぜ/KPT/YWT）の模範に対応。根本原因＝仮説として許容し、検知漏れを是正。
      () => /(仮説|ではないか|変えれば|上がるか|根本原因|真因|原因＝|原因=|なぜなぜ)/.test(normalized),
      () => /(根拠|理由|過去|事実|データ|観察|からです|なぜなぜ|→[②-⑤]|①.*②)/.test(normalized),
      () => /(検証|必要データ|期限|いつまで|測定|記録|金曜|月曜|今日から|今週中|日|週|月|[0-9０-９]+:[0-9０-９]+)/.test(normalized),
      () => /(Try|T[:：]|次にやること|次アクション|仮説を修正)/i.test(normalized) ||
        (/(作り|作成|固定|開始|運用|仕組み化|テンプレ|手順|自動|下書き)/.test(normalized) && /(金曜|月曜|今日|今週|明日|までに|から|[0-9０-９]+時)/.test(normalized)),
      () => /(構造|修正ポイント|KPT|YWT|YWTM|根本原因|なぜなぜ|真因|フレーム|振り返り)/i.test(normalized)
    ],
    "W-P2-05": [
      () => /(対象者|相手|顧客|部下|チーム|現場|営業担当|後輩|知人|同僚|Bさん|課題|困って)/.test(normalized),
      () => /(結論|根拠|理由|事実|データ|観察|記録|商談メモ)/.test(normalized),
      // V7.2.4: ロジックツリー(Why/How)で問題段階を特定する形式を許容
      () => /(W1|W2|W3|W4|現状|理想|イシュー|仮説|検証|構造化|ロジックツリー|Why|How|段階|転換|ボトルネック|要因|プロセス)/i.test(normalized),
      () => /(介入|働きかけ|支援|提案|期待変化|変化|一緒に作る|サポート|標準化|配り|運用|テンプレ)/.test(normalized),
      () => /(第三者|説明|伝える|構造|結論|根拠|まとめ|ピラミッド)/.test(normalized)
    ]
  };

  const workChecks = byWork[workId];
  if (workChecks) {
    const index = elementIndexForWorkRequirement(workId, text);
    if (index >= 0 && workChecks[index]) return workChecks[index]();
  }

  if (/数値|数字|指標|KPI|KGI|KDI|率|件/.test(text)) return hasMetricEvidence(normalized);
  if (/期限|タイミング|確認/.test(text)) return /(今日|明日|今週|来週|金曜|月曜|[0-9０-９]+:[0-9０-９]+|確認|毎週|毎朝)/.test(normalized);
  if (/理由|根拠|目的|なぜ/.test(text)) return /(理由|根拠|目的|なぜ|ため|からです)/.test(normalized);
  return normalized.length >= 80 && hasConcreteWorkDetail(normalized);
}

function elementIndexForWorkRequirement(workId, element) {
  const indexes = {
    "W-P1-05": [/テーマ.*1つ/, /現状.*理想|差分/, /理由|目的/, /3ヶ月|到達/, /今週|次回|アクション/],
    "W-P1-09": [/学び|習慣/, /続ける/, /やめる|減らす/, /次フェーズ|実行計画/, /確認|指標|タイミング/],
    "W-P2-01": [/業務|活動/, /数値/, /戦略|戦術|実行/, /成果.*理由|理由/],
    "W-P2-02": [/理想状態/, /KGI|KPI|KDI/, /行動.*指標/, /見せかけ/],
    "W-P2-03": [/具体例/, /なぜなぜ/, /真因/, /イシュー/, /KPI|指標/],
    "W-P2-04": [/仮説がある/, /根拠/, /検証方法|必要データ|期限/, /次アクション/, /修正ポイント/],
    "W-P2-05": [/他者.*課題/, /結論.*根拠/, /W1|W4|問題段階/, /介入|期待変化/, /第三者|説明/]
  };
  return (indexes[workId] || []).findIndex((pattern) => pattern.test(element));
}

function isThinWorkAnswer(answer) {
  const normalized = safeText(answer);
  return normalized.length < 24 ||
    /^(あ|テスト|test|なし|特になし|特にない|未定|頑張ります|がんばります|意識します|やります|改善します|分かりました|わかりました)。?$/i.test(normalized);
}

function matchesBadWorkAnswer(answer, knowledge = {}) {
  const normalized = safeText(answer);
  if (/^(頑張ります|がんばります|意識します|改善します|やります|全部やります|全部大事です)。?$/i.test(normalized)) return true;
  if (/全部(大事|重要|続ける|やる)/.test(normalized) && normalized.length < 80) return true;
  if (isGenericWorkAnswer(normalized)) return true;
  return (knowledge.badAnswerPatterns || []).some((pattern) => {
    const text = safeText(pattern);
    return text && normalized === text;
  });
}

function isGenericWorkAnswer(answer) {
  const normalized = safeText(answer);
  if (!normalized) return true;
  const genericIntent = /(AIを活用|業務改善|課題を整理|成果につながる|改善します|実行します|考えます|頑張ります|意識します)/.test(normalized);
  return normalized.length < 120 && genericIntent && !hasConcreteWorkDetail(normalized) && !hasMetricEvidence(normalized);
}

function hasWorkAttempt(answer, workId) {
  const normalized = safeText(answer);
  if (workId === "W-P2-01") return /(戦略|戦術|実行|KPI|数値|商談)/.test(normalized);
  if (workId === "W-P2-02") return /(KGI|KPI|KDI|理想|見せかけ)/.test(normalized);
  if (workId === "W-P2-03") return /(なぜ|真因|イシュー|失敗|KPI)/.test(normalized);
  if (workId === "W-P2-04") return /(仮説|検証|根拠|期限|次アクション)/.test(normalized);
  if (workId === "W-P2-05") return /(対象者|結論|根拠|介入|W1|W2|W3|W4)/.test(normalized);
  return hasConcreteWorkDetail(normalized);
}

function hasConcreteWorkDetail(answer) {
  return /(今日|明日|今週|来週|直近|初回|先週|商談|顧客|上司|同僚|チーム|後輩|対象者|問い合わせ|提案|受注|案件|準備|手順|質問|対応|件|率|時間|金額|[0-9０-９]+)/.test(answer || "");
}

function hasMetricEvidence(answer) {
  return /(KGI|KPI|KDI|数値|数字|件数|率|時間|金額|売上|受注|成約|返信|満足度|次回|提案率|項目数|[0-9０-９]+%?|[0-9０-９]+件)/i.test(answer || "");
}

function assessMiniWorkRubric(payload) {
  const answer = safeText(payload.userAnswer || "");
  const requiredElements = payload.requiredElements?.length ? payload.requiredElements : payload.criteria || [];
  const thin = isThinMiniWorkAnswer(answer);
  const checks = requiredElements.map((element) => ({
    element: safeText(element),
    met: miniRequirementMet(answer, element, payload)
  })).filter((item) => item.element);
  const metCriteria = checks.filter((item) => item.met).map((item) => item.element);
  const unmetCriteria = checks.filter((item) => !item.met).map((item) => item.element);

  if (thin || isMiniWorkSelectionAbandoned(answer, payload) || !answer) {
    return {
      abcGrade: "C",
      status: "retry",
      score: 45,
      needsFollowup: false,
      followupReason: "",
      goodPoints: [],
      unmetCriteria: requiredElements.slice(0, 2),
      reason: "回答の材料が不足しているため、A基準に沿って書き直す必要があります。"
    };
  }

  if (checks.length && unmetCriteria.length === 0) {
    return {
      abcGrade: "A",
      status: "pass",
      score: Math.max(Number(payload.passThreshold || 80), 82),
      needsFollowup: false,
      followupReason: "",
      goodPoints: metCriteria.slice(0, 3),
      unmetCriteria: [],
      reason: "対象ミニワークのA基準に必要な要素が揃っています。"
    };
  }

  const enoughForFollowup = answer.length >= 18 && (metCriteria.length > 0 || hasMiniWorkAttempt(answer, payload));
  if (enoughForFollowup) {
    const missing = unmetCriteria.length ? unmetCriteria : requiredElements.slice(0, 2);
    return {
      abcGrade: "B",
      status: "retry",
      score: Math.max(Number(payload.retryThreshold || 60), 70),
      needsFollowup: true,
      followupReason: "A基準に近づけるため、足りない要素を1〜2点補足してください。",
      goodPoints: metCriteria.slice(0, 3),
      unmetCriteria: missing.slice(0, 2),
      reason: "方向性は合っていますが、A基準に足りない要素があります。"
    };
  }

  return {
    abcGrade: "C",
    status: "retry",
    score: 45,
    needsFollowup: false,
    followupReason: "",
    goodPoints: metCriteria.slice(0, 2),
    unmetCriteria: (unmetCriteria.length ? unmetCriteria : requiredElements).slice(0, 2),
    reason: "問いに対する材料が不足しているため、A基準に沿って書き直す必要があります。"
  };
}

// ===== V7.2.3 P1決定論フロア拡充 =====
// gpt-4o-miniはfew-shotでもP1を較正できない（自分の見本すら70）ため、P1ミニの合否は
// AI非依存の決定論フロアで確実化する。合格ライン80・required_elements自体は不変。
// ここでは「良回答が全要素検知される」水準まで検知を是正するのみ（緩和ではなく検知漏れ修正）。
// あやか基準=「数値まで必須」に沿い、数値が本質の設問（P1-02/04/05）は数値を必須、
// 数値が馴染まない定性設問（P1-01/03/06/07/08）は枠組み要素を必須・数値は任意加点にする。

function p1HasQuotedOrAction(t) {
  return /「[^」]{2,}」/.test(t) || hasActionChoice(t);
}
function p1HasReason(t) {
  return /(ため|ので|から|なぜなら|理由|目的|狙い|背景|削っ|感じさせ|遅い|リスク|直結|影響|溶かし|後回し|困らない|優先|必須|締切|失注|防ぐ|懸念|につながる|に繋がる|しがち|下がる|高く|大きい|薄く)/.test(t);
}
function p1HasScene(t) {
  return /(今日|明日|今朝|朝|昼|夕方|夜|午前|午後|[0-9０-９]+時|今週|来週|週末|毎週|毎日|毎月|月末|金曜|月曜|火曜|水曜|木曜|土曜|日曜|会議|商談|研修|朝礼|来店|予約|施術|カウンセリング|会計|開店|Slack|LINE|メール|カレンダー|リスト|スプレッドシート|記録|投稿)/.test(t);
}
function p1HasEnumeration(t) {
  if ((t.match(/[①②③④⑤⑥]/g) || []).length >= 2) return true;
  if ((t.match(/【[^】]+】/g) || []).length >= 2) return true;
  return (t.match(/[0-9０-９]+[\.、）)]/g) || []).length >= 2;
}
function p1HasNumber(t) {
  return /[0-9０-９]/.test(t) || /(→|->)/.test(t);
}
function p1HasSelfBlameSet(t) {
  const selfBlame = /(自責|自分|私|ヒアリング不足|準備不足|できていなかった|していなかった|しなかった|会えないまま|掴めていなかった|用意せず|声かけ|送っていなかった|深掘りできず)/.test(t);
  return selfBlame && (p1HasEnumeration(t) || /(3つ|三つ|3点)/.test(t));
}
function p1HasObservableDefinition(t) {
  if (/[0-9０-９]/.test(t) && /(以内|まで|回|分|時間|日|件|%|％)/.test(t)) return true;
  return /(チェックリスト|明記|判定でき|確認でき|お伝え|架電|カウンセリング|手順|基準|観測|お礼メール|議事メモ)/.test(t);
}
function p1Abandoned(t) {
  // 「全部大事」「全部やります」式の選択放棄のみ検出。「N件すべてで実行」等の具体行動は放棄でない。
  if (/「[^」]{2,}」/.test(t) || /[0-9０-９]+\s*件/.test(t)) return false;
  if (/(1つ|一つ|1個|絞|選ん|マスト|やめ|やらない)/.test(t)) return false;
  return /(全部|すべて|全て).{0,6}(大事|重要|やります|します|がんばり|頑張り|終わらせ)|^(頑張ります|がんばります|意識します|しっかりやります)/.test(t);
}

// P1ミニのワーク別・必須要素判定。対応要素はtrue/false、未対応要素はnull（=既存フォールバックへ）。
function p1RequirementMet(t, element, payload) {
  const id = payload.miniWorkId || payload.workId || "";

  if (id === "MW-P1-01") {
    if (/行動が1つ/.test(element)) return p1HasQuotedOrAction(t) && !p1Abandoned(t);
    if (/理由/.test(element)) return p1HasReason(t);
    if (/いつ・どこで|場面/.test(element)) return p1HasScene(t) && (/[0-9０-９]/.test(t) || /「[^」]{2,}」/.test(t));
  }
  if (id === "MW-P1-02") { // V5是正: 数値必須を解除（実設問は5方法から1つ選ぶ＝非数値の方法も正答）
    if (/方法が1つ/.test(element)) return p1HasQuotedOrAction(t) && !p1Abandoned(t);
    if (/理由/.test(element)) return p1HasReason(t) || /(記録|ルール|仕組み|チェック|リスト|スプレッドシート|正の字|解禁|習慣|発注|場所|会議室|こもる|通知|削除|5分)/.test(t);
    if (/場面|状況/.test(element)) return p1HasScene(t);
  }
  if (id === "MW-P1-03") { // V5是正: 「やめ語」必須を撤廃。実設問は7方法(断る/自動化/選別/後回し等)から1つ選ぶ
    // 「色々試す」式の非選択のみ除外（"新規分すべてに適用"等の正当な全体適用は除外しない。放棄はp1Abandonedが担当）
    const methodPicked = (/「[^」]{2,}」/.test(t) || /(断る|断り|自動化|外注|委譲|効率化|選別|後回し|やめ|やらない|やりません|減らす|捨て|見送|標準化|テンプレ|セット|予約投稿)/.test(t)) &&
      !/(色々|いろいろ|なんでも|色んな|とにかく)/.test(t) && !p1Abandoned(t);
    if (/方法が1つ/.test(element)) return methodPicked;
    if (/理由/.test(element)) return p1HasReason(t);
    if (/タスク・場面|具体/.test(element)) return p1HasScene(t) || p1HasEnumeration(t) || /(充て|回す|回し|振り分け|セット|適用|相談)/.test(t);
  }
  if (id === "MW-P1-04") { // 数値目標系: 数値（時刻等）必須
    if (/複数書き出/.test(element)) return p1HasEnumeration(t);
    if (/一番/.test(element)) return /(マストワン|マスト|一番|最優先|最も|これを最初|最初に|優先)/.test(t) && !p1Abandoned(t);
    if (/理由/.test(element)) return p1HasReason(t) && /(緊急|重要|締切|リスク|依頼|失注|必須|優先|直結)/.test(t);
  }
  if (id === "MW-P1-05") { // V5是正: 数値必須＋現状→目標を撤廃。実設問は両極端ワーク(定性)＋本当にやりたい1つ＋期限
    if (/Step 1・2/.test(element)) return /(制限|無制限|自由|なけれ)/.test(t) && /(最後|最期|今日が最後|人生最後|最後の[1一]日)/.test(t);
    if (/やりたいこと.*1つ/.test(element)) return /(本当に|叶えたい|やりたいこと|一番|大切)/.test(t) && (/「[^」]{2,}」/.test(t) || /(1つ|一つ|に絞|になる|にする|を目指|したい)/.test(t));
    if (/期限/.test(element)) return /(年後|ヶ月|カ月|か月|半年|期限|月末|までに|来年|今年|[0-9０-９]+年|[0-9０-９]+月|週間|マイルストン)/.test(t);
  }
  if (id === "MW-P1-06") { // V5是正: 自責のみ矮小化を撤廃。②自分にできること＋③構造・環境の"両視点"を評価
    const hasEvent = /(失注|リピート|商談|来店|案件|お客|新規|クレーム|契約|受注|予約|提出|締切|遅れ|遅刻|漏れ|ミス|トラブル|未達|失敗|やり直し|キャンセル|対応|報告)/.test(t) && t.length >= 20;
    const hasSelf = /(自分|自責|できていなかった|していなかった|しなかった|打診|持参|次回から|今後は|標準化|確認する|入れ|やめ|始め)/.test(t);
    const hasStructure = /(構造|環境|仕組み|予算|時期|サイクル|競合|市場|体制|制度|状況|外部|近隣|相手の|先方|タイミング)/.test(t);
    if (/出来事が具体的/.test(element)) return hasEvent;
    if (/自責の視点/.test(element)) return hasSelf && hasStructure;
    if (/偏らず|バランス/.test(element)) return hasSelf && hasStructure;
  }
  if (id === "MW-P1-07") { // V5是正: 「言葉定義」型を撤廃。①課題を部署/時間帯/工程で絞る＋②2つの共通点(本質)を検出
    const hasNarrow = /(部署|時間帯|工程|に絞|で絞|絞る|絞り|に限|だけ|のうち)/.test(t);
    const hasCommon = /(共通点|共通する|共通し|共通は)/.test(t);
    if (/練習①②/.test(element)) return hasNarrow && hasCommon;
    if (/範囲を絞/.test(element)) return hasNarrow;
    if (/本質的な性質|構造を捉え/.test(element)) return hasCommon && /(本質|性質|機能|構造|仕組み|蓄積|情報|防げ|決める|につなが|役割|目的|抜け)/.test(t);
  }
  if (id === "MW-P1-08") { // V5是正: 練習B固定を撤廃。A(目的を問う)/B(前提を疑う)/C(他者視点) いずれも許容
    const picked = /(選んだ練習|練習[：:\s]*[ＡＢＣABCａｂｃ]|[ＡＢＣABC][（(]|前提を疑|自分の意見に問|意見を疑|他の立場|目的を問|何のため|相手はどう感じ)/.test(t) &&
      !/(3つとも|三つとも|全部|すべて|全て)/.test(t);
    if (/練習が1つ/.test(element)) return picked;
    if (/自分の仕事・状況/.test(element)) return p1HasReason(t) && /(案件|提案|商談|お客|顧客|カウンセリング|要望|思い込み|突き進|受けて|担当|自分の|準備)/.test(t);
    if (/具体的な場面/.test(element)) return p1HasScene(t);
  }
  return null;
}

// ===== V7.2.4 P2ミニ決定論フロア拡充 =====
// P2ミニの80近傍ブレを、P1と同じくワーク別の決定論フロアで安定合格に。
// v3模範は KGI/KPI/KDI・イシュー・見せかけ指標差し替え等のフレームで書かれ、従来の
// 文字列固定の検知が取りこぼしていた。数値・枠組みを必須（あやか基準と整合）に是正する。
// 未対応要素はnull（=既存の特別処理/汎用フォールバックへ）。
function p2ConcreteMetricCount(t) {
  return (t.match(/件数|フォロワー|接触|予約数?|受注率?|売上|リピート率?|来店|客単価|単価|提案|商談|架電|返信|成約|転換率|粗利|会話できた|有効接触/gi) || []).length;
}
function p2HasConcreteVerification(t) {
  return /(検証|測|試し|試す|確認|見ます|入れ|運用|標準化|回す|差し替え)/.test(t) &&
    (/[0-9０-９]/.test(t) || /(次の|今月|来週|今週|3件|全員|テンプレ|予約|提案|LINE|SNS|架電|商談|リピート)/.test(t));
}
function p2RequirementMet(t, element, payload) {
  const id = payload.miniWorkId || payload.workId || "";
  if (id === "MW-P2-02") {
    if (/自分の仕事に具体的/.test(element)) return /[0-9０-９]/.test(t); // 数値で自業務に落ちている
  }
  if (id === "MW-P2-03") {
    if (/KGIとのつながり|KGI.*つなが/.test(element)) {
      return /(KGI|最終ゴール|売上|契約|目標|成果)/i.test(t) &&
        /(直結|つなが|繋が|繋げ|因果|動かし|作り|になる|関係|影響|優先|近い)/.test(t);
    }
    // V5是正: 具体KPI・追跡状態のフロア未カバー(営72retry)を是正
    if (/具体的なKPIが1つ/.test(element)) return /(KPI|受注件数|受注率|リピート率|客単価|転換率|単価|来店数|提案数|架電|アポ|[0-9０-９]+件|[0-9０-９]+%|[0-9０-９]+％)/.test(t);
    if (/追跡の状態/.test(element)) return /(追え|追跡|集計|台帳|記録|見えて|出せて|レビュー|毎週|毎月|月末|金曜|見直)/.test(t);
  }
  if (id === "MW-P2-04") {
    if (/複数のKPI/.test(element)) return p2ConcreteMetricCount(t) >= 2;
  }
  if (id === "MW-P2-05") {
    if (/課題が1つに絞/.test(element)) return /(課題|イシュー|問題)/.test(t) && /「[^」]{2,}」/.test(t);
  }
  if (id === "MW-P2-06") {
    if (/課題が1つ書かれ/.test(element)) return /(課題|イシュー|問題|失注|事象|なぜ)/.test(t) && /「[^」]{2,}」|なぜ.*[?？]/.test(t);
    if (/検証方法が具体的/.test(element)) return p2HasConcreteVerification(t);
  }
  if (id === "MW-P2-07") { // V5是正: なぜなぜをフロアで判定(事象＋なぜ3段以上＋構造的真因)
    if (/具体的な事象/.test(element)) return /(事象|失敗|うまくいかな|締切|間に合わ|キャンセル|遅れ|漏れ|ミス|トラブル|提出|案件|商談|問題|続く)/.test(t) && t.length >= 15;
    if (/なぜが5回|なぜ.*5/.test(element)) return (t.match(/→/g) || []).length >= 3 || countWhy(t) >= 3 || /なぜ.*なぜ.*なぜ/.test(t) || (t.match(/[①②③④⑤]/g) || []).length >= 3;
    if (/真因/.test(element)) return /(真因|根本原因)/.test(t) && /(仕組み|構造|習慣|テンプレ|型|手順|プロセス|運用|未整備|欠如|未定義|仕組み化|ルール|フロー|組み込)/.test(t);
  }
  if (id === "MW-P2-08") { // V5是正: KPT＋YWTMの5項目とTry・期待効果をフロアで判定(見本は是正済)
    const items5 = /(Keep|続け)/.test(t) && /(Problem|課題|問題)/.test(t) && /(Try|試す)/.test(t) && /やったこと/.test(t) && /(わかったこと|分かったこと)/.test(t) && /(次にやること|次にやる|次の一手)/.test(t);
    if (/5項目が揃/.test(element)) return items5;
    if (/Tryが1つ/.test(element)) return /(Try|次に試す|試すこと)/.test(t) && /(金曜|来週|今週|今日|明日|テンプレ|標準化|追加|日付|必須|まで|[0-9０-９])/.test(t);
    if (/わかったこと/.test(element)) return /(わかったこと|分かったこと)/.test(t) && t.length >= 40;
    if (/MがTry|期待効果/.test(element)) return /(期待|効果|上がる|につながる|に繋がる|向上|リピート率が|転換率が|返信率)/.test(t);
  }
  return null;
}

function miniRequirementMet(answer, element, payload) {
  const text = safeText(element);
  if (!text) return false;

  // V7.2.3 P1決定論フロア拡充: P1ミニはワーク別の必須要素で判定（対応要素のみ）
  if (/^MW-P1-/.test(payload.miniWorkId || payload.workId || "")) {
    const p1 = p1RequirementMet(answer, text, payload);
    if (p1 !== null) return p1;
  }
  // V7.2.4 P2ミニ決定論フロア拡充: 対応要素のみワーク別判定（他は既存処理へ）
  if (/^MW-P2-/.test(payload.miniWorkId || payload.workId || "")) {
    const p2 = p2RequirementMet(answer, text, payload);
    if (p2 !== null) return p2;
  }

  if (payload.miniWorkId === "MW-P2-05") {
    if (/課題.*1つ|課題が1つ/.test(text)) return /(課題|悩み|問題).*(1つ|一つ|テーマ)|1つ.*(課題|悩み|問題)/.test(answer);
    if (/問い|仮説|イシュー/.test(text)) return /(ではないか|ではないか？|か？|か。|なぜ.*か|どうすれば.*か|イシュー)/.test(answer);
    if (/サブイシュー/.test(text)) return /(サブイシュー|まず.*明らか|確認すべき|分解|優先)/.test(answer);
    if (/優先|最初/.test(text)) return /(優先|最初|まず|先に|1番|一番)/.test(answer);
  }
  if (payload.miniWorkId === "MW-P2-08" && (/Try.*1つ|Tryが1つ|1つに絞|次にやること/.test(text))) {
    return hasSingleTryForKptYwtm(answer);
  }
  if (/行動.*1つ|選んだ行動/.test(text) || (/1つに絞/.test(text) && /行動/.test(text))) {
    return hasActionChoice(answer) && !/(全部|すべて|全て|いろいろ|なんでも)/.test(answer);
  }
  if (/理由|根拠|自分の言葉|なぜ/.test(text) && !/なぜ.*5|5回/.test(text)) {
    return hasMiniWorkReason(answer, payload);
  }
  if (/いつ|どこ|場面|具体/.test(text) && !/事象|課題|失敗/.test(text)) {
    return hasMiniWorkSpecificScene(answer, payload);
  }
  if (/複数.*KPI|KPI.*書き出|KPI.*複数/.test(text)) {
    return countKpiMentions(answer) >= 2;
  }
  if (/KGI.*直結|KGI.*整理|KGI.*つなが|直結度/.test(text)) {
    return /(KGI|最終ゴール|成果|売上|契約|目標)/i.test(answer) && /(直結|つなが|繋が|関係|影響|優先|重要|近い)/.test(answer);
  }
  if (/1つに絞|最優先|集中すべき|絞った理由/.test(text)) {
    return /(1つ|一つ|最優先|優先|集中|絞)/.test(answer) && hasMiniWorkReason(answer, payload);
  }
  if (/事象|課題|失敗|うまくいかなかった/.test(text)) {
    return /(事象|課題|失敗|うまくいかな|問題|締切|遅れ|直前|毎回|発生)/.test(answer);
  }
  if (/なぜ.*5|5回/.test(text)) {
    return countWhy(answer) >= 5;
  }
  if (/真因|根本原因|構造|仕組み|習慣/.test(text)) {
    return /(真因|根本原因|仕組み|構造|習慣|運用|ルール|プロセス|日次|毎日|予定|カレンダー)/.test(answer) &&
      !/真因[はが]?(忙しかった|忘れた|やる気|気合|注意不足)/.test(answer);
  }
  if (/数字|数値|指標|KPI|KGI|回|件|率/.test(text)) {
    return /([0-9０-９]+|KPI|KGI|数値|指標|率|件|回)/i.test(answer);
  }

  // V7.1採点是正: 特定マッチャの無い要素のフォールバック。
  //   長さだけで「充足」とすると意見文（例:「頑張れば伸びます」）まで通してしまうため、
  //   実質シグナル（数字・構造マーカー・複数論点）を併せて要求し、フロアの誤通過を防ぐ。
  return answer.length >= 30 && hasSubstanceSignal(answer);
}

// 実質的な中身のシグナル: 数字/構造マーカー/思考フレーム語/複数論点のいずれか。
function hasSubstanceSignal(answer) {
  const text = safeText(answer);
  if (/[0-9０-９]/.test(text)) return true;
  if (/[・→①②③④⑤:：]|１\.|２\.|３\./.test(text)) return true;
  if (/(結論|根拠|事実|理由|なぜ|イシュー|仮説|戦略|戦術|実行|KGI|KPI|KDI|So ?What|Why ?So|頂点|中間|土台)/i.test(text)) return true;
  // 3つ以上の文（句点区切り）に具体名詞が伴うか
  const sentences = text.split(/[。\n]/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length >= 3) return true;
  return false;
}

function hasMiniWorkReason(answer, payload) {
  const text = safeText(answer);
  if (payload?.miniWorkId === "MW-P1-01") {
    return hasP101Reason(text);
  }
  // V7.1採点是正: 理由の言い換えを拡充
  return /(理由は|選んだ理由|なぜなら|目的は|狙いは|背景|必要だと思|必要がある|したいから|と思ったから|ため|ので|から|主因|直結|効く|効果|優先|費用対効果|影響|近い|削っ|削る|ボトルネック|繋がる|つながる|重要|狙|注力|回避|防ぐ|課題|困って|促進|定着|維持|継続|因果|向上|獲得|強化|習慣|高め|下げ|再設計)/.test(text);
}

function hasP101Reason(answer) {
  const text = safeText(answer);
  if (/(明日から|今日から|朝から|会社から|学校から|職場から|出社してから|来週から)/.test(text) && !/(ため|ので|なぜなら|理由は|選んだ理由|目的は|狙いは|したいから|と思ったから)/.test(text)) {
    return false;
  }
  return /(理由は|選んだ理由|なぜなら|目的は|狙いは|ため|ので|したいから|と思ったから|話しかけやす|信頼|雰囲気|きっかけ|報連相しやす|質問しやす|接点|関係を作|土台)/.test(text);
}

function hasP101Audience(answer) {
  return /(上司|同僚|チーム|メンバー|顧客|お客様|研修参加者|新人|先輩|後輩|相手|担当者|参加者)/.test(answer);
}

function hasP101Timing(answer) {
  return /(出社|朝礼|始業|会議|商談|研修|Slack|LINE|メール|最初の連絡|朝、|朝に|朝の|明日の朝|午前|午後|[0-9０-９]+時)/.test(answer);
}

function hasP101How(answer) {
  return /(自分から|先に|名前|笑顔|目を見|声をかけ|おはよう|一言|最初の一言|挨拶をする|挨拶します|着手|中間|完了|枕言葉|頷|うなず)/.test(answer);
}

function hasSingleTryForKptYwtm(answer) {
  const text = safeText(answer);
  if (/(Tryはこれ1つ|Tryは1つ|Tryは一つ|次にやることも同じ|同じTry|同じＴｒｙ|YWTMで深掘り|1つに絞)/i.test(text)) {
    return true;
  }
  const tryMentions = (text.match(/Try|Ｔｒｙ|次にやること|次やること|T[:：]/gi) || []).length;
  const actionSegments = text
    .split(/[。\n]/)
    .filter((line) => /(Try|Ｔｒｙ|次にやること|次やること|T[:：])/.test(line))
    .map((line) => line.replace(/(KPT|YWTM|Try|Ｔｒｙ|次にやること|次やること|T[:：]|同じ|深掘り|として|は|も|を|する|します|。|、|\s)/gi, ""))
    .filter(Boolean);
  if (actionSegments.length <= 1 && tryMentions >= 1) return true;
  if (actionSegments.length === 2) {
    return actionSegments[0].includes(actionSegments[1]) || actionSegments[1].includes(actionSegments[0]);
  }
  return false;
}

function isMiniWorkReviewAllowed(source, flags, payload, supportRequested) {
  if (supportRequested) return true;
  if (payload.submissionCount >= payload.maxRetryBeforeReview) return true;
  if (flags.aiError || flags.policyWarning) return true;
  if (!flags.needsHumanReview) return false;
  const reviewReason = [
    source.reason,
    source.summary,
    source.reviewReason,
    source.review_reason,
    source.feedback?.summary
  ].map((value) => safeText(value)).join(" ");
  return /(判定できない|判断困難|安全|センシティブ|個人情報|ハラスメント|違法|自傷|危険|人の確認)/.test(reviewReason);
}

function isSupportRequested(answer) {
  const normalized = safeText(answer);
  if (/(相談され|相談された|相談されました|と言われ|と言っていた|と言われた|確認できませんでした|確認できなかった|聞けていませんでした|聞けませんでした|聞けていない|分からない状態を解消したい|わからない状態を解消したい)/.test(normalized)) {
    return false;
  }
  if (/(相談したい|相談したいです|相談させてください|担当者に相談|サポートしてほしい|サポートしてください|一緒に確認してほしい|一緒に確認してください|助けてください|自分では進められません|一人では進められません|一人では難しいので相談|分からないので相談したい|わからないので相談したい|どうしていいか分からないので相談)/.test(normalized)) {
    return true;
  }
  if (!/不安/.test(normalized)) return false;
  if (/(不安にさせない|不安を与えない|不安にしない|不安を減ら|不安を解消|不安なく|不安にさせたくない)/.test(normalized)) {
    return false;
  }
  return /(不安なので相談したい|不安だから相談したい|不安で進められません|不安なのでサポートしてほしい|不安なので一緒に確認してほしい)/.test(normalized);
}

function hasCriticalMiniWorkFlags(flags) {
  return Boolean(flags.aiError || flags.policyWarning || flags.needsSupport);
}

function miniWorkRetryMessage(payload, assessment) {
  if (payload?.isMiniWork) {
    if (payload.miniWorkId === "MW-P1-01") {
      return "なぜその行動を選ぶのか、誰にどの場面でどう行うのかを1つ足してください。";
    }
    return assessment?.unmetCriteria?.[0] || "このワークのA基準に足りない要素を1〜2点足してください。";
  }
  return "具体的な場面・数字・判断理由をもう一段足してください。";
}

function miniWorkFollowupQuestion(assessment, payload = {}) {
  if (payload?.miniWorkId === "MW-P1-01") {
    return "誰に、どの場面で、なぜその行動を選ぶのかを補足してください。";
  }
  const focus = assessment?.unmetCriteria?.[0] || "A基準に足りない要素";
  return `${focus}について、あなたの実際の状況に合わせてもう少し補足してください。`;
}

function workFollowupQuestion(assessment) {
  const focus = assessment?.unmetCriteria?.[0] || "W別A基準に足りない要素";
  return `${focus}について、あなたの実際の業務・数字・判断理由に合わせて補足してください。`;
}

function isThinMiniWorkAnswer(answer) {
  const normalized = safeText(answer);
  return normalized.length < 8 ||
    /^(あ|テスト|test|なし|特になし|特にない|未定|頑張ります|がんばります|意識します|やります|しっかりやります|改善します|分かりました|わかりました)。?$/i.test(normalized);
}

function isMiniWorkSelectionAbandoned(answer, payload) {
  if (payload.miniWorkId === "MW-P1-01") {
    // V7.2.3: 「N件すべてで実行」等の具体行動を選択放棄と誤検知しない（クオート行動/件数があれば放棄でない）
    if (/「[^」]{2,}」/.test(answer) || /[0-9０-９]+\s*件/.test(answer)) return false;
    return /(全部|すべて|全て).*(大事|重要|やります|します)|頑張ります/.test(answer) &&
      !/(1つ|一つ|報連相|挨拶|枕言葉|頷|笑顔|拾う)/.test(answer.replace(/全部/g, ""));
  }
  return /^(全部|すべて|全て).*(やります|します)。?$/.test(answer);
}

function hasActionChoice(answer) {
  // V7.1採点是正: 行動語の同義語を拡充（app.js validateMiniWorkAnswer と同期）
  return /(挨拶|枕言葉|報連相|着手|中間|完了|頷|笑顔|拾う|記録|確認|聞く|伝える|試す|実行|選び|選ぶ|やる|行う|充て|充当|回す|回し|据え|繋げ|繋ぐ|つなげ|つなぐ|振り分け|購入|特定|分ける|分け|片付け|整え|整理|見送|やらない|差し替え|登壇|送信|送る|渡す|作る|作成|進め|活用|導入|徹底|標準化|仕組み化|棚卸|添付|提示|提案|検証|割り当て|割く|設定|決め|見直|共有|使う|測る|比べ|分解|相談|改善)/.test(answer);
}

function hasMiniWorkSpecificScene(answer, payload) {
  if (payload.miniWorkId === "MW-P1-01") {
    if (/明日から仕事の時|仕事の時|業務中|普段から|日頃から|明日の朝から会社で/.test(answer)) return false;
    return hasP101Audience(answer) && hasP101Timing(answer) && hasP101How(answer);
  }
  return hasSpecificScene(answer);
}

function hasSpecificScene(answer) {
  return /(今日|明日|今朝|朝|昼|夕方|午前|午後|[0-9０-９]+時|会議|商談|研修|朝礼|週次|日次|チーム|上司|顧客|提出|報告|連絡|Slack|LINE|メール|カレンダー)/.test(answer);
}

function countKpiMentions(answer) {
  const normalized = answer.replace(/[、。]/g, " ");
  const explicitCount = (normalized.match(/KPI/gi) || []).length;
  const listedItems = normalized
    .split(/[,\n／/・、]/)
    .map((item) => item.trim())
    .filter((item) => /(率|数|件|時間|回|商談|提案|契約|返信|提出|売上|粗利)/.test(item)).length;
  return Math.max(explicitCount, listedItems);
}

function countWhy(answer) {
  return (answer.match(/なぜ[0-9０-９一二三四五]?|なぜなら|理由[0-9０-９一二三四五]?/g) || []).length;
}

function hasMiniWorkAttempt(answer, payload) {
  if (payload.miniWorkId === "MW-P2-07") return /(なぜ|真因|事象|課題|失敗)/.test(answer);
  if (payload.miniWorkId === "MW-P2-04") return /(KPI|KGI|指標|絞|優先)/i.test(answer);
  return hasActionChoice(answer) || hasSpecificScene(answer);
}

function normalizeStatus(value) {
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

function normalizeCriteria(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(CRITERIA_KEYS.map((key) => [key, clampScore(source[key])]));
}

function normalizeRubricPayload(value = []) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item, index) => {
      const source = item && typeof item === "object" ? item : {};
      const grade = normalizeAbcGrade(
        source.grade || source.abcGrade || source.abc_grade,
        "",
        index === 0 ? 90 : index === 1 ? 70 : 40
      );
      return {
        grade,
        label: safeText(source.label || rubricLabel(grade)),
        criteria: safeText(source.criteria || source.text || "")
      };
    })
    .filter((item) => item.grade && item.criteria)
    .slice(0, 3);
}

function normalizeWorkKnowledge(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    workId: safeText(source.workId || source.work_id || ""),
    title: safeText(source.title || ""),
    workGoal: safeText(source.workGoal || source.work_goal || ""),
    passRequiredElements: asArray(source.passRequiredElements || source.pass_required_elements),
    aCriteria: asArray(source.aCriteria || source.a_criteria),
    bCriteria: asArray(source.bCriteria || source.b_criteria),
    cCriteria: asArray(source.cCriteria || source.c_criteria),
    commonMisconceptions: asArray(source.commonMisconceptions || source.common_misconceptions),
    modelAnswerChecklist: asArray(source.modelAnswerChecklist || source.model_answer_checklist),
    badAnswerPatterns: asArray(source.badAnswerPatterns || source.bad_answer_patterns),
    modelAnswerExample: safeText(source.modelAnswerExample || source.model_answer_example || "")
  };
}

function buildRubricFromWorkKnowledge(knowledge = {}) {
  const items = [
    ["A", knowledge.aCriteria],
    ["B", knowledge.bCriteria],
    ["C", knowledge.cCriteria]
  ];
  return items
    .map(([grade, list]) => ({
      grade,
      label: rubricLabel(grade),
      criteria: asArray(list).join(" / ")
    }))
    .filter((item) => item.criteria);
}

function normalizeAbcGrade(value, status = "", score = 0) {
  const grade = String(value || "").trim().toUpperCase();
  if (["A", "B", "C"].includes(grade)) return grade;
  return abcGradeForScore(status, score);
}

function abcGradeForScore(status, score) {
  if (status === "pass") return "A";
  if (Number(score) >= 60) return "B";
  return "C";
}

function rubricLabel(grade) {
  if (grade === "A") return "よくできました";
  if (grade === "B") return "もう一歩";
  return "再挑戦しよう";
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => safeText(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function limitArray(value, limit) {
  return asArray(value).slice(0, limit);
}

function uniqueArray(value) {
  const seen = new Set();
  return asArray(value).filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeErrorType(error) {
  const message = String(error && error.message || error || "");
  if (message.includes("timeout")) return "openai_timeout";
  if (message.includes("validation")) return "validation_error";
  if (message.includes("JSON") || message.includes("invalid_json")) return "invalid_json";
  if (message.includes("missing_api_key")) return "missing_api_key";
  return "openai_error";
}

function safeErrorMessage(errorType) {
  const messages = {
    missing_api_key: "AI判定設定が未完了です。",
    validation_error: "入力内容を確認してください。",
    openai_timeout: "AI判定が時間内に完了しませんでした。",
    invalid_json: "AI判定結果の整形に失敗しました。",
    openai_error: "AI判定に一時的な問題が発生しました。"
  };
  return messages[errorType] || messages.openai_error;
}

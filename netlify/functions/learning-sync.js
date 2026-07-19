const {
  appendValues,
  columnName,
  createSheet,
  findHeaderIndex,
  getSpreadsheetMetadata,
  getValues,
  isValidEmail,
  normalizeEmailKey,
  normalizeHeader,
  quoteSheetName,
  updateValues
} = require("./_sheets");

// ai_evaluation_logs / staff_feedback_queue のヘッダ（spreadsheetTabs 定義に一致）。
// タブが無い場合はこのヘッダで新規作成する。
const AI_EVALUATION_LOG_HEADERS = [
  "log_id", "request_id", "session_id", "user_id", "email_normalized", "common_profile_json",
  "work_id", "work_title", "stage", "hearing_history_json", "answer_text", "prompt_text",
  "request_payload_json", "response_json", "score", "status", "unmet_criteria_json",
  "next_action", "staff_feedback_recommended", "error_message", "created_at", "updated_at"
];
const STAFF_FEEDBACK_QUEUE_HEADERS = [
  "queue_id", "session_id", "user_id", "email_normalized", "work_id", "work_title",
  "status", "score", "trigger_status", "message", "reason", "created_at", "updated_at"
];
const AI_EVALUATION_LOG_FIELDS = {
  logId: ["log_id"], requestId: ["request_id"], sessionId: ["session_id"], userId: ["user_id"],
  emailKey: ["email_normalized", "email_key", "email"], commonProfileJson: ["common_profile_json"],
  workId: ["work_id"], workTitle: ["work_title"], stage: ["stage"], hearingHistoryJson: ["hearing_history_json"],
  answerText: ["answer_text"], promptText: ["prompt_text"], requestPayloadJson: ["request_payload_json"],
  responseJson: ["response_json"], score: ["score"], status: ["status"], unmetCriteriaJson: ["unmet_criteria_json"],
  nextAction: ["next_action"], staffFeedbackRecommended: ["staff_feedback_recommended"], errorMessage: ["error_message"],
  createdAt: ["created_at"], updatedAt: ["updated_at"]
};
const STAFF_FEEDBACK_QUEUE_FIELDS = {
  queueId: ["queue_id"], sessionId: ["session_id"], userId: ["user_id"],
  emailKey: ["email_normalized", "email_key", "email"], workId: ["work_id"], workTitle: ["work_title"],
  status: ["status"], score: ["score"], triggerStatus: ["trigger_status"], message: ["message"],
  reason: ["reason"], createdAt: ["created_at"], updatedAt: ["updated_at"]
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const ACTIONS = new Set([
  "getLearningState",
  "restoreLearningState",
  "markVideoWatched",
  "submitMiniWork",
  "submitWork",
  "submitAiWorkAnswer",
  "submitAiWorkFollowup",
  "submitAiWorkRevision",
  "submitAiWorkIntakeFollowup",
  "startAiWork",
  "continueAiWorkWithIntakePlaceholders",
  "retryAiWork"
]);

const EMAIL_HEADERS = ["email_key", "email_normalized", "email", "mail", "メール", "メールアドレス", "登録メールアドレス"];
const REGISTRATION_EMAIL_HEADERS = ["email_key", "email", "mail", "メール", "メールアドレス", "登録メール", "登録メールアドレス"];
const REGISTRATION_STATUS_HEADERS = ["account_status", "status", "ステータス", "状態", "受講状態"];
const REGISTRATION_NAME_HEADERS = ["display_name", "name", "氏名", "名前", "お名前", "受講者名"];
const REGISTRATION_STAFF_HEADERS = ["担当者", "staff", "owner"];
const ACTIVE_VALUES = new Set(["", "active", "有効", "受講中", "登録済み", "利用中", "enabled", "ok"]);

const VIDEO_LOG_FIELDS = {
  logId: ["log_id", "event_id"],
  eventId: ["event_id", "client_event_id"],
  createdAt: ["created_at", "作成日時"],
  emailKey: EMAIL_HEADERS,
  email: ["メールアドレス", "email"],
  name: ["氏名", "名前", "お名前"],
  videoId: ["video_id", "lesson_id", "動画ID", "動画id"],
  lessonId: ["lesson_id"],
  videoTitle: ["video_title", "動画タイトル", "動画名"],
  category: ["category", "カテゴリ"],
  status: ["status", "video_status", "視聴ステータス", "ステータス"],
  isLatest: ["is_latest", "latest", "最新"],
  viewedAt: ["viewed_at", "視聴日時"],
  completedAt: ["completed_at", "完了日時"],
  source: ["source", "流入元"],
  updatedAt: ["updated_at", "更新日時"],
  memo: ["memo", "メモ"]
};

const PROGRESS_SUMMARY_FIELDS = {
  emailKey: EMAIL_HEADERS,
  email: ["メールアドレス", "email"],
  name: ["氏名", "名前", "お名前"],
  staff: ["担当者", "staff"],
  overallStatus: ["全体解説ステータス"],
  currentVideoId: ["現在の動画ID", "video_id", "lesson_id"],
  currentVideoName: ["現在の動画名", "video_title"],
  nextVideoId: ["次に見る動画ID", "next_video_id"],
  lastViewedAt: ["最終視聴日時", "last_viewed_at", "completed_at"],
  stalledDays: ["停滞日数"],
  nextFollowDate: ["次回フォロー日"],
  memo: ["メモ", "memo"],
  updatedAt: ["更新日時", "updated_at"]
};

const ANSWER_LOG_FIELDS = {
  submissionId: ["submission_id", "client_submission_id"],
  createdAt: ["created_at", "作成日時"],
  submittedAt: ["submitted_at", "提出日時"],
  emailKey: EMAIL_HEADERS,
  email: ["メールアドレス", "email"],
  name: ["氏名", "名前", "お名前"],
  workId: ["work_id", "target_id", "ワークID", "ワークid"],
  miniWorkId: ["mini_work_id", "ミニワークID", "ミニワークid"],
  lessonId: ["lesson_id", "動画ID", "動画id"],
  workTitle: ["work_title", "ワーク名", "現在のワーク名"],
  workType: ["work_type", "target_type", "種別"],
  answerText: ["answer_text", "answer_body", "answer", "回答本文", "回答"],
  questionText: ["question_text_疑問文", "question_text", "設問"],
  status: ["status", "ui_status", "result_status", "latest_status", "最新ステータス", "ステータス"],
  abcGrade: ["abc_grade", "最新A/B/C", "abc"],
  score: ["score", "最新点数"],
  summary: ["summary_総評", "summary", "総評"],
  needsFollowup: ["needs_followup"],
  retryCount: ["retry_count"],
  feedbackJson: ["feedback_json"],
  evaluationJson: ["evaluation_json", "response_json", "ai_response_json", "ai_return_json", "AI返却JSON"],
  isLatest: ["is_latest", "latest", "最新"],
  aiLogId: ["ai_log_id"],
  updatedAt: ["updated_at", "更新日時"]
};

const WORK_SUMMARY_FIELDS = {
  emailKey: EMAIL_HEADERS,
  email: ["メールアドレス", "email"],
  name: ["氏名", "名前", "お名前"],
  staff: ["担当者", "staff"],
  currentWorkId: ["現在のワークID", "work_id"],
  currentWorkName: ["現在のワーク名", "work_title"],
  latestStatus: ["最新ステータス", "status"],
  latestAbc: ["最新A/B/C", "abc_grade", "abc"],
  latestScore: ["最新点数", "score"],
  incompleteWorks: ["未完了ワーク"],
  staffReviewRequired: ["担当者確認要否"],
  lastSubmittedAt: ["最終提出日時", "submitted_at"],
  memo: ["メモ", "memo"],
  updatedAt: ["更新日時", "updated_at"]
};

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return response(204, {});
    if (event.httpMethod !== "POST") return response(405, { ok: false, reason: "method_not_allowed" });

    const request = parseRequestBody(event);
    const action = String(request.action || "").trim();
    if (!ACTIONS.has(action)) {
      return response(400, { ok: false, reason: "invalid_action", message: "Unsupported learning sync action." });
    }

    const payload = request.payload || {};
    const emailKey = normalizeEmailKey(payload.email_key || payload.email || payload.email_normalized);
    if (!isValidEmail(emailKey)) {
      return response(400, { ok: false, reason: "invalid_email", message: "メールアドレスの形式を確認してください。" });
    }

    if (String(process.env.BARISE_LEARNING_SYNC_USE_MOCK || "").toLowerCase() === "true") {
      return response(200, {
        ok: true,
        action,
        email_key: emailKey,
        mock: true,
        warnings: [],
        restored: { progress: [], submissions: [], evaluationResults: [], aiWorkSessions: [], clearedTargets: [] }
      });
    }

    const config = syncConfig();
    const registration = await authenticateRegistration(emailKey, config);
    const context = {
      action,
      payload,
      emailKey,
      registration,
      config,
      warnings: [],
      now: new Date().toISOString()
    };

    let result;
    if (action === "getLearningState" || action === "restoreLearningState") {
      result = await restoreLearningState(context);
    } else if (action === "markVideoWatched") {
      result = await syncVideoWatched(context);
    } else {
      result = await syncWorkSubmission(context);
    }

    return response(200, {
      ok: true,
      action,
      email_key: emailKey,
      ...result,
      warnings: context.warnings
    });
  } catch (error) {
    return response(error.statusCode || 500, {
      ok: false,
      reason: error.code || "learning_sync_error",
      message: safeMessage(error)
    });
  }
};

function syncConfig() {
  return {
    registrationSpreadsheetId: process.env.BARISE_REGISTRATION_SPREADSHEET_ID || process.env.SPREADSHEET_ID || "",
    registrationSheetName: process.env.BARISE_REGISTRATION_SHEET_NAME || "登録情報一覧",
    progressSpreadsheetId: process.env.BARISE_PROGRESS_SPREADSHEET_ID || process.env.SPREADSHEET_ID || "",
    progressSummarySheetName: process.env.BARISE_PROGRESS_SUMMARY_SHEET_NAME || "_進捗サマリー",
    videoLogSheetName: process.env.BARISE_VIDEO_LOG_SHEET_NAME || "_視聴ログ_all",
    workSpreadsheetId: process.env.BARISE_WORK_SPREADSHEET_ID || process.env.SPREADSHEET_ID || "",
    workSummarySheetName: process.env.BARISE_WORK_SUMMARY_SHEET_NAME || "_ワークサマリー",
    workLogSheetName: process.env.BARISE_WORK_LOG_SHEET_NAME || "_回答ログ_all",
    aiEvaluationLogSheetName: process.env.BARISE_AI_EVAL_LOG_SHEET_NAME || "ai_evaluation_logs",
    staffFeedbackQueueSheetName: process.env.BARISE_STAFF_FEEDBACK_QUEUE_SHEET_NAME || "staff_feedback_queue"
  };
}

async function authenticateRegistration(emailKey, config) {
  const sheet = await readSheet(config.registrationSpreadsheetId, config.registrationSheetName);
  const emailIndex = findHeaderIndex(sheet.headers, REGISTRATION_EMAIL_HEADERS);
  const statusIndex = findHeaderIndex(sheet.headers, REGISTRATION_STATUS_HEADERS);
  const nameIndex = findHeaderIndex(sheet.headers, REGISTRATION_NAME_HEADERS);
  const staffIndex = findHeaderIndex(sheet.headers, REGISTRATION_STAFF_HEADERS);

  if (emailIndex < 0) throw httpError(500, "registration_email_column_missing", "登録情報のメール列を確認してください。");

  for (const rowRef of sheet.rowRefs) {
    const rowEmail = normalizeEmailKey(rowRef.row[emailIndex]);
    if (!isValidEmail(rowEmail) || rowEmail !== emailKey) continue;
    const rawStatus = statusIndex >= 0 ? String(rowRef.row[statusIndex] || "").trim().toLowerCase() : "";
    if (!ACTIVE_VALUES.has(rawStatus)) {
      throw httpError(403, "inactive", "このメールアドレスは現在利用できません。");
    }
    return {
      email: emailKey,
      displayName: nameIndex >= 0 ? String(rowRef.row[nameIndex] || "").trim() : "",
      staff: staffIndex >= 0 ? String(rowRef.row[staffIndex] || "").trim() : ""
    };
  }

  throw httpError(404, "not_found", "登録情報が見つかりませんでした。");
}

async function syncVideoWatched(context) {
  const { payload, config, warnings, now } = context;
  const watchedAt = payload.watchedAt || payload.watched_at || now;
  const videoId = String(payload.videoId || payload.video_id || payload.lessonId || payload.lesson_id || "").trim();
  const lessonId = String(payload.lessonId || payload.lesson_id || videoId).trim();
  if (!videoId) throw httpError(400, "missing_video_id", "videoId is required.");

  const videoLog = await readSheet(config.progressSpreadsheetId, config.videoLogSheetName);
  if (isDuplicateEvent(videoLog, payload.clientEventId || payload.client_event_id || payload.event_id, ["event_id", "client_event_id", "log_id"])) {
    return { idempotent: true, affected: [] };
  }

  await clearLatestFlag({
    spreadsheetId: config.progressSpreadsheetId,
    sheet: videoLog,
    emailKey: context.emailKey,
    targetAliases: ["video_id", "lesson_id", "動画ID", "動画id"],
    targetValue: videoId,
    warnings
  });

  const eventId = payload.clientEventId || payload.client_event_id || createId("VID");
  const values = {
    logId: eventId,
    eventId,
    createdAt: now,
    emailKey: context.emailKey,
    email: context.emailKey,
    name: context.registration.displayName,
    videoId,
    lessonId,
    videoTitle: payload.videoTitle || payload.video_title || "",
    category: payload.category || "video",
    status: "watched",
    isLatest: "TRUE",
    viewedAt: watchedAt,
    completedAt: watchedAt,
    source: "web",
    updatedAt: now,
    memo: ""
  };
  await appendRow(config.progressSpreadsheetId, videoLog, VIDEO_LOG_FIELDS, values);

  const progressSummary = await readSheet(config.progressSpreadsheetId, config.progressSummarySheetName);
  await upsertByEmail({
    spreadsheetId: config.progressSpreadsheetId,
    sheet: progressSummary,
    fieldMap: PROGRESS_SUMMARY_FIELDS,
    emailKey: context.emailKey,
    values: {
      emailKey: context.emailKey,
      email: context.emailKey,
      name: context.registration.displayName,
      staff: context.registration.staff,
      overallStatus: lessonId === "P1-00" || videoId === "P1-00" ? "watched" : undefined,
      currentVideoId: videoId,
      currentVideoName: payload.videoTitle || payload.video_title || "",
      lastViewedAt: watchedAt,
      updatedAt: now
    }
  });

  await appendToOptionalTab({
    spreadsheetId: config.progressSpreadsheetId,
    sheetName: `動画_${videoId}`,
    fieldMap: VIDEO_LOG_FIELDS,
    values,
    warnings
  });

  return {
    affected: [
      { sheetName: config.videoLogSheetName, action: "append" },
      { sheetName: config.progressSummarySheetName, action: "upsert" }
    ]
  };
}

async function syncWorkSubmission(context) {
  const { payload, config, warnings, now, action } = context;
  const submittedAt = payload.submittedAt || payload.submitted_at || now;
  const workId = String(payload.workId || payload.work_id || payload.miniWorkId || payload.mini_work_id || "").trim();
  if (!workId) throw httpError(400, "missing_work_id", "workId is required.");

  const workType = normalizeWorkType(payload.workType || payload.work_type || payload.target_type || action);
  const answerLog = await readSheet(config.workSpreadsheetId, config.workLogSheetName);
  const submissionId = payload.clientSubmissionId || payload.client_submission_id || payload.submission_id || createId("SUB");
  if (isDuplicateEvent(answerLog, submissionId, ["submission_id", "client_submission_id"])) {
    return { idempotent: true, affected: [] };
  }

  await clearLatestFlag({
    spreadsheetId: config.workSpreadsheetId,
    sheet: answerLog,
    emailKey: context.emailKey,
    targetAliases: ["work_id", "target_id", "ワークID", "ワークid", "mini_work_id"],
    targetValue: workId,
    warnings
  });

  const evaluation = normalizeEvaluation(payload.evaluation || payload.aiEvaluation || payload.ai_evaluation || {});
  const answerValues = {
    submissionId,
    createdAt: now,
    submittedAt,
    emailKey: context.emailKey,
    email: context.emailKey,
    name: context.registration.displayName,
    workId,
    miniWorkId: payload.miniWorkId || payload.mini_work_id || (workId.startsWith("MW-") ? workId : ""),
    lessonId: payload.lessonId || payload.lesson_id || "",
    workTitle: payload.workTitle || payload.work_title || "",
    workType,
    answerText: payload.answerText || payload.answer_text || "",
    questionText: payload.questionText || payload.question_text || "",
    status: evaluation.status || payload.status || "",
    abcGrade: evaluation.abcGrade || "",
    score: evaluation.score ?? "",
    summary: evaluation.summary || evaluation.reason || "",
    needsFollowup: evaluation.needsFollowup ? "TRUE" : "FALSE",
    retryCount: payload.retryCount || payload.retry_count || evaluation.retryCount || "",
    feedbackJson: safeJson(evaluation.feedback || {}),
    evaluationJson: safeJson(evaluation.raw || evaluation),
    isLatest: "TRUE",
    aiLogId: payload.aiLogId || payload.ai_log_id || "",
    updatedAt: now
  };
  await appendRow(config.workSpreadsheetId, answerLog, ANSWER_LOG_FIELDS, answerValues);

  const workSummary = await readSheet(config.workSpreadsheetId, config.workSummarySheetName);
  await upsertByEmail({
    spreadsheetId: config.workSpreadsheetId,
    sheet: workSummary,
    fieldMap: WORK_SUMMARY_FIELDS,
    emailKey: context.emailKey,
    values: {
      emailKey: context.emailKey,
      email: context.emailKey,
      name: context.registration.displayName,
      staff: context.registration.staff,
      currentWorkId: workId,
      currentWorkName: payload.workTitle || payload.work_title || "",
      latestStatus: evaluation.status || payload.status || "",
      latestAbc: evaluation.abcGrade || "",
      latestScore: evaluation.score ?? "",
      staffReviewRequired: evaluation.needsSupport || evaluation.needsHumanReview ? "TRUE" : "FALSE",
      lastSubmittedAt: submittedAt,
      updatedAt: now
    }
  });

  await appendToOptionalTab({
    spreadsheetId: config.workSpreadsheetId,
    sheetName: workId,
    fieldMap: ANSWER_LOG_FIELDS,
    values: answerValues,
    warnings
  });

  // 本ワークのAI評価ログ＋担当者フィードバックキューをSheetsへ永続化
  const persisted = await persistWorkFeedback(context, answerValues);

  const affected = [
    { sheetName: config.workLogSheetName, action: "append" },
    { sheetName: config.workSummarySheetName, action: "upsert" }
  ];
  if (persisted.aiEvaluationLog) affected.push({ sheetName: config.aiEvaluationLogSheetName, action: "append" });
  if (persisted.staffFeedbackQueue) affected.push({ sheetName: config.staffFeedbackQueueSheetName, action: "append" });

  return { affected, persisted };
}

async function restoreLearningState(context) {
  const { config, emailKey, warnings, now } = context;
  const videoLog = await readSheet(config.progressSpreadsheetId, config.videoLogSheetName);
  const answerLog = await readSheet(config.workSpreadsheetId, config.workLogSheetName);
  const workSummary = await readSheet(config.workSpreadsheetId, config.workSummarySheetName);
  const videoState = restoreVideoState(videoLog, emailKey, now);
  const workState = restoreWorkState(answerLog, workSummary, emailKey, now);

  warnings.push(...videoState.warnings, ...workState.warnings);

  return {
    affected: [
      { sheetName: config.videoLogSheetName, action: "read" },
      { sheetName: config.workLogSheetName, action: "read" },
      { sheetName: config.workSummarySheetName, action: "read" }
    ],
    restored: {
      progress: [...videoState.progress, ...workState.progress],
      submissions: workState.submissions,
      evaluationResults: workState.evaluationResults,
      aiWorkSessions: workState.aiWorkSessions,
      clearedTargets: [...videoState.clearedTargets, ...workState.clearedTargets],
      restoredAt: now
    }
  };
}

function restoreVideoState(sheet, emailKey, now) {
  const warnings = [];
  const clearedTargets = [];
  const emailIndex = findHeaderIndex(sheet.headers, EMAIL_HEADERS);
  const lessonIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.lessonId);
  const videoIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.videoId);
  const statusIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.status);
  const viewedIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.viewedAt);
  const completedIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.completedAt);
  const updatedIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.updatedAt);
  const createdIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.createdAt);
  const latestIndex = findHeaderIndex(sheet.headers, VIDEO_LOG_FIELDS.isLatest);

  if (emailIndex < 0 || (lessonIndex < 0 && videoIndex < 0)) {
    warnings.push({ sheetName: sheet.sheetName, warning: "restore_video_columns_missing" });
    return { progress: [], clearedTargets, warnings };
  }

  const groups = new Map();
  sheet.rowRefs.forEach((rowRef) => {
    if (normalizeEmailKey(rowRef.row[emailIndex]) !== emailKey) return;
    const lessonId = String(rowRef.row[lessonIndex >= 0 ? lessonIndex : videoIndex] || "").trim();
    const videoId = String(rowRef.row[videoIndex >= 0 ? videoIndex : lessonIndex] || lessonId).trim();
    if (!lessonId && !videoId) return;
    const key = lessonId || videoId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ rowRef, lessonId: lessonId || videoId, videoId: videoId || lessonId });
  });

  const progress = [];
  groups.forEach((rows, key) => {
    const selected = selectLatestRow(rows, sheet.headers, latestIndex, [updatedIndex, completedIndex, viewedIndex, createdIndex]);
    if (!selected) {
      clearedTargets.push({ target_type: "video", lesson_id: key, video_id: key });
      return;
    }
    const row = selected.rowRef.row;
    const status = String(statusIndex >= 0 ? row[statusIndex] || "" : "").trim().toLowerCase();
    const watchedAt = firstValue(row, [completedIndex, viewedIndex, updatedIndex, createdIndex]);
    const watched = status === "watched" || status === "視聴済み" || Boolean(watchedAt);
    progress.push({
      lesson_id: selected.lessonId,
      video_id: selected.videoId,
      video_status: watched ? "watched" : "not_started",
      updated_at: watchedAt || now,
      source: "sheets"
    });
  });

  return { progress, clearedTargets, warnings };
}

function restoreWorkState(answerLog, workSummary, emailKey, now) {
  const warnings = [];
  const emailIndex = findHeaderIndex(answerLog.headers, EMAIL_HEADERS);
  const workIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.workId);
  const miniIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.miniWorkId);
  const lessonIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.lessonId);
  const typeIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.workType);
  const statusIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.status);
  const scoreIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.score);
  const abcIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.abcGrade);
  const answerIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.answerText);
  const submittedIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.submittedAt);
  const updatedIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.updatedAt);
  const latestIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.isLatest);
  const submissionIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.submissionId);
  const titleIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.workTitle);
  const summaryIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.summary);
  const feedbackIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.feedbackJson);
  const evaluationIndex = findHeaderIndex(answerLog.headers, ANSWER_LOG_FIELDS.evaluationJson);

  if (emailIndex < 0 || (workIndex < 0 && miniIndex < 0)) {
    warnings.push({ sheetName: answerLog.sheetName, warning: "restore_answer_columns_missing" });
    return { progress: [], submissions: [], evaluationResults: [], aiWorkSessions: [], clearedTargets: [], warnings };
  }

  const groups = new Map();
  answerLog.rowRefs.forEach((rowRef) => {
    if (normalizeEmailKey(rowRef.row[emailIndex]) !== emailKey) return;
    const explicitMiniId = String(miniIndex >= 0 ? rowRef.row[miniIndex] || "" : "").trim();
    const workId = String(workIndex >= 0 ? rowRef.row[workIndex] || "" : explicitMiniId).trim();
    const targetId = explicitMiniId || workId;
    if (!targetId) return;
    const key = targetId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ rowRef, targetId, workId, miniWorkId: explicitMiniId });
  });

  const progress = [];
  const submissions = [];
  const evaluationResults = [];
  const aiWorkSessions = [];
  const clearedTargets = [];

  groups.forEach((rows, key) => {
    const selected = selectLatestRow(rows, answerLog.headers, latestIndex, [updatedIndex, submittedIndex]);
    const sample = rows[0];
    const sampleType = normalizeRestoredWorkType(firstValue(sample.rowRef.row, [typeIndex]), sample.targetId);
    if (!selected) {
      clearedTargets.push({
        target_type: sampleType === "mini_work" ? "mini_work" : "work",
        target_id: sample.targetId,
        work_id: sample.workId,
        mini_work_id: sample.miniWorkId,
        lesson_id: firstValue(sample.rowRef.row, [lessonIndex])
      });
      return;
    }

    const row = selected.rowRef.row;
    const workType = normalizeRestoredWorkType(firstValue(row, [typeIndex]), selected.targetId);
    const workId = selected.workId || selected.targetId;
    const miniWorkId = selected.miniWorkId || (workType === "mini_work" ? selected.targetId : "");
    const targetId = miniWorkId || workId;
    const lessonId = firstValue(row, [lessonIndex]);
    const submittedAt = firstValue(row, [submittedIndex, updatedIndex]) || now;
    const rawStatus = firstValue(row, [statusIndex]);
    const uiStatus = workType === "mini_work"
      ? normalizeMiniWorkStatus(rawStatus)
      : normalizeWorkStatus(rawStatus);
    const submissionId = firstValue(row, [submissionIndex]) || createId("RESTORE-SUB");
    const score = parseScore(firstValue(row, [scoreIndex]));
    const feedback = parseJsonCell(firstValue(row, [feedbackIndex]));
    const evaluationJson = parseJsonCell(firstValue(row, [evaluationIndex]));
    const goodPoints = toStringArray(feedback.goodPoints || feedback.good_points || evaluationJson.good_points || evaluationJson.feedback?.goodPoints);
    const improvementPoints = toStringArray(feedback.improvementPoints || feedback.improvement_points || evaluationJson.improvement_points || evaluationJson.feedback?.improvementPoints);

    submissions.push({
      submission_id: submissionId,
      email_normalized: emailKey,
      target_type: workType,
      target_id: targetId,
      answer_text: firstValue(row, [answerIndex]),
      status: uiStatus,
      score,
      submitted_at: submittedAt,
      restored_from_sheets: true
    });

    evaluationResults.push({
      evaluation_id: createId("RESTORE-EV"),
      submission_id: submissionId,
      target_type: workType,
      target_id: targetId,
      work_type: workType === "mini_work" ? "miniWork" : "work",
      mini_work_id: miniWorkId,
      parent_lesson_id: lessonId,
      work_id: targetId,
      work_title: firstValue(row, [titleIndex]),
      result_status: uiStatus,
      standard_status: normalizeStandardStatus(rawStatus),
      abc_grade: firstValue(row, [abcIndex]) || evaluationJson.abc_grade || evaluationJson.abcGrade || "",
      score,
      reason: evaluationJson.reason || evaluationJson.summary || firstValue(row, [summaryIndex]) || "",
      good_points: goodPoints,
      improvement_points: uiStatus === "good" ? [] : improvementPoints,
      unmet_criteria: uiStatus === "good" ? [] : toStringArray(evaluationJson.unmet_criteria || evaluationJson.unmetCriteria),
      next_question: evaluationJson.next_question || evaluationJson.nextQuestion || "",
      next_action_text: evaluationJson.next_action_text || evaluationJson.next_action || "",
      evaluated_at: submittedAt,
      restored_from_sheets: true
    });

    if (workType === "mini_work") {
      progress.push({
        lesson_id: lessonId,
        mini_work_id: miniWorkId,
        mini_work_status: uiStatus,
        last_score: score,
        mini_work_passed_at: uiStatus === "good" ? submittedAt : "",
        updated_at: submittedAt,
        source: "sheets"
      });
    } else {
      progress.push({
        lesson_id: lessonId,
        work_id: workId,
        work_status: uiStatus,
        last_score: score,
        updated_at: submittedAt,
        source: "sheets"
      });
      aiWorkSessions.push(buildRestoredAiWorkSession({
        emailKey,
        workId,
        lessonId,
        workTitle: firstValue(row, [titleIndex]),
        answerText: firstValue(row, [answerIndex]),
        status: rawStatus,
        uiStatus,
        score,
        evaluationJson,
        submittedAt,
        submissionId
      }));
    }
  });

  applyWorkSummaryClears(workSummary, emailKey).forEach((item) => clearedTargets.push(item));

  return { progress, submissions, evaluationResults, aiWorkSessions, clearedTargets, warnings };
}

function buildRestoredAiWorkSession({ emailKey, workId, lessonId, workTitle, answerText, status, uiStatus, score, evaluationJson, submittedAt, submissionId }) {
  const sessionStatus = normalizeAiSessionStatus(status, uiStatus);
  return {
    session_id: `AWS-RESTORE-${emailKey}-${workId}`,
    email_normalized: emailKey,
    user_id: "",
    lesson_id: lessonId,
    work_id: workId,
    work_title: workTitle || workId,
    status: sessionStatus,
    initial_answer: answerText || "",
    latest_revision_answer: sessionStatus === "revision_required" ? answerText || "" : "",
    ai_score: score,
    ai_summary: evaluationJson.summary || evaluationJson.reason || "",
    ai_feedback: evaluationJson.summary || evaluationJson.reason || "",
    ai_evaluation_result: evaluationJson && Object.keys(evaluationJson).length ? evaluationJson : null,
    good_points: toStringArray(evaluationJson.good_points || evaluationJson.goodPoints || evaluationJson.feedback?.goodPoints),
    improvement_points: toStringArray(evaluationJson.improvement_points || evaluationJson.improvementPoints || evaluationJson.feedback?.improvementPoints),
    unmet_criteria: toStringArray(evaluationJson.unmet_criteria || evaluationJson.unmetCriteria),
    followup_questions: toStringArray(evaluationJson.followup_questions || evaluationJson.followupQuestions || evaluationJson.next_question || evaluationJson.nextQuestion),
    next_actions: toStringArray(evaluationJson.next_action || evaluationJson.nextAction),
    restored_submission_id: submissionId,
    restored_from_sheets: true,
    created_at: submittedAt,
    updated_at: submittedAt,
    completed_at: sessionStatus === "completed" ? submittedAt : ""
  };
}

function applyWorkSummaryClears(sheet, emailKey) {
  const emailIndex = findHeaderIndex(sheet.headers, EMAIL_HEADERS);
  const workIndex = findHeaderIndex(sheet.headers, WORK_SUMMARY_FIELDS.currentWorkId);
  const statusIndex = findHeaderIndex(sheet.headers, WORK_SUMMARY_FIELDS.latestStatus);
  if (emailIndex < 0 || workIndex < 0 || statusIndex < 0) return [];
  return sheet.rowRefs
    .filter((rowRef) => normalizeEmailKey(rowRef.row[emailIndex]) === emailKey)
    .filter((rowRef) => {
      const status = String(rowRef.row[statusIndex] || "").trim();
      return !status || /reset|リセット|未着手|not_started/i.test(status);
    })
    .map((rowRef) => ({
      target_type: "work",
      target_id: String(rowRef.row[workIndex] || "").trim(),
      work_id: String(rowRef.row[workIndex] || "").trim(),
      reset_source: sheet.sheetName
    }))
    .filter((item) => item.target_id);
}

function selectLatestRow(rows, headers, latestIndex, dateIndexes = []) {
  if (latestIndex >= 0) {
    const latestRows = rows.filter(({ rowRef }) => isTruthyLatest(rowRef.row[latestIndex]));
    if (latestRows.length) {
      return latestRows.sort((a, b) => rowDateValue(b.rowRef.row, dateIndexes) - rowDateValue(a.rowRef.row, dateIndexes))[0];
    }
    const hasLatestSignal = rows.some(({ rowRef }) => String(rowRef.row[latestIndex] || "").trim() !== "");
    if (hasLatestSignal) return null;
    return rows.sort((a, b) => rowDateValue(b.rowRef.row, dateIndexes) - rowDateValue(a.rowRef.row, dateIndexes))[0] || null;
  }
  return rows.sort((a, b) => rowDateValue(b.rowRef.row, dateIndexes) - rowDateValue(a.rowRef.row, dateIndexes))[0] || null;
}

function isTruthyLatest(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "最新"].includes(text);
}

function rowDateValue(row, indexes = []) {
  for (const index of indexes) {
    if (index < 0) continue;
    const value = row[index];
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function firstValue(row, indexes = []) {
  for (const index of indexes) {
    if (index < 0) continue;
    const value = row[index];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function normalizeRestoredWorkType(value, targetId = "") {
  const text = String(value || "").trim();
  if (/mini|ミニ|mini_work|miniWork/i.test(text) || String(targetId || "").startsWith("MW-")) return "mini_work";
  return "work";
}

function normalizeStandardStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["pass", "passed", "good", "completed", "通過", "完了"].includes(text)) return "pass";
  if (["review", "support_needed", "staff_feedback_ready", "サポート相談", "担当者確認"].includes(text)) return "review";
  if (["ai_error", "failed", "error", "評価に失敗しました"].includes(text)) return "retry";
  return "retry";
}

function normalizeMiniWorkStatus(value) {
  const standard = normalizeStandardStatus(value);
  if (standard === "pass") return "good";
  if (standard === "review") return "support_needed";
  if (/failed|error|ai_error/i.test(String(value || ""))) return "failed";
  return "needs_more";
}

function normalizeWorkStatus(value) {
  const standard = normalizeStandardStatus(value);
  if (standard === "pass") return "good";
  if (standard === "review") return "support_needed";
  if (/failed|error|ai_error/i.test(String(value || ""))) return "failed";
  return "needs_more";
}

function normalizeAiSessionStatus(value, uiStatus) {
  const text = String(value || "").trim().toLowerCase();
  if (uiStatus === "good" || ["pass", "passed", "completed", "good"].includes(text)) return "completed";
  if (["followup_required", "retry"].includes(text)) return "followup_required";
  if (uiStatus === "support_needed" || ["review", "support_needed", "staff_feedback_ready"].includes(text)) return "revision_required";
  if (/error|failed|ai_error/.test(text)) return "error";
  return "revision_required";
}

function parseScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function parseJsonCell(value) {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

async function readSheet(spreadsheetId, sheetName) {
  const values = await getValues(spreadsheetId, `${quoteSheetName(sheetName)}!A:Z`);
  const headers = values[0] || [];
  return {
    sheetName,
    headers,
    rows: values.slice(1),
    rowRefs: values.slice(1).map((row, index) => ({ row, rowNumber: index + 2 }))
  };
}

async function upsertByEmail({ spreadsheetId, sheet, fieldMap, emailKey, values }) {
  const emailIndex = findHeaderIndex(sheet.headers, EMAIL_HEADERS);
  if (emailIndex < 0) throw httpError(500, "email_column_missing", `${sheet.sheetName} email column missing.`);

  const existing = sheet.rowRefs.find((rowRef) => normalizeEmailKey(rowRef.row[emailIndex]) === emailKey);
  if (!existing) {
    await appendRow(spreadsheetId, sheet, fieldMap, values);
    return { action: "append" };
  }

  await updateRowByFields(spreadsheetId, sheet, fieldMap, existing.rowNumber, values);
  return { action: "update", rowNumber: existing.rowNumber };
}

async function appendRow(spreadsheetId, sheet, fieldMap, values) {
  if (!sheet.headers.length) throw httpError(500, "sheet_header_missing", `${sheet.sheetName} header row missing.`);
  const row = sheet.headers.map((header) => {
    const field = fieldForHeader(header, fieldMap);
    return field ? valueOrBlank(values[field]) : "";
  });
  await appendValues(spreadsheetId, `${quoteSheetName(sheet.sheetName)}!A:Z`, [row]);
}

async function updateRowByFields(spreadsheetId, sheet, fieldMap, rowNumber, values) {
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const columnIndex = findHeaderIndex(sheet.headers, fieldMap[field] || [field]);
    if (columnIndex < 0) continue;
    const cell = `${quoteSheetName(sheet.sheetName)}!${columnName(columnIndex)}${rowNumber}`;
    await updateValues(spreadsheetId, cell, [[valueOrBlank(value)]]);
  }
}

async function clearLatestFlag({ spreadsheetId, sheet, emailKey, targetAliases, targetValue, warnings }) {
  const isLatestIndex = findHeaderIndex(sheet.headers, ["is_latest", "latest", "最新"]);
  if (isLatestIndex < 0) {
    warnings.push({ sheetName: sheet.sheetName, warning: "is_latest_column_missing" });
    return;
  }

  const emailIndex = findHeaderIndex(sheet.headers, EMAIL_HEADERS);
  const targetIndex = findHeaderIndex(sheet.headers, targetAliases);
  if (emailIndex < 0 || targetIndex < 0) return;

  for (const rowRef of sheet.rowRefs) {
    const matchesEmail = normalizeEmailKey(rowRef.row[emailIndex]) === emailKey;
    const matchesTarget = String(rowRef.row[targetIndex] || "").trim() === targetValue;
    if (!matchesEmail || !matchesTarget) continue;
    const value = String(rowRef.row[isLatestIndex] || "").trim().toLowerCase();
    if (!["true", "1", "yes", "最新"].includes(value)) continue;
    const cell = `${quoteSheetName(sheet.sheetName)}!${columnName(isLatestIndex)}${rowRef.rowNumber}`;
    await updateValues(spreadsheetId, cell, [["FALSE"]]);
  }
}

async function appendToOptionalTab({ spreadsheetId, sheetName, fieldMap, values, warnings }) {
  const exists = await sheetExists(spreadsheetId, sheetName);
  if (!exists) {
    warnings.push({ sheetName, warning: "optional_sheet_missing" });
    return;
  }
  const sheet = await readSheet(spreadsheetId, sheetName);
  await appendRow(spreadsheetId, sheet, fieldMap, values);
}

async function sheetExists(spreadsheetId, sheetName) {
  const metadata = await getSpreadsheetMetadata(spreadsheetId);
  return (metadata.sheets || []).some((sheet) => sheet.properties?.title === sheetName);
}

// タブが無ければ指定ヘッダで新規作成し、ヘッダ付きの readSheet 結果を返す。
async function ensureSheetWithHeaders(spreadsheetId, sheetName, headers) {
  const exists = await sheetExists(spreadsheetId, sheetName);
  if (!exists) {
    await createSheet(spreadsheetId, sheetName);
    await updateValues(spreadsheetId, `${quoteSheetName(sheetName)}!A1`, [headers]);
    return { sheetName, headers: headers.slice(), rows: [], rowRefs: [] };
  }
  const sheet = await readSheet(spreadsheetId, sheetName);
  // 既存だがヘッダ未設定なら補完
  if (!sheet.headers.length) {
    await updateValues(spreadsheetId, `${quoteSheetName(sheetName)}!A1`, [headers]);
    sheet.headers = headers.slice();
  }
  return sheet;
}

// 本ワークのAI評価を ai_evaluation_logs に、担当者確認が必要なら staff_feedback_queue に永続化する。
// 書込の成否を返し、UI側で「作成しました」を実書込と連動できるようにする。
async function persistWorkFeedback(context, answerValues) {
  const { payload, config, now } = context;
  const workType = normalizeWorkType(payload.workType || payload.work_type || context.action);
  const result = { aiEvaluationLog: false, staffFeedbackQueue: false, staffFeedbackTriggered: false };
  // 本ワーク（AI評価ワーク）のみ対象。normalizeWorkType は "work" / "ai_work" / "mini_work" を返す。
  if (workType !== "work" && workType !== "ai_work") return result;

  const evaluation = normalizeEvaluation(payload.evaluation || payload.aiEvaluation || payload.ai_evaluation || {});
  const staffFeedbackRecommended = Boolean(
    payload.staffFeedbackRecommended ||
    evaluation.needsSupport ||
    evaluation.needsHumanReview ||
    ["review", "staff_feedback_ready", "support_needed"].includes(String(evaluation.status || "").toLowerCase())
  );
  result.staffFeedbackTriggered = staffFeedbackRecommended;

  // 1) ai_evaluation_logs へ追記（毎回）
  const logSheet = await ensureSheetWithHeaders(config.workSpreadsheetId, config.aiEvaluationLogSheetName, AI_EVALUATION_LOG_HEADERS);
  await appendRow(config.workSpreadsheetId, logSheet, AI_EVALUATION_LOG_FIELDS, {
    logId: createId("AI-LOG"),
    requestId: payload.requestId || payload.request_id || answerValues.submissionId || "",
    sessionId: payload.sessionId || payload.session_id || "",
    userId: payload.userId || payload.user_id || "",
    emailKey: context.emailKey,
    commonProfileJson: safeJson(payload.commonProfile || payload.common_profile || {}),
    workId: answerValues.workId,
    workTitle: answerValues.workTitle,
    stage: payload.stage || "",
    hearingHistoryJson: safeJson(payload.hearingHistory || payload.hearing_history || []),
    answerText: answerValues.answerText,
    promptText: payload.promptText || payload.prompt_text || answerValues.questionText || "",
    requestPayloadJson: safeJson({ workId: answerValues.workId, stage: payload.stage || "", retryCount: answerValues.retryCount }),
    responseJson: safeJson(evaluation.raw || evaluation),
    score: evaluation.score ?? "",
    status: evaluation.status || "",
    unmetCriteriaJson: safeJson(payload.unmetCriteria || payload.unmet_criteria || evaluation.raw?.unmet_criteria || []),
    nextAction: payload.nextAction || payload.next_action || evaluation.raw?.next_action || evaluation.raw?.nextQuestion || "",
    staffFeedbackRecommended: staffFeedbackRecommended ? "TRUE" : "FALSE",
    errorMessage: evaluation.raw?.error_message_safe || evaluation.raw?.error_message || "",
    createdAt: now,
    updatedAt: now
  });
  result.aiEvaluationLog = true;

  // 2) staff_feedback_queue へ追記（担当者確認が必要なときのみ）
  if (staffFeedbackRecommended) {
    const queueSheet = await ensureSheetWithHeaders(config.workSpreadsheetId, config.staffFeedbackQueueSheetName, STAFF_FEEDBACK_QUEUE_HEADERS);
    await appendRow(config.workSpreadsheetId, queueSheet, STAFF_FEEDBACK_QUEUE_FIELDS, {
      queueId: createId("SFQ"),
      sessionId: payload.sessionId || payload.session_id || "",
      userId: payload.userId || payload.user_id || "",
      emailKey: context.emailKey,
      workId: answerValues.workId,
      workTitle: answerValues.workTitle,
      status: "pending",
      score: evaluation.score ?? "",
      triggerStatus: evaluation.status || "",
      message: payload.staffFeedbackMessage || "作成されたワークをもとに、担当者からフィードバックをいたします。",
      reason: payload.staffFeedbackReason || (payload.unmetCriteria || []).join(" / ") || "",
      createdAt: now,
      updatedAt: now
    });
    result.staffFeedbackQueue = true;
  }
  return result;
}

function isDuplicateEvent(sheet, id, aliases) {
  const eventId = String(id || "").trim();
  if (!eventId) return false;
  const columnIndex = findHeaderIndex(sheet.headers, aliases);
  if (columnIndex < 0) return false;
  return sheet.rows.some((row) => String(row[columnIndex] || "").trim() === eventId);
}

function fieldForHeader(header, fieldMap) {
  const normalized = normalizeHeader(header);
  return Object.entries(fieldMap).find(([, aliases]) =>
    aliases.map(normalizeHeader).includes(normalized)
  )?.[0] || "";
}

function normalizeWorkType(value) {
  const text = String(value || "").trim();
  if (/mini|ミニ|MW-/.test(text)) return "mini_work";
  if (/intake|followup|revision|ai/i.test(text)) return "ai_work";
  return "work";
}

function normalizeEvaluation(source = {}) {
  const feedback = source.feedback || {};
  const flags = source.flags || {};
  return {
    raw: source,
    status: source.standard_status || source.status || source.result_status || "",
    abcGrade: source.abcGrade || source.abc_grade || "",
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : "",
    needsFollowup: Boolean(source.needsFollowup || source.needs_followup),
    needsSupport: Boolean(flags.needsSupport || source.needsSupport),
    needsHumanReview: Boolean(flags.needsHumanReview || source.needsHumanReview),
    reason: source.reason || source.summary || "",
    summary: feedback.summary || source.summary || "",
    feedback: {
      summary: feedback.summary || source.summary || "",
      goodPoints: feedback.goodPoints || source.good_points || [],
      improvementPoints: feedback.improvementPoints || source.improvement_points || []
    },
    retryCount: source.retry_count || source.retryCount || ""
  };
}

function valueOrBlank(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return safeJson(value);
  return value;
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return "{}";
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function parseRequestBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
}

function safeMessage(error) {
  if (error.statusCode && error.statusCode < 500) return error.message;
  if (error.code === "google_service_account_missing" || error.code === "spreadsheet_id_missing") {
    return "Sheets同期設定を確認してください。";
  }
  return "保存に失敗しました。通信状況を確認して、もう一度お試しください。";
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json;charset=utf-8"
    },
    body: JSON.stringify(body)
  };
}

exports._test = {
  ANSWER_LOG_FIELDS,
  PROGRESS_SUMMARY_FIELDS,
  VIDEO_LOG_FIELDS,
  WORK_SUMMARY_FIELDS,
  fieldForHeader,
  normalizeEvaluation,
  normalizeWorkType,
  restoreVideoState,
  restoreWorkState,
  selectLatestRow,
  syncConfig
};

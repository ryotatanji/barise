const {
  appendValues,
  columnName,
  createSheet,
  findHeaderIndex,
  getValues,
  isValidEmail,
  normalizeEmailKey,
  quoteSheetName,
  updateValues
} = require("./_sheets");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Reset-Token",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const VALID_SCOPES = new Set(["all", "lesson", "work"]);
const RESET_LOG_HEADERS = [
  "created_at",
  "reset_id",
  "email_key",
  "scope",
  "lesson_id",
  "work_id",
  "actor",
  "reason",
  "affected_rows",
  "reset_type",
  "before_snapshot_json"
];

const EMAIL_HEADERS = ["email_key", "email_normalized", "email", "mail", "メール", "メールアドレス", "登録メールアドレス"];
const PROGRESS_SUMMARY_COLUMNS = {
  email: EMAIL_HEADERS,
  overallStatus: ["全体解説ステータス"],
  currentVideoId: ["現在の動画ID", "video_id", "lesson_id"],
  currentVideoName: ["現在の動画名", "video_title"],
  nextVideoId: ["次に見る動画ID", "next_video_id"],
  lastViewedAt: ["最終視聴日時", "last_viewed_at"],
  stalledDays: ["停滞日数"],
  nextFollowDate: ["次回フォロー日"],
  memo: ["メモ", "memo"],
  updatedAt: ["更新日時", "updated_at"]
};
const VIDEO_LOG_COLUMNS = {
  email: EMAIL_HEADERS,
  videoId: ["video_id", "動画ID", "動画id", "lesson_id"],
  status: ["status", "ステータス"],
  isLatest: ["is_latest", "latest", "最新"],
  updatedAt: ["updated_at", "更新日時"],
  memo: ["memo", "メモ"]
};
const WORK_SUMMARY_COLUMNS = {
  email: EMAIL_HEADERS,
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
const ANSWER_LOG_COLUMNS = {
  email: EMAIL_HEADERS,
  workId: ["work_id", "ワークID", "ワークid", "mini_work_id", "target_id"],
  isLatest: ["is_latest", "latest", "最新"],
  updatedAt: ["updated_at", "更新日時"]
};

exports.handler = async function handler(event) {
  const now = new Date().toISOString();
  const resetId = `RESET-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, {});
    }
    if (event.httpMethod !== "POST") {
      return response(405, { ok: false, reason: "method_not_allowed" });
    }

    const request = parseRequestBody(event);
    verifyAdminToken(event, request);

    const input = normalizeResetInput(request);
    validateResetInput(input);
    const config = resetConfig();
    const sheets = await loadResetSheets(config);
    const beforeSnapshot = buildBeforeSnapshot(sheets, input.emailKey);

    const affected = [];
    affected.push(await resetProgressSummary({
      spreadsheetId: config.progressSpreadsheetId,
      sheet: sheets.progressSummary,
      input,
      now
    }));
    affected.push(await resetVideoLogLatest({
      spreadsheetId: config.progressSpreadsheetId,
      sheet: sheets.videoLog,
      input,
      now
    }));
    affected.push(await resetWorkSummary({
      spreadsheetId: config.workSpreadsheetId,
      sheet: sheets.workSummary,
      input,
      now
    }));
    affected.push(await resetAnswerLogLatest({
      spreadsheetId: config.workSpreadsheetId,
      sheet: sheets.answerLog,
      input,
      now
    }));

    if (input.scope === "work" && input.workId) {
      affected.push(await resetOptionalWorkDetailTab({
        spreadsheetId: config.workSpreadsheetId,
        sheetName: input.workId,
        input,
        now
      }));
    }

    await appendResetLog({
      spreadsheetId: config.resetLogsSpreadsheetId,
      sheetName: config.resetLogsSheetName,
      values: [
        now,
        resetId,
        input.emailKey,
        input.scope,
        input.videoId || input.lessonId,
        input.workId,
        input.actor,
        input.reason,
        affectedRowsSummary(affected),
        "soft_reset",
        JSON.stringify(beforeSnapshot)
      ]
    });

    return response(200, {
      ok: true,
      reset_id: resetId,
      email_key: input.emailKey,
      scope: input.scope,
      lesson_id: input.lessonId,
      video_id: input.videoId,
      work_id: input.workId,
      affected
    });
  } catch (error) {
    return response(error.statusCode || 500, {
      ok: false,
      reason: error.code || "reset_error",
      message: error.message || "Reset failed."
    });
  }
};

function normalizeResetInput(request = {}) {
  const lessonId = String(request.lesson_id || request.lessonId || "").trim();
  const videoId = String(request.video_id || request.videoId || lessonId).trim();
  return {
    emailKey: normalizeEmailKey(request.email_key || request.email),
    scope: String(request.scope || "all").trim().toLowerCase(),
    lessonId,
    videoId,
    workId: String(request.work_id || request.workId || request.mini_work_id || request.miniWorkId || "").trim(),
    actor: String(request.actor || "admin").trim(),
    reason: String(request.reason || "").trim()
  };
}

function validateResetInput(input) {
  if (!isValidEmail(input.emailKey)) {
    throw httpError(400, "invalid_email", "email_key must be a valid email.");
  }
  if (!VALID_SCOPES.has(input.scope)) {
    throw httpError(400, "invalid_scope", "scope must be all, lesson, or work.");
  }
  if (input.scope === "lesson" && !input.videoId) {
    throw httpError(400, "missing_video_id", "scope lesson requires lesson_id or video_id.");
  }
  if (input.scope === "work" && !input.workId) {
    throw httpError(400, "missing_work_id", "scope work requires work_id.");
  }
}

function resetConfig() {
  const progressSpreadsheetId = process.env.BARISE_PROGRESS_SPREADSHEET_ID || process.env.SPREADSHEET_ID || "";
  const workSpreadsheetId = process.env.BARISE_WORK_SPREADSHEET_ID || process.env.SPREADSHEET_ID || "";
  return {
    progressSpreadsheetId,
    progressSummarySheetName: process.env.BARISE_PROGRESS_SUMMARY_SHEET_NAME || "_進捗サマリー",
    videoLogSheetName: process.env.BARISE_VIDEO_LOG_SHEET_NAME || "_視聴ログ_all",
    workSpreadsheetId,
    workSummarySheetName: process.env.BARISE_WORK_SUMMARY_SHEET_NAME || "_ワークサマリー",
    workLogSheetName: process.env.BARISE_WORK_LOG_SHEET_NAME || "_回答ログ_all",
    resetLogsSpreadsheetId: process.env.BARISE_RESET_LOGS_SPREADSHEET_ID || workSpreadsheetId || progressSpreadsheetId,
    resetLogsSheetName: process.env.BARISE_RESET_LOGS_SHEET_NAME || "reset_logs"
  };
}

async function loadResetSheets(config) {
  return {
    progressSummary: await readSheet(config.progressSpreadsheetId, config.progressSummarySheetName, PROGRESS_SUMMARY_COLUMNS),
    videoLog: await readSheet(config.progressSpreadsheetId, config.videoLogSheetName, VIDEO_LOG_COLUMNS),
    workSummary: await readSheet(config.workSpreadsheetId, config.workSummarySheetName, WORK_SUMMARY_COLUMNS),
    answerLog: await readSheet(config.workSpreadsheetId, config.workLogSheetName, ANSWER_LOG_COLUMNS)
  };
}

async function readSheet(spreadsheetId, sheetName, columnAliases) {
  const values = await getValues(spreadsheetId, `${quoteSheetName(sheetName)}!A:Z`);
  const headers = values[0] || [];
  return {
    sheetName,
    headers,
    rows: values.slice(1),
    columns: detectColumns(headers, columnAliases)
  };
}

function detectColumns(headers, aliasesByKey) {
  return Object.fromEntries(
    Object.entries(aliasesByKey).map(([key, aliases]) => [key, findHeaderIndex(headers, aliases)])
  );
}

function buildBeforeSnapshot(sheets, emailKey) {
  const progressRows = rowsForEmail(sheets.progressSummary, emailKey);
  const workRows = rowsForEmail(sheets.workSummary, emailKey);
  const videoRows = rowsForEmail(sheets.videoLog, emailKey);
  const answerRows = rowsForEmail(sheets.answerLog, emailKey);

  return {
    progress_summary: rowSnapshot(sheets.progressSummary, progressRows.at(-1)),
    work_summary: rowSnapshot(sheets.workSummary, workRows.at(-1)),
    video_log: {
      matched_count: videoRows.length,
      latest_row: logRowSummary(sheets.videoLog, videoRows.at(-1))
    },
    answer_log: {
      matched_count: answerRows.length,
      latest_row: logRowSummary(sheets.answerLog, answerRows.at(-1), ["answer_text", "question_text_疑問文", "summary_総評"])
    }
  };
}

function rowsForEmail(sheet, emailKey) {
  if (sheet.columns.email < 0) return [];
  return sheet.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => normalizeEmailKey(row[sheet.columns.email]) === emailKey);
}

function rowSnapshot(sheet, rowRef) {
  if (!rowRef) return null;
  return {
    row_number: rowRef.rowNumber,
    values: rowToObject(sheet.headers, rowRef.row)
  };
}

function logRowSummary(sheet, rowRef, omitHeaders = []) {
  if (!rowRef) return null;
  const omitted = new Set(omitHeaders);
  const values = rowToObject(sheet.headers, rowRef.row);
  omitted.forEach((header) => {
    if (Object.prototype.hasOwnProperty.call(values, header)) {
      values[header] = "[omitted]";
    }
  });
  return {
    row_number: rowRef.rowNumber,
    values
  };
}

function rowToObject(headers, row) {
  return headers.reduce((acc, header, index) => {
    if (!header) return acc;
    acc[header] = row[index] || "";
    return acc;
  }, {});
}

async function resetProgressSummary({ spreadsheetId, sheet, input, now }) {
  const required = ["email"];
  const missing = missingColumns(sheet.columns, required);
  if (missing.length) {
    return skipped(sheet, "progress_summary", "missing_columns", missing);
  }

  const updatedRows = [];
  for (const rowRef of rowsForEmail(sheet, input.emailKey)) {
    const patches = progressSummaryPatches(sheet, rowRef.row, input, now);
    if (!Object.keys(patches).length) continue;
    const applied = await applyPatches(spreadsheetId, sheet.sheetName, sheet.headers, rowRef.rowNumber, patches);
    if (applied) updatedRows.push(rowRef.rowNumber);
  }

  return changed(sheet, "progress_summary", updatedRows);
}

function progressSummaryPatches(sheet, row, input, now) {
  if (input.scope === "work") return {};

  const memo = resetMemo(row[sheet.columns.memo], input, now);
  if (input.scope === "all") {
    return byColumnPresence(sheet.columns, {
      overallStatus: "not_started",
      currentVideoId: "",
      currentVideoName: "",
      nextVideoId: "",
      lastViewedAt: "",
      stalledDays: "",
      nextFollowDate: "",
      memo,
      updatedAt: now
    });
  }

  const currentVideoId = String(row[sheet.columns.currentVideoId] || "").trim();
  const nextVideoId = String(row[sheet.columns.nextVideoId] || "").trim();
  if (currentVideoId !== input.videoId && nextVideoId !== input.videoId) return {};

  return byColumnPresence(sheet.columns, {
    currentVideoId: "",
    currentVideoName: "",
    nextVideoId: input.videoId,
    lastViewedAt: "",
    stalledDays: "",
    nextFollowDate: "",
    memo,
    updatedAt: now
  });
}

async function resetVideoLogLatest({ spreadsheetId, sheet, input, now }) {
  if (!["all", "lesson"].includes(input.scope)) {
    return skipped(sheet, "video_log", "scope_not_applicable", []);
  }
  return resetLatestFlag({
    spreadsheetId,
    sheet,
    kind: "video_log",
    targetColumn: "videoId",
    targetValue: input.scope === "lesson" ? input.videoId : "",
    input,
    now
  });
}

async function resetWorkSummary({ spreadsheetId, sheet, input, now }) {
  if (input.scope === "lesson") {
    return skipped(sheet, "work_summary", "scope_not_applicable", []);
  }

  const missing = missingColumns(sheet.columns, ["email"]);
  if (missing.length) {
    return skipped(sheet, "work_summary", "missing_columns", missing);
  }

  const updatedRows = [];
  for (const rowRef of rowsForEmail(sheet, input.emailKey)) {
    const patches = workSummaryPatches(sheet, rowRef.row, input, now);
    if (!Object.keys(patches).length) continue;
    const applied = await applyPatches(spreadsheetId, sheet.sheetName, sheet.headers, rowRef.rowNumber, patches);
    if (applied) updatedRows.push(rowRef.rowNumber);
  }

  return changed(sheet, "work_summary", updatedRows);
}

function workSummaryPatches(sheet, row, input, now) {
  const currentWorkId = String(row[sheet.columns.currentWorkId] || "").trim();
  if (input.scope === "work" && currentWorkId !== input.workId) return {};

  return byColumnPresence(sheet.columns, {
    currentWorkId: "",
    currentWorkName: "",
    latestStatus: "",
    latestAbc: "",
    latestScore: "",
    incompleteWorks: input.scope === "work" ? input.workId : "",
    staffReviewRequired: "",
    lastSubmittedAt: "",
    memo: resetMemo(row[sheet.columns.memo], input, now),
    updatedAt: now
  });
}

async function resetAnswerLogLatest({ spreadsheetId, sheet, input, now }) {
  if (!["all", "work"].includes(input.scope)) {
    return skipped(sheet, "answer_log", "scope_not_applicable", []);
  }
  return resetLatestFlag({
    spreadsheetId,
    sheet,
    kind: "answer_log",
    targetColumn: "workId",
    targetValue: input.scope === "work" ? input.workId : "",
    input,
    now
  });
}

async function resetOptionalWorkDetailTab({ spreadsheetId, sheetName, input, now }) {
  try {
    const sheet = await readSheet(spreadsheetId, sheetName, ANSWER_LOG_COLUMNS);
    return resetLatestFlag({
      spreadsheetId,
      sheet,
      kind: "work_detail_log",
      targetColumn: "workId",
      targetValue: input.workId,
      input,
      now
    });
  } catch (error) {
    return {
      sheetName,
      kind: "work_detail_log",
      updatedRows: 0,
      skipped: "detail_sheet_missing_or_unreadable"
    };
  }
}

async function resetLatestFlag({ spreadsheetId, sheet, kind, targetColumn, targetValue, input, now }) {
  const missing = missingColumns(sheet.columns, ["email"]);
  if (missing.length) return skipped(sheet, kind, "missing_columns", missing);
  if (sheet.columns.isLatest < 0) return skipped(sheet, kind, "is_latest_column_not_found", []);
  if (targetValue && sheet.columns[targetColumn] < 0) return skipped(sheet, kind, "target_column_not_found", [targetColumn]);

  const updatedRows = [];
  for (const rowRef of rowsForEmail(sheet, input.emailKey)) {
    if (targetValue && String(rowRef.row[sheet.columns[targetColumn]] || "").trim() !== targetValue) continue;
    const patches = byColumnPresence(sheet.columns, {
      isLatest: "false",
      updatedAt: now
    });
    const applied = await applyPatches(spreadsheetId, sheet.sheetName, sheet.headers, rowRef.rowNumber, patches);
    if (applied) updatedRows.push(rowRef.rowNumber);
  }

  return changed(sheet, kind, updatedRows);
}

function byColumnPresence(columns, valuesByKey) {
  return Object.fromEntries(
    Object.entries(valuesByKey)
      .filter(([key]) => columns[key] >= 0)
      .map(([key, value]) => [key, value])
  );
}

function resetMemo(currentMemo, input, now) {
  const reason = input.reason ? ` reason=${input.reason}` : "";
  const entry = `[${now}] admin soft reset scope=${input.scope}${reason}`;
  const current = String(currentMemo || "").trim();
  return current ? `${current}\n${entry}` : entry;
}

async function applyPatches(spreadsheetId, sheetName, headers, rowNumber, patchesByColumnKey) {
  let applied = 0;
  for (const [columnKey, value] of Object.entries(patchesByColumnKey)) {
    const columnIndex = findHeaderIndex(headers, columnAliasesForKey(columnKey));
    if (columnIndex < 0) continue;
    const cell = `${quoteSheetName(sheetName)}!${columnName(columnIndex)}${rowNumber}`;
    await updateValues(spreadsheetId, cell, [[value]]);
    applied += 1;
  }
  return applied > 0;
}

function columnAliasesForKey(key) {
  return PROGRESS_SUMMARY_COLUMNS[key] ||
    VIDEO_LOG_COLUMNS[key] ||
    WORK_SUMMARY_COLUMNS[key] ||
    ANSWER_LOG_COLUMNS[key] ||
    [key];
}

async function appendResetLog({ spreadsheetId, sheetName, values }) {
  await ensureResetLogsSheet(spreadsheetId, sheetName);
  await appendValues(spreadsheetId, `${quoteSheetName(sheetName)}!A:K`, [values]);
}

async function ensureResetLogsSheet(spreadsheetId, sheetName) {
  try {
    const values = await getValues(spreadsheetId, `${quoteSheetName(sheetName)}!A:K`);
    const headers = values[0] || [];
    if (!headers.length || !headersContain(headers, RESET_LOG_HEADERS)) {
      await updateValues(spreadsheetId, `${quoteSheetName(sheetName)}!A1:K1`, [RESET_LOG_HEADERS]);
    }
    return;
  } catch (error) {
    try {
      await createSheet(spreadsheetId, sheetName);
      await updateValues(spreadsheetId, `${quoteSheetName(sheetName)}!A1:K1`, [RESET_LOG_HEADERS]);
    } catch (createError) {
      throw httpError(500, "reset_logs_sheet_missing", "reset_logs sheet is missing and could not be created.");
    }
  }
}

function headersContain(headers, requiredHeaders) {
  return requiredHeaders.every((header) => findHeaderIndex(headers, [header]) >= 0);
}

function missingColumns(columns, keys) {
  return keys.filter((key) => columns[key] < 0);
}

function changed(sheet, kind, rowNumbers) {
  return {
    sheetName: sheet.sheetName,
    kind,
    updatedRows: rowNumbers.length,
    rowNumbers
  };
}

function skipped(sheet, kind, reason, missingColumnsList = []) {
  return {
    sheetName: sheet.sheetName,
    kind,
    updatedRows: 0,
    skipped: reason,
    missingColumns: missingColumnsList
  };
}

function affectedRowsSummary(affected = []) {
  return affected.map((item) => `${item.sheetName}:${item.updatedRows}${item.skipped ? `:${item.skipped}` : ""}`).join(", ");
}

function verifyAdminToken(event, request) {
  const expected = process.env.BARISE_ADMIN_RESET_TOKEN || "";
  if (!expected) {
    throw httpError(500, "admin_reset_token_missing", "BARISE_ADMIN_RESET_TOKEN is not configured.");
  }

  const provided = getHeader(event, "x-admin-reset-token") || request.adminToken || request.admin_token || "";
  if (provided !== expected) {
    throw httpError(401, "unauthorized", "Admin reset token is invalid.");
  }
}

function getHeader(event, name) {
  const target = name.toLowerCase();
  const headers = event.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  return key ? headers[key] : "";
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
  ANSWER_LOG_COLUMNS,
  PROGRESS_SUMMARY_COLUMNS,
  RESET_LOG_HEADERS,
  VIDEO_LOG_COLUMNS,
  WORK_SUMMARY_COLUMNS,
  buildBeforeSnapshot,
  detectColumns,
  normalizeResetInput,
  progressSummaryPatches,
  resetConfig,
  validateResetInput,
  workSummaryPatches
};

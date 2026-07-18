const {
  appendValues,
  columnName,
  createSheet,
  deleteRowsByNumbers,
  findHeaderIndex,
  getSheetProperties,
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
  let step = "init";

  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, {});
    }
    if (event.httpMethod !== "POST") {
      return response(405, { ok: false, reason: "method_not_allowed" });
    }

    step = "parse_request";
    const request = parseRequestBody(event);
    step = "verify_token";
    verifyAdminToken(event, request);

    step = "validate_input";
    const input = normalizeResetInput(request);
    validateResetInput(input);
    const config = resetConfig();

    step = "read_sheets";
    const sheets = await loadResetSheets(config);

    step = "build_backup";
    const backup = buildFullBackup(sheets, input.emailKey);

    // ドライラン: 変更は一切行わず、対象行数と削除/初期化プランのみ返す（安全確認用）。
    if (input.dryRun) {
      return response(200, {
        ok: true,
        dry_run: true,
        reset_id: resetId,
        email_key: input.emailKey,
        scope: input.scope,
        target_row_counts: backup.counts,
        plan: buildPlan(sheets, input)
      });
    }

    const affected = [];

    // 1) サマリー行を未着手へ初期化（進捗サマリー／ワークサマリー）
    step = "reset_progress_summary";
    affected.push(await resetProgressSummary({ spreadsheetId: config.progressSpreadsheetId, sheet: sheets.progressSummary, input, now }));
    if (input.scope !== "lesson") {
      step = "reset_work_summary";
      affected.push(await resetWorkSummary({ spreadsheetId: config.workSpreadsheetId, sheet: sheets.workSummary, input, now }));
    }

    // 2) 記録行を実削除（＝真の未着手化）。ソフトリセットのis_latest方式は当シートに列が無く機能しないため。
    if (["all", "lesson"].includes(input.scope)) {
      step = "delete_video_log";
      affected.push(await deleteLogRows({
        spreadsheetId: config.progressSpreadsheetId,
        sheet: sheets.videoLog,
        input,
        kind: "video_log",
        matchColumn: input.scope === "lesson" ? "videoId" : "",
        matchValue: input.scope === "lesson" ? input.videoId : ""
      }));
    }
    if (["all", "work"].includes(input.scope)) {
      step = "delete_answer_log";
      affected.push(await deleteLogRows({
        spreadsheetId: config.workSpreadsheetId,
        sheet: sheets.answerLog,
        input,
        kind: "answer_log",
        matchColumn: input.scope === "work" ? "workId" : "",
        matchValue: input.scope === "work" ? input.workId : ""
      }));
    }

    // 3) reset_logs へ全バックアップと結果を記録（失敗しても本処理は成功扱い＝非致命）。
    step = "append_reset_log";
    let resetLog = "written";
    try {
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
          "hard_reset",
          JSON.stringify(backup.snapshot)
        ]
      });
    } catch (logError) {
      resetLog = `skipped:${logError.code || "error"}`;
    }

    return response(200, {
      ok: true,
      reset_id: resetId,
      email_key: input.emailKey,
      scope: input.scope,
      lesson_id: input.lessonId,
      video_id: input.videoId,
      work_id: input.workId,
      reset_type: "hard_reset",
      target_row_counts: backup.counts,
      affected,
      reset_log: resetLog
    });
  } catch (error) {
    return response(error.statusCode || 500, {
      ok: false,
      reason: error.code || "reset_error",
      failed_step: step,
      google_status: error.status || null,
      google_detail: error.detail || "",
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
    reason: String(request.reason || "").trim(),
    dryRun: Boolean(request.dry_run || request.dryRun)
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

// 対象メールの全行を全シートから控える（削除前のフルバックアップ＝復旧用）。
function buildFullBackup(sheets, emailKey) {
  const capture = (sheet) => rowsForEmail(sheet, emailKey).map((ref) => ({
    row_number: ref.rowNumber,
    values: rowToObject(sheet.headers, ref.row)
  }));
  const snapshot = {
    progress_summary: capture(sheets.progressSummary),
    video_log: capture(sheets.videoLog),
    work_summary: capture(sheets.workSummary),
    answer_log: capture(sheets.answerLog)
  };
  return {
    snapshot,
    counts: {
      progress_summary: snapshot.progress_summary.length,
      video_log: snapshot.video_log.length,
      work_summary: snapshot.work_summary.length,
      answer_log: snapshot.answer_log.length
    }
  };
}

function buildPlan(sheets, input) {
  return {
    blank_summary_rows: {
      progress_summary: rowsForEmail(sheets.progressSummary, input.emailKey).map((r) => r.rowNumber),
      work_summary: input.scope === "lesson" ? [] : rowsForEmail(sheets.workSummary, input.emailKey).map((r) => r.rowNumber)
    },
    delete_rows: {
      video_log: ["all", "lesson"].includes(input.scope) ? planDeleteRowNumbers(sheets.videoLog, input, input.scope === "lesson" ? "videoId" : "", input.scope === "lesson" ? input.videoId : "") : [],
      answer_log: ["all", "work"].includes(input.scope) ? planDeleteRowNumbers(sheets.answerLog, input, input.scope === "work" ? "workId" : "", input.scope === "work" ? input.workId : "") : []
    }
  };
}

function planDeleteRowNumbers(sheet, input, matchColumn, matchValue) {
  if (sheet.columns.email < 0) return [];
  return rowsForEmail(sheet, input.emailKey)
    .filter((ref) => !matchColumn || !matchValue || String(ref.row[sheet.columns[matchColumn]] || "").trim() === matchValue)
    .map((ref) => ref.rowNumber);
}

function rowsForEmail(sheet, emailKey) {
  if (sheet.columns.email < 0) return [];
  return sheet.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => normalizeEmailKey(row[sheet.columns.email]) === emailKey);
}

function rowToObject(headers, row) {
  return headers.reduce((acc, header, index) => {
    if (!header) return acc;
    acc[header] = row[index] || "";
    return acc;
  }, {});
}

async function resetProgressSummary({ spreadsheetId, sheet, input, now }) {
  const missing = missingColumns(sheet.columns, ["email"]);
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

async function resetWorkSummary({ spreadsheetId, sheet, input, now }) {
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

// 対象メールの記録行を実削除。行ずれ防止のため降順で一括削除する。
async function deleteLogRows({ spreadsheetId, sheet, input, kind, matchColumn, matchValue }) {
  const missing = missingColumns(sheet.columns, ["email"]);
  if (missing.length) return skipped(sheet, kind, "missing_columns", missing);

  const rowNumbers = planDeleteRowNumbers(sheet, input, matchColumn, matchValue);
  if (!rowNumbers.length) {
    return { sheetName: sheet.sheetName, kind, deletedRows: 0, rowNumbers: [] };
  }

  const props = await getSheetProperties(spreadsheetId);
  const prop = props.find((p) => p.title === sheet.sheetName);
  if (!prop || typeof prop.sheetId !== "number") {
    return skipped(sheet, kind, "sheet_id_not_found", []);
  }

  const result = await deleteRowsByNumbers(spreadsheetId, prop.sheetId, rowNumbers);
  return { sheetName: sheet.sheetName, kind, deletedRows: result.deleted, rowNumbers };
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
  const entry = `[${now}] admin hard reset scope=${input.scope}${reason}`;
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
    deletedRows: 0,
    skipped: reason,
    missingColumns: missingColumnsList
  };
}

function affectedRowsSummary(affected = []) {
  return affected
    .map((item) => `${item.sheetName}:${item.deletedRows != null ? "del" + item.deletedRows : "upd" + (item.updatedRows || 0)}${item.skipped ? `:${item.skipped}` : ""}`)
    .join(", ");
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
  buildFullBackup,
  buildPlan,
  detectColumns,
  normalizeResetInput,
  planDeleteRowNumbers,
  progressSummaryPatches,
  resetConfig,
  rowsForEmail,
  validateResetInput,
  workSummaryPatches
};

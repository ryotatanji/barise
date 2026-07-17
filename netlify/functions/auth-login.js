const {
  findHeaderIndex,
  getValues,
  isValidEmail,
  normalizeEmailKey,
  quoteSheetName
} = require("./_sheets");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const EMAIL_HEADERS = [
  "email",
  "email_key",
  "emailkey",
  "mail",
  "メール",
  "メールアドレス",
  "登録メール",
  "登録メールアドレス"
];
const STATUS_HEADERS = ["account_status", "status", "ステータス", "状態", "受講状態"];
const NAME_HEADERS = ["display_name", "name", "氏名", "名前", "お名前", "受講者名"];
const NICKNAME_HEADERS = ["nickname", "ニックネーム"];
const ACTIVE_VALUES = new Set(["", "active", "有効", "受講中", "登録済み", "利用中", "enabled", "ok"]);

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return response(204, {});
    }
    if (event.httpMethod !== "POST") {
      return response(405, {
        ok: false,
        reason: "method_not_allowed",
        message: "ログイン確認を行えませんでした。"
      });
    }

    const request = parseRequestBody(event);
    const emailKey = normalizeEmailKey(request.email || request.email_key);
    if (!emailKey) {
      return response(400, {
        ok: false,
        reason: "empty",
        message: "メールアドレスを入力してください。"
      });
    }
    if (!isValidEmail(emailKey)) {
      return response(400, {
        ok: false,
        reason: "invalid_email",
        message: "メールアドレスの形式を確認してください。"
      });
    }

    const mockResult = maybeAuthenticateWithMock(emailKey);
    if (mockResult) {
      return response(mockResult.statusCode, mockResult.body);
    }

    const spreadsheetId = process.env.BARISE_REGISTRATION_SPREADSHEET_ID || process.env.SPREADSHEET_ID || "";
    const sheetName = process.env.BARISE_REGISTRATION_SHEET_NAME || "登録情報一覧";
    const range = process.env.BARISE_REGISTRATION_RANGE || `${quoteSheetName(sheetName)}!A:Z`;
    const values = await getValues(spreadsheetId, range);
    const registration = findRegistration(values, emailKey);

    if (!registration) {
      return response(404, {
        ok: false,
        reason: "not_found",
        message: "登録情報が見つかりませんでした。公式LINEで登録したメールアドレスをご確認ください。"
      });
    }

    if (!registration.active) {
      return response(403, {
        ok: false,
        reason: "inactive",
        message: "このメールアドレスは現在利用できません。公式LINEからサポートへお問い合わせください。"
      });
    }

    return response(200, {
      ok: true,
      email_key: emailKey,
      user: {
        email: emailKey,
        email_key: emailKey,
        display_name: registration.displayName || "",
        nickname: registration.nickname || "",
        account_status: "active",
        registration_row: registration.rowNumber
      }
    });
  } catch (error) {
    return response(500, {
      ok: false,
      reason: error.code || "auth_error",
      message: "ログイン確認に時間がかかっています。少し時間を置いて再度お試しください。"
    });
  }
};

function findRegistration(values = [], emailKey) {
  if (!values.length) return null;

  const headers = values[0] || [];
  const emailIndex = findHeaderIndex(headers, EMAIL_HEADERS);
  const statusIndex = findHeaderIndex(headers, STATUS_HEADERS);
  const nameIndex = findHeaderIndex(headers, NAME_HEADERS);
  const nicknameIndex = findHeaderIndex(headers, NICKNAME_HEADERS);

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] || [];
    const emailCell = emailIndex >= 0 ? row[emailIndex] : findEmailInRow(row);
    const rowEmail = normalizeEmailKey(emailCell);
    if (!isValidEmail(rowEmail) || rowEmail !== emailKey) continue;

    const rawStatus = statusIndex >= 0 ? String(row[statusIndex] || "").trim().toLowerCase() : "";
    return {
      rowNumber: index + 1,
      active: ACTIVE_VALUES.has(rawStatus),
      displayName: nameIndex >= 0 ? String(row[nameIndex] || "").trim() : "",
      nickname: nicknameIndex >= 0 ? String(row[nicknameIndex] || "").trim() : ""
    };
  }

  return null;
}

function findEmailInRow(row = []) {
  return row.find((cell) => isValidEmail(cell)) || "";
}

function maybeAuthenticateWithMock(emailKey) {
  if (String(process.env.BARISE_AUTH_USE_MOCK || "").toLowerCase() !== "true") return null;

  const allowedEmails = String(process.env.BARISE_AUTH_MOCK_EMAILS || "")
    .split(",")
    .map(normalizeEmailKey)
    .filter(isValidEmail);
  if (allowedEmails.includes(emailKey)) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        email_key: emailKey,
        user: {
          email: emailKey,
          email_key: emailKey,
          display_name: "",
          account_status: "active",
          registration_row: 0
        }
      }
    };
  }

  return {
    statusCode: 404,
    body: {
      ok: false,
      reason: "not_found",
      message: "登録情報が見つかりませんでした。公式LINEで登録したメールアドレスをご確認ください。"
    }
  };
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

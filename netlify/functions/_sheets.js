const crypto = require("crypto");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken = null;

function normalizeEmailKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmailKey(value));
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_・／/()（）［\]\[\-]/g, "");
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName || "").replace(/'/g, "''")}'`;
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function findHeaderIndex(headers = [], aliases = []) {
  const aliasSet = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) => aliasSet.has(normalizeHeader(header)));
}

function rowObject(headers = [], row = []) {
  return headers.reduce((acc, header, index) => {
    if (!header) return acc;
    acc[normalizeHeader(header)] = row[index] || "";
    return acc;
  }, {});
}

function getServiceAccountConfig() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || "";
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";
  if (!privateKey && process.env.GOOGLE_PRIVATE_KEY_BASE64) {
    privateKey = Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  privateKey = privateKey.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    const error = new Error("Google Sheets接続設定が不足しています。");
    error.code = "google_service_account_missing";
    throw error;
  }

  return { clientEmail, privateKey };
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedToken)
    .sign(privateKey, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${unsignedToken}.${signature}`;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.accessToken;
  }

  const assertion = createJwt(getServiceAccountConfig());
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString()
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const error = new Error("Google Sheets認証に失敗しました。");
    error.code = "google_auth_failed";
    error.detail = body.error || body.error_description || "";
    throw error;
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000
  };
  return cachedToken.accessToken;
}

async function sheetsRequest({ spreadsheetId, range, method = "GET", query = "", body = null }) {
  if (!spreadsheetId) {
    const error = new Error("Spreadsheet IDが未設定です。");
    error.code = "spreadsheet_id_missing";
    throw error;
  }

  const token = await getAccessToken();
  const url = `${GOOGLE_SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${query}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : null
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Google Sheetsへのアクセスに失敗しました。");
    error.code = "google_sheets_request_failed";
    error.status = response.status;
    error.detail = data.error?.message || "";
    throw error;
  }
  return data;
}

async function spreadsheetRequest({ spreadsheetId, path = "", method = "GET", query = "", body = null }) {
  if (!spreadsheetId) {
    const error = new Error("Spreadsheet IDが未設定です。");
    error.code = "spreadsheet_id_missing";
    throw error;
  }

  const token = await getAccessToken();
  const url = `${GOOGLE_SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}${query}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : null
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Google Sheetsへのアクセスに失敗しました。");
    error.code = "google_sheets_request_failed";
    error.status = response.status;
    error.detail = data.error?.message || "";
    throw error;
  }
  return data;
}

async function getValues(spreadsheetId, range) {
  const data = await sheetsRequest({ spreadsheetId, range });
  return data.values || [];
}

async function updateValues(spreadsheetId, range, values) {
  return sheetsRequest({
    spreadsheetId,
    range,
    method: "PUT",
    query: "?valueInputOption=USER_ENTERED",
    body: { values }
  });
}

async function appendValues(spreadsheetId, range, values) {
  return sheetsRequest({
    spreadsheetId,
    range,
    method: "POST",
    query: ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
    body: { values }
  });
}

async function getSpreadsheetMetadata(spreadsheetId) {
  return spreadsheetRequest({
    spreadsheetId,
    query: "?fields=sheets.properties.title"
  });
}

async function createSheet(spreadsheetId, sheetName) {
  return spreadsheetRequest({
    spreadsheetId,
    path: ":batchUpdate",
    method: "POST",
    body: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }
      ]
    }
  });
}

module.exports = {
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
  rowObject,
  updateValues
};

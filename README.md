# Barise 学習ページ (LMS MVP)

静的サイト（ルート直下配信）＋ Netlify Functions 構成の学習ページ。GitHub → Netlify 自動デプロイ。

## 構成
- `index.html` / `styles.css` / `favicon.svg` … フロント
- `scripts/` … `app.js`（描画）/ `data-provider.js`（データ層）/ `ai-evaluation-client.js`
- `data/learning-data.json` … 教材データ（動画URL含む・公開用に内部リンク浄化済み）
- `netlify/functions/` … `auth-login` / `learning-sync` / `evaluate-work` / `admin-reset` / `_sheets`
- `netlify.toml` … publish=`.`, functions=`netlify/functions`, `/data/learning-data.json` は no-cache
- `server/gas/Code.gs` … 参考（GAS版AI判定・Netlifyデプロイには不要）

## デプロイ（Netlify）
- Publish directory: `.`　Functions: `netlify/functions`（`netlify.toml`で指定済み）
- **環境変数はNetlify側で設定**（リポジトリには置かない）:
  - `OPENAI_API_KEY`
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`
  - `BARISE_REGISTRATION_SPREADSHEET_ID` / `BARISE_REGISTRATION_SHEET_NAME`

## バージョン
- V5.1.1（動画リンク反映＋内部リンク浄化＋cache-buster `5-1-1`）

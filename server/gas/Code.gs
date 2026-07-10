const AI_RESPONSE_SCHEMA_VERSION = 'barise-work-evaluation-v1';
const MINI_WORK_RESPONSE_SCHEMA_VERSION = 'barise-mini-work-evaluation-v1';
const AI_LOG_SHEET_NAME = 'ai_evaluation_logs';
const STAFF_FEEDBACK_SHEET_NAME = 'staff_feedback_queue';
const DEFAULT_MODEL = 'gpt-4o-mini';

function doPost(e) {
  const startedAt = new Date().toISOString();
  let request = {};
  let payload = {};

  try {
    request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    payload = request.payload || {};

    if (request.action !== 'evaluateAiWork') {
      throw new Error('Unsupported action');
    }

    const evaluation = evaluateAiWork_(payload);
    appendAiEvaluationLog_(payload, evaluation, '', startedAt);

    if (evaluation.staff_feedback && evaluation.staff_feedback.recommended) {
      appendStaffFeedbackQueue_(payload, evaluation, startedAt);
    }

    return jsonResponse_({ ok: true, evaluation });
  } catch (error) {
    const evaluation = createErrorEvaluation_(payload, error);
    appendAiEvaluationLog_(payload, evaluation, String(error && error.message || error), startedAt);
    return jsonResponse_({ ok: true, evaluation });
  }
}

function evaluateAiWork_(payload) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('OPENAI_API_KEY') || '';
  const useMock = String(props.getProperty('USE_MOCK_AI') || (!apiKey ? 'true' : 'false')).toLowerCase() !== 'false';

  if (useMock || !apiKey) {
    return createMockEvaluation_(payload);
  }

  const model = props.getProperty('OPENAI_MODEL') || DEFAULT_MODEL;
  const endpoint = props.getProperty('OPENAI_RESPONSES_ENDPOINT') || 'https://api.openai.com/v1/responses';
  const promptText = payload.prompt_text || buildFallbackPrompt_(payload);
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    payload: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            'You evaluate Barise learner work inside the learning page.',
            'Return fixed JSON only.',
            'Do not ghostwrite the final answer.',
            'Do not fabricate learner experience, numbers, or business reality.',
            'If required criteria are unmet, do not pass even when score is 80 or higher.'
          ].join(' ')
        },
        { role: 'user', content: promptText }
      ],
      text: {
        format: { type: 'json_object' }
      }
    })
  });

  const status = response.getResponseCode();
  const bodyText = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error(`OpenAI API request failed: ${status}`);
  }

  const body = JSON.parse(bodyText);
  const modelText = extractModelText_(body);
  const parsed = JSON.parse(modelText);
  return normalizeEvaluation_(parsed, payload, model);
}

function createMockEvaluation_(payload) {
  const localReview = payload.local_review || {};
  const unmet = normalizeStringArray_(localReview.unmet_criteria);
  const met = normalizeStringArray_(localReview.met_criteria);
  const criteriaCount = ((payload.work || {}).completion_criteria || []).length || 1;
  const answerText = String(payload.answer_text || '');
  const isMiniWork = payload.workType === 'miniWork' || payload.isMiniWork === true;
  const thin = answerText.trim().length < (isMiniWork ? 24 : 70) || /^(頑張ります|がんばります|意識します|改善します|やります)$/.test(answerText.trim());
  const requiredMet = !unmet.length && localReview.status === 'completed';
  const ratio = met.length / criteriaCount;
  let score = requiredMet ? Math.max(82, Math.min(94, Math.round(80 + ratio * 14))) : Math.max(42, Math.min(79, Math.round(48 + ratio * 26)));
  if (thin) score = Math.min(score, isMiniWork ? 64 : 58);

  let status = 'revision_required';
  if (requiredMet && score >= 88) status = 'staff_feedback_ready';
  else if (requiredMet && score >= 80) status = 'passed';
  else if (localReview.status === 'followup_required') status = 'followup_required';

  return normalizeEvaluation_({
    work_id: payload.work_id,
    status,
    score,
    label: labelForStatus_(status),
    summary: status === 'passed' || status === 'staff_feedback_ready'
      ? '通過基準を満たしています。'
      : '完了条件に照らして、もう少し具体化が必要です。',
    good_points: normalizeStringArray_(localReview.good_points).length ? localReview.good_points : ['考える材料を言葉にできています。'],
    improvement_points: normalizeStringArray_(localReview.improvement_points).length ? localReview.improvement_points : ['場面・数字・判断理由をもう一段具体化しましょう。'],
    unmet_criteria: status === 'passed' || status === 'staff_feedback_ready'
      ? []
      : (unmet.length ? unmet : ['回答本文が短く、具体的な場面・数字・判断理由が不足しています']),
    next_action: nextActionForStatus_(status),
    followup_questions: normalizeStringArray_(localReview.followup_questions).slice(0, 3),
    staff_feedback: {
      recommended: status === 'staff_feedback_ready',
      message: status === 'staff_feedback_ready' ? '作成されたワークをもとに、担当者からフィードバックをいたします。' : '',
      reason: status === 'staff_feedback_ready' ? '担当者が確認できる材料が揃っています。' : ''
    },
    safety_notes: ['APIキーはGAS Script Propertiesで保持し、フロントには返しません。'],
    work_type: isMiniWork ? 'miniWork' : 'work',
    mini_work_id: payload.miniWorkId || payload.mini_work_id || '',
    parent_lesson_id: payload.parentLessonId || payload.parent_lesson_id || '',
    schema_version: isMiniWork ? MINI_WORK_RESPONSE_SCHEMA_VERSION : AI_RESPONSE_SCHEMA_VERSION,
    raw_model: 'gas-mock-fixed-json-v4.10.1',
    evaluated_at: new Date().toISOString()
  }, payload, 'gas-mock-fixed-json-v4.10.1');
}

function normalizeEvaluation_(raw, payload, rawModel) {
  const validStatuses = ['passed', 'revision_required', 'followup_required', 'staff_feedback_ready', 'support_suggested', 'ai_error'];
  const localUnmet = normalizeStringArray_(((payload || {}).local_review || {}).unmet_criteria);
  let status = validStatuses.indexOf(raw.status) >= 0 ? raw.status : 'ai_error';
  let score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
  let unmet = normalizeStringArray_(raw.unmet_criteria);

  if ((status === 'passed' || status === 'staff_feedback_ready') && localUnmet.length) {
    status = 'revision_required';
    unmet = unique_([].concat(unmet, localUnmet));
  }

  if ((status === 'passed' || status === 'staff_feedback_ready') && score < 80) {
    status = 'revision_required';
    unmet = unique_([].concat(unmet, ['80点基準に届いていないため、もう一段具体化が必要です']));
  }

  if (status !== 'passed' && status !== 'staff_feedback_ready' && status !== 'ai_error' && !unmet.length) {
    unmet = ['回答本文が短く、具体的な場面・数字・判断理由が不足しています'];
  }

  const staffFeedback = raw.staff_feedback && typeof raw.staff_feedback === 'object' ? raw.staff_feedback : {};
  const staffRecommended = Boolean(staffFeedback.recommended || status === 'staff_feedback_ready');

  return {
    schema_version: AI_RESPONSE_SCHEMA_VERSION,
    work_id: String(raw.work_id || payload.work_id || ''),
    status,
    score,
    label: String(raw.label || labelForStatus_(status)),
    summary: String(raw.summary || ''),
    good_points: normalizeStringArray_(raw.good_points),
    improvement_points: normalizeStringArray_(raw.improvement_points),
    unmet_criteria: unmet,
    next_action: String(raw.next_action || nextActionForStatus_(status)),
    followup_questions: normalizeStringArray_(raw.followup_questions).slice(0, 3),
    staff_feedback: {
      recommended: staffRecommended,
      message: staffRecommended ? String(staffFeedback.message || '作成されたワークをもとに、担当者からフィードバックをいたします。') : '',
      reason: staffRecommended ? String(staffFeedback.reason || '') : ''
    },
    safety_notes: normalizeStringArray_(raw.safety_notes),
    raw_model: String(raw.raw_model || rawModel || ''),
    evaluated_at: String(raw.evaluated_at || new Date().toISOString())
  };
}

function createErrorEvaluation_(payload, error) {
  return {
    schema_version: AI_RESPONSE_SCHEMA_VERSION,
    work_id: String((payload || {}).work_id || ''),
    status: 'ai_error',
    score: 0,
    label: '一時的に評価できませんでした',
    summary: '一時的に評価できませんでした。回答は保存されているため、再評価できます。',
    good_points: [],
    improvement_points: ['時間を置いて、保存済みの回答から再評価してください。'],
    unmet_criteria: [],
    next_action: '保存済みの回答から再評価できます。',
    followup_questions: [],
    staff_feedback: { recommended: false, message: '', reason: '' },
    safety_notes: ['受講者画面には詳細エラーを表示しません。'],
    raw_model: 'gas-error',
    evaluated_at: new Date().toISOString(),
    error_message: String(error && error.message || error)
  };
}

function appendAiEvaluationLog_(payload, evaluation, errorMessage, now) {
  try {
    const sheet = getSheet_(AI_LOG_SHEET_NAME, [
      'log_id', 'request_id', 'session_id', 'user_id', 'email_normalized', 'common_profile_json', 'work_id', 'work_title', 'stage',
      'hearing_history_json', 'answer_text', 'prompt_text', 'request_payload_json', 'response_json', 'score', 'status',
      'unmet_criteria_json', 'next_action', 'staff_feedback_recommended', 'error_message', 'created_at', 'updated_at'
    ]);
    if (!sheet) return;

    sheet.appendRow([
      createId_('AI-LOG'),
      payload.request_id || '',
      payload.session_id || '',
      payload.user_id || '',
      payload.email_normalized || '',
      JSON.stringify(payload.common_profile || {}),
      payload.work_id || '',
      ((payload.work || {}).title || ''),
      payload.stage || '',
      JSON.stringify(payload.hearing_history || []),
      payload.answer_text || '',
      payload.prompt_text || '',
      JSON.stringify(payload),
      JSON.stringify(evaluation),
      evaluation.score || 0,
      evaluation.status || '',
      JSON.stringify(evaluation.unmet_criteria || []),
      evaluation.next_action || '',
      Boolean((evaluation.staff_feedback || {}).recommended),
      errorMessage || evaluation.error_message || '',
      now,
      now
    ]);
  } catch (error) {
    console.warn(`AI evaluation log was not saved: ${error.message}`);
  }
}

function appendStaffFeedbackQueue_(payload, evaluation, now) {
  try {
    const sheet = getSheet_(STAFF_FEEDBACK_SHEET_NAME, [
      'queue_id', 'session_id', 'user_id', 'email_normalized', 'work_id', 'work_title', 'status', 'score', 'trigger_status',
      'message', 'reason', 'created_at', 'updated_at'
    ]);
    if (!sheet) return;

    sheet.appendRow([
      createId_('SFQ'),
      payload.session_id || '',
      payload.user_id || '',
      payload.email_normalized || '',
      payload.work_id || '',
      ((payload.work || {}).title || ''),
      'pending',
      evaluation.score || 0,
      evaluation.status || '',
      (evaluation.staff_feedback || {}).message || '',
      (evaluation.staff_feedback || {}).reason || '',
      now,
      now
    ]);
  } catch (error) {
    console.warn(`Staff feedback queue was not saved: ${error.message}`);
  }
}

function getSheet_(name, headers) {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    return null;
  }

  const book = SpreadsheetApp.openById(spreadsheetId);
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function extractModelText_(body) {
  if (body.output_text) return body.output_text;
  if (body.choices && body.choices[0] && body.choices[0].message) {
    return body.choices[0].message.content || '';
  }
  const output = body.output || [];
  return output
    .map((item) => (item.content || []).map((content) => content.text || '').join(''))
    .join('');
}

function buildFallbackPrompt_(payload) {
  return [
    '固定JSONで評価してください。',
    `work_id: ${payload.work_id || ''}`,
    `answer: ${payload.answer_text || ''}`,
    `criteria: ${JSON.stringify(((payload.work || {}).completion_criteria || []))}`
  ].join('\n');
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function labelForStatus_(status) {
  const labels = {
    passed: '通過',
    revision_required: 'もう一度整理',
    followup_required: '追加質問があります',
    staff_feedback_ready: '担当者フィードバックへ',
    support_suggested: 'サポート相談',
    ai_error: '一時的に評価できませんでした'
  };
  return labels[status] || '確認中';
}

function nextActionForStatus_(status) {
  const actions = {
    passed: '次のワークへ進みましょう。',
    staff_feedback_ready: '作成されたワークをもとに、担当者からフィードバックをいたします。',
    followup_required: '追加質問に回答してください。',
    revision_required: 'ご自身の場面・数字・判断理由を足して、もう一度整理してください。',
    support_suggested: '整理しにくい部分は、公式LINEで相談しながら進められます。',
    ai_error: '保存済みの回答から再評価できます。'
  };
  return actions[status] || actions.revision_required;
}

function normalizeStringArray_(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function unique_(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function createId_(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

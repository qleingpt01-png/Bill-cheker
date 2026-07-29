/* ============================================================
   請求書チェックツール - script.js
   ------------------------------------------------------------
   ■ GitHub Pages用（静的ファイル構成）
   - Gemini API呼び出し: クライアントサイドから直接 fetch() 実行
   - スプレッドシート書き込み: GAS WebアプリのURLへ POST (fetch)
   ※ GitHub等で公開する場合、APIキーをそのままコミットすると
      不正利用されるリスクがあるため、本来はバックエンドを経由します。
      ここでは動作確認のため、一時的に設定するか、
      社内限定のプライベートリポジトリ等で運用する前提としています。
   ============================================================ */

// ==========================================
// ★ 設定項目（ご自身の環境に合わせて変更してください）
// ==========================================
// GASでデプロイした「ウェブアプリのURL」をここに入力してください
// 例: https://script.google.com/macros/s/XXX/exec
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz_to_Acm-OASstc758GjR2Mk4gL_oJYx6cDdOygwXT5xzU_pilbVoDx8BY2JT8_Zbn/exec';
// ==========================================

// 読み込みを許可するファイル形式・サイズの上限
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const MAX_FILE_SIZE_MB = 15;

/* ------------------------------------------------------------
   DOM要素の取得
------------------------------------------------------------ */

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const previewArea = document.getElementById('previewArea');
const previewIcon = document.getElementById('previewIcon');
const previewName = document.getElementById('previewName');
const resetButton = document.getElementById('resetButton');
const statusArea = document.getElementById('statusArea');

const invoiceForm = document.getElementById('invoiceForm');
const recheckButton = document.getElementById('recheckButton');

const checkEmpty = document.getElementById('checkEmpty');
const checkList = document.getElementById('checkList');
const writeSheetButton = document.getElementById('writeSheetButton');

const loadingOverlay = document.getElementById('loadingOverlay');
const toast = document.getElementById('toast');

const FIELD_IDS = [
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'subtotal',
  'tax',
  'total',
  'bankAccount',
];

/* ------------------------------------------------------------
   初期化
------------------------------------------------------------ */

function init() {
  if (!WEBAPP_URL) {
    showStatus(
      '【デモモード】現在、WEBAPP_URL が未設定のためデモモードで動作しています。本番稼働させる場合は script.js の設定項目を編集してください。',
      'info'
    );
  }

  // ドロップゾーン
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) handleFile(file);
  });

  resetButton.addEventListener('click', resetTool);
  recheckButton.addEventListener('click', () => {
    const data = readFormValues();
    renderChecks(runChecks(data));
  });

  writeSheetButton.addEventListener('click', writeToSheet);
}

/* ------------------------------------------------------------
   ファイル処理
------------------------------------------------------------ */

async function handleFile(file) {
  clearStatus();

  if (!ACCEPTED_TYPES.includes(file.type)) {
    showStatus('対応していないファイル形式です。PNG・JPG・PDFのいずれかを選択してください。', 'error');
    return;
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showStatus(`ファイルサイズが大きすぎます（上限 ${MAX_FILE_SIZE_MB}MB）。ファイルを軽くしてから再度お試しください。`, 'error');
    return;
  }

  showPreview(file);
  clearForm();
  hideChecks();

  const isDemo = !WEBAPP_URL;

  if (isDemo) {
    // デモモード
    setLoading(true);
    const extracted = await getMockInvoiceData();
    fillForm(extracted);
    showStatus('【デモモード】WEBAPP_URL未設定のため、ダミーデータを自動入力しました。実際の請求書は読み取っていません。', 'info');
    renderChecks(runChecks(extracted));
    setLoading(false);
  } else {
    // 本番モード：GASのAPIを呼び出す
    setLoading(true);
    try {
      const base64Data = await fileToBase64(file);
      const extracted = await extractInvoiceWithGemini(base64Data, file.type);
      fillForm(extracted);
      showStatus('読み取りが完了しました。内容をご確認のうえ、必要に応じて修正してください。', 'success');
      renderChecks(runChecks(extracted));
    } catch (err) {
      console.error(err);
      showStatus('読み取り中にエラーが発生しました：' + (err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }
}

function showPreview(file) {
  previewIcon.textContent = file.type === 'application/pdf' ? '📕' : '🖼️';
  previewName.textContent = file.name;
  previewArea.hidden = false;
  dropZone.hidden = true;
}

function resetTool() {
  fileInput.value = '';
  previewArea.hidden = true;
  dropZone.hidden = false;
  clearForm();
  hideChecks();
  clearStatus();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------
   GAS WebAPI 呼び出し（抽出処理）
------------------------------------------------------------ */

async function extractInvoiceWithGemini(base64Data, mimeType) {
  const payload = {
    action: 'extract',
    base64Data: base64Data,
    mimeType: mimeType
  };

  const response = await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // CORS対策
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`サーバーエラー（HTTP ${response.status}）`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(result.message || '読み取りに失敗しました');
  }

  return result.data;
}


/* ------------------------------------------------------------
   デモモード
------------------------------------------------------------ */
function getMockInvoiceData() {
  return new Promise((resolve) => {
    setTimeout(() => {
      const today = new Date();
      const issue = new Date(today);
      issue.setDate(issue.getDate() - 10);
      const due = new Date(today);
      due.setDate(due.getDate() + 21);
      resolve({
        invoiceNumber: 'TEST-0001',
        issueDate: formatDateYMD(issue),
        dueDate: formatDateYMD(due),
        subtotal: 100000,
        tax: 10000,
        total: 110000,
        bankAccount: 'テスト銀行 本店営業部 普通 1234567 カ）カブシキガイシャテスト',
      });
    }, 1000);
  });
}
function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ------------------------------------------------------------
   フォームへの反映・読み取り
------------------------------------------------------------ */
function fillForm(data) {
  document.getElementById('invoiceNumber').value = data.invoiceNumber || '';
  document.getElementById('issueDate').value = toDateInputValue(data.issueDate);
  document.getElementById('dueDate').value = toDateInputValue(data.dueDate);
  document.getElementById('subtotal').value = data.subtotal ? String(data.subtotal) : '';
  document.getElementById('tax').value = data.tax ? String(data.tax) : '';
  document.getElementById('total').value = data.total ? String(data.total) : '';
  document.getElementById('bankAccount').value = data.bankAccount || '';

  FIELD_IDS.forEach(id => document.getElementById(id).classList.add('is-filled'));
}
function toDateInputValue(value) {
  if (!value) return '';
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}
function clearForm() {
  FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    el.value = '';
    el.classList.remove('is-filled', 'is-flagged');
  });
}
function readFormValues() {
  return {
    invoiceNumber: document.getElementById('invoiceNumber').value.trim(),
    issueDate: document.getElementById('issueDate').value.trim(),
    dueDate: document.getElementById('dueDate').value.trim(),
    subtotal: parseAmount(document.getElementById('subtotal').value),
    tax: parseAmount(document.getElementById('tax').value),
    total: parseAmount(document.getElementById('total').value),
    bankAccount: document.getElementById('bankAccount').value.trim(),
  };
}
function parseAmount(value) {
  const cleaned = String(value || '').replace(/[,¥円\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/* ------------------------------------------------------------
   検印チェック
------------------------------------------------------------ */
function runChecks(data) {
  const results = [];
  const flaggedFieldIds = new Set();

  const requiredFields = [
    ['invoiceNumber', '請求書番号'],
    ['issueDate', '発行日'],
    ['dueDate', '支払期限'],
    ['bankAccount', '振込先'],
  ];
  const missing = requiredFields.filter(pair => !String(data[pair[0]] || '').trim());
  const amountsMissing = !data.subtotal && !data.total;

  if (missing.length === 0 && !amountsMissing) {
    results.push(makeCheck(true, '必須項目の入力漏れ', '主要項目はすべて入力されています。'));
  } else {
    const missingLabels = missing.map(pair => pair[1]);
    if (amountsMissing) missingLabels.push('金額');
    missingLabels.forEach(label => flaggedFieldIds.add(labelToId(label)));
    results.push(makeCheck(false, '必須項目の入力漏れ', `未入力の項目があります：${missingLabels.join('・')}`));
  }

  const expectedTotal = data.subtotal + data.tax;
  const totalDiff = Math.abs(expectedTotal - data.total);
  if (data.subtotal || data.tax || data.total) {
    if (totalDiff <= 1) {
      results.push(makeCheck(true, '税額・合計金額の計算', '税抜き金額＋消費税＝合計金額と一致しています。'));
    } else {
      ['subtotal', 'tax', 'total'].forEach(id => flaggedFieldIds.add(id));
      results.push(makeCheck(false, '税額・合計金額の計算', `税抜き金額＋消費税＝${expectedTotal.toLocaleString()}円ですが、合計金額は${data.total.toLocaleString()}円になっています。`));
    }
  } else {
    results.push(makeCheck(false, '税額・合計金額の計算', '金額が入力されていないため計算できません。'));
  }

  if (data.dueDate) {
    const due = new Date(data.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(due.getTime())) {
      results.push(makeCheck(false, '支払期限', '支払期限の形式を確認できませんでした。'));
      flaggedFieldIds.add('dueDate');
    } else if (due.getTime() < today.getTime()) {
      flaggedFieldIds.add('dueDate');
      results.push(makeCheck(false, '支払期限', `支払期限（${data.dueDate}）を過ぎています。至急ご確認ください。`));
    } else {
      results.push(makeCheck(true, '支払期限', '支払期限は過ぎていません。'));
    }
  } else {
    flaggedFieldIds.add('dueDate');
    results.push(makeCheck(false, '支払期限', '支払期限が入力されていません。'));
  }

  if (data.bankAccount && data.bankAccount.trim()) {
    results.push(makeCheck(true, '振込先の記載', '振込先が記載されています。'));
  } else {
    flaggedFieldIds.add('bankAccount');
    results.push(makeCheck(false, '振込先の記載', '振込先の記載がありません。'));
  }

  applyFieldFlags(flaggedFieldIds);
  return results;
}
function labelToId(label) {
  const map = {
    請求書番号: 'invoiceNumber', 发行日: 'issueDate', 発行日: 'issueDate',
    支払期限: 'dueDate', 振込先: 'bankAccount', 金額: 'total',
  };
  return map[label] || null;
}
function applyFieldFlags(flaggedFieldIds) {
  FIELD_IDS.forEach(id => document.getElementById(id).classList.remove('is-flagged'));
  flaggedFieldIds.forEach(id => {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.classList.add('is-flagged');
  });
}
function makeCheck(passed, label, message) {
  return { passed, label, message };
}
function renderChecks(results) {
  checkList.innerHTML = '';
  results.forEach(result => {
    const li = document.createElement('li');
    li.className = 'check-item ' + (result.passed ? 'check-item--ok' : 'check-item--warn');
    const stamp = document.createElement('div');
    stamp.className = 'check-stamp';
    stamp.textContent = result.passed ? '済' : '要確認';
    const text = document.createElement('div');
    text.className = 'check-item__text';
    const label = document.createElement('p');
    label.className = 'check-item__label';
    label.textContent = result.label;
    const message = document.createElement('p');
    message.className = 'check-item__message';
    message.textContent = result.message;
    text.appendChild(label);
    text.appendChild(message);
    li.appendChild(stamp);
    li.appendChild(text);
    checkList.appendChild(li);
  });
  checkEmpty.hidden = true;
  checkList.hidden = false;
  const allPassed = results.length > 0 && results.every(r => r.passed);
  updateWriteButtonState(allPassed);
}
function hideChecks() {
  checkList.hidden = true;
  checkList.innerHTML = '';
  checkEmpty.hidden = false;
  updateWriteButtonState(false);
}
function updateWriteButtonState(enabled) {
  writeSheetButton.disabled = !enabled;
}

/* ------------------------------------------------------------
   ステータス表示・ローディング・トースト
------------------------------------------------------------ */
function showStatus(message, type) {
  statusArea.textContent = message;
  statusArea.className = 'status-area status--' + type;
  statusArea.hidden = false;
}
function clearStatus() {
  statusArea.hidden = true;
  statusArea.textContent = '';
  statusArea.className = 'status-area';
}
function setLoading(isLoading) {
  loadingOverlay.hidden = !isLoading;
}
let toastTimer = null;
function showToast(message, type) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = 'toast toast--' + type;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}

/* ------------------------------------------------------------
   スプレッドシートへの書き込み
------------------------------------------------------------ */
async function writeToSheet() {
  if (writeSheetButton.disabled) return;

  const data = readFormValues();
  const isDemo = !WEBAPP_URL;

  writeSheetButton.disabled = true;
  writeSheetButton.textContent = '書き込み中…';

  if (isDemo) {
    setTimeout(() => {
      showToast('【デモモード】スプレッドシートへの書き込みをシミュレートしました', 'success');
      writeSheetButton.textContent = 'この内容をスプレッドシートに書き込む';
      updateWriteButtonState(checkList.querySelectorAll('.check-item--warn').length === 0 && !checkList.hidden);
    }, 600);
  } else {
    try {
      const payload = {
        action: 'save',
        data: data
      };

      // POST送信（CORS対策として text/plain で送信）
      const response = await fetch(WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.message || '書き込みに失敗しました');
      }

      showToast('スプレッドシートに正常に書き込みました', 'success');
    } catch (err) {
      console.error(err);
      showToast('書き込みに失敗しました：' + (err.message || err), 'error');
    } finally {
      writeSheetButton.textContent = 'この内容をスプレッドシートに書き込む';
      updateWriteButtonState(checkList.querySelectorAll('.check-item--warn').length === 0 && !checkList.hidden);
    }
  }
}

/* ------------------------------------------------------------
   起動
------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', init);

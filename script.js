/* ============================================================
   請求書チェックツール V2 - script.js
   ------------------------------------------------------------
   ■ 機能概要：
   1. 複数ファイル一括選択・ドラッグ＆ドロップ対応
   2. Gemini API / デモモードでの一括AI読み取り
   3. スプレッドシート形式の検証テーブル（重複チェック ＋ 4列検印チェック）
   4. 不備・要確認箇所のセル単位ハイライト表示
   5. 全データのGASスプレッドシート一括書き込み
   ============================================================ */

// ==========================================
// ★ 設定項目（ご自身の環境に合わせて変更してください）
// ==========================================
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbyX9Zs8QPUg64gtpcqtcozNx2004kLSFDUbdX8pE_alnvTK-1ftNZ66Cy5AF3HbxIqhLQ/exec';
// ==========================================

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
const MAX_FILE_SIZE_MB = 15;

/* ------------------------------------------------------------
   状態管理
------------------------------------------------------------ */
let selectedFiles = [];
let processedResults = [];

/* ------------------------------------------------------------
   DOM要素の取得
------------------------------------------------------------ */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

const fileSelectionArea = document.getElementById('fileSelectionArea');
const selectedCountBadge = document.getElementById('selectedCountBadge');
const fileListContainer = document.getElementById('fileListContainer');
const resetFilesButton = document.getElementById('resetFilesButton');
const processButton = document.getElementById('processButton');
const statusArea = document.getElementById('statusArea');

const tableSummary = document.getElementById('tableSummary');
const totalRowsCount = document.getElementById('totalRowsCount');
const okRowsCount = document.getElementById('okRowsCount');
const warnRowsCount = document.getElementById('warnRowsCount');
const dupRowsCount = document.getElementById('dupRowsCount');

const tableEmpty = document.getElementById('tableEmpty');
const tableWrapper = document.getElementById('tableWrapper');
const invoiceTableBody = document.getElementById('invoiceTableBody');
const writeSheetButton = document.getElementById('writeSheetButton');

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const loadingProgress = document.getElementById('loadingProgress');
const toast = document.getElementById('toast');

/* ------------------------------------------------------------
   初期化
------------------------------------------------------------ */
function init() {
  if (!WEBAPP_URL) {
    showStatus(
      '【デモモード】現在 WEBAPP_URL が未設定のためデモモードで動作します。試用用ダミーデータで動作検証が可能です。',
      'info'
    );
  }

  // ドロップゾーンイベント
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
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      addFiles(Array.from(fileInput.files));
    }
  });

  resetFilesButton.addEventListener('click', resetSelection);
  processButton.addEventListener('click', processFiles);
  writeSheetButton.addEventListener('click', writeToSheet);
}

/* ------------------------------------------------------------
   ファイル選択管理
------------------------------------------------------------ */
function addFiles(files) {
  clearStatus();
  const validFiles = [];

  for (const file of files) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showStatus(`「${file.name}」は未対応の形式です。PNG・JPG・PDFを選択してください。`, 'error');
      continue;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      showStatus(`「${file.name}」はサイズ超過です（上限${MAX_FILE_SIZE_MB}MB）。`, 'error');
      continue;
    }
    // 同名ファイル等の重複登録防止
    if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      validFiles.push(file);
    }
  }

  selectedFiles = selectedFiles.concat(validFiles);
  updateFileSelectionUI();
}

function updateFileSelectionUI() {
  if (selectedFiles.length === 0) {
    fileSelectionArea.hidden = true;
    dropZone.hidden = false;
    processButton.disabled = true;
    return;
  }

  dropZone.hidden = true;
  fileSelectionArea.hidden = false;
  selectedCountBadge.textContent = `${selectedFiles.length}件`;

  fileListContainer.innerHTML = '';
  selectedFiles.forEach((file) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    const icon = file.type === 'application/pdf' ? '📕' : '🖼️';
    chip.textContent = `${icon} ${file.name}`;
    fileListContainer.appendChild(chip);
  });

  processButton.disabled = false;
}

function resetSelection() {
  fileInput.value = '';
  selectedFiles = [];
  processedResults = [];
  updateFileSelectionUI();
  renderTable();
  clearStatus();
}

/* ------------------------------------------------------------
   一括読み取り処理
------------------------------------------------------------ */
async function processFiles() {
  if (selectedFiles.length === 0) return;

  clearStatus();
  processedResults = [];
  setLoading(true, 'Geminiが請求書を一括読み取り中…', `0 / ${selectedFiles.length} 件完了`);

  const isDemo = !WEBAPP_URL;

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    setLoading(true, 'Geminiが請求書を一括読み取り中…', `${i + 1} / ${selectedFiles.length} 件目: 「${file.name}」を解析中`);

    try {
      let extractedData;
      if (isDemo) {
        extractedData = await getMockInvoiceData(file.name, i);
      } else {
        const base64Data = await fileToBase64(file);
        extractedData = await extractInvoiceWithGemini(base64Data, file.type);
      }

      const analyzedResult = analyzeInvoiceData(file, extractedData);
      processedResults.push(analyzedResult);
    } catch (err) {
      console.error(err);
      // 解析エラー時もダミー行を挿入して要確認とする
      processedResults.push({
        fileName: file.name,
        fileSize: file.size,
        invoiceNumber: '',
        issueDate: '',
        dueDate: '',
        subtotal: 0,
        tax: 0,
        total: 0,
        bankAccount: '',
        isDuplicate: false,
        check1_required: false,
        check2_calc: false,
        check3_dueDate: false,
        check4_bank: false,
        errorMessage: err.message || '読み取り失敗',
        flaggedFields: { invoiceNumber: true, issueDate: true, dueDate: true, subtotal: true, tax: true, total: true, bankAccount: true }
      });
    }
  }

  // 重複フラグの相互判定（全体での再判定）
  applyDuplicateCheck(processedResults);

  setLoading(false);
  renderTable();

  const isAnyWarn = processedResults.some(r => !r.check1_required || !r.check2_calc || !r.check3_dueDate || !r.check4_bank || r.isDuplicate);
  if (isAnyWarn) {
    showStatus('読み取りが完了しました。要確認または重複のある行をご確認ください（不備含めそのまま書き込み可能です）。', 'info');
  } else {
    showStatus('全件の読み取り・検証が正常に完了しました。', 'success');
  }
}

/* ------------------------------------------------------------
   データ検証 ＆ チェック判定
------------------------------------------------------------ */
function analyzeInvoiceData(file, data) {
  const invoiceNumber = (data.invoiceNumber || '').trim();
  const issueDate = (data.issueDate || '').trim();
  const dueDate = (data.dueDate || '').trim();
  const subtotal = parseAmount(data.subtotal);
  const tax = parseAmount(data.tax);
  const total = parseAmount(data.total);
  const bankAccount = (data.bankAccount || '').trim();

  const flaggedFields = {
    invoiceNumber: !invoiceNumber,
    issueDate: !issueDate,
    dueDate: !dueDate,
    subtotal: false,
    tax: false,
    total: false,
    bankAccount: !bankAccount
  };

  // 必須項目チェック
  const check1_required = Boolean(invoiceNumber && issueDate && dueDate && bankAccount && (total || subtotal));

  // 税額計算チェック
  const expectedTotal = subtotal + tax;
  const totalDiff = Math.abs(expectedTotal - total);
  let check2_calc = false;
  if (subtotal || tax || total) {
    check2_calc = totalDiff <= 1;
    if (!check2_calc) {
      flaggedFields.subtotal = true;
      flaggedFields.tax = true;
      flaggedFields.total = true;
    }
  } else {
    flaggedFields.subtotal = true;
    flaggedFields.total = true;
  }

  // 支払期限チェック
  let check3_dueDate = false;
  if (dueDate) {
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!isNaN(due.getTime()) && due.getTime() >= today.getTime()) {
      check3_dueDate = true;
    } else {
      flaggedFields.dueDate = true;
    }
  } else {
    flaggedFields.dueDate = true;
  }

  // 振込先チェック
  const check4_bank = Boolean(bankAccount);
  if (!check4_bank) flaggedFields.bankAccount = true;

  return {
    fileName: file.name,
    fileSize: file.size,
    invoiceNumber,
    issueDate,
    dueDate,
    subtotal,
    tax,
    total,
    bankAccount,
    isDuplicate: false, // 後段で計算
    check1_required,
    check2_calc,
    check3_dueDate,
    check4_bank,
    flaggedFields
  };
}

function applyDuplicateCheck(results) {
  // 全行の重複フラグを初期化
  results.forEach(r => r.isDuplicate = false);

  // ファイル名に依存せず、抽出された必須項目の完全・主要一致で重複判定を行う
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const a = results[i];
      const b = results[j];

      // 項目単位の標準化比較
      const invA = (a.invoiceNumber || '').trim().toUpperCase();
      const invB = (b.invoiceNumber || '').trim().toUpperCase();
      const bankA = (a.bankAccount || '').replace(/\s+/g, '').toUpperCase();
      const bankB = (b.bankAccount || '').replace(/\s+/g, '').toUpperCase();

      const invMatch = invA !== '' && invA === invB;
      const totalMatch = (a.total || 0) === (b.total || 0) && (a.total > 0);
      const bankMatch = bankA !== '' && bankA === bankB;
      const issueMatch = a.issueDate !== '' && a.issueDate === b.issueDate;
      const dueMatch = a.dueDate !== '' && a.dueDate === b.dueDate;

      let isDup = false;

      // 判定基準1: 請求書番号が存在し一致 ＋ (金額一致 OR 振込先一致 OR 発行日一致)
      if (invMatch && (totalMatch || bankMatch || issueMatch)) {
        isDup = true;
      }
      // 判定基準2: 請求書番号が空でも、金額・振込先・発行日・支払期限などの主要項目が一致
      else if (!invA && !invB && totalMatch && bankMatch && issueMatch && dueMatch) {
        isDup = true;
      }
      // 判定基準3: 金額・振込先・発行日がすべて一致
      else if (totalMatch && bankMatch && issueMatch) {
        isDup = true;
      }

      if (isDup) {
        a.isDuplicate = true;
        b.isDuplicate = true;
      }
    }
  }
}

/* ------------------------------------------------------------
   テーブル描画
------------------------------------------------------------ */
function renderTable() {
  if (processedResults.length === 0) {
    tableEmpty.hidden = false;
    tableWrapper.hidden = true;
    tableSummary.hidden = true;
    writeSheetButton.disabled = true;
    invoiceTableBody.innerHTML = '';
    return;
  }

  tableEmpty.hidden = true;
  tableWrapper.hidden = false;
  tableSummary.hidden = false;
  writeSheetButton.disabled = false;

  invoiceTableBody.innerHTML = '';

  let okCount = 0;
  let warnCount = 0;
  let dupCount = 0;

  processedResults.forEach((row, idx) => {
    const isWarnRow = !row.check1_required || !row.check2_calc || !row.check3_dueDate || !row.check4_bank;
    if (row.isDuplicate) dupCount++;
    if (isWarnRow) warnCount++; else okCount++;

    const tr = document.createElement('tr');
    if (isWarnRow || row.isDuplicate) tr.classList.add('row-has-warn');

    tr.innerHTML = `
      <td class="col-num">${idx + 1}</td>
      <td class="col-filename" title="${escapeHtml(row.fileName)}">${escapeHtml(row.fileName)}</td>
      <td class="${row.flaggedFields.invoiceNumber ? 'cell-flagged' : ''}">${escapeHtml(row.invoiceNumber || '（未入力）')}</td>
      <td class="${row.flaggedFields.issueDate ? 'cell-flagged' : ''}">${escapeHtml(row.issueDate || '（未入力）')}</td>
      <td class="${row.flaggedFields.dueDate ? 'cell-flagged' : ''}">${escapeHtml(row.dueDate || '（未入力）')}</td>
      <td class="${row.flaggedFields.subtotal ? 'cell-flagged' : ''}">${formatMoney(row.subtotal)}</td>
      <td class="${row.flaggedFields.tax ? 'cell-flagged' : ''}">${formatMoney(row.tax)}</td>
      <td class="${row.flaggedFields.total ? 'cell-flagged' : ''}">${formatMoney(row.total)}</td>
      <td class="col-bank ${row.flaggedFields.bankAccount ? 'cell-flagged' : ''}" title="${escapeHtml(row.bankAccount)}">${escapeHtml(row.bankAccount || '（未入力）')}</td>
      <td class="col-check">${row.isDuplicate ? '<span class="badge badge-dup">重複あり</span>' : '<span class="badge badge-none">なし</span>'}</td>
      <td class="col-check">${renderBadge(row.check1_required)}</td>
      <td class="col-check">${renderBadge(row.check2_calc)}</td>
      <td class="col-check">${renderBadge(row.check3_dueDate)}</td>
      <td class="col-check">${renderBadge(row.check4_bank)}</td>
    `;
    invoiceTableBody.appendChild(tr);
  });

  totalRowsCount.textContent = String(processedResults.length);
  okRowsCount.textContent = String(okCount);
  warnRowsCount.textContent = String(warnCount);
  dupRowsCount.textContent = String(dupCount);
}

function renderBadge(passed) {
  return passed
    ? '<span class="badge badge-ok">済</span>'
    : '<span class="badge badge-warn">要確認</span>';
}

function formatMoney(num) {
  if (!num && num !== 0) return '0円';
  return `${Number(num).toLocaleString()}円`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

function parseAmount(value) {
  const cleaned = String(value || '').replace(/[,¥円\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/* ------------------------------------------------------------
   GAS API ＆ デモモード
------------------------------------------------------------ */
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

async function extractInvoiceWithGemini(base64Data, mimeType) {
  const payload = {
    action: 'extract',
    base64Data: base64Data,
    mimeType: mimeType
  };

  const response = await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
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

function getMockInvoiceData(fileName, index) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const today = new Date();
      const issue = new Date(today);
      issue.setDate(issue.getDate() - (index * 2 + 5));

      const due = new Date(today);
      due.setDate(due.getDate() + (index === 1 ? -3 : 20));

      const invNo = index === 2 ? 'INV-2026-0001' : `INV-2026-000${index + 1}`;
      const isMissingBank = index === 3;

      resolve({
        invoiceNumber: invNo,
        issueDate: formatDateYMD(issue),
        dueDate: formatDateYMD(due),
        subtotal: (index + 1) * 50000,
        tax: (index + 1) * 5000,
        total: (index + 1) * 55000,
        bankAccount: isMissingBank ? '' : 'テスト銀行 本店営業部 普通 1234567 カ）テスト商事',
      });
    }, 600);
  });
}

function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ------------------------------------------------------------
   スプレッドシート書き込み（13列 A〜M 送信対応）
------------------------------------------------------------ */
async function writeToSheet() {
  if (processedResults.length === 0 || writeSheetButton.disabled) return;

  const isDemo = !WEBAPP_URL;

  writeSheetButton.disabled = true;

  if (isDemo) {
    writeSheetButton.textContent = 'スプレッドシートへ書き込み中…';
    setTimeout(() => {
      showToast(`【デモモード】全 ${processedResults.length} 件のデータをスプレッドシートへ書き込み（シミュレーション完了）`, 'success');
      writeSheetButton.textContent = '📊 全データをスプレッドシートに書き込む';
      writeSheetButton.disabled = false;
    }, 1000);
  } else {
    try {
      let successCount = 0;
      const totalCount = processedResults.length;

      for (let i = 0; i < totalCount; i++) {
        const r = processedResults[i];
        writeSheetButton.textContent = `書き込み中 (${i + 1}/${totalCount}件)…`;

        const payload = {
          action: 'save',
          data: {
            invoiceNumber: r.invoiceNumber,
            issueDate: r.issueDate,
            dueDate: r.dueDate,
            subtotal: r.subtotal,
            tax: r.tax,
            total: r.total,
            bankAccount: r.bankAccount,
            isDuplicate: r.isDuplicate ? '重複あり' : 'なし',
            check1_required: r.check1_required ? '済' : '要確認',
            check2_calc: r.check2_calc ? '済' : '要確認',
            check3_dueDate: r.check3_dueDate ? '済' : '要確認',
            check4_bank: r.check4_bank ? '済' : '要確認'
          }
        };

        const response = await fetch(WEBAPP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTPエラー ${response.status}（${r.fileName}）`);
        }

        const result = await response.json();
        if (result.error) {
          throw new Error(result.message || `書き込み失敗（${r.fileName}）`);
        }
        successCount++;
      }

      showToast(`全 ${successCount} 件のデータをスプレッドシートに正常に書き込みました！`, 'success');
    } catch (err) {
      console.error(err);
      showToast('書き込み中にエラーが発生しました：' + (err.message || err), 'error');
    } finally {
      writeSheetButton.textContent = '📊 全データをスプレッドシートに書き込む';
      writeSheetButton.disabled = false;
    }
  }
}

/* ------------------------------------------------------------
   UIユーティリティ
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
function setLoading(isLoading, text = '', progress = '') {
  loadingOverlay.hidden = !isLoading;
  if (text) loadingText.textContent = text;
  if (progress) loadingProgress.textContent = progress;
}
let toastTimer = null;
function showToast(message, type) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = 'toast toast--' + type;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

document.addEventListener('DOMContentLoaded', init);

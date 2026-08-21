/**
 * 工賃明細 自動発行スクリプト（Google Apps Script）
 * ------------------------------------------------------------------
 * 工賃システムのスプレッドシートに貼り付けて使います。
 * 既存の集計データ（振込CSVの元データ）を読み込み、
 * 全利用者分の工賃明細を「1つのPDF」にまとめて Google ドライブへ保存します。
 *
 * ・1名 = 1ページ（改ページで区切り）→ 印刷して各人へ配布できます。
 * ・保存先は指定したフォルダ（SAVE_FOLDER_ID）に直接保存します。
 *
 * 使い方:
 *   1. スプレッドシートを開く →「拡張機能」→「Apps Script」
 *   2. このファイルの内容を貼り付けて保存
 *   3. 下の CONFIG を自分のシートに合わせて設定
 *   4. スプレッドシートを再読み込み → メニュー「工賃明細」→「明細を発行」
 * ------------------------------------------------------------------
 */

/** ===== 設定（ここだけ自分のシートに合わせる） ===== */
var CONFIG = {
  // 明細の元になるシート名（1行 = 1明細行 を想定）
  DATA_SHEET_NAME: '明細データ',

  // 見出し（ヘッダー）がある行番号
  HEADER_ROW: 1,

  // 列は「見出しの文字」で自動判定します。実際のシートの見出し名に合わせてください。
  // 使わない項目は '' （空文字）にすると明細に出しません。
  COL: {
    userName:  '利用者名',   // 必須：この列で利用者ごとにまとめます（1名1ページ）
    date:      '日付',       // 作業日など（任意）
    content:   '内容',       // 作業内容・項目名など（任意）
    unitPrice: '単価',       // 単価（任意）
    quantity:  '件数',       // 件数・数量（任意）
    amount:    '金額',       // 必須：合計に使う金額列
    deduction: '',           // 控除（任意）例: '控除'
    note:      ''            // 備考（任意）例: '備考'
  },

  // 保存先フォルダのID（このフォルダの中に1つのPDFを保存します）
  // フォルダを開いたときのURL .../folders/ここがID の部分をコピー
  // 空のままなら、マイドライブ直下に「工賃明細」フォルダを作って保存します。
  SAVE_FOLDER_ID: '',

  // 明細に載せる発行元名
  SHOP_NAME: 'anela',

  // 振込予定日を「特定セル」から取りたい場合に指定（例: '設定!B2'）。空なら明細に出しません。
  PAYMENT_DATE_A1: '',

  // 金額の通貨記号
  CURRENCY: '¥'
};
/** ===== 設定ここまで ===== */


/** スプレッドシートを開いたときにメニューを追加 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('工賃明細')
    .addItem('明細を発行（PDF・全員分1ファイル）', 'issueWageStatements')
    .addToUi();
}

/** メイン処理：全利用者分の明細を1つのPDFにまとめて発行 */
function issueWageStatements() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 対象月のラベルを確認（ファイル名・明細タイトルに使用）
  var defaultLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy年MM月');
  var res = ui.prompt(
    '工賃明細の発行',
    '対象月を入力してください（例: ' + defaultLabel + '）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var monthLabel = (res.getResponseText() || defaultLabel).trim();

  // データ読み込み
  var sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME);
  if (!sheet) {
    ui.alert('シート「' + CONFIG.DATA_SHEET_NAME + '」が見つかりません。CONFIG.DATA_SHEET_NAME を確認してください。');
    return;
  }
  var values = sheet.getDataRange().getValues();
  if (values.length <= CONFIG.HEADER_ROW) {
    ui.alert('データがありません。');
    return;
  }

  var header = values[CONFIG.HEADER_ROW - 1];
  var idx = resolveColumns_(header);
  if (idx.userName < 0) {
    ui.alert('利用者名の列「' + CONFIG.COL.userName + '」が見つかりません。見出し名を確認してください。');
    return;
  }
  if (idx.amount < 0) {
    ui.alert('金額の列「' + CONFIG.COL.amount + '」が見つかりません。見出し名を確認してください。');
    return;
  }

  // 利用者ごとに行をまとめる
  var groups = {};   // userName -> [rows]
  var order = [];    // 出現順を保持
  for (var r = CONFIG.HEADER_ROW; r < values.length; r++) {
    var row = values[r];
    var name = String(row[idx.userName] || '').trim();
    if (!name) continue;
    if (!groups[name]) { groups[name] = []; order.push(name); }
    groups[name].push(row);
  }
  if (order.length === 0) {
    ui.alert('対象の利用者が見つかりませんでした。');
    return;
  }

  // 振込予定日（任意・全体共通）
  var paymentDate = '';
  if (CONFIG.PAYMENT_DATE_A1) {
    try {
      var pv = ss.getRange(CONFIG.PAYMENT_DATE_A1).getValue();
      paymentDate = formatMaybeDate_(pv);
    } catch (e) { /* 指定が不正なら無視 */ }
  }

  // 全員分のページを1つのHTMLに連結（1名 = 1ページ）
  var pages = [];
  for (var i = 0; i < order.length; i++) {
    var name2 = order[i];
    pages.push(buildStatementPageHtml_(name2, groups[name2], idx, monthLabel, paymentDate));
  }
  var html = wrapDocument_(pages.join('\n'));

  // 1つのPDFに変換
  var fileName = '工賃明細_' + sanitizeFileName_(monthLabel) + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'wage.html')
                     .getAs('application/pdf')
                     .setName(fileName);

  // 保存先フォルダ（指定があればそのフォルダ、なければマイドライブ直下に作成）
  var folder = getSaveFolder_();

  // 同名ファイルがあれば上書き（古いものはゴミ箱へ）
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) { existing.next().setTrashed(true); }

  var file = folder.createFile(pdf);

  ss.toast(order.length + '名分の工賃明細を1ファイルで発行しました。', '工賃明細', 5);
  ui.alert(
    '発行が完了しました。\n\n' +
    '対象月: ' + monthLabel + '\n' +
    '人数: ' + order.length + '名（1名1ページ）\n' +
    'ファイル: ' + fileName + '\n\n' +
    'PDF URL:\n' + file.getUrl()
  );
}

/** 見出し行から各項目の列インデックスを解決（見つからなければ -1） */
function resolveColumns_(header) {
  function find(name) {
    if (!name) return -1;
    for (var c = 0; c < header.length; c++) {
      if (String(header[c]).trim() === String(name).trim()) return c;
    }
    return -1;
  }
  return {
    userName:  find(CONFIG.COL.userName),
    date:      find(CONFIG.COL.date),
    content:   find(CONFIG.COL.content),
    unitPrice: find(CONFIG.COL.unitPrice),
    quantity:  find(CONFIG.COL.quantity),
    amount:    find(CONFIG.COL.amount),
    deduction: find(CONFIG.COL.deduction),
    note:      find(CONFIG.COL.note)
  };
}

/** ドキュメント全体（PDF）のHTMLラッパー。1名=1ページになるようCSSで改ページ */
function wrapDocument_(pagesHtml) {
  return '' +
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  '@page{size:A4;margin:14mm;}' +
  'body{font-family:"Hiragino Sans","Yu Gothic",sans-serif;color:#222;font-size:12px;margin:0;}' +
  '.page{page-break-after:always;}' +
  '.page:last-child{page-break-after:auto;}' +
  '.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:16px;}' +
  '.title{font-size:20px;font-weight:bold;letter-spacing:2px;}' +
  '.shop{text-align:right;font-size:12px;color:#555;}' +
  '.to{font-size:15px;margin:12px 0 4px;}' +
  '.to b{font-size:17px;border-bottom:1px solid #999;padding:0 24px 2px 4px;}' +
  '.meta{color:#555;margin:2px 0;}' +
  'table{width:100%;border-collapse:collapse;margin-top:14px;}' +
  'th,td{border:1px solid #bbb;padding:6px 8px;}' +
  'th{background:#f0f0f0;text-align:left;font-weight:bold;}' +
  '.num{text-align:right;white-space:nowrap;}' +
  '.sum td{background:#fafafa;font-weight:bold;}' +
  '.total td{background:#333;color:#fff;font-size:14px;font-weight:bold;}' +
  '.foot{margin-top:24px;color:#777;font-size:11px;}' +
  '</style></head><body>' +
  pagesHtml +
  '</body></html>';
}

/** 1利用者分の明細ページ（PDFの1ページ）を組み立て */
function buildStatementPageHtml_(userName, rows, idx, monthLabel, paymentDate) {
  var showDate    = idx.date >= 0;
  var showContent = idx.content >= 0;
  var showUnit    = idx.unitPrice >= 0;
  var showQty     = idx.quantity >= 0;
  var showNote    = idx.note >= 0;
  var showDeduct  = idx.deduction >= 0;

  var subtotal = 0;
  var deductTotal = 0;
  var bodyRows = '';

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var amount = toNumber_(row[idx.amount]);
    subtotal += amount;
    var deduct = showDeduct ? toNumber_(row[idx.deduction]) : 0;
    deductTotal += deduct;

    bodyRows += '<tr>';
    if (showDate)    bodyRows += '<td>' + esc_(formatMaybeDate_(row[idx.date])) + '</td>';
    if (showContent) bodyRows += '<td>' + esc_(row[idx.content]) + '</td>';
    if (showUnit)    bodyRows += '<td class="num">' + money_(row[idx.unitPrice]) + '</td>';
    if (showQty)     bodyRows += '<td class="num">' + esc_(row[idx.quantity]) + '</td>';
    bodyRows += '<td class="num">' + money_(amount) + '</td>';
    if (showNote)    bodyRows += '<td>' + esc_(row[idx.note]) + '</td>';
    bodyRows += '</tr>';
  }

  var payable = subtotal - deductTotal;

  // ヘッダーのth
  var ths = '';
  if (showDate)    ths += '<th>日付</th>';
  if (showContent) ths += '<th>内容</th>';
  if (showUnit)    ths += '<th class="num">単価</th>';
  if (showQty)     ths += '<th class="num">件数</th>';
  ths += '<th class="num">金額</th>';
  if (showNote)    ths += '<th>備考</th>';
  var colCount = (showDate?1:0)+(showContent?1:0)+(showUnit?1:0)+(showQty?1:0)+1+(showNote?1:0);

  // 合計欄
  var totalsHtml = '<tr class="sum"><td colspan="' + (colCount - 1) + '">小計</td>' +
                   '<td class="num">' + money_(subtotal) + '</td></tr>';
  if (showDeduct) {
    totalsHtml += '<tr class="sum"><td colspan="' + (colCount - 1) + '">控除</td>' +
                  '<td class="num">- ' + money_(deductTotal) + '</td></tr>';
  }
  var payableHtml = '<tr class="total"><td colspan="' + (colCount - 1) + '">振込予定額</td>' +
                    '<td class="num">' + money_(payable) + '</td></tr>';

  var issuedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
  var paymentRow = paymentDate ? '<div class="meta">振込予定日：' + esc_(paymentDate) + '</div>' : '';

  return '' +
  '<div class="page">' +
  '<div class="head"><div class="title">工賃明細</div>' +
  '<div class="shop">' + esc_(CONFIG.SHOP_NAME) + '<br>発行日：' + issuedAt + '</div></div>' +
  '<div class="meta">対象月：' + esc_(monthLabel) + '</div>' +
  paymentRow +
  '<div class="to"><b>' + esc_(userName) + '</b>　様</div>' +
  '<table><thead><tr>' + ths + '</tr></thead>' +
  '<tbody>' + bodyRows + totalsHtml + payableHtml + '</tbody></table>' +
  '<div class="foot">本明細に関するお問い合わせは ' + esc_(CONFIG.SHOP_NAME) + ' までご連絡ください。</div>' +
  '</div>';
}

/* ===== 補助関数 ===== */

function getSaveFolder_() {
  if (CONFIG.SAVE_FOLDER_ID) {
    try { return DriveApp.getFolderById(CONFIG.SAVE_FOLDER_ID); }
    catch (e) { /* IDが不正ならマイドライブに作成 */ }
  }
  var root = DriveApp.getRootFolder();
  var it = root.getFoldersByName('工賃明細');
  if (it.hasNext()) return it.next();
  return root.createFolder('工賃明細');
}

function toNumber_(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  var n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function money_(v) {
  var n = toNumber_(v);
  return CONFIG.CURRENCY + n.toLocaleString('ja-JP');
}

function formatMaybeDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MM/dd');
  }
  return v === null || v === undefined ? '' : String(v);
}

function esc_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeFileName_(name) {
  return String(name).replace(/[\\\/:*?"<>|]/g, '_').trim();
}

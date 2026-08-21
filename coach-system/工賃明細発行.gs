/**
 * 工賃明細 自動発行スクリプト（Google Apps Script）
 * ------------------------------------------------------------------
 * 就労継続支援B型「工賃システム」のスプレッドシートに貼り付けて使います。
 * 「工賃履歴」シート（毎月の計算結果が積み上がるシート）を元に、
 * 選んだ対象月の全利用者分の工賃明細を「1つのPDF」にまとめて
 * Google ドライブの指定フォルダへ保存します。
 *
 * ・1名 = 1ページ（改ページで区切り）→ 印刷して各人へ配布できます。
 * ・B型工賃は雑所得（源泉/社保/雇用保険の天引きなし）のため、
 *   工賃 ＝ 振込予定額 として表示します（控除欄なし）。
 *
 * 使い方:
 *   1. 工賃システムのスプレッドシートを開く →「拡張機能」→「Apps Script」
 *   2. 左の「＋」で新しいスクリプトファイル（工賃明細発行.gs）を追加し、このファイルの全文を貼り付けて保存
 *   3. 既存の「コード.gs」も、メニューに③を足した全文へ丸ごと貼り替えて保存
 *   4. 下の CONFIG（SAVE_FOLDER_ID・SHOP_NAME）は設定済み
 *   5. スプレッドシートを再読み込み → メニュー「工賃システム」→「③ 工賃明細を発行（PDF・全員分）」
 *   6. 対象月を番号で選ぶ → PDFが指定フォルダに保存されます
 *
 *   ※このファイルは onOpen を持ちません。メニューの③は「コード.gs」の onOpen 側に
 *     統合済みです（onOpen が2つあるとメニューが片方しか出ないため）。
 * ------------------------------------------------------------------
 */

/** ===== 設定（ここだけ自分の環境に合わせる） ===== */
var CONFIG = {
  // 明細の元データ（毎月ぶんが積み上がる履歴シート）
  DATA_SHEET_NAME: '工賃履歴',
  HEADER_ROW: 1,

  // 「工賃履歴」の見出し名（列は見出しの文字で自動判定します）
  //   実際の見出し：計算日 / 対象期間 / 氏名 / 受給者証番号 / 作業時間 / 時給(円) / 工賃(円)
  COL: {
    period:    '対象期間',   // 必須：この列の値で対象月を選びます
    userName:  '氏名',       // 必須：この列で利用者ごとにまとめます（1名1ページ）
    workTime:  '作業時間',   // 作業合計時間（HH:MM）
    unitPrice: '時給(円)',   // 時給
    amount:    '工賃(円)'    // 必須：振込予定額に使う金額列
  },

  // 保存先フォルダのID（このフォルダの中に1つのPDFを保存します）
  // フォルダを開いたときのURL .../folders/ここがID の部分をコピー
  // ※このフォルダは「スクリプトの実行アカウント」から見える必要があります。
  //   別アカウントのフォルダの場合は、実行アカウントに「編集者」で共有してください。
  //   アクセスできないときは（黙って別の場所に保存せず）エラーで知らせます。
  // 保存先：利用者勤怠 ＞ 工賃明細
  SAVE_FOLDER_ID: '1zkZrQkcV7XGVxadShtPW6C_ob-In-YY-',

  // 明細に印字する事業所名（発行元）
  SHOP_NAME: 'ANELLA CAFE 南浦和店',

  // 金額の通貨記号
  CURRENCY: '¥'
};
/** ===== 設定ここまで ===== */


/*
 * ▼ メニューについて
 *   このファイルは onOpen を持ちません。メニューの③（工賃明細を発行）は
 *   「コード.gs」の onOpen 側に統合済みです。両ファイルを全文で貼り替えれば動きます。
 */

/** メイン処理：選んだ対象月の全利用者分を1つのPDFにまとめて発行 */
function issueWageStatements() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // データ読み込み
  var sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME);
  if (!sheet) {
    ui.alert('シート「' + CONFIG.DATA_SHEET_NAME + '」が見つかりません。CONFIG.DATA_SHEET_NAME を確認してください。');
    return;
  }
  var values = sheet.getDataRange().getValues();
  if (values.length <= CONFIG.HEADER_ROW) {
    ui.alert('データがありません。まず工賃計算を実行してください。');
    return;
  }

  var header = values[CONFIG.HEADER_ROW - 1];
  var idx = resolveColumns_(header);
  if (idx.userName < 0) {
    ui.alert('氏名の列「' + CONFIG.COL.userName + '」が見つかりません。見出し名を確認してください。');
    return;
  }
  if (idx.amount < 0) {
    ui.alert('工賃の列「' + CONFIG.COL.amount + '」が見つかりません。見出し名を確認してください。');
    return;
  }
  if (idx.period < 0) {
    ui.alert('対象期間の列「' + CONFIG.COL.period + '」が見つかりません。見出し名を確認してください。');
    return;
  }

  // 対象期間の一覧（出現順→新しいものを上に）を作り、番号で選んでもらう
  var periods = [];
  var seen = {};
  for (var r = CONFIG.HEADER_ROW; r < values.length; r++) {
    var p = String(values[r][idx.period] || '').trim();
    if (!p || seen[p]) continue;
    seen[p] = true;
    periods.push(p);
  }
  if (periods.length === 0) {
    ui.alert('対象期間のデータが見つかりませんでした。');
    return;
  }
  periods.reverse(); // 新しい期間を先頭に

  var listText = '';
  for (var i = 0; i < periods.length; i++) {
    listText += (i + 1) + ') ' + periods[i] + '\n';
  }
  var res = ui.prompt(
    '工賃明細の発行',
    '発行する対象月を番号で選んでください（空欄なら 1 番）:\n\n' + listText,
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var pick = String(res.getResponseText() || '1').trim();
  var num = parseInt(pick, 10);
  if (isNaN(num) || num < 1 || num > periods.length) {
    ui.alert('番号「' + pick + '」が正しくありません。1〜' + periods.length + ' の番号を入力してください。');
    return;
  }
  var targetPeriod = periods[num - 1];

  // 対象期間の行だけを利用者ごとにまとめる（通常は1名1行）
  var groups = {};   // userName -> [rows]
  var order = [];    // 出現順を保持
  for (var r2 = CONFIG.HEADER_ROW; r2 < values.length; r2++) {
    var row = values[r2];
    if (String(row[idx.period] || '').trim() !== targetPeriod) continue;
    var name = String(row[idx.userName] || '').trim();
    if (!name || name === '合計') continue;
    if (!groups[name]) { groups[name] = []; order.push(name); }
    groups[name].push(row);
  }
  if (order.length === 0) {
    ui.alert('対象月「' + targetPeriod + '」の利用者が見つかりませんでした。');
    return;
  }

  // 全員分のページを1つのHTMLに連結（1名 = 1ページ）
  var pages = [];
  for (var j = 0; j < order.length; j++) {
    var name2 = order[j];
    pages.push(buildStatementPageHtml_(name2, groups[name2], idx, targetPeriod));
  }
  var html = wrapDocument_(pages.join('\n'));

  // 1つのPDFに変換
  var fileName = '工賃明細_' + sanitizeFileName_(targetPeriod) + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'wage.html')
                     .getAs('application/pdf')
                     .setName(fileName);

  // 保存先フォルダ（別アカウントのフォルダは「編集者」共有が必要）
  var folder;
  try {
    folder = getSaveFolder_();
  } catch (e) {
    ui.alert('保存先フォルダのエラー\n\n' + e.message);
    return;
  }

  // 同名ファイルがあれば上書き（古いものはゴミ箱へ）
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) { existing.next().setTrashed(true); }

  var file = folder.createFile(pdf);

  ss.toast(order.length + '名分の工賃明細を1ファイルで発行しました。', '工賃明細', 5);
  ui.alert(
    '発行が完了しました。\n\n' +
    '対象月: ' + targetPeriod + '\n' +
    '人数: ' + order.length + '名（1名1ページ）\n' +
    'ファイル: ' + fileName + '\n\n' +
    '保存先フォルダ: ' + folder.getName() + '\n' +
    '実行アカウント: ' + currentUserEmail_() + '\n\n' +
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
    period:    find(CONFIG.COL.period),
    userName:  find(CONFIG.COL.userName),
    workTime:  find(CONFIG.COL.workTime),
    unitPrice: find(CONFIG.COL.unitPrice),
    amount:    find(CONFIG.COL.amount)
  };
}

/** ドキュメント全体（PDF）のHTMLラッパー。1名=1ページになるようCSSで改ページ */
function wrapDocument_(pagesHtml) {
  return '' +
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  '@page{size:A4;margin:16mm;}' +
  'body{font-family:"Hiragino Sans","Yu Gothic",sans-serif;color:#222;font-size:13px;margin:0;}' +
  '.page{page-break-after:always;}' +
  '.page:last-child{page-break-after:auto;}' +
  '.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:18px;}' +
  '.title{font-size:22px;font-weight:bold;letter-spacing:3px;}' +
  '.shop{text-align:right;font-size:12px;color:#555;line-height:1.6;}' +
  '.meta{color:#555;margin:2px 0;}' +
  '.to{font-size:16px;margin:18px 0 6px;}' +
  '.to b{font-size:19px;border-bottom:1px solid #999;padding:0 32px 3px 6px;}' +
  'table{width:100%;border-collapse:collapse;margin-top:16px;}' +
  'th,td{border:1px solid #bbb;padding:9px 12px;}' +
  'th{background:#f0f0f0;text-align:left;font-weight:bold;width:40%;}' +
  '.num{text-align:right;white-space:nowrap;}' +
  '.pay th{background:#333;color:#fff;font-size:15px;}' +
  '.pay td{background:#fafafa;font-size:16px;font-weight:bold;}' +
  '.note{margin-top:22px;color:#666;font-size:11px;line-height:1.7;}' +
  '</style></head><body>' +
  pagesHtml +
  '</body></html>';
}

/** 1利用者分の明細ページ（PDFの1ページ）を組み立て
 *  1名につき対象月1行を想定。万一複数行あっても工賃を合算します。 */
function buildStatementPageHtml_(userName, rows, idx, targetPeriod) {
  var showWork = idx.workTime >= 0;
  var showUnit = idx.unitPrice >= 0;

  var totalAmount = 0;
  var workText = '';
  var unitText = '';
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    totalAmount += toNumber_(row[idx.amount]);
    if (i === 0) {
      if (showWork) workText = esc_(row[idx.workTime]);
      if (showUnit) unitText = money_(row[idx.unitPrice]);
    }
  }
  var multi = rows.length > 1; // 複数行あるときは単価・時間の単純表示を控える

  var issuedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');

  var tableRows = '';
  if (showWork && !multi) {
    tableRows += '<tr><th>作業時間</th><td class="num">' + workText + '</td></tr>';
  }
  if (showUnit && !multi) {
    tableRows += '<tr><th>時給</th><td class="num">' + unitText + '</td></tr>';
  }
  tableRows += '<tr class="pay"><th>工賃（振込予定額）</th><td class="num">' + money_(totalAmount) + '</td></tr>';

  return '' +
  '<div class="page">' +
  '<div class="head"><div class="title">工賃明細</div>' +
  '<div class="shop">' + esc_(CONFIG.SHOP_NAME) + '<br>発行日：' + issuedAt + '</div></div>' +
  '<div class="meta">対象月：' + esc_(targetPeriod) + '</div>' +
  '<div class="to"><b>' + esc_(userName) + '</b>　様</div>' +
  '<table><tbody>' + tableRows + '</tbody></table>' +
  '<div class="note">' +
  '※この工賃は就労継続支援B型における作業に対する工賃です（非雇用・雑所得のため源泉徴収等の天引きはありません）。<br>' +
  '本明細に関するお問い合わせは ' + esc_(CONFIG.SHOP_NAME) + ' までご連絡ください。' +
  '</div>' +
  '</div>';
}

/* ===== 補助関数 ===== */

/** 保存先フォルダを返す。指定フォルダにアクセスできない場合は、
 *  黙って別の場所に保存せず、原因（＝共有すべき実行アカウント）が分かるエラーを出す。 */
function getSaveFolder_() {
  if (!CONFIG.SAVE_FOLDER_ID) {
    throw new Error('保存先フォルダIDが未設定です（CONFIG.SAVE_FOLDER_ID を設定してください）。');
  }
  try {
    return DriveApp.getFolderById(CONFIG.SAVE_FOLDER_ID);
  } catch (e) {
    throw new Error(
      '指定した保存先フォルダにアクセスできません。\n' +
      '（別のGoogleアカウントのフォルダの可能性があります）\n\n' +
      '■ このスクリプトの実行アカウント：\n  ' + currentUserEmail_() + '\n\n' +
      '■ 設定中のフォルダID：\n  ' + CONFIG.SAVE_FOLDER_ID + '\n\n' +
      '対処：保存先フォルダを、上の実行アカウントに「編集者」で共有してください。\n' +
      '共有後にもう一度「③ 工賃明細を発行」を実行すれば保存できます。'
    );
  }
}

/** 実行中のGoogleアカウントのメールアドレスを返す（取得できない場合は案内文） */
function currentUserEmail_() {
  try {
    var em = Session.getActiveUser().getEmail();
    return em || '(自動取得できませんでした。Drive右上のアカウント切替でご確認ください)';
  } catch (e) {
    return '(自動取得できませんでした)';
  }
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

function esc_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeFileName_(name) {
  return String(name).replace(/[\\\/:*?"<>|]/g, '_').trim();
}

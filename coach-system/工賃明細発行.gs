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
 *   6. 出てきた画面で対象月をクリックで選び「この月で発行する」→ PDFが指定フォルダに保存されます
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

/** メニュー本体：対象月の選択ダイアログを開く（クリックで選ぶ→手入力ミスなし） */
function issueWageStatements() {
  var info = readPeriods_();
  if (info.error) { SpreadsheetApp.getUi().alert(info.error); return; }
  if (!info.periods.length) { SpreadsheetApp.getUi().alert('対象期間のデータが見つかりませんでした。'); return; }
  var html = HtmlService.createHtmlOutput(getStatementDialogHtml_(info.periods))
    .setWidth(470).setHeight(470);
  SpreadsheetApp.getUi().showModalDialog(html, '工賃明細の発行');
}

/** 「工賃履歴」から対象期間の一覧（新しい順）を返す */
function readPeriods_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME);
  if (!sheet) return { error: 'シート「' + CONFIG.DATA_SHEET_NAME + '」が見つかりません。CONFIG.DATA_SHEET_NAME を確認してください。', periods: [] };
  var values = sheet.getDataRange().getValues();
  if (values.length <= CONFIG.HEADER_ROW) return { error: 'データがありません。まず工賃計算を実行してください。', periods: [] };
  var idx = resolveColumns_(values[CONFIG.HEADER_ROW - 1]);
  if (idx.userName < 0) return { error: '氏名の列「' + CONFIG.COL.userName + '」が見つかりません。見出し名を確認してください。', periods: [] };
  if (idx.amount < 0)   return { error: '工賃の列「' + CONFIG.COL.amount + '」が見つかりません。見出し名を確認してください。', periods: [] };
  if (idx.period < 0)   return { error: '対象期間の列「' + CONFIG.COL.period + '」が見つかりません。見出し名を確認してください。', periods: [] };
  var periods = [], seen = {};
  for (var r = CONFIG.HEADER_ROW; r < values.length; r++) {
    var p = String(values[r][idx.period] || '').trim();
    if (!p || seen[p]) continue;
    seen[p] = true; periods.push(p);
  }
  periods.reverse(); // 新しい期間を先頭に
  return { error: '', periods: periods };
}

/** ダイアログから呼ばれる：指定された対象期間で全員分PDFを発行して保存する */
function generateStatementsForPeriod(targetPeriod) {
  targetPeriod = String(targetPeriod || '').trim();
  if (!targetPeriod) return { ok: false, message: '対象月が選ばれていません。' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME);
  if (!sheet) return { ok: false, message: 'シート「' + CONFIG.DATA_SHEET_NAME + '」が見つかりません。' };
  var values = sheet.getDataRange().getValues();
  var idx = resolveColumns_(values[CONFIG.HEADER_ROW - 1]);

  // 対象期間の行だけを利用者ごとにまとめる（通常は1名1行）
  var groups = {}, order = [];
  for (var r = CONFIG.HEADER_ROW; r < values.length; r++) {
    var row = values[r];
    if (String(row[idx.period] || '').trim() !== targetPeriod) continue;
    var name = String(row[idx.userName] || '').trim();
    if (!name || name === '合計') continue;
    if (!groups[name]) { groups[name] = []; order.push(name); }
    groups[name].push(row);
  }
  if (order.length === 0) return { ok: false, message: '対象月「' + targetPeriod + '」の利用者が見つかりませんでした。' };

  // 全員分のページを1つのHTMLに連結（1名 = 1ページ）→ PDF化
  var pages = [];
  for (var j = 0; j < order.length; j++) {
    pages.push(buildStatementPageHtml_(order[j], groups[order[j]], idx, targetPeriod));
  }
  var html = wrapDocument_(pages.join('\n'));
  var fileName = '工賃明細_' + sanitizeFileName_(targetPeriod) + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'wage.html').getAs('application/pdf').setName(fileName);

  // 保存先フォルダ（別アカウントのフォルダは「編集者」共有が必要）
  var folder;
  try { folder = getSaveFolder_(); }
  catch (e) { return { ok: false, message: e.message }; }

  // 同名ファイルがあれば上書き（古いものはゴミ箱へ）
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
  var file = folder.createFile(pdf);

  return {
    ok: true, period: targetPeriod, count: order.length, fileName: fileName,
    folderName: folder.getName(), account: currentUserEmail_(), url: file.getUrl()
  };
}

/** 対象月えらびダイアログのHTML（ラジオ選択＋発行ボタン。手入力しないのでミスが減る） */
function getStatementDialogHtml_(periods) {
  var items = '';
  for (var i = 0; i < periods.length; i++) {
    var checked = (i === 0) ? 'checked' : '';
    items += '<label class="opt"><input type="radio" name="period" value="' + escAttr_(periods[i]) + '" ' + checked + '><span>' + esc_(periods[i]) + '</span></label>';
  }
  return `
<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8">
<style>
  body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif;margin:0;padding:18px;color:#29261f;font-size:14px;line-height:1.6;}
  h2{font-size:15px;margin:0 0 10px;}
  .list{max-height:230px;overflow:auto;margin-bottom:14px;}
  .opt{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e0d9cc;border-radius:8px;margin:6px 0;cursor:pointer;}
  .opt:hover{background:#f4f7f6;}
  .opt input{width:18px;height:18px;flex:none;}
  button{padding:10px 22px;font-size:14px;font-weight:700;color:#fff;background:#147065;border:0;border-radius:8px;cursor:pointer;}
  button:disabled{background:#b7c3c0;cursor:default;}
  #status{margin-top:14px;color:#555;min-height:20px;white-space:pre-wrap;}
  #status.warn{color:#b23b3b;}
  .ok{color:#147065;font-weight:700;}
  a.btn{display:inline-block;margin-top:6px;color:#147065;font-weight:700;text-decoration:none;}
</style></head><body>
  <h2>発行する対象月を選んでください</h2>
  <div class="list">${items}</div>
  <button id="go" onclick="run()">この月で発行する</button>
  <div id="status"></div>
<script>
  function run(){
    var els=document.getElementsByName('period'), v=null;
    for(var i=0;i<els.length;i++){ if(els[i].checked){ v=els[i].value; break; } }
    var s=document.getElementById('status');
    if(!v){ s.className='warn'; s.textContent='対象月を選んでください。'; return; }
    document.getElementById('go').disabled=true;
    s.className=''; s.textContent='PDFを作成しています…少々お待ちください。';
    google.script.run.withSuccessHandler(done).withFailureHandler(fail).generateStatementsForPeriod(v);
  }
  function done(res){
    var s=document.getElementById('status'); document.getElementById('go').disabled=false;
    if(!res.ok){ s.className='warn'; s.textContent=res.message; return; }
    s.className='';
    s.innerHTML='<span class="ok">発行が完了しました。</span><br>対象月：'+esc(res.period)+'<br>人数：'+res.count+'名（1名1ページ）<br>ファイル：'+esc(res.fileName)+'<br>保存先：'+esc(res.folderName)+'<br>実行アカウント：'+esc(res.account)+'<br><a class="btn" target="_blank" href="'+res.url+'">▶ PDFを開く</a>';
  }
  function fail(e){ var s=document.getElementById('status'); s.className='warn'; s.textContent='エラー：'+e.message; document.getElementById('go').disabled=false; }
  function esc(t){ var d=document.createElement('div'); d.textContent=(t==null?'':t); return d.innerHTML; }
</script></body></html>`;
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

/** HTML属性値用のエスケープ（esc_ に加えてダブルクオートも変換） */
function escAttr_(v) {
  return esc_(v).replace(/"/g, '&quot;');
}

function sanitizeFileName_(name) {
  return String(name).replace(/[\\\/:*?"<>|]/g, '_').trim();
}

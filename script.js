/* =========================================================
 * ANELLA CAFE 南浦和店 予約システム
 * =========================================================
 * ▼▼▼ ここを自分の Supabase プロジェクトの値に書き換えてください ▼▼▼
 */
const SUPABASE_URL = "https://omphuvdamamlseifccfq.supabase.co";
const SUPABASE_KEY = "sb_publishable_nTsYxNVL2N4P3WjSUtSTgw_E1aaCb4d";
/* ▲▲▲ 書き換えはここまで ▲▲▲
 *
 * 予約を保存する Supabase テーブル名
 */
const TABLE_NAME = "reservations";

/* 営業時間の予約枠（必要に応じて編集してください） */
const TIME_SLOTS = [
  "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00",
  "16:00", "17:00",
];

/* =========================================================
 * Supabase クライアント初期化
 * ========================================================= */
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* DOM 参照 */
const form = document.getElementById("reservation-form");
const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");
const timeHint = document.getElementById("time-hint");
const submitBtn = document.getElementById("submit-btn");
const formMessage = document.getElementById("form-message");
const listEl = document.getElementById("reservation-list");
const filterDate = document.getElementById("filter-date");

/* =========================================================
 * 初期化
 * ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  // 過去日を選べないように最小日を今日に設定
  const today = new Date().toISOString().split("T")[0];
  dateInput.min = today;

  loadReservations();
});

/* 予約日が変わったら、その日の空き時間を更新 */
dateInput.addEventListener("change", refreshTimeSlots);

/* 一覧の絞り込み */
filterDate.addEventListener("change", loadReservations);

/* =========================================================
 * 予約済み時間を取得して、選択肢を制御する
 * ========================================================= */
async function refreshTimeSlots() {
  const date = dateInput.value;
  timeSelect.innerHTML = "";
  timeHint.textContent = "";

  if (!date) {
    timeSelect.innerHTML = '<option value="">予約日を選択してください</option>';
    return;
  }

  // 読み込み中表示
  timeSelect.disabled = true;
  timeSelect.innerHTML = '<option value="">読み込み中...</option>';

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("time")
    .eq("date", date);

  timeSelect.disabled = false;

  if (error) {
    timeSelect.innerHTML = '<option value="">読み込みに失敗しました</option>';
    console.error(error);
    return;
  }

  const bookedTimes = (data || []).map((r) => r.time.slice(0, 5));

  timeSelect.innerHTML = '<option value="">時間を選択してください</option>';
  let availableCount = 0;

  TIME_SLOTS.forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot;
    const isBooked = bookedTimes.includes(slot);
    if (isBooked) {
      option.textContent = `${slot}（予約済み）`;
      option.disabled = true;
    } else {
      option.textContent = slot;
      availableCount++;
    }
    timeSelect.appendChild(option);
  });

  timeHint.textContent =
    availableCount > 0
      ? `空き枠：${availableCount} 件`
      : "この日は満員です。別の日をお選びください。";
}

/* =========================================================
 * 予約登録
 * ========================================================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMessage("", "");

  const payload = {
    owner_name: document.getElementById("owner-name").value.trim(),
    dog_name: document.getElementById("dog-name").value.trim(),
    breed: document.getElementById("breed").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    date: dateInput.value,
    time: timeSelect.value,
  };

  if (!payload.time) {
    setMessage("予約時間を選択してください。", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "登録中...";

  // 二重予約防止：登録直前に再チェック
  const { data: existing, error: checkError } = await supabase
    .from(TABLE_NAME)
    .select("id")
    .eq("date", payload.date)
    .eq("time", payload.time);

  if (checkError) {
    setMessage("通信エラーが発生しました。時間をおいて再度お試しください。", "error");
    resetSubmitBtn();
    return;
  }

  if (existing && existing.length > 0) {
    setMessage("申し訳ありません。その時間は既に予約されました。別の時間をお選びください。", "error");
    await refreshTimeSlots();
    resetSubmitBtn();
    return;
  }

  const { error } = await supabase.from(TABLE_NAME).insert([payload]);

  if (error) {
    setMessage("予約の登録に失敗しました：" + error.message, "error");
    resetSubmitBtn();
    return;
  }

  setMessage("ご予約を承りました。ありがとうございます！", "success");
  form.reset();
  timeSelect.innerHTML = '<option value="">予約日を選択してください</option>';
  timeHint.textContent = "";
  resetSubmitBtn();
  loadReservations();
});

function resetSubmitBtn() {
  submitBtn.disabled = false;
  submitBtn.textContent = "予約する";
}

function setMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = "message" + (type ? " " + type : "");
}

/* =========================================================
 * 予約一覧の表示
 * ========================================================= */
async function loadReservations() {
  listEl.innerHTML = '<p class="empty">読み込み中...</p>';

  let query = supabase
    .from(TABLE_NAME)
    .select("*")
    .order("date", { ascending: true })
    .order("time", { ascending: true });

  if (filterDate.value) {
    query = query.eq("date", filterDate.value);
  }

  const { data, error } = await query;

  if (error) {
    listEl.innerHTML = '<p class="empty">予約一覧の読み込みに失敗しました。</p>';
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = '<p class="empty">予約はありません。</p>';
    return;
  }

  listEl.innerHTML = "";
  data.forEach((r) => {
    const item = document.createElement("div");
    item.className = "reservation-item";
    item.innerHTML = `
      <div class="res-head">
        <span class="res-datetime">${formatDate(r.date)} ${r.time.slice(0, 5)}</span>
      </div>
      <div class="res-dog">${escapeHtml(r.dog_name)}（${escapeHtml(r.breed)}）</div>
      <div class="res-detail">飼い主：${escapeHtml(r.owner_name)} / TEL：${escapeHtml(r.phone)}</div>
    `;
    listEl.appendChild(item);
  });
}

/* =========================================================
 * ユーティリティ
 * ========================================================= */
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const week = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${week[d.getDay()]})`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

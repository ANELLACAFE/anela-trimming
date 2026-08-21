// ── Supabase 初期化 ──
const SUPABASE_URL = "https://omphuvdamamlseifccfq.supabase.co";
const SUPABASE_KEY = "sb_publishable_nTsYxNVL2N4P3WjSUtSTgw_E1aaCb4d";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function uploadCertImage(inputId, label) {
    const file = document.getElementById(inputId)?.files[0];
    if (!file) return "未提出";
    const path = `certificates/${Date.now()}_${label}_${file.name}`;
    const { error } = await _supabase.storage.from("trimming-photos").upload(path, file, { upsert: true });
    if (error) { console.error("画像アップロードエラー:", error); return file.name; }
    const { data } = _supabase.storage.from("trimming-photos").getPublicUrl(path);
    return data.publicUrl;
}

// ══════════════════════════════════
// ログイン（メールOTP）／プロフィール自動入力・保存
// ══════════════════════════════════
let currentUser = null;   // ログイン中のユーザー（未ログインは null）
let pendingEmail = "";    // 確認コード送信先のメール

// 入力欄への安全なセット（値が空/未定義なら触らない）
function setVal(id, v) {
    const el = document.getElementById(id);
    if (el && v !== null && v !== undefined && v !== "") el.value = v;
}
function setRadio(name, v) {
    if (!v) return;
    const el = document.querySelector(`input[name="${name}"][value="${v}"]`);
    if (el) el.checked = true;
}

// 確認コードを送信
async function authSendCode() {
    const email = (document.getElementById("auth_email").value || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showToast("メールアドレスを正しく入力してください。", "error");
        return;
    }
    const btn = document.getElementById("auth-send-btn");
    btn.disabled = true; btn.textContent = "送信中...";
    try {
        const { error } = await _supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true },
        });
        if (error) throw error;
        pendingEmail = email;
        document.getElementById("auth-step-email").style.display = "none";
        document.getElementById("auth-step-code").style.display = "block";
        document.getElementById("auth-sent-to").textContent = `${email} に確認コードを送りました。届かない場合は迷惑メールフォルダもご確認ください。`;
        document.getElementById("auth_code").focus();
        showToast("確認コードをメールで送信しました。", "success");
    } catch (e) {
        console.error("コード送信エラー:", e);
        showToast("コードの送信に失敗しました。時間をおいて再度お試しください。", "error");
    } finally {
        btn.disabled = false; btn.textContent = "確認コードを送る";
    }
}

// 確認コードを検証してログイン
async function authVerifyCode() {
    const token = (document.getElementById("auth_code").value || "").trim();
    if (!/^\d{6}$/.test(token)) {
        showToast("6桁の数字を入力してください。", "error");
        return;
    }
    const btn = document.getElementById("auth-verify-btn");
    btn.disabled = true; btn.textContent = "確認中...";
    try {
        const { data, error } = await _supabase.auth.verifyOtp({
            email: pendingEmail,
            token,
            type: "email",
        });
        if (error) throw error;
        await onLoggedIn(data.user);
    } catch (e) {
        console.error("コード検証エラー:", e);
        showToast("コードが正しくないか、有効期限が切れています。もう一度お試しください。", "error");
    } finally {
        btn.disabled = false; btn.textContent = "ログイン";
    }
}

// ログアウト
async function authLogout() {
    await _supabase.auth.signOut();
    location.reload();
}

// ログイン完了時：表示切り替え＋前回情報の自動入力
async function onLoggedIn(user) {
    currentUser = user;
    document.getElementById("auth-loggedout").style.display = "none";
    document.getElementById("auth-loggedin").style.display = "block";
    document.getElementById("auth-email-label").textContent = user.email || "";

    let loaded = false;

    // 飼い主プロフィール
    try {
        const { data: prof } = await _supabase
            .from("profiles").select("*").eq("id", user.id).maybeSingle();
        if (prof) {
            setVal("owner_name",      prof.owner_name);
            setVal("owner_kana",      prof.owner_kana);
            setVal("phone",           prof.phone);
            setVal("address",         prof.address);
            setVal("emergency_phone", prof.emergency_phone);
            setVal("trigger_text",    prof.trigger_text);
            loaded = true;
        }
    } catch (e) { console.warn("プロフィール取得に失敗", e); }

    // わんちゃん（MVPは最新1頭のみ自動入力）
    try {
        const { data: pets } = await _supabase
            .from("pets").select("*").eq("owner_id", user.id)
            .order("updated_at", { ascending: false }).limit(1);
        const pet = pets && pets[0];
        if (pet) {
            setVal("dog_name",         pet.dog_name);
            setVal("breed",            pet.breed);
            setVal("dog_birthday",     pet.dog_birthday);
            setVal("dog_weight",       pet.dog_weight);
            setVal("regular_hospital", pet.regular_hospital);
            setVal("allergies",        pet.allergies);
            setVal("favorite_spots",   pet.favorite_spots);
            setVal("dislike_spots",    pet.dislike_spots);
            setVal("medical_history",  pet.medical_history);
            setRadio("gender",      pet.gender);
            setRadio("spay_neuter", pet.spay_neuter);
            loaded = true;
        }
    } catch (e) { console.warn("わんちゃん情報取得に失敗", e); }

    if (loaded) {
        showToast("前回の情報を読み込みました。変更があればその場で修正できます。", "success");
    } else {
        showToast("ログインしました。今回の内容は次回のために保存されます。", "success");
    }
}

// 予約成功後：入力内容をプロフィール／わんちゃんに保存（次回の自動入力用）
// ※ 安全管理のためワクチン情報・証明書画像は保存対象に含めません（毎回確認）。
async function saveProfileFromForm() {
    if (!currentUser) return;
    const uid = currentUser.id;
    const now = new Date().toISOString();
    try {
        await _supabase.from("profiles").upsert({
            id:              uid,
            owner_name:      document.getElementById("owner_name").value.trim(),
            owner_kana:      document.getElementById("owner_kana").value.trim(),
            phone:           document.getElementById("phone").value.trim(),
            address:         document.getElementById("address").value.trim(),
            emergency_phone: document.getElementById("emergency_phone").value.trim(),
            trigger_text:    document.getElementById("trigger_text").value.trim(),
            updated_at:      now,
        });

        const petData = {
            owner_id:         uid,
            dog_name:         document.getElementById("dog_name").value.trim(),
            breed:            document.getElementById("breed").value.trim(),
            dog_birthday:     document.getElementById("dog_birthday").value.trim(),
            dog_weight:       parseFloat(document.getElementById("dog_weight").value) || null,
            gender:           document.querySelector('input[name="gender"]:checked')?.value,
            regular_hospital: document.getElementById("regular_hospital").value.trim(),
            allergies:        document.getElementById("allergies").value.trim(),
            favorite_spots:   document.getElementById("favorite_spots").value.trim(),
            dislike_spots:    document.getElementById("dislike_spots").value.trim(),
            medical_history:  document.getElementById("medical_history").value.trim(),
            spay_neuter:      document.querySelector('input[name="spay_neuter"]:checked')?.value,
            updated_at:       now,
        };
        // MVPは1頭運用：既存があれば更新、なければ新規
        const { data: existing } = await _supabase
            .from("pets").select("id").eq("owner_id", uid).limit(1);
        if (existing && existing.length) {
            await _supabase.from("pets").update(petData).eq("id", existing[0].id);
        } else {
            await _supabase.from("pets").insert(petData);
        }
    } catch (e) {
        // 保存失敗は予約完了を妨げない（記録のみ）
        console.warn("プロフィール保存に失敗（予約は完了しています）", e);
    }
}

// 認証UIの初期化（既存セッションの復元＋ボタン配線）
async function initAuth() {
    document.getElementById("auth-send-btn")?.addEventListener("click", authSendCode);
    document.getElementById("auth-verify-btn")?.addEventListener("click", authVerifyCode);
    document.getElementById("auth-logout-btn")?.addEventListener("click", authLogout);
    document.getElementById("auth-back-btn")?.addEventListener("click", () => {
        document.getElementById("auth-step-code").style.display = "none";
        document.getElementById("auth-step-email").style.display = "block";
    });
    // Enterキーでの誤送信を避けつつ、コード欄はEnterで確定できるように
    document.getElementById("auth_code")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); authVerifyCode(); }
    });

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (session && session.user) await onLoggedIn(session.user);
    } catch (e) { console.warn("セッション復元に失敗", e); }
}

// ── トースト ──
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show " + type;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = ""; }, 3500);
}

// ── バリデーション ──
function setError(fieldId, show, message) {
    const errEl  = document.getElementById("err-" + fieldId);
    const inputEl = document.getElementById(fieldId);
    if (errEl) {
        errEl.classList.toggle("visible", show);
        if (message) errEl.textContent = message;
    }
    if (inputEl) inputEl.classList.toggle("is-invalid", show);
}
function clearAllErrors() {
    document.querySelectorAll(".field-error").forEach(el => el.classList.remove("visible"));
    document.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
}
function validateForm() {
    let valid = true;
    clearAllErrors();

    ["owner_name","owner_kana","phone","address","emergency_phone",
     "dog_name","breed","dog_birthday","dog_weight","reservation_date",
     "trigger_text","regular_hospital","allergies",
     "favorite_spots","dislike_spots","medical_history"].forEach(id => {
        if (!(document.getElementById(id)?.value || "").trim()) {
            setError(id, true); valid = false;
        }
    });

    // 住所：都道府県のみは不可（10文字以上を目安に番地まで要求）
    const addr = (document.getElementById("address")?.value || "").trim();
    if (addr && addr.length < 10) {
        setError("address", true, "都道府県・市区町村・番地まで入力してください。");
        valid = false;
    }

    // フリガナ
    const kana = (document.getElementById("owner_kana")?.value || "").trim();
    if (kana && !/^[ァ-ヶーヴ\s　]+$/.test(kana)) {
        setError("owner_kana", true, "カタカナで入力してください（例：エビハラ トモヤ）。");
        valid = false;
    }
    // 電話番号
    ["phone","emergency_phone"].forEach(id => {
        const v = (document.getElementById(id)?.value || "").replace(/[-\s]/g, "");
        if (v && !/^\d{10,11}$/.test(v)) { setError(id, true); valid = false; }
    });
    // ラジオ
    [["gender","gender"],["rabies_vaccine","rabies_vaccine"],
     ["mixed_vaccine","mixed_vaccine"],["spay_neuter","spay_neuter"]].forEach(([name, errId]) => {
        if (!document.querySelector(`input[name="${name}"]:checked`)) {
            setError(errId, true); valid = false;
        }
    });
    // 時間
    if (!document.getElementById("reservation_time")?.value) {
        setError("reservation_time", true); valid = false;
    }
    // コース選択
    if (!document.querySelector('input[name="course"]:checked')) {
        setError("course", true); valid = false;
    }
    // 利用規約同意チェック
    if (!document.getElementById("terms_agree")?.checked) {
        setError("terms_agree", true); valid = false;
    }
    // Instagram掲載の選択（許可／希望しない のどちらか）
    if (!document.querySelector('input[name="instagram_agree"]:checked')) {
        setError("instagram_agree", true); valid = false;
    }
    return valid;
}

// ══════════════════════════════════
// （プライバシー保護のため、電話番号による過去情報自動入力は廃止）
// 公開キーで個人情報を読み取らない方針。空き状況・照合は専用RPC経由。
// ══════════════════════════════════

// ══════════════════════════════════
// スケジュール設定を取得
// ══════════════════════════════════
// 受付可能スロット： key "DOW-HH:MM" (例 "2-11:00") -> 受付開始日 ("" = 制限なし / "YYYY-MM-DD" = その日以降のみ)
let trimmingOpenSlots = new Map();
let shampooOpenSlots  = new Map();
let closedDates       = new Set(); // 特定日の休業 ("YYYY-MM-DD")

async function loadScheduleSettings() {
    try {
        const { data, error } = await _supabase
            .from("schedule_settings")
            .select("type, value, note");
        if (error) throw error;
        trimmingOpenSlots = new Map();
        shampooOpenSlots  = new Map();
        closedDates       = new Set();
        data.forEach(row => {
            // note に受付開始日 (YYYY-MM-DD) が入っていれば、その日以降のみ受付
            if (row.type === "trimming_slot_open") trimmingOpenSlots.set(row.value, row.note || "");
            if (row.type === "shampoo_slot_open")  shampooOpenSlots.set(row.value, row.note || "");
            if (row.type === "closed_date")        closedDates.add(row.value);
        });
    } catch (err) {
        console.warn("スケジュール設定の取得に失敗しました。休業日チェックをスキップします。", err);
    }
}

function getSelectedCourse() {
    return document.querySelector('input[name="course"]:checked')?.value || "";
}

// スロットが指定日で受付可能か（受付開始日を考慮）
function slotOpenOnDate(map, dow, time, dateStr) {
    const key = `${dow}-${time}`;
    if (!map.has(key)) return false;
    const start = map.get(key);                 // "" または "YYYY-MM-DD"
    if (start && dateStr < start) return false; // 受付開始日より前は受付不可
    return true;
}

// 指定日にトリミング／シャンプーの受付枠があるか
function isTrimmingOpenOnDate(dateStr) {
    const dow = new Date(dateStr + "T00:00:00").getDay();
    return slotOpenOnDate(trimmingOpenSlots, dow, "11:00", dateStr)
        || slotOpenOnDate(trimmingOpenSlots, dow, "15:00", dateStr);
}
function isShampooOpenOnDate(dateStr) {
    const dow = new Date(dateStr + "T00:00:00").getDay();
    return slotOpenOnDate(shampooOpenSlots, dow, "11:00", dateStr)
        || slotOpenOnDate(shampooOpenSlots, dow, "15:00", dateStr);
}

// 指定日が予約不可かどうか（両コースとも受付不可 = 定休日）
function isClosedDay(dateStr) {
    if (!dateStr) return false;
    if (closedDates.has(dateStr)) return true;
    return !isTrimmingOpenOnDate(dateStr) && !isShampooOpenOnDate(dateStr);
}

// ══════════════════════════════════
// カレンダーウィジェット
// ══════════════════════════════════
const SLOTS = ["11:00", "15:00"];
// dateStr -> 予約済み時間の Set をキャッシュ
const bookedCache = {};

async function fetchBookedForMonth(year, month) {
    const from = `${year}-${String(month).padStart(2,"0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to   = `${year}-${String(month).padStart(2,"0")}-${lastDay}`;
    try {
        const { data, error } = await _supabase
            .rpc("get_booked_slots", { from_date: from, to_date: to });
        if (error) throw error;
        data.forEach(r => {
            const d = r.reservation_date;
            if (!bookedCache[d]) bookedCache[d] = new Set();
            bookedCache[d].add(r.reservation_time.substring(0,5));
        });
    } catch(e) {
        console.warn("予約データ取得エラー", e);
    }
}

function isFullyBooked(dateStr) {
    const booked = bookedCache[dateStr] || new Set();
    const course = getSelectedCourse();
    const dow = new Date(dateStr + "T00:00:00").getDay();
    return SLOTS.every(s => {
        if (booked.has(s)) return true;
        if (!course) return false;
        if (course === "trimming" && !slotOpenOnDate(trimmingOpenSlots, dow, s, dateStr)) return true;
        if (course === "shampoo"  && !slotOpenOnDate(shampooOpenSlots, dow, s, dateStr))  return true;
        return false;
    });
}

let calYear, calMonth, calSelectedDate = null;

function renderCalendar() {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const maxDate = new Date(today);
    maxDate.setMonth(maxDate.getMonth() + 2);
    const maxDateStr = maxDate.toISOString().split("T")[0];
    const grid = document.getElementById("cal-grid");
    const label = document.getElementById("cal-month-label");
    if (!grid) return;

    label.textContent = `${calYear}年 ${calMonth}月`;

    const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();

    let html = "";
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="cal-day empty"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${calYear}-${String(calMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const isPast    = dateStr <= todayStr;
        const isTooFar  = dateStr > maxDateStr;
        const isClosed  = isClosedDay(dateStr);
        const isFull    = isFullyBooked(dateStr);
        const isToday   = dateStr === todayStr;
        const isSelected = dateStr === calSelectedDate;

        const dow = new Date(dateStr + "T00:00:00").getDay();
        const numClass = dow === 0 ? "style='color:#c0392b'" : dow === 6 ? "style='color:#2980b9'" : "";

        const course = getSelectedCourse();
        const isTrimBlocked = course === "trimming" && !isTrimmingOpenOnDate(dateStr);
        const isShamBlocked = course === "shampoo"  && !isShampooOpenOnDate(dateStr);
        const courseBlocked = isTrimBlocked || isShamBlocked;

        let cls = "cal-day";
        let sub = "";
        if (isSelected)     { cls += " selected";      sub = "▼ 選択中"; }
        else if (isPast)    { cls += " past"; }
        else if (isTooFar)  { cls += " past"; }
        else if (isClosed)  { cls += " closed";        sub = "定休日"; }
        else if (isFull)    { cls += " full";          sub = "満席"; }
        else if (isTrimBlocked) { cls += " shampoo-only";   sub = "シャンプーのみ"; }
        else if (isShamBlocked) { cls += " trimming-only";  sub = "トリミングのみ"; }
        else                { cls += " available";     sub = "空きあり"; }
        if (isToday)        { cls += " today"; }

        const clickAttr = (!isPast && !isTooFar && !isClosed && !isFull && !courseBlocked)
            ? `onclick="calSelectDate('${dateStr}')"` : "";

        html += `<div class="${cls}" ${clickAttr}>
            <span class="cal-day-num" ${numClass}>${d}</span>
            <span class="cal-day-sub">${sub}</span>
        </div>`;
    }
    grid.innerHTML = html;
    document.getElementById("cal-loading").style.display = "none";
}

window.calSelectDate = async function(dateStr) {
    calSelectedDate = dateStr;
    renderCalendar();

    const dateInput = document.getElementById("reservation_date");
    const timeSelect = document.getElementById("reservation_time");
    const selectedLabel = document.getElementById("cal-selected-label");

    dateInput.value = dateStr;
    dateInput.dispatchEvent(new Event("change", { bubbles: true }));

    const d = new Date(dateStr + "T00:00:00");
    const DAY = ["日","月","火","水","木","金","土"];
    selectedLabel.textContent = `選択中：${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${DAY[d.getDay()]}）`;
    selectedLabel.style.display = "block";

    // 時間枠を読み込む
    timeSelect.disabled = true;
    timeSelect.innerHTML = '<option value="">空き確認中...</option>';
    try {
        const { data, error } = await _supabase
            .rpc("get_booked_slots", { from_date: dateStr, to_date: dateStr });
        if (error) throw error;

        const reserved = data.map(r => r.reservation_time.substring(0,5));
        // キャッシュを更新
        bookedCache[dateStr] = new Set(reserved);

        const course = getSelectedCourse();
        const dow = new Date(dateStr + "T00:00:00").getDay();
        timeSelect.innerHTML = '<option value="">時間枠を選択してください</option>';
        [{ value:"11:00", label:"11:00 〜 14:00" },
         { value:"15:00", label:"15:00 〜 18:00" }].forEach(slot => {
            const opt = document.createElement("option");
            opt.value = slot.value;
            const isSlotClosed = (course === "trimming" && !slotOpenOnDate(trimmingOpenSlots, dow, slot.value, dateStr)) ||
                                 (course === "shampoo"  && !slotOpenOnDate(shampooOpenSlots, dow, slot.value, dateStr));
            if (reserved.includes(slot.value)) {
                opt.textContent = slot.label + "（予約済み）";
                opt.disabled = true;
            } else if (isSlotClosed) {
                opt.textContent = slot.label + "（受付なし）";
                opt.disabled = true;
            } else {
                opt.textContent = slot.label + "（空きあり）";
            }
            timeSelect.appendChild(opt);
        });
        timeSelect.disabled = false;

        // 満席なら再描画
        if (isFullyBooked(dateStr)) renderCalendar();

    } catch(err) {
        console.error(err);
        timeSelect.innerHTML = '<option value="">取得に失敗しました</option>';
        showToast("予約枠の取得に失敗しました。", "error");
    }
};

// ══════════════════════════════════
// メイン
// ══════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
    const dateInput  = document.getElementById("reservation_date");
    const timeSelect = document.getElementById("reservation_time");
    const form       = document.getElementById("reservation-form");
    const submitBtn  = document.getElementById("submit-btn");

    // ログインUIを初期化（既存セッションがあれば自動入力）
    await initAuth();

    // スケジュール設定を先に読み込む
    await loadScheduleSettings();

    // コース選択変更でカレンダー再描画
    document.querySelectorAll('input[name="course"]').forEach(radio => {
        radio.addEventListener("change", () => {
            if (calSelectedDate) {
                const course = getSelectedCourse();
                const blocked = (course === "trimming" && !isTrimmingOpenOnDate(calSelectedDate)) ||
                                (course === "shampoo"  && !isShampooOpenOnDate(calSelectedDate));
                if (blocked) {
                    calSelectedDate = null;
                    dateInput.value = "";
                    document.getElementById("cal-selected-label").style.display = "none";
                }
            }
            renderCalendar();
        });
    });

    // カレンダー初期化
    const now = new Date();
    calYear  = now.getFullYear();
    calMonth = now.getMonth() + 1;
    await fetchBookedForMonth(calYear, calMonth);
    renderCalendar();

    document.getElementById("cal-prev").addEventListener("click", async () => {
        calMonth--;
        if (calMonth < 1) { calMonth = 12; calYear--; }
        await fetchBookedForMonth(calYear, calMonth);
        renderCalendar();
    });
    document.getElementById("cal-next").addEventListener("click", async () => {
        calMonth++;
        if (calMonth > 12) { calMonth = 1; calYear++; }
        await fetchBookedForMonth(calYear, calMonth);
        renderCalendar();
    });

    // ── フォーム送信 ──
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!validateForm()) {
            document.querySelector(".is-invalid, .field-error.visible")
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            showToast("入力内容をご確認ください。", "error");
            return;
        }

        // 念のため送信時も休業日チェック
        if (isClosedDay(dateInput.value)) {
            showToast("この日はお休みです。別の日をお選びください。", "error");
            return;
        }

        submitBtn.disabled   = true;
        submitBtn.textContent = "送信中...";

        // ブラックリストチェック
        try {
            const phoneVal = document.getElementById("phone").value.replace(/[-\s]/g, "");
            const nameVal  = document.getElementById("owner_name").value.trim();
            const { data: isBlocked } = await _supabase
                .rpc("is_blacklisted", { p_phone: phoneVal, p_name: nameVal });
            if (isBlocked === true) {
                showToast("現在ご予約をお受けできない状態です。お電話にてお問い合わせください。", "error");
                submitBtn.disabled   = false;
                submitBtn.textContent = "予約を確定する →";
                return;
            }
        } catch(e) {
            console.warn("ブラックリストチェック失敗（スキップ）", e);
        }

        const [rabiesImgUrl, vaccineImgUrl, fleaImgUrl, heartwormImgUrl] = await Promise.all([
            uploadCertImage("rabies_image",    "rabies"),
            uploadCertImage("vaccine_image",   "vaccine"),
            uploadCertImage("flea_tick_image", "flea"),
            uploadCertImage("heartworm_image", "heartworm"),
        ]);

        const reservationData = {
            owner_name:          document.getElementById("owner_name").value.trim(),
            owner_kana:          document.getElementById("owner_kana").value.trim(),
            phone:               document.getElementById("phone").value.trim(),
            address:             document.getElementById("address").value.trim(),
            emergency_phone:     document.getElementById("emergency_phone").value.trim(),
            trigger_text:        document.getElementById("trigger_text").value.trim(),
            dog_name:            document.getElementById("dog_name").value.trim(),
            breed:               document.getElementById("breed").value.trim(),
            dog_birthday:        document.getElementById("dog_birthday").value.trim(),
            dog_weight:          parseFloat(document.getElementById("dog_weight").value) || null,
            regular_hospital:    document.getElementById("regular_hospital").value.trim(),
            allergies:           document.getElementById("allergies").value.trim(),
            favorite_spots:      document.getElementById("favorite_spots").value.trim(),
            dislike_spots:       document.getElementById("dislike_spots").value.trim(),
            gender:              document.querySelector('input[name="gender"]:checked')?.value,
            rabies_vaccine:      document.querySelector('input[name="rabies_vaccine"]:checked')?.value,
            rabies_image:        rabiesImgUrl,
            mixed_vaccine:       document.querySelector('input[name="mixed_vaccine"]:checked')?.value,
            mixed_vaccine_image: vaccineImgUrl,
            medical_history:     document.getElementById("medical_history").value.trim(),
            spay_neuter:         document.querySelector('input[name="spay_neuter"]:checked')?.value,
            flea_tick_prevent:   document.getElementById("flea_tick_prevent").value.trim() || "なし",
            flea_tick_image:     fleaImgUrl,
            heartworm_prevent:   document.getElementById("heartworm_prevent").value.trim() || "なし",
            heartworm_image:     heartwormImgUrl,
            course:              document.querySelector('input[name="course"]:checked')?.value || "",
            instagram_agree:     document.querySelector('input[name="instagram_agree"]:checked')?.value === "allow",
            booking_request:     document.getElementById("booking_request").value.trim(),
            options_request:     document.getElementById("options_request").value.trim(),
            reservation_date:    dateInput.value,
            reservation_time:    timeSelect.value,
        };

        // ログイン中のみアカウントに紐づけ（未ログインは列を付けない＝従来通り）
        if (currentUser) reservationData.user_id = currentUser.id;

        try {
            const { error } = await _supabase.from("reservations").insert([reservationData]);
            if (error) {
                if (error.code === "23505") {
                    showToast("タッチの差でこの枠が埋まりました。別の日時をお選びください。", "error");
                    dateInput.dispatchEvent(new Event("change"));
                } else { throw error; }
            } else {
                // 完了画面に切り替え
                const timeLabel = (timeSelect.options[timeSelect.selectedIndex]?.text || "").replace(/（.*?）\s*$/, "").trim();
                const dateVal   = dateInput.value;
                const [y, m, d] = dateVal.split("-");
                const weekdays  = ["日","月","火","水","木","金","土"];
                const dow       = weekdays[new Date(dateVal).getDay()];
                document.getElementById("comp-dog").textContent  = document.getElementById("dog_name").value + "ちゃん";
                document.getElementById("comp-date").textContent = `${y}年${Number(m)}月${Number(d)}日（${dow}）`;
                document.getElementById("comp-time").textContent = timeLabel;
                // ログイン中なら、今回の入力を次回のために保存
                await saveProfileFromForm();

                form.style.display = "none";
                document.getElementById("auth-card").style.display = "none";
                document.getElementById("complete-screen").style.display = "block";
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        } catch (err) {
            // 技術的な詳細は開発者用の記録にだけ残し、お客様には見せない
            console.error("予約送信エラー:", err);
            showToast("予約に失敗しました。時間をおいて再度お試しください。", "error");
        } finally {
            submitBtn.disabled   = false;
            submitBtn.textContent = "予約を確定する →";
        }
    });
});

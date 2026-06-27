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
     "dog_name","breed","dog_birthday","reservation_date",
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
    // 利用規約同意チェック
    if (!document.getElementById("terms_agree")?.checked) {
        setError("terms_agree", true); valid = false;
    }
    return valid;
}

// ══════════════════════════════════
// 電話番号による過去情報自動入力
// ══════════════════════════════════
let _autofillData = null;

document.getElementById("phone").addEventListener("blur", async () => {
    const phone = document.getElementById("phone").value.replace(/[-\s]/g, "");
    if (!/^\d{10,11}$/.test(phone)) return;

    const { data } = await _supabase
        .from("reservations")
        .select("*")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(1);

    if (!data || data.length === 0) return;

    _autofillData = data[0];
    document.getElementById("autofill-name").textContent =
        `${_autofillData.owner_name} 様 / ${_autofillData.dog_name}ちゃん`;
    document.getElementById("autofill-banner").style.display = "block";
});

document.getElementById("autofill-yes").addEventListener("click", () => {
    if (!_autofillData) return;
    const d = _autofillData;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    const setRadio = (name, val) => {
        const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
        if (el) el.checked = true;
    };

    setVal("owner_name",       d.owner_name);
    setVal("owner_kana",       d.owner_kana);
    setVal("address",          d.address);
    setVal("emergency_phone",  d.emergency_phone);
    setVal("trigger_text",     d.trigger_text);
    setVal("dog_name",         d.dog_name);
    setVal("breed",            d.breed);
    setVal("dog_birthday",     d.dog_birthday);
    setVal("regular_hospital", d.regular_hospital);
    setVal("allergies",        d.allergies);
    setVal("favorite_spots",   d.favorite_spots);
    setVal("dislike_spots",    d.dislike_spots);
    setVal("medical_history",  d.medical_history);
    setVal("flea_tick_prevent",d.flea_tick_prevent);
    setVal("heartworm_prevent",d.heartworm_prevent);
    setRadio("gender",         d.gender);
    setRadio("spay_neuter",    d.spay_neuter);
    setRadio("rabies_vaccine", d.rabies_vaccine);
    setRadio("mixed_vaccine",  d.mixed_vaccine);

    document.getElementById("autofill-banner").style.display = "none";
    showToast("前回の情報を入力しました。内容をご確認ください。", "success");
});

document.getElementById("autofill-no").addEventListener("click", () => {
    document.getElementById("autofill-banner").style.display = "none";
    _autofillData = null;
});

// ══════════════════════════════════
// スケジュール設定を取得
// ══════════════════════════════════
let closedWeekdays = new Set(); // 0=日,1=月,...
let closedDates    = new Set(); // "YYYY-MM-DD"

async function loadScheduleSettings() {
    try {
        const { data, error } = await _supabase
            .from("schedule_settings")
            .select("type, value");
        if (error) throw error;
        closedWeekdays = new Set();
        closedDates    = new Set();
        data.forEach(row => {
            if (row.type === "closed_weekday") closedWeekdays.add(Number(row.value));
            if (row.type === "closed_date")    closedDates.add(row.value);
        });
    } catch (err) {
        console.warn("スケジュール設定の取得に失敗しました。休業日チェックをスキップします。", err);
    }
}

// 指定日が予約不可かどうか
function isClosedDay(dateStr) {
    if (!dateStr) return false;
    if (closedDates.has(dateStr)) return true;
    const dow = new Date(dateStr + "T00:00:00").getDay();
    return closedWeekdays.has(dow);
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
            .from("reservations")
            .select("reservation_date, reservation_time")
            .gte("reservation_date", from)
            .lte("reservation_date", to);
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
    const booked = bookedCache[dateStr];
    if (!booked) return false;
    return SLOTS.every(s => booked.has(s));
}

let calYear, calMonth, calSelectedDate = null;

function renderCalendar() {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
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
        const isPast    = dateStr < todayStr;
        const isClosed  = isClosedDay(dateStr);
        const isFull    = isFullyBooked(dateStr);
        const isToday   = dateStr === todayStr;
        const isSelected = dateStr === calSelectedDate;

        const dow = new Date(dateStr + "T00:00:00").getDay();
        const numClass = dow === 0 ? "style='color:#c0392b'" : dow === 6 ? "style='color:#2980b9'" : "";

        let cls = "cal-day";
        let sub = "";
        if (isSelected)    { cls += " selected"; sub = "▼ 選択中"; }
        else if (isPast)   { cls += " past"; }
        else if (isClosed) { cls += " closed"; sub = "定休日"; }
        else if (isFull)   { cls += " full"; sub = "満席"; }
        else               { cls += " available"; sub = "空きあり"; }
        if (isToday)       { cls += " today"; }

        const clickAttr = (!isPast && !isClosed && !isFull)
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
            .from("reservations")
            .select("reservation_time")
            .eq("reservation_date", dateStr);
        if (error) throw error;

        const reserved = data.map(r => r.reservation_time.substring(0,5));
        // キャッシュを更新
        bookedCache[dateStr] = new Set(reserved);

        timeSelect.innerHTML = '<option value="">時間枠を選択してください</option>';
        [{ value:"11:00", label:"11:00 〜 14:00" },
         { value:"15:00", label:"15:00 〜 18:00" }].forEach(slot => {
            const opt = document.createElement("option");
            opt.value = slot.value;
            if (reserved.includes(slot.value)) {
                opt.textContent = slot.label + "（予約済み）";
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

    // スケジュール設定を先に読み込む
    await loadScheduleSettings();

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
            booking_request:     document.getElementById("booking_request").value.trim(),
            reservation_date:    dateInput.value,
            reservation_time:    timeSelect.value,
        };

        try {
            const { error } = await _supabase.from("reservations").insert([reservationData]);
            if (error) {
                if (error.code === "23505") {
                    showToast("タッチの差でこの枠が埋まりました。別の日時をお選びください。", "error");
                    dateInput.dispatchEvent(new Event("change"));
                } else { throw error; }
            } else {
                // 完了画面に切り替え
                const timeLabel = timeSelect.options[timeSelect.selectedIndex]?.text || "";
                const dateVal   = dateInput.value;
                const [y, m, d] = dateVal.split("-");
                const weekdays  = ["日","月","火","水","木","金","土"];
                const dow       = weekdays[new Date(dateVal).getDay()];
                document.getElementById("comp-dog").textContent  = document.getElementById("dog_name").value + "ちゃん";
                document.getElementById("comp-date").textContent = `${y}年${Number(m)}月${Number(d)}日（${dow}）`;
                document.getElementById("comp-time").textContent = timeLabel;
                form.style.display = "none";
                document.getElementById("complete-screen").style.display = "block";
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        } catch (err) {
            console.error(err);
            showToast("予約に失敗しました。時間をおいて再度お試しください。", "error");
        } finally {
            submitBtn.disabled   = false;
            submitBtn.textContent = "予約を確定する →";
        }
    });
});

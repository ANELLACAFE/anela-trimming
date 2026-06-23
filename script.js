// ── Supabase 初期化 ──
const SUPABASE_URL = "https://omphuvdamamlseifccfq.supabase.co";
const SUPABASE_KEY = "sb_publishable_nTsYxNVL2N4P3WjSUtSTgw_E1aaCb4d";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
     "dog_name","breed","dog_birthday","reservation_date"].forEach(id => {
        if (!(document.getElementById(id)?.value || "").trim()) {
            setError(id, true); valid = false;
        }
    });

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
    return valid;
}

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
// メイン
// ══════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
    const dateInput  = document.getElementById("reservation_date");
    const timeSelect = document.getElementById("reservation_time");
    const form       = document.getElementById("reservation-form");
    const submitBtn  = document.getElementById("submit-btn");

    dateInput.min = new Date().toISOString().split("T")[0];

    // スケジュール設定を先に読み込む
    await loadScheduleSettings();

    // ── 日付選択 → 空き確認 ──
    dateInput.addEventListener("change", async () => {
        const selectedDate = dateInput.value;
        if (!selectedDate) return;

        // 休業日チェック
        if (isClosedDay(selectedDate)) {
            timeSelect.disabled = true;
            timeSelect.innerHTML = '<option value="">この日はお休みです</option>';
            showToast("選択された日はお休みです。別の日をお選びください。", "error");
            return;
        }

        timeSelect.disabled = true;
        timeSelect.innerHTML = '<option value="">空き確認中...</option>';

        try {
            const { data, error } = await _supabase
                .from("reservations")
                .select("reservation_time")
                .eq("reservation_date", selectedDate);
            if (error) throw error;

            const reservedTimes = data.map(r => r.reservation_time.substring(0, 5));
            timeSelect.innerHTML = '<option value="">時間枠を選択してください</option>';

            [{ value: "11:00", label: "11:00 〜 14:00" },
             { value: "15:00", label: "15:00 〜 18:00" }].forEach(slot => {
                const opt = document.createElement("option");
                opt.value = slot.value;
                if (reservedTimes.includes(slot.value)) {
                    opt.textContent = slot.label + "（予約済み）";
                    opt.disabled = true;
                } else {
                    opt.textContent = slot.label + "（空きあり）";
                }
                timeSelect.appendChild(opt);
            });
            timeSelect.disabled = false;
        } catch (err) {
            console.error(err);
            timeSelect.innerHTML = '<option value="">取得に失敗しました</option>';
            showToast("予約枠の取得に失敗しました。", "error");
        }
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
            rabies_image:        document.getElementById("rabies_image").files[0]?.name || "未提出",
            mixed_vaccine:       document.querySelector('input[name="mixed_vaccine"]:checked')?.value,
            mixed_vaccine_image: document.getElementById("vaccine_image").files[0]?.name || "未提出",
            medical_history:     document.getElementById("medical_history").value.trim(),
            spay_neuter:         document.querySelector('input[name="spay_neuter"]:checked')?.value,
            flea_tick_prevent:   document.getElementById("flea_tick_prevent").value.trim() || "なし",
            flea_tick_image:     document.getElementById("flea_tick_image").files[0]?.name || "未提出",
            heartworm_prevent:   document.getElementById("heartworm_prevent").value.trim() || "なし",
            heartworm_image:     document.getElementById("heartworm_image").files[0]?.name || "未提出",
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
                showToast("ご予約が完了しました！ありがとうございます🐾", "success");
                form.reset();
                timeSelect.disabled = true;
                timeSelect.innerHTML = '<option value="">先に予約日を選択してください</option>';
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

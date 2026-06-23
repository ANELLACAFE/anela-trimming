// ── Supabase 初期化（小文字の supabase.createClient が正しい）──
const SUPABASE_URL = "https://omphuvdamamlseifccfq.supabase.co";
const SUPABASE_KEY = "sb_publishable_nTsYxNVL2N4P3WjSUtSTgw_E1aaCb4d";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── トースト表示 ──
function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show " + type;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = ""; }, 3500);
}

// ── バリデーションユーティリティ ──
function setError(fieldId, show) {
    const errEl = document.getElementById("err-" + fieldId);
    const inputEl = document.getElementById(fieldId);
    if (errEl) { errEl.classList.toggle("visible", show); }
    if (inputEl) { inputEl.classList.toggle("is-invalid", show); }
}

function clearAllErrors() {
    document.querySelectorAll(".field-error").forEach(el => el.classList.remove("visible"));
    document.querySelectorAll(".is-invalid").forEach(el => el.classList.remove("is-invalid"));
}

function validateForm() {
    let valid = true;
    clearAllErrors();

    // 必須テキスト項目
    const requiredFields = [
        "owner_name", "owner_kana", "phone", "address",
        "emergency_phone", "dog_name", "breed", "dog_birthday",
        "reservation_date"
    ];
    requiredFields.forEach(id => {
        const val = (document.getElementById(id)?.value || "").trim();
        if (!val) { setError(id, true); valid = false; }
    });

    // フリガナ：カタカナ・空白・長音のみ許可
    const kana = document.getElementById("owner_kana")?.value.trim();
    if (kana && !/^[ァ-ヶーヴ\s　]+$/.test(kana)) {
        setError("owner_kana", true);
        document.getElementById("err-owner_kana").textContent = "カタカナで入力してください（例：エビハラ トモヤ）。";
        valid = false;
    }

    // 電話番号：数字のみ10〜11桁
    const phone = document.getElementById("phone")?.value.replace(/[-\s]/g, "");
    if (phone && !/^\d{10,11}$/.test(phone)) {
        setError("phone", true);
        valid = false;
    }
    const emPhone = document.getElementById("emergency_phone")?.value.replace(/[-\s]/g, "");
    if (emPhone && !/^\d{10,11}$/.test(emPhone)) {
        setError("emergency_phone", true);
        valid = false;
    }

    // ラジオボタン必須チェック
    const radioGroups = [
        { name: "gender",        errId: "gender" },
        { name: "rabies_vaccine",errId: "rabies_vaccine" },
        { name: "mixed_vaccine", errId: "mixed_vaccine" },
        { name: "spay_neuter",   errId: "spay_neuter" },
    ];
    radioGroups.forEach(({ name, errId }) => {
        if (!document.querySelector(`input[name="${name}"]:checked`)) {
            setError(errId, true);
            valid = false;
        }
    });

    // 予約時間
    const time = document.getElementById("reservation_time")?.value;
    if (!time) {
        setError("reservation_time", true);
        valid = false;
    }

    return valid;
}

// ── メイン処理 ──
document.addEventListener("DOMContentLoaded", () => {
    const dateInput  = document.getElementById("reservation_date");
    const timeSelect = document.getElementById("reservation_time");
    const form       = document.getElementById("reservation-form");
    const submitBtn  = document.getElementById("submit-btn");

    // 今日以降のみ選択可
    dateInput.min = new Date().toISOString().split("T")[0];

    // ── 日付選択 → 空き確認 ──
    dateInput.addEventListener("change", async () => {
        const selectedDate = dateInput.value;
        if (!selectedDate) return;

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

            const slots = [
                { value: "11:00", label: "11:00 〜 14:00" },
                { value: "15:00", label: "15:00 〜 18:00" },
            ];

            slots.forEach(slot => {
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
            timeSelect.innerHTML = '<option value="">取得に失敗しました。再度お試しください。</option>';
            showToast("予約枠の取得に失敗しました。", "error");
        }
    });

    // ── フォーム送信 ──
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!validateForm()) {
            // 最初のエラー項目へスクロール
            const firstError = document.querySelector(".is-invalid, .field-error.visible");
            firstError?.scrollIntoView({ behavior: "smooth", block: "center" });
            showToast("入力内容をご確認ください。", "error");
            return;
        }

        submitBtn.disabled  = true;
        submitBtn.textContent = "送信中...";

        const reservationData = {
            owner_name:        document.getElementById("owner_name").value.trim(),
            owner_kana:        document.getElementById("owner_kana").value.trim(),
            phone:             document.getElementById("phone").value.trim(),
            address:           document.getElementById("address").value.trim(),
            emergency_phone:   document.getElementById("emergency_phone").value.trim(),
            trigger_text:      document.getElementById("trigger_text").value.trim(),
            dog_name:          document.getElementById("dog_name").value.trim(),
            breed:             document.getElementById("breed").value.trim(),
            dog_birthday:      document.getElementById("dog_birthday").value.trim(),
            regular_hospital:  document.getElementById("regular_hospital").value.trim(),
            allergies:         document.getElementById("allergies").value.trim(),
            favorite_spots:    document.getElementById("favorite_spots").value.trim(),
            dislike_spots:     document.getElementById("dislike_spots").value.trim(),
            gender:            document.querySelector('input[name="gender"]:checked')?.value,
            rabies_vaccine:    document.querySelector('input[name="rabies_vaccine"]:checked')?.value,
            rabies_image:      document.getElementById("rabies_image").files[0]?.name || "未提出",
            mixed_vaccine:     document.querySelector('input[name="mixed_vaccine"]:checked')?.value,
            mixed_vaccine_image: document.getElementById("vaccine_image").files[0]?.name || "未提出",
            medical_history:   document.getElementById("medical_history").value.trim(),
            spay_neuter:       document.querySelector('input[name="spay_neuter"]:checked')?.value,
            flea_tick_prevent: document.getElementById("flea_tick_prevent").value.trim() || "なし",
            flea_tick_image:   document.getElementById("flea_tick_image").files[0]?.name || "未提出",
            heartworm_prevent: document.getElementById("heartworm_prevent").value.trim() || "なし",
            heartworm_image:   document.getElementById("heartworm_image").files[0]?.name || "未提出",
            reservation_date:  dateInput.value,
            reservation_time:  timeSelect.value,
        };

        try {
            const { error } = await _supabase.from("reservations").insert([reservationData]);

            if (error) {
                if (error.code === "23505") {
                    showToast("タッチの差でこの枠が埋まりました。別の日時をお選びください。", "error");
                    // 時間枠を再取得
                    dateInput.dispatchEvent(new Event("change"));
                } else {
                    throw error;
                }
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
            submitBtn.disabled  = false;
            submitBtn.textContent = "予約を確定する →";
        }
    });
});

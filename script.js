// ==========================================
// 1. Supabaseの接続情報 (実際の値に書き換えてください)
// ==========================================
const SUPABASE_URL = "https://omphuvdamamlseifccfq.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_nTsYxNVL2N4P3WjSUtSTgw_E1aaCb4d";

const supabase = Supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. 予約枠の定義（1日2つの大きな枠）
// ==========================================
const TIME_SLOTS = [
    "11:00", 
    "15:00"  
];

document.addEventListener("DOMContentLoaded", () => {
    const dateInput = document.getElementById("reservation_date");
    const timeSelect = document.getElementById("reservation_time");
    // 【修正箇所】ハイフン(-)に修正し、HTMLと名前を一致させました
    const form = document.getElementById("reservation-form");

    // 当日以降しか選択できないようにカレンダーを制限
    const today = new Date().toISOString().split("T")[0];
    dateInput.min = today;

    // 日付が選択されたら、予約枠の空き状況をチェック
    dateInput.addEventListener("change", async () => {
        const selectedDate = dateInput.value;
        if (!selectedDate) return;

        timeSelect.disabled = true;
        timeSelect.innerHTML = '<option value="">読み込み中...</option>';

        try {
            // Supabaseから選択された日の予約を取得
            const { data, error } = await supabase
                .from("reservations")
                .select("reservation_time")
                .eq("reservation_date", selectedDate);

            if (error) throw error;

            // すでに予約されている時間を配列にまとめる (hh:mm:ss -> hh:mm形式に変換)
            const reservedTimes = data.map(r => r.reservation_time.substring(0, 5));

            // セレクトボックスの選択肢を生成
            timeSelect.innerHTML = '<option value="">枠を選択してください</option>';
            
            // 11:00の枠の判定
            const opt1 = document.createElement("option");
            opt1.value = "11:00";
            if (reservedTimes.includes("11:00")) {
                opt1.textContent = "11:00 〜 14:00 (予約済み)";
                opt1.disabled = true;
            } else {
                opt1.textContent = "11:00 〜 14:00 (空きあり)";
            }
            timeSelect.appendChild(opt1);

            // 15:00の枠の判定
            const opt2 = document.createElement("option");
            opt2.value = "15:00";
            if (reservedTimes.includes("15:00")) {
                opt2.textContent = "15:00 〜 18:00 (予約済み)";
                opt2.disabled = true;
            } else {
                opt2.textContent = "15:00 〜 18:00 (空きあり)";
            }
            timeSelect.appendChild(opt2);

            timeSelect.disabled = false;

        } catch (err) {
            console.error(err);
            alert("予約枠の取得に失敗しました。時間をおいて再度お試しください。");
        }
    });

    // フォーム送信（予約登録）
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById("submit-btn");
        submitBtn.disabled = true;
        submitBtn.textContent = "処理中...";

        // ラジオボタンの値を取得
        const gender = document.querySelector('input[name="gender"]:checked')?.value;
        const rabies = document.querySelector('input[name="rabies_vaccine"]:checked')?.value;
        const mixed = document.querySelector('input[name="mixed_vaccine"]:checked')?.value;
        const spay = document.querySelector('input[name="spay_neuter"]:checked')?.value;

        // 各種画像ファイル名の取得（ファイル名のみ保存）
        const rabiesFile = document.getElementById("rabies_image").files[0]?.name || "未提出";
        const vaccineFile = document.getElementById("vaccine_image").files[0]?.name || "未提出";
        const fleaTickFile = document.getElementById("flea_tick_image").files[0]?.name || "未提出";
        const heartwormFile = document.getElementById("heartworm_image").files[0]?.name || "未提出";

        // 送信データ組み立て
        const reservationData = {
            owner_name: document.getElementById("owner_name").value,
            owner_kana: document.getElementById("owner_kana").value,
            phone: document.getElementById("phone").value,
            address: document.getElementById("address").value,
            emergency_phone: document.getElementById("emergency_phone").value,
            trigger_text: document.getElementById("trigger_text").value,
            dog_name: document.getElementById("dog_name").value,
            breed: document.getElementById("breed").value,
            dog_birthday: document.getElementById("dog_birthday").value, 
            regular_hospital: document.getElementById("regular_hospital").value,
            allergies: document.getElementById("allergies").value,
            favorite_spots: document.getElementById("favorite_spots").value,
            dislike_spots: document.getElementById("dislike_spots").value,
            gender: gender,
            rabies_vaccine: rabies,
            rabies_image: rabiesFile,     
            mixed_vaccine: mixed,
            mixed_vaccine_image: vaccineFile, 
            medical_history: document.getElementById("medical_history").value,
            spay_neuter: spay,
            flea_tick_prevent: document.getElementById("flea_tick_prevent").value || "なし",
            flea_tick_image: fleaTickFile,
            heartworm_prevent: document.getElementById("heartworm_prevent").value || "なし",
            heartworm_image: heartwormFile,
            reservation_date: dateInput.value,
            reservation_time: timeSelect.value
        };

        try {
            // Supabaseへデータを挿入
            const { error } = await supabase
                .from("reservations")
                .insert([reservationData]);

            if (error) {
                if (error.code === "23505") {
                    alert("申し訳ありません。タッチの差でこの枠の予約が埋まってしまいました。別の枠または別の日付を選択してください。");
                } else {
                    throw error;
                }
            } else {
                alert("ご予約が完了しました！ご来店をお待ちしております。");
                form.reset();
                timeSelect.disabled = true;
                timeSelect.innerHTML = '<option value="">予約日を先に選択してください</option>';
            }

        } catch (err) {
            console.error(err);
            alert("予約に失敗しました。入力内容を確認するか、お店に直接お問い合わせください。");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "予約する";
        }
    });
});
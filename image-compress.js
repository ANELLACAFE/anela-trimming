// ── 写真の縮小（予約フォーム・管理画面で共通）──
// スマホの写真（1枚3〜5MB）を、アップロード前にブラウザ内で
// 長い辺 1600px・JPEG に縮小して 1/5〜1/10 の容量にする（Supabaseの容量対策）。
// 読み込めない形式（パソコンのChromeでのHEICなど）や、縮小しても小さくならない時は
// 元のファイルをそのまま返す＝アップロード自体は止めない。
const IMAGE_MAX_SIDE = 1600;
const IMAGE_QUALITY  = 0.8;

function loadImageElement(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めません")); };
        img.src = url;
    });
}

// 写真置き場は「画像(image/*)だけ」受け付ける設定（supabase/storage_upload_limit.sql）。
// supabase-js はファイル自身の種類(type)で送るため、ブラウザが種類を判定できないファイル
// （WindowsのChromeでHEICを選んだ時など＝typeが空）は画像以外として、はじかれてしまう。
// typeが空の時だけ、拡張子から画像の種類を付け直す。
const IMAGE_TYPES_BY_EXT = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
    heic: "image/heic", heif: "image/heif", avif: "image/avif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff"
};
function withImageType(file, ext) {
    if (file.type || !IMAGE_TYPES_BY_EXT[ext]) return file;
    return new Blob([file], { type: IMAGE_TYPES_BY_EXT[ext] });
}

// 戻り値: { blob, ext, compressed } … ext は保存ファイル名に付ける拡張子
async function compressImage(file, maxSide = IMAGE_MAX_SIDE, quality = IMAGE_QUALITY) {
    const originalExt = ((file.name || "").split(".").pop() || "jpg").toLowerCase();
    const original = { blob: withImageType(file, originalExt), ext: originalExt, compressed: false };
    try {
        // 種類が空のファイルも、読み込めれば縮小する（読み込めなければ元のまま）
        if (!file || (file.type && !String(file.type).startsWith("image/"))) return original;
        // <img> 経由で描くと、スマホ写真の向き（縦横の回転情報）が反映される
        const img = await loadImageElement(file);
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth  * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";            // 透過PNGの背景を白に
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob || blob.size >= file.size) return original;
        return { blob, ext: "jpg", compressed: true };
    } catch (e) {
        console.warn("画像の縮小に失敗（元の画像で保存します）", e);
        return original;
    }
}

// 公開URL → ストレージ内のパス（例: "123/1700000000000.jpg"）。該当しなければ null
function storagePathFromUrl(url, bucket = "trimming-photos") {
    const marker = `/object/public/${bucket}/`;
    const i = String(url || "").indexOf(marker);
    if (i < 0) return null;
    try { return decodeURIComponent(url.slice(i + marker.length).split("?")[0]); }
    catch (e) { return null; }
}

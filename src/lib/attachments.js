// Reading files the user attaches to a chat message. Photos are shrunk in the
// browser first (faster upload, fewer tokens); everything else is sent as-is
// and the server extracts the text.

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_MB = 8;
const MAX_IMAGE_SIDE = 1600;

export const FILE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.json,.xml,.html,.yaml,.yml,.log,.csv,.tsv,.xlsx," +
  ".py,.js,.jsx,.ts,.tsx,.go,.java,.c,.h,.cpp,.cs,.rb,.php,.sh,.sql,.css,.rs,.kt,.swift";
export const SPREADSHEET_ACCEPT = ".csv,.tsv,.xlsx,.xlsm";

export function kindOf(file) {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(csv|tsv|xlsx|xlsm|xls)$/.test(name)) return "spreadsheet";
  return "text";
}

const readAsDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// Downscale large photos to MAX_IMAGE_SIDE and re-encode as JPEG. GIFs and
// small images are left untouched.
async function shrinkImage(file) {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

// prepareAttachment returns { id, name, type, kind, size, data (base64), previewUrl? }
// or throws an Error with a message to show the user.
export async function prepareAttachment(file) {
  const kind = kindOf(file);
  if (/\.xls$/i.test(file.name)) {
    throw new Error(`"${file.name}" is an old Excel file. Save it as .xlsx or .csv and try again.`);
  }
  const ready = kind === "image" ? await shrinkImage(file) : file;
  if (ready.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`"${file.name}" is too large (max ${MAX_FILE_MB} MB).`);
  }
  const dataUrl = await readAsDataURL(ready);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: ready.name,
    type: ready.type,
    kind,
    size: ready.size,
    data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    previewUrl: kind === "image" ? dataUrl : undefined,
  };
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

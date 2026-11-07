/**
 * Makes a photo small enough to send: at most 1600 pixels on the long side, as a JPEG. Browser only.
 * A phone photo is often 5 MB or more; the letter is just as readable at this size, and the upload is far smaller.
 * Returns null when the browser cannot read the picture. The original is never changed or kept.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.85;
/** The photo route takes at most this much (src/lib/vision/photo.ts PHOTO_BYTES_MAX). */
export const SEND_MAX_BYTES = 3_000_000;

export async function shrinkPhoto(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // A transparent PNG would turn black as a JPEG, so paint white first.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    return blob !== null && blob.size <= SEND_MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}

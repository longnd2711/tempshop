import { buildProductImageFilename } from './imageSyncLogic';

export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
  slotIndex?: number;
}

export interface CompressedProductImageResult {
  compressedBlob: Blob;
  compressedName: string;
  originalBlob: Blob;
  originalName: string;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
}

function loadHtmlImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không thể đọc dữ liệu ảnh để nén.'));
    };
    img.src = objectUrl;
  });
}

async function decodeImageDimensions(sourceBlob: Blob): Promise<{
  width: number;
  height: number;
  drawToCanvas: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  let bitmap: ImageBitmap | null = null;
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(sourceBlob);
      const b = bitmap;
      return {
        width: b.width,
        height: b.height,
        drawToCanvas: (ctx, w, h) => ctx.drawImage(b, 0, 0, w, h),
        cleanup: () => b.close(),
      };
    } catch {
      bitmap = null;
    }
  }

  const htmlImg = await loadHtmlImageFromBlob(sourceBlob);
  return {
    width: htmlImg.naturalWidth || htmlImg.width,
    height: htmlImg.naturalHeight || htmlImg.height,
    drawToCanvas: (ctx, w, h) => ctx.drawImage(htmlImg, 0, 0, w, h),
    cleanup: () => {},
  };
}

function renderCanvasToJpgBlob(
  drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  targetWidth: number,
  targetHeight: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Trình duyệt không hỗ trợ nén ảnh Canvas.');
  }

  // Fill crisp white background so transparent PNG/WebP images become clean .jpg
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  drawFn(ctx, targetWidth, targetHeight);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Không thể xuất ảnh định dạng JPG.'));
        }
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function convertBlobToOriginalJpg(
  sourceBlob: Blob,
  sku: string,
  slotIndex = 0,
  quality = 0.95,
): Promise<{ blob: Blob; filename: string }> {
  const filename = buildProductImageFilename(sku, slotIndex, true);
  const mime = (sourceBlob.type || '').toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return { blob: sourceBlob, filename };
  }

  const decoded = await decodeImageDimensions(sourceBlob);
  try {
    const w = Math.max(1, decoded.width);
    const h = Math.max(1, decoded.height);
    const jpgBlob = await renderCanvasToJpgBlob(
      decoded.drawToCanvas,
      w,
      h,
      quality,
    );
    return { blob: jpgBlob, filename };
  } finally {
    decoded.cleanup();
  }
}

export async function compressImageToJpg(
  sourceBlob: Blob,
  sku: string,
  options: CompressImageOptions = {},
): Promise<CompressedProductImageResult> {
  const maxDimension = options.maxDimension ?? 900;
  const quality = options.quality ?? 0.8;
  const slotIndex = options.slotIndex ?? 0;

  const compressedName = buildProductImageFilename(sku, slotIndex, false);
  const originalName = buildProductImageFilename(sku, slotIndex, true);

  const decoded = await decodeImageDimensions(sourceBlob);
  let compressedBlob: Blob;
  let originalJpgBlob: Blob;
  let targetWidth = 0;
  let targetHeight = 0;

  try {
    const sourceWidth = Math.max(1, decoded.width);
    const sourceHeight = Math.max(1, decoded.height);
    const maxSide = Math.max(sourceWidth, sourceHeight, 1);
    const scale = maxSide > maxDimension ? maxDimension / maxSide : 1;
    targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const mime = (sourceBlob.type || '').toLowerCase();
    originalJpgBlob =
      mime === 'image/jpeg' || mime === 'image/jpg'
        ? sourceBlob
        : await renderCanvasToJpgBlob(
            decoded.drawToCanvas,
            sourceWidth,
            sourceHeight,
            0.95,
          );

    compressedBlob = await renderCanvasToJpgBlob(
      decoded.drawToCanvas,
      targetWidth,
      targetHeight,
      quality,
    );
  } finally {
    decoded.cleanup();
  }

  return {
    compressedBlob,
    compressedName,
    originalBlob: originalJpgBlob,
    originalName,
    originalBytes: sourceBlob.size,
    compressedBytes: compressedBlob.size,
    width: targetWidth,
    height: targetHeight,
  };
}

export function formatFileSizeKb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

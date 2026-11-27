import type { Product } from '../types/shop';
import { normalizeVietnameseText } from './shopLogic';

export const PRODUCT_IMAGES_BUCKET = 'product-images';
export const DEFAULT_DRIVE_FOLDER_NAME = 'shop_img';
export const IMAGE_SYNC_BATCH_SIZE = 50;

export function sanitizeSkuForFilename(sku: string): string {
  const cleaned = normalizeVietnameseText(sku)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'san-pham';
}

export function normalizeSkuMatchKey(raw: string): string {
  return normalizeVietnameseText(raw)
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function buildProductImageFilename(
  sku: string,
  slotIndex = 0,
  isOriginal = false,
): string {
  const safeSku = sanitizeSkuForFilename(sku);
  const slotSuffix = slotIndex > 0 ? `_${slotIndex + 1}` : '';
  const prefix = isOriginal ? '0_' : '';
  return `${prefix}${safeSku}${slotSuffix}.jpg`;
}

export function parseGoogleDriveFolderId(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (folderMatch?.[1]) return folderMatch[1];

  const queryMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (queryMatch?.[1] && !trimmed.includes('/file/d/')) {
    return queryMatch[1];
  }

  // Raw Drive folder IDs are typically 20+ chars without spaces or slashes
  if (/^[A-Za-z0-9_-]{15,}$/.test(trimmed) && !trimmed.includes('shop_img')) {
    return trimmed;
  }

  return null;
}

export function parseGoogleDriveFileId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const filePathMatch = trimmed.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  if (filePathMatch?.[1]) return filePathMatch[1];

  const lh3Match = trimmed.match(
    /lh\d+\.googleusercontent\.com\/d\/([A-Za-z0-9_-]{10,})/,
  );
  if (lh3Match?.[1]) return lh3Match[1];

  if (
    /(?:drive|docs)\.google\.com/i.test(trimmed) &&
    !trimmed.includes('/folders/')
  ) {
    const queryMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (queryMatch?.[1]) return queryMatch[1];
  }

  return null;
}

const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const JPG_EXTENSION_RE = /\.jpe?g$/i;

export function isJpgFilename(filename: string): boolean {
  return JPG_EXTENSION_RE.test(filename.trim());
}

export interface ParsedImageFilename {
  filename: string;
  stem: string;
  baseStem: string;
  slotIndex: number;
  isOriginalPrefix: boolean;
}

export function parseImageFilename(filename: string): ParsedImageFilename | null {
  const trimmed = filename.trim();
  if (!IMAGE_EXTENSION_RE.test(trimmed)) return null;

  const withoutExt = trimmed.replace(IMAGE_EXTENSION_RE, '');
  const isOriginalPrefix = withoutExt.startsWith('0_');
  const stem = isOriginalPrefix ? withoutExt.slice(2) : withoutExt;
  if (!stem) return null;

  const slotMatch = stem.match(/^(.+?)(?:_(\d+)|\((\d+)\))$/);
  const baseStem = slotMatch?.[1]?.trim() || stem;
  const parsedNum = slotMatch?.[2]
    ? Number(slotMatch[2])
    : slotMatch?.[3]
      ? Number(slotMatch[3])
      : 1;
  const slotIndex = Number.isFinite(parsedNum) && parsedNum > 1 ? parsedNum - 1 : 0;

  return {
    filename: trimmed,
    stem,
    baseStem,
    slotIndex,
    isOriginalPrefix,
  };
}

export interface ScannableImageFile {
  id: string;
  name: string;
  fullPath?: string;
  publicUrl?: string;
  size?: number;
}

export interface MatchedProductImage<T extends ScannableImageFile = ScannableImageFile> {
  file: T;
  slotIndex: number;
  isOriginalPrefix: boolean;
}

export interface ProductSkuScanMatch<T extends ScannableImageFile = ScannableImageFile> {
  product: Product;
  matchedFiles: Array<MatchedProductImage<T>>;
}

export interface ScanFolderMatchResult<T extends ScannableImageFile = ScannableImageFile> {
  matches: Array<ProductSkuScanMatch<T>>;
  unmatchedFiles: T[];
  ignoredFilesCount: number;
}

export function matchImageFilesToProducts<T extends ScannableImageFile>(
  files: T[],
  products: Product[],
): ScanFolderMatchResult<T> {
  const productBySkuKey = new Map<string, Product>();
  for (const product of products) {
    const key = normalizeSkuMatchKey(product.sku);
    if (key && !productBySkuKey.has(key)) {
      productBySkuKey.set(key, product);
    }
  }

  const matchedMap = new Map<string, ProductSkuScanMatch<T>>();
  const unmatchedFiles: T[] = [];
  let ignoredFilesCount = 0;

  for (const file of files) {
    const parsed = parseImageFilename(file.name);
    if (!parsed) {
      ignoredFilesCount += 1;
      continue;
    }

    // Check full stem first so SKUs ending with "_2" aren't split accidentally
    const exactKey = normalizeSkuMatchKey(parsed.stem);
    const baseKey = normalizeSkuMatchKey(parsed.baseStem);

    let matchedProduct = productBySkuKey.get(exactKey);
    let slotIndex = 0;
    if (!matchedProduct && baseKey !== exactKey) {
      matchedProduct = productBySkuKey.get(baseKey);
      slotIndex = parsed.slotIndex;
    }

    if (!matchedProduct) {
      unmatchedFiles.push(file);
      continue;
    }

    let entry = matchedMap.get(matchedProduct.id);
    if (!entry) {
      entry = { product: matchedProduct, matchedFiles: [] };
      matchedMap.set(matchedProduct.id, entry);
    }

    // Prefer non-0_ compressed file if both 0_sku.jpg and sku.jpg exist in same slot,
    // otherwise keep whichever is present
    const existingSameSlotIdx = entry.matchedFiles.findIndex(
      (m) => m.slotIndex === slotIndex,
    );
    if (existingSameSlotIdx >= 0) {
      if (
        entry.matchedFiles[existingSameSlotIdx].isOriginalPrefix &&
        !parsed.isOriginalPrefix
      ) {
        entry.matchedFiles[existingSameSlotIdx] = {
          file,
          slotIndex,
          isOriginalPrefix: parsed.isOriginalPrefix,
        };
      }
    } else {
      entry.matchedFiles.push({
        file,
        slotIndex,
        isOriginalPrefix: parsed.isOriginalPrefix,
      });
    }
  }

  const matches = Array.from(matchedMap.values()).map((entry) => ({
    ...entry,
    matchedFiles: [...entry.matchedFiles].sort((a, b) => a.slotIndex - b.slotIndex),
  }));

  return {
    matches,
    unmatchedFiles,
    ignoredFilesCount,
  };
}

export function extractSupabaseStoragePathFromUrl(
  url: string,
  bucketName: string = PRODUCT_IMAGES_BUCKET,
): string | null {
  const cleanUrl = url.trim().split('?')[0].split('#')[0];
  const marker = `/storage/v1/object/public/${bucketName}/`;
  const idx = cleanUrl.indexOf(marker);
  if (idx === -1) return null;
  const relPath = decodeURIComponent(cleanUrl.slice(idx + marker.length)).replace(
    /^\/+/,
    '',
  );
  return relPath || null;
}

export function getProductImageUrls(
  product: Pick<Product, 'image' | 'images'>,
): string[] {
  const raw =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images
      : product.image
        ? [product.image]
        : [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of raw) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

export function isSupabaseProductImageUrl(
  url: string,
  bucketName: string = PRODUCT_IMAGES_BUCKET,
): boolean {
  return extractSupabaseStoragePathFromUrl(url, bucketName) !== null;
}

export type ProductImageSyncState = 'synced' | 'missing' | 'external';

export function classifyProductImageSyncState(
  product: Pick<Product, 'image' | 'images'>,
  bucketName: string = PRODUCT_IMAGES_BUCKET,
): ProductImageSyncState {
  const urls = getProductImageUrls(product);
  if (urls.length === 0) return 'missing';
  const hasExternal = urls.some((u) => !isSupabaseProductImageUrl(u, bucketName));
  return hasExternal ? 'external' : 'synced';
}

export type DriveSyncTask<T extends ScannableImageFile = ScannableImageFile> =
  | {
      kind: 'drive-match';
      product: Product;
      matchedFiles: Array<MatchedProductImage<T>>;
      needsCompressedDriveUpload: boolean;
    }
  | {
      kind: 'external-url';
      product: Product;
      currentUrls: string[];
      externalUrls: string[];
    };

export interface DriveSyncPlan<T extends ScannableImageFile = ScannableImageFile> {
  allTasks: Array<DriveSyncTask<T>>;
  currentBatch: Array<DriveSyncTask<T>>;
  remainingCount: number;
  driveMatchedCount: number;
  driveOriginalOnlyCount: number;
  externalMigrationCount: number;
  skippedSyncedCount: number;
  unmatchedFiles: T[];
  ignoredFilesCount: number;
}

export function buildDriveSyncPlan<T extends ScannableImageFile>(
  files: T[],
  products: Product[],
  options: {
    includeAlreadySynced?: boolean;
    includeExternalMigration?: boolean;
    batchSize?: number;
    excludeProductIds?: ReadonlySet<string>;
    bucketName?: string;
  } = {},
): DriveSyncPlan<T> {
  const includeAlreadySynced = options.includeAlreadySynced ?? false;
  const includeExternalMigration = options.includeExternalMigration ?? true;
  const batchSize = Math.max(1, options.batchSize ?? IMAGE_SYNC_BATCH_SIZE);
  const bucketName = options.bucketName ?? PRODUCT_IMAGES_BUCKET;

  let skippedSyncedCount = 0;
  const eligibleProducts: Product[] = [];

  for (const product of products) {
    if (options.excludeProductIds?.has(product.id)) continue;
    const state = classifyProductImageSyncState(product, bucketName);
    if (!includeAlreadySynced && state === 'synced') {
      skippedSyncedCount += 1;
      continue;
    }
    eligibleProducts.push(product);
  }

  const scan = matchImageFilesToProducts(files, eligibleProducts);
  const driveMatchedProductIds = new Set<string>();

  const driveTasks: Array<DriveSyncTask<T>> = [];
  let driveOriginalOnlyCount = 0;

  for (const match of scan.matches) {
    driveMatchedProductIds.add(match.product.id);
    const needsCompressedDriveUpload = match.matchedFiles.some(
      (m) => m.isOriginalPrefix || !isJpgFilename(m.file.name),
    );
    if (match.matchedFiles.some((m) => m.isOriginalPrefix)) {
      driveOriginalOnlyCount += 1;
    }
    driveTasks.push({
      kind: 'drive-match',
      product: match.product,
      matchedFiles: match.matchedFiles,
      needsCompressedDriveUpload,
    });
  }

  const externalTasks: Array<DriveSyncTask<T>> = [];
  if (includeExternalMigration) {
    for (const product of eligibleProducts) {
      if (driveMatchedProductIds.has(product.id)) continue;
      const state = classifyProductImageSyncState(product, bucketName);
      if (state !== 'external') continue;
      const currentUrls = getProductImageUrls(product);
      const externalUrls = currentUrls.filter(
        (u) => !isSupabaseProductImageUrl(u, bucketName),
      );
      if (externalUrls.length > 0) {
        externalTasks.push({
          kind: 'external-url',
          product,
          currentUrls,
          externalUrls,
        });
      }
    }
  }

  const allTasks = [...driveTasks, ...externalTasks];
  const currentBatch = allTasks.slice(0, batchSize);

  return {
    allTasks,
    currentBatch,
    remainingCount: Math.max(0, allTasks.length - currentBatch.length),
    driveMatchedCount: driveTasks.length,
    driveOriginalOnlyCount,
    externalMigrationCount: externalTasks.length,
    skippedSyncedCount,
    unmatchedFiles: scan.unmatchedFiles,
    ignoredFilesCount: scan.ignoredFilesCount,
  };
}

export interface SupabaseScanPlan<T extends ScannableImageFile = ScannableImageFile> {
  allMatches: Array<ProductSkuScanMatch<T>>;
  currentBatch: Array<ProductSkuScanMatch<T>>;
  remainingCount: number;
  skippedSyncedCount: number;
  unmatchedFiles: T[];
  ignoredFilesCount: number;
}

export function buildSupabaseScanPlan<T extends ScannableImageFile>(
  files: T[],
  products: Product[],
  options: {
    includeAlreadySynced?: boolean;
    batchSize?: number;
    excludeProductIds?: ReadonlySet<string>;
    bucketName?: string;
  } = {},
): SupabaseScanPlan<T> {
  const includeAlreadySynced = options.includeAlreadySynced ?? false;
  const batchSize = Math.max(1, options.batchSize ?? IMAGE_SYNC_BATCH_SIZE);
  const bucketName = options.bucketName ?? PRODUCT_IMAGES_BUCKET;

  let skippedSyncedCount = 0;
  const eligibleProducts: Product[] = [];

  for (const product of products) {
    if (options.excludeProductIds?.has(product.id)) continue;
    const state = classifyProductImageSyncState(product, bucketName);
    if (!includeAlreadySynced && state === 'synced') {
      skippedSyncedCount += 1;
      continue;
    }
    eligibleProducts.push(product);
  }

  const scan = matchImageFilesToProducts(files, eligibleProducts);
  const currentBatch = scan.matches.slice(0, batchSize);

  return {
    allMatches: scan.matches,
    currentBatch,
    remainingCount: Math.max(0, scan.matches.length - currentBatch.length),
    skippedSyncedCount,
    unmatchedFiles: scan.unmatchedFiles,
    ignoredFilesCount: scan.ignoredFilesCount,
  };
}

export function computeRenamedStorageMoves(
  imageUrls: string[],
  oldSku: string,
  newSku: string,
  bucketName: string = PRODUCT_IMAGES_BUCKET,
): Array<{ oldPath: string; newPath: string; oldUrl: string }> {
  const oldSafe = sanitizeSkuForFilename(oldSku);
  const newSafe = sanitizeSkuForFilename(newSku);
  if (!oldSafe || !newSafe || oldSafe === newSafe) return [];

  const moves: Array<{ oldPath: string; newPath: string; oldUrl: string }> = [];
  const seenOld = new Set<string>();

  for (const url of imageUrls) {
    const oldPath = extractSupabaseStoragePathFromUrl(url, bucketName);
    if (!oldPath || seenOld.has(oldPath)) continue;

    const parts = oldPath.split('/');
    const fileName = parts[parts.length - 1] ?? '';
    const parsed = parseImageFilename(fileName);
    if (!parsed) continue;

    const dirPrefix = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
    const fileBase = parsed.isOriginalPrefix ? `0_${parsed.stem}` : parsed.stem;
    const expectedOldMain = buildProductImageFilename(oldSafe, 0, false);

    // Match `<oldSafe>.jpg` or `<oldSafe>_2.jpg` etc.
    let nextFileName: string | null = null;
    if (fileName.toLowerCase() === expectedOldMain.toLowerCase()) {
      nextFileName = buildProductImageFilename(newSafe, 0, false);
    } else if (
      fileBase.toLowerCase().startsWith(`${oldSafe}_`) ||
      parsed.stem.toLowerCase() === oldSafe
    ) {
      const slotMatch = parsed.stem
        .slice(oldSafe.length)
        .match(/^_(\d+)$/);
      const slotIdx = slotMatch?.[1] ? Math.max(0, Number(slotMatch[1]) - 1) : 0;
      nextFileName = buildProductImageFilename(
        newSafe,
        slotIdx,
        parsed.isOriginalPrefix,
      );
    }

    if (nextFileName && nextFileName !== fileName) {
      seenOld.add(oldPath);
      moves.push({
        oldPath,
        newPath: `${dirPrefix}${nextFileName}`,
        oldUrl: url,
      });
    }
  }

  return moves;
}

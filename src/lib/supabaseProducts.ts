import { getSupabaseClient } from './supabaseClient';
import { PRODUCTS } from '../data/catalog';
import type { CategoryNode, Product } from '../types/shop';

export const CATALOG_CACHE_STORAGE_KEY = 'vpp_huong_long_catalog_cache_v3';
export const BACKGROUND_SYNC_INTERVAL_MS = 10 * 60 * 1000;

export interface CatalogCachePayload {
  products: Product[];
  categories?: CategoryNode[];
  syncedAt: number;
  source: 'supabase' | 'demo';
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function normalizeGoogleDriveImageUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Match https://drive.google.com/file/d/<FILE_ID>/view...
  const filePathMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (filePathMatch?.[1]) {
    return `https://drive.google.com/thumbnail?id=${filePathMatch[1]}&sz=w800`;
  }

  // Match https://drive.google.com/open?id=<FILE_ID> or /uc?id=<FILE_ID>
  if (trimmed.includes('drive.google.com')) {
    try {
      const parsed = new URL(trimmed);
      const id = parsed.searchParams.get('id');
      if (id) {
        return `https://drive.google.com/thumbnail?id=${id}&sz=w800`;
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export function parseImageUrls(rawUrl: unknown): string[] {
  if (Array.isArray(rawUrl)) {
    return rawUrl
      .map((item) => normalizeGoogleDriveImageUrl(item))
      .filter(Boolean);
  }
  if (typeof rawUrl !== 'string') return [];
  const trimmed = rawUrl.trim();
  if (!trimmed) return [];

  // Split comma/semicolon/newline-separated URL lists (e.g. KiotViet multi-image fields)
  const parts = trimmed.split(/\s*[,;\n]+\s*(?=https?:\/\/|\/)/i);
  return parts.map((part) => normalizeGoogleDriveImageUrl(part)).filter(Boolean);
}

export function normalizeVndPrice(rawPrice: unknown): number {
  const num = Number(rawPrice ?? 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  // Database stores retail prices in thousands of VND (e.g. 15 -> 15.000₫, 125 -> 125.000₫)
  if (num < 1000) {
    return Math.round(num * 1000);
  }
  return Math.round(num);
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseVariants(rawVariants: unknown): string[] {
  if (Array.isArray(rawVariants)) {
    const cleaned = rawVariants
      .map((item) => String(item).trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : ['Tiêu chuẩn'];
  }
  if (typeof rawVariants === 'string' && rawVariants.trim()) {
    const split = rawVariants
      .split(/[,;|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    return split.length > 0 ? split : ['Tiêu chuẩn'];
  }
  return ['Tiêu chuẩn'];
}

export function mapSupabaseRowToCategory(
  row: Record<string, unknown>,
  index: number,
): CategoryNode {
  return {
    id: String(row.id ?? `cat-${index}`),
    name: String(row.name ?? 'Danh mục').trim(),
    slug: String(row.slug ?? row.id ?? `cat-${index}`).trim(),
    parentId: typeof row.parent_id === 'string' && row.parent_id ? row.parent_id : null,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    isActive: row.is_active !== false,
  };
}

export function mapSupabaseRowToProduct(
  row: Record<string, unknown>,
  index: number,
): Product {
  const categoryText =
    parseOptionalString(row.category_name) ??
    parseOptionalString(row.category) ??
    parseOptionalString(row.category_label) ??
    'Văn phòng phẩm';

  const price = normalizeVndPrice(row.selling_price ?? row.price ?? 0);
  const rawCostPrice = parseOptionalNumber(row.cost_price);
  const costPrice =
    rawCostPrice !== undefined ? normalizeVndPrice(rawCostPrice) : undefined;
  const rawStockQuantity = Number(
    row.stock_quantity ?? row.stock ?? row.quantity ?? 0,
  );
  const rawRank = Number(row.popular_rank ?? index + 1);
  const id = String(row.id ?? row.sku ?? `sp-${index + 1}`);
  const sku = String(row.sku ?? row.code ?? id).trim().toUpperCase();
  const name = String(row.name ?? row.title ?? `Sản phẩm ${sku}`).trim();
  const unit =
    parseOptionalString(row.unit) ??
    parseOptionalString(row.base_unit) ??
    'Cái';
  const notes = parseOptionalString(row.notes);
  const brand = parseOptionalString(row.brand);
  const barcode = parseOptionalString(row.barcode);
  const parsedImages = parseImageUrls(
    row.image_urls ?? row.image_url ?? row.img_url ?? row.image ?? '',
  );

  const descriptionText =
    parseOptionalString(row.description) ??
    notes ??
    (brand ? `${name} (${brand}) — ${categoryText}` : `${name} — ${categoryText}`);

  return {
    id,
    sku,
    barcode,
    name,
    brand,
    category: categoryText,
    categoryLabel: parseOptionalString(row.category_label) ?? categoryText,
    categoryId:
      typeof row.category_id === 'string' && row.category_id
        ? row.category_id
        : null,
    categorySlug: parseOptionalString(row.category_slug),
    price,
    costPrice,
    unit,
    baseUnit: parseOptionalString(row.base_unit),
    conversionRate: parseOptionalNumber(row.conversion_rate),
    stock: Number.isFinite(rawStockQuantity) ? rawStockQuantity : 0,
    minStock: parseOptionalNumber(row.min_stock),
    maxStock: parseOptionalNumber(row.max_stock),
    popularRank: Number.isFinite(rawRank) ? rawRank : index + 1,
    variants: parseVariants(row.variants),
    image: parsedImages[0] ?? '',
    images: parsedImages.length > 0 ? parsedImages : undefined,
    description: descriptionText,
    notes,
    featuredTag: parseOptionalString(row.featured_tag),
  };
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCachedCatalog(
  storage: StorageLike | null = getDefaultStorage(),
): CatalogCachePayload | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CATALOG_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CatalogCachePayload>;
    if (!Array.isArray(parsed.products) || parsed.products.length === 0) {
      return null;
    }
    return {
      products: parsed.products,
      categories: Array.isArray(parsed.categories) ? parsed.categories : undefined,
      syncedAt: typeof parsed.syncedAt === 'number' ? parsed.syncedAt : Date.now(),
      source: parsed.source === 'supabase' ? 'supabase' : 'demo',
    };
  } catch {
    return null;
  }
}

export function saveCachedCatalog(
  payload: CatalogCachePayload,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CATALOG_CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors in restricted/private mode
  }
}

export function isCatalogCacheStale(
  syncedAt: number | undefined,
  now: number = Date.now(),
  maxAgeMs: number = BACKGROUND_SYNC_INTERVAL_MS,
): boolean {
  if (!syncedAt || !Number.isFinite(syncedAt)) return true;
  return now - syncedAt >= maxAgeMs;
}

export interface CatalogFetchResult {
  products: Product[];
  categories?: CategoryNode[];
  source: 'supabase' | 'demo';
  syncedAt: number;
  errorMessage?: string;
}

export async function fetchCatalogFromSupabase(): Promise<CatalogFetchResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const productsTable =
    import.meta.env.VITE_SUPABASE_PRODUCTS_TABLE?.trim() || 'public_products';
  const categoriesTable =
    import.meta.env.VITE_SUPABASE_CATEGORIES_TABLE?.trim() || 'categories';

  const now = Date.now();

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      products: PRODUCTS,
      source: 'demo',
      syncedAt: now,
    };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const [productsRes, categoriesRes] = await Promise.all([
      supabase.from(productsTable).select('*'),
      supabase
        .from(categoriesTable)
        .select('*')
        .order('sort_order', { ascending: true }),
    ]);

    if (productsRes.error) {
      return {
        products: PRODUCTS,
        source: 'demo',
        syncedAt: now,
        errorMessage: `Không thể đồng bộ Supabase (${productsRes.error.message}). Đang dùng dữ liệu đã lưu.`,
      };
    }

    const rawProductRows = productsRes.data ?? [];
    const mappedCategories = !categoriesRes.error && Array.isArray(categoriesRes.data)
      ? categoriesRes.data.map((row, idx) =>
          mapSupabaseRowToCategory(row as Record<string, unknown>, idx),
        )
      : undefined;

    if (rawProductRows.length === 0) {
      return {
        products: PRODUCTS,
        categories: mappedCategories,
        source: 'demo',
        syncedAt: now,
        errorMessage:
          `Bảng/View ${productsTable} trên Supabase hiện chưa có dữ liệu. Đang hiển thị danh mục mẫu.`,
      };
    }

    const mappedProducts = rawProductRows.map((row, idx) =>
      mapSupabaseRowToProduct(row as Record<string, unknown>, idx),
    );

    return {
      products: mappedProducts,
      categories: mappedCategories,
      source: 'supabase',
      syncedAt: now,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Lỗi kết nối Supabase';
    return {
      products: PRODUCTS,
      source: 'demo',
      syncedAt: now,
      errorMessage: `Không thể đồng bộ Supabase (${message}). Đang dùng dữ liệu đã lưu.`,
    };
  }
}

export async function fetchProductsFromSupabase(): Promise<CatalogFetchResult> {
  return fetchCatalogFromSupabase();
}

import { createClient } from '@supabase/supabase-js';
import { PRODUCTS } from '../data/catalog';
import type { CategoryId, Product } from '../types/shop';

const CATEGORY_MAP: Record<string, { id: Exclude<CategoryId, 'all'>; label: string }> = {
  stationery: { id: 'stationery', label: 'Văn phòng phẩm' },
  'van phong pham': { id: 'stationery', label: 'Văn phòng phẩm' },
  vpp: { id: 'stationery', label: 'Văn phòng phẩm' },
  school: { id: 'school', label: 'Đồ dùng học sinh' },
  'do dung hoc sinh': { id: 'school', label: 'Đồ dùng học sinh' },
  hocsinh: { id: 'school', label: 'Đồ dùng học sinh' },
  toys: { id: 'toys', label: 'Đồ chơi' },
  'do choi': { id: 'toys', label: 'Đồ chơi' },
  'do choi & qua tang': { id: 'toys', label: 'Đồ chơi' },
  grocery: { id: 'grocery', label: 'Tạp hóa nhỏ' },
  'tap hoa': { id: 'grocery', label: 'Tạp hóa nhỏ' },
  'tap hoa nho': { id: 'grocery', label: 'Tạp hóa nhỏ' },
};

function stripAccents(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
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

function resolveCategory(
  rawCategory: unknown,
  rawCategoryLabel: unknown,
): { id: Exclude<CategoryId, 'all'>; label: string } {
  const key = stripAccents(String(rawCategory ?? rawCategoryLabel ?? ''));
  if (CATEGORY_MAP[key]) {
    return CATEGORY_MAP[key];
  }
  if (key.includes('hoc sinh') || key.includes('school')) {
    return { id: 'school', label: 'Đồ dùng học sinh' };
  }
  if (key.includes('choi') || key.includes('qua') || key.includes('toy')) {
    return { id: 'toys', label: 'Đồ chơi' };
  }
  if (key.includes('tap hoa') || key.includes('grocery') || key.includes('banh')) {
    return { id: 'grocery', label: 'Tạp hóa nhỏ' };
  }
  return {
    id: 'stationery',
    label:
      typeof rawCategoryLabel === 'string' && rawCategoryLabel.trim()
        ? rawCategoryLabel.trim()
        : 'Văn phòng phẩm',
  };
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

export function mapSupabaseRowToProduct(
  row: Record<string, unknown>,
  index: number,
): Product {
  const resolvedCategory = resolveCategory(row.category, row.category_label);
  const rawPrice = Number(row.price ?? 0);
  const rawStock = Number(row.stock ?? row.quantity ?? 0);
  const rawRank = Number(row.popular_rank ?? index + 1);
  const id = String(row.id ?? row.sku ?? `sp-${index + 1}`);
  const sku = String(row.sku ?? row.code ?? id).toUpperCase();
  const name = String(row.name ?? row.title ?? `Sản phẩm ${sku}`);
  const unit = String(row.unit ?? 'Cái');
  const imgUrl = normalizeGoogleDriveImageUrl(
    row.img_url ?? row.image_url ?? row.image ?? '',
  );

  return {
    id,
    sku,
    name,
    category: resolvedCategory.id,
    categoryLabel:
      typeof row.category_label === 'string' && row.category_label.trim()
        ? row.category_label.trim()
        : resolvedCategory.label,
    price: Number.isFinite(rawPrice) ? rawPrice : 0,
    unit,
    stock: Number.isFinite(rawStock) ? rawStock : 0,
    popularRank: Number.isFinite(rawRank) ? rawRank : index + 1,
    variants: parseVariants(row.variants),
    image: imgUrl,
    description:
      typeof row.description === 'string' && row.description.trim()
        ? row.description.trim()
        : `${name} — ${resolvedCategory.label}`,
    featuredTag:
      typeof row.featured_tag === 'string' && row.featured_tag.trim()
        ? row.featured_tag.trim()
        : undefined,
  };
}

export interface CatalogFetchResult {
  products: Product[];
  source: 'supabase' | 'demo';
  errorMessage?: string;
}

export async function fetchProductsFromSupabase(): Promise<CatalogFetchResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const tableName =
    import.meta.env.VITE_SUPABASE_PRODUCTS_TABLE?.trim() || 'products';

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      products: PRODUCTS,
      source: 'demo',
    };
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.from(tableName).select('*');

    if (error) {
      return {
        products: PRODUCTS,
        source: 'demo',
        errorMessage: `Không thể tải dữ liệu từ Supabase (${error.message}). Đang hiển thị danh mục mẫu.`,
      };
    }

    if (!data || data.length === 0) {
      return {
        products: [],
        source: 'supabase',
      };
    }

    return {
      products: data.map((row, idx) =>
        mapSupabaseRowToProduct(row as Record<string, unknown>, idx),
      ),
      source: 'supabase',
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Lỗi kết nối Supabase';
    return {
      products: PRODUCTS,
      source: 'demo',
      errorMessage: `Không thể tải dữ liệu từ Supabase (${message}). Đang hiển thị danh mục mẫu.`,
    };
  }
}

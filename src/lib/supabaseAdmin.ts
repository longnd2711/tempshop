import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import { mapSupabaseRowToCategory, mapSupabaseRowToProduct } from './supabaseProducts';
import type {
  AdminUser,
  CategoryNode,
  CustomerRecord,
  Product,
  PurchaseOrderItem,
  PurchaseOrderRecord,
  UserProfileRecord,
  UserRole,
} from '../types/shop';

function getAdminConfig() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const adminProductsTable =
    import.meta.env.VITE_SUPABASE_ADMIN_PRODUCTS_TABLE?.trim() || 'products';
  const categoriesTable =
    import.meta.env.VITE_SUPABASE_CATEGORIES_TABLE?.trim() || 'categories';
  const profilesTable =
    import.meta.env.VITE_SUPABASE_PROFILES_TABLE?.trim() || 'user_profiles';
  const purchaseOrdersTable =
    import.meta.env.VITE_SUPABASE_PURCHASE_ORDERS_TABLE?.trim() || 'purchase_orders';
  const purchaseItemsTable =
    import.meta.env.VITE_SUPABASE_PURCHASE_ITEMS_TABLE?.trim() ||
    'purchase_order_items';
  const customersTable =
    import.meta.env.VITE_SUPABASE_CUSTOMERS_TABLE?.trim() || 'customers';

  return {
    supabaseUrl,
    supabaseAnonKey,
    adminProductsTable,
    categoriesTable,
    profilesTable,
    purchaseOrdersTable,
    purchaseItemsTable,
    customersTable,
  };
}

function normalizeRole(value: unknown): UserRole {
  if (value === 'admin') return 'admin';
  if (value === 'manager') return 'manager';
  return 'staff';
}

function formatDateTimeDisplay(isoString: unknown): string {
  if (typeof isoString !== 'string' || !isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function resolveSessionUser(session: Session | null): Promise<AdminUser | null> {
  if (!session?.user) return null;

  const { supabaseUrl, supabaseAnonKey, profilesTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
  let role: UserRole = 'staff';
  let fullName = '';
  let phone = '';
  let notes = '';

  try {
    let { data, error } = await supabase
      .from(profilesTable)
      .select('role, full_name, phone, notes')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (error) {
      const fallback = await supabase
        .from(profilesTable)
        .select('role, full_name')
        .eq('user_id', session.user.id)
        .maybeSingle();
      data = fallback.data as typeof data;
      error = fallback.error;
    }

    if (!error && data) {
      const row = data as Record<string, unknown>;
      role = normalizeRole(row.role);
      fullName = String(row.full_name ?? '');
      phone = String(row.phone ?? '');
      notes = String(row.notes ?? '');
    }
  } catch {
    role = 'staff';
  }

  return {
    id: session.user.id,
    email: session.user.email ?? '',
    fullName,
    phone,
    notes,
    role,
  };
}

export async function getAdminSessionUser(): Promise<AdminUser | null> {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    return await resolveSessionUser(data.session);
  } catch {
    return null;
  }
}

export function onAdminUserAuthChange(
  callback: (user: AdminUser | null) => void,
): () => void {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) return () => {};

  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(
    (_event: AuthChangeEvent, session: Session | null) => {
      void resolveSessionUser(session).then((resolved) => {
        callback(resolved);
      });
    },
  );
  return () => subscription.unsubscribe();
}

export async function signInAdminUser(
  email: string,
  password: string,
): Promise<{ user: AdminUser | null; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      user: null,
      errorMessage: 'Chưa cấu hình kết nối Supabase (.env).',
    };
  }
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.session) {
      return {
        user: null,
        errorMessage:
          error?.message === 'Invalid login credentials'
            ? 'Email hoặc mật khẩu chưa đúng.'
            : error?.message ?? 'Không thể đăng nhập.',
      };
    }
    const resolved = await resolveSessionUser(data.session);
    return { user: resolved };
  } catch (err) {
    return {
      user: null,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi kết nối khi đăng nhập',
    };
  }
}

export async function signOutAdminUser(): Promise<void> {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) return;
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    await supabase.auth.signOut();
  } catch {
    // Ignore signout errors
  }
}

export function mapSupabaseCustomerRow(row: Record<string, unknown>): CustomerRecord {
  const lastOrderIso =
    typeof row.last_order_at === 'string'
      ? row.last_order_at
      : typeof row.updated_at === 'string'
        ? row.updated_at
        : undefined;

  return {
    id: String(row.id ?? ''),
    phone: String(row.phone ?? ''),
    fullName: String(row.full_name ?? ''),
    defaultAddress: String(row.default_address ?? ''),
    notes: String(row.notes ?? ''),
    totalOrders: Number(row.total_orders ?? 0),
    totalSpent: Number(row.total_spent ?? 0),
    lastOrderAt: lastOrderIso ? formatDateTimeDisplay(lastOrderIso) : '',
    lastOrderAtIso: lastOrderIso,
  };
}

export async function fetchAdminCustomers(): Promise<{
  customers: CustomerRecord[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, customersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { customers: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(customersTable)
      .select('*')
      .order('last_order_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) {
      return { customers: [], errorMessage: error.message };
    }

    return {
      customers: (data ?? []).map((row) =>
        mapSupabaseCustomerRow(row as Record<string, unknown>),
      ),
    };
  } catch (err) {
    return {
      customers: [],
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tải danh sách khách hàng',
    };
  }
}

export interface UpsertCustomerInput {
  id?: string;
  phone: string;
  fullName: string;
  defaultAddress: string;
  notes: string;
}

export async function upsertAdminCustomer(
  input: UpsertCustomerInput,
): Promise<{ customer?: CustomerRecord; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, customersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const cleanPhone = input.phone.replace(/[\s.-]/g, '').trim();
    const payload = {
      phone: cleanPhone,
      full_name: input.fullName.trim(),
      default_address: input.defaultAddress.trim(),
      notes: input.notes.trim(),
    };

    const query = input.id
      ? supabase
          .from(customersTable)
          .update(payload)
          .eq('id', input.id)
          .select()
          .single()
      : supabase.from(customersTable).insert(payload).select().single();

    const { data, error } = await query;
    if (error || !data) {
      return { errorMessage: error?.message ?? 'Không thể lưu thông tin khách hàng.' };
    }
    return {
      customer: mapSupabaseCustomerRow(data as Record<string, unknown>),
    };
  } catch (err) {
    return {
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi lưu thông tin khách hàng',
    };
  }
}

export async function deleteAdminCustomer(
  customerId: string,
): Promise<{ errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, customersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase
      .from(customersTable)
      .delete()
      .eq('id', customerId);
    return error ? { errorMessage: error.message } : {};
  } catch (err) {
    return {
      errorMessage: err instanceof Error ? err.message : 'Lỗi xóa khách hàng',
    };
  }
}

export async function fetchAdminCategories(): Promise<{
  categories: CategoryNode[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, categoriesTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { categories: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(categoriesTable)
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      return { categories: [], errorMessage: error.message };
    }

    return {
      categories: (data ?? []).map((row, idx) =>
        mapSupabaseRowToCategory(row as Record<string, unknown>, idx),
      ),
    };
  } catch (err) {
    return {
      categories: [],
      errorMessage: err instanceof Error ? err.message : 'Lỗi tải nhóm hàng',
    };
  }
}

export interface UpsertCategoryInput {
  id?: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function upsertAdminCategory(
  input: UpsertCategoryInput,
): Promise<{ category?: CategoryNode; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, categoriesTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const payload = {
      name: input.name.trim(),
      slug: input.slug.trim(),
      parent_id: input.parentId || null,
      sort_order: Number(input.sortOrder) || 0,
      is_active: Boolean(input.isActive),
    };

    const query = input.id
      ? supabase
          .from(categoriesTable)
          .update(payload)
          .eq('id', input.id)
          .select()
          .single()
      : supabase.from(categoriesTable).insert(payload).select().single();

    const { data, error } = await query;
    if (error || !data) {
      return { errorMessage: error?.message ?? 'Không thể lưu nhóm hàng.' };
    }
    return {
      category: mapSupabaseRowToCategory(data as Record<string, unknown>, 0),
    };
  } catch (err) {
    return {
      errorMessage: err instanceof Error ? err.message : 'Lỗi lưu nhóm hàng',
    };
  }
}

export async function deleteAdminCategory(
  categoryId: string,
): Promise<{ errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, categoriesTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase
      .from(categoriesTable)
      .delete()
      .eq('id', categoryId);
    return error ? { errorMessage: error.message } : {};
  } catch (err) {
    return {
      errorMessage: err instanceof Error ? err.message : 'Lỗi xóa nhóm hàng',
    };
  }
}

export async function fetchAdminProducts(
  categories: CategoryNode[] = [],
): Promise<{
  products: Product[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, adminProductsTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { products: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(adminProductsTable)
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      return { products: [], errorMessage: error.message };
    }

    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const products = (data ?? []).map((row, idx) => {
      const rec = row as Record<string, unknown>;
      const catId =
        typeof rec.category_id === 'string' ? rec.category_id : null;
      const matchedCat = catId ? categoryMap.get(catId) : undefined;
      const mapped = mapSupabaseRowToProduct(
        {
          ...rec,
          category_name: matchedCat?.name ?? rec.category_name,
          category_slug: matchedCat?.slug ?? rec.category_slug,
        },
        idx,
      );
      return {
        ...mapped,
        isActive: rec.is_active !== false,
      };
    });

    return { products };
  } catch (err) {
    return {
      products: [],
      errorMessage: err instanceof Error ? err.message : 'Lỗi tải hàng hóa',
    };
  }
}

export interface UpsertProductInput {
  id?: string;
  categoryId: string | null;
  sku: string;
  barcode?: string;
  name: string;
  brand?: string;
  sellingPrice: number;
  costPrice: number;
  stockQuantity: number;
  minStock: number;
  maxStock?: number;
  baseUnit: string;
  unit: string;
  conversionRate: number;
  imageUrls: string[];
  notes?: string;
  isActive: boolean;
}

export async function upsertAdminProduct(
  input: UpsertProductInput,
): Promise<{ product?: Product; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, adminProductsTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const payload = {
      category_id: input.categoryId || null,
      sku: input.sku.trim().toUpperCase(),
      barcode: input.barcode?.trim() || null,
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
      selling_price: Math.max(0, Number(input.sellingPrice) || 0),
      cost_price: Math.max(0, Number(input.costPrice) || 0),
      stock_quantity: Number(input.stockQuantity) || 0,
      min_stock: Math.max(0, Number(input.minStock) || 0),
      max_stock:
        input.maxStock !== undefined && Number.isFinite(input.maxStock)
          ? Number(input.maxStock)
          : null,
      base_unit: input.baseUnit.trim() || 'Cái',
      unit: input.unit.trim() || input.baseUnit.trim() || 'Cái',
      conversion_rate: Math.max(0.01, Number(input.conversionRate) || 1),
      image_urls: input.imageUrls,
      notes: input.notes?.trim() || null,
      is_active: Boolean(input.isActive),
    };

    const query = input.id
      ? supabase
          .from(adminProductsTable)
          .update(payload)
          .eq('id', input.id)
          .select()
          .single()
      : supabase.from(adminProductsTable).insert(payload).select().single();

    const { data, error } = await query;
    if (error || !data) {
      return { errorMessage: error?.message ?? 'Không thể lưu hàng hóa.' };
    }
    const rec = data as Record<string, unknown>;
    return {
      product: {
        ...mapSupabaseRowToProduct(rec, 0),
        isActive: rec.is_active !== false,
      },
    };
  } catch (err) {
    return {
      errorMessage: err instanceof Error ? err.message : 'Lỗi lưu hàng hóa',
    };
  }
}

export async function deleteAdminProduct(
  productId: string,
): Promise<{ errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, adminProductsTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase
      .from(adminProductsTable)
      .delete()
      .eq('id', productId);
    return error ? { errorMessage: error.message } : {};
  } catch (err) {
    return {
      errorMessage: err instanceof Error ? err.message : 'Lỗi xóa hàng hóa',
    };
  }
}

export function mapSupabasePurchaseOrderRow(
  row: Record<string, unknown>,
  itemRows: Record<string, unknown>[],
): PurchaseOrderRecord {
  const poId = String(row.id ?? '');
  const items: PurchaseOrderItem[] = itemRows
    .filter((item) => String(item.purchase_order_id ?? '') === poId)
    .map((item) => {
      const unitCost = Number(item.unit_cost ?? 0);
      const discountAmount = Number(item.discount_amount ?? 0);
      const discountPercent =
        Number(item.discount_percent ?? 0) ||
        (unitCost > 0 && discountAmount > 0
          ? Number(((discountAmount / unitCost) * 100).toFixed(2))
          : 0);
      const netUnitCost = Math.max(0, unitCost - discountAmount);
      const quantity = Number(item.quantity ?? 0);
      const sellingPriceRaw = item.selling_price;
      return {
        id: String(item.id ?? ''),
        productId: String(item.product_id ?? ''),
        sku: String(item.sku ?? ''),
        productName: String(item.product_name ?? 'Sản phẩm'),
        unitLabel: String(item.unit_label ?? 'Cái'),
        conversionFactor: Number(item.conversion_factor ?? 1),
        quantity,
        unitCost,
        discountPercent,
        discountAmount,
        netUnitCost,
        sellingPrice:
          sellingPriceRaw !== null && sellingPriceRaw !== undefined
            ? Number(sellingPriceRaw)
            : undefined,
        lineTotal:
          item.line_total !== null && item.line_total !== undefined
            ? Number(item.line_total)
            : Math.round(quantity * netUnitCost),
      };
    });

  const importedIso =
    typeof row.imported_at === 'string'
      ? row.imported_at
      : typeof row.created_at === 'string'
        ? row.created_at
        : undefined;

  return {
    id: poId || undefined,
    poCode: String(row.po_code ?? ''),
    supplierName: String(row.supplier_name ?? ''),
    note: String(row.note ?? ''),
    totalAmount: Number(row.total_amount ?? 0),
    itemCount: Number(row.item_count ?? items.length),
    createdByEmail: String(row.created_by_email ?? ''),
    importedAt: importedIso ? formatDateTimeDisplay(importedIso) : '',
    importedAtIso: importedIso,
    items,
  };
}

export async function fetchPurchaseOrders(): Promise<{
  purchaseOrders: PurchaseOrderRecord[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, purchaseOrdersTable, purchaseItemsTable } =
    getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { purchaseOrders: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const [poRes, itemsRes] = await Promise.all([
      supabase
        .from(purchaseOrdersTable)
        .select('*')
        .order('imported_at', { ascending: false }),
      supabase.from(purchaseItemsTable).select('*'),
    ]);

    if (poRes.error) {
      return { purchaseOrders: [], errorMessage: poRes.error.message };
    }

    const mapped = (poRes.data ?? []).map((row) =>
      mapSupabasePurchaseOrderRow(
        row as Record<string, unknown>,
        (itemsRes.data ?? []) as Record<string, unknown>[],
      ),
    );
    return { purchaseOrders: mapped };
  } catch (err) {
    return {
      purchaseOrders: [],
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tải danh sách đơn nhập hàng',
    };
  }
}

export interface CreatePurchaseOrderInput {
  poCode: string;
  supplierName: string;
  note: string;
  updateCostPrice: boolean;
  items: PurchaseOrderItem[];
}

export async function createPurchaseOrderInSupabase(
  input: CreatePurchaseOrderInput,
): Promise<{ ok: boolean; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const itemPayloads = input.items.map((item) => ({
      product_id: item.productId || null,
      sku: item.sku,
      product_name: item.productName,
      unit_label: item.unitLabel,
      conversion_factor: item.conversionFactor,
      quantity: item.quantity,
      unit_cost: item.unitCost,
      discount_percent: item.discountPercent,
      discount_amount: item.discountAmount,
      selling_price:
        item.sellingPrice !== undefined && Number.isFinite(item.sellingPrice)
          ? Math.max(0, Number(item.sellingPrice))
          : null,
      is_new_product: Boolean(item.isNewProduct),
      category_id: item.newProductCategoryId || null,
      barcode: item.newProductBarcode || null,
      brand: item.newProductBrand || null,
      base_unit: item.newProductBaseUnit || item.unitLabel,
      unit: item.newProductUnit || item.unitLabel,
      conversion_rate: item.newProductConversionRate || item.conversionFactor || 1,
      image_urls: item.newProductImageUrls ?? [],
    }));

    const { error } = await supabase.rpc('create_purchase_order', {
      p_po_code: input.poCode.trim(),
      p_supplier_name: input.supplierName.trim(),
      p_note: input.note.trim(),
      p_update_cost_price: input.updateCostPrice,
      p_items: itemPayloads,
    });

    if (error) {
      return { ok: false, errorMessage: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tạo đơn nhập hàng',
    };
  }
}

export function mapSupabaseUserProfileRow(
  row: Record<string, unknown>,
): UserProfileRecord {
  const createdIso =
    typeof row.created_at === 'string' ? row.created_at : undefined;
  const updatedIso =
    typeof row.updated_at === 'string' ? row.updated_at : undefined;

  return {
    userId: String(row.user_id ?? ''),
    email: String(row.email ?? ''),
    fullName: String(row.full_name ?? ''),
    phone: String(row.phone ?? ''),
    notes: String(row.notes ?? ''),
    role: normalizeRole(row.role),
    createdAt: createdIso ? formatDateTimeDisplay(createdIso) : undefined,
    updatedAt: updatedIso ? formatDateTimeDisplay(updatedIso) : undefined,
  };
}

export async function fetchAdminUsers(): Promise<{
  users: UserProfileRecord[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, profilesTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { users: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(profilesTable)
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return { users: [], errorMessage: error.message };
    }

    return {
      users: (data ?? []).map((row) =>
        mapSupabaseUserProfileRow(row as Record<string, unknown>),
      ),
    };
  } catch (err) {
    return {
      users: [],
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tải danh sách người dùng',
    };
  }
}

export interface UpdateAdminUserProfileInput {
  userId: string;
  fullName: string;
  phone: string;
  notes: string;
  role: UserRole;
}

export async function updateAdminUserProfile(
  input: UpdateAdminUserProfileInput,
): Promise<{ user: UserProfileRecord | null; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, profilesTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, errorMessage: 'Chưa cấu hình Supabase.' };
  }

  const cleanPhone = input.phone.replace(/[\s.-]/g, '').trim();
  const safeRole: UserRole =
    input.role === 'admin'
      ? 'admin'
      : input.role === 'manager'
        ? 'manager'
        : 'staff';
  const payload = {
    full_name: input.fullName.trim(),
    phone: cleanPhone,
    notes: input.notes.trim(),
    role: safeRole,
  };

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(profilesTable)
      .update(payload)
      .eq('user_id', input.userId)
      .select('*')
      .single();

    if (error) {
      return {
        user: null,
        errorMessage:
          error.message.includes('phone') ||
          error.message.includes('notes') ||
          error.message.includes('user_profiles_role_check')
            ? 'Cấu trúc bảng user_profiles chưa được cập nhật quyền manager hoặc cột phone/notes. Vui lòng chạy lại script db_creat/supabase_schema.sql trong Supabase SQL Editor.'
            : error.message,
      };
    }

    return {
      user: data
        ? mapSupabaseUserProfileRow(data as Record<string, unknown>)
        : null,
    };
  } catch (err) {
    return {
      user: null,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi cập nhật hồ sơ người dùng',
    };
  }
}

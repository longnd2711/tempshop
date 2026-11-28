import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import { mapSupabaseRowToCategory, mapSupabaseRowToProduct } from './supabaseProducts';
import { normalizeExtraFees, sumExtraFees } from '../utils/adminLogic';
import type {
  AdminUser,
  CashVoucherCategory,
  CashVoucherPaymentMethod,
  CashVoucherRecord,
  CashVoucherType,
  CategoryNode,
  CustomerRecord,
  ExtraFeeItem,
  Product,
  PurchaseOrderItem,
  PurchaseOrderRecord,
  PurchasePackOption,
  SupplierRecord,
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
  const suppliersTable =
    import.meta.env.VITE_SUPABASE_SUPPLIERS_TABLE?.trim() || 'suppliers';
  const ordersTable =
    import.meta.env.VITE_SUPABASE_ORDERS_TABLE?.trim() || 'orders';
  const cashVouchersTable =
    import.meta.env.VITE_SUPABASE_CASH_VOUCHERS_TABLE?.trim() || 'cash_vouchers';

  return {
    supabaseUrl,
    supabaseAnonKey,
    adminProductsTable,
    categoriesTable,
    profilesTable,
    purchaseOrdersTable,
    purchaseItemsTable,
    customersTable,
    suppliersTable,
    ordersTable,
    cashVouchersTable,
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
    area: parseNullableText(row.area),
    customerGroup: parseNullableText(row.customer_group) ?? 'Khách lẻ',
    taxCode: parseNullableText(row.tax_code),
    bankAccount: parseNullableText(row.bank_account),
    bankName: parseNullableText(row.bank_name),
    email: parseNullableText(row.email),
    creditLimit:
      row.credit_limit !== null &&
      row.credit_limit !== undefined &&
      Number.isFinite(Number(row.credit_limit))
        ? Number(row.credit_limit)
        : null,
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
  area?: string | null;
  customerGroup?: string | null;
  taxCode?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  email?: string | null;
  creditLimit?: number | null;
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
    const cleanNullable = (val?: string | null) => {
      const trimmed = (val ?? '').trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const basePayload: Record<string, unknown> = {
      phone: cleanPhone,
      full_name: input.fullName.trim(),
      default_address: input.defaultAddress.trim(),
      notes: input.notes.trim(),
    };

    const extendedPayload: Record<string, unknown> = {
      ...basePayload,
      area: cleanNullable(input.area),
      customer_group: cleanNullable(input.customerGroup) ?? 'Khách lẻ',
      tax_code: cleanNullable(input.taxCode),
      bank_account: cleanNullable(input.bankAccount),
      bank_name: cleanNullable(input.bankName),
      email: cleanNullable(input.email),
      credit_limit:
        input.creditLimit !== null &&
        input.creditLimit !== undefined &&
        Number.isFinite(Number(input.creditLimit))
          ? Math.max(0, Number(input.creditLimit))
          : null,
    };

    const runSave = (payloadToSend: Record<string, unknown>) =>
      (input.id
        ? supabase.from(customersTable).update(payloadToSend).eq('id', input.id)
        : supabase.from(customersTable).insert(payloadToSend)
      )
        .select()
        .single();

    let { data, error } = await runSave(extendedPayload);

    if (
      error &&
      /area|customer_group|tax_code|bank_account|bank_name|email|credit_limit/i.test(
        error.message,
      )
    ) {
      const hasExtendedValues =
        extendedPayload.area !== null ||
        (extendedPayload.customer_group !== null &&
          extendedPayload.customer_group !== 'Khách lẻ') ||
        extendedPayload.tax_code !== null ||
        extendedPayload.bank_account !== null ||
        extendedPayload.bank_name !== null ||
        extendedPayload.email !== null ||
        extendedPayload.credit_limit !== null;
      if (!hasExtendedValues) {
        const retry = await runSave(basePayload);
        data = retry.data;
        error = retry.error;
      } else {
        return {
          errorMessage:
            'Bảng customers trên Supabase chưa có các cột mở rộng (khu vực, nhóm khách, MST, tài khoản NH, hạn mức nợ). Vui lòng chạy script db_creat/upgrade_schema_06.sql trong Supabase SQL Editor.',
        };
      }
    }

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

export async function deleteCustomersToGuest(
  customerIds: string[],
): Promise<{ deletedCount: number; unlinkedOrders: number; errorMessage?: string }> {
  const cleanIds = Array.from(
    new Set(customerIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (cleanIds.length === 0) {
    return { deletedCount: 0, unlinkedOrders: 0 };
  }

  const { supabaseUrl, supabaseAnonKey, customersTable, ordersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { deletedCount: 0, unlinkedOrders: 0, errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const rpcRes = await supabase.rpc('delete_customers_to_guest', {
      p_customer_ids: cleanIds,
    });

    if (!rpcRes.error && rpcRes.data) {
      const resData = rpcRes.data as Record<string, unknown>;
      return {
        deletedCount: Number(resData.deleted_count ?? cleanIds.length),
        unlinkedOrders: Number(resData.unlinked_orders ?? 0),
      };
    }

    // Fallback: unlink customer_id on orders while preserving customer_name, phone, address
    if (
      rpcRes.error &&
      /delete_customers_to_guest|function|schema cache/i.test(rpcRes.error.message)
    ) {
      const { error: unlinkErr } = await supabase
        .from(ordersTable)
        .update({ customer_id: null })
        .in('customer_id', cleanIds);
      if (unlinkErr) {
        return { deletedCount: 0, unlinkedOrders: 0, errorMessage: unlinkErr.message };
      }
      const { error: delErr } = await supabase
        .from(customersTable)
        .delete()
        .in('id', cleanIds);
      if (delErr) {
        return { deletedCount: 0, unlinkedOrders: 0, errorMessage: delErr.message };
      }
      return { deletedCount: cleanIds.length, unlinkedOrders: 0 };
    }

    return {
      deletedCount: 0,
      unlinkedOrders: 0,
      errorMessage: rpcRes.error?.message ?? 'Không thể xóa khách hàng đã chọn.',
    };
  } catch (err) {
    return {
      deletedCount: 0,
      unlinkedOrders: 0,
      errorMessage: err instanceof Error ? err.message : 'Lỗi xóa khách hàng',
    };
  }
}

export async function mergeCustomersInSupabase(input: {
  primaryId: string;
  duplicateIds: string[];
  merged: {
    phone: string;
    fullName: string;
    defaultAddress: string;
    area?: string | null;
    customerGroup?: string | null;
    taxCode?: string | null;
    bankAccount?: string | null;
    bankName?: string | null;
    email?: string | null;
    creditLimit?: number | null;
    notes: string;
  };
}): Promise<{ customer?: CustomerRecord; movedOrders?: number; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, customersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.rpc('merge_customers', {
      p_primary_id: input.primaryId,
      p_duplicate_ids: input.duplicateIds,
      p_merged: {
        phone: input.merged.phone.replace(/[\s.-]/g, '').trim(),
        full_name: input.merged.fullName.trim(),
        default_address: input.merged.defaultAddress.trim(),
        area: input.merged.area?.trim() || null,
        customer_group: input.merged.customerGroup?.trim() || 'Khách lẻ',
        tax_code: input.merged.taxCode?.trim() || null,
        bank_account: input.merged.bankAccount?.trim() || null,
        bank_name: input.merged.bankName?.trim() || null,
        email: input.merged.email?.trim() || null,
        credit_limit:
          input.merged.creditLimit !== null &&
          input.merged.creditLimit !== undefined &&
          Number.isFinite(Number(input.merged.creditLimit))
            ? Math.max(0, Number(input.merged.creditLimit))
            : null,
        notes: input.merged.notes.trim(),
      },
    });

    if (error) {
      return {
        errorMessage: /merge_customers|function|schema cache/i.test(error.message)
          ? 'Chưa có hàm gộp khách hàng merge_customers trên Supabase. Vui lòng chạy script db_creat/upgrade_schema_06.sql trong Supabase SQL Editor.'
          : error.message,
      };
    }

    const resObj = (data ?? {}) as Record<string, unknown>;
    const movedOrders = Number(resObj.moved_orders ?? 0);

    const { data: refreshed } = await supabase
      .from(customersTable)
      .select('*')
      .eq('id', input.primaryId)
      .maybeSingle();

    return {
      customer: refreshed
        ? mapSupabaseCustomerRow(refreshed as Record<string, unknown>)
        : undefined,
      movedOrders,
    };
  } catch (err) {
    return {
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi gộp khách hàng trên Supabase',
    };
  }
}

export async function deleteAdminCustomer(
  customerId: string,
): Promise<{ errorMessage?: string }> {
  const res = await deleteCustomersToGuest([customerId]);
  return res.errorMessage ? { errorMessage: res.errorMessage } : {};
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
  purchasePackOptions?: PurchasePackOption[];
  minStock: number | null;
  maxStock: number | null;
  baseUnit: string;
  unit: string;
  conversionRate: number;
  variants?: string[];
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
    const cleanedVariants = (input.variants ?? [])
      .map((v) => v.trim())
      .filter(Boolean);
    const cleanedPacks = (input.purchasePackOptions ?? [])
      .filter((p) => p.label.trim() && Number.isFinite(p.factor) && p.factor > 0)
      .map((p) => ({ label: p.label.trim(), factor: Number(p.factor) }));

    const basePayload: Record<string, unknown> = {
      category_id: input.categoryId || null,
      sku: input.sku.trim().toUpperCase(),
      barcode: input.barcode?.trim() || null,
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
      selling_price: Math.max(0, Number(input.sellingPrice) || 0),
      cost_price: Math.max(0, Number(input.costPrice) || 0),
      stock_quantity: Number(input.stockQuantity) || 0,
      min_stock:
        input.minStock !== null &&
        input.minStock !== undefined &&
        Number.isFinite(input.minStock)
          ? Number(input.minStock)
          : null,
      max_stock:
        input.maxStock !== null &&
        input.maxStock !== undefined &&
        Number.isFinite(input.maxStock)
          ? Number(input.maxStock)
          : null,
      base_unit: input.baseUnit.trim() || 'Cái',
      unit: input.unit.trim() || input.baseUnit.trim() || 'Cái',
      conversion_rate: Math.max(0.01, Number(input.conversionRate) || 1),
      image_urls: input.imageUrls.length > 0 ? input.imageUrls : null,
      notes: input.notes?.trim() || null,
      is_active: Boolean(input.isActive),
    };

    const extendedPayload: Record<string, unknown> = {
      ...basePayload,
      variants: cleanedVariants,
      purchase_pack_options: cleanedPacks,
    };

    const runSave = (payloadToSend: Record<string, unknown>) =>
      input.id
        ? supabase
            .from(adminProductsTable)
            .update(payloadToSend)
            .eq('id', input.id)
            .select()
            .single()
        : supabase
            .from(adminProductsTable)
            .insert(payloadToSend)
            .select()
            .single();

    let { data, error } = await runSave(extendedPayload);

    // Fallback gracefully if DB hasn't run upgrade_schema_03 yet or image_urls/min_stock NOT NULL
    if (error) {
      const retryPayload = { ...extendedPayload };
      let shouldRetry = false;

      if (/purchase_pack_options/i.test(error.message)) {
        delete retryPayload.purchase_pack_options;
        shouldRetry = true;
      }
      if (/variants/i.test(error.message) && cleanedVariants.length === 0) {
        delete retryPayload.variants;
        shouldRetry = true;
      }
      if (/image_urls/i.test(error.message) && retryPayload.image_urls === null) {
        retryPayload.image_urls = [];
        shouldRetry = true;
      }
      if (/min_stock/i.test(error.message) && retryPayload.min_stock === null) {
        retryPayload.min_stock = 0;
        shouldRetry = true;
      }

      if (shouldRetry) {
        const retry = await runSave(retryPayload);
        data = retry.data;
        error = retry.error;
      } else if (/variants/i.test(error.message)) {
        return {
          errorMessage:
            'Bảng products trên Supabase chưa có cột variants. Vui lòng chạy file db_creat/upgrade_schema_02.sql trong Supabase SQL Editor.',
        };
      }
    }

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

export async function updateProductStockBounds(
  productId: string,
  minStock: number | null,
  maxStock: number | null,
): Promise<{ product?: Product; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, adminProductsTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  const normalizeBound = (val: number | null) =>
    val !== null && val !== undefined && Number.isFinite(Number(val))
      ? Math.max(0, Number(val))
      : null;

  const cleanMin = normalizeBound(minStock);
  const cleanMax = normalizeBound(maxStock);

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    let { data, error } = await supabase
      .from(adminProductsTable)
      .update({
        min_stock: cleanMin,
        max_stock: cleanMax,
      })
      .eq('id', productId)
      .select()
      .single();

    if (error && /min_stock/i.test(error.message) && cleanMin === null) {
      const retry = await supabase
        .from(adminProductsTable)
        .update({
          min_stock: 0,
          max_stock: cleanMax,
        })
        .eq('id', productId)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      return {
        errorMessage:
          error?.message ?? 'Không thể cập nhật tồn nhỏ nhất / lớn nhất.',
      };
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
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Lỗi cập nhật tồn nhỏ nhất / lớn nhất',
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

  const extraFees = normalizeExtraFees(row.extra_fees);
  const extraFeeTotal =
    row.extra_fee_total !== undefined && row.extra_fee_total !== null
      ? Math.max(0, Math.round(Number(row.extra_fee_total) || 0))
      : sumExtraFees(extraFees);
  const totalAmount = Number(row.total_amount ?? 0);
  const isPaid =
    typeof row.is_paid === 'boolean' ? row.is_paid : true;
  const paidAmount =
    row.paid_amount !== undefined && row.paid_amount !== null
      ? Math.max(0, Math.round(Number(row.paid_amount) || 0))
      : isPaid
        ? totalAmount
        : 0;

  return {
    id: poId || undefined,
    poCode: String(row.po_code ?? ''),
    supplierId:
      typeof row.supplier_id === 'string' && row.supplier_id
        ? row.supplier_id
        : null,
    supplierName: String(row.supplier_name ?? ''),
    note: String(row.note ?? ''),
    extraFees,
    extraFeeTotal,
    paidAmount,
    isPaid,
    totalAmount,
    itemCount: Number(row.item_count ?? items.length),
    createdByEmail: String(row.created_by_email ?? ''),
    importedAt: importedIso ? formatDateTimeDisplay(importedIso) : '',
    importedAtIso: importedIso,
    items,
  };
}

function parseNullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapSupabaseSupplierRow(
  row: Record<string, unknown>,
): SupplierRecord {
  const createdIso =
    typeof row.created_at === 'string' ? row.created_at : undefined;
  const updatedIso =
    typeof row.updated_at === 'string' ? row.updated_at : undefined;

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    shortName: parseNullableText(row.short_name),
    taxCode: parseNullableText(row.tax_code),
    phone: String(row.phone ?? ''),
    address: String(row.address ?? ''),
    area: parseNullableText(row.area),
    paymentTerms: parseNullableText(row.payment_terms),
    bankAccount: parseNullableText(row.bank_account),
    bankName: parseNullableText(row.bank_name),
    email: parseNullableText(row.email),
    supplyCategory: parseNullableText(row.supply_category),
    notes: String(row.notes ?? ''),
    createdAt: createdIso ? formatDateTimeDisplay(createdIso) : undefined,
    updatedAt: updatedIso ? formatDateTimeDisplay(updatedIso) : undefined,
  };
}

export async function fetchAdminSuppliers(): Promise<{
  suppliers: SupplierRecord[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, suppliersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { suppliers: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(suppliersTable)
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      return {
        suppliers: [],
        errorMessage: /suppliers|schema cache|does not exist/i.test(error.message)
          ? 'Chưa có bảng suppliers trên Supabase. Vui lòng chạy script db_creat/upgrade_schema_04.sql trong Supabase SQL Editor.'
          : error.message,
      };
    }

    return {
      suppliers: (data ?? []).map((row) =>
        mapSupabaseSupplierRow(row as Record<string, unknown>),
      ),
    };
  } catch (err) {
    return {
      suppliers: [],
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tải danh sách nhà cung cấp',
    };
  }
}

export interface UpsertSupplierInput {
  id?: string;
  name: string;
  shortName?: string | null;
  taxCode?: string | null;
  phone: string;
  address: string;
  area?: string | null;
  paymentTerms?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  email?: string | null;
  supplyCategory?: string | null;
  notes: string;
}

export async function upsertAdminSupplier(
  input: UpsertSupplierInput,
): Promise<{ supplier: SupplierRecord | null; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, suppliersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { supplier: null, errorMessage: 'Chưa cấu hình Supabase.' };
  }

  const cleanName = input.name.trim();
  if (!cleanName) {
    return { supplier: null, errorMessage: 'Tên nhà cung cấp không được để trống.' };
  }

  const cleanNullable = (val?: string | null) => {
    const trimmed = (val ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const basePayload: Record<string, unknown> = {
    name: cleanName,
    phone: input.phone.replace(/[\s.-]/g, '').trim(),
    address: input.address.trim(),
    notes: input.notes.trim(),
  };

  const extendedV5Payload: Record<string, unknown> = {
    ...basePayload,
    short_name: cleanNullable(input.shortName),
    tax_code: cleanNullable(input.taxCode),
    bank_account: cleanNullable(input.bankAccount),
    bank_name: cleanNullable(input.bankName),
    email: cleanNullable(input.email),
    supply_category: cleanNullable(input.supplyCategory),
  };

  const extendedPayload: Record<string, unknown> = {
    ...extendedV5Payload,
    area: cleanNullable(input.area),
    payment_terms: cleanNullable(input.paymentTerms),
  };

  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
  const runSave = (payloadToSend: Record<string, unknown>) =>
    (input.id
      ? supabase.from(suppliersTable).update(payloadToSend).eq('id', input.id)
      : supabase.from(suppliersTable).insert(payloadToSend)
    )
      .select('*')
      .single();

  try {
    let { data, error } = await runSave(extendedPayload);

    if (error && /area|payment_terms/i.test(error.message)) {
      const hasV6Values =
        extendedPayload.area !== null || extendedPayload.payment_terms !== null;
      if (!hasV6Values) {
        const retryV5 = await runSave(extendedV5Payload);
        data = retryV5.data;
        error = retryV5.error;
      } else {
        return {
          supplier: null,
          errorMessage:
            'Bảng suppliers trên Supabase chưa có cột khu vực / điều khoản thanh toán (area, payment_terms). Vui lòng chạy script db_creat/upgrade_schema_06.sql trong Supabase SQL Editor.',
        };
      }
    }

    if (
      error &&
      /short_name|tax_code|bank_account|bank_name|email|supply_category/i.test(
        error.message,
      )
    ) {
      const hasExtendedValues =
        extendedPayload.short_name !== null ||
        extendedPayload.tax_code !== null ||
        extendedPayload.bank_account !== null ||
        extendedPayload.bank_name !== null ||
        extendedPayload.email !== null ||
        extendedPayload.supply_category !== null;
      if (!hasExtendedValues) {
        const retry = await runSave(basePayload);
        data = retry.data;
        error = retry.error;
      } else {
        return {
          supplier: null,
          errorMessage:
            'Bảng suppliers trên Supabase chưa có các cột mới (short_name, tax_code, bank_account, bank_name, email, supply_category). Vui lòng chạy script db_creat/upgrade_schema_05.sql trong Supabase SQL Editor.',
        };
      }
    }

    if (error) {
      return {
        supplier: null,
        errorMessage: /suppliers|schema cache|does not exist/i.test(error.message)
          ? 'Chưa có bảng suppliers trên Supabase. Vui lòng chạy script db_creat/upgrade_schema_04.sql trong Supabase SQL Editor.'
          : error.message,
      };
    }

    return {
      supplier: data
        ? mapSupabaseSupplierRow(data as Record<string, unknown>)
        : null,
    };
  } catch (err) {
    return {
      supplier: null,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi lưu thông tin nhà cung cấp',
    };
  }
}

export async function deleteAdminSupplier(
  supplierId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, suppliersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase
      .from(suppliersTable)
      .delete()
      .eq('id', supplierId);

    if (error) {
      return { ok: false, errorMessage: error.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi xóa nhà cung cấp',
    };
  }
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
  supplierId?: string | null;
  supplierName: string;
  note: string;
  updateCostPrice: boolean;
  items: PurchaseOrderItem[];
  extraFees?: ExtraFeeItem[];
  paidAmount?: number | null;
}

export async function createPurchaseOrderInSupabase(
  input: CreatePurchaseOrderInput,
): Promise<{ ok: boolean; poId?: string; errorMessage?: string }> {
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

    const basePayload = {
      p_po_code: input.poCode.trim(),
      p_supplier_name: input.supplierName.trim(),
      p_note: input.note.trim(),
      p_update_cost_price: input.updateCostPrice,
      p_items: itemPayloads,
    };

    const normalizedFees = normalizeExtraFees(input.extraFees);
    const hasPaidParam =
      input.paidAmount !== null &&
      input.paidAmount !== undefined &&
      Number.isFinite(Number(input.paidAmount));

    let rpcRes = await supabase.rpc('create_purchase_order', {
      ...basePayload,
      p_supplier_id: input.supplierId || null,
      p_extra_fees: normalizedFees,
      p_paid_amount: hasPaidParam ? Math.max(0, Number(input.paidAmount)) : null,
    });

    // Tương thích ngược với DB 6 tham số hoặc 5 tham số
    if (
      rpcRes.error &&
      /function|parameter|create_purchase_order|p_extra_fees|p_paid_amount/i.test(
        rpcRes.error.message,
      )
    ) {
      rpcRes = await supabase.rpc('create_purchase_order', {
        ...basePayload,
        p_supplier_id: input.supplierId || null,
      });
    }

    if (
      rpcRes.error &&
      /function|parameter|create_purchase_order|p_supplier_id/i.test(
        rpcRes.error.message,
      )
    ) {
      rpcRes = await supabase.rpc('create_purchase_order', basePayload);
    }

    if (rpcRes.error) {
      return { ok: false, errorMessage: rpcRes.error.message };
    }
    const resObj = (rpcRes.data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      poId: typeof resObj.id === 'string' ? resObj.id : undefined,
    };
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
            ? 'Cấu trúc bảng user_profiles chưa được cập nhật quyền manager hoặc cột phone/notes. Vui lòng chạy script db_creat/upgrade_schema_01.sql (hoặc db_creat/schema.sql nếu tạo mới) trong Supabase SQL Editor.'
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

export function mapSupabaseCashVoucherRow(
  row: Record<string, unknown>,
): CashVoucherRecord {
  const voucherDateIso =
    typeof row.voucher_date === 'string'
      ? row.voucher_date
      : typeof row.created_at === 'string'
        ? row.created_at
        : undefined;

  return {
    id: String(row.id ?? ''),
    voucherCode: String(row.voucher_code ?? ''),
    voucherType: row.voucher_type === 'payment' ? 'payment' : 'receipt',
    category: String(row.category ?? 'other_income') as CashVoucherCategory,
    amount: Math.max(0, Number(row.amount ?? 0)),
    paymentMethod: String(row.payment_method ?? 'cash') as CashVoucherPaymentMethod,
    customerId:
      typeof row.customer_id === 'string' && row.customer_id
        ? row.customer_id
        : null,
    supplierId:
      typeof row.supplier_id === 'string' && row.supplier_id
        ? row.supplier_id
        : null,
    orderId:
      typeof row.order_id === 'string' && row.order_id ? row.order_id : null,
    purchaseOrderId:
      typeof row.purchase_order_id === 'string' && row.purchase_order_id
        ? row.purchase_order_id
        : null,
    relatedCode: String(row.related_code ?? ''),
    counterpartyName: String(row.counterparty_name ?? ''),
    note: String(row.note ?? ''),
    voucherDate: voucherDateIso ? formatDateTimeDisplay(voucherDateIso) : '',
    voucherDateIso,
    createdByEmail: String(row.created_by_email ?? ''),
    createdAt:
      typeof row.created_at === 'string'
        ? formatDateTimeDisplay(row.created_at)
        : undefined,
  };
}

export async function fetchCashVouchers(): Promise<{
  vouchers: CashVoucherRecord[];
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, cashVouchersTable } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { vouchers: [], errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase
      .from(cashVouchersTable)
      .select('*')
      .order('voucher_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      return {
        vouchers: [],
        errorMessage: /cash_vouchers|schema cache|does not exist/i.test(error.message)
          ? 'Chưa có bảng phiếu thu chi cash_vouchers trên Supabase. Vui lòng chạy script db_creat/upgrade_schema_06.sql trong Supabase SQL Editor.'
          : error.message,
      };
    }

    return {
      vouchers: (data ?? []).map((row) =>
        mapSupabaseCashVoucherRow(row as Record<string, unknown>),
      ),
    };
  } catch (err) {
    return {
      vouchers: [],
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tải danh sách phiếu thu/chi',
    };
  }
}

export interface CreateCashVoucherInput {
  voucherCode: string;
  voucherType: CashVoucherType;
  category: CashVoucherCategory;
  amount: number;
  paymentMethod: CashVoucherPaymentMethod | string;
  customerId?: string | null;
  supplierId?: string | null;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  relatedCode?: string;
  counterpartyName?: string;
  note?: string;
  voucherDateIso?: string;
}

export async function createCashVoucherInSupabase(
  input: CreateCashVoucherInput,
): Promise<{ id?: string; voucherCode?: string; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.rpc('create_cash_voucher', {
      p_voucher_code: input.voucherCode.trim(),
      p_voucher_type: input.voucherType,
      p_category: input.category,
      p_amount: Math.max(0, Number(input.amount) || 0),
      p_payment_method: input.paymentMethod || 'cash',
      p_customer_id: input.customerId || null,
      p_supplier_id: input.supplierId || null,
      p_order_id: input.orderId || null,
      p_purchase_order_id: input.purchaseOrderId || null,
      p_related_code: (input.relatedCode ?? '').trim(),
      p_counterparty_name: (input.counterpartyName ?? '').trim(),
      p_note: (input.note ?? '').trim(),
      p_voucher_date: input.voucherDateIso || new Date().toISOString(),
    });

    if (error) {
      return {
        errorMessage: /create_cash_voucher|cash_vouchers|function|schema cache/i.test(
          error.message,
        )
          ? 'Chưa có hàm create_cash_voucher hoặc bảng cash_vouchers trên Supabase. Vui lòng chạy script db_creat/upgrade_schema_06.sql trong Supabase SQL Editor.'
          : error.message,
      };
    }

    const resObj = (data ?? {}) as Record<string, unknown>;
    return {
      id: typeof resObj.id === 'string' ? resObj.id : undefined,
      voucherCode:
        typeof resObj.voucher_code === 'string'
          ? resObj.voucher_code
          : input.voucherCode.trim(),
    };
  } catch (err) {
    return {
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi lập phiếu thu/chi trên Supabase',
    };
  }
}

export async function deleteCashVoucherInSupabase(
  voucherId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getAdminConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { ok: false, errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.rpc('delete_cash_voucher', {
      p_voucher_id: voucherId,
    });

    if (error) {
      return {
        ok: false,
        errorMessage: /delete_cash_voucher|cash_vouchers|function|schema cache/i.test(
          error.message,
        )
          ? 'Chưa có hàm delete_cash_voucher trên Supabase. Vui lòng chạy script db_creat/upgrade_schema_06.sql trong Supabase SQL Editor.'
          : error.message,
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi xóa phiếu thu/chi trên Supabase',
    };
  }
}


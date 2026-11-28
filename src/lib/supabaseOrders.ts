import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import type {
  CartItem,
  OrderLifecycleStatus,
  OrderRecord,
  UserRole,
} from '../types/shop';
import {
  clampOrderFromDateForRole,
  normalizeExtraFees,
  parseOrderTimestamp,
  sumExtraFees,
} from '../utils/adminLogic';
import { normalizeVietnameseText } from '../utils/shopLogic';

export const ORDERS_STORAGE_KEY = 'vpp_huong_long_orders_v1';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_LIFECYCLE_STATUSES: ReadonlySet<OrderLifecycleStatus> = new Set([
  'pending',
  'confirmed',
  'shipping',
  'completed',
  'cancelled',
]);

export function normalizeLifecycleStatus(
  value: unknown,
  isConfirmed?: boolean,
): OrderLifecycleStatus {
  if (
    typeof value === 'string' &&
    VALID_LIFECYCLE_STATUSES.has(value as OrderLifecycleStatus)
  ) {
    return value as OrderLifecycleStatus;
  }
  return isConfirmed ? 'confirmed' : 'pending';
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeOrderRecord(raw: Partial<OrderRecord>): OrderRecord {
  const isConfirmed = Boolean(raw.isConfirmed);
  const status = normalizeLifecycleStatus(raw.status, isConfirmed);
  const isDelivered =
    typeof raw.isDelivered === 'boolean'
      ? raw.isDelivered
      : status === 'completed';
  const extraFees = normalizeExtraFees(raw.extraFees);
  const extraFeeTotal =
    raw.extraFeeTotal !== undefined && raw.extraFeeTotal !== null
      ? Math.max(0, Math.round(Number(raw.extraFeeTotal) || 0))
      : sumExtraFees(extraFees);
  const total = Number(raw.total ?? 0);
  const isPaid = Boolean(raw.isPaid);
  const paidAmount =
    raw.paidAmount !== undefined && raw.paidAmount !== null
      ? Math.max(0, Math.round(Number(raw.paidAmount) || 0))
      : isPaid
        ? total
        : 0;
  return {
    id: raw.id,
    orderCode: raw.orderCode ?? '',
    customerId: raw.customerId ?? null,
    createdAt: raw.createdAt ?? '',
    createdAtIso: raw.createdAtIso,
    customerName: raw.customerName ?? '',
    phone: raw.phone ?? '',
    address: raw.address ?? '',
    note: raw.note ?? '',
    deliveryMethod: raw.deliveryMethod === 'pickup' ? 'pickup' : 'delivery',
    paymentMethod: raw.paymentMethod === 'cod' ? 'cod' : 'transfer',
    items: Array.isArray(raw.items) ? raw.items : [],
    subtotal: Number(raw.subtotal ?? 0),
    discountAmount: Number(raw.discountAmount ?? 0),
    shippingFee: Number(raw.shippingFee ?? 0),
    extraFees,
    extraFeeTotal,
    paidAmount,
    total,
    status,
    isConfirmed,
    isDelivered,
    isPaid,
    confirmedAt: raw.confirmedAt ?? null,
    deliveredAt: raw.deliveredAt ?? null,
    paidAt: raw.paidAt ?? null,
    syncedToSupabase: raw.syncedToSupabase,
  };
}

export function loadStoredOrders(
  storage: StorageLike | null = getDefaultStorage(),
): OrderRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => normalizeOrderRecord(row as Partial<OrderRecord>));
  } catch {
    return [];
  }
}

export function saveStoredOrders(
  orders: OrderRecord[],
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
  } catch {
    // Ignore storage quota errors
  }
}

export function mergeOrders(
  remoteOrders: OrderRecord[],
  localOrders: OrderRecord[],
): OrderRecord[] {
  const byCode = new Map<string, OrderRecord>();

  for (const remote of remoteOrders) {
    byCode.set(remote.orderCode, remote);
  }
  for (const local of localOrders) {
    if (!byCode.has(local.orderCode)) {
      byCode.set(local.orderCode, local);
    }
  }

  return Array.from(byCode.values()).sort((a, b) => {
    const timeA = parseOrderTimestamp(a) ?? 0;
    const timeB = parseOrderTimestamp(b) ?? 0;
    return timeB - timeA;
  });
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

export function mapSupabaseOrderRow(
  row: Record<string, unknown>,
  itemRows: Record<string, unknown>[] = [],
): OrderRecord {
  const orderId = String(row.id ?? '');
  const matchingItems: CartItem[] = (Array.isArray(itemRows) ? itemRows : [])
    .filter((item) => String(item.order_id ?? '') === orderId)
    .map((item) => ({
      productId: String(item.product_id ?? item.sku ?? item.id ?? ''),
      sku: String(item.sku ?? ''),
      name: String(item.product_name ?? 'Sản phẩm'),
      categoryLabel: '',
      unit: String(item.unit ?? 'Cái'),
      variant: String(item.variant ?? 'Tiêu chuẩn'),
      unitPrice: Number(item.unit_price ?? 0),
      quantity: Number(item.quantity ?? 1),
      image: typeof item.image_url === 'string' ? item.image_url : '',
    }));

  const createdAtIso =
    typeof row.created_at === 'string' ? row.created_at : undefined;
  const isConfirmed = Boolean(row.is_confirmed);
  const status = normalizeLifecycleStatus(row.status, isConfirmed);
  const isDelivered =
    typeof row.is_delivered === 'boolean'
      ? row.is_delivered
      : status === 'completed';

  const extraFees = normalizeExtraFees(row.extra_fees);
  const extraFeeTotal =
    row.extra_fee_total !== undefined && row.extra_fee_total !== null
      ? Math.max(0, Math.round(Number(row.extra_fee_total) || 0))
      : sumExtraFees(extraFees);
  const total = Number(row.total_amount ?? row.subtotal ?? 0);
  const isPaid = Boolean(row.is_paid);
  const paidAmount =
    row.paid_amount !== undefined && row.paid_amount !== null
      ? Math.max(0, Math.round(Number(row.paid_amount) || 0))
      : isPaid
        ? total
        : 0;

  return {
    id: orderId || undefined,
    orderCode: String(row.order_code ?? ''),
    customerId:
      typeof row.customer_id === 'string' && row.customer_id
        ? row.customer_id
        : null,
    createdAt: createdAtIso ? formatDateTimeDisplay(createdAtIso) : '',
    createdAtIso,
    customerName: String(row.customer_name ?? ''),
    phone: String(row.phone ?? ''),
    address: String(row.address ?? ''),
    note: String(row.note ?? ''),
    deliveryMethod: row.delivery_method === 'pickup' ? 'pickup' : 'delivery',
    paymentMethod: row.payment_method === 'cod' ? 'cod' : 'transfer',
    items: matchingItems,
    subtotal: Number(row.subtotal ?? row.total_amount ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    shippingFee: Number(row.shipping_fee ?? 0),
    extraFees,
    extraFeeTotal,
    paidAmount,
    total,
    status,
    isConfirmed,
    isDelivered,
    isPaid,
    confirmedAt:
      typeof row.confirmed_at === 'string' ? row.confirmed_at : null,
    deliveredAt:
      typeof row.delivered_at === 'string' ? row.delivered_at : null,
    paidAt: typeof row.paid_at === 'string' ? row.paid_at : null,
    syncedToSupabase: true,
  };
}

export type ConfirmFilter = 'all' | 'confirmed' | 'unconfirmed';
export type DeliveryFilter = 'all' | 'delivered' | 'undelivered';
export type PayFilter = 'all' | 'paid' | 'unpaid';
export type LifecycleFilter = 'all' | OrderLifecycleStatus;

export interface FilterOrdersOptions {
  query: string;
  confirmFilter: ConfirmFilter;
  deliveryFilter?: DeliveryFilter;
  payFilter: PayFilter;
  statusFilter?: LifecycleFilter;
  dateFrom?: string;
  dateTo?: string;
  userRole?: UserRole;
  referenceDate?: Date;
}

export function filterOrders(
  orders: OrderRecord[],
  options: FilterOrdersOptions,
): OrderRecord[] {
  const normQuery = normalizeVietnameseText(options.query);
  const effectiveFrom =
    options.userRole === 'staff' || options.dateFrom
      ? clampOrderFromDateForRole(
          options.dateFrom ?? '',
          options.userRole,
          options.referenceDate,
        )
      : '';
  const parsedFromMs = effectiveFrom ? new Date(effectiveFrom).getTime() : NaN;
  const hasValidFrom = Number.isFinite(parsedFromMs);

  const parsedToBaseMs = options.dateTo ? new Date(options.dateTo).getTime() : NaN;
  const hasValidTo = Number.isFinite(parsedToBaseMs);
  const parsedToMs = hasValidTo ? parsedToBaseMs + 59_999 : NaN;

  return orders
    .filter((order) => {
      if (hasValidFrom || hasValidTo) {
        const ts = parseOrderTimestamp(order);
        if (ts === null) return false;
        if (hasValidFrom && ts < parsedFromMs) return false;
        if (hasValidTo && ts > parsedToMs) return false;
      }

      if (options.confirmFilter === 'confirmed' && !order.isConfirmed) {
        return false;
      }
      if (options.confirmFilter === 'unconfirmed' && order.isConfirmed) {
        return false;
      }
      if (options.deliveryFilter === 'delivered' && !order.isDelivered) {
        return false;
      }
      if (options.deliveryFilter === 'undelivered' && order.isDelivered) {
        return false;
      }
      if (options.payFilter === 'paid' && !order.isPaid) {
        return false;
      }
      if (options.payFilter === 'unpaid' && order.isPaid) {
        return false;
      }
      if (options.statusFilter && options.statusFilter !== 'all') {
        const resolvedStatus = normalizeLifecycleStatus(
          order.status,
          order.isConfirmed,
        );
        if (resolvedStatus !== options.statusFilter) {
          return false;
        }
      }
      if (!normQuery) {
        return true;
      }
      const itemsText = order.items
        .map((item) => `${item.name} ${item.sku} ${item.variant}`)
        .join(' ');
      const haystack = normalizeVietnameseText(
        `${order.orderCode} ${order.customerName} ${order.phone} ${order.address} ${order.note} ${itemsText}`,
      );
      return haystack.includes(normQuery);
    })
    .sort((a, b) => {
      const timeA = parseOrderTimestamp(a) ?? 0;
      const timeB = parseOrderTimestamp(b) ?? 0;
      return timeB - timeA;
    });
}

function getSupabaseOrderConfig() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const ordersTable =
    import.meta.env.VITE_SUPABASE_ORDERS_TABLE?.trim() || 'orders';
  const orderItemsTable =
    import.meta.env.VITE_SUPABASE_ORDER_ITEMS_TABLE?.trim() || 'order_items';

  return { supabaseUrl, supabaseAnonKey, ordersTable, orderItemsTable };
}

export function hasSupabaseOrderConfig(): boolean {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseOrderConfig();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export async function getAdminSession(): Promise<{
  email: string | null;
  configured: boolean;
}> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseOrderConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { email: null, configured: false };
  }
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data } = await supabase.auth.getSession();
    return {
      email: data.session?.user?.email ?? null,
      configured: true,
    };
  } catch {
    return { email: null, configured: true };
  }
}

export function onAdminAuthChange(
  callback: (email: string | null) => void,
): () => void {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseOrderConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return () => {};
  }
  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(
    (_event: AuthChangeEvent, session: Session | null) => {
      callback(session?.user?.email ?? null);
    },
  );
  return () => subscription.unsubscribe();
}

export async function signInAdmin(
  email: string,
  password: string,
): Promise<{ email: string | null; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseOrderConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      email: null,
      errorMessage: 'Chưa cấu hình kết nối Supabase (.env).',
    };
  }
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      return {
        email: null,
        errorMessage:
          error?.message === 'Invalid login credentials'
            ? 'Email hoặc mật khẩu quản trị chưa đúng.'
            : error?.message ?? 'Không thể đăng nhập.',
      };
    }
    return { email: data.user.email ?? email.trim() };
  } catch (err) {
    return {
      email: null,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi kết nối khi đăng nhập',
    };
  }
}

export async function signOutAdmin(): Promise<void> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseOrderConfig();
  if (!supabaseUrl || !supabaseAnonKey) return;
  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    await supabase.auth.signOut();
  } catch {
    // Ignore signout errors
  }
}

export async function createOrderInSupabase(order: OrderRecord): Promise<{
  order: OrderRecord;
  synced: boolean;
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, ordersTable } =
    getSupabaseOrderConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { order, synced: false };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const itemPayloads = order.items.map((item) => ({
      product_id: isValidUuid(item.productId) ? item.productId : null,
      sku: item.sku,
      product_name: item.name,
      variant: item.variant,
      unit: item.unit,
      unit_price: item.unitPrice,
      quantity: item.quantity,
      line_total: item.unitPrice * item.quantity,
      image_url: item.image || null,
    }));

    const baseRpcParams = {
      p_order_code: order.orderCode,
      p_customer_name: order.customerName,
      p_phone: order.phone,
      p_delivery_method: order.deliveryMethod,
      p_address: order.address,
      p_note: order.note,
      p_payment_method: order.paymentMethod,
      p_items: itemPayloads,
    };

    const normalizedExtraFees = normalizeExtraFees(order.extraFees);

    // Gọi RPC SECURITY DEFINER để tạo cả orders + order_items + khách hàng
    let rpcRes = await supabase.rpc('create_public_order', {
      ...baseRpcParams,
      p_discount_amount: Math.max(0, Number(order.discountAmount ?? 0)),
      p_mark_confirmed: Boolean(order.isConfirmed),
      p_mark_paid: Boolean(order.isPaid),
      p_status: order.status ?? 'pending',
      p_mark_delivered: Boolean(order.isDelivered),
      p_extra_fees: normalizedExtraFees,
    });

    // Tương thích ngược với DB 13, 12 hoặc 8 tham số
    if (
      rpcRes.error &&
      /function|parameter|create_public_order|p_extra_fees/i.test(rpcRes.error.message)
    ) {
      rpcRes = await supabase.rpc('create_public_order', {
        ...baseRpcParams,
        p_discount_amount: Math.max(0, Number(order.discountAmount ?? 0)),
        p_mark_confirmed: Boolean(order.isConfirmed),
        p_mark_paid: Boolean(order.isPaid),
        p_status: order.status ?? 'pending',
        p_mark_delivered: Boolean(order.isDelivered),
      });
    }

    if (
      rpcRes.error &&
      /function|parameter|create_public_order/i.test(rpcRes.error.message)
    ) {
      rpcRes = await supabase.rpc('create_public_order', {
        ...baseRpcParams,
        p_discount_amount: Math.max(0, Number(order.discountAmount ?? 0)),
        p_mark_confirmed: Boolean(order.isConfirmed),
        p_mark_paid: Boolean(order.isPaid),
        p_status: order.status ?? 'pending',
      });
    }

    if (
      rpcRes.error &&
      /function|parameter|create_public_order/i.test(rpcRes.error.message)
    ) {
      rpcRes = await supabase.rpc('create_public_order', baseRpcParams);
      if (!rpcRes.error && rpcRes.data && (order.isConfirmed || order.isPaid || order.isDelivered)) {
        const rpcData = rpcRes.data as Record<string, unknown>;
        const orderUuid = String(rpcData.id ?? '');
        await updateOrderStatusInSupabase(
          { ...order, id: orderUuid || order.id },
          {
            isConfirmed: order.isConfirmed,
            isDelivered: order.isDelivered,
            isPaid: order.isPaid,
            status: order.status,
          },
        );
      }
    }

    if (!rpcRes.error && rpcRes.data) {
      const rpcData = rpcRes.data as Record<string, unknown>;
      const orderUuid = String(rpcData.id ?? '');
      return {
        order: {
          ...order,
          id: orderUuid || order.id,
          status: order.status ?? 'pending',
          syncedToSupabase: true,
        },
        synced: true,
      };
    }

    // Fallback: nếu DB chưa chạy hàm RPC mới thì thử insert trực tiếp bảng orders
    const { error: insertErr } = await supabase.from(ordersTable).insert({
      order_code: order.orderCode,
      customer_name: order.customerName,
      phone: order.phone,
      delivery_method: order.deliveryMethod,
      address: order.address,
      note: order.note,
      payment_method: order.paymentMethod,
      subtotal: order.subtotal,
      discount_amount: Math.max(0, Number(order.discountAmount ?? 0)),
      shipping_fee: order.shippingFee,
      total_amount: order.total,
      status: order.status ?? 'pending',
      is_confirmed: Boolean(order.isConfirmed),
      is_delivered: Boolean(order.isDelivered),
      is_paid: Boolean(order.isPaid),
      confirmed_at: order.confirmedAt ?? null,
      delivered_at: order.deliveredAt ?? null,
      paid_at: order.paidAt ?? null,
    });

    if (insertErr) {
      return {
        order,
        synced: false,
        errorMessage: rpcRes.error?.message ?? insertErr.message,
      };
    }

    return {
      order: {
        ...order,
        status: order.status ?? 'pending',
        syncedToSupabase: true,
      },
      synced: true,
    };
  } catch (err) {
    return {
      order,
      synced: false,
      errorMessage: err instanceof Error ? err.message : 'Lỗi kết nối Supabase',
    };
  }
}

export async function fetchOrdersFromSupabase(): Promise<{
  orders: OrderRecord[];
  source: 'supabase' | 'local';
  errorMessage?: string;
}> {
  const localOrders = loadStoredOrders();
  const { supabaseUrl, supabaseAnonKey, ordersTable, orderItemsTable } =
    getSupabaseOrderConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { orders: localOrders, source: 'local' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return {
        orders: localOrders,
        source: 'local',
        errorMessage: 'Cần đăng nhập tài khoản quản trị để đồng bộ đơn hàng từ Supabase.',
      };
    }

    const [ordersRes, itemsRes] = await Promise.all([
      supabase
        .from(ordersTable)
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from(orderItemsTable).select('*'),
    ]);

    if (ordersRes.error) {
      return {
        orders: localOrders,
        source: 'local',
        errorMessage: `Chưa đọc được bảng ${ordersTable} trên Supabase (${ordersRes.error.message}). Đang hiển thị đơn hàng lưu trên thiết bị.`,
      };
    }

    const mappedRemote = (ordersRes.data ?? []).map((row) =>
      mapSupabaseOrderRow(
        row as Record<string, unknown>,
        (itemsRes.data ?? []) as Record<string, unknown>[],
      ),
    );

    const merged = mergeOrders(mappedRemote, localOrders);
    saveStoredOrders(merged);
    return { orders: merged, source: 'supabase' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi kết nối Supabase';
    return {
      orders: localOrders,
      source: 'local',
      errorMessage: `Không thể đồng bộ đơn hàng từ Supabase (${msg}). Đang hiển thị dữ liệu trên thiết bị.`,
    };
  }
}

export async function updateOrderStatusInSupabase(
  order: OrderRecord,
  patch: {
    isConfirmed?: boolean;
    isDelivered?: boolean;
    isPaid?: boolean;
    status?: OrderLifecycleStatus;
  },
): Promise<{ synced: boolean; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, ordersTable } =
    getSupabaseOrderConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { synced: false };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return {
        synced: false,
        errorMessage: 'Phiên đăng nhập quản trị đã hết hạn.',
      };
    }

    const updateBody: Record<string, unknown> = {};
    const nowIso = new Date().toISOString();

    if (typeof patch.isConfirmed === 'boolean') {
      updateBody.is_confirmed = patch.isConfirmed;
      updateBody.confirmed_at = patch.isConfirmed ? nowIso : null;
    }
    if (typeof patch.isDelivered === 'boolean') {
      updateBody.is_delivered = patch.isDelivered;
      updateBody.delivered_at = patch.isDelivered ? nowIso : null;
    }
    if (typeof patch.isPaid === 'boolean') {
      updateBody.is_paid = patch.isPaid;
      updateBody.paid_at = patch.isPaid ? nowIso : null;
      updateBody.paid_amount = patch.isPaid ? Math.max(0, Number(order.total) || 0) : 0;
    }
    if (patch.status) {
      updateBody.status = patch.status;
    }

    const runUpdate = async (body: Record<string, unknown>) => {
      const query = supabase.from(ordersTable).update(body);
      return order.id
        ? await query.eq('id', order.id)
        : await query.eq('order_code', order.orderCode);
    };

    let { error } = await runUpdate(updateBody);

    if (
      error &&
      /is_delivered|delivered_at|paid_amount/i.test(error.message)
    ) {
      const fallbackBody = { ...updateBody };
      if (/is_delivered|delivered_at/i.test(error.message)) {
        delete fallbackBody.is_delivered;
        delete fallbackBody.delivered_at;
      }
      if (/paid_amount/i.test(error.message)) {
        delete fallbackBody.paid_amount;
      }
      const retry = await runUpdate(fallbackBody);
      error = retry.error;
    }

    if (error) {
      return { synced: false, errorMessage: error.message };
    }
    return { synced: true };
  } catch (err) {
    return {
      synced: false,
      errorMessage: err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái',
    };
  }
}

export async function updateOrderInSupabase(order: OrderRecord): Promise<{
  order: OrderRecord;
  synced: boolean;
  errorMessage?: string;
}> {
  const { supabaseUrl, supabaseAnonKey, ordersTable } =
    getSupabaseOrderConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    return { order, synced: false };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      return {
        order,
        synced: false,
        errorMessage: 'Phiên đăng nhập quản trị đã hết hạn.',
      };
    }

    const itemPayloads = order.items.map((item) => ({
      product_id: isValidUuid(item.productId) ? item.productId : null,
      sku: item.sku,
      product_name: item.name,
      variant: item.variant,
      unit: item.unit,
      unit_price: item.unitPrice,
      quantity: item.quantity,
      line_total: item.unitPrice * item.quantity,
      image_url: item.image || null,
    }));

    const normalizedExtraFees = normalizeExtraFees(order.extraFees);
    const baseUpdateParams = {
      p_order_id: isValidUuid(order.id) ? order.id : null,
      p_order_code: order.orderCode,
      p_customer_name: order.customerName,
      p_phone: order.phone,
      p_delivery_method: order.deliveryMethod,
      p_address: order.address,
      p_note: order.note,
      p_payment_method: order.paymentMethod,
      p_items: itemPayloads,
      p_discount_amount: Math.max(0, Number(order.discountAmount ?? 0)),
      p_mark_confirmed: Boolean(order.isConfirmed),
      p_mark_delivered: Boolean(order.isDelivered),
      p_mark_paid: Boolean(order.isPaid),
      p_status: order.status ?? 'pending',
    };

    let { data, error } = await supabase.rpc('update_public_order', {
      ...baseUpdateParams,
      p_extra_fees: normalizedExtraFees,
    });

    if (
      error &&
      /function|parameter|update_public_order|p_extra_fees/i.test(error.message)
    ) {
      const retry = await supabase.rpc('update_public_order', baseUpdateParams);
      data = retry.data;
      error = retry.error;
    }

    if (!error && data) {
      const rpcData = data as Record<string, unknown>;
      const orderUuid = String(rpcData.id ?? order.id ?? '');
      return {
        order: {
          ...order,
          id: orderUuid || order.id,
          syncedToSupabase: true,
        },
        synced: true,
      };
    }

    // Fallback if DB hasn't run upgrade_schema_03.sql yet: update header fields on orders
    if (error && /function|update_public_order/i.test(error.message)) {
      const query = supabase.from(ordersTable).update({
        customer_name: order.customerName,
        phone: order.phone,
        delivery_method: order.deliveryMethod,
        address: order.address,
        note: order.note,
        payment_method: order.paymentMethod,
        subtotal: order.subtotal,
        discount_amount: Math.max(0, Number(order.discountAmount ?? 0)),
        total_amount: order.total,
        status: order.status ?? 'pending',
        is_confirmed: Boolean(order.isConfirmed),
        is_paid: Boolean(order.isPaid),
      });
      const fallbackRes = order.id
        ? await query.eq('id', order.id)
        : await query.eq('order_code', order.orderCode);

      if (!fallbackRes.error) {
        return {
          order: { ...order, syncedToSupabase: true },
          synced: true,
          errorMessage:
            'Đã cập nhật thông tin chung, nhưng cần chạy db_creat/upgrade_schema_03.sql để đồng bộ sửa chi tiết mặt hàng trên Supabase.',
        };
      }
    }

    return {
      order,
      synced: false,
      errorMessage: error?.message ?? 'Không thể cập nhật đơn hàng',
    };
  } catch (err) {
    return {
      order,
      synced: false,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi cập nhật đơn hàng trên Supabase',
    };
  }
}

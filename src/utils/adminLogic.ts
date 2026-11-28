import type {
  AdminTab,
  CashVoucherCategory,
  CashVoucherRecord,
  CashVoucherType,
  CashbookSummary,
  CategoryNode,
  CustomerDebtSummary,
  CustomerRecord,
  ExtraFeeItem,
  OrderRecord,
  Product,
  ProductStockFilter,
  PurchaseOrderItem,
  PurchaseOrderRecord,
  PurchasePackOption,
  RevenueChartBucket,
  RevenueChartSummary,
  RevenueGranularity,
  RevenuePeriodMode,
  SupplierDebtSummary,
  SupplierRecord,
  UserRole,
} from '../types/shop';
import { normalizeVietnameseText } from './shopLogic';

export function canAccessAdminTab(
  role: UserRole | null | undefined,
  tab: AdminTab,
): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  if (role === 'manager') return tab !== 'users';
  return tab === 'orders' || tab === 'customers' || tab === 'cashbook';
}

export function getAllowedAdminTabs(
  role: UserRole | null | undefined,
): AdminTab[] {
  if (role === 'admin') {
    return ['orders', 'customers', 'products', 'purchases', 'cashbook', 'users'];
  }
  if (role === 'manager') {
    return ['orders', 'customers', 'products', 'purchases', 'cashbook'];
  }
  if (role === 'staff') return ['orders', 'customers', 'cashbook'];
  return [];
}

export function canManageUsers(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

export function canManageInventory(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

export function resolveAllowedAdminTab(
  role: UserRole | null | undefined,
  requestedTab: AdminTab,
): AdminTab {
  if (canAccessAdminTab(role, requestedTab)) {
    return requestedTab;
  }
  return 'orders';
}

export function parseAdminRouteFromHash(hash: string): {
  page: 'shop' | 'admin';
  tab: AdminTab;
} {
  const normalized = hash.trim().toLowerCase();
  if (normalized.startsWith('#/admin/customers')) {
    return { page: 'admin', tab: 'customers' };
  }
  if (normalized.startsWith('#/admin/products')) {
    return { page: 'admin', tab: 'products' };
  }
  if (normalized.startsWith('#/admin/purchases')) {
    return { page: 'admin', tab: 'purchases' };
  }
  if (normalized.startsWith('#/admin/cashbook')) {
    return { page: 'admin', tab: 'cashbook' };
  }
  if (normalized.startsWith('#/admin/users')) {
    return { page: 'admin', tab: 'users' };
  }
  if (
    normalized.startsWith('#/admin') ||
    normalized.startsWith('#/orders')
  ) {
    return { page: 'admin', tab: 'orders' };
  }
  return { page: 'shop', tab: 'orders' };
}

export function slugifyVietnamese(input: string): string {
  return normalizeVietnameseText(input)
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseVariantsInput(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[,;|\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export function formatVariantsInput(variants?: string[]): string {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  const cleaned = variants.map((v) => v.trim()).filter(Boolean);
  if (
    cleaned.length === 0 ||
    (cleaned.length === 1 && cleaned[0] === 'Tiêu chuẩn')
  ) {
    return '';
  }
  return cleaned.join(', ');
}

export function formatSupplierShortCode(
  shortName?: string | null,
  fallbackName?: string | null,
): string {
  const raw = (shortName ?? '').trim() || (fallbackName ?? '').trim();
  if (!raw) return 'NCC';
  const ascii = normalizeVietnameseText(raw)
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase();
  return ascii || 'NCC';
}

export function generatePurchaseCode(
  now: Date = new Date(),
  supplierShortName?: string | null,
  existingPoCodes: string[] = [],
): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const shortCode = formatSupplierShortCode(supplierShortName);
  const baseCode = `NH-${mm}${dd}-${shortCode}`;
  if (existingPoCodes.length === 0) return baseCode;

  const existingSet = new Set(
    existingPoCodes.map((c) => c.trim().toUpperCase()).filter(Boolean),
  );
  if (!existingSet.has(baseCode.toUpperCase())) return baseCode;

  let suffix = 2;
  while (existingSet.has(`${baseCode}-${suffix}`.toUpperCase())) {
    suffix += 1;
  }
  return `${baseCode}-${suffix}`;
}

export function syncDiscountFromPercent(
  unitCostInput: number,
  discountPercentInput: number,
): {
  discountPercent: number;
  discountAmount: number;
  netUnitCost: number;
} {
  const unitCost = Math.max(0, Number(unitCostInput) || 0);
  const pct = Math.min(100, Math.max(0, Number(discountPercentInput) || 0));
  const discountAmount = Math.round((unitCost * pct) / 100);
  const netUnitCost = Math.max(0, unitCost - discountAmount);
  return {
    discountPercent: Number(pct.toFixed(2)),
    discountAmount,
    netUnitCost,
  };
}

export function syncDiscountFromAmount(
  unitCostInput: number,
  discountAmountInput: number,
): {
  discountPercent: number;
  discountAmount: number;
  netUnitCost: number;
} {
  const unitCost = Math.max(0, Number(unitCostInput) || 0);
  const rawAmt = Math.max(0, Number(discountAmountInput) || 0);
  const discountAmount = unitCost > 0 ? Math.min(unitCost, rawAmt) : 0;
  const discountPercent =
    unitCost > 0 ? Number(((discountAmount / unitCost) * 100).toFixed(2)) : 0;
  const netUnitCost = Math.max(0, unitCost - discountAmount);
  return {
    discountPercent,
    discountAmount,
    netUnitCost,
  };
}

export function computePurchaseLineTotal(
  quantityInput: number,
  unitCostInput: number,
  discountAmountInput: number,
): {
  netUnitCost: number;
  lineTotal: number;
} {
  const qty = Math.max(0, Number(quantityInput) || 0);
  const unitCost = Math.max(0, Number(unitCostInput) || 0);
  const discountAmt = Math.min(unitCost, Math.max(0, Number(discountAmountInput) || 0));
  const netUnitCost = Math.max(0, unitCost - discountAmt);
  return {
    netUnitCost,
    lineTotal: Math.round(qty * netUnitCost),
  };
}

export const EXTRA_FEE_PRESETS: string[] = [
  'Giao hàng',
  'Gửi xe',
  'Chờ đợi',
  'Đóng gói',
];

export function normalizeExtraFees(raw: unknown): ExtraFeeItem[] {
  if (!Array.isArray(raw)) return [];
  const result: ExtraFeeItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const label = typeof rec.label === 'string' ? rec.label.trim() : '';
    const amount = Math.max(0, Math.round(Number(rec.amount) || 0));
    if (!label && amount <= 0) continue;
    result.push({
      label: label || 'Phụ phí khác',
      amount,
    });
  }
  return result;
}

export function sumExtraFees(fees: ExtraFeeItem[] | undefined | null): number {
  if (!Array.isArray(fees) || fees.length === 0) return 0;
  return fees.reduce(
    (sum, fee) => sum + Math.max(0, Math.round(Number(fee.amount) || 0)),
    0,
  );
}

export function calculatePurchaseSummary(
  items: PurchaseOrderItem[],
  extraFees: ExtraFeeItem[] = [],
): {
  itemCount: number;
  totalQuantity: number;
  totalGrossAmount: number;
  totalDiscountAmount: number;
  itemsTotal: number;
  extraFeeTotal: number;
  totalAmount: number;
} {
  const base = items.reduce(
    (acc, item) => {
      const qty = Math.max(0, Number(item.quantity) || 0);
      const unitCost = Math.max(0, Number(item.unitCost) || 0);
      const discountAmt = Math.min(
        unitCost,
        Math.max(0, Number(item.discountAmount) || 0),
      );
      const netUnitCost = Math.max(0, unitCost - discountAmt);
      return {
        itemCount: acc.itemCount + 1,
        totalQuantity: acc.totalQuantity + qty,
        totalGrossAmount: acc.totalGrossAmount + Math.round(qty * unitCost),
        totalDiscountAmount:
          acc.totalDiscountAmount + Math.round(qty * discountAmt),
        itemsTotal: acc.itemsTotal + Math.round(qty * netUnitCost),
      };
    },
    {
      itemCount: 0,
      totalQuantity: 0,
      totalGrossAmount: 0,
      totalDiscountAmount: 0,
      itemsTotal: 0,
    },
  );
  const extraFeeTotal = sumExtraFees(extraFees);
  return {
    ...base,
    extraFeeTotal,
    totalAmount: base.itemsTotal + extraFeeTotal,
  };
}

export function parseImageUrlsInput(rawInput: string): string[] {
  return rawInput
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatDateTimeLocalInput(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function getTodayFullDayPreset(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    0,
    0,
  );
  return {
    start: formatDateTimeLocalInput(start),
    end: formatDateTimeLocalInput(end),
  };
}

export function matchesProductStockFilter(
  product: Pick<Product, 'stock' | 'minStock'>,
  filter: ProductStockFilter,
): boolean {
  if (filter === 'below-min') {
    return (
      product.minStock !== null &&
      product.minStock !== undefined &&
      product.stock < product.minStock
    );
  }
  if (filter === 'out-of-stock') {
    return product.stock <= 0;
  }
  return true;
}

export function getOrderDefaultDateRangePreset(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const fromDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 3,
    0,
    0,
    0,
    0,
  );
  const toDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    0,
    0,
  );
  return {
    from: formatDateTimeLocalInput(fromDate),
    to: formatDateTimeLocalInput(toDate),
  };
}

export function getStaffMinOrderDateTime(now: Date = new Date()): string {
  const minDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 7,
    0,
    0,
    0,
    0,
  );
  return formatDateTimeLocalInput(minDate);
}

export function clampOrderFromDateForRole(
  fromValue: string,
  role?: UserRole | null,
  now: Date = new Date(),
): string {
  if (role !== 'staff') {
    return fromValue;
  }
  const minStr = getStaffMinOrderDateTime(now);
  const minMs = new Date(minStr).getTime();
  if (!fromValue.trim()) {
    return minStr;
  }
  const parsedMs = new Date(fromValue).getTime();
  if (Number.isNaN(parsedMs) || parsedMs < minMs) {
    return minStr;
  }
  return fromValue;
}

export function getYesterdayEveningPreset(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    17,
    0,
    0,
    0,
  );
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    22,
    0,
    0,
    0,
  );
  return {
    start: formatDateTimeLocalInput(start),
    end: formatDateTimeLocalInput(end),
  };
}

export function parseOrderTimestamp(
  order: Pick<OrderRecord, 'createdAtIso' | 'createdAt'>,
): number | null {
  if (order.createdAtIso) {
    const parsedIso = Date.parse(order.createdAtIso);
    if (!Number.isNaN(parsedIso)) {
      return parsedIso;
    }
  }

  const raw = (order.createdAt || '').trim();
  if (!raw) return null;

  // Match "DD/MM/YYYY, HH:mm" or "HH:mm DD/MM/YYYY"
  const vnDateFirst = raw.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?/,
  );
  if (vnDateFirst) {
    const day = Number(vnDateFirst[1]);
    const month = Number(vnDateFirst[2]) - 1;
    const year = Number(vnDateFirst[3]);
    const hour = vnDateFirst[4] ? Number(vnDateFirst[4]) : 0;
    const minute = vnDateFirst[5] ? Number(vnDateFirst[5]) : 0;
    const timeMatchBefore = raw.match(/^(\d{1,2}):(\d{2})\s+\d{1,2}\//);
    const resolvedHour = timeMatchBefore ? Number(timeMatchBefore[1]) : hour;
    const resolvedMinute = timeMatchBefore ? Number(timeMatchBefore[2]) : minute;
    const date = new Date(year, month, day, resolvedHour, resolvedMinute, 0, 0);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  const fallback = Date.parse(raw);
  return Number.isNaN(fallback) ? null : fallback;
}

function formatShortDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function formatFullDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hourKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}`;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export interface BuildRevenueChartOptions {
  mode: RevenuePeriodMode;
  referenceDate?: Date;
  customStart?: string;
  customEnd?: string;
  paidOnly?: boolean;
  categoryIds?: string[];
  productIds?: string[];
  products?: Product[];
  categories?: CategoryNode[];
}

function collectExpandedCategoryKeys(
  selectedCategoryIds: string[],
  categories: CategoryNode[],
): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  if (selectedCategoryIds.length === 0) {
    return { ids, names };
  }

  const childrenByParent = new Map<string, CategoryNode[]>();
  const catById = new Map<string, CategoryNode>();

  for (const cat of categories) {
    catById.set(cat.id, cat);
    if (cat.parentId) {
      const siblings = childrenByParent.get(cat.parentId) ?? [];
      siblings.push(cat);
      childrenByParent.set(cat.parentId, siblings);
    }
  }

  const visit = (catId: string) => {
    if (ids.has(catId)) return;
    ids.add(catId);
    const node = catById.get(catId);
    if (node) {
      if (node.name) names.add(normalizeVietnameseText(node.name));
      if (node.slug) names.add(normalizeVietnameseText(node.slug));
    } else {
      names.add(normalizeVietnameseText(catId));
    }
    const children = childrenByParent.get(catId) ?? [];
    for (const child of children) {
      visit(child.id);
    }
  };

  for (const selectedId of selectedCategoryIds) {
    const trimmed = selectedId.trim();
    if (!trimmed) continue;
    visit(trimmed);
  }

  return { ids, names };
}

export function buildRevenueChartData(
  orders: OrderRecord[],
  options: BuildRevenueChartOptions,
): RevenueChartSummary {
  const ref = options.referenceDate ? new Date(options.referenceDate) : new Date();
  const mode = options.mode;

  let startMs = 0;
  let endMs = 0;
  let granularity: RevenueGranularity = 'hour';
  let rangeLabel = '';
  const buckets: RevenueChartBucket[] = [];

  if (mode === 'day') {
    const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
    const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
    startMs = start.getTime();
    endMs = end.getTime();
    granularity = 'hour';
    rangeLabel = `Hôm nay (${formatFullDate(start)})`;
    for (let h = 0; h < 24; h++) {
      const slot = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), h, 0, 0, 0);
      buckets.push({
        key: hourKey(slot),
        label: `${pad2(h)}h`,
        fullLabel: `${pad2(h)}:00 – ${pad2(h)}:59 (${formatShortDate(slot)})`,
        revenue: 0,
        orderCount: 0,
      });
    }
  } else if (mode === 'week') {
    const dayOfWeek = ref.getDay(); // 0 = Sunday
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(
      ref.getFullYear(),
      ref.getMonth(),
      ref.getDate() + diffToMonday,
      0,
      0,
      0,
      0,
    );
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6,
      23,
      59,
      59,
      999,
    );
    startMs = monday.getTime();
    endMs = sunday.getTime();
    granularity = 'day';
    rangeLabel = `Tuần ${formatShortDate(monday)} – ${formatFullDate(sunday)}`;
    const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + i,
        0,
        0,
        0,
        0,
      );
      buckets.push({
        key: dayKey(d),
        label: dayNames[i],
        fullLabel: `${dayNames[i]} (${formatFullDate(d)})`,
        revenue: 0,
        orderCount: 0,
      });
    }
  } else if (mode === 'month') {
    const firstDay = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
    const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    startMs = firstDay.getTime();
    endMs = lastDay.getTime();
    granularity = 'day';
    rangeLabel = `Tháng ${pad2(ref.getMonth() + 1)}/${ref.getFullYear()}`;
    const totalDays = lastDay.getDate();
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(ref.getFullYear(), ref.getMonth(), day, 0, 0, 0, 0);
      buckets.push({
        key: dayKey(d),
        label: pad2(day),
        fullLabel: `Ngày ${formatFullDate(d)}`,
        revenue: 0,
        orderCount: 0,
      });
    }
  } else if (mode === 'quarter') {
    const quarterIndex = Math.floor(ref.getMonth() / 3);
    const firstMonth = quarterIndex * 3;
    const firstDay = new Date(ref.getFullYear(), firstMonth, 1, 0, 0, 0, 0);
    const lastDay = new Date(ref.getFullYear(), firstMonth + 3, 0, 23, 59, 59, 999);
    startMs = firstDay.getTime();
    endMs = lastDay.getTime();
    granularity = 'month';
    rangeLabel = `Quý ${quarterIndex + 1}/${ref.getFullYear()}`;
    for (let i = 0; i < 3; i++) {
      const mDate = new Date(ref.getFullYear(), firstMonth + i, 1, 0, 0, 0, 0);
      buckets.push({
        key: monthKey(mDate),
        label: `Tháng ${firstMonth + i + 1}`,
        fullLabel: `Tháng ${pad2(firstMonth + i + 1)}/${ref.getFullYear()}`,
        revenue: 0,
        orderCount: 0,
      });
    }
  } else if (mode === 'year') {
    const firstDay = new Date(ref.getFullYear(), 0, 1, 0, 0, 0, 0);
    const lastDay = new Date(ref.getFullYear(), 11, 31, 23, 59, 59, 999);
    startMs = firstDay.getTime();
    endMs = lastDay.getTime();
    granularity = 'month';
    rangeLabel = `Năm ${ref.getFullYear()}`;
    for (let m = 0; m < 12; m++) {
      const mDate = new Date(ref.getFullYear(), m, 1, 0, 0, 0, 0);
      buckets.push({
        key: monthKey(mDate),
        label: `T${m + 1}`,
        fullLabel: `Tháng ${pad2(m + 1)}/${ref.getFullYear()}`,
        revenue: 0,
        orderCount: 0,
      });
    }
  } else {
    const parsedStart = options.customStart ? new Date(options.customStart) : null;
    const parsedEnd = options.customEnd ? new Date(options.customEnd) : null;
    if (
      !parsedStart ||
      !parsedEnd ||
      Number.isNaN(parsedStart.getTime()) ||
      Number.isNaN(parsedEnd.getTime()) ||
      parsedStart.getTime() > parsedEnd.getTime()
    ) {
      return {
        mode: 'custom',
        granularity: 'hour',
        rangeLabel: 'Khoảng thời gian tùy chỉnh chưa hợp lệ',
        buckets: [],
        totalRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        maxBucketRevenue: 0,
        matchedQuantity: 0,
        customRangeInvalid: true,
      };
    }

    startMs = parsedStart.getTime();
    // Include seconds inside the selected end minute
    endMs = parsedEnd.getTime() + 59_999;
    const spanMs = endMs - startMs;
    const spanHours = spanMs / (60 * 60 * 1000);
    const spanDays = spanMs / (24 * 60 * 60 * 1000);

    rangeLabel = `${pad2(parsedStart.getHours())}:${pad2(parsedStart.getMinutes())} ${formatShortDate(parsedStart)} – ${pad2(parsedEnd.getHours())}:${pad2(parsedEnd.getMinutes())} ${formatFullDate(parsedEnd)}`;

    if (spanHours <= 48) {
      granularity = 'hour';
      const cursor = new Date(
        parsedStart.getFullYear(),
        parsedStart.getMonth(),
        parsedStart.getDate(),
        parsedStart.getHours(),
        0,
        0,
        0,
      );
      const endHourStart = new Date(
        parsedEnd.getFullYear(),
        parsedEnd.getMonth(),
        parsedEnd.getDate(),
        parsedEnd.getHours(),
        0,
        0,
        0,
      ).getTime();
      const sameDay = dayKey(parsedStart) === dayKey(parsedEnd);

      while (cursor.getTime() <= endHourStart && buckets.length < 72) {
        buckets.push({
          key: hourKey(cursor),
          label: sameDay
            ? `${pad2(cursor.getHours())}h`
            : `${pad2(cursor.getHours())}h ${formatShortDate(cursor)}`,
          fullLabel: `${pad2(cursor.getHours())}:00 – ${pad2(cursor.getHours())}:59 (${formatFullDate(cursor)})`,
          revenue: 0,
          orderCount: 0,
        });
        cursor.setHours(cursor.getHours() + 1);
      }
    } else if (spanDays <= 62) {
      granularity = 'day';
      const cursor = new Date(
        parsedStart.getFullYear(),
        parsedStart.getMonth(),
        parsedStart.getDate(),
        0,
        0,
        0,
        0,
      );
      const endDayStart = new Date(
        parsedEnd.getFullYear(),
        parsedEnd.getMonth(),
        parsedEnd.getDate(),
        0,
        0,
        0,
        0,
      ).getTime();
      while (cursor.getTime() <= endDayStart && buckets.length < 70) {
        buckets.push({
          key: dayKey(cursor),
          label: formatShortDate(cursor),
          fullLabel: `Ngày ${formatFullDate(cursor)}`,
          revenue: 0,
          orderCount: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      granularity = 'month';
      const cursor = new Date(parsedStart.getFullYear(), parsedStart.getMonth(), 1, 0, 0, 0, 0);
      const endMonthStart = new Date(
        parsedEnd.getFullYear(),
        parsedEnd.getMonth(),
        1,
        0,
        0,
        0,
        0,
      ).getTime();
      while (cursor.getTime() <= endMonthStart && buckets.length < 48) {
        buckets.push({
          key: monthKey(cursor),
          label: `T${cursor.getMonth() + 1}/${String(cursor.getFullYear()).slice(-2)}`,
          fullLabel: `Tháng ${pad2(cursor.getMonth() + 1)}/${cursor.getFullYear()}`,
          revenue: 0,
          orderCount: 0,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
  }

  const bucketMap = new Map<string, RevenueChartBucket>();
  for (const b of buckets) {
    bucketMap.set(b.key, b);
  }

  const selectedCategoryIds = (options.categoryIds ?? []).filter((c) => c.trim().length > 0);
  const selectedProductIds = (options.productIds ?? []).filter((p) => p.trim().length > 0);
  const hasCategoryFilter = selectedCategoryIds.length > 0;
  const hasProductFilter = selectedProductIds.length > 0;
  const hasItemFilter = hasCategoryFilter || hasProductFilter;

  const catalogProducts = options.products ?? [];
  const catalogCategories = options.categories ?? [];
  const expandedCats = collectExpandedCategoryKeys(selectedCategoryIds, catalogCategories);

  const productById = new Map<string, Product>();
  const productBySku = new Map<string, Product>();
  const productByName = new Map<string, Product>();
  for (const p of catalogProducts) {
    productById.set(p.id, p);
    if (p.sku) productBySku.set(p.sku.trim().toUpperCase(), p);
    if (p.name) productByName.set(normalizeVietnameseText(p.name), p);
  }

  const selectedProductIdSet = new Set(selectedProductIds);
  const selectedProductSkuSet = new Set<string>();
  for (const pid of selectedProductIds) {
    const prod = productById.get(pid);
    if (prod?.sku) {
      selectedProductSkuSet.add(prod.sku.trim().toUpperCase());
    }
  }

  let totalRevenue = 0;
  let totalOrders = 0;
  let matchedQuantity = 0;

  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    if (options.paidOnly && !order.isPaid) continue;

    const ts = parseOrderTimestamp(order);
    if (ts === null || ts < startMs || ts > endMs) continue;

    let amount = Math.max(0, Number(order.total) || 0);
    let orderMatchedQty = 0;

    if (hasItemFilter) {
      let matchedGross = 0;
      for (const item of order.items) {
        const resolvedProduct =
          productById.get(item.productId) ??
          (item.sku ? productBySku.get(item.sku.trim().toUpperCase()) : undefined) ??
          productByName.get(normalizeVietnameseText(item.name));

        if (hasCategoryFilter) {
          const catMatch =
            (resolvedProduct?.categoryId && expandedCats.ids.has(resolvedProduct.categoryId)) ||
            (resolvedProduct?.categorySlug &&
              expandedCats.names.has(normalizeVietnameseText(resolvedProduct.categorySlug))) ||
            (resolvedProduct?.category &&
              expandedCats.names.has(normalizeVietnameseText(resolvedProduct.category))) ||
            (resolvedProduct?.categoryLabel &&
              expandedCats.names.has(normalizeVietnameseText(resolvedProduct.categoryLabel))) ||
            (item.categoryLabel &&
              expandedCats.names.has(normalizeVietnameseText(item.categoryLabel)));
          if (!catMatch) continue;
        }

        if (hasProductFilter) {
          const itemSkuUpper = item.sku?.trim().toUpperCase() ?? '';
          const prodMatch =
            selectedProductIdSet.has(item.productId) ||
            (resolvedProduct ? selectedProductIdSet.has(resolvedProduct.id) : false) ||
            (itemSkuUpper.length > 0 && selectedProductSkuSet.has(itemSkuUpper)) ||
            (resolvedProduct?.sku
              ? selectedProductSkuSet.has(resolvedProduct.sku.trim().toUpperCase())
              : false);
          if (!prodMatch) continue;
        }

        const qty = Math.max(0, Number(item.quantity) || 0);
        const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
        matchedGross += Math.round(unitPrice * qty);
        orderMatchedQty += qty;
      }

      if (orderMatchedQty <= 0 && matchedGross <= 0) {
        continue;
      }

      const subtotal = Math.max(0, Number(order.subtotal) || 0);
      const discount = Math.max(0, Number(order.discountAmount ?? 0) || 0);
      if (subtotal > 0 && discount > 0) {
        const netRatio = Math.max(0, subtotal - discount) / subtotal;
        amount = Math.round(matchedGross * netRatio);
      } else {
        amount = matchedGross;
      }
      matchedQuantity += orderMatchedQty;
    } else {
      for (const item of order.items) {
        matchedQuantity += Math.max(0, Number(item.quantity) || 0);
      }
    }

    const d = new Date(ts);
    const key =
      granularity === 'hour'
        ? hourKey(d)
        : granularity === 'day'
          ? dayKey(d)
          : monthKey(d);
    const bucket = bucketMap.get(key);
    if (bucket) {
      bucket.revenue += amount;
      bucket.orderCount += 1;
    }
    totalRevenue += amount;
    totalOrders += 1;
  }

  const maxBucketRevenue = buckets.reduce(
    (max, b) => (b.revenue > max ? b.revenue : max),
    0,
  );

  return {
    mode,
    granularity,
    rangeLabel,
    buckets,
    totalRevenue,
    totalOrders,
    averageOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    maxBucketRevenue,
    matchedQuantity,
    customRangeInvalid: false,
  };
}

export function canViewRevenueChart(
  role: UserRole | null | undefined,
): boolean {
  return role === 'admin' || role === 'manager';
}

export function canViewAllRevenuePeriods(
  role: UserRole | null | undefined,
): boolean {
  return role === 'admin' || role === 'manager';
}

export function getVisibleRevenueModesForRole(
  role: UserRole | null | undefined,
): RevenuePeriodMode[] {
  if (canViewAllRevenuePeriods(role)) {
    return ['day', 'week', 'month', 'quarter', 'year', 'custom'];
  }
  return ['day'];
}

export const REVENUE_PERIOD_LABELS: Record<RevenuePeriodMode, string> = {
  day: 'Trong ngày',
  week: 'Trong tuần',
  month: 'Trong tháng',
  quarter: 'Trong quý',
  year: 'Trong năm',
  custom: 'Tùy chỉnh',
};

export function normalizePurchasePackOptions(
  raw: unknown,
  fallbackBaseUnit: string = 'Cái',
): PurchasePackOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: PurchasePackOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const factor = Number(rec.factor);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    const roundedFactor = Number(factor.toFixed(2));
    const label =
      typeof rec.label === 'string' && rec.label.trim()
        ? rec.label.trim()
        : fallbackBaseUnit.trim() || 'Cái';
    const key = `${label.toLowerCase()}__${roundedFactor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ label, factor: roundedFactor });
  }
  return result.sort((a, b) => a.factor - b.factor || a.label.localeCompare(b.label, 'vi'));
}

export function getEffectivePurchasePackOptions(
  product: Pick<Product, 'baseUnit' | 'unit' | 'conversionRate' | 'purchasePackOptions'>,
): PurchasePackOption[] {
  const baseLabel = product.baseUnit?.trim() || product.unit?.trim() || 'Cái';
  const configured = normalizePurchasePackOptions(
    product.purchasePackOptions,
    baseLabel,
  );
  if (configured.length > 0) {
    return configured;
  }

  const defaults: PurchasePackOption[] = [{ label: baseLabel, factor: 1 }];
  const conv = Number(product.conversionRate ?? 1);
  const packLabel = product.unit?.trim();
  if (Number.isFinite(conv) && conv > 1 && packLabel && packLabel !== baseLabel) {
    defaults.push({ label: packLabel, factor: Number(conv.toFixed(2)) });
  }
  return defaults;
}

export function findMinimumPackSumAtLeast(
  target: number,
  packFactors: number[],
): number {
  const cleanTarget = Math.ceil(target);
  if (cleanTarget <= 0) return 0;

  const factors = Array.from(
    new Set(
      packFactors
        .map((f) => Math.round(Number(f)))
        .filter((f) => Number.isFinite(f) && f > 0),
    ),
  ).sort((a, b) => a - b);

  if (factors.length === 0 || factors.includes(1)) {
    return cleanTarget;
  }

  const minFactor = factors[0];
  const maxFactor = factors[factors.length - 1];

  // Fast path when every larger pack is a multiple of the smallest pack
  if (factors.every((f) => f % minFactor === 0)) {
    return Math.ceil(cleanTarget / minFactor) * minFactor;
  }

  // Exact unbounded coin reachability up to cleanTarget + minFactor
  const limit = cleanTarget + minFactor;
  if (limit <= 50000) {
    const reachable = new Uint8Array(limit + 1);
    reachable[0] = 1;
    for (let s = 0; s <= limit; s++) {
      if (!reachable[s]) continue;
      if (s >= cleanTarget) {
        return s;
      }
      for (const f of factors) {
        const next = s + f;
        if (next <= limit) {
          reachable[next] = 1;
        }
      }
    }
    return Math.ceil(cleanTarget / minFactor) * minFactor;
  }

  return Math.ceil(cleanTarget / maxFactor) * maxFactor;
}

export interface CalculateSuggestedImportInput {
  stock: number;
  orderedQuantity?: number;
  minStock?: number | null;
  maxStock?: number | null;
  packOptions?: PurchasePackOption[];
}

export function calculateSuggestedImportQuantity(
  input: CalculateSuggestedImportInput,
): number {
  const stock = Number(input.stock ?? 0);
  const ordered = Number(input.orderedQuantity ?? 0);
  const minStock =
    input.minStock === null || input.minStock === undefined
      ? null
      : Number(input.minStock);
  const maxStock =
    input.maxStock === null || input.maxStock === undefined
      ? null
      : Number(input.maxStock);

  if (!Number.isFinite(stock) || minStock === null || !Number.isFinite(minStock)) {
    return 0;
  }

  const netAvailable = stock - (Number.isFinite(ordered) ? ordered : 0);

  // Tồn kho - khách đặt >= tồn nhỏ nhất => Nhập hàng = 0
  if (netAvailable >= minStock) {
    return 0;
  }

  // Tồn kho - khách đặt < tồn nhỏ nhất => tính lượng nhập tối thiểu để tồn kho - khách đặt + nhập hàng >= tồn lớn nhất
  const targetMax =
    maxStock !== null && Number.isFinite(maxStock)
      ? Math.max(minStock, maxStock)
      : minStock;

  const rawNeeded = Math.max(0, targetMax - netAvailable);
  if (rawNeeded <= 0) {
    return 0;
  }

  const validFactors = (input.packOptions ?? [])
    .map((opt) => Number(opt.factor))
    .filter((f) => Number.isFinite(f) && f > 0);

  if (validFactors.length === 0) {
    return Math.ceil(rawNeeded);
  }

  return findMinimumPackSumAtLeast(rawNeeded, validFactors);
}

export function getLatestProductImportCostMap(
  purchaseOrders: PurchaseOrderRecord[],
  products: Product[],
): Map<string, number> {
  const sortedOrders = purchaseOrders
    .map((po, idx) => ({
      po,
      idx,
      ts: po.importedAtIso ? Date.parse(po.importedAtIso) : Number.NaN,
    }))
    .sort((a, b) => {
      const aValid = Number.isFinite(a.ts);
      const bValid = Number.isFinite(b.ts);
      if (aValid && bValid && b.ts !== a.ts) {
        return b.ts - a.ts;
      }
      if (aValid !== bValid) {
        return bValid ? 1 : -1;
      }
      return a.idx - b.idx;
    });

  const costByProductId = new Map<string, number>();
  const costBySku = new Map<string, number>();

  for (const { po } of sortedOrders) {
    for (const item of po.items) {
      const unitCost = Math.max(0, Number(item.unitCost) || 0);
      const discountAmt = Math.min(
        unitCost,
        Math.max(0, Number(item.discountAmount) || 0),
      );
      const rawNet =
        item.netUnitCost !== undefined && Number.isFinite(Number(item.netUnitCost))
          ? Math.max(0, Number(item.netUnitCost))
          : Math.max(0, unitCost - discountAmt);
      const conv = Math.max(0.01, Number(item.conversionFactor) || 1);
      const baseNetCost = Math.round(rawNet / conv);

      const pid = (item.productId ?? '').trim();
      const sku = (item.sku ?? '').trim().toUpperCase();

      if (pid && !costByProductId.has(pid)) {
        costByProductId.set(pid, baseNetCost);
      }
      if (sku && !costBySku.has(sku)) {
        costBySku.set(sku, baseNetCost);
      }
    }
  }

  const result = new Map<string, number>();
  for (const product of products) {
    const fromId = costByProductId.get(product.id);
    const fromSku = product.sku
      ? costBySku.get(product.sku.trim().toUpperCase())
      : undefined;
    const resolved =
      fromId !== undefined
        ? fromId
        : fromSku !== undefined
          ? fromSku
          : Math.max(0, Number(product.costPrice ?? 0) || 0);
    result.set(product.id, resolved);
  }
  return result;
}

export type NeedImportReason =
  | 'below-min'
  | 'out-of-stock'
  | 'manual-threshold';

export interface NeedImportCandidate {
  product: Product;
  reason: NeedImportReason;
  netAvailable: number;
  suggestedQty: number;
  lastImportPrice: number;
}

export interface BuildNeedImportOptions {
  products: Product[];
  purchaseOrders: PurchaseOrderRecord[];
  includeOutOfStock?: boolean;
  manualStockThreshold?: number | null;
}

export function buildNeedImportCandidates(
  options: BuildNeedImportOptions,
): NeedImportCandidate[] {
  const {
    products,
    purchaseOrders,
    includeOutOfStock = false,
    manualStockThreshold = null,
  } = options;
  const costMap = getLatestProductImportCostMap(purchaseOrders, products);
  const hasManualThreshold =
    manualStockThreshold !== null &&
    manualStockThreshold !== undefined &&
    Number.isFinite(manualStockThreshold);
  const thresholdValue = hasManualThreshold ? Number(manualStockThreshold) : 0;

  const candidates: NeedImportCandidate[] = [];

  for (const product of products) {
    const stock = Number(product.stock ?? 0);
    const ordered = Number(product.orderedQuantity ?? 0);
    const netAvailable = stock - (Number.isFinite(ordered) ? ordered : 0);
    const minStock =
      product.minStock !== null &&
      product.minStock !== undefined &&
      Number.isFinite(Number(product.minStock))
        ? Number(product.minStock)
        : null;
    const maxStock =
      product.maxStock !== null &&
      product.maxStock !== undefined &&
      Number.isFinite(Number(product.maxStock))
        ? Number(product.maxStock)
        : null;

    let reason: NeedImportReason | null = null;
    if (minStock !== null && netAvailable < minStock) {
      reason = 'below-min';
    } else if (includeOutOfStock && stock <= 0) {
      reason = 'out-of-stock';
    } else if (hasManualThreshold && stock <= thresholdValue) {
      reason = 'manual-threshold';
    }

    if (!reason) continue;

    const packOptions = getEffectivePurchasePackOptions(product);
    let suggestedQty = 0;

    if (reason === 'below-min') {
      suggestedQty = calculateSuggestedImportQuantity({
        stock,
        orderedQuantity: ordered,
        minStock,
        maxStock,
        packOptions,
      });
    } else {
      const targetStock =
        maxStock !== null && maxStock > netAvailable
          ? maxStock
          : hasManualThreshold && thresholdValue > netAvailable
            ? Math.max(1, thresholdValue)
            : netAvailable < 0
              ? 1
              : netAvailable + 1;
      const rawNeeded = Math.max(1, targetStock - netAvailable);
      const validFactors = packOptions
        .map((opt) => Number(opt.factor))
        .filter((f) => Number.isFinite(f) && f > 0);
      suggestedQty =
        validFactors.length > 0
          ? findMinimumPackSumAtLeast(rawNeeded, validFactors)
          : Math.ceil(rawNeeded);
    }

    candidates.push({
      product,
      reason,
      netAvailable,
      suggestedQty: Math.max(1, suggestedQty),
      lastImportPrice: costMap.get(product.id) ?? Math.max(0, product.costPrice ?? 0),
    });
  }

  return candidates.sort((a, b) => {
    const rank = (r: NeedImportReason) =>
      r === 'below-min' ? 0 : r === 'out-of-stock' ? 1 : 2;
    return (
      rank(a.reason) - rank(b.reason) ||
      a.netAvailable - b.netAvailable ||
      a.product.name.localeCompare(b.product.name, 'vi')
    );
  });
}

export function parseNullableStockBound(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Number(parsed.toFixed(2)));
}

export function formatStockBoundInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '';
  }
  return String(Number(value));
}

export const CUSTOMER_GROUP_OPTIONS: string[] = [
  'Khách lẻ',
  'Cơ quan - Trường học',
  'Khách sỉ',
];

export const CASH_VOUCHER_CATEGORY_LABELS: Record<CashVoucherCategory, string> = {
  customer_debt: 'Thu nợ khách hàng',
  sales_income: 'Thu tiền đơn bán hàng',
  supplier_refund: 'NCC hoàn tiền / chiết khấu',
  other_income: 'Thu nhập khác',
  supplier_debt: 'Trả nợ nhà cung cấp',
  purchase_expense: 'Chi tiền nhập hàng',
  shipping_fee: 'Chi phí giao hàng / vận chuyển / gửi xe',
  operating_expense: 'Chi phí vận hành cửa hàng',
  customer_refund: 'Hoàn tiền cho khách',
  other_expense: 'Chi phí khác',
};

export const CASH_VOUCHER_CATEGORIES_BY_TYPE: Record<
  CashVoucherType,
  CashVoucherCategory[]
> = {
  receipt: ['customer_debt', 'sales_income', 'supplier_refund', 'other_income'],
  payment: [
    'supplier_debt',
    'purchase_expense',
    'shipping_fee',
    'operating_expense',
    'customer_refund',
    'other_expense',
  ],
};

export function getAllowedVoucherCategoriesForRole(
  role: UserRole | null | undefined,
  voucherType: CashVoucherType,
): CashVoucherCategory[] {
  if (role === 'staff') {
    return voucherType === 'receipt'
      ? ['customer_debt', 'sales_income']
      : ['customer_refund'];
  }
  return CASH_VOUCHER_CATEGORIES_BY_TYPE[voucherType];
}

export function generateVoucherCode(
  voucherType: CashVoucherType,
  now: Date = new Date(),
  existingCodes: string[] = [],
): string {
  const prefix = voucherType === 'receipt' ? 'PT' : 'PC';
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dayPrefix = `${prefix}-${mm}${dd}-`;
  const used = new Set(
    existingCodes.map((code) => code.trim().toUpperCase()).filter(Boolean),
  );
  let seq = 1;
  while (used.has(`${dayPrefix}${String(seq).padStart(2, '0')}`.toUpperCase())) {
    seq += 1;
  }
  return `${dayPrefix}${String(seq).padStart(2, '0')}`;
}

export function getOrderPaidAmount(order: Pick<OrderRecord, 'total' | 'paidAmount' | 'isPaid'>): number {
  const total = Math.max(0, Math.round(Number(order.total) || 0));
  if (order.paidAmount !== undefined && order.paidAmount !== null && Number.isFinite(Number(order.paidAmount))) {
    const rawPaid = Math.max(0, Math.round(Number(order.paidAmount) || 0));
    if (order.isPaid && rawPaid === 0 && total > 0) {
      return total;
    }
    return Math.min(total, rawPaid);
  }
  return order.isPaid ? total : 0;
}

export function getOrderRemainingDebt(
  order: Pick<OrderRecord, 'total' | 'paidAmount' | 'isPaid' | 'status'>,
): number {
  if (order.status === 'cancelled') return 0;
  const total = Math.max(0, Math.round(Number(order.total) || 0));
  if (order.isPaid) return 0;
  return Math.max(0, total - getOrderPaidAmount(order));
}

export function getPurchaseOrderPaidAmount(
  po: Pick<PurchaseOrderRecord, 'totalAmount' | 'paidAmount' | 'isPaid'>,
): number {
  const total = Math.max(0, Math.round(Number(po.totalAmount) || 0));
  if (po.paidAmount !== undefined && po.paidAmount !== null && Number.isFinite(Number(po.paidAmount))) {
    const rawPaid = Math.max(0, Math.round(Number(po.paidAmount) || 0));
    if (po.isPaid && rawPaid === 0 && total > 0) {
      return total;
    }
    return Math.min(total, rawPaid);
  }
  return po.isPaid === false ? 0 : total;
}

export function getPurchaseOrderRemainingDebt(
  po: Pick<PurchaseOrderRecord, 'totalAmount' | 'paidAmount' | 'isPaid'>,
): number {
  const total = Math.max(0, Math.round(Number(po.totalAmount) || 0));
  if (po.isPaid === true) return 0;
  return Math.max(0, total - getPurchaseOrderPaidAmount(po));
}

export function calculateCustomerDebtMap(
  orders: OrderRecord[],
  customers: CustomerRecord[],
): Map<string, CustomerDebtSummary> {
  const customerById = new Map<string, CustomerRecord>();
  for (const c of customers) {
    customerById.set(c.id, c);
  }

  const map = new Map<string, CustomerDebtSummary>();
  const ensureEntry = (customerId: string): CustomerDebtSummary => {
    const existing = map.get(customerId);
    if (existing) return existing;
    const created: CustomerDebtSummary = {
      customerId,
      totalOrderAmount: 0,
      totalPaidAmount: 0,
      debtAmount: 0,
      unpaidOrderCount: 0,
      overCreditLimit: false,
    };
    map.set(customerId, created);
    return created;
  };

  for (const c of customers) {
    ensureEntry(c.id);
  }

  for (const order of orders) {
    if (!order.customerId || order.status === 'cancelled') continue;
    const entry = ensureEntry(order.customerId);
    const total = Math.max(0, Math.round(Number(order.total) || 0));
    const paid = getOrderPaidAmount(order);
    const debt = getOrderRemainingDebt(order);
    entry.totalOrderAmount += total;
    entry.totalPaidAmount += paid;
    entry.debtAmount += debt;
    if (debt > 0) {
      entry.unpaidOrderCount += 1;
    }
  }

  for (const entry of map.values()) {
    const customer = customerById.get(entry.customerId);
    const limit = customer?.creditLimit;
    entry.overCreditLimit =
      limit !== null &&
      limit !== undefined &&
      Number.isFinite(Number(limit)) &&
      Number(limit) >= 0 &&
      entry.debtAmount > Number(limit);
  }

  return map;
}

export function calculateSupplierDebtMap(
  purchaseOrders: PurchaseOrderRecord[],
  suppliers: SupplierRecord[],
): Map<string, SupplierDebtSummary> {
  const map = new Map<string, SupplierDebtSummary>();
  const ensureEntry = (supplierId: string): SupplierDebtSummary => {
    const existing = map.get(supplierId);
    if (existing) return existing;
    const created: SupplierDebtSummary = {
      supplierId,
      totalPurchaseAmount: 0,
      totalPaidAmount: 0,
      debtAmount: 0,
      unpaidPoCount: 0,
    };
    map.set(supplierId, created);
    return created;
  };

  for (const s of suppliers) {
    ensureEntry(s.id);
  }

  for (const po of purchaseOrders) {
    if (!po.supplierId) continue;
    const entry = ensureEntry(po.supplierId);
    const total = Math.max(0, Math.round(Number(po.totalAmount) || 0));
    const paid = getPurchaseOrderPaidAmount(po);
    const debt = getPurchaseOrderRemainingDebt(po);
    entry.totalPurchaseAmount += total;
    entry.totalPaidAmount += paid;
    entry.debtAmount += debt;
    if (debt > 0) {
      entry.unpaidPoCount += 1;
    }
  }

  return map;
}

export function calculateCashbookSummary(
  orders: OrderRecord[],
  purchaseOrders: PurchaseOrderRecord[],
  vouchers: CashVoucherRecord[],
): CashbookSummary {
  let totalReceipts = 0;
  let totalPayments = 0;
  let voucherExpenseExtra = 0;

  for (const v of vouchers) {
    const amt = Math.max(0, Math.round(Number(v.amount) || 0));
    if (v.voucherType === 'receipt') {
      totalReceipts += amt;
    } else {
      totalPayments += amt;
      if (
        v.category === 'shipping_fee' ||
        v.category === 'operating_expense' ||
        v.category === 'other_expense'
      ) {
        voucherExpenseExtra += amt;
      }
    }
  }

  let totalReceivable = 0;
  for (const order of orders) {
    totalReceivable += getOrderRemainingDebt(order);
  }

  let totalPayable = 0;
  let poExtraFeeTotal = 0;
  for (const po of purchaseOrders) {
    totalPayable += getPurchaseOrderRemainingDebt(po);
    poExtraFeeTotal += Math.max(0, Math.round(Number(po.extraFeeTotal) || 0));
  }

  return {
    totalReceipts,
    totalPayments,
    netCashflow: totalReceipts - totalPayments,
    totalReceivable,
    totalPayable,
    operatingAndExtraExpenses: voucherExpenseExtra + poExtraFeeTotal,
  };
}

export interface MergedCustomerPreview {
  primaryId: string;
  duplicateIds: string[];
  phone: string;
  fullName: string;
  defaultAddress: string;
  area: string;
  customerGroup: string;
  taxCode: string;
  bankAccount: string;
  bankName: string;
  email: string;
  creditLimit: number | null;
  notes: string;
  combinedOrdersCount: number;
  combinedTotalSpent: number;
}

export function buildMergedCustomerPreview(
  selectedCustomers: CustomerRecord[],
  primaryId: string,
): MergedCustomerPreview | null {
  if (selectedCustomers.length < 2) return null;
  const primary =
    selectedCustomers.find((c) => c.id === primaryId) ?? selectedCustomers[0];
  const others = selectedCustomers.filter((c) => c.id !== primary.id);
  const allOrdered = [primary, ...others];

  const pickFirstNonEmpty = (getter: (c: CustomerRecord) => string | null | undefined): string => {
    for (const c of allOrdered) {
      const val = (getter(c) ?? '').trim();
      if (val) return val;
    }
    return '';
  };

  const mergedNotesParts = Array.from(
    new Set(
      allOrdered
        .map((c) => c.notes.trim())
        .filter(Boolean),
    ),
  );

  const creditLimits = allOrdered
    .map((c) => c.creditLimit)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)));

  return {
    primaryId: primary.id,
    duplicateIds: others.map((c) => c.id),
    phone: pickFirstNonEmpty((c) => c.phone),
    fullName: pickFirstNonEmpty((c) => c.fullName),
    defaultAddress: pickFirstNonEmpty((c) => c.defaultAddress),
    area: pickFirstNonEmpty((c) => c.area),
    customerGroup: pickFirstNonEmpty((c) => c.customerGroup) || 'Khách lẻ',
    taxCode: pickFirstNonEmpty((c) => c.taxCode),
    bankAccount: pickFirstNonEmpty((c) => c.bankAccount),
    bankName: pickFirstNonEmpty((c) => c.bankName),
    email: pickFirstNonEmpty((c) => c.email),
    creditLimit: creditLimits.length > 0 ? Math.max(...creditLimits) : null,
    notes: mergedNotesParts.join(' | '),
    combinedOrdersCount: allOrdered.reduce((s, c) => s + (c.totalOrders || 0), 0),
    combinedTotalSpent: allOrdered.reduce((s, c) => s + (c.totalSpent || 0), 0),
  };
}



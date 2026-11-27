import type {
  AdminTab,
  OrderRecord,
  PurchaseOrderItem,
  RevenueChartBucket,
  RevenueChartSummary,
  RevenueGranularity,
  RevenuePeriodMode,
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
  return tab === 'orders' || tab === 'customers';
}

export function getAllowedAdminTabs(
  role: UserRole | null | undefined,
): AdminTab[] {
  if (role === 'admin') {
    return ['orders', 'customers', 'products', 'purchases', 'users'];
  }
  if (role === 'manager') {
    return ['orders', 'customers', 'products', 'purchases'];
  }
  if (role === 'staff') return ['orders', 'customers'];
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

export function generatePurchaseCode(now: Date = new Date()): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `PN-${hh}${mm}-${rand}`;
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

export function calculatePurchaseSummary(items: PurchaseOrderItem[]): {
  itemCount: number;
  totalQuantity: number;
  totalGrossAmount: number;
  totalDiscountAmount: number;
  totalAmount: number;
} {
  return items.reduce(
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
        totalAmount: acc.totalAmount + Math.round(qty * netUnitCost),
      };
    },
    {
      itemCount: 0,
      totalQuantity: 0,
      totalGrossAmount: 0,
      totalDiscountAmount: 0,
      totalAmount: 0,
    },
  );
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

  let totalRevenue = 0;
  let totalOrders = 0;

  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    if (options.paidOnly && !order.isPaid) continue;

    const ts = parseOrderTimestamp(order);
    if (ts === null || ts < startMs || ts > endMs) continue;

    const d = new Date(ts);
    const key =
      granularity === 'hour'
        ? hourKey(d)
        : granularity === 'day'
          ? dayKey(d)
          : monthKey(d);
    const bucket = bucketMap.get(key);
    const amount = Math.max(0, Number(order.total) || 0);
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
    customRangeInvalid: false,
  };
}

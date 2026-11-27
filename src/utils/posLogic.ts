import type {
  CartItem,
  OrderRecord,
  PosDraftTab,
  Product,
} from '../types/shop';
import {
  generateOrderCode,
  normalizeVietnameseText,
} from './shopLogic';

export const POS_TABS_STORAGE_KEY = 'vpp_huong_long_pos_tabs_v1';

export interface PosStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function getDefaultPosStorage(): PosStorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createPosTabId(now: number = Date.now()): string {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `pos-${now}-${rand}`;
}

export function createNewPosTab(
  indexNumber: number = 1,
  now: Date = new Date(),
): PosDraftTab {
  return {
    id: createPosTabId(now.getTime()),
    label: `Đơn ${indexNumber}`,
    orderCode: generateOrderCode(now),
    items: [],
    customerId: null,
    customerName: 'Khách lẻ',
    phone: '',
    address: 'Tại quầy',
    note: '',
    deliveryMethod: 'pickup',
    paymentMethod: 'cod',
    discountPercent: 0,
    discountAmount: 0,
    createdAtIso: now.toISOString(),
  };
}

export function formatPosTabDisplayTitle(
  tab: Pick<PosDraftTab, 'customerName' | 'phone'>,
  index: number,
): string {
  const cleanName = tab.customerName.trim();
  const cleanPhone = tab.phone.trim();
  if (cleanName && cleanName.toLowerCase() !== 'khách lẻ') {
    return `Đơn ${index + 1} · ${cleanName}`;
  }
  if (cleanPhone) {
    return `Đơn ${index + 1} · ${cleanPhone}`;
  }
  return `Đơn ${index + 1} (Khách lẻ)`;
}

export function calculatePosOrderTotals(
  items: CartItem[],
  discountAmountInput: number,
): {
  itemCount: number;
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  total: number;
} {
  const itemCount = items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.quantity) || 0),
    0,
  );
  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      Math.max(0, Number(item.unitPrice) || 0) *
        Math.max(0, Number(item.quantity) || 0),
    0,
  );
  const roundedSubtotal = Math.round(subtotal);
  const clampedDiscount = Math.min(
    roundedSubtotal,
    Math.max(0, Math.round(Number(discountAmountInput) || 0)),
  );
  const discountPercent =
    roundedSubtotal > 0
      ? Number(((clampedDiscount / roundedSubtotal) * 100).toFixed(2))
      : 0;
  const total = Math.max(0, roundedSubtotal - clampedDiscount);

  return {
    itemCount,
    subtotal: roundedSubtotal,
    discountAmount: clampedDiscount,
    discountPercent,
    total,
  };
}

export function syncOrderDiscountFromPercent(
  subtotalInput: number,
  percentInput: number,
): {
  discountPercent: number;
  discountAmount: number;
  total: number;
} {
  const subtotal = Math.max(0, Math.round(Number(subtotalInput) || 0));
  const pct = Math.min(100, Math.max(0, Number(percentInput) || 0));
  const discountAmount = Math.round((subtotal * pct) / 100);
  return {
    discountPercent: Number(pct.toFixed(2)),
    discountAmount,
    total: Math.max(0, subtotal - discountAmount),
  };
}

export function syncOrderDiscountFromAmount(
  subtotalInput: number,
  amountInput: number,
): {
  discountPercent: number;
  discountAmount: number;
  total: number;
} {
  const subtotal = Math.max(0, Math.round(Number(subtotalInput) || 0));
  const rawAmt = Math.max(0, Math.round(Number(amountInput) || 0));
  const discountAmount = subtotal > 0 ? Math.min(subtotal, rawAmt) : 0;
  const discountPercent =
    subtotal > 0 ? Number(((discountAmount / subtotal) * 100).toFixed(2)) : 0;
  return {
    discountPercent,
    discountAmount,
    total: Math.max(0, subtotal - discountAmount),
  };
}

export function addPosItemToDraft(
  items: CartItem[],
  product: Product,
  variant: string,
  quantityInput: number = 1,
): CartItem[] {
  const qty = Number(quantityInput);
  if (!Number.isFinite(qty) || qty <= 0) return items;
  const resolvedVariant = variant.trim() || product.variants[0] || 'Tiêu chuẩn';

  const existingIndex = items.findIndex(
    (item) => item.productId === product.id && item.variant === resolvedVariant,
  );
  if (existingIndex >= 0) {
    return items.map((item, idx) =>
      idx === existingIndex
        ? { ...item, quantity: Number((item.quantity + qty).toFixed(2)) }
        : item,
    );
  }

  return [
    ...items,
    {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      categoryLabel: product.categoryLabel || product.category,
      unit: product.unit,
      variant: resolvedVariant,
      unitPrice: product.price,
      quantity: Number(qty.toFixed(2)),
      image: product.image,
    },
  ];
}

export function setPosItemQuantity(
  items: CartItem[],
  productId: string,
  variant: string,
  quantityInput: number,
): CartItem[] {
  const qty = Number(quantityInput);
  if (!Number.isFinite(qty) || qty <= 0) {
    return items.filter(
      (item) => !(item.productId === productId && item.variant === variant),
    );
  }
  return items.map((item) =>
    item.productId === productId && item.variant === variant
      ? { ...item, quantity: Number(qty.toFixed(2)) }
      : item,
  );
}

export function findExactProductByCode(
  products: Product[],
  rawCode: string,
): Product | null {
  const clean = rawCode.trim().toLowerCase();
  if (!clean) return null;

  const byBarcode = products.find(
    (p) => (p.barcode ?? '').trim().toLowerCase() === clean,
  );
  if (byBarcode) return byBarcode;

  const bySku = products.find(
    (p) => (p.sku ?? '').trim().toLowerCase() === clean,
  );
  return bySku ?? null;
}

export function searchPosProducts(
  products: Product[],
  rawQuery: string,
): Product[] {
  const trimmed = rawQuery.trim();
  const cleanLower = trimmed.toLowerCase();
  const normQuery = normalizeVietnameseText(trimmed);
  if (!normQuery) {
    return [...products].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  const scored: Array<{ product: Product; score: number }> = [];
  for (const product of products) {
    const skuLower = (product.sku ?? '').trim().toLowerCase();
    const barcodeLower = (product.barcode ?? '').trim().toLowerCase();
    const normName = normalizeVietnameseText(product.name);
    const haystack = normalizeVietnameseText(
      `${product.name} ${product.sku} ${product.barcode ?? ''} ${product.brand ?? ''} ${product.categoryLabel || product.category}`,
    );

    if (barcodeLower && barcodeLower === cleanLower) {
      scored.push({ product, score: 0 });
    } else if (skuLower && skuLower === cleanLower) {
      scored.push({ product, score: 1 });
    } else if (
      (barcodeLower && barcodeLower.startsWith(cleanLower)) ||
      (skuLower && skuLower.startsWith(cleanLower))
    ) {
      scored.push({ product, score: 2 });
    } else if (normName.startsWith(normQuery)) {
      scored.push({ product, score: 3 });
    } else if (haystack.includes(normQuery)) {
      scored.push({ product, score: 4 });
    }
  }

  scored.sort(
    (a, b) =>
      a.score - b.score || a.product.name.localeCompare(b.product.name, 'vi'),
  );
  return scored.map((entry) => entry.product);
}

export function resolvePosQtyInputCommit(rawValue: string): {
  valid: boolean;
  quantity: number;
} {
  const trimmed = rawValue.trim().replace(',', '.');
  if (!trimmed) {
    return { valid: true, quantity: 1 };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) {
    return { valid: false, quantity: 1 };
  }
  return { valid: true, quantity: Number(num.toFixed(2)) };
}

export type PosQtyInputAnalysis =
  | { kind: 'qty' }
  | { kind: 'barcode-scan'; product: Product }
  | { kind: 'switch-to-search'; query: string };

export function analyzePosQtyInputChange(
  rawValue: string,
  products: Product[],
): PosQtyInputAnalysis {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { kind: 'qty' };
  }

  // If user enters non-numeric text (product name or alphanumeric SKU),
  // switch immediately back to search while preserving what they typed.
  const isNumericInput = /^[0-9]+([.,][0-9]*)?$/.test(trimmed);
  if (!isNumericInput) {
    const matchedCode = findExactProductByCode(products, trimmed);
    if (matchedCode) {
      return { kind: 'barcode-scan', product: matchedCode };
    }
    return { kind: 'switch-to-search', query: rawValue };
  }

  // If a numeric barcode scanner fires straight into the quantity input,
  // numeric barcodes are >= 5 digits and match a catalog product barcode/SKU.
  if (trimmed.length >= 5) {
    const matchedCode = findExactProductByCode(products, trimmed);
    if (matchedCode) {
      return { kind: 'barcode-scan', product: matchedCode };
    }
  }

  return { kind: 'qty' };
}

export function buildOrderRecordFromPosTab(
  tab: PosDraftTab,
  options: {
    markConfirmedAndPaid: boolean;
    now?: Date;
  },
): OrderRecord {
  const now = options.now ?? new Date();
  const totals = calculatePosOrderTotals(tab.items, tab.discountAmount);
  const nowIso = now.toISOString();

  return {
    orderCode: tab.orderCode.trim() || generateOrderCode(now),
    customerId: tab.customerId ?? null,
    createdAt: now.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    createdAtIso: nowIso,
    customerName: tab.customerName.trim() || 'Khách lẻ',
    phone: tab.phone.replace(/[\s.-]/g, '').trim(),
    address:
      tab.deliveryMethod === 'pickup'
        ? tab.address.trim() || 'Tại quầy'
        : tab.address.trim(),
    note: tab.note.trim(),
    deliveryMethod: tab.deliveryMethod,
    paymentMethod: tab.paymentMethod,
    items: tab.items,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    shippingFee: 0,
    total: totals.total,
    status: options.markConfirmedAndPaid ? 'completed' : 'pending',
    isConfirmed: options.markConfirmedAndPaid,
    isPaid: options.markConfirmedAndPaid,
    confirmedAt: options.markConfirmedAndPaid ? nowIso : null,
    paidAt: options.markConfirmedAndPaid ? nowIso : null,
    syncedToSupabase: false,
  };
}

export function closePosTab(
  tabs: PosDraftTab[],
  activeTabId: string,
  tabIdToClose: string,
  now: Date = new Date(),
): {
  tabs: PosDraftTab[];
  activeTabId: string;
} {
  const remaining = tabs.filter((tab) => tab.id !== tabIdToClose);
  if (remaining.length === 0) {
    const fresh = createNewPosTab(1, now);
    return { tabs: [fresh], activeTabId: fresh.id };
  }

  if (activeTabId !== tabIdToClose) {
    return { tabs: remaining, activeTabId };
  }

  const closedIdx = tabs.findIndex((tab) => tab.id === tabIdToClose);
  const fallbackIdx = Math.min(Math.max(0, closedIdx), remaining.length - 1);
  return {
    tabs: remaining,
    activeTabId: remaining[fallbackIdx].id,
  };
}

export function normalizePosDraftTab(
  raw: Partial<PosDraftTab>,
  index: number,
): PosDraftTab {
  const fallback = createNewPosTab(index + 1);
  const items = Array.isArray(raw.items) ? raw.items : [];
  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      Math.max(0, Number(item.unitPrice) || 0) *
        Math.max(0, Number(item.quantity) || 0),
    0,
  );
  const discountState = syncOrderDiscountFromAmount(
    subtotal,
    Number(raw.discountAmount ?? 0),
  );

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : fallback.id,
    label:
      typeof raw.label === 'string' && raw.label.trim()
        ? raw.label
        : fallback.label,
    orderCode:
      typeof raw.orderCode === 'string' && raw.orderCode.trim()
        ? raw.orderCode
        : fallback.orderCode,
    items,
    customerId: raw.customerId ?? null,
    customerName:
      typeof raw.customerName === 'string'
        ? raw.customerName
        : fallback.customerName,
    phone: typeof raw.phone === 'string' ? raw.phone : '',
    address:
      typeof raw.address === 'string' ? raw.address : fallback.address,
    note: typeof raw.note === 'string' ? raw.note : '',
    deliveryMethod: raw.deliveryMethod === 'delivery' ? 'delivery' : 'pickup',
    paymentMethod: raw.paymentMethod === 'transfer' ? 'transfer' : 'cod',
    discountPercent: discountState.discountPercent,
    discountAmount: discountState.discountAmount,
    createdAtIso:
      typeof raw.createdAtIso === 'string' && raw.createdAtIso
        ? raw.createdAtIso
        : fallback.createdAtIso,
  };
}

export function loadPosTabsState(
  storage: PosStorageLike | null = getDefaultPosStorage(),
): {
  tabs: PosDraftTab[];
  activeTabId: string;
} {
  if (!storage) {
    const initial = createNewPosTab(1);
    return { tabs: [initial], activeTabId: initial.id };
  }
  try {
    const raw = storage.getItem(POS_TABS_STORAGE_KEY);
    if (!raw) {
      const initial = createNewPosTab(1);
      return { tabs: [initial], activeTabId: initial.id };
    }
    const parsed = JSON.parse(raw) as {
      tabs?: Array<Partial<PosDraftTab>>;
      activeTabId?: string;
    };
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      const initial = createNewPosTab(1);
      return { tabs: [initial], activeTabId: initial.id };
    }
    const tabs = parsed.tabs.map((tab, idx) => normalizePosDraftTab(tab, idx));
    const activeExists = tabs.some((tab) => tab.id === parsed.activeTabId);
    return {
      tabs,
      activeTabId: activeExists ? (parsed.activeTabId as string) : tabs[0].id,
    };
  } catch {
    const initial = createNewPosTab(1);
    return { tabs: [initial], activeTabId: initial.id };
  }
}

export function savePosTabsState(
  tabs: PosDraftTab[],
  activeTabId: string,
  storage: PosStorageLike | null = getDefaultPosStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      POS_TABS_STORAGE_KEY,
      JSON.stringify({ tabs, activeTabId }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

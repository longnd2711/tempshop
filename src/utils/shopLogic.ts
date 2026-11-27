import type {
  CartItem,
  CategoryId,
  CategoryNode,
  CheckoutErrors,
  CheckoutFormData,
  DeliveryMethod,
  Product,
  SortOption,
} from '../types/shop';

export const FREE_SHIP_THRESHOLD = 150000;
export const STANDARD_SHIPPING_FEE = 15000;

export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function normalizeCategoryKey(input: string): string {
  return normalizeVietnameseText(input)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatVnd(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('vi-VN')}₫`;
}

export function extractCategories(products: Product[]): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];

  for (const product of products) {
    const raw = (product.category || product.categoryLabel || '').trim();
    if (!raw) continue;
    const key = normalizeCategoryKey(raw);
    if (!seen.has(key)) {
      seen.add(key);
      categories.push(raw);
    }
  }

  return categories;
}

export function resolveMatchingCategory(
  targetLabel: string,
  availableCategories: string[],
): string {
  const normTarget = normalizeCategoryKey(targetLabel);
  if (!normTarget || normTarget === 'all') return 'all';

  const exact = availableCategories.find(
    (cat) => normalizeCategoryKey(cat) === normTarget,
  );
  if (exact) return exact;

  // Handle menu label variations (e.g. "Đồ chơi & Quà tặng" -> "Đồ chơi Quà tặng")
  const partial = availableCategories.find((cat) => {
    const normCat = normalizeCategoryKey(cat);
    return normTarget.includes(normCat) || normCat.includes(normTarget);
  });
  if (partial) return partial;

  return targetLabel;
}

export function buildCategoryDescendantSet(
  categoryTree: CategoryNode[],
  selectedCategory: string,
): { ids: Set<string>; keys: Set<string> } {
  const ids = new Set<string>();
  const keys = new Set<string>();
  if (!categoryTree.length) return { ids, keys };

  const normSelected = normalizeCategoryKey(selectedCategory);
  const root = categoryTree.find(
    (c) =>
      c.id === selectedCategory ||
      normalizeCategoryKey(c.name) === normSelected ||
      normalizeCategoryKey(c.slug) === normSelected,
  );
  if (!root) return { ids, keys };

  const queue: CategoryNode[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ids.has(current.id)) continue;
    ids.add(current.id);
    keys.add(normalizeCategoryKey(current.name));
    for (const node of categoryTree) {
      if (node.parentId === current.id && !ids.has(node.id)) {
        queue.push(node);
      }
    }
  }
  return { ids, keys };
}

export function extractTopCategories(
  products: Product[],
  categoryTree: CategoryNode[] = [],
): string[] {
  if (categoryTree.length > 0) {
    const topNodes = categoryTree
      .filter((c) => c.isActive && !c.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));
    if (topNodes.length > 0) {
      return topNodes.map((c) => c.name);
    }
  }
  return extractCategories(products);
}

export interface FilterProductsOptions {
  category: CategoryId;
  query: string;
  sortBy: SortOption;
  inStockOnly: boolean;
  categoryTree?: CategoryNode[];
}

export function filterAndSortProducts(
  products: Product[],
  options: FilterProductsOptions,
): Product[] {
  const normalizedQuery = normalizeVietnameseText(options.query);
  const normalizedSelectedCat = normalizeCategoryKey(options.category);
  const descendants =
    options.category !== 'all' &&
    normalizedSelectedCat !== 'all' &&
    options.categoryTree &&
    options.categoryTree.length > 0
      ? buildCategoryDescendantSet(options.categoryTree, options.category)
      : null;

  const filtered = products.filter((product) => {
    if (options.category !== 'all' && normalizedSelectedCat !== 'all') {
      const normProdCat = normalizeCategoryKey(
        product.category || product.categoryLabel || '',
      );
      const matchesTree =
        descendants !== null &&
        ((product.categoryId && descendants.ids.has(product.categoryId)) ||
          descendants.keys.has(normProdCat));
      const matchesCategory =
        matchesTree ||
        normProdCat === normalizedSelectedCat ||
        normalizedSelectedCat.includes(normProdCat) ||
        normProdCat.includes(normalizedSelectedCat);
      if (!matchesCategory) {
        return false;
      }
    }
    if (options.inStockOnly && product.stock <= 0) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = normalizeVietnameseText(
      `${product.name} ${product.sku} ${product.barcode ?? ''} ${product.brand ?? ''} ${product.category} ${product.categoryLabel} ${product.notes ?? ''} ${product.description}`,
    );
    return haystack.includes(normalizedQuery);
  });

  return [...filtered].sort((a, b) => {
    if (options.sortBy === 'name-asc') {
      return a.name.localeCompare(b.name, 'vi');
    }
    if (options.sortBy === 'price-asc') {
      return a.price - b.price;
    }
    if (options.sortBy === 'price-desc') {
      return b.price - a.price;
    }
    return a.popularRank - b.popularRank;
  });
}

export interface CartSummary {
  itemCount: number;
  subtotal: number;
  shippingFee: number;
  total: number;
  amountToFreeShip: number;
  freeShipProgress: number;
}

export function calculateCartSummary(
  items: CartItem[],
  _deliveryMethod: DeliveryMethod,
): CartSummary {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );

  return {
    itemCount,
    subtotal,
    shippingFee: 0,
    total: subtotal,
    amountToFreeShip: 0,
    freeShipProgress: 100,
  };
}

export interface ValidateCheckoutOptions {
  allowEmptyPhone?: boolean;
}

export function validateCheckoutForm(
  form: CheckoutFormData,
  options: ValidateCheckoutOptions = {},
): CheckoutErrors {
  const errors: CheckoutErrors = {};
  const cleanPhone = form.phone.replace(/[\s.-]/g, '');
  const trimmedAddress = form.address.trim();

  if (cleanPhone.length === 0) {
    if (!options.allowEmptyPhone) {
      errors.phone = 'Số điện thoại cần bắt đầu bằng 0 và gồm 10–11 chữ số.';
    }
  } else if (!/^0\d{9,10}$/.test(cleanPhone)) {
    errors.phone = 'Số điện thoại cần bắt đầu bằng 0 và gồm 10–11 chữ số.';
  }

  if (form.deliveryMethod === 'delivery' && trimmedAddress.length < 4) {
    errors.address = 'Vui lòng nhập địa chỉ giao hàng (tòa nhà, số căn hộ hoặc tên đường).';
  }

  return errors;
}

export function generateOrderCode(now: Date = new Date()): string {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `DH-${hh}${mm}-${rand}`;
}

export const GUEST_CHECKOUT_STORAGE_KEY = 'vpp_huong_long_guest_checkout_v1';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSavedGuestCheckout(
  storage: StorageLike | null = getDefaultStorage(),
): import('../types/shop').SavedGuestCheckoutInfo | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GUEST_CHECKOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<
      import('../types/shop').SavedGuestCheckoutInfo
    >;
    if (!parsed || typeof parsed !== 'object') return null;
    const customerName =
      typeof parsed.customerName === 'string' ? parsed.customerName.trim() : '';
    const phone = typeof parsed.phone === 'string' ? parsed.phone.trim() : '';
    const address =
      typeof parsed.address === 'string' ? parsed.address.trim() : '';
    const deliveryMethod: DeliveryMethod =
      parsed.deliveryMethod === 'pickup' ? 'pickup' : 'delivery';

    if (!customerName && !phone && !address && deliveryMethod === 'delivery') {
      return null;
    }

    return {
      customerName,
      deliveryMethod,
      phone,
      address,
    };
  } catch {
    return null;
  }
}

export function saveGuestCheckout(
  info: import('../types/shop').SavedGuestCheckoutInfo,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    const sanitized: import('../types/shop').SavedGuestCheckoutInfo = {
      customerName: info.customerName.trim(),
      deliveryMethod: info.deliveryMethod === 'pickup' ? 'pickup' : 'delivery',
      phone: info.phone.replace(/[\s.-]/g, '').trim(),
      address: info.address.trim(),
    };
    storage.setItem(GUEST_CHECKOUT_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearSavedGuestCheckout(
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    if (storage.removeItem) {
      storage.removeItem(GUEST_CHECKOUT_STORAGE_KEY);
    } else {
      storage.setItem(GUEST_CHECKOUT_STORAGE_KEY, '');
    }
  } catch {
    // Ignore storage errors
  }
}

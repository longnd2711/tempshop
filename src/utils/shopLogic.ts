import type {
  CartItem,
  CategoryId,
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

export function formatVnd(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('vi-VN')}₫`;
}

export interface FilterProductsOptions {
  category: CategoryId;
  query: string;
  sortBy: SortOption;
  inStockOnly: boolean;
}

export function filterAndSortProducts(
  products: Product[],
  options: FilterProductsOptions,
): Product[] {
  const normalizedQuery = normalizeVietnameseText(options.query);

  const filtered = products.filter((product) => {
    if (options.category !== 'all' && product.category !== options.category) {
      return false;
    }
    if (options.inStockOnly && product.stock <= 0) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = normalizeVietnameseText(
      `${product.name} ${product.sku} ${product.categoryLabel} ${product.description}`,
    );
    return haystack.includes(normalizedQuery);
  });

  return [...filtered].sort((a, b) => {
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

export function validateCheckoutForm(form: CheckoutFormData): CheckoutErrors {
  const errors: CheckoutErrors = {};
  const cleanPhone = form.phone.replace(/[\s.-]/g, '');
  const trimmedAddress = form.address.trim();

  if (!/^0\d{9,10}$/.test(cleanPhone)) {
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

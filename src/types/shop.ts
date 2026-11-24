export type CategoryId = 'all' | 'stationery' | 'school' | 'toys' | 'grocery';

export type SortOption = 'popular' | 'price-asc' | 'price-desc';

export type DeliveryMethod = 'delivery' | 'pickup';

export type PaymentMethod = 'cod' | 'transfer';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: Exclude<CategoryId, 'all'>;
  categoryLabel: string;
  price: number;
  unit: string;
  stock: number;
  popularRank: number;
  variants: string[];
  image: string;
  imageFocusClass?: string;
  description: string;
  featuredTag?: string;
}

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  categoryLabel: string;
  unit: string;
  variant: string;
  unitPrice: number;
  quantity: number;
  image: string;
}

export interface BundlePack {
  id: string;
  title: string;
  subtitle: string;
  audience: string;
  items: { productId: string; quantity: number }[];
  bundlePrice: number;
  originalPrice: number;
}

export interface CheckoutFormData {
  customerName: string;
  phone: string;
  address: string;
  note: string;
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
}

export interface CheckoutErrors {
  customerName?: string;
  phone?: string;
  address?: string;
}

export interface OrderRecord {
  orderCode: string;
  createdAt: string;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
  items: CartItem[];
  subtotal: number;
  shippingFee: number;
  total: number;
}

export type CategoryId = string;

export type SortOption = 'name-asc' | 'price-asc' | 'price-desc' | 'popular';

export type DeliveryMethod = 'delivery' | 'pickup';

export type PaymentMethod = 'cod' | 'transfer';

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  brand?: string;
  category: string;
  categoryLabel: string;
  price: number;
  costPrice?: number;
  unit: string;
  baseUnit?: string;
  conversionRate?: number;
  stock: number;
  minStock?: number;
  maxStock?: number;
  popularRank: number;
  variants: string[];
  image: string;
  images?: string[];
  imageFocusClass?: string;
  description: string;
  notes?: string;
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

export interface BundleItemEntry {
  productId: string;
  quantity: number;
  productName?: string;
  productPrice?: number;
  productUnit?: string;
  productImage?: string;
  productSku?: string;
}

export interface BundlePack {
  id: string;
  comboCode: string;
  title: string;
  subtitle: string;
  audience?: string;
  items: BundleItemEntry[];
  discountAmount: number;
  bundlePrice: number;
  originalPrice: number;
  isActive?: boolean;
  image?: string;
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

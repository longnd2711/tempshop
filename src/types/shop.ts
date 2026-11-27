export type CategoryId = string;

export type SortOption = 'name-asc' | 'price-asc' | 'price-desc' | 'popular';

export type DeliveryMethod = 'delivery' | 'pickup';

export type PaymentMethod = 'cod' | 'transfer';

export type OrderLifecycleStatus =
  | 'pending'
  | 'confirmed'
  | 'shipping'
  | 'completed'
  | 'cancelled';

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  brand?: string;
  category: string;
  categoryLabel: string;
  categoryId?: string | null;
  categorySlug?: string;
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
  isActive?: boolean;
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
  id?: string;
  orderCode: string;
  customerId?: string | null;
  createdAt: string;
  createdAtIso?: string;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
  items: CartItem[];
  subtotal: number;
  discountAmount?: number;
  shippingFee: number;
  total: number;
  status?: OrderLifecycleStatus;
  isConfirmed: boolean;
  isPaid: boolean;
  confirmedAt?: string | null;
  paidAt?: string | null;
  syncedToSupabase?: boolean;
}

export interface PosDraftTab {
  id: string;
  label: string;
  orderCode: string;
  items: CartItem[];
  customerId?: string | null;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
  discountPercent: number;
  discountAmount: number;
  createdAtIso: string;
}

export type UserRole = 'staff' | 'manager' | 'admin';

export type AdminTab =
  | 'orders'
  | 'customers'
  | 'products'
  | 'purchases'
  | 'users';

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  notes?: string;
  role: UserRole;
}

export interface UserProfileRecord {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
  notes: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string;
}

export interface SavedGuestCheckoutInfo {
  customerName: string;
  deliveryMethod: DeliveryMethod;
  phone: string;
  address: string;
}

export type RevenuePeriodMode =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'custom';

export type RevenueGranularity = 'hour' | 'day' | 'month';

export interface RevenueChartBucket {
  key: string;
  label: string;
  fullLabel: string;
  revenue: number;
  orderCount: number;
}

export interface RevenueChartSummary {
  mode: RevenuePeriodMode;
  granularity: RevenueGranularity;
  rangeLabel: string;
  buckets: RevenueChartBucket[];
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  maxBucketRevenue: number;
  customRangeInvalid?: boolean;
}

export interface CustomerRecord {
  id: string;
  phone: string;
  fullName: string;
  defaultAddress: string;
  notes: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: string;
  lastOrderAtIso?: string;
}

export interface PurchaseOrderItem {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  unitLabel: string;
  conversionFactor: number;
  quantity: number;
  unitCost: number;
  discountPercent: number;
  discountAmount: number;
  netUnitCost: number;
  sellingPrice?: number;
  lineTotal: number;
  isNewProduct?: boolean;
  newProductCategoryId?: string | null;
  newProductBarcode?: string;
  newProductBrand?: string;
  newProductBaseUnit?: string;
  newProductUnit?: string;
  newProductConversionRate?: number;
  newProductImageUrls?: string[];
}

export interface PurchaseOrderRecord {
  id?: string;
  poCode: string;
  supplierName: string;
  note: string;
  totalAmount: number;
  itemCount: number;
  createdByEmail: string;
  importedAt: string;
  importedAtIso?: string;
  items: PurchaseOrderItem[];
}

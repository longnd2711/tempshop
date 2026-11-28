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

export interface PurchasePackOption {
  label: string;
  factor: number;
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
  orderedQuantity?: number;
  purchasePackOptions?: PurchasePackOption[];
  minStock?: number | null;
  maxStock?: number | null;
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

export interface ExtraFeeItem {
  label: string;
  amount: number;
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
  extraFees?: ExtraFeeItem[];
  extraFeeTotal?: number;
  paidAmount?: number;
  total: number;
  status?: OrderLifecycleStatus;
  isConfirmed: boolean;
  isDelivered: boolean;
  isPaid: boolean;
  confirmedAt?: string | null;
  deliveredAt?: string | null;
  paidAt?: string | null;
  syncedToSupabase?: boolean;
}

export interface PosDraftTab {
  id: string;
  label: string;
  orderCode: string;
  sourceOrderId?: string | null;
  sourceOrderCode?: string | null;
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
  extraFees?: ExtraFeeItem[];
  isConfirmed?: boolean;
  isDelivered?: boolean;
  isPaid?: boolean;
  createdAtIso: string;
}

export type UserRole = 'staff' | 'manager' | 'admin';

export type AdminTab =
  | 'orders'
  | 'customers'
  | 'products'
  | 'purchases'
  | 'cashbook'
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
  matchedQuantity?: number;
  customRangeInvalid?: boolean;
}

export type ProductStockFilter = 'all' | 'below-min' | 'out-of-stock';

export type CustomerGroup =
  | 'Khách lẻ'
  | 'Cơ quan - Trường học'
  | 'Khách sỉ'
  | string;

export interface CustomerRecord {
  id: string;
  phone: string;
  fullName: string;
  defaultAddress: string;
  area?: string | null;
  customerGroup?: CustomerGroup | null;
  taxCode?: string | null;
  bankAccount?: string | null;
  bankName?: string | null;
  email?: string | null;
  creditLimit?: number | null;
  notes: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: string;
  lastOrderAtIso?: string;
}

export interface SupplierRecord {
  id: string;
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
  createdAt?: string;
  updatedAt?: string;
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
  supplierId?: string | null;
  supplierName: string;
  note: string;
  extraFees?: ExtraFeeItem[];
  extraFeeTotal?: number;
  paidAmount?: number;
  isPaid?: boolean;
  totalAmount: number;
  itemCount: number;
  createdByEmail: string;
  importedAt: string;
  importedAtIso?: string;
  items: PurchaseOrderItem[];
}

export type CashVoucherType = 'receipt' | 'payment';

export type CashVoucherCategory =
  | 'customer_debt'
  | 'sales_income'
  | 'supplier_refund'
  | 'other_income'
  | 'supplier_debt'
  | 'purchase_expense'
  | 'shipping_fee'
  | 'operating_expense'
  | 'customer_refund'
  | 'other_expense';

export type CashVoucherPaymentMethod = 'cash' | 'transfer' | 'cod';

export interface CashVoucherRecord {
  id: string;
  voucherCode: string;
  voucherType: CashVoucherType;
  category: CashVoucherCategory;
  amount: number;
  paymentMethod: CashVoucherPaymentMethod | string;
  customerId?: string | null;
  supplierId?: string | null;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  relatedCode: string;
  counterpartyName: string;
  note: string;
  voucherDate: string;
  voucherDateIso?: string;
  createdByEmail: string;
  createdAt?: string;
}

export interface QuickVoucherDraft {
  voucherType: CashVoucherType;
  category: CashVoucherCategory;
  amount?: number;
  paymentMethod?: CashVoucherPaymentMethod;
  customerId?: string | null;
  supplierId?: string | null;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  relatedCode?: string;
  counterpartyName?: string;
  note?: string;
}

export interface CustomerDebtSummary {
  customerId: string;
  totalOrderAmount: number;
  totalPaidAmount: number;
  debtAmount: number;
  unpaidOrderCount: number;
  overCreditLimit: boolean;
}

export interface SupplierDebtSummary {
  supplierId: string;
  totalPurchaseAmount: number;
  totalPaidAmount: number;
  debtAmount: number;
  unpaidPoCount: number;
}

export interface CashbookSummary {
  totalReceipts: number;
  totalPayments: number;
  netCashflow: number;
  totalReceivable: number;
  totalPayable: number;
  operatingAndExtraExpenses: number;
}

export interface BundlePackItem {
  productId: string;
  productName?: string;
  quantity: number;
}

export interface BundlePack {
  id: string;
  comboCode: string;
  title: string;
  subtitle: string;
  image?: string;
  discountAmount: number;
  bundlePrice: number;
  originalPrice: number;
  items: BundlePackItem[];
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  clearSavedGuestCheckout,
  extractCategories,
  extractTopCategories,
  filterAndSortProducts,
  formatVnd,
  loadSavedGuestCheckout,
  normalizeVietnameseText,
  resolveMatchingCategory,
  saveGuestCheckout,
  validateCheckoutForm,
} from './shopLogic';
import { buildVietQrImageUrl, buildVietQrPayload } from './vietqr';
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  isCatalogCacheStale,
  loadCachedCatalog,
  mapSupabaseRowToCategory,
  mapSupabaseRowToProduct,
  normalizeGoogleDriveImageUrl,
  normalizeVndPrice,
  parseImageUrls,
  saveCachedCatalog,
} from '../lib/supabaseProducts';
import {
  filterOrders,
  isValidUuid,
  loadStoredOrders,
  mapSupabaseOrderRow,
  mergeOrders,
  normalizeOrderRecord,
  saveStoredOrders,
} from '../lib/supabaseOrders';
import {
  mapSupabaseCustomerRow,
  mapSupabasePurchaseOrderRow,
  mapSupabaseUserProfileRow,
} from '../lib/supabaseAdmin';
import {
  buildRevenueChartData,
  calculatePurchaseSummary,
  canAccessAdminTab,
  canManageInventory,
  canManageUsers,
  computePurchaseLineTotal,
  getAllowedAdminTabs,
  getYesterdayEveningPreset,
  parseAdminRouteFromHash,
  parseImageUrlsInput,
  resolveAllowedAdminTab,
  slugifyVietnamese,
  syncDiscountFromAmount,
  syncDiscountFromPercent,
} from './adminLogic';
import {
  buildDriveSyncPlan,
  buildProductImageFilename,
  buildSupabaseScanPlan,
  classifyProductImageSyncState,
  computeRenamedStorageMoves,
  extractSupabaseStoragePathFromUrl,
  IMAGE_SYNC_BATCH_SIZE,
  matchImageFilesToProducts,
  parseGoogleDriveFileId,
  parseGoogleDriveFolderId,
  parseImageFilename,
  sanitizeSkuForFilename,
  type ScannableImageFile,
} from './imageSyncLogic';
import {
  addPosItemToDraft,
  analyzePosQtyInputChange,
  buildOrderRecordFromPosTab,
  calculatePosOrderTotals,
  closePosTab,
  createNewPosTab,
  findExactProductByCode,
  formatPosTabDisplayTitle,
  loadPosTabsState,
  POS_TABS_STORAGE_KEY,
  resolvePosQtyInputCommit,
  savePosTabsState,
  searchPosProducts,
  setPosItemQuantity,
  syncOrderDiscountFromAmount,
  syncOrderDiscountFromPercent,
} from './posLogic';
import type { CartItem, CategoryNode, OrderRecord, Product } from '../types/shop';

const sampleProducts: Product[] = [
  {
    id: 'p1',
    sku: 'VPP-001',
    name: 'Vở ô ly 96 trang giấy dày',
    brand: 'Hồng Hà',
    category: 'Đồ dùng học sinh',
    categoryLabel: 'Đồ dùng học sinh',
    price: 12000,
    unit: 'Quyển',
    stock: 0,
    popularRank: 2,
    variants: ['4 ô ly', '5 ô ly'],
    image: '/img2.jpg',
    description: 'Giấy chống lóa',
  },
  {
    id: 'p2',
    sku: 'VPP-002',
    name: 'Bút gel mực xanh 0.5mm',
    brand: 'Thiên Long',
    category: 'Văn phòng phẩm',
    categoryLabel: 'Văn phòng phẩm',
    price: 8000,
    unit: 'Cây',
    stock: 40,
    popularRank: 1,
    variants: ['Mực xanh', 'Mực đen'],
    image: '/img1.jpg',
    description: 'Bút gel viết êm',
  },
  {
    id: 'p3',
    sku: 'DC-003',
    name: 'Khối xếp hình gỗ tự nhiên',
    category: 'Đồ chơi Quà tặng',
    categoryLabel: 'Đồ chơi Quà tặng',
    price: 95000,
    unit: 'Bộ',
    stock: 8,
    popularRank: 3,
    variants: ['48 chi tiết'],
    image: '/img3.jpg',
    description: 'An toàn cho bé',
  },
];

test('normalizeVietnameseText strips accents and Đ/đ cleanly', () => {
  assert.equal(normalizeVietnameseText('Vở ô ly Đẹp'), 'vo o ly dep');
  assert.equal(normalizeVietnameseText('Đồ dùng học sinh'), 'do dung hoc sinh');
});

test('extractCategories and resolveMatchingCategory extract actual unique categories', () => {
  const categories = extractCategories(sampleProducts);
  assert.deepEqual(categories, [
    'Đồ dùng học sinh',
    'Văn phòng phẩm',
    'Đồ chơi Quà tặng',
  ]);
  assert.equal(
    resolveMatchingCategory('Đồ chơi & Quà tặng', categories),
    'Đồ chơi Quà tặng',
  );
  assert.equal(
    resolveMatchingCategory('Văn phòng phẩm', categories),
    'Văn phòng phẩm',
  );
});

test('filterAndSortProducts supports Vietnamese query, dynamic categories, and name-asc/price sorting', () => {
  const searchResult = filterAndSortProducts(sampleProducts, {
    category: 'all',
    query: 'thien long',
    sortBy: 'name-asc',
    inStockOnly: false,
  });
  assert.equal(searchResult.length, 1);
  assert.equal(searchResult[0].id, 'p2');

  const sortedByName = filterAndSortProducts(sampleProducts, {
    category: 'all',
    query: '',
    sortBy: 'name-asc',
    inStockOnly: false,
  });
  assert.deepEqual(
    sortedByName.map((p) => p.id),
    ['p2', 'p3', 'p1'],
  );

  const sortedByPriceDesc = filterAndSortProducts(sampleProducts, {
    category: 'all',
    query: '',
    sortBy: 'price-desc',
    inStockOnly: true,
  });
  assert.deepEqual(
    sortedByPriceDesc.map((p) => p.id),
    ['p3', 'p2'],
  );
});

test('calculateCartSummary computes subtotal and total accurately', () => {
  const item: CartItem = {
    productId: 'p3',
    sku: 'DC-003',
    name: 'Khối xếp hình',
    categoryLabel: 'Đồ chơi',
    unit: 'Bộ',
    variant: '48 chi tiết',
    unitPrice: 95000,
    quantity: 2,
    image: '/img3.jpg',
  };

  const summary = calculateCartSummary([item], 'delivery');
  assert.equal(summary.subtotal, 190000);
  assert.equal(summary.shippingFee, 0);
  assert.equal(summary.total, 190000);
});

test('validateCheckoutForm allows optional customerName and checks phone and address', () => {
  const invalid = validateCheckoutForm({
    customerName: '',
    phone: '12345',
    address: '12',
    note: '',
    deliveryMethod: 'delivery',
    paymentMethod: 'cod',
  });
  assert.equal(invalid.customerName, undefined);
  assert.ok(invalid.phone);
  assert.ok(invalid.address);

  const validWithoutName = validateCheckoutForm({
    customerName: '',
    phone: '0916319452',
    address: 'CT2.1111 Green Star',
    note: '',
    deliveryMethod: 'delivery',
    paymentMethod: 'transfer',
  });
  assert.deepEqual(validWithoutName, {});

  const validPickup = validateCheckoutForm({
    customerName: '',
    phone: '0912345678',
    address: '',
    note: '',
    deliveryMethod: 'pickup',
    paymentMethod: 'transfer',
  });
  assert.deepEqual(validPickup, {});

  const validStaffWalkIn = validateCheckoutForm(
    {
      customerName: 'Khách lẻ',
      phone: '',
      address: 'Tại quầy',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
    },
    { allowEmptyPhone: true },
  );
  assert.deepEqual(validStaffWalkIn, {});

  const invalidStaffTypedPhone = validateCheckoutForm(
    {
      customerName: 'Khách lẻ',
      phone: '123',
      address: 'Tại quầy',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
    },
    { allowEmptyPhone: true },
  );
  assert.ok(invalidStaffTypedPhone.phone);
});

test('buildVietQrPayload encodes VIB account, exact amount, and order ID with CRC', () => {
  const payload = buildVietQrPayload({
    accountNumber: '916219452',
    amount: 162000,
    orderId: 'DH-2015-408',
  });
  assert.ok(payload.includes('970441'));
  assert.ok(payload.includes('916219452'));
  assert.ok(payload.includes('5406162000'));
  assert.ok(payload.includes('DH-2015-408'));
  assert.match(payload, /6304[0-9A-F]{4}$/);
});

test('buildVietQrImageUrl formats official VietQR compact2 image URL with Nguyễn Thu Hương', () => {
  const url = buildVietQrImageUrl({
    accountNumber: '916219452',
    amount: 135000,
    orderId: 'DH-0542-123',
    accountName: 'Nguyễn Thu Hương',
  });
  assert.ok(
    url.startsWith('https://img.vietqr.io/image/970441-916219452-compact2.png?'),
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('amount'), '135000');
  assert.equal(parsed.searchParams.get('addInfo'), 'DH-0542-123');
  assert.equal(parsed.searchParams.get('accountName'), 'Nguyễn Thu Hương');
});

test('normalizeGoogleDriveImageUrl converts share links into direct thumbnail URLs', () => {
  assert.equal(
    normalizeGoogleDriveImageUrl(
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing',
    ),
    'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w800',
  );
  assert.equal(
    normalizeGoogleDriveImageUrl('https://drive.google.com/open?id=XYZ987'),
    'https://drive.google.com/thumbnail?id=XYZ987&sz=w800',
  );
});

test('parseImageUrls splits comma-separated KiotViet image URLs and normalizeVndPrice scales thousand-based prices', () => {
  const urls = parseImageUrls(
    'https://cdn2-retail-images.kiotviet.vn/a.jpg,https://cdn2-retail-images.kiotviet.vn/b.jpeg',
  );
  assert.deepEqual(urls, [
    'https://cdn2-retail-images.kiotviet.vn/a.jpg',
    'https://cdn2-retail-images.kiotviet.vn/b.jpeg',
  ]);
  assert.equal(normalizeVndPrice(15), 15000);
  assert.equal(normalizeVndPrice(125), 125000);
  assert.equal(normalizeVndPrice(15000), 15000);
});

test('mapSupabaseRowToProduct maps exact Supabase products columns and allows stock <= 0', () => {
  const mapped = mapSupabaseRowToProduct(
    {
      id: 'uuid-101',
      category: 'Văn phòng phẩm',
      sku: 'vpp-99',
      barcode: '8935001234567',
      name: 'Bút bi Thiên Long TL-027',
      brand: 'Thiên Long',
      selling_price: 5500,
      cost_price: 3800,
      stock_quantity: 0,
      min_stock: 10,
      max_stock: 200,
      unit: 'Cây',
      base_unit: 'Cây',
      conversion_rate: 1,
      image_url: 'https://drive.google.com/file/d/FILE123/view',
      notes: 'Mực xanh nét 0.5mm',
    },
    0,
  );
  assert.equal(mapped.id, 'uuid-101');
  assert.equal(mapped.sku, 'VPP-99');
  assert.equal(mapped.barcode, '8935001234567');
  assert.equal(mapped.brand, 'Thiên Long');
  assert.equal(mapped.category, 'Văn phòng phẩm');
  assert.equal(mapped.price, 5500);
  assert.equal(mapped.costPrice, 3800);
  assert.equal(mapped.stock, 0);
  assert.equal(mapped.minStock, 10);
  assert.equal(mapped.maxStock, 200);
  assert.equal(mapped.baseUnit, 'Cây');
  assert.equal(mapped.conversionRate, 1);
  assert.equal(mapped.notes, 'Mực xanh nét 0.5mm');
  assert.equal(
    mapped.image,
    'https://drive.google.com/thumbnail?id=FILE123&sz=w800',
  );
});

test('supabaseOrders validates UUIDs, maps rows, merges, stores, and filters orders cleanly', () => {
  assert.equal(isValidUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid(null), false);

  const normalized = normalizeOrderRecord({
    orderCode: 'DH-1001-001',
    phone: '0916319452',
    total: 45000,
  });
  assert.equal(normalized.deliveryMethod, 'delivery');
  assert.equal(normalized.paymentMethod, 'transfer');
  assert.equal(normalized.isConfirmed, false);
  assert.equal(normalized.isPaid, false);

  const mapped = mapSupabaseOrderRow(
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      order_code: 'DH-2002-002',
      customer_name: 'Chị Lan',
      phone: '0912345678',
      delivery_method: 'pickup',
      address: 'Nhận tại CT2.1111',
      note: 'Gói kỹ',
      payment_method: 'transfer',
      subtotal: 80000,
      shipping_fee: 0,
      total_amount: 80000,
      is_confirmed: true,
      is_paid: false,
      created_at: '2026-05-01T12:00:00.000Z',
    },
    [
      {
        id: 'item-1',
        order_id: '550e8400-e29b-41d4-a716-446655440000',
        product_id: 'p1',
        sku: 'VPP-001',
        product_name: 'Vở ô ly 96 trang',
        variant: '4 ô ly',
        unit: 'Quyển',
        unit_price: 10000,
        quantity: 8,
        image_url: '/img2.jpg',
      },
    ],
  );
  assert.equal(mapped.orderCode, 'DH-2002-002');
  assert.equal(mapped.isConfirmed, true);
  assert.equal(mapped.isPaid, false);
  assert.equal(mapped.items.length, 1);
  assert.equal(mapped.items[0].quantity, 8);

  const localOnly: OrderRecord = {
    ...normalized,
    createdAtIso: '2026-05-02T08:00:00.000Z',
    isConfirmed: false,
    isPaid: true,
  };
  const merged = mergeOrders([mapped], [localOnly, mapped]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].orderCode, 'DH-1001-001');

  const memoryStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memoryStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStore.set(k, v);
    },
  };
  saveStoredOrders(merged, mockStorage);
  assert.equal(loadStoredOrders(mockStorage).length, 2);

  const confirmedOnly = filterOrders(merged, {
    query: '',
    confirmFilter: 'confirmed',
    payFilter: 'all',
  });
  assert.deepEqual(
    confirmedOnly.map((o) => o.orderCode),
    ['DH-2002-002'],
  );

  const paidSearch = filterOrders(merged, {
    query: '0916319452',
    confirmFilter: 'all',
    payFilter: 'paid',
  });
  assert.deepEqual(
    paidSearch.map((o) => o.orderCode),
    ['DH-1001-001'],
  );
});

test('offline catalog cache saves, loads, and checks 10-minute staleness', () => {
  const memoryStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memoryStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStore.set(k, v);
    },
  };

  assert.equal(loadCachedCatalog(mockStorage), null);

  const now = 1_700_000_000_000;
  saveCachedCatalog(
    {
      products: sampleProducts,
      syncedAt: now,
      source: 'supabase',
    },
    mockStorage,
  );

  const loaded = loadCachedCatalog(mockStorage);
  assert.ok(loaded);
  assert.equal(loaded.products.length, 3);
  assert.equal(loaded.source, 'supabase');
  assert.equal(isCatalogCacheStale(loaded.syncedAt, now + 5 * 60 * 1000), false);
  assert.equal(
    isCatalogCacheStale(loaded.syncedAt, now + BACKGROUND_SYNC_INTERVAL_MS),
    true,
  );
});

test('formatVnd formats Vietnamese dong cleanly', () => {
  assert.equal(formatVnd(150000), '150.000₫');
  assert.equal(formatVnd(8000), '8.000₫');
});

test('multi-level categoryTree filters parent category to include child categories and maps public_products image_urls', () => {
  const catParent = mapSupabaseRowToCategory(
    {
      id: 'cat-root-1',
      name: 'Đồ dùng học sinh',
      slug: 'do-dung-hoc-sinh',
      parent_id: null,
      sort_order: 1,
      is_active: true,
    },
    0,
  );
  const catChild = mapSupabaseRowToCategory(
    {
      id: 'cat-child-1',
      name: 'Vở ô ly',
      slug: 'vo-o-ly',
      parent_id: 'cat-root-1',
      sort_order: 2,
      is_active: true,
    },
    1,
  );
  const catOther = mapSupabaseRowToCategory(
    {
      id: 'cat-root-2',
      name: 'Văn phòng phẩm',
      slug: 'van-phong-pham',
      parent_id: null,
      sort_order: 2,
      is_active: true,
    },
    2,
  );
  const tree: CategoryNode[] = [catParent, catChild, catOther];

  const mappedPublicProduct = mapSupabaseRowToProduct(
    {
      id: 'prod-1',
      category_id: 'cat-child-1',
      category_name: 'Vở ô ly',
      category_slug: 'vo-o-ly',
      sku: 'VO-01',
      name: 'Vở 4 ô ly Hồng Hà',
      selling_price: 12000,
      stock_quantity: 20,
      unit: 'Quyển',
      image_urls: [
        'https://drive.google.com/file/d/ABC123/view',
        'https://cdn2-retail-images.kiotviet.vn/extra.jpg',
      ],
    },
    0,
  );
  assert.equal(mappedPublicProduct.categoryId, 'cat-child-1');
  assert.equal(mappedPublicProduct.category, 'Vở ô ly');
  assert.equal(
    mappedPublicProduct.image,
    'https://drive.google.com/thumbnail?id=ABC123&sz=w800',
  );
  assert.equal(mappedPublicProduct.images?.length, 2);

  const topTabs = extractTopCategories([mappedPublicProduct], tree);
  assert.deepEqual(topTabs, ['Đồ dùng học sinh', 'Văn phòng phẩm']);

  const parentMatch = filterAndSortProducts([mappedPublicProduct, sampleProducts[1]], {
    category: 'Đồ dùng học sinh',
    query: '',
    sortBy: 'name-asc',
    inStockOnly: false,
    categoryTree: tree,
  });
  assert.deepEqual(
    parentMatch.map((p) => p.id),
    ['prod-1'],
  );
});

test('RBAC adminLogic grants admin full access, manager inventory+orders without users, and staff orders+customers only', () => {
  assert.equal(canAccessAdminTab(null, 'orders'), false);
  assert.equal(canAccessAdminTab('staff', 'orders'), true);
  assert.equal(canAccessAdminTab('staff', 'customers'), true);
  assert.equal(canAccessAdminTab('staff', 'products'), false);
  assert.equal(canAccessAdminTab('staff', 'purchases'), false);
  assert.equal(canAccessAdminTab('staff', 'users'), false);

  assert.equal(canAccessAdminTab('manager', 'orders'), true);
  assert.equal(canAccessAdminTab('manager', 'customers'), true);
  assert.equal(canAccessAdminTab('manager', 'products'), true);
  assert.equal(canAccessAdminTab('manager', 'purchases'), true);
  assert.equal(canAccessAdminTab('manager', 'users'), false);

  assert.equal(canAccessAdminTab('admin', 'orders'), true);
  assert.equal(canAccessAdminTab('admin', 'customers'), true);
  assert.equal(canAccessAdminTab('admin', 'products'), true);
  assert.equal(canAccessAdminTab('admin', 'purchases'), true);
  assert.equal(canAccessAdminTab('admin', 'users'), true);

  assert.equal(canManageInventory('staff'), false);
  assert.equal(canManageInventory('manager'), true);
  assert.equal(canManageInventory('admin'), true);

  assert.equal(canManageUsers('staff'), false);
  assert.equal(canManageUsers('manager'), false);
  assert.equal(canManageUsers('admin'), true);

  assert.deepEqual(getAllowedAdminTabs('staff'), ['orders', 'customers']);
  assert.deepEqual(getAllowedAdminTabs('manager'), [
    'orders',
    'customers',
    'products',
    'purchases',
  ]);
  assert.deepEqual(getAllowedAdminTabs('admin'), [
    'orders',
    'customers',
    'products',
    'purchases',
    'users',
  ]);

  assert.equal(resolveAllowedAdminTab('staff', 'products'), 'orders');
  assert.equal(resolveAllowedAdminTab('staff', 'purchases'), 'orders');
  assert.equal(resolveAllowedAdminTab('staff', 'users'), 'orders');
  assert.equal(resolveAllowedAdminTab('staff', 'customers'), 'customers');
  assert.equal(resolveAllowedAdminTab('manager', 'products'), 'products');
  assert.equal(resolveAllowedAdminTab('manager', 'purchases'), 'purchases');
  assert.equal(resolveAllowedAdminTab('manager', 'users'), 'orders');
  assert.equal(resolveAllowedAdminTab('admin', 'purchases'), 'purchases');
  assert.equal(resolveAllowedAdminTab('admin', 'users'), 'users');

  assert.deepEqual(parseAdminRouteFromHash('#/admin'), { page: 'admin', tab: 'orders' });
  assert.deepEqual(parseAdminRouteFromHash('#/orders'), { page: 'admin', tab: 'orders' });
  assert.deepEqual(parseAdminRouteFromHash('#/admin/customers'), { page: 'admin', tab: 'customers' });
  assert.deepEqual(parseAdminRouteFromHash('#/admin/products'), { page: 'admin', tab: 'products' });
  assert.deepEqual(parseAdminRouteFromHash('#/admin/purchases'), { page: 'admin', tab: 'purchases' });
  assert.deepEqual(parseAdminRouteFromHash('#/admin/users'), { page: 'admin', tab: 'users' });
  assert.deepEqual(parseAdminRouteFromHash('#catalog'), { page: 'shop', tab: 'orders' });
});

test('bidirectional discount helpers, line total, and calculatePurchaseSummary compute accurately', () => {
  assert.equal(slugifyVietnamese('Đồ dùng học sinh & Vở'), 'do-dung-hoc-sinh-vo');
  assert.deepEqual(
    parseImageUrlsInput('https://a.com/1.jpg\nhttps://b.com/2.jpg, https://c.com/3.jpg;'),
    ['https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg'],
  );

  const fromPct = syncDiscountFromPercent(100000, 15);
  assert.equal(fromPct.discountPercent, 15);
  assert.equal(fromPct.discountAmount, 15000);
  assert.equal(fromPct.netUnitCost, 85000);

  const fromAmt = syncDiscountFromAmount(80000, 10000);
  assert.equal(fromAmt.discountAmount, 10000);
  assert.equal(fromAmt.discountPercent, 12.5);
  assert.equal(fromAmt.netUnitCost, 70000);

  const line = computePurchaseLineTotal(3, 100000, 15000);
  assert.equal(line.netUnitCost, 85000);
  assert.equal(line.lineTotal, 255000);

  const summary = calculatePurchaseSummary([
    {
      productId: 'p1',
      sku: 'VPP-01',
      productName: 'Vở 96 trang',
      unitLabel: 'Lốc 10',
      conversionFactor: 10,
      quantity: 3,
      unitCost: 100000,
      discountPercent: 15,
      discountAmount: 15000,
      netUnitCost: 85000,
      sellingPrice: 120000,
      lineTotal: 255000,
    },
    {
      productId: 'p2',
      sku: 'VPP-02',
      productName: 'Bút bi xanh',
      unitLabel: 'Hộp 20',
      conversionFactor: 20,
      quantity: 2,
      unitCost: 70000,
      discountPercent: 0,
      discountAmount: 0,
      netUnitCost: 70000,
      sellingPrice: 90000,
      lineTotal: 140000,
    },
  ]);

  assert.equal(summary.itemCount, 2);
  assert.equal(summary.totalQuantity, 5);
  assert.equal(summary.totalGrossAmount, 440000);
  assert.equal(summary.totalDiscountAmount, 45000);
  assert.equal(summary.totalAmount, 395000);
});

test('mapSupabaseCustomerRow and mapSupabasePurchaseOrderRow map fields accurately', () => {
  const customer = mapSupabaseCustomerRow({
    id: 'cust-1',
    phone: '0916319452',
    full_name: 'Chị Hương',
    default_address: 'CT2.1111 Green Star',
    notes: 'Ưu tiên giao sau 20h',
    total_orders: 4,
    total_spent: 520000,
    last_order_at: '2026-06-05T13:00:00.000Z',
  });
  assert.equal(customer.phone, '0916319452');
  assert.equal(customer.notes, 'Ưu tiên giao sau 20h');
  assert.equal(customer.totalOrders, 4);
  assert.equal(customer.totalSpent, 520000);

  const po = mapSupabasePurchaseOrderRow(
    {
      id: 'po-1',
      po_code: 'PN-1000-123',
      supplier_name: 'Tổng kho Hồng Hà',
      note: 'Giao buổi sáng',
      total_amount: 405000,
      item_count: 1,
      created_by_email: 'admin@vpphuonglong.vn',
      imported_at: '2026-06-01T08:30:00.000Z',
    },
    [
      {
        id: 'poi-1',
        purchase_order_id: 'po-1',
        product_id: 'p1',
        sku: 'VPP-001',
        product_name: 'Vở 4 ô ly',
        unit_label: 'Lốc 10',
        conversion_factor: 10,
        quantity: 5,
        unit_cost: 90000,
        discount_percent: 10,
        discount_amount: 9000,
        selling_price: 115000,
        line_total: 405000,
      },
      {
        id: 'poi-other',
        purchase_order_id: 'po-999',
        product_id: 'p2',
        sku: 'OTHER',
        product_name: 'Other',
      },
    ],
  );

  assert.equal(po.poCode, 'PN-1000-123');
  assert.equal(po.supplierName, 'Tổng kho Hồng Hà');
  assert.equal(po.totalAmount, 405000);
  assert.equal(po.items.length, 1);
  assert.equal(po.items[0].discountPercent, 10);
  assert.equal(po.items[0].discountAmount, 9000);
  assert.equal(po.items[0].netUnitCost, 81000);
  assert.equal(po.items[0].sellingPrice, 115000);
  assert.equal(po.items[0].lineTotal, 405000);

  const userProfile = mapSupabaseUserProfileRow({
    user_id: 'u-1',
    email: 'huong@vpphuonglong.vn',
    full_name: 'Nguyễn Thu Hương',
    phone: '0916319452',
    notes: 'Chủ shop phụ trách nhập hàng',
    role: 'admin',
    created_at: '2026-06-01T08:00:00.000Z',
  });
  assert.equal(userProfile.userId, 'u-1');
  assert.equal(userProfile.phone, '0916319452');
  assert.equal(userProfile.notes, 'Chủ shop phụ trách nhập hàng');
  assert.equal(userProfile.role, 'admin');

  const managerProfile = mapSupabaseUserProfileRow({
    user_id: 'u-2',
    email: 'manager@vpphuonglong.vn',
    full_name: 'Quản lý kho',
    role: 'manager',
  });
  assert.equal(managerProfile.role, 'manager');
});

test('guest checkout info saves, loads, and clears cleanly', () => {
  const memoryStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memoryStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStore.set(k, v);
    },
    removeItem: (k: string) => {
      memoryStore.delete(k);
    },
  };

  assert.equal(loadSavedGuestCheckout(mockStorage), null);

  saveGuestCheckout(
    {
      customerName: 'Chị Mai',
      deliveryMethod: 'delivery',
      phone: '0916.319.452',
      address: 'P1205 CT2 Green Star',
    },
    mockStorage,
  );

  const loaded = loadSavedGuestCheckout(mockStorage);
  assert.deepEqual(loaded, {
    customerName: 'Chị Mai',
    deliveryMethod: 'delivery',
    phone: '0916319452',
    address: 'P1205 CT2 Green Star',
  });

  clearSavedGuestCheckout(mockStorage);
  assert.equal(loadSavedGuestCheckout(mockStorage), null);
});

test('buildRevenueChartData aggregates day, week, month, quarter, year, and custom time ranges accurately', () => {
  const ref = new Date(2026, 10, 26, 21, 0, 0, 0); // 26/11/2026 21:00 local time
  const makeLocalIso = (
    year: number,
    month0: number,
    day: number,
    hour: number,
    minute = 15,
  ) => new Date(year, month0, day, hour, minute, 0, 0).toISOString();

  const sampleOrders: OrderRecord[] = [
    {
      orderCode: 'DH-TODAY-1',
      createdAt: '26/11/2026, 09:15',
      createdAtIso: makeLocalIso(2026, 10, 26, 9, 15),
      customerName: 'Khách A',
      phone: '0911111111',
      address: 'CT2',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
      items: [],
      subtotal: 100000,
      shippingFee: 0,
      total: 100000,
      status: 'confirmed',
      isConfirmed: true,
      isPaid: true,
    },
    {
      orderCode: 'DH-TODAY-2',
      createdAt: '26/11/2026, 20:10',
      createdAtIso: makeLocalIso(2026, 10, 26, 20, 10),
      customerName: 'Khách B',
      phone: '0922222222',
      address: 'CT1',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
      items: [],
      subtotal: 50000,
      shippingFee: 0,
      total: 50000,
      status: 'pending',
      isConfirmed: false,
      isPaid: false,
    },
    {
      orderCode: 'DH-TODAY-CANCELLED',
      createdAt: '26/11/2026, 10:00',
      createdAtIso: makeLocalIso(2026, 10, 26, 10, 0),
      customerName: 'Khách Hủy',
      phone: '0933333333',
      address: 'CT3',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
      items: [],
      subtotal: 999000,
      shippingFee: 0,
      total: 999000,
      status: 'cancelled',
      isConfirmed: false,
      isPaid: false,
    },
    {
      orderCode: 'DH-YESTERDAY-EVENING',
      createdAt: '25/11/2026, 19:30',
      createdAtIso: makeLocalIso(2026, 10, 25, 19, 30),
      customerName: 'Khách C',
      phone: '0944444444',
      address: 'Green Star',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
      items: [],
      subtotal: 220000,
      shippingFee: 0,
      total: 220000,
      status: 'completed',
      isConfirmed: true,
      isPaid: true,
    },
    {
      orderCode: 'DH-YESTERDAY-MORNING',
      createdAt: '25/11/2026, 08:30',
      createdAtIso: makeLocalIso(2026, 10, 25, 8, 30),
      customerName: 'Khách D',
      phone: '0955555555',
      address: 'An Bình',
      note: '',
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
      items: [],
      subtotal: 80000,
      shippingFee: 0,
      total: 80000,
      status: 'completed',
      isConfirmed: true,
      isPaid: true,
    },
  ];

  // Day mode (default): excludes cancelled, includes both paid and unpaid by default
  const dayAll = buildRevenueChartData(sampleOrders, {
    mode: 'day',
    referenceDate: ref,
  });
  assert.equal(dayAll.buckets.length, 24);
  assert.equal(dayAll.totalOrders, 2);
  assert.equal(dayAll.totalRevenue, 150000);
  assert.equal(dayAll.averageOrderValue, 75000);
  assert.equal(dayAll.buckets[9].revenue, 100000);
  assert.equal(dayAll.buckets[20].revenue, 50000);

  // Paid-only filter on day mode
  const dayPaidOnly = buildRevenueChartData(sampleOrders, {
    mode: 'day',
    referenceDate: ref,
    paidOnly: true,
  });
  assert.equal(dayPaidOnly.totalOrders, 1);
  assert.equal(dayPaidOnly.totalRevenue, 100000);

  // Week / Month / Quarter / Year aggregations
  const weekSummary = buildRevenueChartData(sampleOrders, {
    mode: 'week',
    referenceDate: ref,
  });
  assert.equal(weekSummary.buckets.length, 7);
  assert.equal(weekSummary.totalRevenue, 450000);

  const monthSummary = buildRevenueChartData(sampleOrders, {
    mode: 'month',
    referenceDate: ref,
  });
  assert.equal(monthSummary.buckets.length, 30);
  assert.equal(monthSummary.totalRevenue, 450000);

  const quarterSummary = buildRevenueChartData(sampleOrders, {
    mode: 'quarter',
    referenceDate: ref,
  });
  assert.equal(quarterSummary.buckets.length, 3);
  assert.equal(quarterSummary.totalRevenue, 450000);

  const yearSummary = buildRevenueChartData(sampleOrders, {
    mode: 'year',
    referenceDate: ref,
  });
  assert.equal(yearSummary.buckets.length, 12);
  assert.equal(yearSummary.totalRevenue, 450000);

  // Custom preset: 17h-22h yesterday
  const preset = getYesterdayEveningPreset(ref);
  assert.equal(preset.start, '2026-11-25T17:00');
  assert.equal(preset.end, '2026-11-25T22:00');

  const customEvening = buildRevenueChartData(sampleOrders, {
    mode: 'custom',
    referenceDate: ref,
    customStart: preset.start,
    customEnd: preset.end,
  });
  assert.equal(customEvening.customRangeInvalid, false);
  assert.equal(customEvening.granularity, 'hour');
  assert.deepEqual(
    customEvening.buckets.map((b) => b.label),
    ['17h', '18h', '19h', '20h', '21h', '22h'],
  );
  assert.equal(customEvening.totalOrders, 1);
  assert.equal(customEvening.totalRevenue, 220000);
  assert.equal(customEvening.buckets[2].revenue, 220000); // 19h bucket
});

test('SKU image naming builds kt56.jpg and 0_kt56.jpg and parses Drive folder links', () => {
  assert.equal(sanitizeSkuForFilename('kt56'), 'kt56');
  assert.equal(sanitizeSkuForFilename('VPP 01/Đỏ'), 'vpp-01-do');
  assert.equal(buildProductImageFilename('kt56', 0, false), 'kt56.jpg');
  assert.equal(buildProductImageFilename('kt56', 1, false), 'kt56_2.jpg');
  assert.equal(buildProductImageFilename('kt56', 0, true), '0_kt56.jpg');
  assert.equal(buildProductImageFilename('kt56', 2, true), '0_kt56_3.jpg');

  assert.equal(
    parseGoogleDriveFolderId(
      'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWx?usp=sharing',
    ),
    '1AbCdEfGhIjKlMnOpQrStUvWx',
  );
  assert.equal(
    parseGoogleDriveFolderId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp'),
    '1AbCdEfGhIjKlMnOp',
  );
  assert.equal(parseGoogleDriveFolderId('shop_img'), null);
});

test('matchImageFilesToProducts matches SKU files, 0_ originals, and SKUs ending with _2 accurately', () => {
  const catalog: Product[] = [
    {
      ...sampleProducts[0],
      id: 'p-kt56',
      sku: 'kt56',
      name: 'Kéo văn phòng KT56',
    },
    {
      ...sampleProducts[1],
      id: 'p-vpp2',
      sku: 'VPP_2',
      name: 'Bút bi VPP_2',
    },
  ];

  const files: ScannableImageFile[] = [
    { id: '1', name: '0_kt56.png' },
    { id: '2', name: 'kt56.jpg' },
    { id: '3', name: '0_kt56_2.jpg' },
    { id: '4', name: 'VPP_2.jpg' },
    { id: '5', name: 'unknown_sku.jpg' },
    { id: '6', name: 'readme.txt' },
  ];

  const parsedOrig = parseImageFilename('0_kt56.png');
  assert.ok(parsedOrig);
  assert.equal(parsedOrig.isOriginalPrefix, true);
  assert.equal(parsedOrig.stem, 'kt56');

  const scan = matchImageFilesToProducts(files, catalog);
  assert.equal(scan.ignoredFilesCount, 1);
  assert.deepEqual(
    scan.unmatchedFiles.map((f) => f.name),
    ['unknown_sku.jpg'],
  );
  assert.equal(scan.matches.length, 2);

  const kt56Match = scan.matches.find((m) => m.product.id === 'p-kt56');
  assert.ok(kt56Match);
  // Prefers compressed kt56.jpg over 0_kt56.png for slot 0, keeps 0_kt56_2.jpg for slot 1
  assert.deepEqual(
    kt56Match.matchedFiles.map((m) => m.file.name),
    ['kt56.jpg', '0_kt56_2.jpg'],
  );

  const vpp2Match = scan.matches.find((m) => m.product.id === 'p-vpp2');
  assert.ok(vpp2Match);
  assert.deepEqual(
    vpp2Match.matchedFiles.map((m) => m.file.name),
    ['VPP_2.jpg'],
  );
});

test('extractSupabaseStoragePathFromUrl and computeRenamedStorageMoves compute SKU rename moves', () => {
  const url1 =
    'https://demo.supabase.co/storage/v1/object/public/product-images/kt56.jpg?v=12345';
  const url2 =
    'https://demo.supabase.co/storage/v1/object/public/product-images/kt56_2.jpg';
  const externalUrl = 'https://cdn.example.com/other.jpg';

  assert.equal(extractSupabaseStoragePathFromUrl(url1), 'kt56.jpg');
  assert.equal(extractSupabaseStoragePathFromUrl(externalUrl), null);

  const moves = computeRenamedStorageMoves(
    [url1, url2, externalUrl],
    'kt56',
    'kt57',
  );
  assert.deepEqual(moves, [
    { oldPath: 'kt56.jpg', newPath: 'kt57.jpg', oldUrl: url1 },
    { oldPath: 'kt56_2.jpg', newPath: 'kt57_2.jpg', oldUrl: url2 },
  ]);
});

test('POS order totals and bidirectional order-level discount clamp accurately', () => {
  const items = addPosItemToDraft([], sampleProducts[0], '4 ô ly', 2); // 2 * 12,000 = 24,000
  const withSecond = addPosItemToDraft(items, sampleProducts[1], 'Mực xanh', 3); // 3 * 8,000 = 24,000 -> subtotal 48,000

  const byPct = syncOrderDiscountFromPercent(48000, 10);
  assert.equal(byPct.discountPercent, 10);
  assert.equal(byPct.discountAmount, 4800);
  assert.equal(byPct.total, 43200);

  const byAmt = syncOrderDiscountFromAmount(48000, 12000);
  assert.equal(byAmt.discountPercent, 25);
  assert.equal(byAmt.discountAmount, 12000);
  assert.equal(byAmt.total, 36000);

  const clamped = calculatePosOrderTotals(withSecond, 999999);
  assert.equal(clamped.subtotal, 48000);
  assert.equal(clamped.discountAmount, 48000);
  assert.equal(clamped.discountPercent, 100);
  assert.equal(clamped.total, 0);

  const reduced = setPosItemQuantity(withSecond, 'p2', 'Mực xanh', 0);
  assert.equal(reduced.length, 1);
});

test('POS search, barcode match, and keyboard quantity flow handle numbers, Space/Enter=1, and next scan', () => {
  const catalogWithBarcodes: Product[] = [
    { ...sampleProducts[0], barcode: '8935001122334' },
    { ...sampleProducts[1], barcode: '8935009988776' },
    sampleProducts[2],
  ];

  assert.equal(
    findExactProductByCode(catalogWithBarcodes, '8935009988776')?.id,
    'p2',
  );
  assert.equal(
    findExactProductByCode(catalogWithBarcodes, ' vpp-001 ')?.id,
    'p1',
  );

  const searched = searchPosProducts(catalogWithBarcodes, 'but gel');
  assert.equal(searched[0]?.id, 'p2');

  // Empty or space -> defaults to quantity 1
  assert.deepEqual(resolvePosQtyInputCommit(''), { valid: true, quantity: 1 });
  assert.deepEqual(resolvePosQtyInputCommit('   '), { valid: true, quantity: 1 });
  assert.deepEqual(resolvePosQtyInputCommit('15'), { valid: true, quantity: 15 });
  assert.deepEqual(resolvePosQtyInputCommit('2,5'), { valid: true, quantity: 2.5 });
  assert.equal(resolvePosQtyInputCommit('0').valid, false);

  // Typing digits stays in qty input
  assert.deepEqual(analyzePosQtyInputChange('12', catalogWithBarcodes), {
    kind: 'qty',
  });

  // Scanning another barcode in qty box triggers barcode-scan handoff
  const scanRes = analyzePosQtyInputChange('8935009988776', catalogWithBarcodes);
  assert.equal(scanRes.kind, 'barcode-scan');
  if (scanRes.kind === 'barcode-scan') {
    assert.equal(scanRes.product.id, 'p2');
  }

  // Typing letters in qty box commits qty=1 and switches back to product search
  const textRes = analyzePosQtyInputChange('vo', catalogWithBarcodes);
  assert.deepEqual(textRes, { kind: 'switch-to-search', query: 'vo' });
});

test('POS multi-tab state persists, builds discounted orders, and closes cleanly', () => {
  const memory = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };

  const tab1 = createNewPosTab(1);
  tab1.customerName = 'Chị Lan';
  tab1.phone = '0912345678';
  tab1.items = addPosItemToDraft([], sampleProducts[2], '48 chi tiết', 1); // 95,000
  tab1.discountAmount = 5000;
  tab1.discountPercent = 5.26;

  const tab2 = createNewPosTab(2);
  assert.equal(formatPosTabDisplayTitle(tab1, 0), 'Đơn 1 · Chị Lan');
  assert.equal(formatPosTabDisplayTitle(tab2, 1), 'Đơn 2 (Khách lẻ)');

  savePosTabsState([tab1, tab2], tab1.id, mockStorage);
  assert.ok(memory.get(POS_TABS_STORAGE_KEY));

  const reloaded = loadPosTabsState(mockStorage);
  assert.equal(reloaded.tabs.length, 2);
  assert.equal(reloaded.activeTabId, tab1.id);
  assert.equal(reloaded.tabs[0].discountAmount, 5000);

  const builtOrder = buildOrderRecordFromPosTab(reloaded.tabs[0], {
    markConfirmedAndPaid: true,
  });
  assert.equal(builtOrder.subtotal, 95000);
  assert.equal(builtOrder.discountAmount, 5000);
  assert.equal(builtOrder.total, 90000);
  assert.equal(builtOrder.status, 'completed');
  assert.equal(builtOrder.isConfirmed, true);
  assert.equal(builtOrder.isPaid, true);

  const afterCloseOne = closePosTab(reloaded.tabs, tab1.id, tab1.id);
  assert.equal(afterCloseOne.tabs.length, 1);
  assert.equal(afterCloseOne.activeTabId, tab2.id);

  const afterCloseLast = closePosTab(afterCloseOne.tabs, tab2.id, tab2.id);
  assert.equal(afterCloseLast.tabs.length, 1);
  assert.notEqual(afterCloseLast.tabs[0].id, tab2.id);
});

test('classifyProductImageSyncState and parseGoogleDriveFileId distinguish synced Supabase, missing, and external URLs', () => {
  const supabaseUrl =
    'https://demo.supabase.co/storage/v1/object/public/product-images/kt56.jpg?v=123';
  const externalUrl = 'https://cdn.example.com/big-image.png';

  assert.equal(
    classifyProductImageSyncState({ image: '', images: [] }),
    'missing',
  );
  assert.equal(
    classifyProductImageSyncState({ image: supabaseUrl, images: [supabaseUrl] }),
    'synced',
  );
  assert.equal(
    classifyProductImageSyncState({ image: externalUrl, images: [externalUrl] }),
    'external',
  );
  assert.equal(
    classifyProductImageSyncState({
      image: supabaseUrl,
      images: [supabaseUrl, externalUrl],
    }),
    'external',
  );

  assert.equal(
    parseGoogleDriveFileId(
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing',
    ),
    '1AbCdEfGhIjKlMnOpQr',
  );
  assert.equal(
    parseGoogleDriveFileId(
      'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQr',
    ),
    '1AbCdEfGhIjKlMnOpQr',
  );
  // Folder links must NOT be parsed as file IDs
  assert.equal(
    parseGoogleDriveFileId(
      'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQr',
    ),
    null,
  );
});

test('buildDriveSyncPlan skips synced Supabase products, detects 0_ Drive-only & external URLs, and batches by 50', () => {
  assert.equal(IMAGE_SYNC_BATCH_SIZE, 50);
  const supabaseUrl =
    'https://demo.supabase.co/storage/v1/object/public/product-images/synced1.jpg';

  const syncedProduct: Product = {
    ...sampleProducts[0],
    id: 'p-synced',
    sku: 'SYNCED1',
    image: supabaseUrl,
    images: [supabaseUrl],
  };

  const missingWith0DriveOnly: Product = {
    ...sampleProducts[0],
    id: 'p-orig-only',
    sku: 'KT56',
    image: '',
    images: [],
  };

  const missingWithCompressedDrive: Product = {
    ...sampleProducts[0],
    id: 'p-comp-drive',
    sku: 'KT57',
    image: '',
    images: [],
  };

  const externalOnlyProduct: Product = {
    ...sampleProducts[1],
    id: 'p-external',
    sku: 'EXT01',
    image: 'https://vendor.example.com/photo.png',
    images: ['https://vendor.example.com/photo.png'],
  };

  // Generate 62 more missing products with Drive files so total pending > 50
  const extraProducts: Product[] = Array.from({ length: 62 }, (_, i) => ({
    ...sampleProducts[0],
    id: `p-extra-${i + 1}`,
    sku: `EX${String(i + 1).padStart(3, '0')}`,
    image: '',
    images: [],
  }));

  const files: ScannableImageFile[] = [
    { id: 'f-synced', name: 'SYNCED1.jpg' },
    { id: 'f-kt56-orig', name: '0_KT56.jpg' },
    { id: 'f-kt57-comp', name: 'KT57.jpg' },
    ...extraProducts.map((p, i) => ({
      id: `f-extra-${i + 1}`,
      name: `${p.sku}.jpg`,
    })),
  ];

  const catalog = [
    syncedProduct,
    missingWith0DriveOnly,
    missingWithCompressedDrive,
    externalOnlyProduct,
    ...extraProducts,
  ];

  const plan = buildDriveSyncPlan(files, catalog);
  assert.equal(plan.skippedSyncedCount, 1);
  // 2 Drive matched (KT56, KT57) + 62 extra Drive matched + 1 external URL = 65
  assert.equal(plan.allTasks.length, 65);
  assert.equal(plan.driveMatchedCount, 64);
  assert.equal(plan.driveOriginalOnlyCount, 1);
  assert.equal(plan.externalMigrationCount, 1);
  assert.equal(plan.currentBatch.length, 50);
  assert.equal(plan.remainingCount, 15);

  const kt56Task = plan.allTasks.find((t) => t.product.id === 'p-orig-only');
  assert.ok(kt56Task && kt56Task.kind === 'drive-match');
  assert.equal(kt56Task.needsCompressedDriveUpload, true);

  const kt57Task = plan.allTasks.find((t) => t.product.id === 'p-comp-drive');
  assert.ok(kt57Task && kt57Task.kind === 'drive-match');
  assert.equal(kt57Task.needsCompressedDriveUpload, false);

  const extTask = plan.allTasks.find((t) => t.product.id === 'p-external');
  assert.ok(extTask && extTask.kind === 'external-url');
  assert.deepEqual(extTask.externalUrls, [
    'https://vendor.example.com/photo.png',
  ]);

  // Simulate advancing to batch 2 after processing first 50
  const batch1Ids = new Set(plan.currentBatch.map((t) => t.product.id));
  const batch2Plan = buildDriveSyncPlan(files, catalog, {
    excludeProductIds: batch1Ids,
  });
  assert.equal(batch2Plan.currentBatch.length, 15);
  assert.equal(batch2Plan.remainingCount, 0);

  // Supabase scan plan also skips synced and batches at 50
  const supaPlan = buildSupabaseScanPlan(files, catalog);
  assert.equal(supaPlan.skippedSyncedCount, 1);
  assert.equal(supaPlan.allMatches.length, 64);
  assert.equal(supaPlan.currentBatch.length, 50);
  assert.equal(supaPlan.remainingCount, 14);
});




import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  extractCategories,
  filterAndSortProducts,
  formatVnd,
  normalizeVietnameseText,
  resolveMatchingCategory,
  validateCheckoutForm,
} from './shopLogic';
import { buildVietQrImageUrl, buildVietQrPayload } from './vietqr';
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  isCatalogCacheStale,
  loadCachedCatalog,
  mapSupabaseCombos,
  mapSupabaseRowToProduct,
  normalizeGoogleDriveImageUrl,
  normalizeVndPrice,
  parseImageUrls,
  saveCachedCatalog,
} from '../lib/supabaseProducts';
import type { CartItem, Product } from '../types/shop';

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

test('mapSupabaseCombos joins active combos with combo_items and applies discount_amount', () => {
  const mappedCombos = mapSupabaseCombos(
    [
      {
        id: 'cb-1',
        combo_code: 'CB-001',
        name: 'Combo Học Sinh Tiết Kiệm',
        discount_amount: 5000,
        is_active: true,
        image_url: 'https://drive.google.com/open?id=COMBO123',
        notes: 'Bộ vở và bút cơ bản',
      },
      {
        id: 'cb-2',
        combo_code: 'CB-002',
        name: 'Combo Đã Tắt',
        discount_amount: 3000,
        is_active: false,
      },
    ],
    [
      { id: 'ci-1', combo_id: 'cb-1', product_id: 'p1', quantity: 2 },
      { id: 'ci-2', combo_id: 'cb-1', product_id: 'p2', quantity: 3 },
      { id: 'ci-3', combo_id: 'cb-2', product_id: 'p3', quantity: 1 },
    ],
    sampleProducts,
  );

  assert.equal(mappedCombos.length, 1);
  const combo = mappedCombos[0];
  assert.equal(combo.comboCode, 'CB-001');
  assert.equal(combo.title, 'Combo Học Sinh Tiết Kiệm');
  assert.equal(combo.subtitle, 'Bộ vở và bút cơ bản');
  assert.equal(combo.originalPrice, 2 * 12000 + 3 * 8000);
  assert.equal(combo.discountAmount, 5000);
  assert.equal(combo.bundlePrice, 43000);
  assert.equal(
    combo.image,
    'https://drive.google.com/thumbnail?id=COMBO123&sz=w800',
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
      combos: [],
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

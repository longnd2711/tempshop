import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  filterAndSortProducts,
  formatVnd,
  normalizeVietnameseText,
  validateCheckoutForm,
} from './shopLogic';
import { buildVietQrPayload } from './vietqr';
import type { CartItem, Product } from '../types/shop';

const sampleProducts: Product[] = [
  {
    id: 'p1',
    sku: 'VPP-001',
    name: 'Bút gel mực xanh 0.5mm',
    category: 'stationery',
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
    id: 'p2',
    sku: 'HS-002',
    name: 'Vở ô ly 96 trang giấy dày',
    category: 'school',
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
    id: 'p3',
    sku: 'DC-003',
    name: 'Khối xếp hình gỗ tự nhiên',
    category: 'toys',
    categoryLabel: 'Đồ chơi',
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

test('filterAndSortProducts filters by category, stock, and Vietnamese query', () => {
  const searchResult = filterAndSortProducts(sampleProducts, {
    category: 'all',
    query: 'vo o ly',
    sortBy: 'popular',
    inStockOnly: false,
  });
  assert.equal(searchResult.length, 1);
  assert.equal(searchResult[0].id, 'p2');

  const inStockOnly = filterAndSortProducts(sampleProducts, {
    category: 'all',
    query: '',
    sortBy: 'price-desc',
    inStockOnly: true,
  });
  assert.deepEqual(
    inStockOnly.map((p) => p.id),
    ['p3', 'p1'],
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

test('formatVnd formats Vietnamese dong cleanly', () => {
  assert.equal(formatVnd(150000), '150.000₫');
  assert.equal(formatVnd(8000), '8.000₫');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  filterAndSortProducts,
  formatVnd,
  FREE_SHIP_THRESHOLD,
  normalizeVietnameseText,
  STANDARD_SHIPPING_FEE,
  validateCheckoutForm,
} from './shopLogic';
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

test('calculateCartSummary computes free shipping threshold accurately', () => {
  const item: CartItem = {
    productId: 'p3',
    sku: 'DC-003',
    name: 'Khối xếp hình',
    categoryLabel: 'Đồ chơi',
    unit: 'Bộ',
    variant: '48 chi tiết',
    unitPrice: 95000,
    quantity: 1,
    image: '/img3.jpg',
  };

  const underThreshold = calculateCartSummary([item], 'delivery');
  assert.equal(underThreshold.subtotal, 95000);
  assert.equal(underThreshold.shippingFee, STANDARD_SHIPPING_FEE);
  assert.equal(underThreshold.amountToFreeShip, FREE_SHIP_THRESHOLD - 95000);
  assert.equal(underThreshold.total, 95000 + STANDARD_SHIPPING_FEE);

  const overThreshold = calculateCartSummary(
    [{ ...item, quantity: 2 }],
    'delivery',
  );
  assert.equal(overThreshold.subtotal, 190000);
  assert.equal(overThreshold.shippingFee, 0);
  assert.equal(overThreshold.amountToFreeShip, 0);
  assert.equal(overThreshold.total, 190000);

  const pickup = calculateCartSummary([item], 'pickup');
  assert.equal(pickup.shippingFee, 0);
  assert.equal(pickup.total, 95000);
});

test('validateCheckoutForm rejects missing fields and invalid phones', () => {
  const invalid = validateCheckoutForm({
    customerName: 'A',
    phone: '12345',
    address: '12',
    note: '',
    deliveryMethod: 'delivery',
    paymentMethod: 'cod',
  });
  assert.ok(invalid.customerName);
  assert.ok(invalid.phone);
  assert.ok(invalid.address);

  const validPickup = validateCheckoutForm({
    customerName: 'Minh Anh',
    phone: '0912345678',
    address: '',
    note: '',
    deliveryMethod: 'pickup',
    paymentMethod: 'transfer',
  });
  assert.deepEqual(validPickup, {});
});

test('formatVnd formats Vietnamese dong cleanly', () => {
  assert.equal(formatVnd(150000), '150.000₫');
  assert.equal(formatVnd(8000), '8.000₫');
});

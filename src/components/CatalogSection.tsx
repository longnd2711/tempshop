import { Search, X } from 'lucide-react';
import { CATEGORIES } from '../data/catalog';
import type { CartItem, CategoryId, Product, SortOption } from '../types/shop';
import { ProductCard } from './ProductCard';

interface CatalogSectionProps {
  products: Product[];
  allProductsCount: number;
  selectedCategory: CategoryId;
  onSelectCategory: (category: CategoryId) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: SortOption;
  onSortChange: (value: SortOption) => void;
  inStockOnly: boolean;
  onInStockChange: (value: boolean) => void;
  cartItems: CartItem[];
  onQuickAdd: (product: Product) => void;
  onUpdateQuantity: (productId: string, variant: string, delta: number) => void;
  onOpenDetail: (product: Product) => void;
  onResetFilters: () => void;
}

export function CatalogSection({
  products,
  allProductsCount,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  inStockOnly,
  onInStockChange,
  cartItems,
  onQuickAdd,
  onUpdateQuantity,
  onOpenDetail,
  onResetFilters,
}: CatalogSectionProps) {
  const getDefaultCartQty = (product: Product) => {
    const defaultVariant = product.variants[0] ?? 'Tiêu chuẩn';
    const found = cartItems.find(
      (item) => item.productId === product.id && item.variant === defaultVariant,
    );
    return found ? found.quantity : 0;
  };

  return (
    <section id="catalog" className="scroll-mt-20 py-12 lg:py-16">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Danh mục chọn mua nhanh
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Hiển thị{' '}
              <span className="font-medium text-slate-900 tabular-nums">
                {products.length}
              </span>{' '}
              sản phẩm tiêu biểu trong tổng số{' '}
              <span className="tabular-nums">{allProductsCount}</span> mẫu demo
              tại quầy.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => onInStockChange(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
              />
              <span>Chỉ hiện còn hàng</span>
            </label>

            <div className="flex items-center gap-2">
              <label htmlFor="catalog-sort" className="text-sm text-slate-500">
                Sắp xếp:
              </label>
              <select
                id="catalog-sort"
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value as SortOption)}
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
              >
                <option value="popular">Bán chạy nhất</option>
                <option value="price-asc">Giá thấp đến cao</option>
                <option value="price-desc">Giá cao đến thấp</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div
            role="tablist"
            aria-label="Lọc theo nhóm sản phẩm"
            className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-lg overflow-x-auto"
          >
            {CATEGORIES.map((category) => {
              const active = selectedCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectCategory(category.id)}
                  className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-80">
            <label htmlFor="catalog-search" className="sr-only">
              Tìm kiếm sản phẩm theo tên hoặc mã SKU
            </label>
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="catalog-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm bút, vở, rubik, sữa tươi..."
              className="w-full pl-10 pr-9 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {products.length === 0 ? (
          <div className="mt-10 py-14 px-6 text-center bg-white border border-slate-200 rounded-xl">
            <p className="font-display text-lg font-semibold text-slate-900">
              Không tìm thấy mặt hàng phù hợp
            </p>
            <p className="mt-1.5 text-sm text-slate-600">
              Thử đổi từ khóa ngắn hơn (ví dụ: bút, vở, sữa) hoặc chuyển về tất cả danh mục.
            </p>
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
            >
              Xem lại toàn bộ sản phẩm
            </button>
          </div>
        ) : (
          <div
            data-testid="product-grid"
            className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                cartQuantity={getDefaultCartQty(product)}
                onQuickAdd={onQuickAdd}
                onUpdateQuantity={onUpdateQuantity}
                onOpenDetail={onOpenDetail}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

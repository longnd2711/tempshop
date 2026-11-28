import { useEffect, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type {
  CartItem,
  CategoryId,
  CategoryNode,
  Product,
  SortOption,
} from '../types/shop';
import { normalizeCategoryKey } from '../utils/shopLogic';
import { ProductCard } from './ProductCard';

const PAGE_SIZE = 24;

interface CatalogSectionProps {
  products: Product[];
  allProductsCount: number;
  categories: string[];
  categoryTree?: CategoryNode[];
  selectedCategory: CategoryId;
  onSelectCategory: (category: CategoryId) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  sortBy: SortOption;
  onSortChange: (value: SortOption) => void;
  cartItems: CartItem[];
  isAuthenticated?: boolean;
  onQuickAdd: (product: Product) => void;
  onUpdateQuantity: (productId: string, variant: string, delta: number) => void;
  onSetQuantity?: (productId: string, variant: string, quantity: number) => void;
  onOpenDetail: (product: Product) => void;
  onResetFilters: () => void;
  isLoadingCatalog?: boolean;
  catalogNotice?: string;
}

export function CatalogSection({
  products,
  allProductsCount,
  categories,
  categoryTree = [],
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  cartItems,
  isAuthenticated = false,
  onQuickAdd,
  onUpdateQuantity,
  onSetQuantity,
  onOpenDetail,
  onResetFilters,
  isLoadingCatalog = false,
  catalogNotice,
}: CatalogSectionProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedCategory, searchQuery, sortBy]);

  const visibleProducts = products.slice(0, visibleCount);
  const remainingCount = Math.max(0, products.length - visibleProducts.length);

  const getDefaultCartQty = (product: Product) => {
    const defaultVariant = product.variants[0] ?? 'Tiêu chuẩn';
    const found = cartItems.find(
      (item) => item.productId === product.id && item.variant === defaultVariant,
    );
    return found ? found.quantity : 0;
  };

  const filterTabs = [
    { id: 'all', label: 'Tất cả' },
    ...categories.map((cat) => ({ id: cat, label: cat })),
  ];

  // Tìm nhóm cha đang được chọn (dù người dùng đang chọn cha hay chọn 1 nhóm con)
  const selectedNode = categoryTree.find(
    (c) =>
      normalizeCategoryKey(c.name) === normalizeCategoryKey(selectedCategory) ||
      c.id === selectedCategory,
  );
  const activeTopNode = selectedNode?.parentId
    ? categoryTree.find((c) => c.id === selectedNode.parentId) ?? selectedNode
    : selectedNode;
  const subCategories = activeTopNode
    ? categoryTree
        .filter((c) => c.isActive && c.parentId === activeTopNode.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'))
    : [];

  const isTabSelected = (tabId: string) => {
    if (selectedCategory === 'all') return tabId === 'all';
    if (activeTopNode && normalizeCategoryKey(activeTopNode.name) === normalizeCategoryKey(tabId)) {
      return true;
    }
    return normalizeCategoryKey(selectedCategory) === normalizeCategoryKey(tabId);
  };

  return (
    <section id="catalog" className="scroll-mt-16 md:scroll-mt-20 py-8 sm:py-12 lg:py-16">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 sm:pb-6 border-b border-slate-200">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Tìm kiếm hàng hóa
            </h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Hiển thị{' '}
              <span className="font-medium text-slate-900 tabular-nums">
                {visibleProducts.length}
              </span>{' '}
              {products.length !== visibleProducts.length && (
                <>
                  / <span className="tabular-nums">{products.length}</span>{' '}
                </>
              )}
              mặt hàng phù hợp trong tổng số{' '}
              <span className="tabular-nums">{allProductsCount}</span> sản phẩm.
            </p>
          </div>

          <div className="flex items-center justify-between sm:justify-start gap-2">
            <label htmlFor="catalog-sort" className="text-sm text-slate-500 whitespace-nowrap">
              Sắp xếp:
            </label>
            <select
              id="catalog-sort"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              className="min-h-[44px] sm:min-h-[38px] flex-1 sm:flex-none px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
            >
              <option value="name-asc">Theo tên (A–Z)</option>
              <option value="price-asc">Giá thấp đến cao</option>
              <option value="price-desc">Giá cao đến thấp</option>
            </select>
          </div>
        </div>

        {catalogNotice && (
          <div
            role="status"
            className="mt-4 px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
          >
            {catalogNotice}
          </div>
        )}

        <div className="mt-5 sm:mt-6 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
          <div
            role="tablist"
            aria-label="Lọc theo nhóm hàng thực tế"
            className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-lg overflow-x-auto"
          >
            {filterTabs.map((tab) => {
              const active = isTabSelected(tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectCategory(tab.id)}
                  className={`min-h-[40px] sm:min-h-[36px] px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-700 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-80">
            <label htmlFor="catalog-search" className="sr-only">
              Tìm kiếm sản phẩm theo tên, hãng hoặc mã SKU
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
              placeholder="Tìm tên hàng, hãng, mã SKU..."
              className="w-full min-h-[44px] pl-10 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {subCategories.length > 0 && activeTopNode && (
          <div
            aria-label="Lọc theo danh mục con"
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              onClick={() => onSelectCategory(activeTopNode.name)}
              className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                normalizeCategoryKey(selectedCategory) ===
                normalizeCategoryKey(activeTopNode.name)
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              Tất cả {activeTopNode.name}
            </button>
            {subCategories.map((sub) => {
              const activeSub =
                normalizeCategoryKey(selectedCategory) ===
                normalizeCategoryKey(sub.name);
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => onSelectCategory(sub.name)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    activeSub
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {sub.name}
                </button>
              );
            })}
          </div>
        )}

        {isLoadingCatalog ? (
          <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="mt-8 sm:mt-10 py-12 px-6 text-center bg-white border border-slate-200 rounded-xl">
            <p className="font-display text-lg font-semibold text-slate-900">
              Không tìm thấy mặt hàng phù hợp
            </p>
            <p className="mt-1.5 text-sm text-slate-600">
              Thử đổi từ khóa ngắn hơn (ví dụ: bút, vở, sữa) hoặc chuyển về tất cả danh mục.
            </p>
            <button
              type="button"
              onClick={onResetFilters}
              className="mt-5 min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
            >
              Xem lại toàn bộ sản phẩm
            </button>
          </div>
        ) : (
          <>
            <div
              data-testid="product-grid"
              className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
            >
              {visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  cartQuantity={getDefaultCartQty(product)}
                  isAuthenticated={isAuthenticated}
                  onQuickAdd={onQuickAdd}
                  onUpdateQuantity={onUpdateQuantity}
                  onSetQuantity={onSetQuantity}
                  onOpenDetail={onOpenDetail}
                />
              ))}
            </div>

            {remainingCount > 0 && (
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 py-2.5 text-sm font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                >
                  <span>
                    Xem thêm {Math.min(PAGE_SIZE, remainingCount)} sản phẩm (còn {remainingCount})
                  </span>
                  <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(products.length)}
                  className="inline-flex items-center justify-center min-h-[44px] px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
                >
                  Hiển thị tất cả
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

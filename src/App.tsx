import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { CartDrawer } from './components/CartDrawer';
import { CatalogSection } from './components/CatalogSection';
import { FloatingContactButtons } from './components/FloatingContactButtons';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { ProductModal } from './components/ProductModal';
import { BundleSection } from './components/BundleSection';
import { StoreInfoSection } from './components/StoreInfoSection';
import { BUNDLE_PACKS, PRODUCTS } from './data/catalog';
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  fetchCatalogFromSupabase,
  loadCachedCatalog,
  saveCachedCatalog,
} from './lib/supabaseProducts';
import type {
  BundlePack,
  CartItem,
  CategoryId,
  OrderRecord,
  Product,
  SortOption,
} from './types/shop';
import {
  calculateCartSummary,
  extractCategories,
  filterAndSortProducts,
  formatVnd,
  resolveMatchingCategory,
} from './utils/shopLogic';

const CART_STORAGE_KEY = 'tiem_an_nhien_cart_v1';
const LAST_ORDER_STORAGE_KEY = 'tiem_an_nhien_last_order_v1';

function loadStoredCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadLastOrder(): OrderRecord | null {
  try {
    const raw = window.localStorage.getItem(LAST_ORDER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OrderRecord;
  } catch {
    return null;
  }
}

export default function App() {
  const initialCache = useMemo(() => loadCachedCatalog(), []);

  const [catalogProducts, setCatalogProducts] = useState<Product[]>(
    () => initialCache?.products ?? PRODUCTS,
  );
  const [catalogBundles, setCatalogBundles] = useState<BundlePack[]>(
    () => initialCache?.combos ?? BUNDLE_PACKS,
  );
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState<string | undefined>(
    undefined,
  );

  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('name-asc');

  const [cartItems, setCartItems] = useState<CartItem[]>(loadStoredCart);
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(loadLastOrder);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

  const syncCatalog = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) {
      setIsLoadingCatalog(true);
    }
    try {
      const result = await fetchCatalogFromSupabase();
      if (result.source === 'supabase') {
        setCatalogProducts(result.products);
        setCatalogBundles(result.combos);
        setCatalogNotice(undefined);
        saveCachedCatalog({
          products: result.products,
          combos: result.combos,
          syncedAt: result.syncedAt,
          source: 'supabase',
        });
      } else {
        // Offline or demo fallback: preserve cached Supabase data if already stored offline
        const existingCache = loadCachedCatalog();
        if (existingCache && existingCache.source === 'supabase') {
          setCatalogProducts(existingCache.products);
          setCatalogBundles(existingCache.combos);
        } else {
          setCatalogProducts(result.products);
          setCatalogBundles(result.combos);
          saveCachedCatalog({
            products: result.products,
            combos: result.combos,
            syncedAt: result.syncedAt,
            source: 'demo',
          });
        }
        setCatalogNotice(result.errorMessage);
      }
    } finally {
      if (showSpinner) {
        setIsLoadingCatalog(false);
      }
    }
  }, []);

  useEffect(() => {
    // Ensure offline cache exists from first visit immediately
    if (!initialCache) {
      saveCachedCatalog({
        products: PRODUCTS,
        combos: BUNDLE_PACKS,
        syncedAt: Date.now(),
        source: 'demo',
      });
    }

    // Immediate background sync on mount (or silent update on subsequent visits)
    void syncCatalog(false);

    // Silent background sync every 10 minutes
    const intervalId = window.setInterval(() => {
      void syncCatalog(false);
    }, BACKGROUND_SYNC_INTERVAL_MS);

    const handleOnline = () => {
      void syncCatalog(false);
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [initialCache, syncCatalog]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
    } catch {
      // Ignore storage quota errors
    }
  }, [cartItems]);

  useEffect(() => {
    try {
      if (lastOrder) {
        window.localStorage.setItem(
          LAST_ORDER_STORAGE_KEY,
          JSON.stringify(lastOrder),
        );
      }
    } catch {
      // Ignore storage quota errors
    }
  }, [lastOrder]);

  const availableCategories = useMemo(
    () => extractCategories(catalogProducts),
    [catalogProducts],
  );

  const filteredProducts = useMemo(
    () =>
      filterAndSortProducts(catalogProducts, {
        category: selectedCategory,
        query: searchQuery,
        sortBy,
        inStockOnly: false,
      }),
    [catalogProducts, selectedCategory, searchQuery, sortBy],
  );

  const cartSummary = useMemo(
    () => calculateCartSummary(cartItems, 'delivery'),
    [cartItems],
  );

  const addToCart = (product: Product, variant: string, quantity: number) => {
    if (quantity <= 0) return;
    setCartItems((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.productId === product.id && item.variant === variant,
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) =>
          idx === existingIndex
            ? {
                ...item,
                quantity: item.quantity + quantity,
              }
            : item,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          categoryLabel: product.categoryLabel || product.category,
          unit: product.unit,
          variant,
          unitPrice: product.price,
          quantity,
          image: product.image,
        },
      ];
    });
  };

  const handleQuickAdd = (product: Product) => {
    const defaultVariant = product.variants[0] ?? 'Tiêu chuẩn';
    addToCart(product, defaultVariant, 1);
  };

  const handleUpdateQuantity = (
    productId: string,
    variant: string,
    delta: number,
  ) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.productId !== productId || item.variant !== variant) {
            return item;
          }
          const nextQty = item.quantity + delta;
          return { ...item, quantity: nextQty };
        })
        .filter((item) => item.quantity > 0),
    );
  };

  const handleRemoveItem = (productId: string, variant: string) => {
    setCartItems((prev) =>
      prev.filter(
        (item) => !(item.productId === productId && item.variant === variant),
      ),
    );
  };

  const handleAddBundle = (bundle: BundlePack) => {
    const comboCartId = `combo:${bundle.id}`;
    const itemSummary = bundle.items
      .map((entry) => {
        const prod =
          catalogProducts.find((p) => p.id === entry.productId) ??
          PRODUCTS.find((p) => p.id === entry.productId);
        const label = entry.productName ?? prod?.name ?? entry.productId;
        return `${label} x${entry.quantity}`;
      })
      .join(', ');
    const comboVariant = itemSummary || `${bundle.items.length} món`;
    const fallbackImage =
      bundle.image ??
      bundle.items
        .map(
          (entry) =>
            entry.productImage ??
            catalogProducts.find((p) => p.id === entry.productId)?.image,
        )
        .find(Boolean) ??
      '';

    setCartItems((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.productId === comboCartId,
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) =>
          idx === existingIndex
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        {
          productId: comboCartId,
          sku: bundle.comboCode,
          name: bundle.title,
          categoryLabel: 'Combo nhanh',
          unit: 'Combo',
          variant: comboVariant,
          unitPrice: bundle.bundlePrice,
          quantity: 1,
          image: fallbackImage,
        },
      ];
    });
  };

  const handleExploreCatalog = () => {
    const el = document.getElementById('catalog');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleResetFilters = () => {
    setSelectedCategory('all');
    setSearchQuery('');
    setSortBy('name-asc');
  };

  const handleSelectNavCategory = (category: CategoryId) => {
    const resolved = resolveMatchingCategory(category, availableCategories);
    setSelectedCategory(resolved);
    setSearchQuery('');
  };

  const hasMobileCartBar = cartSummary.itemCount > 0 && !isCartOpen;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        cartCount={cartSummary.itemCount}
        cartSubtotal={cartSummary.subtotal}
        onOpenCart={() => setIsCartOpen(true)}
        onSelectNavCategory={handleSelectNavCategory}
      />

      <main className="flex-1">
        <HeroSection onExploreCatalog={handleExploreCatalog} />

        <CatalogSection
          products={filteredProducts}
          allProductsCount={catalogProducts.length}
          categories={availableCategories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortBy={sortBy}
          onSortChange={setSortBy}
          cartItems={cartItems}
          onQuickAdd={handleQuickAdd}
          onUpdateQuantity={handleUpdateQuantity}
          onOpenDetail={setActiveProduct}
          onResetFilters={handleResetFilters}
          isLoadingCatalog={isLoadingCatalog}
          catalogNotice={catalogNotice}
        />

        <BundleSection
          bundles={catalogBundles}
          products={catalogProducts}
          onAddBundle={handleAddBundle}
        />

        <StoreInfoSection
          lastOrder={lastOrder}
          onOpenCart={() => setIsCartOpen(true)}
        />
      </main>

      <Footer onSelectNavCategory={handleSelectNavCategory} />

      <FloatingContactButtons hasMobileCartBar={hasMobileCartBar} />

      {hasMobileCartBar && (
        <div className="md:hidden fixed bottom-3 inset-x-4 z-30">
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="w-full h-12 px-4 flex items-center justify-between bg-blue-700 hover:bg-blue-800 text-white rounded-xl shadow-lg font-medium text-sm cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                Xem giỏ ({cartSummary.itemCount} món)
              </span>
            </span>
            <span className="font-semibold tabular-nums">
              {formatVnd(cartSummary.subtotal)}
            </span>
          </button>
        </div>
      )}

      <ProductModal
        product={activeProduct}
        onClose={() => setActiveProduct(null)}
        onAddToCart={addToCart}
      />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onClearCart={() => setCartItems([])}
        onOrderConfirmed={(order) => setLastOrder(order)}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { CartDrawer } from './components/CartDrawer';
import { CatalogSection } from './components/CatalogSection';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { ProductModal } from './components/ProductModal';
import { BundleSection } from './components/BundleSection';
import { StoreInfoSection } from './components/StoreInfoSection';
import { PRODUCTS } from './data/catalog';
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
  filterAndSortProducts,
  formatVnd,
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
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('popular');
  const [inStockOnly, setInStockOnly] = useState(false);

  const [cartItems, setCartItems] = useState<CartItem[]>(loadStoredCart);
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(loadLastOrder);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

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

  const filteredProducts = useMemo(
    () =>
      filterAndSortProducts(PRODUCTS, {
        category: selectedCategory,
        query: searchQuery,
        sortBy,
        inStockOnly,
      }),
    [selectedCategory, searchQuery, sortBy, inStockOnly],
  );

  const cartSummary = useMemo(
    () => calculateCartSummary(cartItems, 'delivery'),
    [cartItems],
  );

  const addToCart = (product: Product, variant: string, quantity: number) => {
    if (product.stock <= 0 || quantity <= 0) return;
    setCartItems((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.productId === product.id && item.variant === variant,
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) =>
          idx === existingIndex
            ? {
                ...item,
                quantity: Math.min(product.stock, item.quantity + quantity),
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
          categoryLabel: product.categoryLabel,
          unit: product.unit,
          variant,
          unitPrice: product.price,
          quantity: Math.min(product.stock, quantity),
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
    const product = PRODUCTS.find((p) => p.id === productId);
    const maxStock = product ? product.stock : 99;

    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.productId !== productId || item.variant !== variant) {
            return item;
          }
          const nextQty = Math.min(maxStock, item.quantity + delta);
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
    bundle.items.forEach(({ productId, quantity }) => {
      const product = PRODUCTS.find((p) => p.id === productId);
      if (product && product.stock > 0) {
        const defaultVariant = product.variants[0] ?? 'Tiêu chuẩn';
        addToCart(product, defaultVariant, quantity);
      }
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
    setSortBy('popular');
    setInStockOnly(false);
  };

  const handleSelectNavCategory = (category: CategoryId) => {
    setSelectedCategory(category);
    setSearchQuery('');
  };

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
          allProductsCount={PRODUCTS.length}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortBy={sortBy}
          onSortChange={setSortBy}
          inStockOnly={inStockOnly}
          onInStockChange={setInStockOnly}
          cartItems={cartItems}
          onQuickAdd={handleQuickAdd}
          onUpdateQuantity={handleUpdateQuantity}
          onOpenDetail={setActiveProduct}
          onResetFilters={handleResetFilters}
        />

        <BundleSection onAddBundle={handleAddBundle} />

        <StoreInfoSection
          lastOrder={lastOrder}
          onOpenCart={() => setIsCartOpen(true)}
        />
      </main>

      <Footer onSelectNavCategory={handleSelectNavCategory} />

      {cartSummary.itemCount > 0 && !isCartOpen && (
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

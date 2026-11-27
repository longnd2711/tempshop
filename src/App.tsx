import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { AdminPortal } from './components/AdminPortal';
import { CartDrawer } from './components/CartDrawer';
import { CatalogSection } from './components/CatalogSection';
import { FloatingContactButtons } from './components/FloatingContactButtons';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { ProductModal } from './components/ProductModal';
import { StoreInfoSection } from './components/StoreInfoSection';
import { PRODUCTS } from './data/catalog';
import {
  fetchAdminCategories,
  fetchAdminCustomers,
  fetchAdminProducts,
  fetchAdminUsers,
  fetchPurchaseOrders,
  getAdminSessionUser,
  onAdminUserAuthChange,
  signInAdminUser,
  signOutAdminUser,
} from './lib/supabaseAdmin';
import {
  createOrderInSupabase,
  fetchOrdersFromSupabase,
  loadStoredOrders,
  saveStoredOrders,
  updateOrderStatusInSupabase,
} from './lib/supabaseOrders';
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  fetchCatalogFromSupabase,
  loadCachedCatalog,
  saveCachedCatalog,
} from './lib/supabaseProducts';
import type {
  AdminTab,
  AdminUser,
  CartItem,
  CategoryId,
  CategoryNode,
  CustomerRecord,
  OrderLifecycleStatus,
  OrderRecord,
  Product,
  PurchaseOrderRecord,
  SortOption,
  UserProfileRecord,
} from './types/shop';
import {
  canManageInventory,
  canManageUsers,
  parseAdminRouteFromHash,
} from './utils/adminLogic';
import {
  calculateCartSummary,
  extractTopCategories,
  filterAndSortProducts,
  formatVnd,
  resolveMatchingCategory,
} from './utils/shopLogic';

const CART_STORAGE_KEY = 'tiem_an_nhien_cart_v1';
const LAST_ORDER_STORAGE_KEY = 'tiem_an_nhien_last_order_v1';

function getRouteStateFromHash(): { page: 'shop' | 'admin'; tab: AdminTab } {
  if (typeof window === 'undefined') return { page: 'shop', tab: 'orders' };
  return parseAdminRouteFromHash(window.location.hash);
}

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
  const initialRoute = useMemo(() => getRouteStateFromHash(), []);

  const [currentPage, setCurrentPage] = useState<'shop' | 'admin'>(
    initialRoute.page,
  );
  const [adminTab, setAdminTab] = useState<AdminTab>(initialRoute.tab);

  const [catalogProducts, setCatalogProducts] = useState<Product[]>(
    () => initialCache?.products ?? PRODUCTS,
  );
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>(
    () => initialCache?.categories ?? [],
  );
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState<string | undefined>(
    undefined,
  );

  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const [orders, setOrders] = useState<OrderRecord[]>(loadStoredOrders);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersNotice, setOrdersNotice] = useState<string | undefined>(
    undefined,
  );

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customersNotice, setCustomersNotice] = useState<string | undefined>(
    undefined,
  );

  const [adminCategories, setAdminCategories] = useState<CategoryNode[]>([]);
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [isLoadingAdminProducts, setIsLoadingAdminProducts] = useState(false);
  const [adminProductsNotice, setAdminProductsNotice] = useState<
    string | undefined
  >(undefined);

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRecord[]>(
    [],
  );
  const [isLoadingPurchases, setIsLoadingPurchases] = useState(false);
  const [purchasesNotice, setPurchasesNotice] = useState<string | undefined>(
    undefined,
  );

  const [adminUsers, setAdminUsers] = useState<UserProfileRecord[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [usersNotice, setUsersNotice] = useState<string | undefined>(undefined);

  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('name-asc');

  const [cartItems, setCartItems] = useState<CartItem[]>(loadStoredCart);
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(loadLastOrder);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      const next = getRouteStateFromHash();
      setCurrentPage(next.page);
      setAdminTab(next.tab);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const syncCatalog = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) {
      setIsLoadingCatalog(true);
    }
    try {
      const result = await fetchCatalogFromSupabase();
      if (result.source === 'supabase') {
        setCatalogProducts(result.products);
        setCategoryTree(result.categories ?? []);
        setCatalogNotice(undefined);
        saveCachedCatalog({
          products: result.products,
          categories: result.categories,
          syncedAt: result.syncedAt,
          source: 'supabase',
        });
      } else {
        const existingCache = loadCachedCatalog();
        if (existingCache && existingCache.source === 'supabase') {
          setCatalogProducts(existingCache.products);
          setCategoryTree(existingCache.categories ?? []);
        } else {
          setCatalogProducts(result.products);
          setCategoryTree(result.categories ?? []);
          saveCachedCatalog({
            products: result.products,
            categories: result.categories,
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

  const syncOrders = useCallback(async () => {
    setIsLoadingOrders(true);
    try {
      const result = await fetchOrdersFromSupabase();
      setOrders(result.orders);
      setOrdersNotice(result.errorMessage);
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  const syncCustomers = useCallback(async () => {
    setIsLoadingCustomers(true);
    try {
      const res = await fetchAdminCustomers();
      setCustomers(res.customers);
      setCustomersNotice(res.errorMessage);
    } finally {
      setIsLoadingCustomers(false);
    }
  }, []);

  const syncAdminInventory = useCallback(async () => {
    setIsLoadingAdminProducts(true);
    try {
      const catRes = await fetchAdminCategories();
      setAdminCategories(catRes.categories);

      const prodRes = await fetchAdminProducts(catRes.categories);
      setAdminProducts(prodRes.products);
      setAdminProductsNotice(prodRes.errorMessage ?? catRes.errorMessage);
    } finally {
      setIsLoadingAdminProducts(false);
    }
  }, []);

  const syncPurchaseOrders = useCallback(async () => {
    setIsLoadingPurchases(true);
    try {
      const res = await fetchPurchaseOrders();
      setPurchaseOrders(res.purchaseOrders);
      setPurchasesNotice(res.errorMessage);
    } finally {
      setIsLoadingPurchases(false);
    }
  }, []);

  const syncAdminUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    try {
      const res = await fetchAdminUsers();
      setAdminUsers(res.users);
      setUsersNotice(res.errorMessage);
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  const syncAuthorizedDataForUser = useCallback(
    async (user: AdminUser | null) => {
      if (!user) {
        setCustomers([]);
        setAdminCategories([]);
        setAdminProducts([]);
        setPurchaseOrders([]);
        setAdminUsers([]);
        return;
      }

      await Promise.all([syncOrders(), syncCustomers()]);
      const inventoryAllowed = canManageInventory(user.role);
      const usersAllowed = canManageUsers(user.role);

      const extraTasks: Promise<void>[] = [];
      if (inventoryAllowed) {
        extraTasks.push(syncAdminInventory(), syncPurchaseOrders());
      } else {
        setAdminCategories([]);
        setAdminProducts([]);
        setPurchaseOrders([]);
      }

      if (usersAllowed) {
        extraTasks.push(syncAdminUsers());
      } else {
        setAdminUsers([]);
      }

      if (extraTasks.length > 0) {
        await Promise.all(extraTasks);
      }
    },
    [
      syncAdminInventory,
      syncAdminUsers,
      syncCustomers,
      syncOrders,
      syncPurchaseOrders,
    ],
  );

  useEffect(() => {
    let mounted = true;
    void getAdminSessionUser().then((user) => {
      if (!mounted) return;
      setAdminUser(user);
      setIsCheckingAuth(false);
      void syncAuthorizedDataForUser(user);
    });

    const unsubscribe = onAdminUserAuthChange((user) => {
      setAdminUser(user);
      setIsCheckingAuth(false);
      void syncAuthorizedDataForUser(user);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [syncAuthorizedDataForUser]);

  useEffect(() => {
    if (!initialCache) {
      saveCachedCatalog({
        products: PRODUCTS,
        syncedAt: Date.now(),
        source: 'demo',
      });
    }

    void syncCatalog(false);

    const intervalId = window.setInterval(() => {
      void syncCatalog(false);
    }, BACKGROUND_SYNC_INTERVAL_MS);

    const handleOnline = () => {
      void syncCatalog(false);
      if (adminUser) {
        void syncAuthorizedDataForUser(adminUser);
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [adminUser, initialCache, syncAuthorizedDataForUser, syncCatalog]);

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
    () => extractTopCategories(catalogProducts, categoryTree),
    [catalogProducts, categoryTree],
  );

  const filteredProducts = useMemo(
    () =>
      filterAndSortProducts(catalogProducts, {
        category: selectedCategory,
        query: searchQuery,
        sortBy,
        inStockOnly: false,
        categoryTree,
      }),
    [catalogProducts, categoryTree, selectedCategory, searchQuery, sortBy],
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

  const handleOrderConfirmed = async (
    order: OrderRecord,
  ): Promise<{ synced: boolean; errorMessage?: string }> => {
    setLastOrder(order);
    setOrders((prev) => {
      const next = [order, ...prev.filter((o) => o.orderCode !== order.orderCode)];
      saveStoredOrders(next);
      return next;
    });

    const result = await createOrderInSupabase(order);
    if (result.synced) {
      setOrders((prev) => {
        const next = prev.map((o) =>
          o.orderCode === order.orderCode ? result.order : o,
        );
        saveStoredOrders(next);
        return next;
      });
      if (adminUser && order.phone) {
        void syncCustomers();
      }
    }
    return { synced: result.synced, errorMessage: result.errorMessage };
  };

  const handleToggleConfirm = async (order: OrderRecord) => {
    const nextConfirmed = !order.isConfirmed;
    const nowIso = new Date().toISOString();
    const nextStatus: OrderLifecycleStatus = nextConfirmed
      ? order.status === 'pending' || !order.status
        ? 'confirmed'
        : order.status
      : order.status === 'confirmed'
        ? 'pending'
        : order.status ?? 'pending';

    setOrders((prev) => {
      const next = prev.map((o) =>
        o.orderCode === order.orderCode
          ? {
              ...o,
              isConfirmed: nextConfirmed,
              status: nextStatus,
              confirmedAt: nextConfirmed ? nowIso : null,
            }
          : o,
      );
      saveStoredOrders(next);
      return next;
    });

    const res = await updateOrderStatusInSupabase(order, {
      isConfirmed: nextConfirmed,
      status: nextStatus,
    });
    if (res.errorMessage) {
      setOrdersNotice(
        `Đã cập nhật trên máy nhưng chưa lưu lên Supabase (${res.errorMessage}).`,
      );
    }
  };

  const handleTogglePaid = async (order: OrderRecord) => {
    const nextPaid = !order.isPaid;
    const nowIso = new Date().toISOString();

    setOrders((prev) => {
      const next = prev.map((o) =>
        o.orderCode === order.orderCode
          ? {
              ...o,
              isPaid: nextPaid,
              paidAt: nextPaid ? nowIso : null,
            }
          : o,
      );
      saveStoredOrders(next);
      return next;
    });

    const res = await updateOrderStatusInSupabase(order, {
      isPaid: nextPaid,
    });
    if (res.errorMessage) {
      setOrdersNotice(
        `Đã cập nhật trên máy nhưng chưa lưu lên Supabase (${res.errorMessage}).`,
      );
    }
  };

  const handleChangeStatus = async (
    order: OrderRecord,
    nextStatus: OrderLifecycleStatus,
  ) => {
    const nowIso = new Date().toISOString();
    const shouldBeConfirmed =
      nextStatus === 'confirmed' ||
      nextStatus === 'shipping' ||
      nextStatus === 'completed'
        ? true
        : nextStatus === 'pending'
          ? false
          : order.isConfirmed;

    setOrders((prev) => {
      const next = prev.map((o) =>
        o.orderCode === order.orderCode
          ? {
              ...o,
              status: nextStatus,
              isConfirmed: shouldBeConfirmed,
              confirmedAt: shouldBeConfirmed ? o.confirmedAt ?? nowIso : null,
            }
          : o,
      );
      saveStoredOrders(next);
      return next;
    });

    const res = await updateOrderStatusInSupabase(order, {
      status: nextStatus,
      isConfirmed: shouldBeConfirmed,
    });
    if (res.errorMessage) {
      setOrdersNotice(
        `Đã cập nhật trên máy nhưng chưa lưu lên Supabase (${res.errorMessage}).`,
      );
    }
  };

  const handleAdminSignIn = async (email: string, password: string) => {
    const res = await signInAdminUser(email, password);
    if (!res.user) {
      return { ok: false, errorMessage: res.errorMessage };
    }
    setAdminUser(res.user);
    await syncAuthorizedDataForUser(res.user);
    return { ok: true };
  };

  const handleAdminSignOut = async () => {
    await signOutAdminUser();
    setAdminUser(null);
    setCustomers([]);
    setAdminCategories([]);
    setAdminProducts([]);
    setPurchaseOrders([]);
    setAdminUsers([]);
  };

  const handleNavigateShop = () => {
    if (
      window.location.hash.startsWith('#/admin') ||
      window.location.hash.startsWith('#/orders')
    ) {
      window.location.hash = '#hero';
    }
    setCurrentPage('shop');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenAdminPortal = (tab: AdminTab = 'orders') => {
    const targetHash = tab === 'orders' ? '#/admin' : `#/admin/${tab}`;
    window.location.hash = targetHash;
    setCurrentPage('admin');
    setAdminTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (adminUser) {
      void syncAuthorizedDataForUser(adminUser);
    }
  };

  const handleSelectAdminTab = (tab: AdminTab) => {
    const targetHash = tab === 'orders' ? '#/admin' : `#/admin/${tab}`;
    window.location.hash = targetHash;
    setAdminTab(tab);
  };

  const handleRefreshAdminProducts = async () => {
    await Promise.all([syncAdminInventory(), syncCatalog(false)]);
  };

  const handleRefreshPurchases = async () => {
    await Promise.all([
      syncPurchaseOrders(),
      syncAdminInventory(),
      syncCatalog(false),
    ]);
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

    if (currentPage !== 'shop') {
      window.location.hash = '#catalog';
      setCurrentPage('shop');
      window.setTimeout(() => {
        document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else {
      document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const hasMobileCartBar =
    currentPage === 'shop' && cartSummary.itemCount > 0 && !isCartOpen;
  const isAuthenticated = Boolean(adminUser);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        categories={availableCategories}
        cartCount={cartSummary.itemCount}
        cartSubtotal={cartSummary.subtotal}
        isAuthenticated={isAuthenticated}
        onOpenCart={() => setIsCartOpen(true)}
        onSelectNavCategory={handleSelectNavCategory}
        onNavigateShop={handleNavigateShop}
        onOpenAdminPortal={() => handleOpenAdminPortal('orders')}
      />

      <main className="flex-1">
        {currentPage === 'admin' ? (
          <AdminPortal
            requestedTab={adminTab}
            adminUser={adminUser}
            isCheckingAuth={isCheckingAuth}
            onSignIn={handleAdminSignIn}
            onSignOut={handleAdminSignOut}
            onSelectTab={handleSelectAdminTab}
            onBackToShop={handleNavigateShop}
            orders={orders}
            posProducts={
              adminProducts.length > 0
                ? adminProducts.filter((p) => p.isActive !== false)
                : catalogProducts
            }
            isLoadingOrders={isLoadingOrders}
            ordersNotice={ordersNotice}
            onRefreshOrders={() => void syncOrders()}
            onToggleOrderConfirm={(o) => void handleToggleConfirm(o)}
            onToggleOrderPaid={(o) => void handleTogglePaid(o)}
            onChangeOrderStatus={(o, status) =>
              void handleChangeStatus(o, status)
            }
            onCreateOrder={handleOrderConfirmed}
            customers={customers}
            isLoadingCustomers={isLoadingCustomers}
            customersNotice={customersNotice}
            onRefreshCustomers={syncCustomers}
            adminProducts={adminProducts}
            adminCategories={adminCategories}
            isLoadingAdminProducts={isLoadingAdminProducts}
            adminProductsNotice={adminProductsNotice}
            onRefreshAdminProducts={handleRefreshAdminProducts}
            purchaseOrders={purchaseOrders}
            isLoadingPurchases={isLoadingPurchases}
            purchasesNotice={purchasesNotice}
            onRefreshPurchases={handleRefreshPurchases}
            adminUsers={adminUsers}
            isLoadingUsers={isLoadingUsers}
            usersNotice={usersNotice}
            onRefreshUsers={async () => {
              await syncAdminUsers();
              const updated = await getAdminSessionUser();
              if (updated) {
                setAdminUser(updated);
              }
            }}
          />
        ) : (
          <>
            <HeroSection onExploreCatalog={handleExploreCatalog} />

            <CatalogSection
              products={filteredProducts}
              allProductsCount={catalogProducts.length}
              categories={availableCategories}
              categoryTree={categoryTree}
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

            <StoreInfoSection
              lastOrder={lastOrder}
              onOpenCart={() => setIsCartOpen(true)}
            />
          </>
        )}
      </main>

      <Footer
        isAuthenticated={isAuthenticated}
        onOpenAdminPortal={() => handleOpenAdminPortal('orders')}
        onSignOut={() => void handleAdminSignOut()}
      />

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
        isAuthenticated={isAuthenticated}
        customers={customers}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onClearCart={() => setCartItems([])}
        onOrderConfirmed={(order) => void handleOrderConfirmed(order)}
      />
    </div>
  );
}

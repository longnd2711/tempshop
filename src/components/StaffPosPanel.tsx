import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  Barcode,
  CheckCircle2,
  CornerDownLeft,
  Minus,
  Percent,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  CheckoutErrors,
  CustomerRecord,
  DeliveryMethod,
  OrderRecord,
  PaymentMethod,
  PosDraftTab,
  Product,
} from '../types/shop';
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
  resolvePosQtyInputCommit,
  savePosTabsState,
  searchPosProducts,
  setPosItemQuantity,
  syncOrderDiscountFromAmount,
  syncOrderDiscountFromPercent,
} from '../utils/posLogic';
import {
  formatVnd,
  normalizeVietnameseText,
  validateCheckoutForm,
} from '../utils/shopLogic';
import { BankTransferQR } from './BankTransferQR';
import { SafeImage } from './SafeImage';

interface StaffPosPanelProps {
  products: Product[];
  customers: CustomerRecord[];
  onCreateOrder: (order: OrderRecord) => Promise<{
    synced: boolean;
    errorMessage?: string;
  }>;
  onDraftTabCountChange?: (count: number) => void;
}

export function StaffPosPanel({
  products,
  customers,
  onCreateOrder,
  onDraftTabCountChange,
}: StaffPosPanelProps) {
  const initialState = useMemo(() => loadPosTabsState(), []);
  const [tabs, setTabs] = useState<PosDraftTab[]>(initialState.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(
    initialState.activeTabId,
  );

  const [productQuery, setProductQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingVariant, setPendingVariant] = useState<string>('Tiêu chuẩn');
  const [pendingQtyInput, setPendingQtyInput] = useState<string>('');
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);

  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );

  useEffect(() => {
    savePosTabsState(tabs, activeTab.id);
    onDraftTabCountChange?.(tabs.length);
  }, [tabs, activeTab.id, onDraftTabCountChange]);

  useEffect(() => {
    setErrors({});
  }, [activeTab.id]);

  const productCategories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const p of products) {
      const cat = (p.categoryLabel || p.category || '').trim();
      if (cat && !seen.has(cat)) {
        seen.add(cat);
        list.push(cat);
      }
    }
    return list.sort((a, b) => a.localeCompare(b, 'vi'));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const base =
      categoryFilter === 'all'
        ? products
        : products.filter(
            (p) => (p.categoryLabel || p.category || '').trim() === categoryFilter,
          );
    return searchPosProducts(base, productQuery);
  }, [products, categoryFilter, productQuery]);

  const matchingCustomers = useMemo(() => {
    const clean = normalizeVietnameseText(customerSearch);
    if (!clean) {
      return customers.slice(0, 6);
    }
    return customers
      .filter((c) => {
        const hay = normalizeVietnameseText(
          `${c.fullName} ${c.phone} ${c.defaultAddress} ${c.notes}`,
        );
        return hay.includes(clean);
      })
      .slice(0, 6);
  }, [customers, customerSearch]);

  const selectedCustomerRecord = useMemo(() => {
    const cleanPhone = activeTab.phone.replace(/[\s.-]/g, '').trim();
    if (activeTab.customerId) {
      const byId = customers.find((c) => c.id === activeTab.customerId);
      if (byId) return byId;
    }
    if (cleanPhone.length >= 4) {
      return customers.find((c) => c.phone === cleanPhone) ?? null;
    }
    return null;
  }, [customers, activeTab.customerId, activeTab.phone]);

  const totals = useMemo(
    () => calculatePosOrderTotals(activeTab.items, activeTab.discountAmount),
    [activeTab.items, activeTab.discountAmount],
  );

  const updateActiveTab = (updater: (prev: PosDraftTab) => PosDraftTab) => {
    setTabs((prevTabs) =>
      prevTabs.map((tab) => (tab.id === activeTab.id ? updater(tab) : tab)),
    );
  };

  const focusSearchInput = () => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  };

  const focusQtyInput = () => {
    window.requestAnimationFrame(() => {
      qtyInputRef.current?.focus();
    });
  };

  const handleAddTab = () => {
    const nextTab = createNewPosTab(tabs.length + 1);
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
    setPendingProduct(null);
    setPendingQtyInput('');
    setProductQuery('');
    setSubmitMessage(null);
    focusSearchInput();
  };

  const handleCloseTab = (tabId: string) => {
    const next = closePosTab(tabs, activeTab.id, tabId);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    setPendingProduct(null);
    setPendingQtyInput('');
  };

  const commitProductToActiveTab = (
    product: Product,
    variant: string,
    quantity: number,
  ) => {
    updateActiveTab((tab) => {
      const nextItems = addPosItemToDraft(tab.items, product, variant, quantity);
      const nextTotals = calculatePosOrderTotals(nextItems, tab.discountAmount);
      return {
        ...tab,
        items: nextItems,
        discountAmount: nextTotals.discountAmount,
        discountPercent: nextTotals.discountPercent,
      };
    });
  };

  const stageProductForQuantity = (product: Product) => {
    setPendingProduct(product);
    setPendingVariant(product.variants[0] ?? 'Tiêu chuẩn');
    setPendingQtyInput('');
    setScanFeedback(null);
    focusQtyInput();
  };

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const exact = findExactProductByCode(products, productQuery);
    const matched = exact ?? (productQuery.trim() ? filteredProducts[0] : null);
    if (!matched) {
      setScanFeedback(
        productQuery.trim()
          ? `Không tìm thấy sản phẩm khớp "${productQuery.trim()}".`
          : null,
      );
      return;
    }

    stageProductForQuantity(matched);
  };

  const commitPendingAndClear = (quantity: number) => {
    if (!pendingProduct) return;
    commitProductToActiveTab(pendingProduct, pendingVariant, quantity);
    setScanFeedback(
      `Đã thêm ${quantity} × ${pendingProduct.name} vào đơn.`,
    );
    setPendingProduct(null);
    setPendingQtyInput('');
    setProductQuery('');
    focusSearchInput();
  };

  const handleQtyChange = (rawValue: string) => {
    if (!pendingProduct) return;

    // Guard against trailing space inserted by some virtual/IME keyboards
    if (rawValue.endsWith(' ')) {
      const cleaned = rawValue.slice(0, -1);
      const analysisBeforeSpace = analyzePosQtyInputChange(cleaned, products);
      if (analysisBeforeSpace.kind === 'barcode-scan') {
        commitProductToActiveTab(pendingProduct, pendingVariant, 1);
        stageProductForQuantity(analysisBeforeSpace.product);
        return;
      }
      const { quantity } = resolvePosQtyInputCommit(cleaned);
      commitPendingAndClear(quantity);
      return;
    }

    const analysis = analyzePosQtyInputChange(rawValue, products);
    if (analysis.kind === 'barcode-scan') {
      commitProductToActiveTab(pendingProduct, pendingVariant, 1);
      setScanFeedback(
        `Đã thêm 1 × ${pendingProduct.name} · Đang chờ số lượng cho ${analysis.product.name}`,
      );
      setPendingProduct(analysis.product);
      setPendingVariant(analysis.product.variants[0] ?? 'Tiêu chuẩn');
      setPendingQtyInput('');
      focusQtyInput();
      return;
    }

    if (analysis.kind === 'switch-to-search') {
      commitProductToActiveTab(pendingProduct, pendingVariant, 1);
      setScanFeedback(
        `Đã thêm 1 × ${pendingProduct.name} và chuyển sang tìm "${analysis.query.trim()}".`,
      );
      setPendingProduct(null);
      setPendingQtyInput('');
      setProductQuery(analysis.query);
      focusSearchInput();
      return;
    }

    setPendingQtyInput(rawValue);
  };

  const handleQtyKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!pendingProduct) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setPendingProduct(null);
      setPendingQtyInput('');
      focusSearchInput();
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const analysis = analyzePosQtyInputChange(pendingQtyInput, products);
      if (analysis.kind === 'barcode-scan') {
        commitProductToActiveTab(pendingProduct, pendingVariant, 1);
        setScanFeedback(
          `Đã thêm 1 × ${pendingProduct.name} · Đang chờ số lượng cho ${analysis.product.name}`,
        );
        setPendingProduct(analysis.product);
        setPendingVariant(analysis.product.variants[0] ?? 'Tiêu chuẩn');
        setPendingQtyInput('');
        focusQtyInput();
        return;
      }

      const { valid, quantity } = resolvePosQtyInputCommit(pendingQtyInput);
      if (!valid) {
        setScanFeedback('Số lượng phải lớn hơn 0.');
        return;
      }
      commitPendingAndClear(quantity);
    }
  };

  const handleUpdateLineQty = (
    productId: string,
    variant: string,
    nextQuantity: number,
  ) => {
    updateActiveTab((tab) => {
      const nextItems = setPosItemQuantity(
        tab.items,
        productId,
        variant,
        nextQuantity,
      );
      const nextTotals = calculatePosOrderTotals(nextItems, tab.discountAmount);
      return {
        ...tab,
        items: nextItems,
        discountAmount: nextTotals.discountAmount,
        discountPercent: nextTotals.discountPercent,
      };
    });
  };

  const handleDiscountPercentChange = (raw: string) => {
    const num = Number(raw);
    const synced = syncOrderDiscountFromPercent(
      totals.subtotal,
      Number.isFinite(num) ? num : 0,
    );
    updateActiveTab((tab) => ({
      ...tab,
      discountPercent: synced.discountPercent,
      discountAmount: synced.discountAmount,
    }));
  };

  const handleDiscountAmountChange = (raw: string) => {
    const cleanNum = Number(raw.replace(/[^\d]/g, ''));
    const synced = syncOrderDiscountFromAmount(
      totals.subtotal,
      Number.isFinite(cleanNum) ? cleanNum : 0,
    );
    updateActiveTab((tab) => ({
      ...tab,
      discountPercent: synced.discountPercent,
      discountAmount: synced.discountAmount,
    }));
  };

  const handleSelectCustomer = (customer: CustomerRecord) => {
    updateActiveTab((tab) => ({
      ...tab,
      customerId: customer.id,
      customerName: customer.fullName || tab.customerName || 'Khách lẻ',
      phone: customer.phone,
      address:
        tab.deliveryMethod === 'delivery'
          ? customer.defaultAddress || tab.address
          : customer.defaultAddress || tab.address || 'Tại quầy',
    }));
    setCustomerSearch('');
    setShowCustomerDropdown(false);
    setErrors({});
  };

  const handleDeliveryMethodChange = (method: DeliveryMethod) => {
    updateActiveTab((tab) => ({
      ...tab,
      deliveryMethod: method,
      address:
        method === 'pickup'
          ? tab.address.trim() || 'Tại quầy'
          : tab.address.trim() === 'Tại quầy'
            ? selectedCustomerRecord?.defaultAddress ?? ''
            : tab.address,
    }));
    setErrors((prev) => ({ ...prev, address: undefined }));
  };

  const handleSubmitTabOrder = async (
    markConfirmedAndPaid: boolean,
    e?: FormEvent,
  ) => {
    e?.preventDefault();
    if (activeTab.items.length === 0) {
      setSubmitMessage({
        type: 'error',
        text: 'Đơn hàng đang trống. Vui lòng chọn ít nhất 1 sản phẩm.',
      });
      return;
    }

    const validationErrors = validateCheckoutForm(
      {
        customerName: activeTab.customerName,
        phone: activeTab.phone,
        address: activeTab.address,
        note: activeTab.note,
        deliveryMethod: activeTab.deliveryMethod,
        paymentMethod: activeTab.paymentMethod,
      },
      { allowEmptyPhone: true },
    );

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      const orderRecord = buildOrderRecordFromPosTab(activeTab, {
        markConfirmedAndPaid,
      });
      const result = await onCreateOrder(orderRecord);
      const closedTabCode = orderRecord.orderCode;
      const nextState = closePosTab(tabs, activeTab.id, activeTab.id);
      setTabs(nextState.tabs);
      setActiveTabId(nextState.activeTabId);
      setPendingProduct(null);
      setPendingQtyInput('');
      setProductQuery('');

      if (result.synced) {
        setSubmitMessage({
          type: 'success',
          text: markConfirmedAndPaid
            ? `Đã lưu & hoàn tất thanh toán đơn ${closedTabCode} (${formatVnd(orderRecord.total)}).`
            : `Đã tạo đơn ${closedTabCode} (${formatVnd(orderRecord.total)}) ở trạng thái Chờ xử lý.`,
        });
      } else {
        setSubmitMessage({
          type: 'warning',
          text: `Đã tạo đơn ${closedTabCode} trên máy nhưng chưa đồng bộ Supabase${
            result.errorMessage ? ` (${result.errorMessage})` : ''
          }.`,
        });
      }
      focusSearchInput();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="staff-pos-workspace" className="space-y-4">
      {/* Multi-tab bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-2.5 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Các đơn hàng đang soạn song song"
          className="flex flex-wrap items-center gap-2 flex-1 min-w-0"
        >
          {tabs.map((tab, idx) => {
            const isActive = tab.id === activeTab.id;
            const tabTotals = calculatePosOrderTotals(
              tab.items,
              tab.discountAmount,
            );
            const tabTitle = formatPosTabDisplayTitle(tab, idx);
            return (
              <div
                key={tab.id}
                className={`inline-flex items-center max-w-full rounded-lg border ${
                  isActive
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTabId(tab.id)}
                  className="inline-flex items-center gap-2 min-w-0 min-h-[40px] pl-3 pr-2 py-1.5 text-xs sm:text-sm font-semibold whitespace-nowrap cursor-pointer"
                >
                  <span className="max-w-[130px] sm:max-w-[160px] truncate">{tabTitle}</span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      isActive ? 'text-blue-100' : 'text-slate-600'
                    }`}
                  >
                    {tabTotals.itemCount} món · {formatVnd(tabTotals.total)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCloseTab(tab.id)}
                  aria-label={`Đóng ${tabTitle}`}
                  title={`Đóng ${tabTitle}`}
                  className={`inline-flex items-center justify-center w-8 h-8 mr-1 rounded-md cursor-pointer ${
                    isActive
                      ? 'text-blue-100 hover:bg-blue-800 hover:text-white'
                      : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800'
                  }`}
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleAddTab}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Thêm tab đơn</span>
        </button>
      </div>

      {submitMessage && (
        <div
          role={submitMessage.type === 'error' ? 'alert' : 'status'}
          className={`px-4 py-3 text-sm rounded-xl border flex items-center justify-between gap-3 ${
            submitMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : submitMessage.type === 'warning'
                ? 'bg-amber-50 text-amber-900 border-amber-200'
                : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          <span>{submitMessage.text}</span>
          <button
            type="button"
            onClick={() => setSubmitMessage(null)}
            aria-label="Đóng thông báo"
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 2-column POS workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Search / Barcode scan + Quick Quantity + Product grid */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <label htmlFor="pos-product-search" className="sr-only">
                Tìm theo tên, SKU hoặc quét mã vạch
              </label>
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="pos-product-search"
                ref={searchInputRef}
                type="search"
                value={productQuery}
                onChange={(e) => {
                  setProductQuery(e.target.value);
                  setScanFeedback(null);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Tìm tên, SKU, mã vạch (Enter chọn)..."
                className="w-full min-h-[44px] pl-10 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
              />
              {productQuery && (
                <button
                  type="button"
                  onClick={() => setProductQuery('')}
                  aria-label="Xóa tìm kiếm sản phẩm"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="sm:w-48 shrink-0">
              <label htmlFor="pos-category-filter" className="sr-only">
                Lọc theo nhóm hàng
              </label>
              <select
                id="pos-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
              >
                <option value="all">Tất cả nhóm hàng</option>
                {productCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Pending Product -> Fast Quantity / Space / Enter / Next Scan Bar */}
          {pendingProduct && (
            <div
              data-testid="pos-qty-bar"
              className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-blue-800">
                    Đang chọn sản phẩm · Nhập số lượng hoặc bấm Cách / Enter / quét mã tiếp để thêm 1
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-slate-900 truncate">
                    {pendingProduct.name}
                  </p>
                  <p className="text-xs text-slate-600 tabular-nums">
                    SKU: <span className="font-mono">{pendingProduct.sku}</span>
                    {pendingProduct.barcode ? (
                      <>
                        {' '}
                        · Mã vạch:{' '}
                        <span className="font-mono">{pendingProduct.barcode}</span>
                      </>
                    ) : null}{' '}
                    · Giá bán:{' '}
                    <strong className="text-slate-900">
                      {formatVnd(pendingProduct.price)}
                    </strong>
                    /{pendingProduct.unit}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingProduct(null);
                    setPendingQtyInput('');
                    focusSearchInput();
                  }}
                  aria-label="Hủy chọn sản phẩm này"
                  className="w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg hover:bg-blue-100 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {pendingProduct.variants.length > 1 && (
                  <div className="min-w-[140px]">
                    <label htmlFor="pos-pending-variant" className="sr-only">
                      Chọn phân loại
                    </label>
                    <select
                      id="pos-pending-variant"
                      value={pendingVariant}
                      onChange={(e) => setPendingVariant(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-blue-200 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700 cursor-pointer"
                    >
                      {pendingProduct.variants.map((variant) => (
                        <option key={variant} value={variant}>
                          {variant}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-1 min-w-[190px]">
                  <label
                    htmlFor="pos-qty-input"
                    className="text-xs font-semibold text-slate-700 whitespace-nowrap"
                  >
                    Số lượng:
                  </label>
                  <input
                    id="pos-qty-input"
                    ref={qtyInputRef}
                    type="text"
                    inputMode="decimal"
                    value={pendingQtyInput}
                    onChange={(e) => handleQtyChange(e.target.value)}
                    onKeyDown={handleQtyKeyDown}
                    placeholder="1 (Cách / Enter = 1)"
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono font-semibold tabular-nums bg-white border border-blue-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const { valid, quantity } =
                      resolvePosQtyInputCommit(pendingQtyInput);
                    if (!valid) {
                      setScanFeedback('Số lượng phải lớn hơn 0.');
                      return;
                    }
                    commitPendingAndClear(quantity);
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CornerDownLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>
                    Thêm ({resolvePosQtyInputCommit(pendingQtyInput).quantity})
                  </span>
                </button>
              </div>
            </div>
          )}

          {scanFeedback && (
            <p className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              <Barcode className="w-3.5 h-3.5 text-blue-700 shrink-0" aria-hidden="true" />
              <span>{scanFeedback}</span>
            </p>
          )}

          {/* Product Quick-Pick List */}
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 max-h-[540px] overflow-y-auto">
            {filteredProducts.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <p className="text-sm font-medium text-slate-800">
                  Không tìm thấy sản phẩm phù hợp
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Thử tìm theo từ khóa khác, mã SKU hoặc chọn lại nhóm hàng.
                </p>
              </div>
            ) : (
              filteredProducts.map((product) => {
                const isStaged = pendingProduct?.id === product.id;
                return (
                  <div
                    key={product.id}
                    className={`flex items-center justify-between gap-3 p-2.5 sm:px-3.5 transition-colors ${
                      isStaged ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => stageProductForQuantity(product)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="w-11 h-11 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0">
                        <SafeImage
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {product.name}
                        </p>
                        <p className="text-xs text-slate-500 truncate tabular-nums">
                          <span className="font-mono">{product.sku}</span>
                          {product.barcode ? ` · ${product.barcode}` : ''}
                          {' · '}
                          Tồn: {product.stock} {product.unit}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-blue-700 tabular-nums">
                          {formatVnd(product.price)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          /{product.unit}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        commitProductToActiveTab(
                          product,
                          product.variants[0] ?? 'Tiêu chuẩn',
                          1,
                        );
                        setScanFeedback(`Đã thêm nhanh 1 × ${product.name}.`);
                      }}
                      aria-label={`Thêm nhanh 1 ${product.name}`}
                      title="Thêm nhanh +1"
                      className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] px-2.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors shrink-0 cursor-pointer"
                    >
                      +1
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: Active tab cart, order discount, customer info, payment */}
        <form
          onSubmit={(e) => void handleSubmitTabOrder(true, e)}
          noValidate
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-display text-base sm:text-lg font-bold text-slate-900">
                Đơn hàng đang soạn
              </h3>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                Mã đơn: {activeTab.orderCode}
              </p>
            </div>
            {activeTab.items.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  updateActiveTab((tab) => ({
                    ...tab,
                    items: [],
                    discountAmount: 0,
                    discountPercent: 0,
                  }))
                }
                className="text-xs font-medium text-rose-600 hover:text-rose-800 cursor-pointer"
              >
                Xóa hết món
              </button>
            )}
          </div>

          {/* Line items */}
          {activeTab.items.length === 0 ? (
            <div className="py-8 px-4 text-center border border-dashed border-slate-200 rounded-xl">
              <ShoppingBag
                className="w-7 h-7 text-slate-300 mx-auto mb-2"
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-slate-700">
                Chưa có sản phẩm nào trong tab này
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Chọn sản phẩm hoặc quét mã vạch ở khung bên trái để lên đơn.
              </p>
            </div>
          ) : (
            <ul
              data-testid="pos-cart-items"
              className="divide-y divide-slate-200 max-h-[260px] overflow-y-auto border border-slate-200 rounded-xl"
            >
              {activeTab.items.map((item) => (
                <li
                  key={`${item.productId}-${item.variant}`}
                  className="p-3 flex items-start justify-between gap-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 leading-snug">
                      {item.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                      {item.variant && item.variant !== 'Tiêu chuẩn'
                        ? `${item.variant} · `
                        : ''}
                      {formatVnd(item.unitPrice)}/{item.unit}
                    </p>

                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateLineQty(
                            item.productId,
                            item.variant,
                            item.quantity - 1,
                          )
                        }
                        aria-label={`Giảm số lượng ${item.name}`}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>

                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        aria-label={`Số lượng ${item.name}`}
                        value={item.quantity}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          if (Number.isFinite(parsed) && parsed > 0) {
                            handleUpdateLineQty(
                              item.productId,
                              item.variant,
                              parsed,
                            );
                          }
                        }}
                        className="w-16 h-8 px-2 text-center text-xs font-mono font-semibold tabular-nums border border-slate-300 rounded-md text-slate-900 focus:outline-2 focus:outline-blue-700"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateLineQty(
                            item.productId,
                            item.variant,
                            item.quantity + 1,
                          )
                        }
                        aria-label={`Tăng số lượng ${item.name}`}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdateLineQty(item.productId, item.variant, 0)
                      }
                      aria-label={`Xóa ${item.name} khỏi đơn`}
                      className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <span className="text-sm font-bold text-slate-900 tabular-nums">
                      {formatVnd(item.unitPrice * item.quantity)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Order-level Discount & Summary */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-sm">
            <div className="flex items-center justify-between text-slate-600">
              <span>Tạm tính ({totals.itemCount} món)</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {formatVnd(totals.subtotal)}
              </span>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  Giảm giá toàn đơn
                </span>
                {totals.discountAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDiscountAmountChange('0')}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                  >
                    Đặt lại 0đ
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="pos-discount-percent"
                    className="block text-[11px] text-slate-500 mb-1"
                  >
                    Giảm (%)
                  </label>
                  <div className="relative">
                    <input
                      id="pos-discount-percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      disabled={totals.subtotal <= 0}
                      value={activeTab.discountPercent || ''}
                      placeholder="0"
                      onChange={(e) => handleDiscountPercentChange(e.target.value)}
                      className="w-full min-h-[38px] pl-2.5 pr-7 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700 disabled:bg-slate-100"
                    />
                    <Percent
                      className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="pos-discount-amount"
                    className="block text-[11px] text-slate-500 mb-1"
                  >
                    Giảm (đ)
                  </label>
                  <input
                    id="pos-discount-amount"
                    type="number"
                    min="0"
                    max={totals.subtotal}
                    step="1000"
                    disabled={totals.subtotal <= 0}
                    value={activeTab.discountAmount || ''}
                    placeholder="0"
                    onChange={(e) => handleDiscountAmountChange(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700 disabled:bg-slate-100"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-200 flex items-center justify-between">
              <span className="font-semibold text-slate-900">Tổng thanh toán</span>
              <span
                data-testid="pos-order-total"
                className="font-display text-lg font-bold text-blue-700 tabular-nums"
              >
                {formatVnd(totals.total)}
              </span>
            </div>
          </div>

          {/* Customer Quick Lookup + Fields */}
          <div className="space-y-3">
            <div className="relative">
              <label
                htmlFor="pos-customer-lookup"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Chọn nhanh khách hàng quen (nếu có)
              </label>
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="pos-customer-lookup"
                  type="search"
                  value={customerSearch}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  placeholder="Tìm SĐT hoặc tên khách quen..."
                  className="w-full min-h-[40px] pl-9 pr-8 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                />
                {showCustomerDropdown && (
                  <button
                    type="button"
                    onClick={() => setShowCustomerDropdown(false)}
                    aria-label="Đóng danh sách gợi ý khách hàng"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {showCustomerDropdown && matchingCustomers.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                  {matchingCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => handleSelectCustomer(customer)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors cursor-pointer"
                    >
                      <p className="text-xs font-semibold text-slate-900">
                        {customer.fullName || 'Khách hàng'} ·{' '}
                        <span className="font-mono text-blue-700">
                          {customer.phone}
                        </span>
                      </p>
                      {customer.defaultAddress && (
                        <p className="text-[11px] text-slate-500 truncate">
                          {customer.defaultAddress}
                        </p>
                      )}
                      {customer.notes && (
                        <p className="text-[11px] text-amber-700 truncate">
                          Lưu ý: {customer.notes}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedCustomerRecord && selectedCustomerRecord.notes && (
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                <UserCheck className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden="true" />
                <div>
                  <span className="font-semibold">Lưu ý khách hàng:</span>{' '}
                  {selectedCustomerRecord.notes}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="pos-customer-name"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Tên người nhận
                </label>
                <input
                  id="pos-customer-name"
                  type="text"
                  value={activeTab.customerName}
                  onChange={(e) =>
                    updateActiveTab((tab) => ({
                      ...tab,
                      customerName: e.target.value,
                    }))
                  }
                  placeholder="Khách lẻ"
                  className="w-full min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
                />
              </div>

              <div>
                <label
                  htmlFor="pos-customer-phone"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Số điện thoại (không bắt buộc)
                </label>
                <input
                  id="pos-customer-phone"
                  type="tel"
                  value={activeTab.phone}
                  onChange={(e) => {
                    updateActiveTab((tab) => ({
                      ...tab,
                      phone: e.target.value,
                      customerId: null,
                    }));
                    setErrors((prev) => ({ ...prev, phone: undefined }));
                  }}
                  placeholder="Để trống nếu khách lẻ"
                  className={`w-full min-h-[40px] px-3 py-1.5 text-sm bg-white border rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700 ${
                    errors.phone ? 'border-rose-500' : 'border-slate-300'
                  }`}
                />
                {errors.phone && (
                  <p className="mt-1 text-xs text-rose-600">{errors.phone}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDeliveryMethodChange('pickup')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  activeTab.deliveryMethod === 'pickup'
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Mua tại quầy
              </button>
              <button
                type="button"
                onClick={() => handleDeliveryMethodChange('delivery')}
                className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  activeTab.deliveryMethod === 'delivery'
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Giao tận nơi
              </button>
            </div>

            <div>
              <label
                htmlFor="pos-customer-address"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Địa chỉ nhận / giao hàng
              </label>
              <input
                id="pos-customer-address"
                type="text"
                value={activeTab.address}
                onChange={(e) => {
                  updateActiveTab((tab) => ({
                    ...tab,
                    address: e.target.value,
                  }));
                  setErrors((prev) => ({ ...prev, address: undefined }));
                }}
                placeholder={
                  activeTab.deliveryMethod === 'pickup'
                    ? 'Tại quầy'
                    : 'Ví dụ: CT2.1111 Green Star'
                }
                className={`w-full min-h-[40px] px-3 py-1.5 text-sm bg-white border rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700 ${
                  errors.address ? 'border-rose-500' : 'border-slate-300'
                }`}
              />
              {errors.address && (
                <p className="mt-1 text-xs text-rose-600">{errors.address}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="pos-order-note"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Ghi chú đơn hàng
              </label>
              <input
                id="pos-order-note"
                type="text"
                value={activeTab.note}
                onChange={(e) =>
                  updateActiveTab((tab) => ({
                    ...tab,
                    note: e.target.value,
                  }))
                }
                placeholder="Ghi chú giao giờ nào, bọc quà..."
                className="w-full min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-700 mb-1.5">
                Hình thức thanh toán
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'cod', label: 'Tiền mặt / COD' },
                    { id: 'transfer', label: 'Chuyển khoản VietQR' },
                  ] as Array<{ id: PaymentMethod; label: string }>
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        paymentMethod: option.id,
                      }))
                    }
                    className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                      activeTab.paymentMethod === option.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {activeTab.paymentMethod === 'transfer' && totals.total > 0 && (
              <div className="pt-1">
                <BankTransferQR
                  amount={totals.total}
                  orderId={activeTab.orderCode}
                />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isSubmitting || activeTab.items.length === 0}
              onClick={() => void handleSubmitTabOrder(false)}
              className="min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              Lưu đơn (Chờ xử lý)
            </button>
            <button
              type="submit"
              disabled={isSubmitting || activeTab.items.length === 0}
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {isSubmitting ? 'Đang lưu...' : 'Thu tiền & Hoàn tất'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

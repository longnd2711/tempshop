import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Filter,
  Search,
  X,
} from 'lucide-react';
import type {
  CategoryNode,
  OrderRecord,
  Product,
  RevenuePeriodMode,
  UserRole,
} from '../types/shop';
import {
  buildRevenueChartData,
  canViewAllRevenuePeriods,
  canViewRevenueChart,
  getTodayFullDayPreset,
  getVisibleRevenueModesForRole,
  REVENUE_PERIOD_LABELS,
} from '../utils/adminLogic';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';

interface RevenueChartCardProps {
  orders: OrderRecord[];
  userRole?: UserRole;
  products?: Product[];
  categories?: CategoryNode[];
}

export function RevenueChartCard({
  orders,
  userRole,
  products = [],
  categories = [],
}: RevenueChartCardProps) {
  const isVisibleForRole = canViewRevenueChart(userRole);
  const defaultCustomPreset = useMemo(() => getTodayFullDayPreset(), []);
  const showAllPeriods = canViewAllRevenuePeriods(userRole);
  const visibleModes = useMemo(
    () => getVisibleRevenueModesForRole(userRole),
    [userRole],
  );

  const [mode, setMode] = useState<RevenuePeriodMode>('day');
  const [paidOnly, setPaidOnly] = useState(false);
  const [customStart, setCustomStart] = useState(defaultCustomPreset.start);
  const [customEnd, setCustomEnd] = useState(defaultCustomPreset.end);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(
    null,
  );

  const effectiveMode: RevenuePeriodMode = showAllPeriods ? mode : 'day';

  useEffect(() => {
    if (!showAllPeriods && mode !== 'day') {
      setMode('day');
    }
  }, [showAllPeriods, mode]);

  // Build ordered category choices from category tree + fallback from products
  const categoryOptions = useMemo(() => {
    if (categories.length > 0) {
      const roots = categories
        .filter((c) => !c.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));
      const childrenMap = new Map<string, CategoryNode[]>();
      for (const c of categories) {
        if (c.parentId) {
          const list = childrenMap.get(c.parentId) ?? [];
          list.push(c);
          childrenMap.set(c.parentId, list);
        }
      }
      const ordered: Array<{ id: string; label: string; name: string }> = [];
      const visited = new Set<string>();
      const append = (node: CategoryNode, depth: number) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        ordered.push({
          id: node.id,
          name: node.name,
          label: depth > 0 ? `${'— '.repeat(depth)}${node.name}` : node.name,
        });
        const children = (childrenMap.get(node.id) ?? []).sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
        );
        for (const child of children) {
          append(child, depth + 1);
        }
      };
      for (const r of roots) append(r, 0);
      for (const c of categories) {
        if (!visited.has(c.id)) append(c, 0);
      }
      return ordered;
    }

    const uniqueNames = new Set<string>();
    const fallback: Array<{ id: string; label: string; name: string }> = [];
    for (const p of products) {
      const name = p.categoryLabel || p.category;
      if (name && !uniqueNames.has(name)) {
        uniqueNames.add(name);
        fallback.push({ id: name, label: name, name });
      }
    }
    return fallback.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [categories, products]);

  // Expand selected category IDs to include descendant categories for product picker filtering
  const expandedSelectedCatIds = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    if (selectedCategoryIds.length === 0) {
      return { ids, names };
    }
    const childrenMap = new Map<string, CategoryNode[]>();
    const byId = new Map<string, CategoryNode>();
    for (const c of categories) {
      byId.set(c.id, c);
      if (c.parentId) {
        const list = childrenMap.get(c.parentId) ?? [];
        list.push(c);
        childrenMap.set(c.parentId, list);
      }
    }
    const visit = (id: string) => {
      if (ids.has(id)) return;
      ids.add(id);
      const node = byId.get(id);
      if (node) {
        if (node.name) names.add(normalizeVietnameseText(node.name));
        if (node.slug) names.add(normalizeVietnameseText(node.slug));
      } else {
        names.add(normalizeVietnameseText(id));
      }
      for (const child of childrenMap.get(id) ?? []) {
        visit(child.id);
      }
    };
    for (const cid of selectedCategoryIds) visit(cid);
    return { ids, names };
  }, [selectedCategoryIds, categories]);

  const selectableProducts = useMemo(() => {
    const normQuery = normalizeVietnameseText(productSearchQuery);
    return products
      .filter((p) => {
        if (selectedCategoryIds.length > 0) {
          const catMatch =
            (p.categoryId && expandedSelectedCatIds.ids.has(p.categoryId)) ||
            (p.categorySlug &&
              expandedSelectedCatIds.names.has(normalizeVietnameseText(p.categorySlug))) ||
            (p.category &&
              expandedSelectedCatIds.names.has(normalizeVietnameseText(p.category))) ||
            (p.categoryLabel &&
              expandedSelectedCatIds.names.has(normalizeVietnameseText(p.categoryLabel)));
          if (!catMatch) return false;
        }
        if (!normQuery) return true;
        const hay = normalizeVietnameseText(`${p.sku} ${p.barcode ?? ''} ${p.name}`);
        return hay.includes(normQuery);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [products, productSearchQuery, selectedCategoryIds.length, expandedSelectedCatIds]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const categoryNameById = useMemo(
    () => new Map(categoryOptions.map((c) => [c.id, c.name])),
    [categoryOptions],
  );

  const hasAnalyticsFilter =
    selectedCategoryIds.length > 0 || selectedProductIds.length > 0;

  const chartData = useMemo(
    () =>
      buildRevenueChartData(orders, {
        mode: effectiveMode,
        customStart,
        customEnd,
        paidOnly,
        categoryIds: selectedCategoryIds,
        productIds: selectedProductIds,
        products,
        categories,
      }),
    [
      orders,
      effectiveMode,
      customStart,
      customEnd,
      paidOnly,
      selectedCategoryIds,
      selectedProductIds,
      products,
      categories,
    ],
  );

  useEffect(() => {
    setSelectedBucketKey(null);
  }, [
    effectiveMode,
    customStart,
    customEnd,
    paidOnly,
    selectedCategoryIds,
    selectedProductIds,
  ]);

  const activeBucket = useMemo(() => {
    if (chartData.buckets.length === 0) return null;
    if (selectedBucketKey) {
      const found = chartData.buckets.find((b) => b.key === selectedBucketKey);
      if (found) return found;
    }
    const peak = chartData.buckets.reduce<typeof chartData.buckets[number] | null>(
      (best, curr) => {
        if (!best || curr.revenue > best.revenue) return curr;
        return best;
      },
      null,
    );
    return peak && peak.revenue > 0 ? peak : chartData.buckets[0];
  }, [chartData.buckets, selectedBucketKey]);

  const labelStep = useMemo(() => {
    const count = chartData.buckets.length;
    if (count <= 12) return 1;
    if (count <= 24) return 2;
    return 3;
  }, [chartData.buckets.length]);

  if (!isVisibleForRole) {
    return null;
  }

  const handleAddCategoryFilter = (catId: string) => {
    if (!catId) return;
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev : [...prev, catId],
    );
  };

  const handleRemoveCategoryFilter = (catId: string) => {
    setSelectedCategoryIds((prev) => prev.filter((id) => id !== catId));
  };

  const handleToggleProductFilter = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
  };

  const handleClearAnalyticsFilters = () => {
    setSelectedCategoryIds([]);
    setSelectedProductIds([]);
    setProductSearchQuery('');
  };

  return (
    <section
      aria-labelledby="revenue-chart-heading"
      data-testid="revenue-chart-card"
      className="p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
            <BarChart3 className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3
              id="revenue-chart-heading"
              className="font-display text-base sm:text-lg font-bold text-slate-900"
            >
              Biểu đồ doanh thu
            </h3>
            <p className="text-xs text-slate-500">
              {chartData.rangeLabel} · Loại trừ đơn đã hủy
              {hasAnalyticsFilter ? ' · Đang lọc theo nhóm hàng / sản phẩm' : ''}
            </p>
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none self-start lg:self-auto">
          <input
            type="checkbox"
            checked={paidOnly}
            onChange={(e) => setPaidOnly(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700 cursor-pointer"
          />
          <span>Chỉ tính đơn đã thanh toán</span>
        </label>
      </div>

      <div
        role="group"
        aria-label="Chọn kỳ thống kê doanh thu"
        className="flex flex-wrap items-center gap-2"
      >
        {visibleModes.map((modeId) => {
          const isActive = effectiveMode === modeId;
          return (
            <button
              key={modeId}
              type="button"
              aria-pressed={isActive}
              onClick={() => setMode(modeId)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {REVENUE_PERIOD_LABELS[modeId]}
            </button>
          );
        })}
      </div>

      {effectiveMode === 'custom' && (
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label
              htmlFor="revenue-custom-start"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Từ thời gian
            </label>
            <input
              id="revenue-custom-start"
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
            />
          </div>

          <div className="flex-1 min-w-0">
            <label
              htmlFor="revenue-custom-end"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Đến thời gian
            </label>
            <input
              id="revenue-custom-end"
              type="datetime-local"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
            />
          </div>
        </div>
      )}

      {/* Bộ lọc phân tích theo Nhóm hàng & Hàng hóa */}
      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Filter className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
            <span>Nghiên cứu doanh thu theo nhóm hàng / hàng hóa</span>
          </div>

          {hasAnalyticsFilter && (
            <button
              type="button"
              onClick={handleClearAnalyticsFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md cursor-pointer"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              <span>Xóa lọc nhóm / SP</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="revenue-category-select"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Chọn nhóm hàng (có thể thêm nhiều nhóm)
            </label>
            <select
              id="revenue-category-select"
              value=""
              onChange={(e) => handleAddCategoryFilter(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
            >
              <option value="">
                {selectedCategoryIds.length === 0
                  ? '-- Tất cả nhóm hàng --'
                  : `+ Thêm nhóm hàng (${selectedCategoryIds.length} đang chọn)`}
              </option>
              {categoryOptions.map((cat) => (
                <option
                  key={cat.id}
                  value={cat.id}
                  disabled={selectedCategoryIds.includes(cat.id)}
                >
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <label
              htmlFor="revenue-product-search"
              className="block text-xs font-medium text-slate-600 mb-1"
            >
              Chọn hàng hóa cụ thể ({selectedProductIds.length} đang chọn)
            </label>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="revenue-product-search"
                type="search"
                value={productSearchQuery}
                onFocus={() => setShowProductPicker(true)}
                onChange={(e) => {
                  setProductSearchQuery(e.target.value);
                  setShowProductPicker(true);
                }}
                placeholder="Tìm tên hàng hoặc SKU để tick chọn..."
                className="w-full min-h-[38px] pl-8 pr-20 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
              />
              <button
                type="button"
                onClick={() => setShowProductPicker((prev) => !prev)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
              >
                {showProductPicker ? 'Thu gọn' : 'Chọn SP'}
              </button>
            </div>

            {showProductPicker && (
              <div className="mt-1.5 max-h-52 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-md divide-y divide-slate-100">
                {selectableProducts.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500 text-center">
                    Không có hàng hóa khớp từ khóa / nhóm hàng đang chọn.
                  </p>
                ) : (
                  selectableProducts.slice(0, 80).map((prod) => {
                    const checked = selectedProductIds.includes(prod.id);
                    return (
                      <label
                        key={prod.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-blue-50/60 ${
                          checked ? 'bg-blue-50/70' : ''
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleProductFilter(prod.id)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
                          />
                          <span className="font-mono text-[11px] text-slate-500 shrink-0">
                            {prod.sku}
                          </span>
                          <span className="font-medium text-slate-800 truncate">
                            {prod.name}
                          </span>
                        </span>
                        <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                          {formatVnd(prod.price)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {hasAnalyticsFilter && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {selectedCategoryIds.map((catId) => (
              <span
                key={`cat-${catId}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-md"
              >
                <span>Nhóm: {categoryNameById.get(catId) ?? catId}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCategoryFilter(catId)}
                  aria-label={`Bỏ lọc nhóm ${categoryNameById.get(catId) ?? catId}`}
                  className="text-blue-600 hover:text-blue-900 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}

            {selectedProductIds.map((prodId) => {
              const prod = productById.get(prodId);
              const label = prod ? `${prod.sku} · ${prod.name}` : prodId;
              return (
                <span
                  key={`prod-${prodId}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md"
                >
                  <span className="max-w-[220px] truncate">{label}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleProductFilter(prodId)}
                    aria-label={`Bỏ lọc sản phẩm ${label}`}
                    className="text-emerald-700 hover:text-emerald-950 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500">
            {hasAnalyticsFilter ? 'Doanh thu mặt hàng đã lọc' : 'Doanh thu trong kỳ'}
          </p>
          <p
            data-testid="revenue-period-total"
            className="mt-0.5 font-display text-lg sm:text-xl font-bold text-blue-700 tabular-nums"
          >
            {formatVnd(chartData.totalRevenue)}
          </p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500">
            {hasAnalyticsFilter ? 'Số đơn chứa SP đã lọc' : 'Số đơn trong kỳ'}
          </p>
          <p
            data-testid="revenue-period-count"
            className="mt-0.5 font-display text-lg sm:text-xl font-bold text-slate-900 tabular-nums"
          >
            {chartData.totalOrders} đơn
            {hasAnalyticsFilter && (chartData.matchedQuantity ?? 0) > 0
              ? ` (${chartData.matchedQuantity} SP)`
              : ''}
          </p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500">Trung bình / đơn</p>
          <p className="mt-0.5 font-display text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">
            {formatVnd(chartData.averageOrderValue)}
          </p>
        </div>
      </div>

      {chartData.customRangeInvalid ? (
        <div
          role="alert"
          className="p-6 text-center text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl"
        >
          <CalendarRange
            className="w-6 h-6 mx-auto mb-1.5 text-amber-700"
            aria-hidden="true"
          />
          Thời điểm bắt đầu phải nhỏ hơn hoặc bằng thời điểm kết thúc.
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeBucket && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-blue-50/70 border border-blue-100 rounded-lg text-xs">
              <span className="font-medium text-slate-700">
                Mốc đang xem:{' '}
                <strong className="text-slate-900">{activeBucket.fullLabel}</strong>
              </span>
              <span className="font-semibold text-blue-800 tabular-nums">
                {formatVnd(activeBucket.revenue)} ({activeBucket.orderCount} đơn)
              </span>
            </div>
          )}

          <div
            data-testid="revenue-chart-bars"
            role="img"
            aria-label={`Biểu đồ doanh thu ${chartData.rangeLabel}, tổng ${formatVnd(chartData.totalRevenue)}`}
            className="pt-4 pb-2 px-2 sm:px-3 bg-slate-50/60 border border-slate-200 rounded-xl"
          >
            <div className="h-44 sm:h-52 flex items-end gap-1 sm:gap-1.5 border-b border-slate-300 pb-1">
              {chartData.buckets.map((bucket) => {
                const heightPct =
                  chartData.maxBucketRevenue > 0
                    ? Math.round((bucket.revenue / chartData.maxBucketRevenue) * 100)
                    : 0;
                const isSelected = activeBucket?.key === bucket.key;
                const hasValue = bucket.revenue > 0;

                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => setSelectedBucketKey(bucket.key)}
                    onMouseEnter={() => setSelectedBucketKey(bucket.key)}
                    title={`${bucket.fullLabel}: ${formatVnd(bucket.revenue)} (${bucket.orderCount} đơn)`}
                    aria-label={`${bucket.fullLabel}: ${formatVnd(bucket.revenue)}, ${bucket.orderCount} đơn`}
                    className="group flex-1 min-w-0 h-full flex flex-col justify-end items-center focus:outline-none cursor-pointer"
                  >
                    <div
                      className={`w-full max-w-[34px] rounded-t-md transition-all ${
                        hasValue
                          ? isSelected
                            ? 'bg-blue-700'
                            : 'bg-blue-500 group-hover:bg-blue-600'
                          : isSelected
                            ? 'bg-slate-300'
                            : 'bg-slate-200 group-hover:bg-slate-300'
                      }`}
                      style={{
                        height: hasValue ? `${Math.max(heightPct, 6)}%` : '3px',
                      }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="mt-1.5 flex items-center gap-1 sm:gap-1.5">
              {chartData.buckets.map((bucket, idx) => {
                const showLabel =
                  idx % labelStep === 0 || idx === chartData.buckets.length - 1;
                return (
                  <div
                    key={`${bucket.key}-lbl`}
                    className="flex-1 min-w-0 text-center"
                  >
                    <span
                      className={`block text-[10px] sm:text-[11px] tabular-nums truncate ${
                        activeBucket?.key === bucket.key
                          ? 'font-bold text-blue-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {showLabel ? bucket.label : ''}
                    </span>
                  </div>
                );
              })}
            </div>

            {chartData.totalOrders === 0 && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Chưa có đơn hàng nào khớp bộ lọc trong kỳ đang chọn.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  PlusSquare,
  RefreshCw,
  Search,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import {
  filterOrders,
  type ConfirmFilter,
  type DeliveryFilter,
  type PayFilter,
} from '../lib/supabaseOrders';
import type {
  CategoryNode,
  CustomerRecord,
  OrderRecord,
  Product,
  QuickVoucherDraft,
  UserRole,
} from '../types/shop';
import {
  canViewRevenueChart,
  clampOrderFromDateForRole,
  getOrderDefaultDateRangePreset,
  getOrderPaidAmount,
  getOrderRemainingDebt,
  getStaffMinOrderDateTime,
} from '../utils/adminLogic';
import { loadPosTabsState } from '../utils/posLogic';
import { formatVnd } from '../utils/shopLogic';
import { RevenueChartCard } from './RevenueChartCard';
import { StaffPosPanel } from './StaffPosPanel';

interface OrdersPageProps {
  orders: OrderRecord[];
  products: Product[];
  categories?: CategoryNode[];
  customers: CustomerRecord[];
  userRole?: UserRole;
  isLoading: boolean;
  notice?: string;
  loginNonce?: number;
  posOpenNonce?: number;
  onRefresh: () => void;
  onBackToShop: () => void;
  onToggleConfirm: (order: OrderRecord) => void;
  onToggleDelivered: (order: OrderRecord) => void;
  onTogglePaid: (order: OrderRecord) => void;
  onOpenCashVoucher?: (draft: QuickVoucherDraft) => void;
  onCreateOrder: (order: OrderRecord) => Promise<{
    synced: boolean;
    errorMessage?: string;
  }>;
  onUpdateOrder: (order: OrderRecord) => Promise<{
    synced: boolean;
    errorMessage?: string;
  }>;
}

export function OrdersPage({
  orders,
  products,
  categories = [],
  customers,
  userRole,
  isLoading,
  notice,
  loginNonce = 0,
  posOpenNonce = 0,
  onRefresh,
  onBackToShop,
  onToggleConfirm,
  onToggleDelivered,
  onTogglePaid,
  onOpenCashVoucher,
  onCreateOrder,
  onUpdateOrder,
}: OrdersPageProps) {
  const [viewMode, setViewMode] = useState<'list' | 'pos'>('pos');
  const [draftTabCount, setDraftTabCount] = useState<number>(
    () => loadPosTabsState().tabs.length,
  );
  const [orderToOpenInPos, setOrderToOpenInPos] = useState<{
    order: OrderRecord;
    nonce: number;
  } | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (loginNonce > 0 || posOpenNonce > 0) {
      setViewMode('pos');
    }
  }, [loginNonce, posOpenNonce]);

  const defaultDateRange = useMemo(() => getOrderDefaultDateRangePreset(), []);
  const staffMinDateTime = useMemo(() => getStaffMinOrderDateTime(), []);

  const [dateFrom, setDateFrom] = useState(defaultDateRange.from);
  const [dateTo, setDateTo] = useState(defaultDateRange.to);
  const [dateClampNotice, setDateClampNotice] = useState<string | null>(null);
  const [confirmFilter, setConfirmFilter] = useState<ConfirmFilter>('all');
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all');
  const [payFilter, setPayFilter] = useState<PayFilter>('all');

  useEffect(() => {
    if (userRole === 'staff') {
      const clamped = clampOrderFromDateForRole(dateFrom, userRole);
      if (clamped !== dateFrom) {
        setDateFrom(clamped);
      }
    }
  }, [userRole, dateFrom]);

  const handleDateFromChange = (nextValue: string) => {
    if (userRole === 'staff') {
      const clamped = clampOrderFromDateForRole(nextValue, userRole);
      if (clamped !== nextValue) {
        setDateFrom(clamped);
        setDateClampNotice(
          'Nhân viên chỉ được xem đơn hàng trong vòng tối đa 1 tuần (7 ngày) gần nhất.',
        );
        return;
      }
    }
    setDateClampNotice(null);
    setDateFrom(nextValue);
  };

  const handleResetOrderFilters = () => {
    const freshDefault = getOrderDefaultDateRangePreset();
    setQuery('');
    setConfirmFilter('all');
    setDeliveryFilter('all');
    setPayFilter('all');
    setDateFrom(clampOrderFromDateForRole(freshDefault.from, userRole));
    setDateTo(freshDefault.to);
    setDateClampNotice(null);
  };

  const filteredOrders = useMemo(
    () =>
      filterOrders(orders, {
        query,
        confirmFilter,
        deliveryFilter,
        payFilter,
        dateFrom,
        dateTo,
        userRole,
      }),
    [orders, query, confirmFilter, deliveryFilter, payFilter, dateFrom, dateTo, userRole],
  );

  const stats = useMemo(() => {
    const totalOrders = filteredOrders.length;
    const unconfirmedCount = filteredOrders.filter((o) => !o.isConfirmed).length;
    const unpaidCount = filteredOrders.filter((o) => !o.isPaid).length;
    const totalRevenue = filteredOrders.reduce((sum, o) => sum + o.total, 0);
    return { totalOrders, unconfirmedCount, unpaidCount, totalRevenue };
  }, [filteredOrders]);

  const showRevenueChart = canViewRevenueChart(userRole);

  const handleOpenOrderInPos = (order: OrderRecord) => {
    setOrderToOpenInPos((prev) => ({
      order,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
    setViewMode('pos');
  };

  return (
    <div id="orders-management" className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Quản lý đơn hàng
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Lên đơn nhanh nhiều tab cho nhân viên, bấm vào chi tiết mặt hàng để chuyển đơn sang xử lý, theo dõi xác nhận &amp; giao hàng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="tablist"
            aria-label="Chế độ trang đơn hàng"
            className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg max-w-full"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'pos'}
              onClick={() => setViewMode('pos')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'pos'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <PlusSquare className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Bán hàng nhiều tab ({draftTabCount})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {showRevenueChart
                  ? 'Danh sách đơn & Doanh thu'
                  : 'Danh sách đơn hàng'}
              </span>
            </button>
          </div>

          {viewMode === 'list' && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw
                className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isLoading ? 'Đang tải...' : 'Làm mới đơn hàng'}</span>
            </button>
          )}
        </div>
      </div>

      {viewMode === 'pos' ? (
        <StaffPosPanel
          products={products}
          customers={customers}
          orders={orders}
          pendingOrderToLoad={orderToOpenInPos}
          onCreateOrder={onCreateOrder}
          onUpdateOrder={onUpdateOrder}
          onDraftTabCountChange={setDraftTabCount}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs font-medium text-slate-500">Tổng số đơn</p>
              <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
                {stats.totalOrders}
              </p>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs font-medium text-slate-500">Chưa xác nhận</p>
              <p className="mt-1 font-display text-2xl font-bold text-amber-700 tabular-nums">
                {stats.unconfirmedCount}
              </p>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs font-medium text-slate-500">Chưa thanh toán</p>
              <p className="mt-1 font-display text-2xl font-bold text-rose-700 tabular-nums">
                {stats.unpaidCount}
              </p>
            </div>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <p className="text-xs font-medium text-slate-500">Tổng giá trị đơn</p>
              <p className="mt-1 font-display text-xl sm:text-2xl font-bold text-blue-700 tabular-nums">
                {formatVnd(stats.totalRevenue)}
              </p>
            </div>
          </div>

          {notice && (
            <div
              role="status"
              className="px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
            >
              {notice}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative w-full lg:w-96">
                <label htmlFor="orders-search" className="sr-only">
                  Tìm đơn theo mã đơn, số điện thoại, tên hoặc sản phẩm
                </label>
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="orders-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm mã đơn, SĐT, địa chỉ, sản phẩm..."
                  className="w-full min-h-[44px] pl-10 pr-10 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Xóa từ khóa tìm đơn"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="filter-confirm-status"
                    className="text-xs font-medium text-slate-600 whitespace-nowrap"
                  >
                    Xác nhận:
                  </label>
                  <select
                    id="filter-confirm-status"
                    value={confirmFilter}
                    onChange={(e) =>
                      setConfirmFilter(e.target.value as ConfirmFilter)
                    }
                    className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
                  >
                    <option value="all">Tất cả</option>
                    <option value="unconfirmed">Chưa xác nhận</option>
                    <option value="confirmed">Đã xác nhận</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="filter-delivery-status"
                    className="text-xs font-medium text-slate-600 whitespace-nowrap"
                  >
                    Giao hàng:
                  </label>
                  <select
                    id="filter-delivery-status"
                    value={deliveryFilter}
                    onChange={(e) =>
                      setDeliveryFilter(e.target.value as DeliveryFilter)
                    }
                    className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
                  >
                    <option value="all">Tất cả</option>
                    <option value="undelivered">Chưa giao</option>
                    <option value="delivered">Đã giao</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="filter-pay-status"
                    className="text-xs font-medium text-slate-600 whitespace-nowrap"
                  >
                    Thanh toán:
                  </label>
                  <select
                    id="filter-pay-status"
                    value={payFilter}
                    onChange={(e) => setPayFilter(e.target.value as PayFilter)}
                    className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
                  >
                    <option value="all">Tất cả</option>
                    <option value="unpaid">Chưa thanh toán</option>
                    <option value="paid">Đã thanh toán</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1 min-w-0">
                <label
                  htmlFor="orders-date-from"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Từ thời gian phát sinh
                  {userRole === 'staff' && (
                    <span className="ml-1.5 text-[11px] font-normal text-amber-700">
                      (Nhân viên: tối đa 7 ngày gần nhất)
                    </span>
                  )}
                </label>
                <input
                  id="orders-date-from"
                  type="datetime-local"
                  value={dateFrom}
                  min={userRole === 'staff' ? staffMinDateTime : undefined}
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
                />
              </div>

              <div className="flex-1 min-w-0">
                <label
                  htmlFor="orders-date-to"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Đến thời gian
                </label>
                <input
                  id="orders-date-to"
                  type="datetime-local"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
                />
              </div>

              <button
                type="button"
                onClick={handleResetOrderFilters}
                className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap cursor-pointer"
              >
                Mặc định (3 ngày gần nhất)
              </button>
            </div>

            {dateClampNotice && (
              <div
                role="status"
                className="px-3.5 py-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-2"
              >
                <span>{dateClampNotice}</span>
                <button
                  type="button"
                  onClick={() => setDateClampNotice(null)}
                  aria-label="Đóng thông báo giới hạn thời gian"
                  className="text-amber-700 hover:text-amber-900 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            {filteredOrders.length === 0 ? (
              <div className="py-14 px-6 text-center">
                <p className="font-display text-base font-semibold text-slate-900">
                  {orders.length === 0
                    ? 'Chưa có đơn hàng nào được ghi nhận'
                    : 'Không có đơn hàng nào khớp bộ lọc'}
                </p>
                <p className="mt-1.5 text-sm text-slate-500">
                  {orders.length === 0
                    ? 'Khi khách xác nhận đặt hàng trong giỏ hàng, thông tin đơn sẽ hiển thị tại bảng này.'
                    : 'Thử xóa từ khóa hoặc đổi khoảng thời gian / trạng thái để xem lại đơn.'}
                </p>
                {orders.length === 0 ? (
                  <button
                    type="button"
                    onClick={onBackToShop}
                    className="mt-5 min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Về trang chọn sản phẩm
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleResetOrderFilters}
                    className="mt-5 min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
                  >
                    Đặt lại bộ lọc đơn hàng
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table
                  data-testid="orders-table"
                  className="w-full min-w-[980px] text-left border-collapse"
                >
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3.5 px-4 whitespace-nowrap">Mã đơn / Thời gian</th>
                      <th className="py-3.5 px-4">Khách hàng &amp; Địa chỉ</th>
                      <th className="py-3.5 px-4">Chi tiết mặt hàng</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Tổng tiền</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Xác nhận</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Giao hàng</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Thanh toán</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredOrders.map((order) => (
                      <tr
                        key={order.id ?? order.orderCode}
                        className="hover:bg-slate-50/70 align-top"
                      >
                        <td className="py-4 px-4 whitespace-nowrap">
                          <p className="font-mono font-semibold text-slate-900">
                            {order.orderCode}
                          </p>
                          <p className="mt-1 text-xs text-slate-500 tabular-nums">
                            {order.createdAt || 'Vừa đặt'}
                          </p>
                        </td>

                        <td className="py-4 px-4 max-w-[240px]">
                          <p className="font-medium text-slate-900">
                            {order.customerName || 'Khách lẻ'}
                          </p>
                          <p className="mt-0.5 font-mono text-xs text-slate-700">
                            {order.phone}
                          </p>
                          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                            <span className="font-medium text-slate-700">
                              {order.deliveryMethod === 'pickup'
                                ? 'Nhận tại CT2.1111'
                                : 'Giao tận nơi'}
                              :
                            </span>{' '}
                            {order.address}
                          </p>
                          {order.note && (
                            <p className="mt-1 text-xs text-slate-500 italic">
                              Ghi chú: {order.note}
                            </p>
                          )}
                        </td>

                        <td className="py-3 px-3 max-w-[280px]">
                          <button
                            type="button"
                            data-testid="order-items-to-pos"
                            onClick={() => handleOpenOrderInPos(order)}
                            title="Mở sang tab bán hàng nhiều tab để xử lý đơn"
                            aria-label={`Chuyển đơn ${order.orderCode} sang tab bán hàng để xử lý`}
                            className="group w-full text-left p-2 rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50/70 transition-colors cursor-pointer"
                          >
                            {order.items.length === 0 ? (
                              <span className="text-xs text-slate-400">
                                Chưa có chi tiết mặt hàng
                              </span>
                            ) : (
                              <ul className="space-y-1 text-xs text-slate-700">
                                {order.items.map((item, idx) => (
                                  <li
                                    key={`${item.productId}-${item.variant}-${idx}`}
                                    className="flex items-start justify-between gap-2"
                                  >
                                    <span className="leading-snug group-hover:text-blue-900">
                                      {item.name}
                                      {item.variant &&
                                      item.variant !== 'Tiêu chuẩn'
                                        ? ` (${item.variant})`
                                        : ''}
                                    </span>
                                    <span className="font-mono text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
                                      x{item.quantity}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 opacity-80 group-hover:opacity-100">
                              <span>Xử lý ở tab bán hàng</span>
                              <ArrowRight className="w-3 h-3" aria-hidden="true" />
                            </span>
                          </button>
                        </td>

                        <td className="py-4 px-4 text-right whitespace-nowrap">
                          <span className="font-bold text-slate-900 tabular-nums">
                            {formatVnd(order.total)}
                          </span>
                          {(order.discountAmount ?? 0) > 0 && (
                            <p className="mt-0.5 text-[11px] text-emerald-700 tabular-nums">
                              Giảm: -{formatVnd(order.discountAmount ?? 0)}
                            </p>
                          )}
                          {(order.extraFeeTotal ?? 0) > 0 && (
                            <p className="mt-0.5 text-[11px] text-amber-700 tabular-nums">
                              Phụ phí: +{formatVnd(order.extraFeeTotal ?? 0)}
                            </p>
                          )}
                          {order.status !== 'cancelled' &&
                            !order.isPaid &&
                            getOrderPaidAmount(order) > 0 && (
                              <p className="mt-0.5 text-[11px] text-rose-700 tabular-nums">
                                Đã trả {formatVnd(getOrderPaidAmount(order))} · Còn nợ{' '}
                                {formatVnd(getOrderRemainingDebt(order))}
                              </p>
                            )}
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onToggleConfirm(order)}
                            aria-pressed={order.isConfirmed}
                            className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                              order.isConfirmed
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                            }`}
                          >
                            {order.isConfirmed ? (
                              <>
                                <CheckCircle2
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Đã xác nhận</span>
                              </>
                            ) : (
                              <>
                                <Clock
                                  className="w-3.5 h-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Chưa xác nhận</span>
                              </>
                            )}
                          </button>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onToggleDelivered(order)}
                            aria-pressed={order.isDelivered}
                            className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                              order.isDelivered
                                ? 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'
                                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            <Truck
                              className="w-3.5 h-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              {order.isDelivered ? 'Đã giao' : 'Chưa giao'}
                            </span>
                          </button>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1.5">
                            <button
                              type="button"
                              onClick={() => onTogglePaid(order)}
                              aria-pressed={order.isPaid}
                              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                                order.isPaid
                                  ? 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                                  : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                              }`}
                            >
                              <Wallet
                                className="w-3.5 h-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>
                                {order.isPaid ? 'Đã thanh toán' : 'Chưa thanh toán'}
                              </span>
                            </button>
                            {!order.isPaid &&
                              order.status !== 'cancelled' &&
                              onOpenCashVoucher && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenCashVoucher({
                                      voucherType: 'receipt',
                                      category: 'sales_income',
                                      orderId: order.id ?? null,
                                      customerId: order.customerId ?? null,
                                      relatedCode: order.orderCode,
                                      counterpartyName:
                                        order.customerName || order.phone,
                                      amount: getOrderRemainingDebt(order),
                                      note: `Thu tiền đơn ${order.orderCode}`,
                                    })
                                  }
                                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-2 cursor-pointer"
                                >
                                  + Lập phiếu thu
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showRevenueChart && (
            <RevenueChartCard
              orders={orders}
              userRole={userRole}
              products={products}
              categories={categories}
            />
          )}
        </>
      )}
    </div>
  );
}

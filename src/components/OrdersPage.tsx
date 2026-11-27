import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  PlusSquare,
  RefreshCw,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import {
  filterOrders,
  normalizeLifecycleStatus,
  type ConfirmFilter,
  type LifecycleFilter,
  type PayFilter,
} from '../lib/supabaseOrders';
import type {
  CustomerRecord,
  OrderLifecycleStatus,
  OrderRecord,
  Product,
} from '../types/shop';
import { loadPosTabsState } from '../utils/posLogic';
import { formatVnd } from '../utils/shopLogic';
import { RevenueChartCard } from './RevenueChartCard';
import { StaffPosPanel } from './StaffPosPanel';

interface OrdersPageProps {
  orders: OrderRecord[];
  products: Product[];
  customers: CustomerRecord[];
  isLoading: boolean;
  notice?: string;
  onRefresh: () => void;
  onBackToShop: () => void;
  onToggleConfirm: (order: OrderRecord) => void;
  onTogglePaid: (order: OrderRecord) => void;
  onChangeStatus: (order: OrderRecord, status: OrderLifecycleStatus) => void;
  onCreateOrder: (order: OrderRecord) => Promise<{
    synced: boolean;
    errorMessage?: string;
  }>;
}

const STATUS_LABELS: Record<OrderLifecycleStatus, string> = {
  pending: 'Chờ xử lý',
  confirmed: 'Đã xác nhận',
  shipping: 'Đang giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
};

const STATUS_STYLES: Record<OrderLifecycleStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 border-slate-300',
  confirmed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  shipping: 'bg-blue-50 text-blue-800 border-blue-200',
  completed: 'bg-teal-50 text-teal-800 border-teal-200',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function OrdersPage({
  orders,
  products,
  customers,
  isLoading,
  notice,
  onRefresh,
  onBackToShop,
  onToggleConfirm,
  onTogglePaid,
  onChangeStatus,
  onCreateOrder,
}: OrdersPageProps) {
  const [viewMode, setViewMode] = useState<'list' | 'pos'>('list');
  const [draftTabCount, setDraftTabCount] = useState<number>(
    () => loadPosTabsState().tabs.length,
  );
  const [query, setQuery] = useState('');
  const [confirmFilter, setConfirmFilter] = useState<ConfirmFilter>('all');
  const [payFilter, setPayFilter] = useState<PayFilter>('all');
  const [statusFilter, setStatusFilter] = useState<LifecycleFilter>('all');

  const filteredOrders = useMemo(
    () =>
      filterOrders(orders, {
        query,
        confirmFilter,
        payFilter,
        statusFilter,
      }),
    [orders, query, confirmFilter, payFilter, statusFilter],
  );

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const unconfirmedCount = orders.filter((o) => !o.isConfirmed).length;
    const unpaidCount = orders.filter((o) => !o.isPaid).length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    return { totalOrders, unconfirmedCount, unpaidCount, totalRevenue };
  }, [orders]);

  return (
    <div id="orders-management" className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Quản lý đơn hàng
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Lên đơn nhanh nhiều tab cho nhân viên, kiểm đếm hàng, xác nhận và theo dõi doanh thu.
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
              aria-selected={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Danh sách đơn &amp; Doanh thu</span>
            </button>
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
          onCreateOrder={onCreateOrder}
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

      <RevenueChartCard orders={orders} />

      {notice && (
        <div
          role="status"
          className="px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
        >
          {notice}
        </div>
      )}

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
              htmlFor="filter-lifecycle-status"
              className="text-xs font-medium text-slate-600 whitespace-nowrap"
            >
              Tiến độ:
            </label>
            <select
              id="filter-lifecycle-status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as LifecycleFilter)
              }
              className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-2 focus:outline-blue-700 cursor-pointer"
            >
              <option value="all">Tất cả</option>
              <option value="pending">Chờ xử lý</option>
              <option value="confirmed">Đã xác nhận</option>
              <option value="shipping">Đang giao</option>
              <option value="completed">Hoàn tất</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>

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
                : 'Thử xóa từ khóa hoặc đổi bộ lọc trạng thái để xem lại tất cả đơn.'}
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
                onClick={() => {
                  setQuery('');
                  setConfirmFilter('all');
                  setPayFilter('all');
                  setStatusFilter('all');
                }}
                className="mt-5 min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                Xem lại toàn bộ đơn hàng
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
                  <th className="py-3.5 px-4 whitespace-nowrap">Tiến độ đơn</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Trạng thái xác nhận</th>
                  <th className="py-3.5 px-4 whitespace-nowrap">Trạng thái thanh toán</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredOrders.map((order) => {
                  const currentStatus = normalizeLifecycleStatus(
                    order.status,
                    order.isConfirmed,
                  );
                  return (
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

                      <td className="py-4 px-4 max-w-[260px]">
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
                                <span className="leading-snug">
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
                      </td>

                      <td className="py-4 px-4 whitespace-nowrap">
                        <select
                          aria-label={`Tiến độ đơn ${order.orderCode}`}
                          value={currentStatus}
                          onChange={(e) =>
                            onChangeStatus(
                              order,
                              e.target.value as OrderLifecycleStatus,
                            )
                          }
                          className={`min-h-[38px] px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer focus:outline-2 focus:outline-blue-700 ${STATUS_STYLES[currentStatus]}`}
                        >
                          {(
                            Object.keys(STATUS_LABELS) as OrderLifecycleStatus[]
                          ).map((key) => (
                            <option key={key} value={key}>
                              {STATUS_LABELS[key]}
                            </option>
                          ))}
                        </select>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}

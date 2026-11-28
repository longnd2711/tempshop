import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Check,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  createCashVoucherInSupabase,
  deleteCashVoucherInSupabase,
} from '../lib/supabaseAdmin';
import type {
  CashVoucherCategory,
  CashVoucherPaymentMethod,
  CashVoucherRecord,
  CashVoucherType,
  CustomerRecord,
  OrderRecord,
  PurchaseOrderRecord,
  QuickVoucherDraft,
  SupplierRecord,
  UserRole,
} from '../types/shop';
import {
  CASH_VOUCHER_CATEGORY_LABELS,
  calculateCashbookSummary,
  calculateCustomerDebtMap,
  calculateSupplierDebtMap,
  canManageInventory,
  formatDateTimeLocalInput,
  generateVoucherCode,
  getAllowedVoucherCategoriesForRole,
  getOrderRemainingDebt,
  getPurchaseOrderRemainingDebt,
} from '../utils/adminLogic';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';

interface CashbookAdminPanelProps {
  vouchers: CashVoucherRecord[];
  orders: OrderRecord[];
  customers: CustomerRecord[];
  purchaseOrders: PurchaseOrderRecord[];
  suppliers: SupplierRecord[];
  userRole: UserRole;
  isLoading: boolean;
  notice?: string;
  initialDraft?: QuickVoucherDraft | null;
  onConsumeInitialDraft?: () => void;
  onRefresh: () => Promise<void>;
}

type CashbookSubTab = 'vouchers' | 'customer-debt' | 'supplier-debt';

const NO_SPINNER_CLASS =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  cod: 'COD / Thu hộ',
};

export function CashbookAdminPanel({
  vouchers,
  orders,
  customers,
  purchaseOrders,
  suppliers,
  userRole,
  isLoading,
  notice,
  initialDraft,
  onConsumeInitialDraft,
  onRefresh,
}: CashbookAdminPanelProps) {
  const isManagerOrAdmin = canManageInventory(userRole);
  const [subTab, setSubTab] = useState<CashbookSubTab>('vouchers');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CashVoucherType>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CashVoucherCategory>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modal create state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [voucherType, setVoucherType] = useState<CashVoucherType>('receipt');
  const [voucherCode, setVoucherCode] = useState(() =>
    generateVoucherCode('receipt', new Date(), []),
  );
  const [isCodeManual, setIsCodeManual] = useState(false);
  const [category, setCategory] = useState<CashVoucherCategory>('customer_debt');
  const [amountInput, setAmountInput] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<CashVoucherPaymentMethod>('cash');
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [relatedCode, setRelatedCode] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [note, setNote] = useState('');
  const [voucherDateLocal, setVoucherDateLocal] = useState(() =>
    formatDateTimeLocalInput(new Date()),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const existingVoucherCodes = useMemo(
    () => vouchers.map((v) => v.voucherCode),
    [vouchers],
  );

  const summary = useMemo(
    () => calculateCashbookSummary(orders, purchaseOrders, vouchers),
    [orders, purchaseOrders, vouchers],
  );

  const customerDebtMap = useMemo(
    () => calculateCustomerDebtMap(orders, customers),
    [orders, customers],
  );

  const supplierDebtMap = useMemo(
    () => calculateSupplierDebtMap(purchaseOrders, suppliers),
    [purchaseOrders, suppliers],
  );

  const openCreateModal = (draft?: QuickVoucherDraft) => {
    const nextType: CashVoucherType = draft?.voucherType ?? 'receipt';
    const allowedCats = getAllowedVoucherCategoriesForRole(userRole, nextType);
    const nextCategory =
      draft?.category && allowedCats.includes(draft.category)
        ? draft.category
        : allowedCats[0] ?? 'customer_debt';

    setVoucherType(nextType);
    setCategory(nextCategory);
    setIsCodeManual(false);
    setVoucherCode(
      generateVoucherCode(nextType, new Date(), existingVoucherCodes),
    );
    setAmountInput(
      draft?.amount !== undefined && draft.amount > 0
        ? String(Math.round(draft.amount))
        : '',
    );
    setPaymentMethod(draft?.paymentMethod ?? 'cash');
    setCustomerId(draft?.customerId ?? '');
    setSupplierId(draft?.supplierId ?? '');
    setOrderId(draft?.orderId ?? '');
    setPurchaseOrderId(draft?.purchaseOrderId ?? '');
    setRelatedCode(draft?.relatedCode ?? '');
    setCounterpartyName(draft?.counterpartyName ?? '');
    setNote(draft?.note ?? '');
    setVoucherDateLocal(formatDateTimeLocalInput(new Date()));
    setFormError(null);
    setIsCreateOpen(true);
  };

  useEffect(() => {
    if (initialDraft) {
      openCreateModal(initialDraft);
      onConsumeInitialDraft?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  const handleVoucherTypeChange = (nextType: CashVoucherType) => {
    setVoucherType(nextType);
    const allowed = getAllowedVoucherCategoriesForRole(userRole, nextType);
    setCategory(allowed[0]);
    if (!isCodeManual) {
      setVoucherCode(
        generateVoucherCode(nextType, new Date(), existingVoucherCodes),
      );
    }
    setOrderId('');
    setPurchaseOrderId('');
  };

  const allowedCategoriesForModal = useMemo(
    () => getAllowedVoucherCategoriesForRole(userRole, voucherType),
    [userRole, voucherType],
  );

  const isCustomerCategory =
    category === 'customer_debt' ||
    category === 'sales_income' ||
    category === 'customer_refund';
  const isSupplierCategory =
    category === 'supplier_debt' ||
    category === 'purchase_expense' ||
    category === 'supplier_refund';

  const unpaidOrdersForCustomer = useMemo(() => {
    return orders.filter((o) => {
      if (o.status === 'cancelled') return false;
      if (customerId && o.customerId !== customerId) return false;
      return getOrderRemainingDebt(o) > 0;
    });
  }, [orders, customerId]);

  const unpaidPosForSupplier = useMemo(() => {
    return purchaseOrders.filter((po) => {
      if (supplierId && po.supplierId !== supplierId) return false;
      return getPurchaseOrderRemainingDebt(po) > 0;
    });
  }, [purchaseOrders, supplierId]);

  const filteredVouchers = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : NaN;
    const toMs = dateTo ? new Date(dateTo).getTime() + 59_999 : NaN;

    return vouchers.filter((v) => {
      if (typeFilter !== 'all' && v.voucherType !== typeFilter) return false;
      if (categoryFilter !== 'all' && v.category !== categoryFilter) return false;
      if (Number.isFinite(fromMs) || Number.isFinite(toMs)) {
        const ts = v.voucherDateIso ? Date.parse(v.voucherDateIso) : NaN;
        if (!Number.isFinite(ts)) return false;
        if (Number.isFinite(fromMs) && ts < fromMs) return false;
        if (Number.isFinite(toMs) && ts > toMs) return false;
      }
      if (!norm) return true;
      const hay = normalizeVietnameseText(
        `${v.voucherCode} ${v.counterpartyName} ${v.relatedCode} ${v.note} ${CASH_VOUCHER_CATEGORY_LABELS[v.category] ?? v.category}`,
      );
      return hay.includes(norm);
    });
  }, [vouchers, searchQuery, typeFilter, categoryFilter, dateFrom, dateTo]);

  const customerDebtRows = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    return customers
      .map((c) => ({
        customer: c,
        debt: customerDebtMap.get(c.id) ?? {
          customerId: c.id,
          totalOrderAmount: 0,
          totalPaidAmount: 0,
          debtAmount: 0,
          unpaidOrderCount: 0,
          overCreditLimit: false,
        },
      }))
      .filter((row) => row.debt.debtAmount > 0 || row.debt.unpaidOrderCount > 0)
      .filter((row) => {
        if (!norm) return true;
        return normalizeVietnameseText(
          `${row.customer.fullName} ${row.customer.phone} ${row.customer.area ?? ''} ${row.customer.customerGroup ?? ''}`,
        ).includes(norm);
      })
      .sort((a, b) => b.debt.debtAmount - a.debt.debtAmount);
  }, [customers, customerDebtMap, searchQuery]);

  const supplierDebtRows = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    return suppliers
      .map((s) => ({
        supplier: s,
        debt: supplierDebtMap.get(s.id) ?? {
          supplierId: s.id,
          totalPurchaseAmount: 0,
          totalPaidAmount: 0,
          debtAmount: 0,
          unpaidPoCount: 0,
        },
      }))
      .filter((row) => row.debt.debtAmount > 0 || row.debt.unpaidPoCount > 0)
      .filter((row) => {
        if (!norm) return true;
        return normalizeVietnameseText(
          `${row.supplier.name} ${row.supplier.shortName ?? ''} ${row.supplier.phone} ${row.supplier.area ?? ''}`,
        ).includes(norm);
      })
      .sort((a, b) => b.debt.debtAmount - a.debt.debtAmount);
  }, [suppliers, supplierDebtMap, searchQuery]);

  const handleSubmitVoucher = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Math.round(Number(amountInput) || 0);
    if (!voucherCode.trim()) {
      setFormError('Vui lòng nhập Mã phiếu thu/chi.');
      return;
    }
    if (amount <= 0) {
      setFormError('Số tiền phiếu phải lớn hơn 0 đ.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      const dateIso = voucherDateLocal
        ? new Date(voucherDateLocal).toISOString()
        : new Date().toISOString();

      const res = await createCashVoucherInSupabase({
        voucherCode: voucherCode.trim(),
        voucherType,
        category,
        amount,
        paymentMethod,
        customerId: isCustomerCategory && customerId ? customerId : null,
        supplierId: isSupplierCategory && supplierId ? supplierId : null,
        orderId: isCustomerCategory && orderId ? orderId : null,
        purchaseOrderId:
          isSupplierCategory && purchaseOrderId ? purchaseOrderId : null,
        relatedCode: relatedCode.trim(),
        counterpartyName: counterpartyName.trim(),
        note: note.trim(),
        voucherDateIso: dateIso,
      });

      if (res.errorMessage) {
        setFormError(res.errorMessage);
        return;
      }

      setIsCreateOpen(false);
      setFeedback(
        `Đã lập ${voucherType === 'receipt' ? 'Phiếu thu' : 'Phiếu chi'} ${res.voucherCode ?? voucherCode.trim()} (${formatVnd(amount)}) và tự động cập nhật công nợ/chi phí liên quan.`,
      );
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteVoucher = async (voucher: CashVoucherRecord) => {
    setIsDeleting(true);
    try {
      const res = await deleteCashVoucherInSupabase(voucher.id);
      setConfirmDeleteId(null);
      if (!res.ok) {
        setFeedback(`Không thể xóa phiếu ${voucher.voucherCode}: ${res.errorMessage}`);
        return;
      }
      setFeedback(
        `Đã xóa phiếu ${voucher.voucherCode} và hoàn tác phân bổ công nợ tương ứng.`,
      );
      await onRefresh();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div id="cashbook-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Thu Chi &amp; Công nợ
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Lập phiếu thu/chi, tự động trừ công nợ đơn bán - đơn nhập và tổng hợp chi phí phát sinh.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3.5 py-2 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Làm mới</span>
          </button>

          <button
            type="button"
            onClick={() =>
              openCreateModal({
                voucherType: 'receipt',
                category: 'customer_debt',
              })
            }
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <ArrowDownLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Lập phiếu thu</span>
          </button>

          <button
            type="button"
            onClick={() =>
              openCreateModal({
                voucherType: 'payment',
                category: isManagerOrAdmin ? 'operating_expense' : 'customer_refund',
              })
            }
            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 text-sm font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Lập phiếu chi</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng thu (PT)</p>
          <p className="mt-1 font-display text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">
            {formatVnd(summary.totalReceipts)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng chi (PC)</p>
          <p className="mt-1 font-display text-lg sm:text-xl font-bold text-rose-700 tabular-nums">
            {formatVnd(summary.totalPayments)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Chênh lệch thu chi</p>
          <p
            className={`mt-1 font-display text-lg sm:text-xl font-bold tabular-nums ${
              summary.netCashflow >= 0 ? 'text-blue-700' : 'text-rose-700'
            }`}
          >
            {summary.netCashflow < 0 ? '-' : ''}
            {formatVnd(Math.abs(summary.netCashflow))}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Phải thu khách hàng</p>
          <p className="mt-1 font-display text-lg sm:text-xl font-bold text-amber-700 tabular-nums">
            {formatVnd(summary.totalReceivable)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Phải trả NCC</p>
          <p className="mt-1 font-display text-lg sm:text-xl font-bold text-purple-700 tabular-nums">
            {formatVnd(summary.totalPayable)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Chi phí &amp; Phụ phí</p>
          <p className="mt-1 font-display text-lg sm:text-xl font-bold text-slate-800 tabular-nums">
            {formatVnd(summary.operatingAndExtraExpenses)}
          </p>
        </div>
      </div>

      {(notice || feedback) && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
        >
          <span>{feedback || notice}</span>
          {feedback && (
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Đóng thông báo"
              className="p-1 text-amber-700 hover:text-amber-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setSubTab('vouchers')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'vouchers'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Wallet className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Sổ Thu Chi ({vouchers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('customer-debt')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'customer-debt'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Công nợ Khách hàng ({customerDebtRows.length})</span>
        </button>

        {isManagerOrAdmin && (
          <button
            type="button"
            onClick={() => setSubTab('supplier-debt')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              subTab === 'supplier-debt'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Công nợ NCC ({supplierDebtRows.length})</span>
          </button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="relative w-full lg:w-80">
          <label htmlFor="cashbook-search" className="sr-only">
            Tìm mã phiếu, đối tượng, mã đơn hoặc ghi chú
          </label>
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="cashbook-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm mã phiếu, tên khách/NCC, mã đơn..."
            className="w-full min-h-[40px] pl-10 pr-8 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
          />
        </div>

        {subTab === 'vouchers' && (
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Lọc loại phiếu"
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as 'all' | CashVoucherType)
              }
              className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800"
            >
              <option value="all">Tất cả loại phiếu</option>
              <option value="receipt">Phiếu thu (PT)</option>
              <option value="payment">Phiếu chi (PC)</option>
            </select>

            <select
              aria-label="Lọc hạng mục thu chi"
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as 'all' | CashVoucherCategory)
              }
              className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800"
            >
              <option value="all">Tất cả hạng mục</option>
              {Object.entries(CASH_VOUCHER_CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>

            <input
              type="datetime-local"
              aria-label="Từ ngày"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
            />
            <input
              type="datetime-local"
              aria-label="Đến ngày"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="min-h-[40px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
            />
          </div>
        )}
      </div>

      {/* Sub-tab content */}
      {subTab === 'vouchers' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          {filteredVouchers.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <Wallet className="w-9 h-9 text-slate-300 mx-auto mb-2.5" aria-hidden="true" />
              <p className="font-display text-base font-semibold text-slate-900">
                Chưa có phiếu thu chi nào phù hợp
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Nhấn &quot;Lập phiếu thu&quot; hoặc &quot;Lập phiếu chi&quot; để ghi nhận giao dịch và tự động cập nhật công nợ.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Mã phiếu / Ngày</th>
                    <th className="py-3 px-4">Loại / Hạng mục</th>
                    <th className="py-3 px-4">Đối tượng / Mã liên quan</th>
                    <th className="py-3 px-4">Hình thức</th>
                    <th className="py-3 px-4 text-right">Số tiền</th>
                    <th className="py-3 px-4">Ghi chú / Người lập</th>
                    {isManagerOrAdmin && (
                      <th className="py-3 px-4 text-right">Thao tác</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {filteredVouchers.map((v) => {
                    const isReceipt = v.voucherType === 'receipt';
                    return (
                      <tr key={v.id || v.voucherCode} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <p className="font-mono font-semibold text-slate-900">
                            {v.voucherCode}
                          </p>
                          <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                            {v.voucherDate || 'Vừa lập'}
                          </p>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded border ${
                              isReceipt
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                          >
                            {isReceipt ? (
                              <ArrowDownLeft className="w-3 h-3" aria-hidden="true" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                            )}
                            <span>{isReceipt ? 'Phiếu thu' : 'Phiếu chi'}</span>
                          </span>
                          <p className="text-xs font-medium text-slate-700 mt-1">
                            {CASH_VOUCHER_CATEGORY_LABELS[v.category] ?? v.category}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          <p className="font-semibold text-slate-900">
                            {v.counterpartyName || '—'}
                          </p>
                          {v.relatedCode && (
                            <p className="font-mono text-blue-700 mt-0.5">
                              Mã đơn: {v.relatedCode}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                          {PAYMENT_METHOD_LABELS[v.paymentMethod] ?? v.paymentMethod}
                        </td>
                        <td
                          className={`py-3.5 px-4 text-right font-bold tabular-nums whitespace-nowrap ${
                            isReceipt ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {isReceipt ? '+' : '-'}
                          {formatVnd(v.amount)}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600 max-w-[240px]">
                          <p>{v.note || '—'}</p>
                          {v.createdByEmail && (
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {v.createdByEmail}
                            </p>
                          )}
                        </td>
                        {isManagerOrAdmin && (
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            {confirmDeleteId === v.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => void handleDeleteVoucher(v)}
                                  className="px-2.5 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer disabled:opacity-60"
                                >
                                  Xác nhận xóa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(v.id)}
                                aria-label={`Xóa phiếu ${v.voucherCode}`}
                                className="inline-flex items-center p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : subTab === 'customer-debt' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          {customerDebtRows.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="font-display text-base font-semibold text-slate-900">
                Hiện không có khách hàng nào còn công nợ
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Khách hàng / Nhóm</th>
                    <th className="py-3 px-4">Khu vực</th>
                    <th className="py-3 px-4 text-center">Đơn chưa thanh toán</th>
                    <th className="py-3 px-4 text-right">Tổng đã mua</th>
                    <th className="py-3 px-4 text-right">Đã trả</th>
                    <th className="py-3 px-4 text-right">Còn nợ</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {customerDebtRows.map(({ customer, debt }) => (
                    <tr key={customer.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-900">
                          {customer.fullName || 'Khách hàng'}
                        </p>
                        <p className="text-xs font-mono text-slate-600">
                          {customer.phone}
                          {customer.customerGroup
                            ? ` · ${customer.customerGroup}`
                            : ''}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        {customer.area || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center tabular-nums font-semibold text-amber-700">
                        {debt.unpaidOrderCount} đơn
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                        {formatVnd(debt.totalOrderAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums text-emerald-700">
                        {formatVnd(debt.totalPaidAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums font-bold text-rose-700">
                        {formatVnd(debt.debtAmount)}
                        {debt.overCreditLimit && (
                          <p className="text-[11px] font-semibold text-rose-600">
                            Vượt hạn mức ({formatVnd(customer.creditLimit ?? 0)})
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            openCreateModal({
                              voucherType: 'receipt',
                              category: 'customer_debt',
                              customerId: customer.id,
                              counterpartyName: customer.fullName || customer.phone,
                              amount: debt.debtAmount,
                              note: `Thu công nợ khách ${customer.fullName || customer.phone}`,
                            })
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Thu nợ</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          {supplierDebtRows.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="font-display text-base font-semibold text-slate-900">
                Hiện không còn công nợ phải trả nhà cung cấp
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Nhà cung cấp</th>
                    <th className="py-3 px-4">Khu vực / Điều khoản</th>
                    <th className="py-3 px-4 text-center">Phiếu chưa trả hết</th>
                    <th className="py-3 px-4 text-right">Tổng tiền nhập</th>
                    <th className="py-3 px-4 text-right">Đã trả</th>
                    <th className="py-3 px-4 text-right">Còn nợ NCC</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {supplierDebtRows.map(({ supplier, debt }) => (
                    <tr key={supplier.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-900">
                          {supplier.name}
                        </p>
                        <p className="text-xs font-mono text-slate-500">
                          {supplier.shortName ? `[${supplier.shortName}] ` : ''}
                          {supplier.phone}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        <p>{supplier.area || '—'}</p>
                        {supplier.paymentTerms && (
                          <p className="text-slate-500">{supplier.paymentTerms}</p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center tabular-nums font-semibold text-amber-700">
                        {debt.unpaidPoCount} phiếu
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums text-slate-700">
                        {formatVnd(debt.totalPurchaseAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums text-emerald-700">
                        {formatVnd(debt.totalPaidAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums font-bold text-rose-700">
                        {formatVnd(debt.debtAmount)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            openCreateModal({
                              voucherType: 'payment',
                              category: 'supplier_debt',
                              supplierId: supplier.id,
                              counterpartyName: supplier.name,
                              amount: debt.debtAmount,
                              note: `Trả công nợ NCC ${supplier.name}`,
                            })
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded-lg cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Chi trả nợ</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Voucher Modal */}
      {isCreateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voucher-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="voucher-modal-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {voucherType === 'receipt'
                  ? 'Lập phiếu thu mới (PT)'
                  : 'Lập phiếu chi mới (PC)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                aria-label="Đóng biểu mẫu phiếu thu chi"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSubmitVoucher(e)}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleVoucherTypeChange('receipt')}
                  className={`min-h-[40px] px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg border transition-colors cursor-pointer ${
                    voucherType === 'receipt'
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Phiếu thu (Thu tiền)
                </button>
                <button
                  type="button"
                  onClick={() => handleVoucherTypeChange('payment')}
                  className={`min-h-[40px] px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg border transition-colors cursor-pointer ${
                    voucherType === 'payment'
                      ? 'bg-rose-700 text-white border-rose-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  Phiếu chi (Chi tiền)
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="voucher-code-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Mã phiếu *
                  </label>
                  <input
                    id="voucher-code-input"
                    type="text"
                    required
                    value={voucherCode}
                    onChange={(e) => {
                      setVoucherCode(e.target.value);
                      setIsCodeManual(true);
                    }}
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="voucher-date-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Ngày giờ chứng từ
                  </label>
                  <input
                    id="voucher-date-input"
                    type="datetime-local"
                    value={voucherDateLocal}
                    onChange={(e) => setVoucherDateLocal(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="voucher-category-select"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Hạng mục thu / chi *
                  </label>
                  <select
                    id="voucher-category-select"
                    value={category}
                    onChange={(e) =>
                      setCategory(e.target.value as CashVoucherCategory)
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {allowedCategoriesForModal.map((cat) => (
                      <option key={cat} value={cat}>
                        {CASH_VOUCHER_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="voucher-method-select"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Hình thức thanh toán
                  </label>
                  <select
                    id="voucher-method-select"
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as CashVoucherPaymentMethod)
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="cash">Tiền mặt</option>
                    <option value="transfer">Chuyển khoản</option>
                    <option value="cod">COD / Thu hộ</option>
                  </select>
                </div>
              </div>

              {isCustomerCategory && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <label
                      htmlFor="voucher-customer-select"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Chọn khách hàng (để tự động trừ công nợ)
                    </label>
                    <select
                      id="voucher-customer-select"
                      value={customerId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setCustomerId(nextId);
                        setOrderId('');
                        const c = customers.find((item) => item.id === nextId);
                        if (c) {
                          setCounterpartyName(c.fullName || c.phone);
                          const debt = customerDebtMap.get(c.id)?.debtAmount ?? 0;
                          if (debt > 0 && !amountInput) {
                            setAmountInput(String(debt));
                          }
                        }
                      }}
                      className="w-full min-h-[38px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">-- Khách lẻ / Tự nhập tên --</option>
                      {customers.map((c) => {
                        const d = customerDebtMap.get(c.id)?.debtAmount ?? 0;
                        return (
                          <option key={c.id} value={c.id}>
                            {c.fullName || 'Khách hàng'} ({c.phone})
                            {d > 0 ? ` — Nợ: ${formatVnd(d)}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {unpaidOrdersForCustomer.length > 0 && (
                    <div>
                      <label
                        htmlFor="voucher-order-select"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Gắn trực tiếp vào đơn hàng chưa trả hết (tùy chọn)
                      </label>
                      <select
                        id="voucher-order-select"
                        value={orderId}
                        onChange={(e) => {
                          const nextOrderId = e.target.value;
                          setOrderId(nextOrderId);
                          const ord = orders.find((o) => o.id === nextOrderId);
                          if (ord) {
                            setRelatedCode(ord.orderCode);
                            const rem = getOrderRemainingDebt(ord);
                            if (rem > 0) setAmountInput(String(rem));
                            if (!counterpartyName) {
                              setCounterpartyName(ord.customerName || ord.phone);
                            }
                          }
                        }}
                        className="w-full min-h-[38px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">
                          -- Tự động phân bổ các đơn cũ nhất của khách --
                        </option>
                        {unpaidOrdersForCustomer.map((o) => (
                          <option key={o.id ?? o.orderCode} value={o.id ?? ''}>
                            {o.orderCode} · Còn nợ {formatVnd(getOrderRemainingDebt(o))}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {isSupplierCategory && isManagerOrAdmin && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <label
                      htmlFor="voucher-supplier-select"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Chọn nhà cung cấp (để tự động trừ nợ NCC)
                    </label>
                    <select
                      id="voucher-supplier-select"
                      value={supplierId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setSupplierId(nextId);
                        setPurchaseOrderId('');
                        const s = suppliers.find((item) => item.id === nextId);
                        if (s) {
                          setCounterpartyName(s.name);
                          const debt = supplierDebtMap.get(s.id)?.debtAmount ?? 0;
                          if (debt > 0 && !amountInput) {
                            setAmountInput(String(debt));
                          }
                        }
                      }}
                      className="w-full min-h-[38px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">-- Chọn nhà cung cấp --</option>
                      {suppliers.map((s) => {
                        const d = supplierDebtMap.get(s.id)?.debtAmount ?? 0;
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {d > 0 ? ` — Còn nợ: ${formatVnd(d)}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {unpaidPosForSupplier.length > 0 && (
                    <div>
                      <label
                        htmlFor="voucher-po-select"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Gắn vào phiếu nhập hàng (tùy chọn)
                      </label>
                      <select
                        id="voucher-po-select"
                        value={purchaseOrderId}
                        onChange={(e) => {
                          const nextPoId = e.target.value;
                          setPurchaseOrderId(nextPoId);
                          const po = purchaseOrders.find((p) => p.id === nextPoId);
                          if (po) {
                            setRelatedCode(po.poCode);
                            const rem = getPurchaseOrderRemainingDebt(po);
                            if (rem > 0) setAmountInput(String(rem));
                            if (!counterpartyName) {
                              setCounterpartyName(po.supplierName);
                            }
                          }
                        }}
                        className="w-full min-h-[38px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">
                          -- Tự động phân bổ theo phiếu cũ nhất --
                        </option>
                        {unpaidPosForSupplier.map((po) => (
                          <option key={po.id ?? po.poCode} value={po.id ?? ''}>
                            {po.poCode} · Còn nợ {formatVnd(getPurchaseOrderRemainingDebt(po))}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="voucher-amount-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Số tiền (đ) *
                  </label>
                  <input
                    id="voucher-amount-input"
                    type="number"
                    min="1"
                    step="1000"
                    required
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="VD: 500000"
                    className={`w-full min-h-[40px] px-3 py-2 text-sm font-mono font-bold text-slate-900 border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
                  />
                </div>

                <div>
                  <label
                    htmlFor="voucher-counterparty-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Tên người nộp / nhận
                  </label>
                  <input
                    id="voucher-counterparty-input"
                    type="text"
                    value={counterpartyName}
                    onChange={(e) => setCounterpartyName(e.target.value)}
                    placeholder="VD: Chị Lan / Shipper / Điện lực..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="voucher-note-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Diễn giải / Ghi chú chứng từ
                </label>
                <textarea
                  id="voucher-note-input"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Thu tiền công nợ tháng 11, phí gửi xe nhận hàng bến xe..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {formError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
                >
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white rounded-lg cursor-pointer disabled:opacity-60 ${
                    voucherType === 'receipt'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-rose-700 hover:bg-rose-800'
                  }`}
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>{isSubmitting ? 'Đang lưu...' : 'Lưu phiếu'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

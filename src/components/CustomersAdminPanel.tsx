import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  GitMerge,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  deleteAdminCustomer,
  deleteCustomersToGuest,
  mergeCustomersInSupabase,
  upsertAdminCustomer,
} from '../lib/supabaseAdmin';
import type {
  CustomerRecord,
  OrderRecord,
  QuickVoucherDraft,
  UserRole,
} from '../types/shop';
import {
  buildMergedCustomerPreview,
  calculateCustomerDebtMap,
  CUSTOMER_GROUP_OPTIONS,
  getOrderRemainingDebt,
} from '../utils/adminLogic';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';

interface CustomersAdminPanelProps {
  customers: CustomerRecord[];
  orders?: OrderRecord[];
  userRole: UserRole;
  isLoading: boolean;
  notice?: string;
  onRefresh: () => Promise<void>;
  onOpenCashVoucher?: (draft: QuickVoucherDraft) => void;
}

interface CustomerFormState {
  id?: string;
  phone: string;
  fullName: string;
  defaultAddress: string;
  area: string;
  customerGroup: string;
  taxCode: string;
  bankAccount: string;
  bankName: string;
  email: string;
  creditLimit: string;
  notes: string;
}

const EMPTY_CUSTOMER_FORM: CustomerFormState = {
  phone: '',
  fullName: '',
  defaultAddress: '',
  area: '',
  customerGroup: 'Khách lẻ',
  taxCode: '',
  bankAccount: '',
  bankName: '',
  email: '',
  creditLimit: '',
  notes: '',
};

interface MergeFormState {
  primaryId: string;
  duplicateIds: string[];
  phone: string;
  fullName: string;
  defaultAddress: string;
  area: string;
  customerGroup: string;
  taxCode: string;
  bankAccount: string;
  bankName: string;
  email: string;
  creditLimit: string;
  notes: string;
  combinedOrdersCount: number;
  combinedTotalSpent: number;
}

const NO_SPINNER_CLASS =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export function CustomersAdminPanel({
  customers,
  orders = [],
  userRole,
  isLoading,
  notice,
  onRefresh,
  onOpenCashVoucher,
}: CustomersAdminPanelProps) {
  const canBulkModify = userRole === 'admin' || userRole === 'manager';

  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [onlyWithDebt, setOnlyWithDebt] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergeForm, setMergeForm] = useState<MergeFormState | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const customerDebtMap = useMemo(
    () => calculateCustomerDebtMap(orders, customers),
    [orders, customers],
  );

  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) {
      const area = (c.area ?? '').trim();
      if (area) set.add(area);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [customers]);

  const availableGroups = useMemo(() => {
    const set = new Set<string>(CUSTOMER_GROUP_OPTIONS);
    for (const c of customers) {
      const grp = (c.customerGroup ?? '').trim();
      if (grp) set.add(grp);
    }
    return Array.from(set);
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    return customers.filter((c) => {
      if (areaFilter !== 'all' && (c.area ?? '').trim() !== areaFilter) {
        return false;
      }
      if (
        groupFilter !== 'all' &&
        ((c.customerGroup ?? '').trim() || 'Khách lẻ') !== groupFilter
      ) {
        return false;
      }
      if (onlyWithDebt) {
        const debt = customerDebtMap.get(c.id)?.debtAmount ?? 0;
        if (debt <= 0) return false;
      }
      if (!norm) return true;
      const hay = normalizeVietnameseText(
        `${c.phone} ${c.fullName} ${c.defaultAddress} ${c.area ?? ''} ${c.customerGroup ?? ''} ${c.taxCode ?? ''} ${c.bankAccount ?? ''} ${c.bankName ?? ''} ${c.email ?? ''} ${c.notes}`,
      );
      return hay.includes(norm);
    });
  }, [customers, searchQuery, areaFilter, groupFilter, onlyWithDebt, customerDebtMap]);

  const stats = useMemo(() => {
    const totalCustomers = customers.length;
    const totalDebt = Array.from(customerDebtMap.values()).reduce(
      (sum, d) => sum + d.debtAmount,
      0,
    );
    const debtCustomerCount = Array.from(customerDebtMap.values()).filter(
      (d) => d.debtAmount > 0,
    ).length;
    const totalSpent = customers.reduce((sum, c) => sum + c.totalSpent, 0);
    return { totalCustomers, totalDebt, debtCustomerCount, totalSpent };
  }, [customers, customerDebtMap]);

  const selectedCustomers = useMemo(
    () => customers.filter((c) => selectedIds.includes(c.id)),
    [customers, selectedIds],
  );

  const allFilteredSelected =
    filteredCustomers.length > 0 &&
    filteredCustomers.every((c) => selectedIds.includes(c.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredCustomers.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const next = new Set(selectedIds);
      for (const c of filteredCustomers) {
        if (c.id) next.add(c.id);
      }
      setSelectedIds(Array.from(next));
    }
  };

  const toggleSelectOne = (customerId: string) => {
    setSelectedIds((prev) =>
      prev.includes(customerId)
        ? prev.filter((id) => id !== customerId)
        : [...prev, customerId],
    );
  };

  const openCreate = () => {
    setForm(EMPTY_CUSTOMER_FORM);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEdit = (customer: CustomerRecord) => {
    setForm({
      id: customer.id,
      phone: customer.phone,
      fullName: customer.fullName,
      defaultAddress: customer.defaultAddress,
      area: customer.area ?? '',
      customerGroup: customer.customerGroup || 'Khách lẻ',
      taxCode: customer.taxCode ?? '',
      bankAccount: customer.bankAccount ?? '',
      bankName: customer.bankName ?? '',
      email: customer.email ?? '',
      creditLimit:
        customer.creditLimit !== null &&
        customer.creditLimit !== undefined &&
        Number.isFinite(Number(customer.creditLimit))
          ? String(customer.creditLimit)
          : '',
      notes: customer.notes,
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const cleanPhone = form.phone.replace(/[\s.-]/g, '').trim();
    if (!/^0\d{9,10}$/.test(cleanPhone)) {
      setFormError('Số điện thoại cần bắt đầu bằng 0 và gồm 10–11 chữ số.');
      return;
    }

    const parsedLimit =
      form.creditLimit.trim() !== ''
        ? Math.max(0, Math.round(Number(form.creditLimit) || 0))
        : null;

    setFormError(null);
    setIsSaving(true);
    try {
      const res = await upsertAdminCustomer({
        id: form.id,
        phone: cleanPhone,
        fullName: form.fullName,
        defaultAddress: form.defaultAddress,
        area: form.area.trim() || null,
        customerGroup: form.customerGroup.trim() || 'Khách lẻ',
        taxCode: form.taxCode.trim() || null,
        bankAccount: form.bankAccount.trim() || null,
        bankName: form.bankName.trim() || null,
        email: form.email.trim() || null,
        creditLimit: parsedLimit,
        notes: form.notes,
      });

      if (res.errorMessage) {
        setFormError(res.errorMessage);
        return;
      }

      setIsFormOpen(false);
      setFeedback(
        form.id
          ? `Đã cập nhật thông tin & lưu ý khách ${form.fullName || cleanPhone}.`
          : `Đã thêm khách hàng mới ${form.fullName || cleanPhone}.`,
      );
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (customer: CustomerRecord) => {
    const res = await deleteAdminCustomer(customer.id);
    setConfirmDeleteId(null);
    if (res.errorMessage) {
      setFeedback(`Không thể xóa khách hàng: ${res.errorMessage}`);
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => id !== customer.id));
    setFeedback(
      `Đã xóa khách hàng ${customer.fullName || customer.phone} (tên, SĐT, địa chỉ trên các đơn hàng cũ vẫn được giữ nguyên dưới dạng khách lẻ).`,
    );
    await onRefresh();
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const res = await deleteCustomersToGuest(selectedIds);
      setIsBulkDeleteConfirmOpen(false);
      if (res.errorMessage) {
        setFeedback(`Không thể xóa hàng loạt: ${res.errorMessage}`);
        return;
      }
      setSelectedIds([]);
      setFeedback(
        `Đã xóa ${res.deletedCount} khách hàng đã chọn. Thông tin tên, SĐT và địa chỉ giao nhận trên các đơn hàng liên quan vẫn được giữ nguyên (chuyển thành khách lẻ).`,
      );
      await onRefresh();
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const applyPrimaryToMergeForm = (
    list: CustomerRecord[],
    primaryId: string,
  ) => {
    const preview = buildMergedCustomerPreview(list, primaryId);
    if (!preview) return;
    setMergeForm({
      primaryId: preview.primaryId,
      duplicateIds: preview.duplicateIds,
      phone: preview.phone,
      fullName: preview.fullName,
      defaultAddress: preview.defaultAddress,
      area: preview.area,
      customerGroup: preview.customerGroup,
      taxCode: preview.taxCode,
      bankAccount: preview.bankAccount,
      bankName: preview.bankName,
      email: preview.email,
      creditLimit:
        preview.creditLimit !== null && preview.creditLimit !== undefined
          ? String(preview.creditLimit)
          : '',
      notes: preview.notes,
      combinedOrdersCount: preview.combinedOrdersCount,
      combinedTotalSpent: preview.combinedTotalSpent,
    });
  };

  const openMergeModal = () => {
    if (selectedCustomers.length < 2) return;
    const sorted = [...selectedCustomers].sort(
      (a, b) => (b.totalOrders || 0) - (a.totalOrders || 0),
    );
    applyPrimaryToMergeForm(sorted, sorted[0].id);
    setMergeError(null);
    setIsMergeModalOpen(true);
  };

  const handleConfirmMerge = async (e: FormEvent) => {
    e.preventDefault();
    if (!mergeForm) return;
    const cleanPhone = mergeForm.phone.replace(/[\s.-]/g, '').trim();
    if (!/^0\d{9,10}$/.test(cleanPhone)) {
      setMergeError('Số điện thoại hồ sơ chính cần bắt đầu bằng 0 và gồm 10–11 chữ số.');
      return;
    }

    const parsedLimit =
      mergeForm.creditLimit.trim() !== ''
        ? Math.max(0, Math.round(Number(mergeForm.creditLimit) || 0))
        : null;

    setMergeError(null);
    setIsMerging(true);
    try {
      const res = await mergeCustomersInSupabase({
        primaryId: mergeForm.primaryId,
        duplicateIds: mergeForm.duplicateIds,
        merged: {
          phone: cleanPhone,
          fullName: mergeForm.fullName,
          defaultAddress: mergeForm.defaultAddress,
          area: mergeForm.area.trim() || null,
          customerGroup: mergeForm.customerGroup.trim() || 'Khách lẻ',
          taxCode: mergeForm.taxCode.trim() || null,
          bankAccount: mergeForm.bankAccount.trim() || null,
          bankName: mergeForm.bankName.trim() || null,
          email: mergeForm.email.trim() || null,
          creditLimit: parsedLimit,
          notes: mergeForm.notes,
        },
      });

      if (res.errorMessage) {
        setMergeError(res.errorMessage);
        return;
      }

      setIsMergeModalOpen(false);
      setMergeForm(null);
      setSelectedIds([]);
      setFeedback(
        `Đã gộp ${mergeForm.duplicateIds.length + 1} hồ sơ thành khách "${mergeForm.fullName || cleanPhone}"${
          res.movedOrders !== undefined
            ? ` (đã chuyển ${res.movedOrders} đơn hàng sang hồ sơ chính)`
            : ''
        }.`,
      );
      await onRefresh();
    } finally {
      setIsMerging(false);
    }
  };

  const editingCustomerDebt = form.id
    ? customerDebtMap.get(form.id) ?? null
    : null;

  const editingCustomerOrders = useMemo(() => {
    if (!form.id) return [];
    return orders.filter((o) => o.customerId === form.id).slice(0, 5);
  }, [orders, form.id]);

  return (
    <div id="customers-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Quản lý khách hàng &amp; Công nợ
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Click vào bất kỳ dòng nào để sửa hồ sơ. Hỗ trợ chọn nhiều dòng để gộp khách trùng hoặc xóa về khách lẻ.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Thêm khách hàng</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng khách đã lưu</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.totalCustomers}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">
            Tổng công nợ phải thu ({stats.debtCustomerCount} khách)
          </p>
          <p className="mt-1 font-display text-2xl font-bold text-rose-700 tabular-nums">
            {formatVnd(stats.totalDebt)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng chi tiêu tích lũy</p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700 tabular-nums">
            {formatVnd(stats.totalSpent)}
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

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <label htmlFor="admin-customers-search" className="sr-only">
            Tìm khách theo SĐT, tên, địa chỉ, khu vực, MST hoặc ghi chú
          </label>
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="admin-customers-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm SĐT, tên, địa chỉ, khu vực, MST, STK..."
            className="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Xóa tìm kiếm khách hàng"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <select
          aria-label="Lọc theo khu vực"
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
        >
          <option value="all">Tất cả khu vực</option>
          {availableAreas.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>

        <select
          aria-label="Lọc theo nhóm khách hàng"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
        >
          <option value="all">Tất cả nhóm khách</option>
          {availableGroups.map((grp) => (
            <option key={grp} value={grp}>
              {grp}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 min-h-[42px] px-3 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={onlyWithDebt}
            onChange={(e) => setOnlyWithDebt(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-700"
          />
          <span>Chỉ khách còn nợ</span>
        </label>
      </div>

      {/* Bulk action bar (manager / admin) */}
      {canBulkModify && selectedIds.length > 0 && (
        <div
          data-testid="customers-bulk-bar"
          className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
            <span>Đã chọn {selectedIds.length} khách hàng</span>
            <button
              type="button"
              onClick={() => {
                setSelectedIds([]);
                setIsBulkDeleteConfirmOpen(false);
              }}
              className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
            >
              (Bỏ chọn)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={selectedIds.length < 2}
              onClick={openMergeModal}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <GitMerge className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Gộp khách hàng ({selectedIds.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setIsBulkDeleteConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Xóa đã chọn ({selectedIds.length})</span>
            </button>
          </div>
        </div>
      )}

      {isBulkDeleteConfirmOpen && (
        <div
          role="alertdialog"
          aria-labelledby="bulk-delete-title"
          className="p-4 bg-rose-50 border border-rose-300 rounded-xl space-y-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className="w-5 h-5 text-rose-700 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-sm text-rose-950 space-y-1">
              <p id="bulk-delete-title" className="font-bold">
                Xác nhận xóa {selectedIds.length} khách hàng đã chọn?
              </p>
              <p className="text-xs text-rose-900">
                Thông tin <strong>tên khách hàng, số điện thoại và địa chỉ giao nhận trên tất cả đơn hàng cũ vẫn được giữ nguyên</strong> (chỉ bỏ liên kết hồ sơ để chuyển thành đơn khách lẻ).
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isBulkDeleting}
              onClick={() => setIsBulkDeleteConfirmOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={isBulkDeleting}
              onClick={() => void handleConfirmBulkDelete()}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer disabled:opacity-60"
            >
              {isBulkDeleting ? 'Đang xóa...' : 'Xác nhận xóa'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {filteredCustomers.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <Users className="w-9 h-9 text-slate-300 mx-auto mb-2.5" aria-hidden="true" />
            <p className="font-display text-base font-semibold text-slate-900">
              {customers.length === 0
                ? 'Chưa có thông tin khách hàng nào được lưu'
                : 'Không tìm thấy khách hàng phù hợp'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Khi khách đặt hàng kèm số điện thoại, hệ thống sẽ tự động lưu lại vào bảng này.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  {canBulkModify && (
                    <th className="py-3 px-3 text-center w-10">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả khách hàng đang lọc"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        className="w-4 h-4 rounded border-slate-300 text-blue-700 cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="py-3 px-4">Số điện thoại</th>
                  <th className="py-3 px-4">Tên &amp; Liên hệ</th>
                  <th className="py-3 px-4">Khu vực / Nhóm</th>
                  <th className="py-3 px-4">Địa chỉ &amp; Lưu ý</th>
                  <th className="py-3 px-4 text-center">Số đơn</th>
                  <th className="py-3 px-4 text-right">Tổng chi</th>
                  <th className="py-3 px-4 text-right">Công nợ</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredCustomers.map((c) => {
                  const isSelected = selectedIds.includes(c.id);
                  const debt = customerDebtMap.get(c.id);
                  const debtAmount = debt?.debtAmount ?? 0;
                  return (
                    <tr
                      key={c.id || c.phone}
                      onClick={() => openEdit(c)}
                      title="Click vào dòng để xem / chỉnh sửa thông tin khách hàng"
                      className={`align-top cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 hover:bg-blue-50'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {canBulkModify && (
                        <td
                          className="py-3.5 px-3 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Chọn khách hàng ${c.fullName || c.phone}`}
                            checked={isSelected}
                            onChange={() => toggleSelectOne(c.id)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-700 cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        <p>{c.phone}</p>
                        {c.taxCode && (
                          <p className="mt-0.5 text-[11px] font-normal text-slate-500">
                            MST: {c.taxCode}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-slate-900">
                          {c.fullName || 'Khách chưa rõ tên'}
                        </p>
                        {c.email && (
                          <p className="text-xs text-slate-500 mt-0.5">{c.email}</p>
                        )}
                        {(c.bankAccount || c.bankName) && (
                          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                            {c.bankAccount || ''}
                            {c.bankName ? ` (${c.bankName})` : ''}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs whitespace-nowrap space-y-1">
                        <span className="inline-block px-2 py-0.5 font-semibold rounded bg-slate-100 text-slate-800 border border-slate-200">
                          {c.customerGroup || 'Khách lẻ'}
                        </span>
                        {c.area && (
                          <p className="text-slate-600">{c.area}</p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 max-w-[260px] space-y-1.5">
                        <p className="text-xs text-slate-600">
                          {c.defaultAddress || '—'}
                        </p>
                        {c.notes && (
                          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 leading-relaxed">
                            {c.notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center tabular-nums">
                        <span className="font-semibold text-slate-900">
                          {c.totalOrders}
                        </span>
                        {c.lastOrderAt && (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {c.lastOrderAt}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold tabular-nums text-blue-700 whitespace-nowrap">
                        {formatVnd(c.totalSpent)}
                      </td>
                      <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                        {debtAmount > 0 ? (
                          <div className="space-y-1">
                            <span className="font-bold text-rose-700">
                              {formatVnd(debtAmount)}
                            </span>
                            {debt?.overCreditLimit && (
                              <p className="text-[10px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 inline-block">
                                Vượt hạn mức
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">0đ</span>
                        )}
                      </td>
                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmDeleteId === c.id ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <span className="text-[10px] text-slate-500">
                              Đơn cũ giữ nguyên
                            </span>
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleDelete(c)}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
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
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            {debtAmount > 0 && onOpenCashVoucher && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenCashVoucher({
                                    voucherType: 'receipt',
                                    category: 'customer_debt',
                                    customerId: c.id,
                                    counterpartyName: c.fullName || c.phone,
                                    amount: debtAmount,
                                    note: `Thu nợ khách ${c.fullName || c.phone}`,
                                  })
                                }
                                title="Lập phiếu thu nợ khách này"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                              >
                                <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Thu nợ</span>
                              </button>
                            )}
                            {canBulkModify && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(c.id)}
                                aria-label={`Xóa khách ${c.fullName || c.phone}`}
                                title="Xóa khách hàng (đơn cũ chuyển thành khách lẻ)"
                                className="inline-flex items-center p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Customer Modal */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="customer-form-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {form.id ? 'Cập nhật thông tin khách hàng' : 'Thêm khách hàng mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                aria-label="Đóng biểu mẫu khách hàng"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSave(e)}
              className="p-6 space-y-4 overflow-y-auto"
            >
              {form.id && editingCustomerDebt && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div>
                      <span className="text-slate-500 block">Tổng mua</span>
                      <strong className="text-sm text-slate-900 tabular-nums">
                        {formatVnd(editingCustomerDebt.totalOrderAmount)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Đã thanh toán</span>
                      <strong className="text-sm text-emerald-700 tabular-nums">
                        {formatVnd(editingCustomerDebt.totalPaidAmount)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Còn nợ</span>
                      <strong
                        className={`text-sm tabular-nums ${
                          editingCustomerDebt.debtAmount > 0
                            ? 'text-rose-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {formatVnd(editingCustomerDebt.debtAmount)}
                      </strong>
                    </div>
                  </div>
                  {editingCustomerDebt.debtAmount > 0 && onOpenCashVoucher && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsFormOpen(false);
                        onOpenCashVoucher({
                          voucherType: 'receipt',
                          category: 'customer_debt',
                          customerId: form.id,
                          counterpartyName: form.fullName || form.phone,
                          amount: editingCustomerDebt.debtAmount,
                          note: `Thu nợ khách ${form.fullName || form.phone}`,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Lập phiếu thu nợ</span>
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số điện thoại *
                  </label>
                  <input
                    type="tel"
                    required
                    value={form.phone}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder="0916319452"
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên khách hàng
                  </label>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, fullName: e.target.value }))
                    }
                    placeholder="VD: Chị Lan CT2"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nhóm khách hàng
                  </label>
                  <select
                    value={form.customerGroup}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        customerGroup: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {availableGroups.map((grp) => (
                      <option key={grp} value={grp}>
                        {grp}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Khu vực / Tuyến
                  </label>
                  <input
                    type="text"
                    value={form.area}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, area: e.target.value }))
                    }
                    placeholder="VD: Green Star, Cổ Nhuế..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Hạn mức công nợ (đ)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50000"
                    value={form.creditLimit}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        creditLimit: e.target.value,
                      }))
                    }
                    placeholder="Để trống nếu không giới hạn"
                    className={`w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã số thuế (nếu xuất hóa đơn)
                  </label>
                  <input
                    type="text"
                    value={form.taxCode}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, taxCode: e.target.value }))
                    }
                    placeholder="010..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    placeholder="khachhang@domain.vn"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số tài khoản ngân hàng
                  </label>
                  <input
                    type="text"
                    value={form.bankAccount}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        bankAccount: e.target.value,
                      }))
                    }
                    placeholder="1903..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ngân hàng &amp; chi nhánh
                  </label>
                  <input
                    type="text"
                    value={form.bankName}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        bankName: e.target.value,
                      }))
                    }
                    placeholder="Vietcombank / Techcombank..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Địa chỉ mặc định
                </label>
                <input
                  type="text"
                  value={form.defaultAddress}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultAddress: e.target.value,
                    }))
                  }
                  placeholder="Phòng / Tòa nhà / Trường học..."
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú thông tin / Lưu ý về khách hàng
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="VD: Hay mua vở 4 ô ly Hồng Hà, giao sau 20h, thanh toán chuyển khoản..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {form.id && editingCustomerOrders.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-700">
                    5 đơn hàng gần nhất
                  </p>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
                    {editingCustomerOrders.map((ord) => {
                      const remaining = getOrderRemainingDebt(ord);
                      return (
                        <div
                          key={ord.orderCode}
                          className="px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-semibold text-slate-900">
                              {ord.orderCode}
                            </span>
                            <span className="text-slate-500 ml-2">
                              {ord.createdAt}
                            </span>
                          </div>
                          <div className="text-right tabular-nums">
                            <span className="font-semibold text-slate-900">
                              {formatVnd(ord.total)}
                            </span>
                            {remaining > 0 ? (
                              <span className="ml-2 text-rose-700 font-semibold">
                                (Nợ {formatVnd(remaining)})
                              </span>
                            ) : (
                              <span className="ml-2 text-emerald-700">
                                Đã thu
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                  onClick={() => setIsFormOpen(false)}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>{isSaving ? 'Đang lưu...' : 'Lưu khách hàng'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge Customers Modal */}
      {isMergeModalOpen && mergeForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="merge-customers-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="merge-customers-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Gộp {selectedCustomers.length} hồ sơ khách hàng
              </h3>
              <button
                type="button"
                onClick={() => setIsMergeModalOpen(false)}
                aria-label="Đóng hộp thoại gộp khách hàng"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleConfirmMerge(e)}
              className="p-6 space-y-4 overflow-y-auto"
            >
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950 space-y-1">
                <p className="font-semibold">
                  Toàn bộ đơn hàng và phiếu thu chi của các hồ sơ trùng sẽ tự động chuyển về hồ sơ chính được chọn bên dưới.
                </p>
                <p>
                  Tổng hợp dự kiến: <strong>{mergeForm.combinedOrdersCount}</strong> đơn ·{' '}
                  <strong>{formatVnd(mergeForm.combinedTotalSpent)}</strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Chọn hồ sơ chính giữ lại
                </label>
                <div className="space-y-1.5">
                  {selectedCustomers.map((c) => (
                    <label
                      key={c.id}
                      className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border text-xs cursor-pointer ${
                        mergeForm.primaryId === c.id
                          ? 'bg-blue-50 border-blue-400'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="merge-primary-customer"
                          checked={mergeForm.primaryId === c.id}
                          onChange={() =>
                            applyPrimaryToMergeForm(selectedCustomers, c.id)
                          }
                          className="w-4 h-4 text-blue-700"
                        />
                        <span className="font-semibold text-slate-900">
                          {c.fullName || 'Khách chưa rõ tên'}
                        </span>
                        <span className="font-mono text-slate-600">
                          ({c.phone})
                        </span>
                      </span>
                      <span className="text-slate-600 tabular-nums">
                        {c.totalOrders} đơn · {formatVnd(c.totalSpent)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số điện thoại sau gộp *
                  </label>
                  <input
                    type="tel"
                    required
                    value={mergeForm.phone}
                    onChange={(e) =>
                      setMergeForm((prev) =>
                        prev ? { ...prev, phone: e.target.value } : prev,
                      )
                    }
                    className="w-full min-h-[38px] px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên khách hàng sau gộp
                  </label>
                  <input
                    type="text"
                    value={mergeForm.fullName}
                    onChange={(e) =>
                      setMergeForm((prev) =>
                        prev ? { ...prev, fullName: e.target.value } : prev,
                      )
                    }
                    className="w-full min-h-[38px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nhóm khách
                  </label>
                  <select
                    value={mergeForm.customerGroup}
                    onChange={(e) =>
                      setMergeForm((prev) =>
                        prev ? { ...prev, customerGroup: e.target.value } : prev,
                      )
                    }
                    className="w-full min-h-[38px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {availableGroups.map((grp) => (
                      <option key={grp} value={grp}>
                        {grp}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Khu vực
                  </label>
                  <input
                    type="text"
                    value={mergeForm.area}
                    onChange={(e) =>
                      setMergeForm((prev) =>
                        prev ? { ...prev, area: e.target.value } : prev,
                      )
                    }
                    className="w-full min-h-[38px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Địa chỉ mặc định sau gộp
                  </label>
                  <input
                    type="text"
                    value={mergeForm.defaultAddress}
                    onChange={(e) =>
                      setMergeForm((prev) =>
                        prev
                          ? { ...prev, defaultAddress: e.target.value }
                          : prev,
                      )
                    }
                    className="w-full min-h-[38px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ghi chú hợp nhất
                  </label>
                  <textarea
                    rows={2}
                    value={mergeForm.notes}
                    onChange={(e) =>
                      setMergeForm((prev) =>
                        prev ? { ...prev, notes: e.target.value } : prev,
                      )
                    }
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {mergeError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
                >
                  {mergeError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isMerging}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  <GitMerge className="w-4 h-4" aria-hidden="true" />
                  <span>{isMerging ? 'Đang gộp...' : 'Xác nhận gộp khách'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

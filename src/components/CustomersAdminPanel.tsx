import { useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  deleteAdminCustomer,
  upsertAdminCustomer,
} from '../lib/supabaseAdmin';
import type { CustomerRecord, UserRole } from '../types/shop';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';

interface CustomersAdminPanelProps {
  customers: CustomerRecord[];
  userRole: UserRole;
  isLoading: boolean;
  notice?: string;
  onRefresh: () => Promise<void>;
}

interface CustomerFormState {
  id?: string;
  phone: string;
  fullName: string;
  defaultAddress: string;
  notes: string;
}

const EMPTY_CUSTOMER_FORM: CustomerFormState = {
  phone: '',
  fullName: '',
  defaultAddress: '',
  notes: '',
};

export function CustomersAdminPanel({
  customers,
  userRole,
  isLoading,
  notice,
  onRefresh,
}: CustomersAdminPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredCustomers = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    if (!norm) return customers;
    return customers.filter((c) => {
      const hay = normalizeVietnameseText(
        `${c.phone} ${c.fullName} ${c.defaultAddress} ${c.notes}`,
      );
      return hay.includes(norm);
    });
  }, [customers, searchQuery]);

  const stats = useMemo(() => {
    const totalCustomers = customers.length;
    const withNotes = customers.filter((c) => c.notes.trim().length > 0).length;
    const totalSpent = customers.reduce((sum, c) => sum + c.totalSpent, 0);
    return { totalCustomers, withNotes, totalSpent };
  }, [customers]);

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

    setFormError(null);
    setIsSaving(true);
    try {
      const res = await upsertAdminCustomer({
        id: form.id,
        phone: cleanPhone,
        fullName: form.fullName,
        defaultAddress: form.defaultAddress,
        notes: form.notes,
      });

      if (res.errorMessage) {
        setFormError(res.errorMessage);
        return;
      }

      setIsFormOpen(false);
      setFeedback(
        form.id
          ? `Đã cập nhật thông tin & ghi chú khách ${form.fullName || cleanPhone}.`
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
    setFeedback(`Đã xóa khách hàng ${customer.fullName || customer.phone}.`);
    await onRefresh();
  };

  return (
    <div id="customers-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Quản lý khách hàng &amp; Lưu ý
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Tự động lưu khi có khách mới đặt hàng qua SĐT, hỗ trợ ghi chú lưu ý riêng cho từng khách.
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
          <p className="text-xs font-medium text-slate-500">Có ghi chú lưu ý</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {stats.withNotes}
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

      <div className="relative w-full md:w-96">
        <label htmlFor="admin-customers-search" className="sr-only">
          Tìm khách theo SĐT, tên, địa chỉ hoặc ghi chú
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
          placeholder="Tìm SĐT, tên khách, địa chỉ, ghi chú..."
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
            <table className="w-full min-w-[860px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Số điện thoại</th>
                  <th className="py-3 px-4">Tên khách hàng</th>
                  <th className="py-3 px-4">Địa chỉ mặc định</th>
                  <th className="py-3 px-4">Ghi chú / Lưu ý</th>
                  <th className="py-3 px-4 text-center">Số đơn</th>
                  <th className="py-3 px-4 text-right">Tổng chi</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredCustomers.map((c) => (
                  <tr key={c.id || c.phone} className="hover:bg-slate-50/70 align-top">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {c.phone}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-900">
                      {c.fullName || 'Khách chưa rõ tên'}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 max-w-[220px]">
                      {c.defaultAddress || '—'}
                    </td>
                    <td className="py-3.5 px-4 max-w-[260px]">
                      {c.notes ? (
                        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 leading-relaxed">
                          {c.notes}
                        </p>
                      ) : (
                        <span className="text-xs text-slate-400">Chưa có lưu ý</span>
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
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {confirmDeleteId === c.id ? (
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
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Sửa / Ghi chú</span>
                          </button>
                          {(userRole === 'admin' || userRole === 'manager') && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(c.id)}
                              aria-label={`Xóa khách ${c.fullName || c.phone}`}
                              className="inline-flex items-center p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl">
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

            <form onSubmit={(e) => void handleSave(e)} className="p-6 space-y-4">
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
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
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
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="VD: Hay mua vở 4 ô ly Hồng Hà, giao sau 20h, thanh toán chuyển khoản..."
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
    </div>
  );
}

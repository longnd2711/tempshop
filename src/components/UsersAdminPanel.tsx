import { useMemo, useState, type FormEvent } from 'react';
import {
  Briefcase,
  Check,
  Info,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserCog,
  X,
} from 'lucide-react';
import { updateAdminUserProfile } from '../lib/supabaseAdmin';
import type { AdminUser, UserProfileRecord, UserRole } from '../types/shop';
import { canManageUsers } from '../utils/adminLogic';
import { normalizeVietnameseText } from '../utils/shopLogic';

interface UsersAdminPanelProps {
  users: UserProfileRecord[];
  currentUser: AdminUser;
  isLoading: boolean;
  notice?: string;
  onRefresh: () => Promise<void>;
}

interface UserFormState {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
  notes: string;
  role: UserRole;
}

export function UsersAdminPanel({
  users,
  currentUser,
  isLoading,
  notice,
  onRefresh,
}: UsersAdminPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingForm, setEditingForm] = useState<UserFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredUsers = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    if (!norm) return users;
    return users.filter((u) => {
      const hay = normalizeVietnameseText(
        `${u.email} ${u.fullName} ${u.phone} ${u.notes} ${u.role}`,
      );
      return hay.includes(norm);
    });
  }, [users, searchQuery]);

  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const managers = users.filter((u) => u.role === 'manager').length;
    const staffs = users.filter((u) => u.role === 'staff').length;
    return { total, admins, managers, staffs };
  }, [users]);

  if (!canManageUsers(currentUser.role)) {
    return (
      <div
        role="alert"
        className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900"
      >
        Chỉ tài khoản Quản trị (<strong>admin</strong>) mới có quyền xem và chỉnh sửa danh sách người dùng.
      </div>
    );
  }

  const openEdit = (user: UserProfileRecord) => {
    setEditingForm({
      userId: user.userId,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      notes: user.notes,
      role: user.role,
    });
    setFormError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingForm) return;

    const cleanPhone = editingForm.phone.replace(/[\s.-]/g, '').trim();
    if (cleanPhone.length > 0 && !/^0\d{9,10}$/.test(cleanPhone)) {
      setFormError(
        'Số điện thoại không hợp lệ (cần bắt đầu bằng 0 và gồm 10–11 chữ số, hoặc để trống).',
      );
      return;
    }

    if (editingForm.userId === currentUser.id && editingForm.role !== 'admin') {
      setFormError(
        'Không thể tự hạ quyền tài khoản admin đang đăng nhập để tránh mất quyền quản trị.',
      );
      return;
    }

    setFormError(null);
    setIsSaving(true);
    try {
      const res = await updateAdminUserProfile({
        userId: editingForm.userId,
        fullName: editingForm.fullName,
        phone: cleanPhone,
        notes: editingForm.notes,
        role: editingForm.role,
      });

      if (res.errorMessage) {
        setFormError(res.errorMessage);
        return;
      }

      setEditingForm(null);
      setFeedback(
        `Đã cập nhật thông tin tài khoản ${editingForm.email || editingForm.fullName}.`,
      );
      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div id="users-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Quản lý người dùng &amp; Phân quyền
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Cập nhật họ tên, số điện thoại, ghi chú và phân quyền: Nhân viên (staff), Quản lý (manager) và Toàn quyền (admin).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 self-start sm:self-auto"
        >
          <RefreshCw
            className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{isLoading ? 'Đang tải...' : 'Làm mới danh sách'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng tài khoản</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.total}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Toàn quyền (Admin)</p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700 tabular-nums">
            {stats.admins}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Quản lý (Manager)</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {stats.managers}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Nhân viên (Staff)</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {stats.staffs}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 p-3.5 text-xs sm:text-sm text-blue-950 bg-blue-50 border border-blue-200 rounded-xl">
        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="leading-relaxed">
          Để thêm tài khoản đăng nhập mới, hãy tạo email/mật khẩu trong{' '}
          <strong>Supabase Dashboard → Authentication → Users</strong> (hồ sơ mặc định là{' '}
          <strong>staff</strong>), sau đó bấm <strong>Làm mới danh sách</strong> tại đây để cập nhật số điện thoại, ghi chú và nâng quyền nếu cần.
        </p>
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
        <label htmlFor="admin-users-search" className="sr-only">
          Tìm người dùng theo email, họ tên, số điện thoại hoặc ghi chú
        </label>
        <Search
          className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          id="admin-users-search"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm email, họ tên, SĐT, ghi chú..."
          className="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Xóa từ khóa tìm người dùng"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {filteredUsers.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <UserCog
              className="w-9 h-9 text-slate-300 mx-auto mb-2.5"
              aria-hidden="true"
            />
            <p className="font-display text-base font-semibold text-slate-900">
              {users.length === 0
                ? 'Chưa có hồ sơ người dùng nào'
                : 'Không tìm thấy tài khoản khớp từ khóa'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Kiểm tra kết nối Supabase hoặc chạy lại script SQL nếu mới tạo bảng.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              data-testid="users-table"
              className="w-full min-w-[820px] text-left border-collapse"
            >
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Email tài khoản</th>
                  <th className="py-3 px-4">Họ và tên</th>
                  <th className="py-3 px-4">Số điện thoại</th>
                  <th className="py-3 px-4">Ghi chú</th>
                  <th className="py-3 px-4">Phân quyền</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredUsers.map((u) => {
                  const isSelf = u.userId === currentUser.id;
                  return (
                    <tr key={u.userId} className="hover:bg-slate-50/70 align-top">
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-slate-900 break-all">
                          {u.email || '—'}
                        </p>
                        {isSelf && (
                          <span className="inline-block mt-1 px-2 py-0.5 text-[11px] font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded">
                            Đang đăng nhập
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-900">
                        {u.fullName || (
                          <span className="text-xs text-slate-400 font-normal">
                            Chưa cập nhật
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs sm:text-sm text-slate-800 whitespace-nowrap">
                        {u.phone || (
                          <span className="font-sans text-xs text-slate-400">
                            —
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 max-w-[260px]">
                        {u.notes ? (
                          <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 leading-relaxed">
                            {u.notes}
                          </p>
                        ) : (
                          <span className="text-xs text-slate-400">
                            Chưa có ghi chú
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border ${
                            u.role === 'admin'
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : u.role === 'manager'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {u.role === 'admin' ? (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Quản trị (Admin)</span>
                            </>
                          ) : u.role === 'manager' ? (
                            <>
                              <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Quản lý (Manager)</span>
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Nhân viên (Staff)</span>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Sửa thông tin</span>
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

      {editingForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="user-form-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                Cập nhật tài khoản người dùng
              </h3>
              <button
                type="button"
                onClick={() => setEditingForm(null)}
                aria-label="Đóng biểu mẫu người dùng"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Email đăng nhập
                </label>
                <input
                  type="text"
                  readOnly
                  value={editingForm.email}
                  className="w-full min-h-[40px] px-3 py-2 text-sm bg-slate-100 border border-slate-200 rounded-lg text-slate-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="user-edit-fullname"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Họ và tên
                  </label>
                  <input
                    id="user-edit-fullname"
                    type="text"
                    value={editingForm.fullName}
                    onChange={(e) =>
                      setEditingForm((prev) =>
                        prev ? { ...prev, fullName: e.target.value } : prev,
                      )
                    }
                    placeholder="VD: Nguyễn Thu Hương"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="user-edit-phone"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Số điện thoại
                  </label>
                  <input
                    id="user-edit-phone"
                    type="tel"
                    value={editingForm.phone}
                    onChange={(e) =>
                      setEditingForm((prev) =>
                        prev ? { ...prev, phone: e.target.value } : prev,
                      )
                    }
                    placeholder="0916319452"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="user-edit-role"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Phân quyền
                </label>
                <select
                  id="user-edit-role"
                  value={editingForm.role}
                  disabled={editingForm.userId === currentUser.id}
                  onChange={(e) =>
                    setEditingForm((prev) =>
                      prev ? { ...prev, role: e.target.value as UserRole } : prev,
                    )
                  }
                  className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-500"
                >
                  <option value="staff">
                    Nhân viên (Staff) — Đơn hàng &amp; Khách hàng (không quản lý hàng hóa/nhập hàng)
                  </option>
                  <option value="manager">
                    Quản lý (Manager) — Đơn hàng, Khách hàng, Hàng hóa &amp; Nhập hàng (không xem/sửa người dùng)
                  </option>
                  <option value="admin">
                    Quản trị (Admin) — Toàn quyền hệ thống (bao gồm quản lý người dùng)
                  </option>
                </select>
                {editingForm.userId === currentUser.id && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Không thể thay đổi quyền của chính tài khoản bạn đang đăng nhập.
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="user-edit-notes"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Ghi chú về nhân sự / tài khoản
                </label>
                <textarea
                  id="user-edit-notes"
                  rows={3}
                  value={editingForm.notes}
                  onChange={(e) =>
                    setEditingForm((prev) =>
                      prev ? { ...prev, notes: e.target.value } : prev,
                    )
                  }
                  placeholder="VD: Ca tối 18h-22h, phụ trách kiểm đơn chung cư Green Star..."
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
                  onClick={() => setEditingForm(null)}
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
                  <span>{isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

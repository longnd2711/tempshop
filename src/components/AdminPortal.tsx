import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Briefcase,
  ClipboardList,
  Lock,
  LogOut,
  Package,
  PackagePlus,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  AdminTab,
  AdminUser,
  CashVoucherRecord,
  CategoryNode,
  CustomerRecord,
  OrderRecord,
  Product,
  PurchaseOrderRecord,
  QuickVoucherDraft,
  SupplierRecord,
  UserProfileRecord,
} from '../types/shop';
import {
  canAccessAdminTab,
  canManageInventory,
  canManageUsers,
  resolveAllowedAdminTab,
} from '../utils/adminLogic';
import { CashbookAdminPanel } from './CashbookAdminPanel';
import { CustomersAdminPanel } from './CustomersAdminPanel';
import { OrdersPage } from './OrdersPage';
import { ProductsAdminPanel } from './ProductsAdminPanel';
import { PurchasesAdminPanel } from './PurchasesAdminPanel';
import { UsersAdminPanel } from './UsersAdminPanel';

interface AdminPortalProps {
  requestedTab: AdminTab;
  adminUser: AdminUser | null;
  isCheckingAuth: boolean;
  onSignIn: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; errorMessage?: string }>;
  onSignOut: () => Promise<void>;
  onSelectTab: (tab: AdminTab) => void;
  onBackToShop: () => void;

  orders: OrderRecord[];
  posProducts: Product[];
  isLoadingOrders: boolean;
  ordersNotice?: string;
  loginNonce?: number;
  posOpenNonce?: number;
  onRefreshOrders: () => void;
  onToggleOrderConfirm: (order: OrderRecord) => void;
  onToggleOrderDelivered: (order: OrderRecord) => void;
  onToggleOrderPaid: (order: OrderRecord) => void;
  onCreateOrder: (order: OrderRecord) => Promise<{
    synced: boolean;
    errorMessage?: string;
  }>;
  onUpdateOrder: (order: OrderRecord) => Promise<{
    synced: boolean;
    errorMessage?: string;
  }>;

  customers: CustomerRecord[];
  isLoadingCustomers: boolean;
  customersNotice?: string;
  onRefreshCustomers: () => Promise<void>;

  adminProducts: Product[];
  adminCategories: CategoryNode[];
  isLoadingAdminProducts: boolean;
  adminProductsNotice?: string;
  onRefreshAdminProducts: () => Promise<void>;

  purchaseOrders: PurchaseOrderRecord[];
  suppliers: SupplierRecord[];
  isLoadingPurchases: boolean;
  purchasesNotice?: string;
  onRefreshPurchases: () => Promise<void>;
  onRefreshSuppliers: () => Promise<void>;

  cashVouchers: CashVoucherRecord[];
  isLoadingCashbook: boolean;
  cashbookNotice?: string;
  onRefreshCashbook: () => Promise<void>;

  adminUsers: UserProfileRecord[];
  isLoadingUsers: boolean;
  usersNotice?: string;
  onRefreshUsers: () => Promise<void>;
}

const TAB_CONFIG: Array<{
  id: AdminTab;
  label: string;
  icon: typeof ClipboardList;
}> = [
  { id: 'orders', label: 'Quản lý đơn hàng', icon: ClipboardList },
  { id: 'customers', label: 'Khách hàng', icon: Users },
  { id: 'products', label: 'Quản lý hàng hóa', icon: Package },
  { id: 'purchases', label: 'Nhập hàng', icon: PackagePlus },
  { id: 'cashbook', label: 'Thu Chi & Công nợ', icon: Wallet },
  { id: 'users', label: 'Người dùng', icon: UserCog },
];

export function AdminPortal({
  requestedTab,
  adminUser,
  isCheckingAuth,
  onSignIn,
  onSignOut,
  onSelectTab,
  onBackToShop,
  orders,
  posProducts,
  isLoadingOrders,
  ordersNotice,
  loginNonce = 0,
  posOpenNonce = 0,
  onRefreshOrders,
  onToggleOrderConfirm,
  onToggleOrderDelivered,
  onToggleOrderPaid,
  onCreateOrder,
  onUpdateOrder,
  customers,
  isLoadingCustomers,
  customersNotice,
  onRefreshCustomers,
  adminProducts,
  adminCategories,
  isLoadingAdminProducts,
  adminProductsNotice,
  onRefreshAdminProducts,
  purchaseOrders,
  suppliers,
  isLoadingPurchases,
  purchasesNotice,
  onRefreshPurchases,
  onRefreshSuppliers,
  cashVouchers,
  isLoadingCashbook,
  cashbookNotice,
  onRefreshCashbook,
  adminUsers,
  isLoadingUsers,
  usersNotice,
  onRefreshUsers,
}: AdminPortalProps) {
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [pendingVoucherDraft, setPendingVoucherDraft] =
    useState<QuickVoucherDraft | null>(null);

  const handleOpenCashVoucher = (draft: QuickVoucherDraft) => {
    setPendingVoucherDraft(draft);
    onSelectTab('cashbook');
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError('Vui lòng nhập đầy đủ email và mật khẩu.');
      return;
    }
    setLoginError(null);
    setIsSubmittingLogin(true);
    try {
      const res = await onSignIn(loginEmail, loginPassword);
      if (!res.ok) {
        setLoginError(res.errorMessage ?? 'Đăng nhập không thành công.');
      } else {
        setLoginPassword('');
      }
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <section className="py-12 min-h-[70vh]">
        <div className="max-w-md mx-auto px-4">
          <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center">
            <p className="text-sm text-slate-600">
              Đang kiểm tra phiên đăng nhập Trang quản lý...
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!adminUser) {
    return (
      <section id="admin-login" className="py-10 sm:py-16 min-h-[70vh]">
        <div className="max-w-md mx-auto px-4">
          <button
            type="button"
            onClick={onBackToShop}
            className="inline-flex items-center gap-1.5 min-h-[38px] text-sm font-medium text-blue-700 hover:text-blue-800 cursor-pointer mb-4"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Quay lại trang cửa hàng</span>
          </button>

          <div className="p-6 sm:p-8 bg-white border border-slate-200 rounded-2xl shadow-xs">
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mb-4">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </div>

            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Đăng nhập Trang quản lý
            </h1>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Nhân viên (<strong>staff</strong>) quản lý đơn hàng và khách hàng. Quản lý (<strong>manager</strong>) có thêm quyền hàng hóa và nhập hàng (không xem/sửa người dùng). Quản trị (<strong>admin</strong>) có toàn quyền hệ thống.
            </p>

            <form
              onSubmit={(e) => void handleLoginSubmit(e)}
              noValidate
              className="mt-6 space-y-4"
            >
              <div>
                <label
                  htmlFor="admin-email"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Email tài khoản
                </label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="staff@vpphuonglong.vn"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-password"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Mật khẩu
                </label>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Nhập mật khẩu"
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                />
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
                >
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmittingLogin}
                className="w-full min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {isSubmittingLogin ? 'Đang đăng nhập...' : 'Đăng nhập Trang quản lý'}
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  const activeTab = resolveAllowedAdminTab(adminUser.role, requestedTab);
  const isDeniedRequestedTab = !canAccessAdminTab(adminUser.role, requestedTab);

  return (
    <section
      id="admin-portal"
      className="py-8 sm:py-10 lg:py-12 min-h-[70vh]"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <button
              type="button"
              onClick={onBackToShop}
              className="inline-flex items-center gap-1.5 min-h-[38px] text-sm font-medium text-blue-700 hover:text-blue-800 cursor-pointer mb-2"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Quay lại trang cửa hàng</span>
            </button>

            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Trang quản lý
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>
                Tài khoản:{' '}
                <strong className="font-medium text-slate-900">
                  {adminUser.email}
                </strong>
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold rounded-md border ${
                  adminUser.role === 'admin'
                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                    : adminUser.role === 'manager'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                {adminUser.role === 'admin' ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Quản trị (Admin)</span>
                  </>
                ) : adminUser.role === 'manager' ? (
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
            </div>
          </div>

          <button
            type="button"
            onClick={() => void onSignOut()}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[40px] px-4 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Đăng xuất</span>
          </button>
        </div>

        <nav
          role="tablist"
          aria-label="Chức năng Trang quản lý"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3"
        >
          {TAB_CONFIG.filter((tab) =>
            canAccessAdminTab(adminUser.role, tab.id),
          ).map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={() => onSelectTab(tab.id)}
                className={`inline-flex items-center gap-2 min-h-[42px] px-4 py-2 text-sm font-semibold rounded-lg border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {isDeniedRequestedTab && (
          <div
            role="alert"
            className="px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
          >
            {adminUser.role === 'manager' ? (
              <>
                Tài khoản Quản lý (<strong>manager</strong>) không có quyền xem hoặc chỉnh sửa{' '}
                <strong>Người dùng</strong>. Mục này chỉ dành cho Quản trị (
                <strong>admin</strong>).
              </>
            ) : (
              <>
                Tài khoản nhân viên (<strong>staff</strong>) chỉ có quyền truy cập{' '}
                <strong>Quản lý đơn hàng</strong>, <strong>Khách hàng</strong> và{' '}
                <strong>Thu Chi &amp; Công nợ</strong>. Các mục{' '}
                <strong>Quản lý hàng hóa</strong>, <strong>Nhập hàng</strong> và{' '}
                <strong>Người dùng</strong> không nằm trong quyền của nhân viên.
              </>
            )}
          </div>
        )}

        {activeTab === 'orders' && (
          <OrdersPage
            orders={orders}
            products={posProducts}
            categories={adminCategories}
            customers={customers}
            userRole={adminUser.role}
            isLoading={isLoadingOrders}
            notice={ordersNotice}
            loginNonce={loginNonce}
            posOpenNonce={posOpenNonce}
            onRefresh={onRefreshOrders}
            onBackToShop={onBackToShop}
            onToggleConfirm={onToggleOrderConfirm}
            onToggleDelivered={onToggleOrderDelivered}
            onTogglePaid={onToggleOrderPaid}
            onCreateOrder={onCreateOrder}
            onUpdateOrder={onUpdateOrder}
            onOpenCashVoucher={handleOpenCashVoucher}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersAdminPanel
            customers={customers}
            orders={orders}
            userRole={adminUser.role}
            isLoading={isLoadingCustomers}
            notice={customersNotice}
            onRefresh={onRefreshCustomers}
            onOpenCashVoucher={handleOpenCashVoucher}
          />
        )}

        {activeTab === 'products' && canManageInventory(adminUser.role) && (
          <ProductsAdminPanel
            products={adminProducts}
            categories={adminCategories}
            isLoading={isLoadingAdminProducts}
            notice={adminProductsNotice}
            onRefresh={onRefreshAdminProducts}
          />
        )}

        {activeTab === 'purchases' && canManageInventory(adminUser.role) && (
          <PurchasesAdminPanel
            purchaseOrders={purchaseOrders}
            suppliers={suppliers}
            products={adminProducts}
            categories={adminCategories}
            cashVouchers={cashVouchers}
            isLoading={isLoadingPurchases}
            notice={purchasesNotice}
            onRefresh={onRefreshPurchases}
            onRefreshProducts={onRefreshAdminProducts}
            onRefreshSuppliers={onRefreshSuppliers}
            onRefreshCashbook={onRefreshCashbook}
            onOpenCashVoucher={handleOpenCashVoucher}
          />
        )}

        {activeTab === 'cashbook' && (
          <CashbookAdminPanel
            vouchers={cashVouchers}
            orders={orders}
            customers={customers}
            purchaseOrders={purchaseOrders}
            suppliers={suppliers}
            userRole={adminUser.role}
            isLoading={isLoadingCashbook}
            notice={cashbookNotice}
            initialDraft={pendingVoucherDraft}
            onConsumeInitialDraft={() => setPendingVoucherDraft(null)}
            onRefresh={onRefreshCashbook}
          />
        )}

        {activeTab === 'users' && canManageUsers(adminUser.role) && (
          <UsersAdminPanel
            users={adminUsers}
            currentUser={adminUser}
            isLoading={isLoadingUsers}
            notice={usersNotice}
            onRefresh={onRefreshUsers}
          />
        )}
      </div>
    </section>
  );
}

import { ClipboardList, LogOut } from 'lucide-react';

interface FooterProps {
  isAuthenticated: boolean;
  onOpenAdminPortal: () => void;
  onSignOut: () => void;
}

export function Footer({
  isAuthenticated,
  onOpenAdminPortal,
  onSignOut,
}: FooterProps) {
  return (
    <footer className="bg-white border-t border-slate-200 pt-8 pb-24 md:pb-8">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs sm:text-sm text-slate-500">
        <div>
          <p className="font-display font-semibold text-slate-900">
            Shop VPP Hương Long
          </p>
          <p className="mt-1 max-w-xl">
            Hiện tại shop chỉ nhận giao hàng buổi tối, dự kiến sang năm sẽ mở cửa hàng trong khu, cảm ơn gia đình đã ủng hộ.
          </p>
        </div>

        <div className="flex items-center shrink-0">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-2 min-h-[44px] sm:min-h-[38px] px-4 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Đăng xuất</span>
            </button>
          ) : (
            <a
              href="#/admin"
              onClick={(e) => {
                e.preventDefault();
                onOpenAdminPortal();
              }}
              className="inline-flex items-center gap-2 min-h-[44px] sm:min-h-[38px] px-4 py-2 text-sm font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <ClipboardList className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>Trang quản lý</span>
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}

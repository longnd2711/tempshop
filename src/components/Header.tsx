import { useState } from 'react';
import { Menu, ShoppingBag, X } from 'lucide-react';
import type { CategoryId } from '../types/shop';
import { formatVnd } from '../utils/shopLogic';

interface HeaderProps {
  cartCount: number;
  cartSubtotal: number;
  onOpenCart: () => void;
  onSelectNavCategory: (category: CategoryId) => void;
}

const MENU_ITEMS: Array<{
  label: string;
  href: string;
  category?: string;
}> = [
  { label: 'Văn phòng phẩm', href: '#catalog', category: 'Văn phòng phẩm' },
  { label: 'Đồ dùng học sinh', href: '#catalog', category: 'Đồ dùng học sinh' },
  { label: 'Đồ chơi & Quà tặng', href: '#catalog', category: 'Đồ chơi & Quà tặng' },
  { label: 'Combo nhanh', href: '#bundles' },
];

export function Header({
  cartCount,
  cartSubtotal,
  onOpenCart,
  onSelectNavCategory,
}: HeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleMenuItemClick = (item: (typeof MENU_ITEMS)[number]) => {
    if (item.category) {
      onSelectNavCategory(item.category);
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-4 md:gap-8">
        <a
          href="#hero"
          onClick={() => setIsMobileMenuOpen(false)}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
        >
          VPP Hương Long
        </a>

        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          {MENU_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => handleMenuItemClick(item)}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenCart}
            aria-label={`Mở giỏ hàng, hiện có ${cartCount} sản phẩm`}
            className="hidden md:inline-flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 active:scale-[0.99] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 cursor-pointer"
          >
            <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              {cartCount > 0
                ? `Giỏ hàng (${cartCount}) · ${formatVnd(cartSubtotal)}`
                : 'Giỏ hàng (0)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={isMobileMenuOpen ? 'Đóng menu danh mục' : 'Mở menu danh mục'}
            className="md:hidden inline-flex items-center justify-center gap-1.5 min-w-[44px] h-11 px-3 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            {isMobileMenuOpen ? (
              <X className="w-5 h-5 shrink-0" aria-hidden="true" />
            ) : (
              <Menu className="w-5 h-5 shrink-0" aria-hidden="true" />
            )}
            <span>Menu</span>
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <nav
          id="mobile-nav-menu"
          aria-label="Menu danh mục trên điện thoại"
          className="md:hidden border-t border-slate-200 bg-white px-4 py-2 shadow-lg"
        >
          <ul className="divide-y divide-slate-100">
            {MENU_ITEMS.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  onClick={() => handleMenuItemClick(item)}
                  className="flex items-center justify-between min-h-[44px] py-2.5 text-sm font-medium text-slate-800 hover:text-blue-700 active:bg-slate-50 rounded-md transition-colors"
                >
                  <span>{item.label}</span>
                  <span className="text-xs text-slate-400">Chọn</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

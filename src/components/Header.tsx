import { ShoppingBag } from 'lucide-react';
import type { CategoryId } from '../types/shop';
import { formatVnd } from '../utils/shopLogic';

interface HeaderProps {
  cartCount: number;
  cartSubtotal: number;
  onOpenCart: () => void;
  onSelectNavCategory: (category: CategoryId) => void;
}

export function Header({
  cartCount,
  cartSubtotal,
  onOpenCart,
  onSelectNavCategory,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="#hero"
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
        >
          Văn phòng phẩm Hương Long
        </a>

        <nav
          aria-label="Điều hướng chính"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <a
            href="#catalog"
            onClick={() => onSelectNavCategory('stationery')}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
          >
            Văn phòng phẩm
          </a>
          <a
            href="#catalog"
            onClick={() => onSelectNavCategory('school')}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
          >
            Đồ dùng học sinh
          </a>
          <a
            href="#bundles"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
          >
            Combo nhanh
          </a>
          <a
            href="#catalog"
            onClick={() => onSelectNavCategory('toys')}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700 rounded-sm"
          >
            Đồ chơi &amp; Quà tặng
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenCart}
            aria-label={`Mở giỏ hàng, hiện có ${cartCount} sản phẩm`}
            className="inline-flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 active:scale-[0.99] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 cursor-pointer"
          >
            <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              {cartCount > 0
                ? `Giỏ hàng (${cartCount}) · ${formatVnd(cartSubtotal)}`
                : 'Giỏ hàng (0)'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

import type { CategoryId } from '../types/shop';

interface FooterProps {
  onSelectNavCategory: (category: CategoryId) => void;
}

export function Footer({ onSelectNavCategory }: FooterProps) {
  return (
    <footer className="bg-white border-t border-slate-200 py-8">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs sm:text-sm text-slate-500">
        <div>
          <p className="font-display font-semibold text-slate-900">
            Shop VPP Hương Long
          </p>
          <p className="mt-1 max-w-xl">
            Hiện tại shop chỉ nhận giao hàng buổi tối, dự kiến sang năm sẽ mở cửa hàng trong khu, cảm ơn gia đình đã ủng hộ.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-5 shrink-0">
          <a
            href="#catalog"
            onClick={() => onSelectNavCategory('stationery')}
            className="hover:text-slate-900 transition-colors"
          >
            Văn phòng phẩm
          </a>
          <a
            href="#catalog"
            onClick={() => onSelectNavCategory('school')}
            className="hover:text-slate-900 transition-colors"
          >
            Đồ dùng học sinh
          </a>
          <a href="#bundles" className="hover:text-slate-900 transition-colors">
            Combo nhanh
          </a>
          <a
            href="#catalog"
            onClick={() => onSelectNavCategory('toys')}
            className="hover:text-slate-900 transition-colors"
          >
            Đồ chơi &amp; Quà tặng
          </a>
        </div>
      </div>
    </footer>
  );
}

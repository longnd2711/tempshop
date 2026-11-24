import { ArrowRight } from 'lucide-react';
import { HERO_IMAGE } from '../data/catalog';
import { SafeImage } from './SafeImage';

interface HeroSectionProps {
  onExploreCatalog: () => void;
}

export function HeroSection({ onExploreCatalog }: HeroSectionProps) {
  return (
    <section id="hero" className="bg-white border-b border-slate-200">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-10 pb-10 lg:pt-14 lg:pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-1">
            <div>
              <p className="text-xs font-medium tracking-wide text-slate-500 mb-3">
                Giao hàng tận nơi · 19:00 - 22:00 hàng ngày.
              </p>
              <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 leading-[1.15] [text-wrap:balance]">
                Văn phòng phẩm, đồ học sinh &amp; tạp hóa gọn trong một lượt chọn
              </h1>
              <p className="mt-4 text-base text-slate-600 leading-relaxed max-w-[54ch]">
                Shop hiện tại vẫn chưa tìm thuê được mặt bằng, bố mẹ đặt đơn bút, vở, đồ dùng cho học tập cho các con, shop sẽ giao buổi tối từ 19:00 – 22:00 hằng ngày.
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onExploreCatalog}
                className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 cursor-pointer"
              >
                <span>Chọn sản phẩm ngay</span>
                <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              </button>
              <a
                href="#bundles"
                className="inline-flex items-center px-4 py-3 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Xem combo soạn sẵn
              </a>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[240px] sm:min-h-[300px] lg:min-h-[340px] rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
              <SafeImage
                src={HERO_IMAGE}
                alt="Bàn trưng bày văn phòng phẩm, vở học sinh, đồ chơi gỗ và đồ ăn nhẹ tại Văn phòng phẩm Hương Long"
                fallbackLabel="Văn phòng phẩm Hương Long"
                className="w-full h-full lg:h-full object-cover object-center"
              />
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl bg-slate-50/70 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-4 sm:p-5">
            <p className="font-mono text-xl sm:text-2xl font-medium text-slate-900 tabular-nums">
              Bán lẻ & sỉ
            </p>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">
              Nhiều mặt hàng sẵn tại kho
            </p>
          </div>
          <div className="p-4 sm:p-5 border-l border-slate-200 lg:border-l-0">
            <p className="font-mono text-xl sm:text-2xl font-medium text-slate-900 tabular-nums">
              4 nhóm
            </p>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">
              Văn phòng, học sinh, đồ chơi, tạp hóa
            </p>
          </div>
          <div className="p-4 sm:p-5">
            <p className="font-mono text-xl sm:text-2xl font-medium text-slate-900 tabular-nums">
              19:00 – 22:00
            </p>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">
              Giao hàng trong ngày buổi tối
            </p>
          </div>
          <div className="p-4 sm:p-5 border-l border-slate-200 lg:border-l-0">
            <p className="font-mono text-xl sm:text-2xl font-medium text-slate-900">
              Giao tận nơi
            </p>
            <p className="mt-1 text-xs sm:text-sm text-slate-600">
              Chung cư Chiến Sĩ Bộ Công An, Green Star, An Bình
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

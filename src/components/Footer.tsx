export function Footer() {
  return (
    <footer className="bg-white border-t border-slate-200 py-8">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs sm:text-sm text-slate-500">
        <div>
          <p className="font-display font-semibold text-slate-900">
            Tiệm An Nhiên
          </p>
          <p className="mt-1">
            118 Đường Số 7, Bình Trị Đông · Mở cửa 07:00 – 21:30 · ĐT đặt nhanh: 028 3890 1122
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <a href="#catalog" className="hover:text-slate-900 transition-colors">
            Văn phòng phẩm
          </a>
          <a href="#catalog" className="hover:text-slate-900 transition-colors">
            Đồ dùng học sinh
          </a>
          <a href="#bundles" className="hover:text-slate-900 transition-colors">
            Combo soạn sẵn
          </a>
          <a href="#store-info" className="hover:text-slate-900 transition-colors">
            Chính sách giao hàng
          </a>
        </div>
      </div>
    </footer>
  );
}

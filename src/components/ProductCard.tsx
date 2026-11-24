import { Minus, Plus } from 'lucide-react';
import type { Product } from '../types/shop';
import { formatVnd } from '../utils/shopLogic';
import { SafeImage } from './SafeImage';

interface ProductCardProps {
  product: Product;
  cartQuantity: number;
  onQuickAdd: (product: Product) => void;
  onUpdateQuantity: (product: string, variant: string, delta: number) => void;
  onOpenDetail: (product: Product) => void;
}

export function ProductCard({
  product,
  cartQuantity,
  onQuickAdd,
  onUpdateQuantity,
  onOpenDetail,
}: ProductCardProps) {
  const defaultVariant = product.variants[0] ?? 'Tiêu chuẩn';

  return (
    <article className="group flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm">
      <button
        type="button"
        onClick={() => onOpenDetail(product)}
        aria-label={`Xem chi tiết ${product.name}`}
        className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700 cursor-pointer"
      >
        <div className="aspect-[4/3] w-full bg-slate-100 overflow-hidden border-b border-slate-100">
          <SafeImage
            src={product.image}
            alt={product.name}
            fallbackLabel={product.name}
            className={`w-full h-full object-cover object-center transition-transform duration-200 group-hover:scale-[1.03] ${product.imageFocusClass ?? ''}`}
          />
        </div>
      </button>

      <div className="flex flex-col flex-1 p-5">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">
            {product.categoryLabel}
            <span aria-hidden="true"> · </span>
            <span className="font-mono">{product.sku}</span>
          </span>
          {product.featuredTag && (
            <span className="text-blue-700 font-medium whitespace-nowrap shrink-0">
              {product.featuredTag}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpenDetail(product)}
          aria-label={`Mở thông tin ${product.name}`}
          className="mt-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 rounded-sm cursor-pointer"
        >
          <h3 className="font-display text-base font-semibold text-slate-900 leading-snug line-clamp-2 group-hover:text-blue-700 transition-colors">
            {product.name}
          </h3>
        </button>

        <p className="mt-1.5 text-xs text-slate-500 truncate">
          Phân loại: {defaultVariant}
          {product.variants.length > 1
            ? ` (+${product.variants.length - 1} lựa chọn)`
            : ''}
        </p>

        <div className="mt-auto pt-4 flex items-center justify-between gap-3 border-t border-slate-100">
          <div>
            <p className="text-base font-semibold text-slate-900 tabular-nums">
              {formatVnd(product.price)}
            </p>
            <p className="text-xs text-slate-500">
              {product.unit}
              <span aria-hidden="true"> · </span>
              {product.stock > 0 ? `Còn ${product.stock}` : 'Nhận đặt hàng'}
            </p>
          </div>

          {cartQuantity > 0 ? (
            <div
              className="inline-flex items-center border border-blue-200 bg-blue-50/70 rounded-lg shrink-0"
              aria-label={`Số lượng trong giỏ của ${product.name}`}
            >
              <button
                type="button"
                onClick={() => onUpdateQuantity(product.id, defaultVariant, -1)}
                aria-label={`Giảm số lượng ${product.name}`}
                className="w-9 h-9 inline-flex items-center justify-center text-blue-800 hover:bg-blue-100 rounded-l-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-700 cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="w-8 text-center text-sm font-semibold text-blue-900 tabular-nums">
                {cartQuantity}
              </span>
              <button
                type="button"
                onClick={() => onUpdateQuantity(product.id, defaultVariant, 1)}
                aria-label={`Tăng số lượng ${product.name}`}
                className="w-9 h-9 inline-flex items-center justify-center text-blue-800 hover:bg-blue-100 rounded-r-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-700 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onQuickAdd(product)}
              aria-label={`Thêm ${product.name} vào giỏ hàng`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Thêm nhanh</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

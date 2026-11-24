import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { BUNDLE_PACKS, PRODUCTS } from '../data/catalog';
import type { BundlePack } from '../types/shop';
import { formatVnd } from '../utils/shopLogic';

interface BundleSectionProps {
  onAddBundle: (bundle: BundlePack) => void;
}

export function BundleSection({ onAddBundle }: BundleSectionProps) {
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);

  const handleSelectBundle = (bundle: BundlePack) => {
    onAddBundle(bundle);
    setRecentlyAddedId(bundle.id);
    window.setTimeout(() => {
      setRecentlyAddedId((prev) => (prev === bundle.id ? null : prev));
    }, 1800);
  };

  return (
    <section
      id="bundles"
      className="scroll-mt-20 py-12 lg:py-16 bg-white border-t border-b border-slate-200"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
            Combo soạn sẵn để đặt trong một lần bấm
          </h2>
          <p className="mt-2 text-sm sm:text-base text-slate-600">
            Gom sẵn các món hay mua kèm theo từng nhu cầu học tập, bàn làm việc và gia đình — tiết kiệm thời gian chọn lẻ.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {BUNDLE_PACKS.map((bundle) => {
            const isAdded = recentlyAddedId === bundle.id;
            const resolvedItems = bundle.items
              .map((entry) => {
                const product = PRODUCTS.find((p) => p.id === entry.productId);
                return product ? { product, quantity: entry.quantity } : null;
              })
              .filter(Boolean) as { product: (typeof PRODUCTS)[number]; quantity: number }[];

            return (
              <div
                key={bundle.id}
                className="flex flex-col justify-between p-6 bg-slate-50/70 border border-slate-200 rounded-xl"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {bundle.audience}
                  </p>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-slate-900">
                    {bundle.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-600">
                    {bundle.subtitle}
                  </p>

                  <ul className="mt-4 pt-4 border-t border-slate-200 space-y-2 text-sm text-slate-700">
                    {resolvedItems.map(({ product, quantity }) => (
                      <li
                        key={product.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <span className="leading-snug">{product.name}</span>
                        <span className="font-mono text-xs text-slate-500 whitespace-nowrap shrink-0 tabular-nums mt-0.5">
                          x{quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-lg font-bold text-slate-900 tabular-nums">
                      {formatVnd(bundle.bundlePrice)}
                    </p>
                    <p className="text-xs text-slate-500 line-through tabular-nums">
                      Mua lẻ {formatVnd(bundle.originalPrice)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelectBundle(bundle)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                      isAdded
                        ? 'bg-emerald-700 text-white'
                        : 'bg-blue-700 hover:bg-blue-800 text-white'
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Đã thêm vào giỏ</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Thêm cả combo</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

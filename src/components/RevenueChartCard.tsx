import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarRange, Clock } from 'lucide-react';
import type { OrderRecord, RevenuePeriodMode } from '../types/shop';
import {
  buildRevenueChartData,
  getYesterdayEveningPreset,
} from '../utils/adminLogic';
import { formatVnd } from '../utils/shopLogic';

interface RevenueChartCardProps {
  orders: OrderRecord[];
}

const PERIOD_OPTIONS: Array<{ id: RevenuePeriodMode; label: string }> = [
  { id: 'day', label: 'Theo ngày' },
  { id: 'week', label: 'Theo tuần' },
  { id: 'month', label: 'Theo tháng' },
  { id: 'quarter', label: 'Theo quý' },
  { id: 'year', label: 'Theo năm' },
  { id: 'custom', label: 'Tùy chỉnh' },
];

export function RevenueChartCard({ orders }: RevenueChartCardProps) {
  const defaultCustomPreset = useMemo(() => getYesterdayEveningPreset(), []);
  const [mode, setMode] = useState<RevenuePeriodMode>('day');
  const [paidOnly, setPaidOnly] = useState(false);
  const [customStart, setCustomStart] = useState(defaultCustomPreset.start);
  const [customEnd, setCustomEnd] = useState(defaultCustomPreset.end);
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(
    null,
  );

  const chartData = useMemo(
    () =>
      buildRevenueChartData(orders, {
        mode,
        customStart,
        customEnd,
        paidOnly,
      }),
    [orders, mode, customStart, customEnd, paidOnly],
  );

  useEffect(() => {
    setSelectedBucketKey(null);
  }, [mode, customStart, customEnd, paidOnly]);

  const activeBucket = useMemo(() => {
    if (chartData.buckets.length === 0) return null;
    if (selectedBucketKey) {
      const found = chartData.buckets.find((b) => b.key === selectedBucketKey);
      if (found) return found;
    }
    const peak = chartData.buckets.reduce<typeof chartData.buckets[number] | null>(
      (best, curr) => {
        if (!best || curr.revenue > best.revenue) return curr;
        return best;
      },
      null,
    );
    return peak && peak.revenue > 0 ? peak : chartData.buckets[0];
  }, [chartData.buckets, selectedBucketKey]);

  const labelStep = useMemo(() => {
    const count = chartData.buckets.length;
    if (count <= 12) return 1;
    if (count <= 24) return 2;
    return 3;
  }, [chartData.buckets.length]);

  const handleApplyYesterdayEvening = () => {
    const preset = getYesterdayEveningPreset();
    setCustomStart(preset.start);
    setCustomEnd(preset.end);
    setMode('custom');
  };

  return (
    <section
      aria-labelledby="revenue-chart-heading"
      className="p-4 sm:p-5 bg-white border border-slate-200 rounded-xl shadow-xs space-y-4"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
            <BarChart3 className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3
              id="revenue-chart-heading"
              className="font-display text-base sm:text-lg font-bold text-slate-900"
            >
              Biểu đồ doanh thu
            </h3>
            <p className="text-xs text-slate-500">
              {chartData.rangeLabel} · Loại trừ đơn đã hủy
            </p>
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none self-start lg:self-auto">
          <input
            type="checkbox"
            checked={paidOnly}
            onChange={(e) => setPaidOnly(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700 cursor-pointer"
          />
          <span>Chỉ tính đơn đã thanh toán</span>
        </label>
      </div>

      <div
        role="group"
        aria-label="Chọn kỳ thống kê doanh thu"
        className="flex flex-wrap items-center gap-2"
      >
        {PERIOD_OPTIONS.map((opt) => {
          const isActive = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setMode(opt.id)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? 'bg-blue-700 text-white border-blue-700 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {mode === 'custom' && (
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label
              htmlFor="revenue-custom-start"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Từ thời gian
            </label>
            <input
              id="revenue-custom-start"
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
            />
          </div>

          <div className="flex-1 min-w-0">
            <label
              htmlFor="revenue-custom-end"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Đến thời gian
            </label>
            <input
              id="revenue-custom-end"
              type="datetime-local"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-2 focus:outline-blue-700"
            />
          </div>

          <button
            type="button"
            onClick={handleApplyYesterdayEvening}
            className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>17h – 22h hôm qua</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500">Doanh thu trong kỳ</p>
          <p
            data-testid="revenue-period-total"
            className="mt-0.5 font-display text-lg sm:text-xl font-bold text-blue-700 tabular-nums"
          >
            {formatVnd(chartData.totalRevenue)}
          </p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500">Số đơn trong kỳ</p>
          <p
            data-testid="revenue-period-count"
            className="mt-0.5 font-display text-lg sm:text-xl font-bold text-slate-900 tabular-nums"
          >
            {chartData.totalOrders} đơn
          </p>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-xs text-slate-500">Trung bình / đơn</p>
          <p className="mt-0.5 font-display text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">
            {formatVnd(chartData.averageOrderValue)}
          </p>
        </div>
      </div>

      {chartData.customRangeInvalid ? (
        <div
          role="alert"
          className="p-6 text-center text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl"
        >
          <CalendarRange
            className="w-6 h-6 mx-auto mb-1.5 text-amber-700"
            aria-hidden="true"
          />
          Thời điểm bắt đầu phải nhỏ hơn hoặc bằng thời điểm kết thúc.
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeBucket && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-blue-50/70 border border-blue-100 rounded-lg text-xs">
              <span className="font-medium text-slate-700">
                Mốc đang xem:{' '}
                <strong className="text-slate-900">{activeBucket.fullLabel}</strong>
              </span>
              <span className="font-semibold text-blue-800 tabular-nums">
                {formatVnd(activeBucket.revenue)} ({activeBucket.orderCount} đơn)
              </span>
            </div>
          )}

          <div
            data-testid="revenue-chart-bars"
            role="img"
            aria-label={`Biểu đồ doanh thu ${chartData.rangeLabel}, tổng ${formatVnd(chartData.totalRevenue)}`}
            className="pt-4 pb-2 px-2 sm:px-3 bg-slate-50/60 border border-slate-200 rounded-xl"
          >
            <div className="h-44 sm:h-52 flex items-end gap-1 sm:gap-1.5 border-b border-slate-300 pb-1">
              {chartData.buckets.map((bucket) => {
                const heightPct =
                  chartData.maxBucketRevenue > 0
                    ? Math.round((bucket.revenue / chartData.maxBucketRevenue) * 100)
                    : 0;
                const isSelected = activeBucket?.key === bucket.key;
                const hasValue = bucket.revenue > 0;

                return (
                  <button
                    key={bucket.key}
                    type="button"
                    onClick={() => setSelectedBucketKey(bucket.key)}
                    onMouseEnter={() => setSelectedBucketKey(bucket.key)}
                    title={`${bucket.fullLabel}: ${formatVnd(bucket.revenue)} (${bucket.orderCount} đơn)`}
                    aria-label={`${bucket.fullLabel}: ${formatVnd(bucket.revenue)}, ${bucket.orderCount} đơn`}
                    className="group flex-1 min-w-0 h-full flex flex-col justify-end items-center focus:outline-none cursor-pointer"
                  >
                    <div
                      className={`w-full max-w-[34px] rounded-t-md transition-all ${
                        hasValue
                          ? isSelected
                            ? 'bg-blue-700'
                            : 'bg-blue-500 group-hover:bg-blue-600'
                          : isSelected
                            ? 'bg-slate-300'
                            : 'bg-slate-200 group-hover:bg-slate-300'
                      }`}
                      style={{
                        height: hasValue ? `${Math.max(heightPct, 6)}%` : '3px',
                      }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="mt-1.5 flex items-center gap-1 sm:gap-1.5">
              {chartData.buckets.map((bucket, idx) => {
                const showLabel =
                  idx % labelStep === 0 || idx === chartData.buckets.length - 1;
                return (
                  <div
                    key={`${bucket.key}-lbl`}
                    className="flex-1 min-w-0 text-center"
                  >
                    <span
                      className={`block text-[10px] sm:text-[11px] tabular-nums truncate ${
                        activeBucket?.key === bucket.key
                          ? 'font-bold text-blue-700'
                          : 'text-slate-500'
                      }`}
                    >
                      {showLabel ? bucket.label : ''}
                    </span>
                  </div>
                );
              })}
            </div>

            {chartData.totalOrders === 0 && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Chưa có đơn hàng nào trong kỳ đang chọn.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

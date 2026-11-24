import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import QRCode from 'qrcode';
import { formatVnd } from '../utils/shopLogic';
import { buildVietQrImageUrl, buildVietQrPayload } from '../utils/vietqr';

export const VIB_ACCOUNT_NUMBER = '916219452';
export const VIB_BANK_BIN = '970441';
export const VIB_ACCOUNT_NAME = 'Nguyễn Thu Hương';

interface BankTransferQRProps {
  amount: number;
  orderId: string;
}

export function BankTransferQR({ amount, orderId }: BankTransferQRProps) {
  const [fallbackDataUrl, setFallbackDataUrl] = useState<string>('');
  const [useFallbackQr, setUseFallbackQr] = useState(false);
  const [copiedField, setCopiedField] = useState<'account' | 'content' | null>(
    null,
  );

  const vietQrUrl = buildVietQrImageUrl({
    bankBin: VIB_BANK_BIN,
    accountNumber: VIB_ACCOUNT_NUMBER,
    amount,
    orderId,
    accountName: VIB_ACCOUNT_NAME,
  });

  useEffect(() => {
    setUseFallbackQr(false);
    let active = true;
    const payload = buildVietQrPayload({
      bankBin: VIB_BANK_BIN,
      accountNumber: VIB_ACCOUNT_NUMBER,
      amount,
      orderId,
    });

    QRCode.toDataURL(payload, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setFallbackDataUrl(url);
      })
      .catch(() => {
        if (active) setFallbackDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [amount, orderId]);

  const copyValue = async (field: 'account' | 'content', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => {
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 1600);
    } catch {
      // Clipboard API unavailable in restricted contexts
    }
  };

  const activeImgSrc = useFallbackQr ? fallbackDataUrl : vietQrUrl;

  return (
    <div
      data-testid="bank-transfer-qr"
      className="p-4 bg-slate-50 border border-blue-200 rounded-xl space-y-3"
    >
      <p className="text-xs font-semibold text-blue-800">
        Chuyển khoản hoặc thanh toán tiền mặt
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="w-44 h-44 bg-white border border-slate-200 rounded-lg p-1.5 flex items-center justify-center shrink-0 overflow-hidden">
          {activeImgSrc ? (
            <img
              src={activeImgSrc}
              referrerPolicy="no-referrer"
              onError={() => {
                if (!useFallbackQr && fallbackDataUrl) {
                  setUseFallbackQr(true);
                }
              }}
              alt={`Mã QR chuyển khoản VIB chủ tài khoản ${VIB_ACCOUNT_NAME} số tài khoản ${VIB_ACCOUNT_NUMBER} số tiền ${formatVnd(amount)} nội dung ${orderId}`}
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-xs text-slate-400 text-center">
              Đang tạo mã QR...
            </span>
          )}
        </div>

        <div className="flex-1 w-full space-y-2 text-xs">
          <p className="font-display text-sm font-bold text-slate-900">
            Thông tin chuyển khoản VIB
          </p>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Ngân hàng</span>
            <span className="font-semibold text-slate-900">VIB</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Chủ tài khoản</span>
            <span className="font-semibold text-slate-900">
              {VIB_ACCOUNT_NAME}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Số tài khoản</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {VIB_ACCOUNT_NUMBER}
              </span>
              <button
                type="button"
                onClick={() => copyValue('account', VIB_ACCOUNT_NUMBER)}
                aria-label="Sao chép số tài khoản VIB"
                className="p-1 text-slate-500 hover:text-blue-700 rounded cursor-pointer"
              >
                {copiedField === 'account' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Số tiền</span>
            <span className="font-bold text-blue-700 tabular-nums">
              {formatVnd(amount)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Nội dung CK</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-semibold text-slate-900">
                {orderId}
              </span>
              <button
                type="button"
                onClick={() => copyValue('content', orderId)}
                aria-label="Sao chép nội dung chuyển khoản"
                className="p-1 text-slate-500 hover:text-blue-700 rounded cursor-pointer"
              >
                {copiedField === 'content' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

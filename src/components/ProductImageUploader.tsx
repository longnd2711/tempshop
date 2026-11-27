import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Camera, HardDriveUpload, ImagePlus, Loader2, X } from 'lucide-react';
import {
  getGoogleDriveAccessToken,
  getGoogleDriveUserEmail,
  googleDriveSignIn,
  initGoogleDriveAuth,
  logoutGoogleDrive,
} from '../lib/googleDriveAuth';
import { uploadOriginalToDriveFolder } from '../lib/googleDriveSync';
import { uploadCompressedProductImage } from '../lib/supabaseStorage';
import { parseImageUrlsInput } from '../utils/adminLogic';
import { compressImageToJpg, formatFileSizeKb } from '../utils/imageCompressor';
import {
  buildProductImageFilename,
  DEFAULT_DRIVE_FOLDER_NAME,
} from '../utils/imageSyncLogic';
import { GoogleSignInButton } from './GoogleSignInButton';
import { SafeImage } from './SafeImage';

interface ProductImageUploaderProps {
  sku: string;
  imageUrlsText: string;
  onChangeImageUrlsText: (nextText: string) => void;
  compact?: boolean;
}

export function ProductImageUploader({
  sku,
  imageUrlsText,
  onChangeImageUrlsText,
  compact = false,
}: ProductImageUploaderProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaId = useId();

  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [backupOriginalToDrive, setBackupOriginalToDrive] = useState(false);
  const [driveConnectedEmail, setDriveConnectedEmail] = useState<string | null>(
    () => getGoogleDriveUserEmail(),
  );
  const [hasDriveToken, setHasDriveToken] = useState(false);
  const [isSigningInDrive, setIsSigningInDrive] = useState(false);

  useEffect(() => {
    void getGoogleDriveAccessToken().then((token) => {
      setHasDriveToken(Boolean(token));
    });
    const unsubscribe = initGoogleDriveAuth(
      (user, token) => {
        setHasDriveToken(Boolean(token));
        setDriveConnectedEmail(user.email ?? null);
      },
      () => {
        setHasDriveToken(false);
      },
    );
    return unsubscribe;
  }, []);

  const currentUrls = useMemo(
    () => parseImageUrlsInput(imageUrlsText),
    [imageUrlsText],
  );

  const previewFilename = useMemo(() => {
    if (!sku.trim()) return 'sku.jpg';
    return buildProductImageFilename(sku, currentUrls.length, false);
  }, [sku, currentUrls.length]);

  const previewOriginalFilename = useMemo(() => {
    if (!sku.trim()) return '0_sku.jpg';
    return buildProductImageFilename(sku, currentUrls.length, true);
  }, [sku, currentUrls.length]);

  const handleConnectDrive = async () => {
    setUploadError(null);
    setIsSigningInDrive(true);
    try {
      const { user } = await googleDriveSignIn();
      setHasDriveToken(true);
      setDriveConnectedEmail(user.email ?? null);
      setBackupOriginalToDrive(true);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Không thể kết nối Google Drive để sao lưu ảnh gốc.',
      );
    } finally {
      setIsSigningInDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await logoutGoogleDrive();
    setHasDriveToken(false);
    setDriveConnectedEmail(null);
    setBackupOriginalToDrive(false);
  };

  const handleProcessFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const cleanSku = sku.trim();
    if (!cleanSku) {
      setUploadError(
        'Vui lòng nhập Mã hàng (SKU) trước khi chụp hoặc tải ảnh để hệ thống đặt tên chuẩn <sku>.jpg.',
      );
      return;
    }

    setUploadError(null);
    setUploadStatus(null);
    setIsUploading(true);

    try {
      const files = Array.from(fileList);
      const nextUrls = [...currentUrls];
      const summaries: string[] = [];

      let driveToken: string | null = null;
      if (backupOriginalToDrive) {
        driveToken = await getGoogleDriveAccessToken();
        if (!driveToken) {
          setUploadError(
            'Bạn đang bật sao lưu Google Drive nhưng chưa kết nối tài khoản Google. Vui lòng bấm "Sign in with Google" hoặc tắt tùy chọn sao lưu.',
          );
          setIsUploading(false);
          return;
        }
      }

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const slotIndex = nextUrls.length;
        const compressed = await compressImageToJpg(file, cleanSku, {
          slotIndex,
          maxDimension: 900,
          quality: 0.8,
        });

        const uploadRes = await uploadCompressedProductImage(
          compressed.compressedBlob,
          compressed.compressedName,
        );

        if (uploadRes.errorMessage || !uploadRes.publicUrl) {
          setUploadError(
            uploadRes.errorMessage ?? 'Không thể tải ảnh lên Supabase Storage.',
          );
          break;
        }

        nextUrls.push(uploadRes.publicUrl);

        let summary = `${compressed.compressedName} (${formatFileSizeKb(compressed.originalBytes)} → ${formatFileSizeKb(compressed.compressedBytes)})`;

        if (backupOriginalToDrive && driveToken) {
          try {
            await uploadOriginalToDriveFolder(
              driveToken,
              DEFAULT_DRIVE_FOLDER_NAME,
              compressed.originalName,
              compressed.originalBlob,
            );
            summary += ` + Drive ${compressed.originalName}`;
          } catch (driveErr) {
            summary += ` (lỗi sao lưu Drive: ${
              driveErr instanceof Error ? driveErr.message : 'thất bại'
            })`;
          }
        }

        summaries.push(summary);
      }

      onChangeImageUrlsText(nextUrls.join('\n'));
      if (summaries.length > 0) {
        setUploadStatus(`Đã nén & tải lên: ${summaries.join(', ')}`);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Lỗi xử lý ảnh tải lên.',
      );
    } finally {
      setIsUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    void handleProcessFiles(e.target.files);
  };

  const handleRemoveUrl = (idxToRemove: number) => {
    const filtered = currentUrls.filter((_, idx) => idx !== idxToRemove);
    onChangeImageUrlsText(filtered.join('\n'));
  };

  return (
    <div className="space-y-2.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold text-slate-800"
          >
            Hình ảnh sản phẩm (nén tự động .jpg theo SKU)
          </label>
          <p className="text-[11px] text-slate-500">
            Tên file lưu Supabase:{' '}
            <code className="font-mono text-blue-700">{previewFilename}</code>
            {backupOriginalToDrive && (
              <>
                {' · '}Ảnh gốc Drive:{' '}
                <code className="font-mono text-slate-700">
                  {DEFAULT_DRIVE_FOLDER_NAME}/{previewOriginalFilename}
                </code>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Chụp ảnh sản phẩm từ camera"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer disabled:opacity-60"
          >
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>Chụp ảnh</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
            aria-label="Chọn ảnh sản phẩm từ thiết bị"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-60"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Chọn ảnh có sẵn</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={backupOriginalToDrive}
            onChange={(e) => setBackupOriginalToDrive(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
          />
          <HardDriveUpload className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <span>
            Sao lưu bản gốc (<code>0_{sku.trim() || 'sku'}.jpg</code>) vào Google Drive{' '}
            <code>{DEFAULT_DRIVE_FOLDER_NAME}</code>
          </span>
        </label>

        {backupOriginalToDrive && (
          <div className="flex items-center gap-2">
            {hasDriveToken ? (
              <span className="inline-flex items-center gap-2 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                <span>Đã kết nối Drive{driveConnectedEmail ? `: ${driveConnectedEmail}` : ''}</span>
                <button
                  type="button"
                  onClick={() => void handleDisconnectDrive()}
                  className="text-rose-700 hover:underline font-semibold cursor-pointer"
                >
                  Ngắt
                </button>
              </span>
            ) : (
              <GoogleSignInButton
                onClick={() => void handleConnectDrive()}
                disabled={isSigningInDrive}
              />
            )}
          </div>
        )}
      </div>

      {currentUrls.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {currentUrls.map((url, idx) => (
            <div
              key={`${url}-${idx}`}
              className="relative group w-16 h-16 rounded-lg border border-slate-300 bg-white overflow-hidden"
            >
              <SafeImage
                src={url}
                alt={`Ảnh sản phẩm ${idx + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[9px] font-semibold text-white bg-slate-900/70 text-center">
                {idx === 0 ? 'Ảnh chính' : `Ảnh #${idx + 1}`}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveUrl(idx)}
                aria-label={`Xóa ảnh ${idx + 1}`}
                className="absolute top-0.5 right-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full bg-slate-900/80 text-white hover:bg-rose-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {uploadStatus && (
        <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
          {uploadStatus}
        </p>
      )}

      {uploadError && (
        <p
          role="alert"
          className="text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg"
        >
          {uploadError}
        </p>
      )}

      <textarea
        id={textareaId}
        rows={compact ? 1 : 2}
        value={imageUrlsText}
        onChange={(e) => onChangeImageUrlsText(e.target.value)}
        placeholder="Hoặc dán trực tiếp link ảnh (mỗi link 1 dòng)..."
        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
      />
    </div>
  );
}

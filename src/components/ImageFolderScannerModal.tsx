import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FolderSearch,
  HardDrive,
  Loader2,
  PackageCheck,
  X,
} from 'lucide-react';
import {
  getGoogleDriveAccessToken,
  getGoogleDriveUserEmail,
  googleDriveSignIn,
  initGoogleDriveAuth,
  logoutGoogleDrive,
} from '../lib/googleDriveAuth';
import {
  downloadDriveFileBlob,
  fetchExternalImageBlob,
  listDriveFolderImages,
  uploadFileToDriveFolder,
  type DriveFolderInfo,
} from '../lib/googleDriveSync';
import {
  listSupabaseStorageImages,
  updateProductImageUrlsInSupabase,
  uploadCompressedProductImage,
} from '../lib/supabaseStorage';
import type { Product } from '../types/shop';
import { compressImageToJpg } from '../utils/imageCompressor';
import {
  buildDriveSyncPlan,
  buildProductImageFilename,
  buildSupabaseScanPlan,
  DEFAULT_DRIVE_FOLDER_NAME,
  IMAGE_SYNC_BATCH_SIZE,
  isJpgFilename,
  isSupabaseProductImageUrl,
  PRODUCT_IMAGES_BUCKET,
  type DriveSyncPlan,
  type ScannableImageFile,
  type SupabaseScanPlan,
} from '../utils/imageSyncLogic';
import { GoogleSignInButton } from './GoogleSignInButton';

interface ImageFolderScannerModalProps {
  isOpen: boolean;
  products: Product[];
  onClose: () => void;
  onCompleted: (summaryMessage: string) => Promise<void>;
}

type ScanSourceTab = 'drive' | 'supabase';

export function ImageFolderScannerModal({
  isOpen,
  products,
  onClose,
  onCompleted,
}: ImageFolderScannerModalProps) {
  const [sourceTab, setSourceTab] = useState<ScanSourceTab>('drive');

  // Drive state
  const [driveFolderInput, setDriveFolderInput] = useState(
    DEFAULT_DRIVE_FOLDER_NAME,
  );
  const [hasDriveToken, setHasDriveToken] = useState(false);
  const [driveEmail, setDriveEmail] = useState<string | null>(() =>
    getGoogleDriveUserEmail(),
  );
  const [isSigningInDrive, setIsSigningInDrive] = useState(false);

  // Filter / migration options
  const [includeAlreadySynced, setIncludeAlreadySynced] = useState(false);
  const [includeExternalMigration, setIncludeExternalMigration] =
    useState(true);

  // Supabase Storage state
  const [supabaseSubfolder, setSupabaseSubfolder] = useState('');

  // Scan & execution state
  const [isScanning, setIsScanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [scannedFolderLabel, setScannedFolderLabel] = useState('');

  // Cached scan artifacts for batch-by-batch processing (50 products / batch)
  const [driveFolderInfo, setDriveFolderInfo] =
    useState<DriveFolderInfo | null>(null);
  const [driveFiles, setDriveFiles] = useState<ScannableImageFile[]>([]);
  const [drivePlan, setDrivePlan] =
    useState<DriveSyncPlan<ScannableImageFile> | null>(null);

  const [supabaseFiles, setSupabaseFiles] = useState<ScannableImageFile[]>([]);
  const [supabasePlan, setSupabasePlan] =
    useState<SupabaseScanPlan<ScannableImageFile> | null>(null);

  const [processedProductIds, setProcessedProductIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!isOpen) return;
    void getGoogleDriveAccessToken().then((token) => {
      setHasDriveToken(Boolean(token));
    });
    const unsub = initGoogleDriveAuth(
      (user, token) => {
        setHasDriveToken(Boolean(token));
        setDriveEmail(user.email ?? null);
      },
      () => {
        setHasDriveToken(false);
      },
    );
    return unsub;
  }, [isOpen]);

  if (!isOpen) return null;

  const resetScanResults = () => {
    setDrivePlan(null);
    setDriveFiles([]);
    setDriveFolderInfo(null);
    setSupabasePlan(null);
    setSupabaseFiles([]);
    setProcessedProductIds(new Set());
    setScanError(null);
    setBatchNotice(null);
    setProgressText('');
  };

  const handleConnectDrive = async () => {
    setScanError(null);
    setIsSigningInDrive(true);
    try {
      const { user } = await googleDriveSignIn();
      setHasDriveToken(true);
      setDriveEmail(user.email ?? null);
    } catch (err) {
      setScanError(
        err instanceof Error
          ? err.message
          : 'Không thể đăng nhập Google Drive.',
      );
    } finally {
      setIsSigningInDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await logoutGoogleDrive();
    setHasDriveToken(false);
    setDriveEmail(null);
    resetScanResults();
  };

  const handleSwitchTab = (tab: ScanSourceTab) => {
    setSourceTab(tab);
    resetScanResults();
  };

  const handleScanFolder = async () => {
    resetScanResults();
    setIsScanning(true);

    try {
      if (sourceTab === 'drive') {
        const token = await getGoogleDriveAccessToken();
        if (!token) {
          setScanError(
            'Vui lòng bấm "Sign in with Google" để cấp quyền đọc/ghi thư mục Google Drive.',
          );
          return;
        }
        const { folder, files } = await listDriveFolderImages(
          token,
          driveFolderInput,
        );
        const plan = buildDriveSyncPlan(files, products, {
          includeAlreadySynced,
          includeExternalMigration,
          batchSize: IMAGE_SYNC_BATCH_SIZE,
        });
        setDriveFolderInfo(folder);
        setDriveFiles(files);
        setDrivePlan(plan);
        setScannedFolderLabel(`Google Drive / ${folder.name}`);
      } else {
        const res = await listSupabaseStorageImages(supabaseSubfolder);
        if (res.errorMessage) {
          setScanError(res.errorMessage);
          return;
        }
        const plan = buildSupabaseScanPlan(res.files, products, {
          includeAlreadySynced,
          batchSize: IMAGE_SYNC_BATCH_SIZE,
        });
        setSupabaseFiles(res.files);
        setSupabasePlan(plan);
        setScannedFolderLabel(
          supabaseSubfolder.trim()
            ? `Supabase (${PRODUCT_IMAGES_BUCKET}/${supabaseSubfolder.trim()})`
            : `Supabase (${PRODUCT_IMAGES_BUCKET})`,
        );
      }
    } catch (err) {
      setScanError(
        err instanceof Error ? err.message : 'Lỗi khi quét thư mục ảnh.',
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleApplyDriveBatch = async () => {
    if (!drivePlan || drivePlan.currentBatch.length === 0) return;

    setScanError(null);
    setBatchNotice(null);
    setIsApplying(true);

    let updatedCount = 0;
    let failedCount = 0;
    const failedDetails: string[] = [];
    const nextProcessedIds = new Set(processedProductIds);
    const updatedProductsUrlMap = new Map<string, string[]>();

    try {
      const token = await getGoogleDriveAccessToken();
      if (!token) {
        setScanError('Phiên Google Drive đã hết hạn. Vui lòng đăng nhập lại.');
        return;
      }

      const driveFileIdByLowerName = new Map<string, string>();
      for (const f of driveFiles) {
        driveFileIdByLowerName.set(f.name.toLowerCase(), f.id);
      }

      const batch = drivePlan.currentBatch;
      const total = batch.length;

      for (let i = 0; i < total; i += 1) {
        const task = batch[i];
        nextProcessedIds.add(task.product.id);
        setProgressText(
          `Đang xử lý (${i + 1}/${total}): ${task.product.sku}...`,
        );

        try {
          if (task.kind === 'drive-match') {
            const uploadedUrls: string[] = [];
            for (let mIdx = 0; mIdx < task.matchedFiles.length; mIdx += 1) {
              const matchedItem = task.matchedFiles[mIdx];
              const rawBlob = await downloadDriveFileBlob(
                token,
                matchedItem.file.id,
              );
              const compressed = await compressImageToJpg(
                rawBlob,
                task.product.sku,
                {
                  slotIndex: mIdx,
                  maxDimension: 900,
                  quality: 0.8,
                },
              );

              // Chỉ có ảnh gốc 0_ hoặc file chưa phải .jpg -> upload bản nén .jpg lên lại Google Drive
              if (
                matchedItem.isOriginalPrefix ||
                !isJpgFilename(matchedItem.file.name)
              ) {
                const compressedDriveRes = await uploadFileToDriveFolder(
                  token,
                  driveFolderInfo?.id ?? driveFolderInput,
                  compressed.compressedName,
                  compressed.compressedBlob,
                  {
                    folderId: driveFolderInfo?.id,
                    folderName: driveFolderInfo?.name,
                    existingFileId: driveFileIdByLowerName.get(
                      compressed.compressedName.toLowerCase(),
                    ),
                  },
                );
                driveFileIdByLowerName.set(
                  compressed.compressedName.toLowerCase(),
                  compressedDriveRes.fileId,
                );
              }

              const upRes = await uploadCompressedProductImage(
                compressed.compressedBlob,
                compressed.compressedName,
              );
              if (upRes.errorMessage || !upRes.publicUrl) {
                throw new Error(
                  upRes.errorMessage ?? 'Không thể tải ảnh nén lên Supabase.',
                );
              }
              uploadedUrls.push(upRes.publicUrl);
            }

            if (uploadedUrls.length > 0) {
              const dbRes = await updateProductImageUrlsInSupabase(
                task.product.id,
                uploadedUrls,
              );
              if (dbRes.errorMessage) {
                throw new Error(dbRes.errorMessage);
              }
              updatedProductsUrlMap.set(task.product.id, uploadedUrls);
              updatedCount += 1;
            }
          } else {
            // External non-Supabase URL(s): fetch -> save 0_<sku>.jpg to Drive -> compress <sku>.jpg -> upload to Drive & Supabase -> update DB
            const finalUrls: string[] = [];
            for (let uIdx = 0; uIdx < task.currentUrls.length; uIdx += 1) {
              const url = task.currentUrls[uIdx];
              if (isSupabaseProductImageUrl(url)) {
                finalUrls.push(url);
                continue;
              }

              const slotIdx = finalUrls.length;
              const rawBlob = await fetchExternalImageBlob(url, token);
              const compressed = await compressImageToJpg(
                rawBlob,
                task.product.sku,
                {
                  slotIndex: slotIdx,
                  maxDimension: 900,
                  quality: 0.8,
                },
              );

              // 1. Upload ảnh gốc (đã chuẩn hóa .jpg) 0_<sku>.jpg lên Google Drive
              const origDriveRes = await uploadFileToDriveFolder(
                token,
                driveFolderInfo?.id ?? driveFolderInput,
                compressed.originalName,
                compressed.originalBlob,
                {
                  folderId: driveFolderInfo?.id,
                  folderName: driveFolderInfo?.name,
                  existingFileId: driveFileIdByLowerName.get(
                    compressed.originalName.toLowerCase(),
                  ),
                },
              );
              driveFileIdByLowerName.set(
                compressed.originalName.toLowerCase(),
                origDriveRes.fileId,
              );

              // 2. Upload ảnh nén <sku>.jpg lên Google Drive
              const compDriveRes = await uploadFileToDriveFolder(
                token,
                driveFolderInfo?.id ?? driveFolderInput,
                compressed.compressedName,
                compressed.compressedBlob,
                {
                  folderId: driveFolderInfo?.id,
                  folderName: driveFolderInfo?.name,
                  existingFileId: driveFileIdByLowerName.get(
                    compressed.compressedName.toLowerCase(),
                  ),
                },
              );
              driveFileIdByLowerName.set(
                compressed.compressedName.toLowerCase(),
                compDriveRes.fileId,
              );

              // 3. Upload ảnh nén <sku>.jpg lên Supabase Storage
              const upRes = await uploadCompressedProductImage(
                compressed.compressedBlob,
                compressed.compressedName,
              );
              if (upRes.errorMessage || !upRes.publicUrl) {
                throw new Error(
                  upRes.errorMessage ?? 'Không thể tải ảnh nén lên Supabase.',
                );
              }
              finalUrls.push(upRes.publicUrl);
            }

            if (finalUrls.length > 0) {
              const dbRes = await updateProductImageUrlsInSupabase(
                task.product.id,
                finalUrls,
              );
              if (dbRes.errorMessage) {
                throw new Error(dbRes.errorMessage);
              }
              updatedProductsUrlMap.set(task.product.id, finalUrls);
              updatedCount += 1;
            }
          }
        } catch (err) {
          failedCount += 1;
          failedDetails.push(
            `${task.product.sku}: ${err instanceof Error ? err.message : 'lỗi'}`,
          );
        }
      }

      setProcessedProductIds(nextProcessedIds);

      // Update local product copies for immediate next-batch computation
      const patchedProducts = products.map((p) => {
        const nextUrls = updatedProductsUrlMap.get(p.id);
        return nextUrls
          ? { ...p, image: nextUrls[0] ?? p.image, images: nextUrls }
          : p;
      });

      const nextPlan = buildDriveSyncPlan(driveFiles, patchedProducts, {
        includeAlreadySynced,
        includeExternalMigration,
        batchSize: IMAGE_SYNC_BATCH_SIZE,
        excludeProductIds: nextProcessedIds,
      });
      setDrivePlan(nextPlan);

      const summary =
        failedCount > 0
          ? `Đã đồng bộ lô ${updatedCount}/${total} sản phẩm từ ${scannedFolderLabel} (${failedCount} lỗi: ${failedDetails[0]}).`
          : `Đã nén & đồng bộ ${updatedCount} sản phẩm từ ${scannedFolderLabel}.`;

      await onCompleted(summary);

      if (failedCount > 0) {
        setScanError(
          `${failedCount} sản phẩm lỗi trong lô vừa chạy: ${failedDetails.slice(0, 3).join(' | ')}`,
        );
      }

      if (nextPlan.currentBatch.length > 0) {
        setBatchNotice(
          `${summary} Còn ${nextPlan.allTasks.length} sản phẩm chờ đồng bộ — bấm "Đồng bộ tiếp ${nextPlan.currentBatch.length} sản phẩm" để chạy lô kế tiếp.`,
        );
      } else if (failedCount === 0) {
        onClose();
      } else {
        setBatchNotice(
          `Đã chạy hết danh sách (${updatedCount} thành công, ${failedCount} lỗi).`,
        );
      }
    } finally {
      setIsApplying(false);
      setProgressText('');
    }
  };

  const handleApplySupabaseBatch = async () => {
    if (!supabasePlan || supabasePlan.currentBatch.length === 0) return;

    setScanError(null);
    setBatchNotice(null);
    setIsApplying(true);

    let updatedCount = 0;
    let failedCount = 0;
    const failedDetails: string[] = [];
    const nextProcessedIds = new Set(processedProductIds);
    const updatedProductsUrlMap = new Map<string, string[]>();

    try {
      const batch = supabasePlan.currentBatch;
      const total = batch.length;

      for (let i = 0; i < total; i += 1) {
        const match = batch[i];
        nextProcessedIds.add(match.product.id);
        setProgressText(
          `Đang gán link (${i + 1}/${total}): ${match.product.sku}...`,
        );

        const urls = match.matchedFiles
          .map((m) => m.file.publicUrl)
          .filter((u): u is string => Boolean(u));

        if (urls.length > 0) {
          const dbRes = await updateProductImageUrlsInSupabase(
            match.product.id,
            urls,
          );
          if (dbRes.errorMessage) {
            failedCount += 1;
            failedDetails.push(`${match.product.sku}: ${dbRes.errorMessage}`);
          } else {
            updatedProductsUrlMap.set(match.product.id, urls);
            updatedCount += 1;
          }
        }
      }

      setProcessedProductIds(nextProcessedIds);

      const patchedProducts = products.map((p) => {
        const nextUrls = updatedProductsUrlMap.get(p.id);
        return nextUrls
          ? { ...p, image: nextUrls[0] ?? p.image, images: nextUrls }
          : p;
      });

      const nextPlan = buildSupabaseScanPlan(supabaseFiles, patchedProducts, {
        includeAlreadySynced,
        batchSize: IMAGE_SYNC_BATCH_SIZE,
        excludeProductIds: nextProcessedIds,
      });
      setSupabasePlan(nextPlan);

      const summary =
        failedCount > 0
          ? `Đã gán link cho ${updatedCount}/${total} sản phẩm (${failedCount} lỗi: ${failedDetails[0]}).`
          : `Đã đồng bộ link ảnh cho ${updatedCount} sản phẩm từ ${scannedFolderLabel}.`;

      await onCompleted(summary);

      if (failedCount > 0) {
        setScanError(
          `${failedCount} sản phẩm lỗi: ${failedDetails.slice(0, 3).join(' | ')}`,
        );
      }

      if (nextPlan.currentBatch.length > 0) {
        setBatchNotice(
          `${summary} Còn ${nextPlan.allMatches.length} sản phẩm chờ gán link — bấm nút bên dưới để chạy tiếp.`,
        );
      } else if (failedCount === 0) {
        onClose();
      }
    } finally {
      setIsApplying(false);
      setProgressText('');
    }
  };

  const activeBatchCount =
    sourceTab === 'drive'
      ? (drivePlan?.currentBatch.length ?? 0)
      : (supabasePlan?.currentBatch.length ?? 0);

  const activeTotalQueueCount =
    sourceTab === 'drive'
      ? (drivePlan?.allTasks.length ?? 0)
      : (supabasePlan?.allMatches.length ?? 0);

  const activeRemainingAfterBatch =
    sourceTab === 'drive'
      ? (drivePlan?.remainingCount ?? 0)
      : (supabasePlan?.remainingCount ?? 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-scanner-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3
              id="image-scanner-title"
              className="font-display text-lg font-bold text-slate-900"
            >
              Quét & đồng bộ ảnh tự động theo mã SKU
            </h3>
            <p className="text-xs text-slate-500">
              Tự động lọc sản phẩm chưa có ảnh Supabase, đồng bộ tối đa{' '}
              <strong>{IMAGE_SYNC_BATCH_SIZE} sản phẩm/lần</strong> để tránh timeout.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại quét thư mục ảnh"
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
          <button
            type="button"
            onClick={() => handleSwitchTab('drive')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              sourceTab === 'drive'
                ? 'border-blue-700 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <HardDrive className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Từ Google Drive ({DEFAULT_DRIVE_FOLDER_NAME})</span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchTab('supabase')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
              sourceTab === 'supabase'
                ? 'border-blue-700 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <PackageCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Từ Supabase Storage ({PRODUCT_IMAGES_BUCKET})</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {sourceTab === 'drive' ? (
            <div className="space-y-3">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-700">
                  {hasDriveToken ? (
                    <span>
                      Đã kết nối Google Drive
                      {driveEmail ? ` (${driveEmail})` : ''}. Nếu chỉ có ảnh gốc{' '}
                      <code>0_&lt;sku&gt;.jpg</code> hoặc ảnh ngoài chưa chuẩn,
                      hệ thống sẽ nén <code>.jpg</code> và tải lên cả Drive &
                      Supabase.
                    </span>
                  ) : (
                    <span>
                      Đăng nhập Google để cấp quyền đọc & lưu ảnh chuẩn{' '}
                      <code>.jpg</code> trong thư mục Google Drive của bạn.
                    </span>
                  )}
                </div>

                {hasDriveToken ? (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectDrive()}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                  >
                    Ngắt kết nối Google
                  </button>
                ) : (
                  <GoogleSignInButton
                    onClick={() => void handleConnectDrive()}
                    disabled={isSigningInDrive}
                  />
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
                <div className="flex-1">
                  <label
                    htmlFor="drive-folder-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Tên thư mục hoặc link thư mục Google Drive
                  </label>
                  <input
                    id="drive-folder-input"
                    type="text"
                    value={driveFolderInput}
                    onChange={(e) => setDriveFolderInput(e.target.value)}
                    placeholder="shop_img hoặc https://drive.google.com/drive/folders/..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  disabled={isScanning || isApplying || !hasDriveToken}
                  onClick={() => void handleScanFolder()}
                  className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isScanning ? (
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <FolderSearch className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>Quét thư mục Drive</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-slate-700">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeExternalMigration}
                    onChange={(e) =>
                      setIncludeExternalMigration(e.target.checked)
                    }
                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
                  />
                  <span>
                    Chuẩn hóa cả sản phẩm đang dùng link ảnh ngoài (lưu{' '}
                    <code>0_&lt;sku&gt;.jpg</code> + nén lên Drive & Supabase)
                  </span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAlreadySynced}
                    onChange={(e) => setIncludeAlreadySynced(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
                  />
                  <span>Quét lại cả sản phẩm đã có ảnh Supabase</span>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
                <div className="flex-1">
                  <label
                    htmlFor="supabase-folder-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Thư mục con trong bucket {PRODUCT_IMAGES_BUCKET} (để trống
                    để quét toàn bộ bucket)
                  </label>
                  <input
                    id="supabase-folder-input"
                    type="text"
                    value={supabaseSubfolder}
                    onChange={(e) => setSupabaseSubfolder(e.target.value)}
                    placeholder="Để trống hoặc nhập tên thư mục con..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  disabled={isScanning || isApplying}
                  onClick={() => void handleScanFolder()}
                  className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isScanning ? (
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <FolderSearch className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>Quét Supabase Storage</span>
                </button>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAlreadySynced}
                  onChange={(e) => setIncludeAlreadySynced(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-700"
                />
                <span>Quét lại cả sản phẩm đã có ảnh Supabase</span>
              </label>
            </div>
          )}

          {scanError && (
            <div
              role="alert"
              className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
            >
              {scanError}
            </div>
          )}

          {batchNotice && (
            <div className="px-3.5 py-2.5 text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg">
              {batchNotice}
            </div>
          )}

          {progressText && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-lg">
              <Loader2
                className="w-4 h-4 animate-spin shrink-0"
                aria-hidden="true"
              />
              <span>{progressText}</span>
            </div>
          )}

          {sourceTab === 'drive' && drivePlan && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-[11px] font-medium text-emerald-700">
                    Lô hiện tại / Tổng cần đồng bộ
                  </p>
                  <p className="font-display text-xl font-bold text-emerald-900 tabular-nums">
                    {drivePlan.currentBatch.length} / {drivePlan.allTasks.length}
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Drive: {drivePlan.driveMatchedCount} (gốc 0_:{' '}
                    {drivePlan.driveOriginalOnlyCount}) · Ảnh ngoài:{' '}
                    {drivePlan.externalMigrationCount}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[11px] font-medium text-slate-600">
                    Đã bỏ qua (đã có ảnh Supabase)
                  </p>
                  <p className="font-display text-xl font-bold text-slate-800 tabular-nums">
                    {drivePlan.skippedSyncedCount}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Còn lại sau lô này: {drivePlan.remainingCount} SP
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[11px] font-medium text-slate-600">
                    File Drive chưa khớp SKU
                  </p>
                  <p className="font-display text-xl font-bold text-slate-800 tabular-nums">
                    {drivePlan.unmatchedFiles.length}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Bỏ qua (không phải ảnh): {drivePlan.ignoredFilesCount}
                  </p>
                </div>
              </div>

              {drivePlan.currentBatch.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl">
                  Không còn sản phẩm nào cần đồng bộ ảnh từ {scannedFolderLabel}.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3">SKU</th>
                        <th className="py-2.5 px-3">Tên sản phẩm</th>
                        <th className="py-2.5 px-3">Nguồn phát hiện</th>
                        <th className="py-2.5 px-3">Quy trình xử lý</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {drivePlan.currentBatch.map((task) => (
                        <tr key={task.product.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {task.product.sku}
                          </td>
                          <td className="py-2 px-3 text-slate-800">
                            {task.product.name}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600">
                            {task.kind === 'drive-match'
                              ? task.matchedFiles
                                  .map((m) => m.file.name)
                                  .join(', ')
                              : `Link ngoài (${task.externalUrls.length} ảnh)`}
                          </td>
                          <td className="py-2 px-3 text-blue-700 font-medium">
                            {task.kind === 'drive-match' ? (
                              task.needsCompressedDriveUpload ? (
                                <span>
                                  Nén{' '}
                                  <code className="font-mono">
                                    {buildProductImageFilename(
                                      task.product.sku,
                                      0,
                                      false,
                                    )}
                                  </code>{' '}
                                  → Drive & Supabase
                                </span>
                              ) : (
                                <span>
                                  Lưu{' '}
                                  <code className="font-mono">
                                    {buildProductImageFilename(
                                      task.product.sku,
                                      0,
                                      false,
                                    )}
                                  </code>{' '}
                                  → Supabase
                                </span>
                              )
                            ) : (
                              <span>
                                Lưu{' '}
                                <code className="font-mono">
                                  {buildProductImageFilename(
                                    task.product.sku,
                                    0,
                                    true,
                                  )}
                                </code>{' '}
                                + nén{' '}
                                <code className="font-mono">
                                  {buildProductImageFilename(
                                    task.product.sku,
                                    0,
                                    false,
                                  )}
                                </code>{' '}
                                → Drive & Supabase
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {drivePlan.unmatchedFiles.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  File chưa khớp SKU (hoặc SKU đã có ảnh Supabase):{' '}
                  {drivePlan.unmatchedFiles
                    .slice(0, 8)
                    .map((f) => f.name)
                    .join(', ')}
                  {drivePlan.unmatchedFiles.length > 8
                    ? ` và ${drivePlan.unmatchedFiles.length - 8} file khác`
                    : ''}
                  .
                </p>
              )}
            </div>
          )}

          {sourceTab === 'supabase' && supabasePlan && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <p className="text-[11px] font-medium text-emerald-700">
                    Lô hiện tại / Tổng khớp SKU
                  </p>
                  <p className="font-display text-xl font-bold text-emerald-900 tabular-nums">
                    {supabasePlan.currentBatch.length} /{' '}
                    {supabasePlan.allMatches.length}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[11px] font-medium text-slate-600">
                    Đã bỏ qua (đã có ảnh Supabase)
                  </p>
                  <p className="font-display text-xl font-bold text-slate-800 tabular-nums">
                    {supabasePlan.skippedSyncedCount}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[11px] font-medium text-slate-600">
                    Ảnh chưa khớp SKU
                  </p>
                  <p className="font-display text-xl font-bold text-slate-800 tabular-nums">
                    {supabasePlan.unmatchedFiles.length}
                  </p>
                </div>
              </div>

              {supabasePlan.currentBatch.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl">
                  Không còn sản phẩm nào cần gán link từ {scannedFolderLabel}.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3">SKU</th>
                        <th className="py-2.5 px-3">Tên sản phẩm</th>
                        <th className="py-2.5 px-3">File nguồn tìm thấy</th>
                        <th className="py-2.5 px-3">Link Storage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {supabasePlan.currentBatch.map((match) => (
                        <tr
                          key={match.product.id}
                          className="hover:bg-slate-50"
                        >
                          <td className="py-2 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {match.product.sku}
                          </td>
                          <td className="py-2 px-3 text-slate-800">
                            {match.product.name}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600">
                            {match.matchedFiles
                              .map((m) => m.file.name)
                              .join(', ')}
                          </td>
                          <td className="py-2 px-3 font-mono text-blue-700">
                            {match.matchedFiles.length} ảnh sẵn sàng
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-xs text-slate-500">
            {activeTotalQueueCount > 0 && (
              <span>
                Đang chọn tối đa {IMAGE_SYNC_BATCH_SIZE} sản phẩm/lần · Còn{' '}
                {activeRemainingAfterBatch} sản phẩm cho các lô sau
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isApplying}
              className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-60"
            >
              Đóng
            </button>

            {activeBatchCount > 0 && (
              <button
                type="button"
                disabled={isApplying}
                onClick={() =>
                  void (sourceTab === 'drive'
                    ? handleApplyDriveBatch()
                    : handleApplySupabaseBatch())
                }
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {isApplying ? (
                  <Loader2
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                )}
                <span>
                  {processedProductIds.size > 0
                    ? `Đồng bộ tiếp ${activeBatchCount} sản phẩm`
                    : sourceTab === 'drive'
                      ? `Nén & đồng bộ ${activeBatchCount} sản phẩm`
                      : `Gán link ảnh cho ${activeBatchCount} sản phẩm`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

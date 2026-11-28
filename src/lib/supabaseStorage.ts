import { getSupabaseClient } from './supabaseClient';
import {
  computeRenamedStorageMoves,
  PRODUCT_IMAGES_BUCKET,
  type ScannableImageFile,
} from '../utils/imageSyncLogic';

function getStorageEnv() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  const adminProductsTable =
    import.meta.env.VITE_SUPABASE_ADMIN_PRODUCTS_TABLE?.trim() || 'products';
  return { supabaseUrl, supabaseAnonKey, adminProductsTable };
}

function formatStorageError(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (lower.includes('bucket not found') || lower.includes('not found')) {
    return `Chưa tìm thấy bucket "${PRODUCT_IMAGES_BUCKET}" trên Supabase Storage. Vui lòng chạy file db_creat/upgrade_schema_01.sql (hoặc db_creat/schema.sql nếu tạo mới) trong Supabase SQL Editor.`;
  }
  if (lower.includes('row-level security') || lower.includes('permission')) {
    return 'Chỉ tài khoản Quản lý (Manager) hoặc Quản trị (Admin) mới có quyền tải hoặc đổi tên ảnh trên Supabase Storage.';
  }
  return rawMessage;
}

export async function uploadCompressedProductImage(
  blob: Blob,
  fileName: string,
  folderPrefix = '',
): Promise<{ publicUrl?: string; path?: string; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getStorageEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình kết nối Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const cleanPrefix = folderPrefix.trim().replace(/^\/+|\/+$/g, '');
    const storagePath = cleanPrefix ? `${cleanPrefix}/${fileName}` : fileName;

    const { error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(storagePath, blob, {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: true,
      });

    if (error) {
      return { errorMessage: formatStorageError(error.message) };
    }

    const { data } = supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(storagePath);

    return {
      publicUrl: `${data.publicUrl}?v=${Date.now()}`,
      path: storagePath,
    };
  } catch (err) {
    return {
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi tải ảnh lên Supabase Storage',
    };
  }
}

export async function renameSupabaseProductImagesForSku(
  oldSku: string,
  newSku: string,
  currentImageUrls: string[],
): Promise<{
  updatedUrls: string[];
  renamedCount: number;
  errorMessage?: string;
}> {
  const moves = computeRenamedStorageMoves(currentImageUrls, oldSku, newSku);
  if (moves.length === 0) {
    return { updatedUrls: currentImageUrls, renamedCount: 0 };
  }

  const { supabaseUrl, supabaseAnonKey } = getStorageEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      updatedUrls: currentImageUrls,
      renamedCount: 0,
      errorMessage: 'Chưa cấu hình kết nối Supabase.',
    };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const urlReplacements = new Map<string, string>();
    let renamedCount = 0;

    for (const move of moves) {
      const { error: moveError } = await supabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .move(move.oldPath, move.newPath);

      if (moveError) {
        // Fallback if destination already exists: copy or remove target first then move
        await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .remove([move.newPath]);
        const retry = await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .move(move.oldPath, move.newPath);
        if (retry.error) {
          return {
            updatedUrls: currentImageUrls.map(
              (url) => urlReplacements.get(url) ?? url,
            ),
            renamedCount,
            errorMessage: formatStorageError(retry.error.message),
          };
        }
      }

      const { data } = supabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(move.newPath);
      urlReplacements.set(move.oldUrl, `${data.publicUrl}?v=${Date.now()}`);
      renamedCount += 1;
    }

    const updatedUrls = currentImageUrls.map(
      (url) => urlReplacements.get(url) ?? url,
    );
    return { updatedUrls, renamedCount };
  } catch (err) {
    return {
      updatedUrls: currentImageUrls,
      renamedCount: 0,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi đổi tên ảnh trên Supabase',
    };
  }
}

export async function listSupabaseStorageImages(
  folderPath = '',
): Promise<{ files: ScannableImageFile[]; errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getStorageEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { files: [], errorMessage: 'Chưa cấu hình kết nối Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const collected: ScannableImageFile[] = [];

    const walkFolder = async (prefix: string) => {
      let offset = 0;
      const limit = 1000;

      while (true) {
        const { data, error } = await supabase.storage
          .from(PRODUCT_IMAGES_BUCKET)
          .list(prefix, {
            limit,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          });

        if (error) {
          throw new Error(formatStorageError(error.message));
        }
        if (!data || data.length === 0) break;

        for (const item of data) {
          if (!item.name || item.name === '.emptyFolderPlaceholder') continue;
          const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
          // Supabase folders returned from storage.list() have id === null
          if (!item.id) {
            await walkFolder(fullPath);
            continue;
          }

          const { data: pubData } = supabase.storage
            .from(PRODUCT_IMAGES_BUCKET)
            .getPublicUrl(fullPath);
          const metaSize =
            item.metadata && typeof item.metadata.size === 'number'
              ? item.metadata.size
              : undefined;

          collected.push({
            id: item.id,
            name: item.name,
            fullPath,
            publicUrl: pubData.publicUrl,
            size: metaSize,
          });
        }

        if (data.length < limit) break;
        offset += limit;
      }
    };

    const cleanPrefix = folderPath.trim().replace(/^\/+|\/+$/g, '');
    await walkFolder(cleanPrefix);
    return { files: collected };
  } catch (err) {
    return {
      files: [],
      errorMessage:
        err instanceof Error
          ? err.message
          : 'Lỗi quét thư mục Supabase Storage',
    };
  }
}

export async function updateProductImageUrlsInSupabase(
  productId: string,
  imageUrls: string[],
): Promise<{ errorMessage?: string }> {
  const { supabaseUrl, supabaseAnonKey, adminProductsTable } = getStorageEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { errorMessage: 'Chưa cấu hình Supabase.' };
  }

  try {
    const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase
      .from(adminProductsTable)
      .update({ image_urls: imageUrls })
      .eq('id', productId);

    return error ? { errorMessage: error.message } : {};
  } catch (err) {
    return {
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi cập nhật ảnh sản phẩm',
    };
  }
}

import {
  buildProductImageFilename,
  DEFAULT_DRIVE_FOLDER_NAME,
  normalizeSkuMatchKey,
  parseGoogleDriveFileId,
  parseGoogleDriveFolderId,
  parseImageFilename,
  type ScannableImageFile,
} from '../utils/imageSyncLogic';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

export interface DriveFolderInfo {
  id: string;
  name: string;
}

interface DriveApiFileItem {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  trashed?: boolean;
  webViewLink?: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function parseDriveErrorMessage(res: Response): Promise<string> {
  if (res.status === 401) {
    return 'Phiên đăng nhập Google Drive đã hết hạn. Vui lòng đăng nhập lại Google Drive.';
  }
  try {
    const data = (await res.json()) as {
      error?: { message?: string };
    };
    return data.error?.message || `Lỗi Google Drive API (${res.status})`;
  } catch {
    return `Lỗi Google Drive API (${res.status})`;
  }
}

export async function resolveDriveFolder(
  accessToken: string,
  folderInput: string = DEFAULT_DRIVE_FOLDER_NAME,
  options: { createIfMissing?: boolean } = {},
): Promise<DriveFolderInfo> {
  const cleanInput = folderInput.trim() || DEFAULT_DRIVE_FOLDER_NAME;
  const folderId = parseGoogleDriveFolderId(cleanInput);

  if (folderId) {
    const res = await fetch(
      `${DRIVE_FILES_API}/${encodeURIComponent(folderId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) {
      throw new Error(await parseDriveErrorMessage(res));
    }
    const data = (await res.json()) as DriveApiFileItem;
    if (
      data.trashed ||
      data.mimeType !== 'application/vnd.google-apps.folder'
    ) {
      throw new Error('Link hoặc ID thư mục Google Drive không hợp lệ.');
    }
    return { id: data.id, name: data.name };
  }

  const query = `name = '${escapeDriveQueryValue(cleanInput)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchUrl = `${DRIVE_FILES_API}?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchRes.ok) {
    throw new Error(await parseDriveErrorMessage(searchRes));
  }
  const searchData = (await searchRes.json()) as {
    files?: DriveApiFileItem[];
  };
  if (searchData.files && searchData.files.length > 0) {
    const found = searchData.files[0];
    return { id: found.id, name: found.name };
  }

  if (!options.createIfMissing) {
    throw new Error(
      `Không tìm thấy thư mục "${cleanInput}" trong Google Drive của bạn.`,
    );
  }

  const createRes = await fetch(`${DRIVE_FILES_API}?fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: cleanInput,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createRes.ok) {
    throw new Error(await parseDriveErrorMessage(createRes));
  }
  const created = (await createRes.json()) as DriveApiFileItem;
  return { id: created.id, name: created.name };
}

export async function listDriveFolderImages(
  accessToken: string,
  folderInput: string = DEFAULT_DRIVE_FOLDER_NAME,
): Promise<{ folder: DriveFolderInfo; files: ScannableImageFile[] }> {
  const folder = await resolveDriveFolder(accessToken, folderInput, {
    createIfMissing: false,
  });

  const collected: ScannableImageFile[] = [];
  let nextPageToken: string | undefined;

  do {
    const q = `'${escapeDriveQueryValue(folder.id)}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const res = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(await parseDriveErrorMessage(res));
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: DriveApiFileItem[];
    };

    for (const item of data.files ?? []) {
      if (item.mimeType === 'application/vnd.google-apps.folder') continue;
      collected.push({
        id: item.id,
        name: item.name,
        size: item.size ? Number(item.size) : undefined,
      });
    }

    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return { folder, files: collected };
}

export async function downloadDriveFileBlob(
  accessToken: string,
  fileId: string,
): Promise<Blob> {
  const res = await fetch(
    `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    throw new Error(await parseDriveErrorMessage(res));
  }
  return await res.blob();
}

function loadExternalImageViaCanvas(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, img.naturalWidth || img.width);
        canvas.height = Math.max(1, img.naturalHeight || img.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý Canvas.'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Không thể đọc dữ liệu ảnh ngoài.'));
            }
          },
          'image/jpeg',
          0.95,
        );
      } catch {
        reject(new Error('Máy chủ ảnh ngoài chặn CORS.'));
      }
    };
    img.onerror = () => {
      reject(new Error('Không thể tải ảnh từ đường dẫn ngoài (CORS hoặc link lỗi).'));
    };
    img.src = url;
  });
}

export async function fetchExternalImageBlob(
  url: string,
  driveAccessToken?: string | null,
): Promise<Blob> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Link ảnh trống.');
  }

  const driveFileId = parseGoogleDriveFileId(trimmed);
  if (driveFileId && driveAccessToken) {
    return await downloadDriveFileBlob(driveAccessToken, driveFileId);
  }

  try {
    const res = await fetch(trimmed, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0 && (!blob.type || blob.type.startsWith('image/'))) {
        return blob;
      }
    }
  } catch {
    // Fallback below via <img crossOrigin="anonymous">
  }

  return await loadExternalImageViaCanvas(trimmed);
}

export async function uploadFileToDriveFolder(
  accessToken: string,
  folderInput: string,
  filename: string,
  blob: Blob,
  options: { folderId?: string; folderName?: string; existingFileId?: string } = {},
): Promise<{
  fileId: string;
  folderId: string;
  folderName: string;
  webViewLink?: string;
}> {
  let targetFolderId = options.folderId;
  let targetFolderName = options.folderName ?? folderInput;

  if (!targetFolderId) {
    const folder = await resolveDriveFolder(accessToken, folderInput, {
      createIfMissing: true,
    });
    targetFolderId = folder.id;
    targetFolderName = folder.name;
  }

  let existingFileId = options.existingFileId;
  if (!existingFileId) {
    const findQuery = `name = '${escapeDriveQueryValue(filename)}' and '${escapeDriveQueryValue(targetFolderId)}' in parents and trashed = false`;
    const findRes = await fetch(
      `${DRIVE_FILES_API}?q=${encodeURIComponent(findQuery)}&fields=files(id,name,webViewLink)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!findRes.ok) {
      throw new Error(await parseDriveErrorMessage(findRes));
    }
    const existing = (await findRes.json()) as { files?: DriveApiFileItem[] };
    existingFileId = existing.files?.[0]?.id;
  }

  if (existingFileId) {
    const updateRes = await fetch(
      `${DRIVE_UPLOAD_API}/${encodeURIComponent(existingFileId)}?uploadType=media&fields=id,name,webViewLink&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': blob.type || 'image/jpeg',
        },
        body: blob,
      },
    );
    if (!updateRes.ok) {
      throw new Error(await parseDriveErrorMessage(updateRes));
    }
    const updated = (await updateRes.json()) as DriveApiFileItem;
    return {
      fileId: updated.id,
      folderId: targetFolderId,
      folderName: targetFolderName,
      webViewLink: updated.webViewLink,
    };
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name: filename,
          parents: [targetFolderId],
        }),
      ],
      { type: 'application/json' },
    ),
  );
  form.append('file', blob, filename);

  const createRes = await fetch(
    `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    },
  );
  if (!createRes.ok) {
    throw new Error(await parseDriveErrorMessage(createRes));
  }
  const created = (await createRes.json()) as DriveApiFileItem;
  return {
    fileId: created.id,
    folderId: targetFolderId,
    folderName: targetFolderName,
    webViewLink: created.webViewLink,
  };
}

export async function uploadOriginalToDriveFolder(
  accessToken: string,
  folderInput: string,
  filename: string,
  blob: Blob,
): Promise<{ fileId: string; folderName: string; webViewLink?: string }> {
  const res = await uploadFileToDriveFolder(
    accessToken,
    folderInput,
    filename,
    blob,
  );
  return {
    fileId: res.fileId,
    folderName: res.folderName,
    webViewLink: res.webViewLink,
  };
}

export async function renameDriveFilesForSkuChange(
  accessToken: string,
  folderInput: string,
  oldSku: string,
  newSku: string,
): Promise<{ renamedCount: number; errorMessage?: string }> {
  const oldKey = normalizeSkuMatchKey(oldSku);
  const newKey = normalizeSkuMatchKey(newSku);
  if (!oldKey || !newKey || oldKey === newKey) {
    return { renamedCount: 0 };
  }

  try {
    const { files } = await listDriveFolderImages(accessToken, folderInput);
    let renamedCount = 0;

    for (const file of files) {
      const parsed = parseImageFilename(file.name);
      if (!parsed) continue;

      const exactMatch = normalizeSkuMatchKey(parsed.stem) === oldKey;
      const baseMatch = normalizeSkuMatchKey(parsed.baseStem) === oldKey;
      if (!exactMatch && !baseMatch) continue;

      const slotIndex = exactMatch ? 0 : parsed.slotIndex;
      const extMatch = file.name.match(/(\.[A-Za-z0-9]+)$/);
      const originalExt = extMatch?.[1]?.toLowerCase() || '.jpg';
      const targetJpgName = buildProductImageFilename(
        newSku,
        slotIndex,
        parsed.isOriginalPrefix,
      );
      const nextName =
        originalExt === '.jpg'
          ? targetJpgName
          : targetJpgName.replace(/\.jpg$/i, originalExt);

      if (nextName === file.name) continue;

      const patchRes = await fetch(
        `${DRIVE_FILES_API}/${encodeURIComponent(file.id)}?supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: nextName }),
        },
      );
      if (!patchRes.ok) {
        return {
          renamedCount,
          errorMessage: await parseDriveErrorMessage(patchRes),
        };
      }
      renamedCount += 1;
    }

    return { renamedCount };
  } catch (err) {
    return {
      renamedCount: 0,
      errorMessage:
        err instanceof Error ? err.message : 'Lỗi đổi tên file trên Google Drive',
    };
  }
}

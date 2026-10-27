import { supabase } from './supabase.js';

// 学生头像：私有 bucket avatars，路径 {user_id}/avatar-{时间戳}.jpg，profiles.avatar_path 存路径
const AVATAR_BUCKET = 'avatars';
const AVATAR_SIZE = 256;
const SIGNED_URL_SECONDS = 60 * 60;

// 浏览器里裁成中心方图并缩到 256px（JPEG），不上传原图
async function resizeAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  canvas.getContext('2d').drawImage(
    bitmap,
    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
    0, 0, AVATAR_SIZE, AVATAR_SIZE,
  );
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片处理失败'))), 'image/jpeg', 0.85);
  });
}

export async function uploadAvatar(userId, file, oldPath) {
  const blob = await resizeAvatar(file);
  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  const { error: pErr } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
  if (pErr) throw pErr;
  // 换新图后删掉旧文件，避免堆积；删除失败不影响结果
  if (oldPath && oldPath !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => {});
  }
  return path;
}

export async function avatarSignedUrl(path) {
  if (!path) return '';
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) return '';
  return data?.signedUrl || '';
}

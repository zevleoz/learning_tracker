import { supabase } from './supabase.js';

/**
 * 当前登录用户，取自本地 session（不发网络请求）。
 * supabase.auth.getUser() 每次都会向认证服务发一次请求（约一次往返）；页面只需要 id / email 时用这个。
 */
export async function getSessionUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

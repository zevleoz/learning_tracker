import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { logger } from './logger';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null); // { id, role, full_name, ... }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    // 从 session / auth state 同步 user + profile
    function sync(session) {
      const u = session?.user || null;
      if (alive) setUser(u);
      if (u) {
        // 先从 user_metadata 读 role/full_name（signUp 时传入的），
        // 然后异步查 profile 表做补充
        const metaRole = u.user_metadata?.role;
        const metaName = u.user_metadata?.full_name || u.email;
        if (metaRole) {
          setProfile({ id: u.id, role: Number(metaRole), full_name: metaName });
        }
        loadProfile(u.id, metaRole);
      } else {
        setProfile(null);
        setLoading(false);
      }
    }

    // 初始 session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (alive) sync(session);
    });

    // 监听变更
    const { data } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (alive) sync(session);
    });

    return () => { alive = false; data?.subscription?.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(uid, metaRole) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, full_name, created_at')
        .eq('id', uid)
        .maybeSingle();
      if (!error) {
        if (data) {
          // 安全原则：始终信任 profiles 表的 role（数据库权威来源），
          // 不信任 user_metadata.role（用户可自行修改 → 提权风险）
          if (metaRole && Number(metaRole) !== data.role) {
            logger.warn('Role mismatch: DB role takes precedence over user_metadata', {
              user_metadata_role: metaRole,
              profiles_role: data.role,
            });
          }
          setProfile({ ...data, role: data.role });
        } else if (metaRole) {
          // 仅当 profile 行尚未创建时（trigger 延迟），临时回退到 user_metadata
          setProfile({ id: uid, role: Number(metaRole), full_name: 'User' });
        }
      }
    } catch (err) {
      logger.warn('loadProfile failed, using fallback:', err);
    } finally {
      setLoading(false);
    }
  }

  const signOut = () => supabase.auth.signOut();

  return { user, profile, loading, signOut, isMentor: (profile?.role || 1) >= 2 };
}

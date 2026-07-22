import { supabase } from './supabase';

let mockUser = null;
let mockProfile = null;

function setAuthUser(user) {
  mockUser = user;
}

function setAuthProfile(profile) {
  mockProfile = profile;
}

function useAuth() {
  return {
    user: mockUser,
    profile: mockProfile,
    loading: mockUser === null,
    login: async (email, password) => {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.data?.user) {
        mockUser = result.data.user;
      }
      return result;
    },
    logout: async () => {
      await supabase.auth.signOut();
      mockUser = null;
      mockProfile = null;
    },
  };
}

export { useAuth, setAuthUser, setAuthProfile };
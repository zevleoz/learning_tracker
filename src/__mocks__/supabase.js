let mockAuthState = {
  user: null,
  session: null,
};

let mockTables = {
  profiles: [],
  courses: [],
  learning_sessions: [],
  teacher_student_connections: [],
};

const callHistory = [];

function resetMocks() {
  mockAuthState = { user: null, session: null };
  mockTables = {
    profiles: [],
    courses: [],
    learning_sessions: [],
    teacher_student_connections: [],
  };
  callHistory.length = 0;
}

function trackCall(method, table, args) {
  callHistory.push({ method, table, args, timestamp: Date.now() });
}

function createMockQueryBuilder(tableName) {
  const query = {
    filters: [],
    selectFields: '*',
    limitCount: null,
    orderBy: null,
    singleMode: false,
    maybeSingleMode: false,

    select(fields = '*') {
      this.selectFields = fields;
      return this;
    },

    eq(field, value) {
      this.filters.push({ type: 'eq', field, value });
      return this;
    },

    lt(field, value) {
      this.filters.push({ type: 'lt', field, value });
      return this;
    },

    gt(field, value) {
      this.filters.push({ type: 'gt', field, value });
      return this;
    },

    in(field, values) {
      this.filters.push({ type: 'in', field, values });
      return this;
    },

    is(field, value) {
      this.filters.push({ type: 'is', field, value });
      return this;
    },

    not(field, operator, value) {
      this.filters.push({ type: 'not', field, operator, value });
      return this;
    },

    gte(field, value) {
      this.filters.push({ type: 'gte', field, value });
      return this;
    },

    limit(count) {
      this.limitCount = count;
      return this;
    },

    order(field, options = {}) {
      this.orderBy = { field, ...options };
      return this;
    },

    single() {
      this.singleMode = true;
      return this;
    },

    maybeSingle() {
      this.maybeSingleMode = true;
      return this;
    },

    match(conditions) {
      Object.entries(conditions).forEach(([field, value]) => {
        this.eq(field, value);
      });
      return this;
    },

    insert(data) {
      trackCall('insert', tableName, data);
      const table = mockTables[tableName] || [];
      const inserted = Array.isArray(data) ? data : [data];
      let results = [];
      inserted.forEach(item => {
        const withId = { ...item, id: item.id || `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
        table.push(withId);
        results.push(withId);
      });
      mockTables[tableName] = table;

      let finalData = results;
      let shouldSingle = false;

      return {
        select: () => {
          return {
            single: async () => {
              shouldSingle = true;
              finalData = results.length > 0 ? results[0] : null;
              return { data: finalData, error: null };
            },
            then: async (resolve) => {
              resolve({ data: finalData, error: null });
            },
          };
        },
        then: async (resolve) => {
          resolve({ data: finalData, error: null });
        },
      };
    },

    async update(data) {
      trackCall('update', tableName, data);
      const table = mockTables[tableName] || [];
      const updated = table.map(row => {
        let matches = true;
        for (const filter of this.filters) {
          if (filter.type === 'eq' && row[filter.field] !== filter.value) matches = false;
        }
        return matches ? { ...row, ...data } : row;
      });
      mockTables[tableName] = updated;
      return { data: updated.filter(row => {
        let matches = true;
        for (const filter of this.filters) {
          if (filter.type === 'eq' && row[filter.field] !== filter.value) matches = false;
        }
        return matches;
      }), error: null };
    },

    async delete() {
      trackCall('delete', tableName, this.filters);
      const table = mockTables[tableName] || [];
      const deleted = table.filter(row => {
        let matches = true;
        for (const filter of this.filters) {
          if (filter.type === 'eq' && row[filter.field] !== filter.value) matches = false;
        }
        return matches;
      });
      mockTables[tableName] = table.filter(row => {
        let matches = false;
        for (const filter of this.filters) {
          if (filter.type === 'eq' && row[filter.field] === filter.value) matches = true;
        }
        return !matches;
      });
      return { data: deleted, error: null };
    },

    async then(resolve) {
      trackCall('select', tableName, { filters: this.filters, fields: this.selectFields });
      let results = [...(mockTables[tableName] || [])];

      for (const filter of this.filters) {
        results = results.filter(row => {
          if (filter.type === 'eq') return row[filter.field] === filter.value;
          if (filter.type === 'lt') return row[filter.field] < filter.value;
          if (filter.type === 'gt') return row[filter.field] > filter.value;
          if (filter.type === 'in') return filter.values.includes(row[filter.field]);
          if (filter.type === 'is') return row[filter.field] === filter.value;
          if (filter.type === 'not') {
            if (filter.operator === 'is') return row[filter.field] !== filter.value;
            if (filter.operator === 'eq') return row[filter.field] !== filter.value;
          }
          if (filter.type === 'gte') return row[filter.field] >= filter.value;
          return true;
        });
      }

      if (this.orderBy) {
        results.sort((a, b) => {
          const valA = a[this.orderBy.field];
          const valB = b[this.orderBy.field];
          return this.orderBy.ascending !== false ? valA > valB ? 1 : -1 : valA < valB ? 1 : -1;
        });
      }

      if (this.limitCount !== null) {
        results = results.slice(0, this.limitCount);
      }

      let finalResult = { data: results, error: null };

      if (this.singleMode) {
        if (results.length === 1) {
          finalResult = { data: results[0], error: null };
        } else if (results.length === 0) {
          finalResult = { data: null, error: { code: 'PGRST116', message: 'Single row expected' } };
        } else {
          finalResult = { data: results[0], error: null };
        }
      } else if (this.maybeSingleMode) {
        finalResult = { data: results.length === 0 ? null : results[0], error: null };
      }

      resolve(finalResult);
    },
  };

  return query;
}

const supabase = {
  auth: {
    async signInWithPassword({ email, password }) {
      trackCall('signInWithPassword', 'auth', { email, password });
      const profile = mockTables.profiles.find(p => p.email === email);
      if (!profile) {
        return { data: null, error: { message: 'Email not found' } };
      }
      if (password !== 'password123') {
        return { data: null, error: { message: 'Invalid password' } };
      }
      mockAuthState = {
        user: {
          id: profile.id,
          email: profile.email,
          user_metadata: {
            role: profile.role,
            full_name: profile.full_name,
            school_name: profile.school_name || '',
          },
        },
        session: { user: mockAuthState.user },
      };
      return { data: mockAuthState, error: null };
    },

    async signUp({ email, password, options }) {
      trackCall('signUp', 'auth', { email, password, options });
      const userId = `mock-${Date.now()}`;
      const role = options?.data?.role || 1;
      mockTables.profiles.push({
        id: userId,
        email,
        role,
        full_name: options?.data?.full_name || email.split('@')[0],
        school_name: options?.data?.school_name || '',
        created_at: new Date().toISOString(),
      });
      mockAuthState = {
        user: {
          id: userId,
          email,
          user_metadata: {
            role,
            full_name: options?.data?.full_name || email.split('@')[0],
            school_name: options?.data?.school_name || '',
          },
        },
        session: { user: mockAuthState.user },
      };
      return { data: { user: mockAuthState.user }, error: null };
    },

    async getSession() {
      trackCall('getSession', 'auth');
      return { data: { session: mockAuthState.session } };
    },

    async signOut() {
      trackCall('signOut', 'auth');
      mockAuthState = { user: null, session: null };
      return { error: null };
    },

    async updateUser(data) {
      trackCall('updateUser', 'auth', data);
      return { data: mockAuthState.user, error: null };
    },

    async resetPasswordForEmail(email, options) {
      trackCall('resetPasswordForEmail', 'auth', { email, options });
      return { data: null, error: null };
    },

    onAuthStateChange(callback) {
      return {
        data: {
          subscription: {
            unsubscribe: () => {},
          },
        },
      };
    },

    async getUser() {
      trackCall('getUser', 'auth');
      return { data: { user: mockAuthState.user } };
    },
  },

  from(tableName) {
    return createMockQueryBuilder(tableName);
  },

  channel(name) {
    return {
      on(event, options, callback) {
        return this;
      },
      subscribe() {
        return {
          unsubscribe() {},
        };
      },
    };
  },

  removeChannel(channel) {
    if (channel?.unsubscribe) {
      channel.unsubscribe();
    }
  },

  __resetMocks: resetMocks,
  __getCallHistory: () => [...callHistory],
  __setAuthState: (state) => { mockAuthState = state; },
  __setTableData: (tableName, data) => { mockTables[tableName] = data; },
  __getTableData: (tableName) => mockTables[tableName],
};

export { supabase };
export default supabase;
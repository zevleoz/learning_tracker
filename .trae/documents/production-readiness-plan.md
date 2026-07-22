# Production Readiness Plan

## Executive Summary

As we transition from beta to production, we need to ensure the application is robust, maintainable, and resilient to bugs. This plan addresses the critical risk areas identified in the codebase:

1. **Authentication/Role-based routing** - Recent `is_mentor()` inconsistency caused teacher login failures
2. **Supabase data layer** - 10+ SQL patches with conflicting definitions
3. **Component logic** - Complex state management in Learning.jsx (~900 lines)
4. **Production resilience** - No error boundaries, no CI pipeline

---

## Phase 1: Testing Infrastructure

### 1.1 Centralized Supabase Mock

**Goal:** Create a reusable mock for all component tests

**Files:**
- `src/__mocks__/supabase.js` - Mock supabase client with configurable responses

**Key Features:**
- Mock `supabase.auth.signInWithPassword`, `signUp`, `getSession`, `signOut`
- Mock `supabase.from().select()`, `.insert()`, `.update()`, `.delete()`
- Support for query filtering (`eq`, `lt`, `gt`, etc.)
- Track calls for assertion (e.g., `expect(supabase.from).toHaveBeenCalledWith('courses')`)

### 1.2 Integration Tests for Critical Flows

**Test 1: Login + Role-based Redirect**
- Student login → redirect to `/syllabus`
- Teacher login → redirect to `/mentor`
- Invalid credentials → error toast

**Test 2: Create Course + Edit Course Type**
- Create course with `course_type=1` (校内)
- Edit course → change to `course_type=2` (校外)
- Verify database update

**Test 3: Record Learning Session with Time Conflict**
- Create valid learning session
- Attempt overlapping session → error detected
- Edit session to non-conflicting time → success

**Files:**
- `__tests__/Login.test.jsx`
- `__tests__/Syllabus.test.jsx`
- `__tests__/Learning.test.jsx`

---

## Phase 2: Production Resilience

### 2.1 React Error Boundary

**Goal:** Prevent full-page crashes when individual components fail

**Files:**
- `src/components/ErrorBoundary.jsx` - Error boundary component
- `src/App.jsx` - Wrap routes with error boundary

**Features:**
- Catch React errors during rendering
- Display user-friendly fallback UI
- Log errors for debugging
- Allow users to retry

### 2.2 Console Log Cleanup

**Goal:** Remove debug logging from production code

**Action:**
- Search all `.js` and `.jsx` files for `console.log`, `console.error`, `console.warn`
- Either remove or wrap in `if (process.env.NODE_ENV !== 'production')`

**Files:**
- All files in `src/` directory

---

## Phase 3: Database Consolidation

### 3.1 Single Consolidated Schema

**Goal:** Eliminate the "which patch order?" problem

**Files:**
- `supabase/schema.v2.sql` - Complete, final schema with all correct definitions

**Content:**
- All table definitions
- All RLS policies (final correct versions)
- All functions (`is_mentor()`, `is_connected_teacher_of()`, etc.)
- All triggers
- Indexes

**Process:**
1. Review all existing patches and identify the final correct version of each object
2. Write clean, commented SQL
3. Include migration instructions for existing databases

---

## Phase 4: CI/CD Pipeline

### 4.1 GitHub Actions Workflow

**Goal:** Prevent broken code from reaching production

**Files:**
- `.github/workflows/ci.yml` - CI workflow

**Workflow:**
- Trigger on every push/pull request
- Run `npm test` (unit/integration tests)
- Run `npm run build` (build verification)
- Fail if any step fails

---

## Phase 5: Additional Unit Tests

### 5.1 Utility Function Tests

**Files:**
- `__tests__/timeUtils.test.js` (existing, 22 tests)
- `__tests__/courseUtils.test.js` (existing, 16 tests)

**Extensions:**
- Add tests for edge cases (empty inputs, invalid formats)
- Add tests for cross-day time calculations

### 5.2 Component Unit Tests

**Files:**
- `__tests__/SharedDashboard.test.jsx` - Test chart data aggregation
- `__tests__/ProtectedRoute.test.jsx` - Test authentication protection

---

## Risk Handling

### Database Migration Risk
- **Mitigation:** The consolidated schema will include migration SQL for existing databases
- **Backup:** Always backup database before running schema changes

### Test Coverage Gap
- **Mitigation:** Focus on the 3 critical user flows first
- **Incremental:** Add tests gradually as features are modified

### CI Pipeline Failure
- **Mitigation:** Start with basic workflow, add complexity incrementally
- **Fallback:** Manual testing as backup during initial rollout

---

## Implementation Order

1. **Week 1:** Phase 1 (Testing Infrastructure)
2. **Week 2:** Phase 2 (Production Resilience)
3. **Week 3:** Phase 3 (Database Consolidation)
4. **Week 4:** Phase 4 (CI/CD Pipeline)
5. **Week 5:** Phase 5 (Additional Tests)

---

## Success Criteria

1. ✅ 80%+ test coverage on critical flows
2. ✅ No console.log in production builds
3. ✅ Error boundary catches and handles component errors
4. ✅ Single source of truth for database schema
5. ✅ CI pipeline runs on every push
6. ✅ All existing tests pass
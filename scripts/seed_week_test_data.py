#!/usr/bin/env python3
"""
Test data seeder for WeekReviewDashboard
Generates realistic data for THIS WEEK (Mon-Sun) covering all 7 dimensions.

Run: python3 scripts/seed_week_test_data.py
Requires: VITE_SUPABASE_SERVICE_ROLE_KEY env var
"""
import os
import sys
import json
import requests
from datetime import datetime, timedelta, time as dtime

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL", "https://rkmspodctprrwmeiteos.supabase.co")
SERVICE_KEY = os.getenv("VITE_SUPABASE_SERVICE_ROLE_KEY", "")

if not SERVICE_KEY:
    print("ERROR: Set VITE_SUPABASE_SERVICE_ROLE_KEY env var first")
    sys.exit(1)

def headers():
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

def get_jeff():
    url = f"{SUPABASE_URL}/rest/v1/profiles?select=id,full_name&full_name=ilike.*jeff*"
    r = requests.get(url, headers=headers())
    if r.status_code != 200:
        print(f"ERROR querying profiles: {r.status_code} {r.text}")
        sys.exit(1)
    rows = r.json()
    if not rows:
        print("ERROR: No student named Jeff found in profiles table")
        sys.exit(1)
    return rows[0]["id"]

def get_or_create_course(name, subject=None):
    url = f"{SUPABASE_URL}/rest/v1/courses?select=id&name=eq.{name}"
    r = requests.get(url, headers=headers())
    if r.status_code == 200 and r.json():
        return r.json()[0]["id"]

    print(f"  Creating course: {name}")
    url = f"{SUPABASE_URL}/rest/v1/courses"
    data = {"name": name, "subject": subject or name, "source": 1, "is_shared": False}
    r = requests.post(url, headers=headers(), data=json.dumps(data))
    if r.status_code in (200, 201):
        return r.json()[0]["id"]
    print(f"  ERROR creating course {name}: {r.status_code} {r.text}")
    sys.exit(1)

def delete_sessions(student_id):
    url = f"{SUPABASE_URL}/rest/v1/learning_sessions?student_id=eq.{student_id}"
    r = requests.delete(url, headers=headers())
    if r.status_code == 204:
        print("  Old sessions deleted")
    else:
        print(f"  WARNING: delete response {r.status_code}, continuing...")

def insert_sessions(sessions):
    url = f"{SUPABASE_URL}/rest/v1/learning_sessions"
    batch_size = 50
    for i in range(0, len(sessions), batch_size):
        batch = sessions[i:i+batch_size]
        r = requests.post(url, headers=headers(), data=json.dumps(batch))
        if r.status_code in (200, 201):
            print(f"  Inserted {min(i+batch_size, len(sessions))}/{len(sessions)}")
        else:
            print(f"  ERROR inserting: {r.status_code} {r.text}")
            return False
    return True

def this_week_monday():
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    dow = today.weekday()  # 0=Mon, 6=Sun
    monday = today - timedelta(days=dow)
    return monday

def build_week_data(student_id, course_ids):
    """
    Generate sessions for Mon-Sun this week.
    Design goals:
    - Mon, Tue, Thu, Fri, Sat: active days (5/7 = 71% 参与度)
    - Wed: no sessions (gap day → 参与度 signal)
    - Sun: no sessions (rest → natural gap)
    - 数学: high concentration (~45%) → 偏科 signal
    - 物理: 3 low practice scores (<70) + good habits → 反推教学环境 diagnosis
    - 英语: balanced, 自主学习 → healthy
    - 化学: moderate, mix of forms
    - 历史: low review ratio → 循环断裂 signal
    - Mix category 1/2/3 across days
    - Mix self forms vs non-self forms
    - Some sessions with score, some without (feedback density)
    """
    monday = this_week_monday()
    s = []

    def add(course, day_offset, cat, form, eval_type, score, duration, self_rating=None):
        date = monday + timedelta(days=day_offset)
        s.append({
            "student_id": student_id,
            "course_id": course_ids[course],
            "category": cat,
            "form": form,
            "eval_type": eval_type,
            "score": score,
            "self_rating": self_rating,
            "duration_minutes": duration,
            "session_date": date.strftime("%Y-%m-%d"),
        })

    # === MONDAY (day 0) ===
    # 数学 90min - heavy, concentrated
    add("数学", 0, 1, "自主学习", 2, 88, 45)
    add("数学", 0, 3, "自主练习", 2, 90, 45)
    # 物理 40min - low score
    add("物理", 0, 1, "校外线上", 2, 65, 40)
    # 英语 30min
    add("英语", 0, 1, "自主预习", 2, 82, 30)

    # === TUESDAY (day 1) ===
    # 数学 120min - very heavy
    add("数学", 1, 3, "自主练习", 2, 92, 60)
    add("数学", 1, 2, "自主复习", 1, None, 30, self_rating=60)
    add("数学", 1, 1, "自主学习", 2, 85, 30)
    # 物理 35min - low
    add("物理", 1, 3, "自主练习", 2, 62, 35)
    # 化学 40min
    add("化学", 1, 1, "校外线下", 2, 80, 40)
    # 英语 35min
    add("英语", 1, 3, "自主练习", 2, 78, 35)

    # === WEDNESDAY (day 2) - NO SESSIONS → participation gap ===

    # === THURSDAY (day 3) ===
    # 数学 75min
    add("数学", 3, 1, "自主学习", 2, 86, 40)
    add("数学", 3, 3, "校外线上", 2, 89, 35)
    # 物理 50min - still low
    add("物理", 3, 3, "自主练习", 2, 68, 50)
    # 英语 45min
    add("英语", 3, 1, "自主预习", 2, 84, 45)
    # 历史 40min - no review
    add("历史", 3, 1, "学校课堂", 2, 88, 40)

    # === FRIDAY (day 4) ===
    # 数学 100min
    add("数学", 4, 3, "自主练习", 2, 91, 50)
    add("数学", 4, 2, "自主复习", 1, None, 30, self_rating=80)
    add("数学", 4, 1, "自主学习", 2, 87, 20)
    # 化学 55min
    add("化学", 4, 3, "自主练习", 2, 83, 40)
    add("化学", 4, 1, "自主学习", 2, 81, 15)
    # 英语 30min
    add("英语", 4, 2, "自主复习", 1, None, 30, self_rating=60)

    # === SATURDAY (day 5) - weekend, heavy ===
    # 数学 150min - weekend cramming
    add("数学", 5, 1, "自主学习", 2, 93, 60)
    add("数学", 5, 3, "自主练习", 2, 95, 60)
    add("数学", 5, 2, "自主复习", 1, None, 30, self_rating=80)
    # 物理 45min - still low (3rd low score → 反推教学环境 trigger)
    add("物理", 5, 3, "自主练习", 2, 66, 45)
    # 历史 60min - still no review practice
    add("历史", 5, 3, "学校作业", 2, 90, 30)
    add("历史", 5, 1, "自主学习", 2, 92, 30)
    # 英语 40min
    add("英语", 5, 3, "自主练习", 2, 86, 40)

    # === SUNDAY (day 6) - NO SESSIONS → rest gap ===

    return s

def main():
    print("=" * 50)
    print("Week Test Data Seeder for WeekReviewDashboard")
    print("=" * 50)

    student_id = get_jeff()
    print(f"\nStudent ID (Jeff): {student_id}")

    delete_sessions(student_id)

    print("\nGetting courses...")
    courses = {
        "数学": get_or_create_course("数学"),
        "物理": get_or_create_course("物理"),
        "英语": get_or_create_course("英语"),
        "化学": get_or_create_course("化学"),
        "历史": get_or_create_course("历史"),
    }
    for name, cid in courses.items():
        print(f"  {name}: {cid}")

    sessions = build_week_data(student_id, courses)
    print(f"\nPrepared {len(sessions)} sessions for this week")

    success = insert_sessions(sessions)

    if success:
        print("\n" + "=" * 50)
        print("✅ TEST DATA SEEDED SUCCESSFULLY")
        print("=" * 50)
        print(f"Total: {len(sessions)} records")
        print("\nWeek distribution:")
        print("  Mon: 数学135', 物理40', 英语30'")
        print("  Tue: 数学120', 物理35', 化学40', 英语35'")
        print("  Wed: 休 (无记录 → 参与度信号)")
        print("  Thu: 数学75', 物理50', 英语45', 历史40'")
        print("  Fri: 数学100', 化学55', 英语30'")
        print("  Sat: 数学150', 物理45', 历史60', 英语40'")
        print("  Sun: 休 (无记录 → 参与度信号)")
        print("\nDiagnosis triggers:")
        print("  1. 偏科: 数学占比 ~45% → 偏科风险")
        print("  2. 物理3次低分 + 学习习惯良好 → 反推教学环境")
        print("  3. 历史几乎无复习 → 循环断裂")
        print("  4. 英语自主比例高 → 自主性强")
        print("  5. 5/7天活跃 → 参与度中等")
    else:
        print("\nFAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()

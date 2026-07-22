#!/usr/bin/env python3
"""
Test Data Seeding Script
Run with: python3 scripts/seed_test_data.py --key YOUR_SERVICE_ROLE_KEY
"""

import argparse
import requests
import json
from datetime import datetime, timedelta

SUPABASE_URL = "https://rkmspodctprrwmeiteos.supabase.co"
JEFF_ID = "e233e55e-9af4-4174-b254-7ae77d8309f4"

def get_headers(service_key):
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json"
    }

def delete_existing_data(service_key):
    """Delete existing learning sessions for Jeff"""
    print("Deleting existing learning records...")
    url = f"{SUPABASE_URL}/rest/v1/learning_sessions?student_id=eq.{JEFF_ID}"
    response = requests.delete(url, headers=get_headers(service_key))
    if response.status_code == 204:
        print("✓ Existing records deleted")
    else:
        print(f"⚠️ Delete response: {response.status_code}")

def get_or_create_course(service_key, course_name):
    """Get course ID or create if not exists (each course IS a subject)"""
    url = f"{SUPABASE_URL}/rest/v1/courses?name=eq.{course_name}"
    response = requests.get(url, headers=get_headers(service_key))
    
    if response.status_code == 200 and len(response.json()) > 0:
        return response.json()[0]['id']
    
    print(f"Creating course: {course_name}")
    url = f"{SUPABASE_URL}/rest/v1/courses"
    headers = get_headers(service_key)
    headers["Prefer"] = "return=representation"
    data = {
        "name": course_name,
        "subject": course_name,
        "source": 1,
        "is_shared": False
    }
    response = requests.post(url, headers=headers, data=json.dumps(data))
    
    if response.status_code in [200, 201]:
        return response.json()[0]['id']
    else:
        print(f"✗ Failed to create course: {response.status_code} - {response.text}")
        return None

def insert_sessions(service_key, sessions):
    """Insert learning sessions in batches"""
    url = f"{SUPABASE_URL}/rest/v1/learning_sessions"
    headers = get_headers(service_key)
    headers["Prefer"] = "return=representation"
    
    batch_size = 20
    for i in range(0, len(sessions), batch_size):
        batch = sessions[i:i+batch_size]
        response = requests.post(url, headers=headers, data=json.dumps(batch))
        if response.status_code in [200, 201]:
            inserted = len(response.json())
            print(f"✓ Inserted {min(i+batch_size, len(sessions))}/{len(sessions)} records")
        else:
            print(f"✗ Insert failed: {response.status_code} - {response.text}")
            return False
    return True

def generate_sessions(course_ids):
    """Generate realistic test data for Jeff - each course is a separate subject"""
    today = datetime(2024, 2, 13)
    sessions = []
    
    def add_course_sessions(course_id, data):
        for d in data:
            session_date = today - timedelta(days=d["days_ago"])
            sessions.append({
                "student_id": JEFF_ID,
                "course_id": course_id,
                "category": d["category"],
                "form": d["form"],
                "eval_type": d["eval_type"],
                "score": d["score"],
                "duration_minutes": d["duration"],
                "session_date": session_date.strftime("%Y-%m-%d"),
            })
    
    # Math: Strong, consistent scores 85-95
    math_data = [
        {"category":1,"form":"自主学习","eval_type":2,"score":85,"duration":45,"days_ago":30},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":30,"days_ago":29},
        {"category":3,"form":"自主练习","eval_type":2,"score":88,"duration":40,"days_ago":28},
        {"category":1,"form":"自主学习","eval_type":2,"score":86,"duration":50,"days_ago":25},
        {"category":3,"form":"校外线上","eval_type":2,"score":90,"duration":60,"days_ago":23},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":25,"days_ago":21},
        {"category":1,"form":"自主学习","eval_type":2,"score":87,"duration":45,"days_ago":20},
        {"category":3,"form":"自主练习","eval_type":2,"score":91,"duration":45,"days_ago":18},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":30,"days_ago":16},
        {"category":1,"form":"校外线上","eval_type":2,"score":89,"duration":60,"days_ago":14},
        {"category":1,"form":"自主学习","eval_type":2,"score":88,"duration":50,"days_ago":13},
        {"category":3,"form":"自主练习","eval_type":2,"score":93,"duration":50,"days_ago":11},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":35,"days_ago":9},
        {"category":1,"form":"校外线上","eval_type":2,"score":91,"duration":60,"days_ago":7},
        {"category":1,"form":"自主学习","eval_type":2,"score":90,"duration":50,"days_ago":6},
        {"category":3,"form":"自主练习","eval_type":2,"score":94,"duration":55,"days_ago":4},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":40,"days_ago":2},
        {"category":3,"form":"校外线上","eval_type":2,"score":95,"duration":60,"days_ago":1},
    ]
    
    # English: Improving from 72 to 84
    english_data = [
        {"category":1,"form":"自主学习","eval_type":2,"score":72,"duration":35,"days_ago":30},
        {"category":3,"form":"自主练习","eval_type":2,"score":70,"duration":30,"days_ago":28},
        {"category":1,"form":"校外线下","eval_type":2,"score":75,"duration":60,"days_ago":26},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":20,"days_ago":24},
        {"category":3,"form":"自主练习","eval_type":2,"score":73,"duration":35,"days_ago":22},
        {"category":1,"form":"自主学习","eval_type":2,"score":76,"duration":40,"days_ago":19},
        {"category":3,"form":"自主练习","eval_type":2,"score":75,"duration":35,"days_ago":17},
        {"category":1,"form":"校外线下","eval_type":2,"score":78,"duration":60,"days_ago":15},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":25,"days_ago":13},
        {"category":1,"form":"自主学习","eval_type":2,"score":79,"duration":45,"days_ago":12},
        {"category":3,"form":"自主练习","eval_type":2,"score":78,"duration":40,"days_ago":10},
        {"category":1,"form":"校外线下","eval_type":2,"score":81,"duration":60,"days_ago":8},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":30,"days_ago":6},
        {"category":1,"form":"自主学习","eval_type":2,"score":82,"duration":50,"days_ago":5},
        {"category":3,"form":"自主练习","eval_type":2,"score":80,"duration":45,"days_ago":3},
        {"category":1,"form":"校外线下","eval_type":2,"score":84,"duration":60,"days_ago":1},
    ]
    
    # Physics: Weak but improving from 62 to 76
    physics_data = [
        {"category":1,"form":"自主学习","eval_type":2,"score":62,"duration":40,"days_ago":29},
        {"category":3,"form":"自主练习","eval_type":2,"score":58,"duration":35,"days_ago":27},
        {"category":1,"form":"校外线上","eval_type":2,"score":65,"duration":60,"days_ago":25},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":25,"days_ago":23},
        {"category":3,"form":"自主练习","eval_type":2,"score":60,"duration":40,"days_ago":20},
        {"category":1,"form":"自主学习","eval_type":2,"score":64,"duration":45,"days_ago":20},
        {"category":3,"form":"自主练习","eval_type":2,"score":62,"duration":40,"days_ago":18},
        {"category":1,"form":"校外线上","eval_type":2,"score":68,"duration":60,"days_ago":16},
        {"category":3,"form":"自主练习","eval_type":2,"score":65,"duration":45,"days_ago":14},
        {"category":1,"form":"自主学习","eval_type":2,"score":67,"duration":50,"days_ago":13},
        {"category":3,"form":"自主练习","eval_type":2,"score":68,"duration":45,"days_ago":11},
        {"category":1,"form":"校外线上","eval_type":2,"score":72,"duration":60,"days_ago":9},
        {"category":3,"form":"自主练习","eval_type":2,"score":70,"duration":50,"days_ago":7},
        {"category":1,"form":"自主学习","eval_type":2,"score":71,"duration":55,"days_ago":6},
        {"category":3,"form":"自主练习","eval_type":2,"score":73,"duration":50,"days_ago":4},
        {"category":1,"form":"校外线上","eval_type":2,"score":76,"duration":60,"days_ago":2},
        {"category":3,"form":"自主练习","eval_type":2,"score":74,"duration":55,"days_ago":0},
    ]
    
    # Chemistry: Stable 78-87
    chemistry_data = [
        {"category":1,"form":"自主学习","eval_type":2,"score":78,"duration":35,"days_ago":30},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":25,"days_ago":28},
        {"category":3,"form":"自主练习","eval_type":2,"score":80,"duration":30,"days_ago":26},
        {"category":1,"form":"自主学习","eval_type":2,"score":79,"duration":40,"days_ago":24},
        {"category":3,"form":"校外线上","eval_type":2,"score":82,"duration":50,"days_ago":22},
        {"category":1,"form":"自主学习","eval_type":2,"score":80,"duration":35,"days_ago":19},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":30,"days_ago":17},
        {"category":3,"form":"自主练习","eval_type":2,"score":83,"duration":35,"days_ago":15},
        {"category":1,"form":"自主学习","eval_type":2,"score":82,"duration":40,"days_ago":12},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":35,"days_ago":10},
        {"category":3,"form":"自主练习","eval_type":2,"score":85,"duration":40,"days_ago":8},
        {"category":1,"form":"自主学习","eval_type":2,"score":84,"duration":45,"days_ago":5},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":40,"days_ago":3},
        {"category":3,"form":"自主练习","eval_type":2,"score":87,"duration":45,"days_ago":0},
    ]
    
    # History: Strong 88-94, more review time
    history_data = [
        {"category":1,"form":"自主学习","eval_type":2,"score":88,"duration":30,"days_ago":29},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":35,"days_ago":27},
        {"category":3,"form":"自主练习","eval_type":2,"score":90,"duration":25,"days_ago":25},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":30,"days_ago":23},
        {"category":1,"form":"自主学习","eval_type":2,"score":87,"duration":35,"days_ago":21},
        {"category":1,"form":"自主学习","eval_type":2,"score":89,"duration":30,"days_ago":20},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":40,"days_ago":18},
        {"category":3,"form":"自主练习","eval_type":2,"score":92,"duration":30,"days_ago":16},
        {"category":1,"form":"自主学习","eval_type":2,"score":90,"duration":35,"days_ago":13},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":45,"days_ago":11},
        {"category":3,"form":"自主练习","eval_type":2,"score":93,"duration":35,"days_ago":9},
        {"category":1,"form":"自主学习","eval_type":2,"score":91,"duration":40,"days_ago":6},
        {"category":2,"form":"自主复习","eval_type":1,"score":None,"duration":50,"days_ago":4},
        {"category":3,"form":"自主练习","eval_type":2,"score":94,"duration":40,"days_ago":2},
    ]
    
    add_course_sessions(course_ids["数学"], math_data)
    add_course_sessions(course_ids["英语"], english_data)
    add_course_sessions(course_ids["物理"], physics_data)
    add_course_sessions(course_ids["化学"], chemistry_data)
    add_course_sessions(course_ids["历史"], history_data)
    
    return sessions

def main():
    parser = argparse.ArgumentParser(description="Seed test data for Jeff's learning sessions")
    parser.add_argument("--key", required=True, help="Supabase Service Role Key")
    args = parser.parse_args()
    
    print("=" * 50)
    print("SEEDING TEST DATA")
    print("=" * 50)
    
    delete_existing_data(args.key)
    
    print("\nGetting/Creating courses (each course = subject)...")
    course_names = ["数学", "英语", "物理", "化学", "历史"]
    course_ids = {name: get_or_create_course(args.key, name) for name in course_names}
    
    print("\nCourse IDs:")
    for name, cid in course_ids.items():
        print(f"  {name}: {cid}")
    
    if None in course_ids.values():
        print("\n✗ Failed to create some courses")
        exit(1)
    
    sessions = generate_sessions(course_ids)
    print(f"\nPreparing {len(sessions)} learning sessions...")
    
    success = insert_sessions(args.key, sessions)
    
    if success:
        print("\n" + "=" * 50)
        print("✅ TEST DATA SEEDING COMPLETE")
        print("=" * 50)
        print(f"Total records inserted: {len(sessions)}")
        print("\nCourse breakdown:")
        counts = {"数学": 18, "英语": 16, "物理": 17, "化学": 14, "历史": 14}
        for name, cnt in counts.items():
            print(f"  {name}: {cnt} sessions")
    else:
        print("\n" + "=" * 50)
        print("✗ TEST DATA SEEDING FAILED")
        print("=" * 50)
        exit(1)

if __name__ == "__main__":
    main()

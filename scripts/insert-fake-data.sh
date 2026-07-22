#!/bin/bash

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "错误: 请设置 SUPABASE_SERVICE_ROLE_KEY 环境变量"
  echo "您可以从 Supabase 控制台的 API 设置中获取 Service Role Key"
  exit 1
fi

SUPABASE_URL="https://rkmspodctprrwmeiteos.supabase.co"
JEFF_ID="e233e55e-9af4-4174-b254-7ae77d8309f4"

echo "=== 插入假数据开始 ==="

# 使用 supabase CLI 或直接调用 API 插入数据
# 这里使用 curl 调用 Supabase REST API

echo "删除现有学习记录..."
curl -X DELETE "$SUPABASE_URL/rest/v1/learning_sessions?student_id=eq.$JEFF_ID" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"

echo ""
echo "插入数学学习记录..."

MATH_DATA='[
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"自主学习","eval_type":2,"score":85,"duration_minutes":45,"session_date":"2024-01-15"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":30,"session_date":"2024-01-16"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":3,"form":"自主练习","eval_type":2,"score":88,"duration_minutes":40,"session_date":"2024-01-17"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"自主学习","eval_type":2,"score":86,"duration_minutes":50,"session_date":"2024-01-20"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":3,"form":"校外线上","eval_type":2,"score":90,"duration_minutes":60,"session_date":"2024-01-22"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":25,"session_date":"2024-01-24"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"自主学习","eval_type":2,"score":87,"duration_minutes":45,"session_date":"2024-01-25"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":3,"form":"自主练习","eval_type":2,"score":91,"duration_minutes":45,"session_date":"2024-01-27"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":30,"session_date":"2024-01-29"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"校外线上","eval_type":2,"score":89,"duration_minutes":60,"session_date":"2024-01-31"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"自主学习","eval_type":2,"score":88,"duration_minutes":50,"session_date":"2024-02-01"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":3,"form":"自主练习","eval_type":2,"score":93,"duration_minutes":50,"session_date":"2024-02-03"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":35,"session_date":"2024-02-05"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"校外线上","eval_type":2,"score":91,"duration_minutes":60,"session_date":"2024-02-07"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":1,"form":"自主学习","eval_type":2,"score":90,"duration_minutes":50,"session_date":"2024-02-08"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":3,"form":"自主练习","eval_type":2,"score":94,"duration_minutes":55,"session_date":"2024-02-10"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":40,"session_date":"2024-02-12"},
  {"student_id":"'"$JEFF_ID"'","course":"数学","category":3,"form":"校外线上","eval_type":2,"score":95,"duration_minutes":60,"session_date":"2024-02-13"}
]'

curl -X POST "$SUPABASE_URL/rest/v1/learning_sessions" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$MATH_DATA"

echo ""
echo "插入英语学习记录..."

ENGLISH_DATA='[
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"自主学习","eval_type":2,"score":72,"duration_minutes":35,"session_date":"2024-01-15"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":3,"form":"自主练习","eval_type":2,"score":70,"duration_minutes":30,"session_date":"2024-01-17"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"校外线下","eval_type":2,"score":75,"duration_minutes":60,"session_date":"2024-01-19"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":20,"session_date":"2024-01-21"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":3,"form":"自主练习","eval_type":2,"score":73,"duration_minutes":35,"session_date":"2024-01-23"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"自主学习","eval_type":2,"score":76,"duration_minutes":40,"session_date":"2024-01-26"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":3,"form":"自主练习","eval_type":2,"score":75,"duration_minutes":35,"session_date":"2024-01-28"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"校外线下","eval_type":2,"score":78,"duration_minutes":60,"session_date":"2024-01-30"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":25,"session_date":"2024-02-01"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"自主学习","eval_type":2,"score":79,"duration_minutes":45,"session_date":"2024-02-02"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":3,"form":"自主练习","eval_type":2,"score":78,"duration_minutes":40,"session_date":"2024-02-04"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"校外线下","eval_type":2,"score":81,"duration_minutes":60,"session_date":"2024-02-06"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":30,"session_date":"2024-02-08"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"自主学习","eval_type":2,"score":82,"duration_minutes":50,"session_date":"2024-02-09"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":3,"form":"自主练习","eval_type":2,"score":80,"duration_minutes":45,"session_date":"2024-02-11"},
  {"student_id":"'"$JEFF_ID"'","course":"英语","category":1,"form":"校外线下","eval_type":2,"score":84,"duration_minutes":60,"session_date":"2024-02-13"}
]'

curl -X POST "$SUPABASE_URL/rest/v1/learning_sessions" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$ENGLISH_DATA"

echo ""
echo "插入物理学习记录..."

PHYSICS_DATA='[
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"自主学习","eval_type":2,"score":62,"duration_minutes":40,"session_date":"2024-01-16"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":58,"duration_minutes":35,"session_date":"2024-01-18"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"校外线上","eval_type":2,"score":65,"duration_minutes":60,"session_date":"2024-01-20"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":25,"session_date":"2024-01-22"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":60,"duration_minutes":40,"session_date":"2024-01-25"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"自主学习","eval_type":2,"score":64,"duration_minutes":45,"session_date":"2024-01-25"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":62,"duration_minutes":40,"session_date":"2024-01-27"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"校外线上","eval_type":2,"score":68,"duration_minutes":60,"session_date":"2024-01-29"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":65,"duration_minutes":45,"session_date":"2024-01-31"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"自主学习","eval_type":2,"score":67,"duration_minutes":50,"session_date":"2024-02-01"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":68,"duration_minutes":45,"session_date":"2024-02-03"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"校外线上","eval_type":2,"score":72,"duration_minutes":60,"session_date":"2024-02-05"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":70,"duration_minutes":50,"session_date":"2024-02-07"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"自主学习","eval_type":2,"score":71,"duration_minutes":55,"session_date":"2024-02-08"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":73,"duration_minutes":50,"session_date":"2024-02-10"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":1,"form":"校外线上","eval_type":2,"score":76,"duration_minutes":60,"session_date":"2024-02-12"},
  {"student_id":"'"$JEFF_ID"'","course":"物理","category":3,"form":"自主练习","eval_type":2,"score":74,"duration_minutes":55,"session_date":"2024-02-13"}
]'

curl -X POST "$SUPABASE_URL/rest/v1/learning_sessions" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$PHYSICS_DATA"

echo ""
echo "插入化学学习记录..."

CHEMISTRY_DATA='[
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":1,"form":"自主学习","eval_type":2,"score":78,"duration_minutes":35,"session_date":"2024-01-15"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":25,"session_date":"2024-01-17"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":3,"form":"自主练习","eval_type":2,"score":80,"duration_minutes":30,"session_date":"2024-01-19"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":1,"form":"自主学习","eval_type":2,"score":79,"duration_minutes":40,"session_date":"2024-01-21"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":3,"form":"校外线上","eval_type":2,"score":82,"duration_minutes":50,"session_date":"2024-01-23"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":1,"form":"自主学习","eval_type":2,"score":80,"duration_minutes":35,"session_date":"2024-01-26"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":30,"session_date":"2024-01-28"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":3,"form":"自主练习","eval_type":2,"score":83,"duration_minutes":35,"session_date":"2024-01-30"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":1,"form":"自主学习","eval_type":2,"score":82,"duration_minutes":40,"session_date":"2024-02-02"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":35,"session_date":"2024-02-04"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":3,"form":"自主练习","eval_type":2,"score":85,"duration_minutes":40,"session_date":"2024-02-06"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":1,"form":"自主学习","eval_type":2,"score":84,"duration_minutes":45,"session_date":"2024-02-09"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":40,"session_date":"2024-02-11"},
  {"student_id":"'"$JEFF_ID"'","course":"化学","category":3,"form":"自主练习","eval_type":2,"score":87,"duration_minutes":45,"session_date":"2024-02-13"}
]'

curl -X POST "$SUPABASE_URL/rest/v1/learning_sessions" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$CHEMISTRY_DATA"

echo ""
echo "插入历史学习记录..."

HISTORY_DATA='[
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":1,"form":"自主学习","eval_type":2,"score":88,"duration_minutes":30,"session_date":"2024-01-16"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":35,"session_date":"2024-01-18"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":3,"form":"自主练习","eval_type":2,"score":90,"duration_minutes":25,"session_date":"2024-01-20"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":30,"session_date":"2024-01-22"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":1,"form":"自主学习","eval_type":2,"score":87,"duration_minutes":35,"session_date":"2024-01-24"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":1,"form":"自主学习","eval_type":2,"score":89,"duration_minutes":30,"session_date":"2024-01-25"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":40,"session_date":"2024-01-27"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":3,"form":"自主练习","eval_type":2,"score":92,"duration_minutes":30,"session_date":"2024-01-29"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":1,"form":"自主学习","eval_type":2,"score":90,"duration_minutes":35,"session_date":"2024-02-01"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":45,"session_date":"2024-02-03"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":3,"form":"自主练习","eval_type":2,"score":93,"duration_minutes":35,"session_date":"2024-02-05"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":1,"form":"自主学习","eval_type":2,"score":91,"duration_minutes":40,"session_date":"2024-02-08"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":2,"form":"自主复习","eval_type":1,"score":null,"duration_minutes":50,"session_date":"2024-02-10"},
  {"student_id":"'"$JEFF_ID"'","course":"历史","category":3,"form":"自主练习","eval_type":2,"score":94,"duration_minutes":40,"session_date":"2024-02-12"}
]'

curl -X POST "$SUPABASE_URL/rest/v1/learning_sessions" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$HISTORY_DATA"

echo ""
echo "=== 假数据插入完成 ==="
echo "共插入 80 条学习记录"

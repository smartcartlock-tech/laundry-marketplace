#!/usr/bin/env bash
# QA חי מול פרודקשן: בדיקות קריאה + הזמנת דמו שמבוטלת מיד. שימוש: BASE=https://... ./scripts/qa-live.sh
set -u
BASE="${BASE:-https://laundry-marketplace-ay5h.onrender.com}"
fail=0
check() { # name url expect_substr
  local out
  out=$(curl -s -m 30 "$2")
  if echo "$out" | grep -q "$3"; then echo "PASS: $1"; else echo "FAIL: $1 -> $(echo "$out" | head -c 200)"; fail=1; fi
}
check "health" "$BASE/health" '"ok":true'
check "laundries list" "$BASE/api/laundries" '"slug":"achuza"'
check "laundry page" "$BASE/api/laundries/achuza" '"name":"מכבסת האחוזה"'
check "PWA html" "$BASE/" 'מכבסה'
check "manifest" "$BASE/manifest.webmanifest" 'name'
check "config exposes mode" "$BASE/api/config" '"mode":'

# OTP דמו -> הזמנת דמו -> ביטול (זרימת כתיבה מלאה ללא שאריות)
CODE=$(curl -s -m 30 -X POST "$BASE/api/auth/otp/request" -H 'content-type: application/json' -d '{"target":"+972500000002"}' | python3 -c "import json,sys;print(json.load(sys.stdin).get('demoCode',''))")
if [ -z "$CODE" ]; then echo "FAIL: otp request"; exit 1; fi
TOKEN=$(curl -s -m 30 -X POST "$BASE/api/auth/otp/verify" -H 'content-type: application/json' -d "{\"target\":\"+972500000002\",\"code\":\"$CODE\"}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('token',''))")
if [ -z "$TOKEN" ]; then echo "FAIL: otp verify"; exit 1; fi
echo "PASS: demo OTP login"
ITEM=$(curl -s -m 30 "$BASE/api/laundries/achuza" | python3 -c "import json,sys;d=json.load(sys.stdin);print([i['id'] for i in d['items'] if 'שק' in i['name']][0])")
ORDER=$(curl -s -m 30 -X POST "$BASE/api/orders" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"slug\":\"achuza\",\"items\":[{\"item_id\":\"$ITEM\",\"qty\":3}],\"address\":\"בדיקת QA — מבוטלת\"}")
OID=$(echo "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin).get('order',{}).get('id',''))")
if [ -z "$OID" ]; then echo "FAIL: create order -> $(echo "$ORDER" | head -c 200)"; exit 1; fi
echo "PASS: create demo order $OID"
CANCEL=$(curl -s -m 30 -X POST "$BASE/api/orders/$OID/cancel" -H "authorization: Bearer $TOKEN")
echo "$CANCEL" | grep -q '"ok":true' && echo "PASS: cancel demo order" || { echo "FAIL: cancel -> $CANCEL"; fail=1; }
# QA-flow: ביטול חוזר של אותה הזמנה חייב להידחות ב-409 (מניעת החזרי נקודות/מכסה כפולים)
CODE2=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST "$BASE/api/orders/$OID/cancel" -H "authorization: Bearer $TOKEN")
[ "$CODE2" = "409" ] && echo "PASS: double-cancel rejected 409" || { echo "FAIL: double-cancel -> $CODE2"; fail=1; }
# G3: עמוד נחיתה ממותג + מעקב ציבורי
check "branded landing" "$BASE/b/achuza" 'property="og:title"'
TRC=$(curl -s -m 30 "$BASE/api/orders/$OID" -H "authorization: Bearer $TOKEN" | python3 -c "import json,sys;print(json.load(sys.stdin).get('order',{}).get('tracking_code',''))")
if [ -n "$TRC" ]; then check "public order tracking" "$BASE/api/track/$TRC" '"status":"cancelled"'; else echo "FAIL: no tracking_code on order"; fail=1; fi
[ $fail -eq 0 ] && echo "QA LIVE: ALL PASS" || echo "QA LIVE: FAILURES"
exit $fail

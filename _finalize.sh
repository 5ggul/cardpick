#!/bin/bash
TOKEN=$(awk -F': ' '/^cloudeflare api/ {print $2}' "C:\Users\dhkim\Documents\클코\TCG\config.txt" | tr -d '\r\n ')
ZONE_ID="99abbcdc20a6c9b60187f0cb4dbb36c5"
PAGES_TARGET="cardpick-gr0.pages.dev"

while true; do
  STATUS=$(curl -sS "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
    -H "Authorization: Bearer $TOKEN" \
    | python -c "import sys,json; print(json.load(sys.stdin)['result']['status'])")
  TS=$(date '+%H:%M:%S')
  echo "$TS zone=$STATUS"
  if [ "$STATUS" = "active" ]; then
    echo "$TS zone ACTIVE — adding DNS records"
    R1=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"@\",\"content\":\"$PAGES_TARGET\",\"proxied\":true,\"ttl\":1}")
    R2=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --data "{\"type\":\"CNAME\",\"name\":\"www\",\"content\":\"$PAGES_TARGET\",\"proxied\":true,\"ttl\":1}")
    echo "DNS_DONE root:$(echo $R1 | python -c "import sys,json; r=json.load(sys.stdin); print('OK' if r.get('success') else 'FAIL')") www:$(echo $R2 | python -c "import sys,json; r=json.load(sys.stdin); print('OK' if r.get('success') else 'FAIL')")"
    break
  fi
  sleep 60
done

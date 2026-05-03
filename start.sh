#!/bin/bash
cd /Users/hwacu/Downloads/claude-proxy

# 이미 실행 중이면 종료
PID=$(lsof -nP -i TCP:8080 -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$PID" ]; then
  echo "기존 서버 종료 (PID: $PID)"
  kill "$PID" 2>/dev/null
  sleep 1
fi

HOST="${CLAUDE_PROXY_HOST:-127.0.0.1}"
nohup .venv/bin/python -m uvicorn backend.app:app --host "$HOST" --port 8080 > /tmp/claude-proxy.log 2>&1 &
echo "서버 시작 (PID: $!, 포트: 8080, 호스트: $HOST)"
echo "로그: tail -f /tmp/claude-proxy.log"
echo "종료: kill $!"

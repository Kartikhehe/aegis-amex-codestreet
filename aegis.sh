#!/usr/bin/env bash
#
# AEGIS control script.
#
#   ./aegis.sh start     start backend + both frontends
#   ./aegis.sh stop      stop everything
#   ./aegis.sh restart   stop then start
#   ./aegis.sh status    what is running, and is it healthy
#   ./aegis.sh logs      tail all three logs
#   ./aegis.sh doctor    diagnose "why is the backend erroring?"
#   ./aegis.sh test      backend unit tests + end-to-end verification
#   ./aegis.sh seed      rebuild the database from scratch (destructive)
#
# Ports:  8000 API   5002 console   5003 member app
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

API_PORT=8000
CONSOLE_PORT=5002
MEMBER_PORT=5003

# The demo database, as an ABSOLUTE path. A relative sqlite URL resolves
# against the working directory, so it silently points at a different (usually
# empty) file depending on where you launched from.
export DATABASE_URL="${DATABASE_URL:-sqlite:///$ROOT/services/aegis/dev.db}"
# Enables /demo/tamper so the ledger tamper-evidence can be demonstrated.
# MUST stay false in production.
export AEGIS_ENABLE_DEMO="${AEGIS_ENABLE_DEMO:-true}"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
dim()   { printf "\033[2m%s\033[0m\n" "$1"; }

port_pid() { lsof -ti:"$1" 2>/dev/null | head -1; }

wait_for() { # url, seconds
  local url="$1" limit="${2:-40}" i=0
  while [ "$i" -lt "$limit" ]; do
    curl -sf -o /dev/null "$url" 2>/dev/null && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

start_api() {
  if [ -n "$(port_pid $API_PORT)" ]; then dim "  api      already running on :$API_PORT"; return; fi
  ( cd "$ROOT/services/aegis" && \
    nohup .venv/bin/python -m uvicorn aegis.main:app \
      --host 127.0.0.1 --port $API_PORT > "$LOGS/api.log" 2>&1 & )
  if wait_for "http://localhost:$API_PORT/health" 40; then
    green "  api      http://localhost:$API_PORT       (docs at /docs)"
  else
    red   "  api      FAILED to start -- see .logs/api.log"
  fi
}

start_console() {
  if [ -n "$(port_pid $CONSOLE_PORT)" ]; then dim "  console  already running on :$CONSOLE_PORT"; return; fi
  ( cd "$ROOT/apps/console" && nohup npm run dev > "$LOGS/console.log" 2>&1 & )
  if wait_for "http://localhost:$CONSOLE_PORT/" 60; then
    green "  console  http://localhost:$CONSOLE_PORT"
  else
    red   "  console  FAILED to start -- see .logs/console.log"
  fi
}

start_member() {
  if [ -n "$(port_pid $MEMBER_PORT)" ]; then dim "  member   already running on :$MEMBER_PORT"; return; fi
  ( cd "$ROOT/apps/member" && nohup npm run dev > "$LOGS/member.log" 2>&1 & )
  if wait_for "http://localhost:$MEMBER_PORT/" 60; then
    green "  member   http://localhost:$MEMBER_PORT"
  else
    red   "  member   FAILED to start -- see .logs/member.log"
  fi
}

stop_all() {
  echo "Stopping AEGIS…"
  for port in $API_PORT $CONSOLE_PORT $MEMBER_PORT; do
    pids=$(lsof -ti:"$port" 2>/dev/null)
    [ -z "$pids" ] && continue

    echo "$pids" | xargs kill 2>/dev/null
    # Poll until the port is genuinely free. Uvicorn and vite can hold a
    # listening socket for a moment after SIGTERM, and a start() that races
    # that window leaves a second process bound to the same port -- which is
    # how two servers ended up on :8000 with different DATABASE_URLs.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.5
      [ -z "$(lsof -ti:"$port" 2>/dev/null)" ] && break
    done

    remaining=$(lsof -ti:"$port" 2>/dev/null)
    if [ -n "$remaining" ]; then
      echo "$remaining" | xargs kill -9 2>/dev/null
      sleep 1
    fi

    if [ -z "$(lsof -ti:"$port" 2>/dev/null)" ]; then
      dim "  freed :$port"
    else
      red "  :$port STILL IN USE by pid(s) $(lsof -ti:"$port" | tr '\n' ' ')"
    fi
  done
  green "Stopped."
}

status() {
  echo "AEGIS status"
  echo
  for entry in "api:$API_PORT:/health" "console:$CONSOLE_PORT:/" "member:$MEMBER_PORT:/"; do
    name="${entry%%:*}"; rest="${entry#*:}"; port="${rest%%:*}"; path="${rest#*:}"
    pid=$(port_pid "$port")
    if [ -n "$pid" ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port$path" 2>/dev/null)
      if [ "$code" = "200" ]; then
        green "  $(printf '%-8s' "$name") up    :$port  (pid $pid)"
      else
        red   "  $(printf '%-8s' "$name") up    :$port  (pid $pid) but HTTP $code"
      fi
    else
      dim   "  $(printf '%-8s' "$name") down  :$port"
    fi
  done
  echo
  if [ -f "$ROOT/services/aegis/dev.db" ]; then
    dim "  database  services/aegis/dev.db ($(du -h "$ROOT/services/aegis/dev.db" | cut -f1))"
  else
    red "  database  MISSING -- run ./aegis.sh seed"
  fi
}

case "${1:-status}" in
  start)
    echo "Starting AEGIS…"
    start_api; start_console; start_member
    echo
    dim "  sign in with operator@aegis.test / password123"
    ;;
  stop)    stop_all ;;
  restart) stop_all; sleep 2; echo; "$0" start ;;
  status)  status ;;
  logs)    tail -f "$LOGS"/*.log ;;
  doctor)
    echo "AEGIS doctor"
    echo
    echo "  shell DATABASE_URL : ${DATABASE_URL}"
    echo
    if [ -f "$ROOT/services/aegis/dev.db" ]; then
      green "  demo database      present ($(du -h "$ROOT/services/aegis/dev.db" | cut -f1))"
    else
      red   "  demo database      MISSING -- run ./aegis.sh seed"
    fi
    echo
    echo "  processes on :$API_PORT"
    pids=$(lsof -ti:$API_PORT 2>/dev/null)
    if [ -z "$pids" ]; then
      dim "    none"
    else
      for pid in $pids; do
        url=$(ps eww -p "$pid" 2>/dev/null | tr ' ' '\n' | grep '^DATABASE_URL=' | head -1)
        started=$(ps -p "$pid" -o lstart= 2>/dev/null)
        echo "    pid $pid  started$started"
        if [ -z "$url" ]; then
          dim "      DATABASE_URL unset -> falls back to the config default (SQLite)"
        elif echo "$url" | grep -q postgres; then
          red "      $url"
          red "      ^ points at Postgres. If you did not start Postgres, unset it:"
          red "        unset DATABASE_URL && ./aegis.sh restart"
        else
          green "      $url"
        fi
      done
    fi
    echo
    echo "  live check"
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$API_PORT/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"operator@aegis.test","password":"password123"}' 2>/dev/null)
    if [ "$code" = "200" ]; then
      green "    login  200  -- the backend is healthy"
    elif [ "$code" = "500" ]; then
      red   "    login  500  -- the backend cannot reach its database"
      red   "                 check .logs/api.log, then: unset DATABASE_URL && ./aegis.sh restart"
    elif [ "$code" = "000" ]; then
      red   "    no response -- the backend is not running (./aegis.sh start)"
    else
      red   "    login  $code"
    fi
    ;;
  test)
    echo "Backend unit tests"
    ( cd "$ROOT/services/aegis" && .venv/bin/python -m pytest tests/ -q ) || exit 1
    echo
    echo "End-to-end verification (needs the API running)"
    python3 "$ROOT/verify.py"
    ;;
  seed)
    echo "This DELETES services/aegis/dev.db and regenerates 25,000 decisions."
    read -r -p "Continue? [y/N] " reply
    case "$reply" in
      [yY]*)
        stop_all
        ( cd "$ROOT/services/aegis" && rm -f dev.db && \
          .venv/bin/python -m aegis.seed.run --actions 25000 )
        green "Seeded. Run ./aegis.sh start"
        ;;
      *) echo "Cancelled." ;;
    esac
    ;;
  *)
    sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
esac

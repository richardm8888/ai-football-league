#!/usr/bin/env bash
# Runs a throwaway PostgreSQL cluster for development and tests.
#
# This exists so the app and its tests can run on machines that have the
# PostgreSQL binaries but no Docker daemon. For normal local development use
# `docker compose up -d db` instead. Both expose the same credentials; only the
# port differs (compose uses 5432, this script uses 5433).
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
PGDATA="${PGDATA:-/var/tmp/aifl-pgdata}"
PGPORT="${PGPORT:-5433}"
DBUSER="${DBUSER:-aifl}"
DBPASS="${DBPASS:-aifl}"

# initdb refuses to run as root, so when invoked as root we drop to an
# unprivileged account that owns the data directory.
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="${PG_RUNAS_USER:-postgres}"
  mkdir -p "$PGDATA"
  chown -R "$RUNAS" "$PGDATA"
  touch "${PGDATA}.initpw"
  chown "$RUNAS" "${PGDATA}.initpw"
fi

as_pg() {
  if [ -n "$RUNAS" ]; then
    setpriv --reuid "$RUNAS" --regid "$RUNAS" --init-groups env PATH="$PATH" "$@"
  else
    "$@"
  fi
}

start() {
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    local pwfile="${PGDATA}.initpw"
    as_pg bash -c "umask 077; printf '%s' '$DBPASS' > '$pwfile'"
    as_pg "$PGBIN/initdb" -D "$PGDATA" -U "$DBUSER" --auth=trust --pwfile="$pwfile" >/dev/null
    as_pg rm -f "$pwfile"
  fi
  if as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    echo "postgres already running on 127.0.0.1:$PGPORT"
  else
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" \
      -o "-p $PGPORT -k $PGDATA -c listen_addresses=127.0.0.1" \
      -l "$PGDATA/server.log" -w start >/dev/null
    echo "postgres started on 127.0.0.1:$PGPORT"
  fi
  for db in aifl aifl_test; do
    as_pg "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U "$DBUSER" "$db" 2>/dev/null || true
  done
  echo "databases ready: aifl, aifl_test"
}

stop() {
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
  echo "postgres stopped"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  *) echo "usage: $0 {start|stop|restart}" >&2; exit 1 ;;
esac

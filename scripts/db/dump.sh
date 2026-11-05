#!/usr/bin/env bash
# Logical dump of the Rumi database (run it nightly). No secrets in this file: the connection comes from the environment.
#
#   SUPABASE_DB_URL  Postgres connection string of the database to dump WITHOUT a password
#                    (postgresql://postgres.<ref>@<host>:5432/postgres), plus the password in PGPASSWORD.
#                    The password is never put on a command line (argv is visible to every process on the machine);
#                    a URL that contains one is refused. READ-ONLY use: pg_dump never writes.
#                    If SUPABASE_DB_URL is unset, the LOCAL stack (npx supabase start) is dumped.
#   DUMP_DIR         where files go (default ../rumi-db-backups, outside the repo)
#   DUMP_KEEP        how many dumps to keep (default 14)
#   AGE_RECIPIENT    optional age public key (age1...): every file is encrypted to it and the plain file is removed.
#                    If it is set and `age` is not installed the script FAILS (it never silently writes plain files).
#
# Files per run, then a checksum list (all mode 600, directory 700):
#   schema-<UTC>.sql.gz  public schema (tables, policies, functions)
#   data-<UTC>.sql.gz    data of public AND auth (users are the identity: without auth.users the data has no owners).
#                        Token tables are NOT dumped (auth.refresh_tokens, sessions, one_time_tokens, flow_state, audit_log_entries,
#                        mfa_*): a restored dump must not revive a session or a one-time link.
#   roles-<UTC>.sql.gz   cluster roles
#
# RETENTION AND ERASURE. A dump holds user content (plans, practice text, recaps) and identities. Rumi promises that
# "Delete everything" and account deletion erase a person's data. A dump taken before that deletion still contains the
# person, so: keep dumps no longer than DUMP_KEEP days, keep them in PRIVATE encrypted storage, and after restoring an
# old dump re-run the deletions made since (restoring an old dump RESURRECTS deleted users and their data).
#
# Restore procedure and drill: scripts/db/restore-drill.sh.
# Schedule: a GitHub Actions cron or any host cron, e.g. `17 4 * * * SUPABASE_DB_URL=... PGPASSWORD=... scripts/db/dump.sh`.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
dir="${DUMP_DIR:-../rumi-db-backups}"; keep="${DUMP_KEEP:-14}"
[[ "$keep" =~ ^[0-9]+$ ]] && [ "$keep" -ge 1 ] || { echo "DUMP_KEEP must be a positive integer" >&2; exit 2; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"; chmod 700 "$dir"

if [ -n "${AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null 2>&1 || { echo "AGE_RECIPIENT is set but 'age' is not installed: refusing to write unencrypted dumps" >&2; exit 3; }
fi

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  if [[ "$SUPABASE_DB_URL" =~ ://[^/@]*:[^/@]*@ ]]; then
    echo "SUPABASE_DB_URL contains a password. Remove it from the URL and pass it as PGPASSWORD (never on a command line)." >&2; exit 4
  fi
  [ -n "${PGPASSWORD:-}" ] || { echo "PGPASSWORD is required with SUPABASE_DB_URL" >&2; exit 4; }
  target=("--remote=$SUPABASE_DB_URL")
else
  target=(--local)
fi

# Only users, identities and instances are dumped from auth. Every other auth table (sessions, tokens, one-time links,
# MFA secrets and challenges, OAuth and SAML state, SCIM tokens, audit log) stays out: a restored dump must not revive a
# session or a one-time link. GoTrue adds tables over time, so after the dump the COPY list is CHECKED against the allowlist
# and the script fails (and deletes the data file) if an unexpected auth table slipped in: add it to $exclude.
exclude="auth.refresh_tokens,auth.sessions,auth.one_time_tokens,auth.flow_state,auth.audit_log_entries,auth.mfa_amr_claims,auth.mfa_challenges,auth.mfa_factors,auth.mfa_recovery_code_sets,auth.mfa_recovery_codes,auth.oauth_authorizations,auth.oauth_client_states,auth.oauth_clients,auth.oauth_consents,auth.webauthn_challenges,auth.webauthn_credentials,auth.scim_tokens,auth.scim_users,auth.saml_providers,auth.saml_relay_states,auth.sso_domains,auth.sso_providers,auth.custom_oauth_providers"

check_auth_tables() { # check_auth_tables <plain data file>: nothing but the allowlisted auth tables may be in it
  local bad
  bad="$(grep -oE '^COPY "auth"\."[a-z_]+"' "$1" | sed -E 's/.*"\."//; s/"$//' | sort -u | grep -vxE 'users|identities|instances' | paste -sd' ' - || true)"
  if [ -n "$bad" ]; then
    rm -f "$1"; echo "unexpected auth tables in the data dump: $bad- add them to \$exclude in dump.sh. Nothing was kept." >&2; exit 5
  fi
}
finish() { # finish <file>: compress, optionally encrypt, lock down
  local f="$1"
  [ -s "$f" ] || { echo "dump $f is empty" >&2; exit 1; }
  gzip -f "$f"
  if [ -n "${AGE_RECIPIENT:-}" ]; then
    age -r "$AGE_RECIPIENT" -o "$f.gz.age" "$f.gz" && rm -f "$f.gz"
    chmod 600 "$f.gz.age"
  else
    chmod 600 "$f.gz"
  fi
}
dump() { # dump <name> <supabase db dump args...>
  local name="$1"; shift
  npx supabase db dump "${target[@]}" "$@" -f "$dir/$name-$stamp.sql" >/dev/null
  if [ "$name" = data ]; then check_auth_tables "$dir/$name-$stamp.sql"; fi
  finish "$dir/$name-$stamp.sql"
}
dump schema -s public
dump data --data-only --use-copy -s public,auth -x "$exclude"
dump roles --role-only
( cd "$dir" && sha256sum ./*-"$stamp".sql.gz* > "sha256-$stamp.txt" && chmod 600 "sha256-$stamp.txt" )

# keep the newest $keep runs
ls -1 "$dir"/schema-*.sql.gz* 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  s="$(basename "$old" | sed -E 's/^schema-([0-9TZ]+)\.sql\.gz.*/\1/')"
  rm -f "$dir"/schema-"$s".sql.gz* "$dir"/data-"$s".sql.gz* "$dir"/roles-"$s".sql.gz* "$dir"/sha256-"$s".txt
done
echo "dump ok: $dir/*-$stamp.sql.gz*"

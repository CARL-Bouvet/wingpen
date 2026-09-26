#!/usr/bin/env bash
# Sibling of fake-claude-not-logged-in.sh: same shape, but a `result.result`
# text that names nothing about login/auth — proves a genuine (non-auth)
# CLI failure still gets its own reason surfaced instead of being swallowed.
# See that file's comments for why stdin is drained to EOF before exiting.
#
# Fast exit for probeAuthFailure()'s `claude auth status` call (checkStatus):
# this fixture's own test DOES exercise the probe (the result text below
# isn't an auth phrase), so without this fast path the test would block for
# AUTH_STATUS_TIMEOUT_MS waiting for a stdin close that never comes (nothing
# writes to or ends this subprocess's stdin — see providers/claude-cli.ts's
# checkStatus/execFile call, which doesn't pipe anything in).
if [ "$1" = "auth" ] || [ "$1" = "-p" ]; then
  exit 1
fi

cat <<'JSON'
{"type":"result","subtype":"success","is_error":true,"result":"Internal crash: unexpected token in config","session_id":"fixture-session","duration_ms":1,"usage":{"input_tokens":0,"output_tokens":0}}
JSON
cat >/dev/null
exit 1

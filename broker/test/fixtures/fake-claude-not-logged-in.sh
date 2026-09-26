#!/usr/bin/env bash
# Fixture for test/claude-cli-real-process.test.ts. Reproduces — verbatim in
# shape — what the real `claude` CLI (2.1.281) wrote on stdout for a
# deterministic "not logged in" failure, measured 2026-09-26 by running it
# with an empty CLAUDE_CONFIG_DIR and no ANTHROPIC_API_KEY/
# CLAUDE_CODE_OAUTH_TOKEN: stream-json lines on stdout, an assistant message
# and a `result` message both carrying the real reason ("Not logged in ·
# Please run /login"), is_error: true, then exit 1. This is what proved the
# SDK's ProcessTransport.readMessages() yields that `result` message BEFORE
# it throws the generic "process exited with code 1" from waitForExit() —
# see providers/claude-cli.ts's cliReasonText.
# Fast exit for probeAuthFailure()'s own `claude auth status`/`claude -p
# ping` calls (checkStatus) — real args are "auth status"/"-p ping", never
# the SDK's own long option list. Not exercised by this fixture's own test
# (looksLikeAuthFailure already matches the captured reason below, so the
# probe never even runs — see model.test.ts), but kept for symmetry with
# fake-claude-generic-error.sh, which DOES need this.
if [ "$1" = "auth" ] || [ "$1" = "-p" ]; then
  exit 1
fi

cat <<'JSON'
{"type":"assistant","message":{"id":"fixture","model":"<synthetic>","role":"assistant","stop_reason":"stop_sequence","content":[{"type":"text","text":"Not logged in · Please run /login"}]},"session_id":"fixture-session","uuid":"fixture-uuid","error":"authentication_failed","is_api_error_message":true}
{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","session_id":"fixture-session","duration_ms":1,"usage":{"input_tokens":0,"output_tokens":0}}
JSON
# The SDK only closes our stdin (transport.endInput(), a plain stdin.end())
# once it has read the `result` message printed above from OUR stdout — see
# Query.readMessages in the SDK. Exiting before that arrives would race its
# stdin.end() call and crash the parent Node/Bun process with an unhandled
# EPIPE (measured while writing this fixture). Blocking here until stdin
# actually closes (EOF) makes the ordering exact, no sleep/race needed.
cat >/dev/null
exit 1

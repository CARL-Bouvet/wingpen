#!/usr/bin/env bash
# Launcher pointed to by the native-messaging-hosts manifest "path" field.
# Uses an absolute bun path: native messaging hosts are spawned by the
# browser with a minimal environment, no PATH guaranteed.
exec /home/romain/.bun/bin/bun /home/romain/projets/wingpen/bench/transport/host.ts

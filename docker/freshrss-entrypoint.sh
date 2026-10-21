#!/bin/sh
set -eu
node /opt/fresher/configure.mjs freshrss
node /opt/fresher/index.mjs &
exec /var/www/FreshRSS/Docker/entrypoint.sh "$@"

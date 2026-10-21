#!/bin/sh
set -eu
node /opt/fresher/configure.mjs standalone
node /opt/fresher/index.mjs &

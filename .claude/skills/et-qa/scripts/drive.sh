#!/usr/bin/env bash
# usage: drive.sh [port] <<'JS' ... JS   sends the script on stdin to driver.mjs
curl -s -X POST --data-binary @- "http://127.0.0.1:${1:-3499}/"

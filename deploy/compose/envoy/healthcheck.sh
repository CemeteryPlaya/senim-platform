#!/usr/bin/env bash
# Healthcheck контейнера Envoy для docker compose (в образе нет curl — запрос через /dev/tcp).
#   healthcheck.sh                      — admin /ready отвечает LIVE;
#   healthcheck.sh <кластер> <минимум>  — и в кластере не меньше <минимум> хостов, все прошли
#                                         активную проверку здоровья (mesh готов балансировать).
set -euo pipefail

admin() {
  exec 3<>/dev/tcp/127.0.0.1/9901
  # HTTP/1.1: admin Envoy отвечает 426 на HTTP/1.0.
  printf 'GET %s HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' "$1" >&3
  tr -d '\r' <&3
  exec 3<&-
}

admin /ready | grep -qx LIVE

if [ "$#" -eq 0 ]; then
  exit 0
fi
cluster="$1" min="$2"
stats="$(admin "/stats?filter=cluster.${cluster}.membership_")"
healthy="$(sed -n "s/^cluster\.${cluster}\.membership_healthy: //p" <<<"$stats")"
total="$(sed -n "s/^cluster\.${cluster}\.membership_total: //p" <<<"$stats")"
[ "${healthy:-0}" -ge "$min" ] && [ "$healthy" -eq "$total" ]

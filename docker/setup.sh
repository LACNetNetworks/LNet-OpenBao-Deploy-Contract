#!/usr/bin/env bash
# Habilita el plugin secp256k1 e importa una clave de prueba conocida.
# Idempotente: se puede correr varias veces.
set -euo pipefail

BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
BAO_TOKEN="${BAO_TOKEN:-root}"
MOUNT="${BAO_MOUNT:-secp}"

# Clave de prueba de Hardhat (account #0) — SÓLO para tests locales.
TEST_PK="${TEST_PK:-ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
EXPECTED_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

hdr=(-s -H "X-Vault-Token: ${BAO_TOKEN}")

echo "→ Esperando a OpenBao en ${BAO_ADDR} ..."
for i in $(seq 1 30); do
  if curl "${hdr[@]}" "${BAO_ADDR}/v1/sys/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "→ Montando el plugin secpsign en /${MOUNT} ..."
curl "${hdr[@]}" -X POST "${BAO_ADDR}/v1/sys/mounts/${MOUNT}" \
  -d '{"type":"secpsign"}' >/dev/null 2>&1 || echo "  (ya montado, ok)"

echo "→ Importando clave de prueba ..."
resp=$(curl "${hdr[@]}" -X POST "${BAO_ADDR}/v1/${MOUNT}/accounts" \
  -d "{\"privateKey\":\"${TEST_PK}\"}")
echo "  respuesta: ${resp}"

echo
echo "✅ Listo. Exporta para los tasks/tests:"
echo "   export BAO_ADDR=${BAO_ADDR}"
echo "   export BAO_TOKEN=${BAO_TOKEN}"
echo "   export BAO_MOUNT=${MOUNT}"
echo "   export DEPLOYER_ADDRESS=${EXPECTED_ADDR}"

# lnet-vault-storage

Despliega e interactúa con un contrato `Storage` en **lnet** firmando con
**OpenBao/Vault** (plugin secp256k1) en lugar de claves privadas locales, respetando
el modelo de gas de LAC-NET vía `@lacchain/gas-model-provider`.

## Estructura

```
.
├── contracts/Storage.sol        # store()/retrieve()
├── lnet.params.ts               # url / nodeAddress / expirationSeconds
├── vault-lnet-signer.ts         # VaultLnetSigner + firma del digest contra el bao
├── tasks/deploy-storage.ts      # tasks: check-deployer, deploy-storage, store, retrieve
├── test/vault-signer.test.ts    # test de firma contra OpenBao
├── hardhat.config.ts
├── package.json
└── tsconfig.json
```

## Instalación

```bash
npm install
cp .env.example .env   # completa los valores
npx hardhat compile
```

## Variables de entorno

| Var | Descripción |
|-----|-------------|
| `LNET_RPC` | RPC del nodo lnet |
| `NODE_ADDRESS` | Writer node que aprueba las tx (gas model) |
| `DEPLOYER_ADDRESS` | Cuenta firmante; debe coincidir con la clave del bao |
| `BAO_ADDR` | URL de OpenBao (default `http://127.0.0.1:8200`) |
| `BAO_TOKEN` | Token de OpenBao |
| `BAO_MOUNT` | Path del plugin secp256k1 (default `secp`) |

## Tasks

```bash
# Valida que DEPLOYER_ADDRESS == clave del bao
npx hardhat check-deployer --network lnet

# Deploy (+ store inicial). Opcional: --value <n>
npx hardhat deploy-storage --value 42 --network lnet

# Escribir en un Storage existente (firma con el bao)
npx hardhat store --address 0x... --value 123 --network lnet

# Leer (sólo provider, no firma ni gasta)
npx hardhat retrieve --address 0x... --network lnet
```

## OpenBao

Este proyecto **no incluye** el OpenBao: se gestiona en el repo aparte
[`LACNetNetworks/openbao-lnet`](https://github.com/LACNetNetworks/openbao-lnet).
Levantá el bao desde ahí (build + `docker compose up -d`) y apuntá las variables
`BAO_ADDR` / `BAO_TOKEN` / `BAO_MOUNT` de este proyecto a esa instancia.

> **Importante:** el motor `transit` de OpenBao/Vault **no soporta secp256k1**
> (sólo curvas NIST P-256/384/521 + ed25519), así que **no sirve** para Ethereum.
> El signer de este proyecto espera un plugin secp256k1 que exponga
> `POST /<mount>/accounts/<address>/signRaw` para firmar el digest.

```bash
# en openbao-lnet
docker compose up -d

# en este repo, contra ese bao
npm test              # corre test/vault-signer.test.ts contra el bao real
```

El test verifica, firmando contra OpenBao real:
1. la clave pública del bao deriva a la address esperada;
2. el `from` recuperado de la tx firmada coincide con la clave del bao;
3. `chainId == 0` y la `data` lleva el sufijo `nodeAddress + expiration` (gas model);
4. la firma es `low-s` (EIP-2).

Si el bao no está accesible, el test se salta (no falla) con un aviso.

## Notas

- El check de `DEPLOYER_ADDRESS` corre automáticamente antes de cualquier task que firme
  (`deploy-storage`, `store`); aborta antes de enviar nada si no coincide.
- La `expiration` se renueva (+24h) en cada ejecución.
- En el plugin secp256k1 las cuentas se direccionan **por su address Ethereum**
  (no por un nombre de clave): por eso `DEPLOYER_ADDRESS` es a la vez el firmante y la
  ruta en el bao (`/secp/accounts/<DEPLOYER_ADDRESS>`).

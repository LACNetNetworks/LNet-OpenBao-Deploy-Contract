import {
  AbiCoder,
  AbstractSigner,
  Provider,
  Transaction,
  TransactionRequest,
  TypedDataDomain,
  TypedDataField,
  assertArgument,
  getAddress,
  getBigInt,
  resolveAddress,
  resolveProperties,
} from 'ethers';

export interface VaultConfig {
  addr: string; // p.ej. http://127.0.0.1:8200
  token: string; // el BAO_TOKEN
  mount: string; // path del plugin ethsign, p.ej. "ethereum"
}

/** Convierte un valor numérico de ethers a string decimal (para el plugin). */
function toDecString(v: unknown, fallback: bigint = 0n): string {
  if (v == null) return fallback.toString();
  return getBigInt(v as any).toString();
}

/**
 * Firma una transacción completa con el plugin ethsign de OpenBao
 * (POST /<mount>/accounts/<address>/sign). El plugin construye la tx legacy y,
 * con chainId="0", la firma con HomesteadSigner (pre-EIP155, v∈{27,28}),
 * devolviendo el RLP firmado listo para difundir.
 *
 * El sufijo del modelo de gas LAC-NET (nodeAddress + expiration) debe venir ya
 * incluido en `data`: el plugin firma los bytes tal cual se le pasan.
 */
export async function vaultSignTransaction(
  cfg: VaultConfig,
  account: string,
  fields: {
    to: string;
    data: string;
    value: string;
    nonce: string;
    gas: string;
    gasPrice: string;
    chainId: string;
  },
): Promise<{ signedTransaction: string; transactionHash: string }> {
  const url = `${cfg.addr}/v1/${cfg.mount}/accounts/${account.toLowerCase()}/sign`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Vault-Token': cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    throw new Error(`Vault sign falló: ${res.status} ${await res.text()}`);
  }

  const { data } = await res.json();
  return {
    signedTransaction: data.signed_transaction as string,
    transactionHash: data.transaction_hash as string,
  };
}

/**
 * Lee la cuenta del plugin (GET /<mount>/accounts/<address>) y devuelve la
 * address que custodia. Sirve para confirmar que el bao controla la clave de
 * esa address (el plugin ethsign no expone la clave pública).
 */
export async function vaultGetAccountAddress(
  cfg: VaultConfig,
  account: string,
): Promise<string> {
  const url = `${cfg.addr}/v1/${cfg.mount}/accounts/${account.toLowerCase()}`;
  const res = await fetch(url, { headers: { 'X-Vault-Token': cfg.token } });
  if (!res.ok) {
    throw new Error(`Vault read account falló: ${res.status} ${await res.text()}`);
  }
  const { data } = await res.json();
  return getAddress(data.address as string);
}

/**
 * Signer del modelo de gas de LAC-NET que delega la firma al plugin ethsign de
 * OpenBao en lugar de usar una clave privada local. El plugin construye y firma
 * la transacción completa; aquí solo inyectamos el sufijo del gas model en la
 * data y forzamos chainId 0 (firma legacy/Homestead).
 *
 * Extiende AbstractSigner (no Wallet) para poder exponer la address de la
 * clave del bao: Wallet define `address` como propiedad propia no-configurable
 * y eclipsaría un getter del subtipo.
 */
export class VaultLnetSigner extends AbstractSigner {
  readonly accountAddress: string;

  constructor(
    private vault: VaultConfig,
    accountAddress: string,
    provider: Provider,
    private nodeAddress: string,
    private expirationTime: number,
  ) {
    super(provider);
    this.accountAddress = getAddress(accountAddress);
  }

  get address(): string {
    return this.accountAddress;
  }

  async getAddress(): Promise<string> {
    return this.accountAddress;
  }

  connect(provider: Provider): VaultLnetSigner {
    return new VaultLnetSigner(
      this.vault,
      this.accountAddress,
      provider,
      this.nodeAddress,
      this.expirationTime,
    );
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    // Resuelve to/from (ENS o Addressable -> address)
    const { to, from } = await resolveProperties({
      to: tx.to ? resolveAddress(tx.to, this.provider!) : undefined,
      from: tx.from ? resolveAddress(tx.from, this.provider!) : undefined,
    });
    if (to != null) tx.to = to;
    if (from != null) {
      assertArgument(
        getAddress(from as string) === this.accountAddress,
        'transaction from address mismatch',
        'tx.from',
        from,
      );
    }

    // Inyecta nodeAddress + expiration (modelo de gas LAC-NET) en la data
    const data =
      (tx.data ?? '0x') +
      AbiCoder.defaultAbiCoder()
        .encode(['address', 'uint256'], [this.nodeAddress, this.expirationTime])
        .substring(2);

    // El plugin firma la tx completa; chainId "0" -> Homestead (legacy, sin EIP-155)
    const { signedTransaction } = await vaultSignTransaction(
      this.vault,
      this.accountAddress,
      {
        to: (tx.to as string) ?? '',
        data,
        value: toDecString(tx.value),
        nonce: toDecString(tx.nonce),
        gas: toDecString(tx.gasLimit, 90_000n),
        gasPrice: toDecString(tx.gasPrice),
        chainId: '0',
      },
    );

    // Salvaguarda: el firmante recuperado del RLP debe ser nuestra address
    const parsed = Transaction.from(signedTransaction);
    assertArgument(
      parsed.from != null && getAddress(parsed.from) === this.accountAddress,
      'la tx firmada por el bao no recupera a la address esperada',
      'signedTransaction',
      signedTransaction,
    );

    return signedTransaction;
  }

  async signMessage(): Promise<string> {
    throw new Error('signMessage no implementado para VaultLnetSigner');
  }

  async signTypedData(
    _domain: TypedDataDomain,
    _types: Record<string, TypedDataField[]>,
    _value: Record<string, any>,
  ): Promise<string> {
    throw new Error('signTypedData no implementado para VaultLnetSigner');
  }
}

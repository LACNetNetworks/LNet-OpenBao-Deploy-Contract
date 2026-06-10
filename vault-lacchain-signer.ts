import {
  AbiCoder,
  AbstractSigner,
  Provider,
  Signature,
  Transaction,
  TransactionLike,
  TransactionRequest,
  TypedDataDomain,
  TypedDataField,
  assertArgument,
  getAddress,
  recoverAddress,
  resolveAddress,
  resolveProperties,
} from 'ethers';

const SECP256K1_N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

export interface VaultConfig {
  addr: string; // p.ej. http://127.0.0.1:8200
  token: string; // el BAO_TOKEN
  mount: string; // path del plugin secp256k1, p.ej. "secp"
}

/**
 * Firma un digest de 32 bytes con el plugin secp256k1 de OpenBao
 * (POST /<mount>/accounts/<address>/signRaw) y devuelve r, s y v (low-s).
 * El plugin responde 65 bytes: r(32) ‖ s(32) ‖ v(1, valor 0|1).
 */
export async function vaultSignDigest(
  cfg: VaultConfig,
  account: string,
  digestHex: string,
): Promise<{ r: string; s: string; v: number }> {
  const url = `${cfg.addr}/v1/${cfg.mount}/accounts/${account.toLowerCase()}/signRaw`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Vault-Token': cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: digestHex }),
  });
  if (!res.ok) {
    throw new Error(`Vault signRaw falló: ${res.status} ${await res.text()}`);
  }

  const { data } = await res.json();
  const sig = (data.signature as string).slice(2); // sin 0x -> 130 hex
  const r = BigInt('0x' + sig.slice(0, 64));
  let s = BigInt('0x' + sig.slice(64, 128));
  let v = parseInt(sig.slice(128, 130), 16); // 0 | 1

  // EIP-2: Ethereum exige low-s; si normalizamos, se invierte la paridad
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
    v ^= 1;
  }

  return {
    r: '0x' + r.toString(16).padStart(64, '0'),
    s: '0x' + s.toString(16).padStart(64, '0'),
    v,
  };
}

/** Lee la clave pública del plugin (64 bytes hex X‖Y, sin prefijo 04). */
export async function vaultGetPublicKey(
  cfg: VaultConfig,
  account: string,
): Promise<string> {
  const url = `${cfg.addr}/v1/${cfg.mount}/accounts/${account.toLowerCase()}`;
  const res = await fetch(url, { headers: { 'X-Vault-Token': cfg.token } });
  if (!res.ok) {
    throw new Error(`Vault read account falló: ${res.status} ${await res.text()}`);
  }
  const { data } = await res.json();
  return data.publicKey as string;
}

/**
 * Signer del modelo de gas de LAC-NET que delega la firma del digest al
 * plugin secp256k1 de OpenBao en lugar de usar una clave privada local.
 *
 * Extiende AbstractSigner (no Wallet) para poder exponer la address de la
 * clave del bao: Wallet define `address` como propiedad propia no-configurable
 * y eclipsaría un getter del subtipo.
 */
export class VaultLacchainSigner extends AbstractSigner {
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

  connect(provider: Provider): VaultLacchainSigner {
    return new VaultLacchainSigner(
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

    // Inyecta nodeAddress + expiration (modelo de gas LAC-NET) y chainId 0
    const data =
      (tx.data ?? '0x') +
      AbiCoder.defaultAbiCoder()
        .encode(['address', 'uint256'], [this.nodeAddress, this.expirationTime])
        .substring(2);

    const btx = Transaction.from({
      type: tx.type ?? undefined,
      to: tx.to ?? undefined,
      nonce: tx.nonce ?? undefined,
      gasLimit: tx.gasLimit ?? undefined,
      gasPrice: tx.gasPrice ?? undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined,
      maxFeePerGas: tx.maxFeePerGas ?? undefined,
      value: tx.value ?? undefined,
      accessList: tx.accessList ?? undefined,
      data,
      chainId: 0,
    } as TransactionLike<string>);

    // Aquí, en lugar de signingKey.sign(...), firma el bao:
    const { r, s, v } = await vaultSignDigest(this.vault, this.accountAddress, btx.unsignedHash);

    let sig = Signature.from({ r, s, v: 27 + v });
    // Salvaguarda: si la paridad reportada no recupera nuestra address, prueba la otra
    if (getAddress(recoverAddress(btx.unsignedHash, sig)) !== this.accountAddress) {
      sig = Signature.from({ r, s, v: 27 + (1 - v) });
    }
    btx.signature = sig;

    return btx.serialized;
  }

  async signMessage(): Promise<string> {
    throw new Error('signMessage no implementado para VaultLacchainSigner');
  }

  async signTypedData(
    _domain: TypedDataDomain,
    _types: Record<string, TypedDataField[]>,
    _value: Record<string, any>,
  ): Promise<string> {
    throw new Error('signTypedData no implementado para VaultLacchainSigner');
  }
}

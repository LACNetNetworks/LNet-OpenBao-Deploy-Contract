import { expect } from 'chai';
import {
  AbiCoder,
  Transaction,
  computeAddress,
  getAddress,
} from 'ethers';
import { LacchainProvider } from '@lacchain/gas-model-provider';
import {
  VaultConfig,
  VaultLacchainSigner,
  vaultGetPublicKey,
} from '../vault-lacchain-signer';

// Debe coincidir con la clave importada por docker/setup.sh (Hardhat account #0)
const EXPECTED_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const cfg: VaultConfig = {
  addr: process.env.BAO_ADDR ?? 'http://127.0.0.1:8200',
  token: process.env.BAO_TOKEN ?? 'root',
  mount: process.env.BAO_MOUNT ?? 'secp',
};

const NODE_ADDRESS = '0xd00e6624a73f88b39f82ab34e8bf2b4d226fd768';
const EXPIRATION = 1893456000; // fijo para aserciones deterministas

async function baoReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${cfg.addr}/v1/sys/health`, {
      headers: { 'X-Vault-Token': cfg.token },
    });
    return r.ok || r.status === 429 || r.status === 501; // health devuelve códigos "ok" raros
  } catch {
    return false;
  }
}

describe('VaultLacchainSigner contra OpenBao + plugin secp256k1', function () {
  this.timeout(30_000);

  before(async function () {
    if (!(await baoReachable())) {
      console.warn(
        '\n  ⚠️  OpenBao no accesible — levántalo con:\n' +
          '      docker compose up -d --build && bash docker/setup.sh\n',
      );
      this.skip();
    }
  });

  it('la clave pública del bao deriva a la address esperada', async () => {
    const pub = await vaultGetPublicKey(cfg, EXPECTED_ADDR);
    const derived = computeAddress('0x04' + pub.replace(/^0x/, ''));
    expect(getAddress(derived)).to.equal(getAddress(EXPECTED_ADDR));
  });

  it('firma una tx y el from recuperado coincide con la clave del bao', async () => {
    const provider = new LacchainProvider('http://127.0.0.1:1'); // no se usa
    const signer = new VaultLacchainSigner(
      cfg,
      EXPECTED_ADDR,
      provider,
      NODE_ADDRESS,
      EXPIRATION,
    );

    // tx totalmente poblada -> signTransaction no toca el provider
    const tx = {
      to: '0x1111111111111111111111111111111111111111',
      nonce: 0,
      gasLimit: 100_000n,
      gasPrice: 0,
      value: 0n,
      data: '0x60fe47b1000000000000000000000000000000000000000000000000000000000000002a',
      type: 0,
    };

    const raw = await signer.signTransaction(tx);
    const parsed = Transaction.from(raw);

    // 1) Recuperación: el firmante es la clave del bao
    expect(getAddress(parsed.from!)).to.equal(getAddress(EXPECTED_ADDR));

    // 2) Gas model: chainId 0
    expect(parsed.chainId).to.equal(0n);

    // 3) Gas model: data lleva nodeAddress + expiration al final
    const suffix = AbiCoder.defaultAbiCoder()
      .encode(['address', 'uint256'], [NODE_ADDRESS, EXPIRATION])
      .substring(2);
    expect(parsed.data.endsWith(suffix)).to.equal(true);

    // 4) low-s (EIP-2)
    const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    expect(BigInt(parsed.signature!.s) <= N / 2n).to.equal(true);
  });
});

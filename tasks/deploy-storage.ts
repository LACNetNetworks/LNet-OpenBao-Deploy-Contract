import { task, types } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { computeAddress, getAddress } from 'ethers';
import { LacchainProvider } from '@lacchain/gas-model-provider';
import { VaultConfig, VaultLacchainSigner, vaultGetPublicKey } from '../vault-lacchain-signer';
import { lacchainParams } from '../lacchain.params';

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/** Lee env obligatorias y arma la config del bao. */
function vaultConfig(): { cfg: VaultConfig; deployer: string } {
  const token = process.env.BAO_TOKEN;
  const deployer = process.env.DEPLOYER_ADDRESS;
  if (!token) throw new Error('Falta BAO_TOKEN en el entorno');
  if (!deployer) throw new Error('Falta DEPLOYER_ADDRESS en el entorno');

  return {
    cfg: {
      addr: process.env.BAO_ADDR ?? 'http://127.0.0.1:8200',
      token,
      mount: process.env.BAO_MOUNT ?? 'secp',
    },
    deployer,
  };
}

/** Deriva la address Ethereum de la clave pública que expone el plugin. */
async function vaultAddressOf(cfg: VaultConfig, account: string): Promise<string> {
  const pub = await vaultGetPublicKey(cfg, account); // 64 bytes hex (X‖Y)
  return computeAddress('0x04' + pub.replace(/^0x/, ''));
}

/** Construye el signer respaldado por OpenBao, validando antes la address. */
async function buildVaultSigner(_hre: HardhatRuntimeEnvironment) {
  const { cfg, deployer } = vaultConfig();

  // Check previo: DEPLOYER_ADDRESS debe coincidir con la clave del bao
  const baoAddress = await vaultAddressOf(cfg, deployer);
  if (getAddress(baoAddress) !== getAddress(deployer)) {
    throw new Error(
      `DEPLOYER_ADDRESS no coincide con la clave del bao.\n` +
        `  DEPLOYER_ADDRESS = ${getAddress(deployer)}\n` +
        `  clave del bao    = ${getAddress(baoAddress)}`,
    );
  }
  console.log(`🔐 Clave del bao verificada → ${getAddress(baoAddress)}`);

  // Expiration fresca en cada ejecución (no la del arranque del proceso)
  const expiration = Math.floor(Date.now() / 1000) + lacchainParams.expirationSeconds;
  const provider = new LacchainProvider(lacchainParams.url);

  return new VaultLacchainSigner(cfg, deployer, provider, lacchainParams.nodeAddress, expiration);
}

// ───────────────────────────────────────────────────────────────────────────
// Tasks
// ───────────────────────────────────────────────────────────────────────────

task('check-deployer', 'Verifica que DEPLOYER_ADDRESS coincida con la clave del bao')
  .setAction(async () => {
    const { cfg, deployer } = vaultConfig();
    const baoAddress = await vaultAddressOf(cfg, deployer);

    const ok = getAddress(baoAddress) === getAddress(deployer);
    console.log(`clave del bao    = ${getAddress(baoAddress)}`);
    console.log(`DEPLOYER_ADDRESS = ${getAddress(deployer)}`);
    console.log(ok ? '✅ Coinciden' : '❌ NO coinciden');
    if (!ok) process.exitCode = 1;
  });

task('deploy-storage', 'Despliega el contrato Storage firmando con OpenBao')
  .addOptionalParam('value', 'Valor inicial a guardar tras el deploy', 42, types.int)
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;

    const signer = await buildVaultSigner(hre);
    const Storage = await ethers.getContractFactory('Storage', signer);

    console.log('Desplegando Storage firmando con OpenBao...');
    const storage = await Storage.deploy();

    // En el gas model el address se obtiene del receipt, no de contract.address
    const receipt = await storage.deploymentTransaction()?.wait();
    const address = receipt?.contractAddress ?? (await storage.getAddress());
    console.log('✅ Storage desplegado en:', address);

    // Inicializa el valor (cada tx vuelve a pedir firma al bao)
    const deployed = storage.attach(address);
    await (await deployed.store(taskArgs.value)).wait();
    console.log(`store(${taskArgs.value}) ok — retrieve():`, (await deployed.retrieve()).toString());

    return address;
  });

task('store', 'Llama a store() de un Storage existente firmando con OpenBao')
  .addParam('address', 'Dirección del contrato Storage ya desplegado', undefined, types.string)
  .addParam('value', 'Valor uint256 a guardar', undefined, types.int)
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;

    const signer = await buildVaultSigner(hre);
    const storage = await ethers.getContractAt('Storage', taskArgs.address, signer);

    console.log(`retrieve() actual: ${(await storage.retrieve()).toString()}`);

    console.log(`Enviando store(${taskArgs.value}) — firma con OpenBao...`);
    const receipt = await (await storage.store(taskArgs.value)).wait();
    console.log('✅ tx confirmada:', receipt?.hash);

    console.log('retrieve() nuevo:', (await storage.retrieve()).toString());
  });

task('retrieve', 'Lee retrieve() de un Storage existente (no firma, no gasta nada)')
  .addParam('address', 'Dirección del contrato Storage', undefined, types.string)
  .setAction(async (taskArgs, hre) => {
    const { ethers } = hre;

    // Sólo provider: las llamadas view no requieren signer ni OpenBao
    const provider = new LacchainProvider(lacchainParams.url);
    const storage = await ethers.getContractAt('Storage', taskArgs.address, provider);

    const value = await storage.retrieve();
    console.log(`retrieve() @ ${taskArgs.address}:`, value.toString());

    return value;
  });

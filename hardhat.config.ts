import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import './tasks/deploy-storage'; // registra los tasks
import { lnetParams } from './lnet.params';

const config: HardhatUserConfig = {
  solidity: '0.8.20',
  defaultNetwork: 'lnet',
  networks: {
    // El envío real de transacciones lo hace nuestro LacchainProvider/VaultLnetSigner;
    // esta entrada sólo existe para que `--network lnet` sea válido en Hardhat.
    lnet: {
      url: lnetParams.url,
      accounts: [], // sin claves locales: firmamos con el bao
    },
  },
  mocha: {
    timeout: 30_000, // las llamadas al bao pueden tardar
  },
};

export default config;

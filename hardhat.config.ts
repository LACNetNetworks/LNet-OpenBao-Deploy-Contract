import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-ethers';
import './tasks/deploy-storage'; // registra los tasks
import { lacchainParams } from './lacchain.params';

const config: HardhatUserConfig = {
  solidity: '0.8.20',
  defaultNetwork: 'lacchain',
  networks: {
    // El envío real de transacciones lo hace nuestro LacchainProvider/VaultLacchainSigner;
    // esta entrada sólo existe para que `--network lacchain` sea válido en Hardhat.
    lacchain: {
      url: lacchainParams.url,
      accounts: [], // sin claves locales: firmamos con el bao
    },
  },
  mocha: {
    timeout: 30_000, // las llamadas al bao pueden tardar
  },
};

export default config;

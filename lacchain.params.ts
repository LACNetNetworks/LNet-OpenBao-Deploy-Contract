export const lacchainParams = {
  url: process.env.LACCHAIN_RPC ?? 'http://<ip-de-tu-nodo-lnet>',
  nodeAddress: process.env.NODE_ADDRESS ?? '0x...', // writer node de lnet
  expirationSeconds: 86_400, // ventana de validez de la tx (+24h desde el envío)
};

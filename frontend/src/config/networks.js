// DataHaven Network Configuration
export const NETWORKS = {
  testnet: {
    id: 55931,
    idHex: '0xda7b',
    name: 'DataHaven Testnet',
    rpcUrl: 'https://services.datahaven-testnet.network/testnet',
    wsUrl: 'wss://services.datahaven-testnet.network/testnet',
    mspUrl: 'https://deo-dh-backend.testnet.datahaven-infra.network/',
    explorerUrl: 'https://testnet.dhscan.io',
    nativeCurrency: { name: 'Mock', symbol: 'MOCK', decimals: 18 },
  },
};

// Filesystem contract address (precompile)
export const FILESYSTEM_CONTRACT = '0x0000000000000000000000000000000000000404';

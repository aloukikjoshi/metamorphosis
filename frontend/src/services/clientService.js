// DataHaven Client Service - Wallet & StorageHub Client Management
import { defineChain, createPublicClient, createWalletClient, http, custom } from 'viem';
import { StorageHubClient } from '@storagehub-sdk/core';
import { NETWORKS, FILESYSTEM_CONTRACT } from '../config/networks';

// Storage key
const CONNECTED_ADDRESS_KEY = 'datahaven_connected_address';

// Define the chain configuration
export const chain = defineChain({
  id: NETWORKS.testnet.id,
  name: NETWORKS.testnet.name,
  nativeCurrency: NETWORKS.testnet.nativeCurrency,
  rpcUrls: { default: { http: [NETWORKS.testnet.rpcUrl] } },
});

// State for connected clients
let walletClientInstance = null;
let publicClientInstance = null;
let storageHubClientInstance = null;
let connectedAddress = null;

// Initialize from storage
function initFromStorage() {
  if (typeof window === 'undefined') return;
  const storedAddress = sessionStorage.getItem(CONNECTED_ADDRESS_KEY);
  if (storedAddress) {
    connectedAddress = storedAddress;
  }
}

// Initialize on module load
initFromStorage();

// Get ethereum provider from window
function getEthereumProvider() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No Ethereum wallet found. Please install MetaMask or another Web3 wallet.');
  }
  return window.ethereum;
}

// Create public client (read-only, always available)
export function getPublicClient() {
  if (!publicClientInstance) {
    publicClientInstance = createPublicClient({
      chain,
      transport: http(NETWORKS.testnet.rpcUrl),
    });
  }
  return publicClientInstance;
}

// Switch wallet to the correct network
async function switchToCorrectNetwork(provider) {
  const chainIdHex = NETWORKS.testnet.idHex;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError) {
    // Error code 4902 means the chain hasn't been added to the wallet
    if (switchError.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: NETWORKS.testnet.name,
            nativeCurrency: NETWORKS.testnet.nativeCurrency,
            rpcUrls: [NETWORKS.testnet.rpcUrl],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

// Connect wallet using browser extension (MetaMask, etc.)
export async function connectWallet() {
  const provider = getEthereumProvider();

  // Request account access
  const accounts = await provider.request({
    method: 'eth_requestAccounts',
  });

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found. Please connect your wallet.');
  }

  // Switch to the correct network
  await switchToCorrectNetwork(provider);

  connectedAddress = accounts[0];

  // Create wallet client with browser wallet
  walletClientInstance = createWalletClient({
    chain,
    account: connectedAddress,
    transport: custom(provider),
  });

  // Create StorageHub client
  storageHubClientInstance = new StorageHubClient({
    rpcUrl: NETWORKS.testnet.rpcUrl,
    chain: chain,
    walletClient: walletClientInstance,
    filesystemContractAddress: FILESYSTEM_CONTRACT,
  });

  // Persist to session storage
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(CONNECTED_ADDRESS_KEY, connectedAddress);
  }

  return connectedAddress;
}

// Getters for client instances
export function getWalletClient() {
  if (!walletClientInstance) {
    throw new Error('Wallet not connected. Please connect your wallet first.');
  }
  return walletClientInstance;
}

export function getStorageHubClient() {
  if (!storageHubClientInstance) {
    throw new Error('StorageHub client not initialized. Please connect your wallet first.');
  }
  return storageHubClientInstance;
}

export function getConnectedAddress() {
  return connectedAddress;
}

export function isWalletConnected() {
  return walletClientInstance !== null && connectedAddress !== null;
}

// Restore wallet connection from persisted state
export async function restoreWalletConnection() {
  if (!connectedAddress) {
    return null;
  }

  try {
    const provider = getEthereumProvider();

    // Check if wallet is still connected
    const accounts = await provider.request({
      method: 'eth_accounts',
    });

    const addressLower = connectedAddress.toLowerCase();
    const isStillConnected = accounts.some((acc) => acc.toLowerCase() === addressLower);

    if (!isStillConnected) {
      disconnectWallet();
      return null;
    }

    await switchToCorrectNetwork(provider);

    walletClientInstance = createWalletClient({
      chain,
      account: connectedAddress,
      transport: custom(provider),
    });

    storageHubClientInstance = new StorageHubClient({
      rpcUrl: NETWORKS.testnet.rpcUrl,
      chain: chain,
      walletClient: walletClientInstance,
      filesystemContractAddress: FILESYSTEM_CONTRACT,
    });

    return connectedAddress;
  } catch {
    disconnectWallet();
    return null;
  }
}

// Disconnect wallet
export function disconnectWallet() {
  walletClientInstance = null;
  storageHubClientInstance = null;
  connectedAddress = null;

  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(CONNECTED_ADDRESS_KEY);
  }
}

// Build gas transaction options
export async function buildGasTxOpts() {
  const publicClient = getPublicClient();
  const gas = BigInt('1500000');

  const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
  const baseFeePerGas = latestBlock.baseFeePerGas;
  
  if (baseFeePerGas == null) {
    throw new Error('RPC did not return baseFeePerGas. Cannot build EIP-1559 fees.');
  }

  const maxPriorityFeePerGas = BigInt('1500000000'); // 1.5 gwei
  const maxFeePerGas = baseFeePerGas * BigInt(2) + maxPriorityFeePerGas;

  return { gas, maxFeePerGas, maxPriorityFeePerGas };
}

// Get wallet balance
export async function getWalletBalance() {
  if (!connectedAddress) return null;
  
  const publicClient = getPublicClient();
  const balance = await publicClient.getBalance({ address: connectedAddress });
  
  // Convert from wei to MOCK (18 decimals)
  const balanceInMock = Number(balance) / 1e18;
  return balanceInMock.toFixed(4);
}

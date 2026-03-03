// DataHaven Context Provider - Global State Management for DataHaven Integration
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  connectWallet,
  disconnectWallet,
  restoreWalletConnection,
  isWalletConnected,
  getConnectedAddress,
  getWalletBalance,
  initPolkadotApi,
  disconnectPolkadotApi,
} from '../services/clientService';
import {
  connectToMsp,
  disconnectMsp,
  isMspConnected,
  authenticateUser,
  isAuthenticated,
  getUserProfile,
  getMspHealth,
} from '../services/mspService';
import {
  createBucket,
  waitForBackendBucketReady,
  uploadAuditProof,
  getBucketsFromMSP,
} from '../services/storageOperations';

// Create the context
const DataHavenContext = createContext(null);

// Default bucket name for audit proofs
const AUDIT_BUCKET_NAME = 'metamorphosis-audit-proofs';

export function DataHavenProvider({ children }) {
  // Connection states
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [mspConnected, setMspConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  
  // Operation states
  const [isConnecting, setIsConnecting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  
  // Storage states
  const [activeBucketId, setActiveBucketId] = useState(null);
  const [uploadedProofs, setUploadedProofs] = useState([]);
  
  // Health check
  const [mspHealth, setMspHealth] = useState(null);

  // Restore connection on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const restored = await restoreWalletConnection();
        if (restored) {
          setWalletAddress(restored);
          const balance = await getWalletBalance();
          setWalletBalance(balance);
        }
      } catch (err) {
        console.warn('Failed to restore wallet connection:', err);
      }
    };
    restore();
  }, []);

  // Connect wallet
  const handleConnectWallet = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      const address = await connectWallet();
      setWalletAddress(address);
      
      const balance = await getWalletBalance();
      setWalletBalance(balance);
      
      return address;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Connect to MSP
  const handleConnectMsp = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      await connectToMsp();
      setMspConnected(true);
      
      // Check health
      const health = await getMspHealth();
      setMspHealth(health);
      
      return true;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Authenticate with SIWE
  const handleAuthenticate = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      // Initialize Polkadot API for chain queries
      await initPolkadotApi();
      
      const profile = await authenticateUser();
      setAuthenticated(true);
      setUserProfile(profile);
      
      return profile;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Full connection flow (wallet -> MSP -> authenticate)
  const handleFullConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      // Step 1: Connect wallet
      const address = await connectWallet();
      setWalletAddress(address);
      
      const balance = await getWalletBalance();
      setWalletBalance(balance);
      
      // Step 2: Connect to MSP
      await connectToMsp();
      setMspConnected(true);
      
      const health = await getMspHealth();
      setMspHealth(health);
      
      // Step 3: Initialize Polkadot API
      await initPolkadotApi();
      
      // Step 4: Authenticate
      const profile = await authenticateUser();
      setAuthenticated(true);
      setUserProfile(profile);
      
      return { address, profile };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Disconnect everything
  const handleDisconnect = useCallback(async () => {
    disconnectWallet();
    disconnectMsp();
    await disconnectPolkadotApi();
    
    setWalletAddress(null);
    setWalletBalance(null);
    setMspConnected(false);
    setAuthenticated(false);
    setUserProfile(null);
    setActiveBucketId(null);
    setMspHealth(null);
  }, []);

  // Ensure bucket exists
  const ensureBucket = useCallback(async () => {
    setError(null);
    
    try {
      // Verify MSP is connected and authenticated
      if (!mspConnected || !authenticated) {
        throw new Error('Please connect your wallet and authenticate with DataHaven first');
      }
      
      // Check if we already have an active bucket
      if (activeBucketId) {
        return activeBucketId;
      }
      
      // Try to find existing bucket
      console.log('Fetching buckets from MSP...');
      const buckets = await getBucketsFromMSP();
      console.log('Buckets received:', buckets);
      const bucketsArray = Array.isArray(buckets) ? buckets : [];
      const existingBucket = bucketsArray.find(b => b && b.name === AUDIT_BUCKET_NAME);
      
      if (existingBucket) {
        console.log('Found existing bucket:', existingBucket);
        setActiveBucketId(existingBucket.bucketId);
        return existingBucket.bucketId;
      }
      
      // Create new bucket
      console.log('Creating new bucket:', AUDIT_BUCKET_NAME);
      const result = await createBucket(AUDIT_BUCKET_NAME, false);
      
      if (!result.alreadyExists) {
        // Wait for backend to index the bucket
        await waitForBackendBucketReady(result.bucketId);
      }
      
      setActiveBucketId(result.bucketId);
      return result.bucketId;
    } catch (err) {
      console.error('Ensure bucket error:', err);
      setError(err.message);
      throw err;
    }
  }, [activeBucketId, mspConnected, authenticated]);

  // Upload audit proof
  const handleUploadProof = useCallback(async (proofData) => {
    setIsUploading(true);
    setError(null);
    
    try {
      // Ensure we have a bucket
      const bucketId = await ensureBucket();
      
      // Upload the proof
      const result = await uploadAuditProof(bucketId, proofData);
      
      // Update balance after gas usage
      const balance = await getWalletBalance();
      setWalletBalance(balance);
      
      // Add to uploaded proofs
      setUploadedProofs(prev => [result, ...prev]);
      
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsUploading(false);
    }
  }, [ensureBucket]);

  const value = {
    // Connection states
    walletAddress,
    walletBalance,
    mspConnected,
    authenticated,
    userProfile,
    mspHealth,
    
    // Operation states
    isConnecting,
    isUploading,
    error,
    
    // Storage states
    activeBucketId,
    uploadedProofs,
    
    // Computed states
    isFullyConnected: walletAddress && mspConnected && authenticated,
    
    // Actions
    connectWallet: handleConnectWallet,
    connectMsp: handleConnectMsp,
    authenticate: handleAuthenticate,
    fullConnect: handleFullConnect,
    disconnect: handleDisconnect,
    uploadProof: handleUploadProof,
    clearError: () => setError(null),
  };

  return (
    <DataHavenContext.Provider value={value}>
      {children}
    </DataHavenContext.Provider>
  );
}

// Custom hook to use DataHaven context
export function useDataHaven() {
  const context = useContext(DataHavenContext);
  if (!context) {
    throw new Error('useDataHaven must be used within a DataHavenProvider');
  }
  return context;
}

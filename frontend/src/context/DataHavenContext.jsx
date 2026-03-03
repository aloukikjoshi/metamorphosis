// DataHaven Context Provider - Global State Management for DataHaven Integration
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Error boundary for DataHaven SDK issues
const DataHavenErrorBoundary = ({ children, onError }) => {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleError = (event) => {
      console.error('DataHaven SDK Error:', event.error);
      setHasError(true);
      setError(event.error);
      if (onError) onError(event.error);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', (event) => {
      handleError({ error: event.reason });
    });

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, [onError]);

  if (hasError) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <h3 className="text-red-800 font-semibold">DataHaven SDK Error</h3>
        <p className="text-red-600 text-sm mt-1">
          There was an issue loading the DataHaven SDK. Please refresh the page and try again.
        </p>
        <details className="mt-2">
          <summary className="text-red-500 cursor-pointer text-xs">Technical Details</summary>
          <pre className="text-xs text-red-400 mt-1 whitespace-pre-wrap">
            {error?.message || error?.toString() || 'Unknown error'}
          </pre>
        </details>
      </div>
    );
  }

  return children;
};

// Lazy load DataHaven services with error handling
let servicesLoaded = false;
let servicesLoading = false;
let servicesError = null;

const loadDataHavenServices = async () => {
  if (servicesLoaded) return;
  if (servicesLoading) {
    // Wait for loading to complete
    while (servicesLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }
  if (servicesError) throw servicesError;

  servicesLoading = true;
  try {
    // Import services with error handling
    const [clientService, mspService, storageOperations] = await Promise.all([
      import('../services/clientService').catch(err => {
        console.error('Failed to load clientService:', err);
        throw new Error(`Client service loading failed: ${err.message}`);
      }),
      import('../services/mspService').catch(err => {
        console.error('Failed to load mspService:', err);
        throw new Error(`MSP service loading failed: ${err.message}`);
      }),
      import('../services/storageOperations').catch(err => {
        console.error('Failed to load storageOperations:', err);
        throw new Error(`Storage operations loading failed: ${err.message}`);
      }),
    ]);
    
    servicesLoaded = true;
    return { clientService, mspService, storageOperations };
  } catch (err) {
    servicesError = err;
    throw err;
  } finally {
    servicesLoading = false;
  }
};

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

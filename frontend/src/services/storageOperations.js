// DataHaven Storage Operations
// Uses @storagehub-sdk/core (EVM precompiles) and @storagehub-sdk/msp-client (REST)

import { FileManager, ReplicationLevel } from '@storagehub-sdk/core';
import { TypeRegistry } from '@polkadot/types'; // Required by FileManager.computeFileKey
import {
  getStorageHubClient,
  getConnectedAddress,
  getPublicClient,
  buildGasTxOpts,
} from './clientService';
import { getMspClient, authenticateUser, isAuthenticated } from './mspService';
import { NETWORKS } from '../config/networks';

// ============================================================================
// BUCKET OPERATIONS
// ============================================================================

/**
 * Create a new storage bucket
 */
export async function createBucket(bucketName, isPrivate = false) {
  console.log('🪣 Creating bucket:', bucketName);
  
  const storageHubClient = getStorageHubClient();
  const address = getConnectedAddress();
  const publicClient = getPublicClient();

  if (!address) {
    throw new Error('Wallet not connected');
  }

  // Derive bucket ID
  const bucketId = await storageHubClient.deriveBucketId(address, bucketName);
  console.log('📝 Derived bucket ID:', bucketId);

  // Check if bucket already exists via MSP client
  try {
    const mspClient = getMspClient();
    const existingBuckets = await mspClient.buckets.listBuckets();
    const found = Array.isArray(existingBuckets) && existingBuckets.find(
      b => b.name === bucketName || b.bucketId === bucketId
    );
    if (found) {
      console.log('✅ Bucket already exists (found via MSP)');
      return { bucketId: found.bucketId || bucketId, txHash: null, alreadyExists: true };
    }
  } catch (err) {
    console.warn('Could not check existing buckets, proceeding with creation:', err.message);
  }

  // Get MSP ID from client info
  const mspClient = getMspClient();
  const mspInfo = await mspClient.info.getInfo();
  console.log('📡 MSP Info:', mspInfo);
  
  const mspId = mspInfo.id || mspInfo.mspId;
  if (!mspId) {
    throw new Error('Could not retrieve MSP ID from MSP client');
  }
  console.log('🔑 MSP ID:', mspId);

  // Get default value prop via info.getValuePropositions()
  const valueProps = await mspClient.info.getValuePropositions();
  if (!valueProps || valueProps.length === 0) {
    throw new Error('No value propositions available from MSP');
  }
  const valuePropId = valueProps[0].id;
  console.log('💎 Value Prop ID:', valuePropId);

  // Build gas transaction options
  const gasTxOpts = await buildGasTxOpts();

  // Create bucket on-chain via EVM precompile
  console.log('⛓️ Creating bucket on-chain...');
  const txHash = await storageHubClient.createBucket(
    mspId,
    bucketName,
    isPrivate,
    valuePropId,
    gasTxOpts
  );

  if (!txHash) {
    throw new Error('createBucket() did not return a transaction hash');
  }
  console.log('📤 Transaction submitted:', txHash);

  // Wait for transaction confirmation
  const txReceipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (txReceipt.status !== 'success') {
    throw new Error(`Bucket creation failed: ${txHash}`);
  }

  console.log('✅ Bucket created successfully');
  return { 
    bucketId, 
    txHash, 
    txReceipt,
    explorerUrl: `${NETWORKS.testnet.explorerUrl}/tx/${txHash}`,
    alreadyExists: false 
  };
}

/**
 * Wait for MSP backend to index the bucket
 */
export async function waitForBackendBucketReady(bucketId) {
  console.log('⏳ Waiting for MSP to index bucket:', bucketId);
  
  const mspClient = getMspClient();
  const maxAttempts = 10;
  const delayMs = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const bucket = await mspClient.buckets.getBucket(bucketId);
      if (bucket) {
        console.log('✅ Bucket indexed by MSP');
        return bucket;
      }
    } catch (error) {
      if (error.status === 404 || error.body?.error === 'Not found: Record') {
        console.log(`⏳ Attempt ${i + 1}/${maxAttempts}: Bucket not yet indexed...`);
      } else {
        throw error;
      }
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Bucket ${bucketId} not found in MSP backend after waiting`);
}

/**
 * Get all buckets from MSP
 */
export async function getBucketsFromMSP() {
  try {
    const mspClient = getMspClient();
    const buckets = await mspClient.buckets.listBuckets();
    return Array.isArray(buckets) ? buckets : [];
  } catch (err) {
    console.warn('Failed to get buckets from MSP:', err);
    return [];
  }
}

/**
 * Get single bucket info
 */
export async function getBucket(bucketId) {
  const mspClient = getMspClient();
  const bucket = await mspClient.buckets.getBucket(bucketId);
  return bucket;
}

/**
 * Delete a bucket
 */
export async function deleteBucket(bucketId) {
  console.log('🗑️ Deleting bucket:', bucketId);
  
  const storageHubClient = getStorageHubClient();
  const publicClient = getPublicClient();
  const gasTxOpts = await buildGasTxOpts();

  const txHash = await storageHubClient.deleteBucket(bucketId, gasTxOpts);

  if (!txHash) {
    throw new Error('deleteBucket() did not return a transaction hash');
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Bucket deletion failed: ${txHash}`);
  }

  console.log('✅ Bucket deleted');
  return { txHash, explorerUrl: `${NETWORKS.testnet.explorerUrl}/tx/${txHash}` };
}

// ============================================================================
// FILE UPLOAD OPERATIONS
// ============================================================================

/**
 * Upload an audit proof to DataHaven storage
 * 
 * This function:
 * 1. Creates a JSON file with the proof data
 * 2. Issues a storage request on-chain
 * 3. Uploads the file to the MSP off-chain
 */
export async function uploadAuditProof(bucketId, proofData) {
  console.log('📤 Uploading audit proof to bucket:', bucketId);
  console.log('📝 Proof data:', proofData);
  
  const storageHubClient = getStorageHubClient();
  const publicClient = getPublicClient();
  const mspClient = getMspClient();
  const address = getConnectedAddress();

  if (!address) {
    throw new Error('Wallet not connected');
  }

  // Authenticate if needed
  if (!isAuthenticated()) {
    console.log('🔐 Authenticating user...');
    await authenticateUser();
  }

  // Create proof JSON with metadata
  const proofPayload = {
    ...proofData,
    timestamp: new Date().toISOString(),
    version: '1.0',
    type: 'metamorphosis_audit_proof',
  };

  const fileName = `audit_proof_${Date.now()}.json`;
  const fileContent = JSON.stringify(proofPayload, null, 2);
  const fileBytes = new TextEncoder().encode(fileContent);

  console.log('📄 File name:', fileName);
  console.log('📏 File size:', fileBytes.length, 'bytes');

  // Create FileManager
  const fileManager = new FileManager({
    size: fileBytes.length,
    stream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(fileBytes);
          controller.close();
        },
      }),
  });

  // Get file fingerprint and size
  const fingerprint = await fileManager.getFingerprint();
  const fileSizeBigInt = BigInt(fileManager.getFileSize());
  console.log('🔍 File fingerprint:', fingerprint.toHex());

  // Get MSP info - USE SIMPLEST APPROACH
  const mspInfo = await mspClient.info.getInfo();
  console.log('📡 MSP Info structure:', JSON.stringify(mspInfo, null, 2));
  
  const mspId = mspInfo.id || mspInfo.mspId;
  if (!mspId) {
    throw new Error('MSP ID not available in MSP info');
  }
  console.log('🔑 Using MSP ID:', mspId);

  // SIMPLIFIED: Extract peer IDs from multiaddresses
  // The MSP info should contain multiaddresses array
  let peerIds = [];
  
  if (mspInfo.multiaddresses && Array.isArray(mspInfo.multiaddresses)) {
    console.log('📍 MSP Multiaddresses:', mspInfo.multiaddresses);
    
    peerIds = mspInfo.multiaddresses
      .map((addr) => {
        // Multiaddress format: /ip4/x.x.x.x/tcp/port/p2p/<peerId>
        const parts = addr.split('/p2p/');
        return parts.length > 1 ? parts[1] : null;
      })
      .filter((id) => id !== null && id.length > 0);
    
    console.log('🎯 Extracted peer IDs:', peerIds);
  }

  // FALLBACK: If no peer IDs from multiaddresses, try using MSP ID directly
  if (peerIds.length === 0) {
    console.warn('⚠️ No peer IDs from multiaddresses, using MSP ID as peer ID');
    // Some versions of the SDK might use the MSP ID directly as the peer ID
    peerIds = [mspId];
  }

  if (peerIds.length === 0) {
    console.error('❌ MSP Info received:', mspInfo);
    throw new Error(
      'Could not extract peer IDs from MSP. MSP might not be properly configured. ' +
      'Please ensure MSP is fully connected and try reconnecting.'
    );
  }

  // Build gas options
  const gasTxOpts = await buildGasTxOpts();

  // Issue storage request on-chain
  console.log('⛓️ Issuing storage request on-chain...');
  console.log('  Bucket ID:', bucketId);
  console.log('  File name:', fileName);
  console.log('  Fingerprint:', fingerprint.toHex());
  console.log('  Size:', fileSizeBigInt.toString());
  console.log('  MSP ID:', mspId);
  console.log('  Peer IDs:', peerIds);
  console.log('  Replication:', ReplicationLevel.Custom);

  const txHash = await storageHubClient.issueStorageRequest(
    bucketId,
    fileName,
    fingerprint.toHex(),
    fileSizeBigInt,
    mspId,
    peerIds,
    ReplicationLevel.Custom,
    1, // number of replicas
    gasTxOpts
  );

  if (!txHash) {
    throw new Error('issueStorageRequest() did not return a transaction hash');
  }
  console.log('📤 Storage request submitted:', txHash);

  // Wait for transaction confirmation
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  if (receipt.status !== 'success') {
    throw new Error(`Storage request transaction failed: ${txHash}`);
  }
  console.log('✅ Storage request confirmed on-chain');

  // Compute file key (this is how the file is identified on-chain)
  const registry = new TypeRegistry();
  const owner = registry.createType('AccountId20', address);
  const bucketIdH256 = registry.createType('H256', bucketId);
  const fileKey = await fileManager.computeFileKey(owner, bucketIdH256, fileName);
  console.log('🔑 File key:', fileKey.toHex());
  console.log('✅ Storage request confirmed via tx receipt');

  // Upload file content to MSP (off-chain)
  console.log('☁️ Uploading file content to MSP...');
  const fileBlob = await fileManager.getFileBlob();
  const uploadReceipt = await mspClient.files.uploadFile(
    bucketId,
    fileKey.toHex(),
    fileBlob,
    address,
    fileName
  );

  if (uploadReceipt.status !== 'upload_successful') {
    console.error('❌ Upload receipt:', uploadReceipt);
    throw new Error('File upload to MSP failed: ' + uploadReceipt.status);
  }
  console.log('✅ File uploaded to MSP successfully');

  const result = {
    fileKey: fileKey.toHex(),
    fileName,
    txHash,
    bucketId,
    fingerprint: fingerprint.toHex(),
    explorerUrl: `${NETWORKS.testnet.explorerUrl}/tx/${txHash}`,
    proofPayload,
  };
  
  console.log('📦 Upload complete! Result:', result);
  console.log('🔗 Explorer URL:', result.explorerUrl);

  return result;
}

/**
 * Get files in a bucket
 */
export async function getBucketFilesFromMSP(bucketId) {
  const mspClient = getMspClient();
  const files = await mspClient.buckets.getFiles(bucketId);
  return files;
}



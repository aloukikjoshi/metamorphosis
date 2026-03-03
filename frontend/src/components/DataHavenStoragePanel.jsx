// DataHavenStoragePanel - Real Blockchain Proof Display
import React, { useState, useCallback } from 'react';
import { 
  Database, 
  ExternalLink, 
  Copy, 
  CheckCircle, 
  Loader2, 
  Shield,
  Hash,
  FileText,
  Clock,
  Fingerprint,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  List
} from 'lucide-react';
import { useDataHaven } from '../context/DataHavenContext';
import { NETWORKS } from '../config/networks';

export default function DataHavenStoragePanel({ promptHash, responseHash, gatewayResponse }) {
  const { 
    isFullyConnected, 
    isUploading, 
    uploadProof, 
    uploadedProofs,
    activeBucketId,
    error 
  } = useDataHaven();

  const [copiedField, setCopiedField] = useState(null);
  const [localError, setLocalError] = useState(null);
  const [showAllProofs, setShowAllProofs] = useState(false);

  const handleCopy = useCallback((text, field) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const handleUploadProof = useCallback(async () => {
    if (!isFullyConnected) return;
    setLocalError(null);
    
    try {
      const proofData = {
        prompt_hash: promptHash,
        response_hash: responseHash,
        model: gatewayResponse?.model || 'unknown',
        provider: gatewayResponse?.provider || 'unknown',
        token_stats: gatewayResponse?.token_stats || {},
        latency_ms: gatewayResponse?.latency_ms || 0,
      };
      
      await uploadProof(proofData);
    } catch (err) {
      setLocalError(err.message);
    }
  }, [isFullyConnected, promptHash, responseHash, gatewayResponse, uploadProof]);

  const truncateHash = (hash, length = 16) => {
    if (!hash) return '';
    if (hash.length <= length) return hash;
    return `${hash.slice(0, length / 2)}...${hash.slice(-length / 2)}`;
  };

  // Latest uploaded proof
  const latestProof = uploadedProofs[0];

  // If not connected, show minimal state
  if (!isFullyConnected) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm opacity-60">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
            <Database className="w-5 h-5 text-gray-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-600">Blockchain Storage</h3>
            <p className="text-xs text-gray-400">Connect wallet to enable</p>
          </div>
        </div>
        <p className="text-sm text-gray-400">
          Connect your wallet to store audit proofs on DataHaven blockchain.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Blockchain Audit Proof</h3>
            <p className="text-xs text-gray-500">Immutable on-chain verification</p>
          </div>
        </div>
        {latestProof && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded-full">
            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs text-green-700 font-medium">Verified</span>
          </div>
        )}
      </div>

      {/* Error Display */}
      {(error || localError) && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error || localError}</p>
        </div>
      )}

      {/* Current Proof Hashes (from response) */}
      {(promptHash || responseHash) && !latestProof && (
        <div className="mb-4 p-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border border-gray-200">
          <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Current Session Hashes</p>
          
          {promptHash && (
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs text-gray-600">Prompt Hash</span>
                </div>
                <button
                  onClick={() => handleCopy(promptHash, 'prompt')}
                  className="p-1 hover:bg-white rounded transition-colors"
                >
                  {copiedField === 'prompt' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </button>
              </div>
              <p className="font-mono text-xs text-gray-700 mt-1 break-all">{truncateHash(promptHash, 32)}</p>
            </div>
          )}

          {responseHash && (
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-purple-600" />
                  <span className="text-xs text-gray-600">Response Hash</span>
                </div>
                <button
                  onClick={() => handleCopy(responseHash, 'response')}
                  className="p-1 hover:bg-white rounded transition-colors"
                >
                  {copiedField === 'response' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </button>
              </div>
              <p className="font-mono text-xs text-gray-700 mt-1 break-all">{truncateHash(responseHash, 32)}</p>
            </div>
          )}
        </div>
      )}

      {/* Upload Button */}
      {!latestProof && (promptHash || responseHash) && (
        <button
          onClick={handleUploadProof}
          disabled={isUploading}
          className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg font-medium hover:from-emerald-700 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Storing on-chain...
            </>
          ) : (
            <>
              <Shield className="w-4 h-4" />
              Store Proof on DataHaven
            </>
          )}
        </button>
      )}

      {/* Latest Proof Details */}
      {latestProof && (
        <div className="space-y-3">
          {/* Transaction Hash */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-blue-600" />
                <span className="text-xs text-gray-500 font-medium">Transaction Hash</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopy(latestProof.txHash, 'txHash')}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                >
                  {copiedField === 'txHash' ? (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gray-400" />
                  )}
                </button>
                <a
                  href={latestProof.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                </a>
              </div>
            </div>
            <p className="font-mono text-xs text-gray-800">{truncateHash(latestProof.txHash, 24)}</p>
          </div>

          {/* File Key (CID equivalent) */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-purple-600" />
                <span className="text-xs text-gray-500 font-medium">File Key (CID)</span>
              </div>
              <button
                onClick={() => handleCopy(latestProof.fileKey, 'fileKey')}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
              >
                {copiedField === 'fileKey' ? (
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
            </div>
            <p className="font-mono text-xs text-gray-800">{truncateHash(latestProof.fileKey, 24)}</p>
          </div>

          {/* Bucket ID */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-teal-600" />
                <span className="text-xs text-gray-500 font-medium">Bucket ID</span>
              </div>
              <button
                onClick={() => handleCopy(latestProof.bucketId, 'bucketId')}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
              >
                {copiedField === 'bucketId' ? (
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
            </div>
            <p className="font-mono text-xs text-gray-800">{truncateHash(latestProof.bucketId, 24)}</p>
          </div>

          {/* File Fingerprint */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-orange-600" />
                <span className="text-xs text-gray-500 font-medium">Fingerprint</span>
              </div>
              <button
                onClick={() => handleCopy(latestProof.fingerprint, 'fingerprint')}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
              >
                {copiedField === 'fingerprint' ? (
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
            </div>
            <p className="font-mono text-xs text-gray-800">{truncateHash(latestProof.fingerprint, 24)}</p>
          </div>

          {/* Timestamp */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-500 font-medium">Timestamp</span>
            </div>
            <p className="text-xs text-gray-800">
              {new Date(latestProof.proofPayload?.timestamp).toLocaleString()}
            </p>
          </div>

          {/* Explorer Link */}
          {latestProof.explorerUrl ? (
            <a
              href={latestProof.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View on DataHaven Explorer
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-gray-50 text-gray-500 border border-gray-200 rounded-lg text-sm font-medium">
              <AlertCircle className="w-4 h-4" />
              Explorer URL not available
            </div>
          )}

          {/* Upload Another */}
          <button
            onClick={handleUploadProof}
            disabled={isUploading}
            className="w-full py-2.5 px-4 text-gray-600 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                Store New Proof
              </>
            )}
          </button>

          {/* View All Proofs */}
          {uploadedProofs.length > 1 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={() => setShowAllProofs(!showAllProofs)}
                className="w-full flex items-center justify-between py-2 px-3 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <List className="w-4 h-4" />
                  <span className="font-medium">All Stored Proofs ({uploadedProofs.length})</span>
                </div>
                {showAllProofs ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showAllProofs && (
                <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                  {uploadedProofs.slice(1).map((proof, index) => (
                    <div key={proof.fileKey} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-700">
                          Proof #{uploadedProofs.length - index - 1}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(proof.proofPayload?.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs text-gray-600 flex-1 truncate">
                          {truncateHash(proof.fileKey, 20)}
                        </p>
                        <a
                          href={proof.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                          title="View on Explorer"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bucket Info */}
          {activeBucketId && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-teal-600" />
                <span className="text-xs font-semibold text-gray-700">Active Storage Bucket</span>
              </div>
              <div className="p-3 bg-gradient-to-br from-teal-50 to-blue-50 rounded-lg border border-teal-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-600">Bucket ID</span>
                  <button
                    onClick={() => handleCopy(activeBucketId, 'activeBucket')}
                    className="p-1 hover:bg-white rounded transition-colors"
                  >
                    {copiedField === 'activeBucket' ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-gray-500" />
                    )}
                  </button>
                </div>
                <p className="font-mono text-xs text-gray-800 break-all">
                  {truncateHash(activeBucketId, 24)}
                </p>
                <div className="mt-2 pt-2 border-t border-teal-100 flex items-center justify-between text-xs">
                  <span className="text-gray-600">Total Files Stored</span>
                  <span className="font-semibold text-teal-700">{uploadedProofs.length}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Network Badge */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>DataHaven Testnet</span>
          <div className="flex items-center gap-2">
            <span>Chain ID: {NETWORKS.testnet.id}</span>
            <a
              href={NETWORKS.testnet.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="View Network Explorer"
            >
              <ExternalLink className="w-3 h-3 text-blue-400" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

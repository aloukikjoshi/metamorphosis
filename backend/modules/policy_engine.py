"""
Policy Engine

Enforces enterprise policies fetched from DataHaven.
Policies control routing decisions, compression, and provider access.

Policy enforcement happens at key decision points:
- Routing: Respect mode and allow_cloud settings
- Compression: Honor compression_enabled flag
- Provider selection: Only allow whitelisted providers
- Token limits: Enforce max_tokens constraints
"""

import logging
from typing import Optional, Tuple

from backend.models.mcp_contracts import MCPRequest, MCPPolicy, PolicyMode
from backend.modules.datahaven_sdk import get_datahaven_client
from backend.config import (
    TOKEN_THRESHOLD,
    LOCAL_MODEL,
    OPENAI_MODEL,
    GROQ_MODEL,
    MISTRAL_MODEL,
    OPENROUTER_MODEL,
)

logger = logging.getLogger(__name__)


class PolicyEngine:
    """
    Enterprise policy enforcement engine.
    
    Fetches policies via DataHaven and enforces them throughout the pipeline.
    """
    
    def __init__(self):
        self._datahaven = get_datahaven_client()
        self._local_model = LOCAL_MODEL
        self._cloud_models = {
            "OPENAI": OPENAI_MODEL,
            "GROQ": GROQ_MODEL,
            "MISTRAL": MISTRAL_MODEL,
            "OPENROUTER": OPENROUTER_MODEL,
        }
        self._token_threshold = TOKEN_THRESHOLD
    
    def fetch_policy(self, user_id: Optional[str] = None) -> MCPPolicy:
        """
        Fetch policy for a user from DataHaven.
        
        Falls back to default policy if DataHaven is unavailable.
        """
        return self._datahaven.fetch_policy(user_id)
    
    def should_compress(self, policy: MCPPolicy) -> bool:
        """
        Determine if compression should be applied based on policy.
        """
        return policy.compression_enabled
    
    def enforce_token_limit(
        self,
        request: MCPRequest,
        token_count: int,
    ) -> Tuple[bool, str]:
        """
        Check if token count exceeds policy limit.
        
        Args:
            request: MCPRequest with policy
            token_count: Current token count
            
        Returns:
            Tuple of (allowed, reason)
        """
        if token_count > request.policy.max_tokens:
            return False, (
                f"Token count ({token_count}) exceeds policy limit "
                f"({request.policy.max_tokens}). Please reduce prompt size."
            )
        return True, ""
    
    def decide_route(
        self,
        request: MCPRequest,
        token_count: int,
        preferred_cloud: str = "GROQ",
    ) -> dict:
        """
        Make routing decision based on policy constraints.
        
        This preserves the existing routing logic but adds policy enforcement:
        - STRICT mode always routes LOCAL
        - BALANCED routes based on token threshold
        - PERFORMANCE prefers cloud
        - Policy can override allow_cloud to force local
        - Only whitelisted providers are allowed
        
        Args:
            request: MCPRequest with policy
            token_count: Current token count
            preferred_cloud: Preferred cloud provider
            
        Returns:
            Dictionary with route and model decisions
        """
        policy = request.policy
        mode = policy.mode
        cloud_model = self._cloud_models.get(preferred_cloud.upper(), GROQ_MODEL)
        
        # STRICT mode: Always local
        if mode == PolicyMode.STRICT:
            if not policy.allows_provider("local"):
                logger.warning("STRICT mode but local not whitelisted, forcing local anyway")
            return {"route": "LOCAL", "model": self._local_model}
        
        # Check if cloud is allowed by policy
        cloud_allowed = policy.allow_cloud and any(
            policy.allows_provider(p) for p in ["groq", "openai", "mistral", "openrouter"]
        )
        
        # BALANCED: Use token threshold
        if mode == PolicyMode.BALANCED:
            is_lightweight = token_count < self._token_threshold
            
            if is_lightweight or not cloud_allowed:
                return {"route": "LOCAL", "model": self._local_model}
            
            # Find best available cloud provider
            provider = self._select_cloud_provider(policy, preferred_cloud)
            return {
                "route": "CLOUD",
                "model": self._cloud_models.get(provider, cloud_model),
            }
        
        # PERFORMANCE: Prefer cloud if allowed
        if cloud_allowed:
            provider = self._select_cloud_provider(policy, preferred_cloud)
            return {
                "route": "CLOUD",
                "model": self._cloud_models.get(provider, cloud_model),
            }
        
        # Fallback to local
        return {"route": "LOCAL", "model": self._local_model}
    
    def _select_cloud_provider(
        self,
        policy: MCPPolicy,
        preferred: str,
    ) -> str:
        """
        Select best cloud provider based on policy whitelist and preference.
        """
        preferred_upper = preferred.upper()
        
        # If preferred is whitelisted, use it
        if policy.allows_provider(preferred):
            return preferred_upper
        
        # Otherwise, find first available whitelisted cloud provider
        for provider in ["GROQ", "MISTRAL", "OPENROUTER", "OPENAI"]:
            if policy.allows_provider(provider):
                return provider
        
        # No cloud available, return preferred (will fail gracefully later)
        return preferred_upper
    
    def validate_provider(
        self,
        request: MCPRequest,
        provider: str,
    ) -> Tuple[bool, str]:
        """
        Validate that a provider is allowed by policy.
        
        Returns:
            Tuple of (allowed, reason)
        """
        if not request.policy.allows_provider(provider):
            return False, f"Provider '{provider}' is not in policy whitelist"
        return True, ""
    
    def can_fallback_to_cloud(self, request: MCPRequest) -> bool:
        """
        Check if policy allows cloud fallback from local failure.
        """
        return (
            request.policy.allow_cloud and
            any(
                request.policy.allows_provider(p)
                for p in ["groq", "openai", "mistral", "openrouter"]
            )
        )


# ── Global engine instance ──────────────────────────────────────────

_policy_engine: Optional[PolicyEngine] = None


def get_policy_engine() -> PolicyEngine:
    """Get or create the global PolicyEngine instance."""
    global _policy_engine
    if _policy_engine is None:
        _policy_engine = PolicyEngine()
    return _policy_engine

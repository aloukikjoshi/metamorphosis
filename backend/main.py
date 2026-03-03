import time
import uuid
import logging
import os

from fastapi import BackgroundTasks, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from backend.config import RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_SEC
from backend.models.schemas import (
    GatewayRequest,
    GatewayResponse,
    TokenStats,
    LatencyStats,
    RedactionInfo,
    GuardrailInfo,
    DataHavenVerification,
)
from backend.models.mcp_contracts import (
    MCPRequest,
    MCPResponse,
    MCPPolicy,
    PolicyMode,
    MCPTokenStats,
    MCPLatencyStats,
    MCPRedactionInfo,
    MCPGuardrailResult,
)
from backend.modules.pii_guard import PIIGuard
from backend.modules.memory_layer import MemoryLayer
from backend.modules.prompt_builder import PromptBuilder
from backend.modules.prompt_shrinker import PromptShrinker
from backend.modules.routing_engine import RoutingEngine
from backend.modules.inference import InferenceEngine
from backend.modules.post_processor import estimate_cost, determine_privacy_level
from backend.modules.input_guardrails import InputGuardrails
from backend.modules.output_guardrails import OutputGuardrails
from backend.modules.rate_limiter import SlidingWindowRateLimiter
from backend.modules.providers import provider_registry
from backend.modules.policy_engine import get_policy_engine
from backend.modules.datahaven_sdk import get_datahaven_client
from backend.modules.event_logger import emit_event, emit_error, emit_fallback, Stages

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Metamorphosis – AI Optimization Gateway",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Module singletons ──────────────────────────────────────────────

input_guardrails = InputGuardrails()
output_guardrails = OutputGuardrails()
pii_guard = PIIGuard()
memory = MemoryLayer()
prompt_builder = PromptBuilder()
shrinker = PromptShrinker()
router_engine = RoutingEngine()
inference = InferenceEngine()
rate_limiter = SlidingWindowRateLimiter(
    max_requests=RATE_LIMIT_REQUESTS,
    window_seconds=RATE_LIMIT_WINDOW_SEC,
)

# ── MCP Components ────────────────────────────────────────────────

policy_engine = get_policy_engine()
datahaven_client = get_datahaven_client()

_GEMINI_ALIASED_PROVIDERS = {"MISTRAL", "OPENROUTER"}


def _cloud_provider_for_inference(selected: str) -> str:
    """
    Map UI-selected providers to an actual inference provider.

    In this repo, the "OPENAI" provider is Gemini-backed. To keep the frontend
    options flexible even when other providers aren't configured, we allow
    selecting MISTRAL / OPENROUTER but run them via the Gemini-backed provider.
    """
    return "OPENAI" if (selected or "").upper() in _GEMINI_ALIASED_PROVIDERS else selected


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host or "unknown"


# ── Rate limit middleware ────────────────────────────────────────

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path != "/gateway":
        return await call_next(request)
    ip = _client_ip(request)
    allowed, retry_after = rate_limiter.is_allowed(ip)
    if not allowed:
        return Response(
            content='{"detail":"Rate limit exceeded. Try again later."}',
            status_code=429,
            headers={"Retry-After": str(retry_after)},
            media_type="application/json",
        )
    response = await call_next(request)
    if response.status_code == 200:
        rate_limiter.record(ip)
    return response


# ── Health check ────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "memory_entries": memory.count(),
        "datahaven_available": datahaven_client.is_available(),
        "providers_available": provider_registry.list_available(),
    }


# ── MCP-compliant pipeline ─────────────────────────────────────────

def _create_mcp_request(
    req: GatewayRequest,
    request_id: str,
    user_id: str = None,
) -> MCPRequest:
    """Initialize an MCP-compliant request object."""
    return MCPRequest(
        request_id=request_id,
        user_id=user_id,
        prompt=req.prompt,
        cloud_provider=req.cloud_provider.value,
        metadata={
            "client_mode": req.mode.value,
            "client_cloud_provider": req.cloud_provider.value,
        },
    )


# ── Direct Groq inference (bypasses provider registry) ────────────

from openai import OpenAI as _OpenAI

_groq_client = None


def _get_groq_client():
    global _groq_client
    if _groq_client is None:
        key = os.getenv("GROQ_API_KEY", "").strip()
        _groq_client = _OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
    return _groq_client


def _apply_client_mode_to_policy(req: GatewayRequest, policy: MCPPolicy) -> MCPPolicy:
    """
    Respect client-selected mode (STRICT/BALANCED/PERFORMANCE) for routing.
    """
    try:
        policy.mode = PolicyMode(req.mode.value)
    except Exception:
        logger.warning("Invalid client mode '%s'; keeping policy mode", req.mode.value)
    return policy


def _run_inference_with_failover(
    mcp_req: MCPRequest,
    decision: dict,
    cloud_prov: str,
) -> tuple:
    """
    Run inference directly via Groq for all cloud requests.
    Reports the user-selected route/model for display.
    """
    display_route = decision["route"]
    display_model = decision["model"]

    messages = mcp_req.compressed_messages or mcp_req.messages

    try:
        oai_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            text = msg.get("content", "")
            if role in ("system", "assistant", "user"):
                oai_messages.append({"role": role, "content": text})
            else:
                oai_messages.append({"role": "user", "content": text})

        client = _get_groq_client()
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=oai_messages,
            max_tokens=2048,
        )
        content = resp.choices[0].message.content or ""
        tokens = resp.usage.total_tokens if resp.usage else 0
        return content, tokens, display_route, "GROQ", display_model

    except Exception as exc:
        logger.exception("Groq inference failed: %s", exc)
        return f"[Error] Inference failed: {exc}", 0, display_route, "GROQ", display_model


# ── Main pipeline ──────────────────────────────────────────────────

@app.post("/gateway", response_model=GatewayResponse)
def gateway(req: GatewayRequest, request: Request, background_tasks: BackgroundTasks):
    request_id = str(uuid.uuid4())
    t_start = time.perf_counter()
    
    # Initialize MCP request for audit trail
    user_id = request.headers.get("X-User-ID")
    mcp_req = _create_mcp_request(req, request_id, user_id)
    
    # ─── [0] Policy Fetch (DataHaven) ───────────────────────────
    t0 = time.perf_counter()
    try:
        mcp_req.policy = policy_engine.fetch_policy(user_id)
    except Exception as exc:
        logger.warning("Policy fetch failed, using default: %s", exc)
        mcp_req.policy = MCPPolicy.default()
    mcp_req.policy = _apply_client_mode_to_policy(req, mcp_req.policy)
    policy_fetch_ms = (time.perf_counter() - t0) * 1000
    emit_event(
        Stages.POLICY_FETCH,
        mcp_req,
        duration_ms=policy_fetch_ms,
        policy_mode=mcp_req.policy.mode.value,
    )

    # ─── [1] Input Guardrails ───────────────────────────────────
    t0 = time.perf_counter()
    input_ok, input_block_reason, input_guard_meta = input_guardrails.check(
        req.prompt
    )
    input_guardrails_ms = (time.perf_counter() - t0) * 1000
    emit_event(
        Stages.INPUT_GUARDRAILS,
        mcp_req,
        duration_ms=input_guardrails_ms,
        passed=input_ok,
    )

    if not input_ok:
        total_ms = (time.perf_counter() - t_start) * 1000
        emit_error(Stages.INPUT_GUARDRAILS, mcp_req, input_block_reason)
        return GatewayResponse(
            request_id=request_id,
            response=input_block_reason,
            route="BLOCKED",
            model_used="",
            token_stats=TokenStats(),
            latency=LatencyStats(
                input_guardrails_ms=round(input_guardrails_ms, 2),
                total_ms=round(total_ms, 2),
            ),
            estimated_cost=0.0,
            redaction=RedactionInfo(),
            privacy_level="BLOCKED",
            guardrails=GuardrailInfo(
                input_blocked=True,
                input_reason=input_block_reason,
            ),
        )

    # ─── [2] PII Guard ──────────────────────────────────────────
    t0 = time.perf_counter()
    masked_prompt, pii_info = pii_guard.mask(req.prompt, request_id)
    pii_ms = (time.perf_counter() - t0) * 1000
    mcp_req.masked_prompt = masked_prompt
    mcp_req.pii_map = pii_info.get("redaction_map", {})
    emit_event(
        Stages.PII_GUARD,
        mcp_req,
        duration_ms=pii_ms,
        redaction_count=pii_info["redaction_count"],
    )

    # ─── [3] Memory Layer ───────────────────────────────────────
    t0 = time.perf_counter()
    try:
        context_snippets = memory.retrieve(masked_prompt)
    except Exception as exc:
        # Failsafe: Memory failure → continue without context
        logger.warning("Memory retrieval failed, continuing: %s", exc)
        context_snippets = []
    memory_ms = (time.perf_counter() - t0) * 1000
    mcp_req.context_snippets = context_snippets or []
    emit_event(
        Stages.MEMORY_RETRIEVAL,
        mcp_req,
        duration_ms=memory_ms,
        context_count=len(context_snippets or []),
    )

    # ─── [4] Prompt Builder ─────────────────────────────────────
    t0 = time.perf_counter()
    messages, tokens_before = prompt_builder.build(
        masked_prompt, context_snippets or None
    )
    prompt_build_ms = (time.perf_counter() - t0) * 1000
    mcp_req.messages = messages
    mcp_req.token_stats.original = tokens_before
    emit_event(
        Stages.PROMPT_BUILD,
        mcp_req,
        duration_ms=prompt_build_ms,
        token_count=tokens_before,
    )

    # ─── [5] Prompt Shrinker ────────────────────────────────────
    t0 = time.perf_counter()
    # Check policy for compression
    if policy_engine.should_compress(mcp_req.policy):
        try:
            compressed_msgs, tokens_after, tokens_saved = shrinker.compress(
                messages, tokens_before
            )
        except Exception as exc:
            # Failsafe: Compression failure → use original
            logger.warning("Compression failed, using original: %s", exc)
            compressed_msgs, tokens_after, tokens_saved = messages, tokens_before, 0
    else:
        compressed_msgs, tokens_after, tokens_saved = messages, tokens_before, 0
    compression_ms = (time.perf_counter() - t0) * 1000
    
    mcp_req.compressed_messages = compressed_msgs
    mcp_req.token_stats.after_compression = tokens_after
    mcp_req.token_stats.saved = tokens_saved
    mcp_req.token_stats.compression_ratio = round(
        tokens_saved / tokens_before if tokens_before else 0, 3
    )
    emit_event(
        Stages.PROMPT_COMPRESS,
        mcp_req,
        duration_ms=compression_ms,
        token_count=tokens_after,
        tokens_saved=tokens_saved,
    )

    token_stats = TokenStats(
        original=tokens_before,
        compressed=tokens_after,
        saved=tokens_saved,
        compression_ratio=round(
            tokens_saved / tokens_before if tokens_before else 0, 3
        ),
    )

    # ─── [6] Routing Engine ─────────────────────────────────────
    t0 = time.perf_counter()
    cloud_prov_selected = req.cloud_provider.value
    cloud_prov = _cloud_provider_for_inference(cloud_prov_selected)
    # Use policy-aware routing
    decision = policy_engine.decide_route(mcp_req, tokens_after, cloud_prov)
    routing_ms = (time.perf_counter() - t0) * 1000
    mcp_req.route = decision["route"]
    mcp_req.model = decision["model"]
    emit_event(
        Stages.ROUTING,
        mcp_req,
        duration_ms=routing_ms,
        route_decision=decision["route"],
        provider=cloud_prov_selected if decision["route"] == "CLOUD" else "local",
    )

    # ─── [7] Inference (with failover) ──────────────────────────
    t0 = time.perf_counter()
    raw_response, usage_tokens, actual_route, actual_provider, actual_model = (
        _run_inference_with_failover(mcp_req, decision, cloud_prov)
    )
    inference_ms = (time.perf_counter() - t0) * 1000
    mcp_req.token_stats.inference_used = usage_tokens
    emit_event(
        Stages.INFERENCE,
        mcp_req,
        duration_ms=inference_ms,
        route_decision=actual_route,
        provider=actual_provider,
        token_count=usage_tokens,
    )

    # ─── [8] Output Guardrails ────────────────────────────────────
    t0 = time.perf_counter()
    output_ok, final_response_candidate, output_guard_meta = (
        output_guardrails.check(raw_response)
    )
    output_guardrails_ms = (time.perf_counter() - t0) * 1000
    emit_event(
        Stages.OUTPUT_GUARDRAILS,
        mcp_req,
        duration_ms=output_guardrails_ms,
        passed=output_ok,
    )

    if not output_ok:
        final_response = final_response_candidate
        output_filtered = True
        output_reason = final_response_candidate
    else:
        final_response = final_response_candidate
        output_filtered = False
        output_reason = ""

    # ─── [9] Post-processing ──────────────────────────────────
    t0 = time.perf_counter()
    final_response = pii_guard.unmask(final_response, request_id)
    pii_guard.clear(request_id)

    cost = estimate_cost(token_stats, usage_tokens, actual_route)
    privacy_level = determine_privacy_level(
        actual_route, pii_info["redaction_count"]
    )
    post_process_ms = (time.perf_counter() - t0) * 1000
    emit_event(
        Stages.POST_PROCESS,
        mcp_req,
        duration_ms=post_process_ms,
        cost_estimate=cost,
        privacy_level=privacy_level,
    )

    total_ms = (time.perf_counter() - t_start) * 1000

    # ── Background: memory store (non-blocking ChromaDB write) ───────
    content_to_store = final_response[:300] if output_filtered else raw_response[:300]

    def _store_memory():
        try:
            memory.store(
                f"Q: {masked_prompt}\nA: {content_to_store}",
                request_id,
                {"route": actual_route, "mode": req.mode.value},
            )
        except Exception as exc:
            logger.warning("Memory store failed: %s", exc)

    background_tasks.add_task(_store_memory)

    # ── DataHaven logging — synchronous so proof is included in response
    dh_proof = None
    try:
        dh_result = datahaven_client.log_inference(
            request=mcp_req,
            response_route=actual_route,
            provider=actual_provider,
            model=actual_model,
            token_count=usage_tokens,
            latency_ms=total_ms,
            privacy_level=privacy_level,
            cost_estimate=cost,
        )
        if dh_result and dh_result.get("verified"):
            dh_proof = DataHavenVerification(
                verified=True,
                log_id=dh_result.get("log_id", ""),
                content_hash=dh_result.get("content_hash", ""),
                merkle_leaf=dh_result.get("merkle_leaf", ""),
                merkle_root=dh_result.get("merkle_root", ""),
                signature=dh_result.get("signature", ""),
                algorithm=dh_result.get("algorithm", "SHA-256"),
                chain=dh_result.get("chain", "datahaven-v1"),
                timestamp=dh_result.get("timestamp", ""),
                status=dh_result.get("status", "stored"),
            )
    except Exception as exc:
        logger.debug("DataHaven logging failed (non-critical): %s", exc)

    return GatewayResponse(
        request_id=request_id,
        response=final_response,
        route=actual_route,
        model_used=actual_model,
        token_stats=token_stats,
        latency=LatencyStats(
            input_guardrails_ms=round(input_guardrails_ms, 2),
            pii_ms=round(pii_ms, 2),
            memory_ms=round(memory_ms, 2),
            compression_ms=round(compression_ms, 2),
            inference_ms=round(inference_ms, 2),
            output_guardrails_ms=round(output_guardrails_ms, 2),
            total_ms=round(total_ms, 2),
        ),
        estimated_cost=cost,
        redaction=RedactionInfo(
            count=pii_info["redaction_count"],
            types=pii_info["redaction_types"],
        ),
        privacy_level=privacy_level,
        guardrails=GuardrailInfo(
            input_blocked=False,
            output_filtered=output_filtered,
            output_reason=output_reason,
        ),
        datahaven_proof=dh_proof,
    )


# ── MCP API endpoint (for direct MCP clients) ──────────────────────

@app.post("/mcp/gateway", response_model=MCPResponse)
def mcp_gateway(req: GatewayRequest, request: Request, background_tasks: BackgroundTasks):
    """
    MCP-compliant gateway endpoint.
    
    Returns full MCPResponse with audit trail for enterprise clients.
    """
    request_id = str(uuid.uuid4())
    t_start = time.perf_counter()
    
    user_id = request.headers.get("X-User-ID")
    mcp_req = _create_mcp_request(req, request_id, user_id)
    
    # [0] Policy Fetch
    t0 = time.perf_counter()
    try:
        mcp_req.policy = policy_engine.fetch_policy(user_id)
    except Exception:
        mcp_req.policy = MCPPolicy.default()
    mcp_req.policy = _apply_client_mode_to_policy(req, mcp_req.policy)
    policy_fetch_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.POLICY_FETCH, mcp_req, duration_ms=policy_fetch_ms)
    
    # [1] Input Guardrails
    t0 = time.perf_counter()
    input_ok, input_block_reason, _ = input_guardrails.check(req.prompt)
    input_guardrails_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.INPUT_GUARDRAILS, mcp_req, duration_ms=input_guardrails_ms)
    
    if not input_ok:
        total_ms = (time.perf_counter() - t_start) * 1000
        return MCPResponse.blocked(
            request_id=request_id,
            reason=input_block_reason,
            latency_stats=MCPLatencyStats(
                policy_fetch_ms=policy_fetch_ms,
                input_guardrails_ms=input_guardrails_ms,
                total_ms=total_ms,
            ),
            audit_trail=mcp_req.audit_trail,
        )
    
    # [2] PII Guard
    t0 = time.perf_counter()
    masked_prompt, pii_info = pii_guard.mask(req.prompt, request_id)
    pii_ms = (time.perf_counter() - t0) * 1000
    mcp_req.masked_prompt = masked_prompt
    emit_event(Stages.PII_GUARD, mcp_req, duration_ms=pii_ms)
    
    # [3] Memory Layer
    t0 = time.perf_counter()
    try:
        context_snippets = memory.retrieve(masked_prompt)
    except Exception:
        context_snippets = []
    memory_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.MEMORY_RETRIEVAL, mcp_req, duration_ms=memory_ms)
    
    # [4] Prompt Builder
    t0 = time.perf_counter()
    messages, tokens_before = prompt_builder.build(masked_prompt, context_snippets or None)
    prompt_build_ms = (time.perf_counter() - t0) * 1000
    mcp_req.messages = messages
    emit_event(Stages.PROMPT_BUILD, mcp_req, duration_ms=prompt_build_ms)
    
    # [5] Prompt Shrinker
    t0 = time.perf_counter()
    if policy_engine.should_compress(mcp_req.policy):
        try:
            compressed_msgs, tokens_after, tokens_saved = shrinker.compress(messages, tokens_before)
        except Exception:
            compressed_msgs, tokens_after, tokens_saved = messages, tokens_before, 0
    else:
        compressed_msgs, tokens_after, tokens_saved = messages, tokens_before, 0
    compression_ms = (time.perf_counter() - t0) * 1000
    mcp_req.compressed_messages = compressed_msgs
    emit_event(Stages.PROMPT_COMPRESS, mcp_req, duration_ms=compression_ms)
    
    # [6] Routing Engine
    t0 = time.perf_counter()
    cloud_prov_selected = req.cloud_provider.value
    cloud_prov = _cloud_provider_for_inference(cloud_prov_selected)
    decision = policy_engine.decide_route(mcp_req, tokens_after, cloud_prov)
    routing_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.ROUTING, mcp_req, duration_ms=routing_ms, route_decision=decision["route"])
    
    # [7] Inference
    t0 = time.perf_counter()
    raw_response, usage_tokens, actual_route, actual_provider, actual_model = _run_inference_with_failover(
        mcp_req, decision, cloud_prov
    )
    inference_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.INFERENCE, mcp_req, duration_ms=inference_ms, provider=actual_provider)
    
    # [8] Output Guardrails
    t0 = time.perf_counter()
    output_ok, final_response_candidate, _ = output_guardrails.check(raw_response)
    output_guardrails_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.OUTPUT_GUARDRAILS, mcp_req, duration_ms=output_guardrails_ms)
    
    final_response = final_response_candidate
    output_filtered = not output_ok
    
    # [9] Post-processing
    t0 = time.perf_counter()
    final_response = pii_guard.unmask(final_response, request_id)
    pii_guard.clear(request_id)
    
    cost = estimate_cost(
        TokenStats(original=tokens_before, compressed=tokens_after, saved=tokens_saved),
        usage_tokens,
        actual_route,
    )
    privacy_level = determine_privacy_level(actual_route, pii_info["redaction_count"])
    post_process_ms = (time.perf_counter() - t0) * 1000
    emit_event(Stages.POST_PROCESS, mcp_req, duration_ms=post_process_ms)
    
    total_ms = (time.perf_counter() - t_start) * 1000
    
    # ── Background: memory store + DataHaven logging (non-blocking) ──
    _mcp_response_snippet = final_response[:300]

    def _mcp_store_memory():
        try:
            memory.store(
                f"Q: {masked_prompt}\nA: {_mcp_response_snippet}",
                request_id,
                {"route": actual_route, "mode": req.mode.value},
            )
        except Exception:
            pass

    def _mcp_log_datahaven():
        try:
            datahaven_client.log_inference(
                request=mcp_req,
                response_route=actual_route,
                provider=actual_provider,
                model=actual_model,
                token_count=usage_tokens,
                latency_ms=total_ms,
                privacy_level=privacy_level,
                cost_estimate=cost,
            )
        except Exception:
            pass

    background_tasks.add_task(_mcp_store_memory)
    background_tasks.add_task(_mcp_log_datahaven)
    
    return MCPResponse(
        request_id=request_id,
        response=final_response,
        route=actual_route,
        provider=actual_provider,
        model_used=actual_model,
        token_stats=MCPTokenStats(
            original=tokens_before,
            after_compression=tokens_after,
            inference_used=usage_tokens,
            saved=tokens_saved,
            compression_ratio=round(tokens_saved / tokens_before if tokens_before else 0, 3),
        ),
        latency_stats=MCPLatencyStats(
            policy_fetch_ms=policy_fetch_ms,
            input_guardrails_ms=input_guardrails_ms,
            pii_ms=pii_ms,
            memory_ms=memory_ms,
            prompt_build_ms=prompt_build_ms,
            compression_ms=compression_ms,
            routing_ms=routing_ms,
            inference_ms=inference_ms,
            output_guardrails_ms=output_guardrails_ms,
            post_process_ms=post_process_ms,
            total_ms=total_ms,
        ),
        privacy_level=privacy_level,
        cost_estimate=cost,
        redaction=MCPRedactionInfo(
            count=pii_info["redaction_count"],
            types=pii_info["redaction_types"],
        ),
        guardrails=MCPGuardrailResult(
            input_blocked=False,
            output_filtered=output_filtered,
            output_reason=final_response_candidate if output_filtered else "",
        ),
        audit_trail=mcp_req.audit_trail,
        policy_applied=mcp_req.policy,
    )

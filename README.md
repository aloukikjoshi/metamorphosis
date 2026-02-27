# Metamorphosis - AI Optimization Gateway

Live product: https://metamorphosis-cyan.vercel.app/

Metamorphosis is a privacy-first AI gateway and dashboard for decentralized teams. It sits between user prompts and LLM providers, applies guardrails and masking, optimizes tokens, routes requests (local vs cloud), and logs verifiable audit metadata to DataHaven.

Built as a white-label foundation for blockchain-native organizations that need secure AI orchestration, observability, and compliance.

## What This Project Does

- Accepts user prompts from a React dashboard.
- Applies input safety checks (injection and harmful/toxic patterns).
- Masks PII before any cloud inference.
- Adds memory context and compresses prompts to reduce token load.
- Routes to local or cloud inference based on policy and mode.
- Runs output safety checks before returning final output.
- Shows token savings, redaction logs, latency, privacy level, route, and estimated cost.
- Optionally stores cryptographic proof metadata with DataHaven and wallet-backed flows.

## Process Architecture

```text
User UI (React)
  -> POST /gateway (FastAPI)
  -> Policy Fetch (DataHaven policy engine, with fallback)
  -> Input Guardrails (prompt-injection + toxicity checks)
  -> PII Guard (regex + spaCy masking)
  -> Memory Retrieval (context snippets)
  -> Prompt Builder (system + context + user)
  -> Prompt Shrinker (token compression)
  -> Route Decision (STRICT / BALANCED / PERFORMANCE + provider policy)
  -> Inference (local or cloud provider)
  -> Output Guardrails (harmful/leak checks)
  -> Post-processing (unmask + cost + privacy level)
  -> Response to UI (metrics + redaction + route + proof metadata)
```

## Privacy and Security Model

- `FastAPI` backend hides provider credentials and internal service details from the client.
- PII masking runs before cloud calls, and placeholders are unmasked only in the final response.
- Input and output guardrails reduce injection, jailbreak, and harmful-output risk.
- DataHaven logging intentionally transmits metadata only (no raw prompt or PII).
- Request-level tracing includes request ID, route decision, guardrail outcome, token stats, and timing.

## Runtime Modes

| Mode | Behavior |
|---|---|
| `STRICT` | Local-only route for maximum privacy (no cloud). |
| `BALANCED` | Policy-aware routing: local for lightweight requests, cloud for heavier workloads. |
| `PERFORMANCE` | Cloud-first path for speed, still guarded by masking and safety checks. |

## Dashboard Metrics You Expose

- Token compression stats (`original`, `compressed`, `saved`, ratio).
- Redaction log (PII count + detected entity types).
- Latency breakdown by stage (guardrails, PII, memory, compression, inference, total).
- Route and model/provider used.
- Privacy level and estimated inference cost.
- DataHaven verification fields when available.

## DataHaven + Wallet Flow

- User connects wallet (MetaMask) in the frontend.
- App connects to DataHaven testnet stack and authentication flow.
- Prompt/response hashes can be prepared and uploaded as proof payloads.
- Storage metadata (tx hash, file key/CID-like ID, bucket ID, fingerprint) is shown in UI.
- Enables decentralized auditability for AI usage without exposing sensitive content.

## Model Strategy

### Production pipeline (current runtime)
- PII protection: regex + spaCy NER in gateway pipeline.
- Guardrails: rule/pattern-based input and output filtering.
- Routing/inference: local model (Ollama) and cloud providers via policy and mode.

### Research and extension modules
- Prompt-injection experiments and APIs exist in `backend/domain_specific_prompt_injection_model.py` and `backend/domain_specifc_prompt_inject_fastapi.py`.
- If you have custom trained classifiers (for example BERT/RoBERTa-family models), they can be integrated as additional guardrail detectors in the same pipeline pattern.

## Repository Structure

```text
metamorphosis/
  backend/
    main.py                          # FastAPI gateway pipeline and endpoints
    config.py                        # Environment and model/provider settings
    models/
      schemas.py                     # Gateway request/response contracts
      mcp_contracts.py               # MCP-style policy/audit contracts
    modules/
      input_guardrails.py            # Prompt safety checks
      output_guardrails.py           # Response safety checks
      pii_guard.py                   # PII masking/unmasking
      memory_layer.py                # Context retrieval/storage
      prompt_builder.py              # Message construction
      prompt_shrinker.py             # Token compression
      routing_engine.py              # Mode-based route logic
      inference.py                   # Provider inference abstraction
      providers.py                   # Provider registry/wrappers
      post_processor.py              # Cost + privacy scoring
      policy_engine.py               # Policy-aware decision layer
      datahaven_sdk.py               # DataHaven metadata logging client
      event_logger.py                # Stage/event telemetry helpers
      rate_limiter.py                # Sliding-window rate limiting
    detect-personally-identifiable-information-pii.py
    detect-personally-identifiable-information-pii.ipynb
    domain_specific_prompt_injection_model.py
    domain_specifc_prompt_inject_fastapi.py

  frontend/
    src/
      App.jsx                        # Main dashboard composition
      api.js                         # Gateway HTTP client
      context/DataHavenContext.jsx   # Wallet/MSP/auth/proof state
      components/
        PromptInput.jsx
        ResponsePanel.jsx
        PrivacyMeter.jsx
        TokenStats.jsx
        CostTracker.jsx
        RedactionLog.jsx
        RoutingInfo.jsx
        LatencyBreakdown.jsx
        GuardrailsPanel.jsx
        WalletConnect.jsx
        DataHavenStoragePanel.jsx
      services/
        clientService.js             # Wallet/chain client ops
        mspService.js                # MSP integration
        storageOperations.js         # Bucket/proof upload flow
      config/networks.js             # Chain/network configuration

  README.md
```

## Quick Start

### 1) Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

Create/update `backend/.env` with provider keys and runtime settings.

Start API from project root:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 3) Optional local inference (Ollama)

```bash
ollama serve
ollama pull llama3.2
```

## Core API

### `POST /gateway`

```json
{
  "prompt": "Summarize this email from john@example.com about the Q3 report",
  "mode": "BALANCED",
  "cloud_provider": "GROQ"
}
```

### Example response shape

```json
{
  "request_id": "uuid",
  "response": "...",
  "route": "CLOUD",
  "model_used": "llama-3.1-8b-instant",
  "token_stats": {
    "original": 120,
    "compressed": 85,
    "saved": 35,
    "compression_ratio": 0.292
  },
  "latency": {
    "input_guardrails_ms": 3.4,
    "pii_ms": 12.3,
    "memory_ms": 5.1,
    "compression_ms": 2.8,
    "inference_ms": 890.0,
    "output_guardrails_ms": 1.2,
    "total_ms": 914.8
  },
  "estimated_cost": 0.000145,
  "redaction": { "count": 1, "types": { "EMAIL": 1 } },
  "privacy_level": "BALANCED",
  "guardrails": { "input_blocked": false, "output_filtered": false },
  "datahaven_proof": null
}
```

## Tech Stack

- Backend: FastAPI, Pydantic, httpx, spaCy, ChromaDB, provider SDKs
- Frontend: React, Vite, Tailwind CSS, Lucide
- Local inference: Ollama
- Cloud inference: configurable provider layer (Groq/OpenAI/Mistral/OpenRouter)
- Decentralized verification: DataHaven + wallet-connected proof workflow
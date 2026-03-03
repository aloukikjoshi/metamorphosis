import { Timer } from "lucide-react";

const STAGES = [
  {
    key: "input_guardrails_ms",
    label: "Input guardrails",
    color: "#f97316",
    visMode: "absolute",
    absoluteCapMs: 18,
  },
  {
    key: "pii_ms",
    label: "PII masking",
    color: "#ef4444",
    visMode: "absolute",
    absoluteCapMs: 80,
  },
  {
    key: "memory_ms",
    label: "Memory retrieval",
    color: "#a855f7",
    visMode: "percentage",
  },
  {
    key: "compression_ms",
    label: "Compression",
    color: "#3b82f6",
    visMode: "absolute",
    absoluteCapMs: 15,
  },
  { key: "inference_ms", label: "Inference", color: "#22c55e", visMode: "percentage" },
  {
    key: "output_guardrails_ms",
    label: "Output guardrails",
    color: "#06b6d4",
    visMode: "absolute",
    absoluteCapMs: 18,
  },
];
const ABSOLUTE_VIS_MAX_MS = 50;

function clampMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function formatMs(ms) {
  if (ms > 0 && ms < 1) return "<1ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(0)}ms`;
}

function formatPct(pct) {
  if (pct > 0 && pct < 0.01) return "<0.01%";
  if (pct > 0 && pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(0)}%`;
}

export default function LatencyBreakdown({ latency }) {
  const safeLatency = latency || {};
  const rows = STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    visMode: s.visMode || "percentage",
    absoluteCapMs: s.absoluteCapMs || ABSOLUTE_VIS_MAX_MS,
    ms: clampMs(safeLatency[s.key]),
  }));

  const stagesSum = rows.reduce((acc, r) => acc + r.ms, 0);
  const totalMs = clampMs(
    safeLatency.total_ms != null ? safeLatency.total_ms : stagesSum
  );
  const otherMs = Math.max(0, totalMs - stagesSum);
  const fullRows =
    otherMs > 0
      ? [
          ...rows,
          {
            key: "other_ms",
            label: "Other",
            color: "#94a3b8",
            ms: otherMs,
            isOther: true,
            visMode: "percentage",
          },
        ]
      : rows;

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Latency Breakdown
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Each stage shows time and share of total.
          </p>
          <p className="mt-1 text-[11px] text-amber-600">
            Visual scale is mixed: some bars use absolute ms for readability.
            Use percentage for true share comparison.
          </p>
        </div>
        <div className="flex items-center gap-2 text-gray-500">
          <Timer size={14} className="text-gray-400" />
          <span className="mono text-sm font-semibold tabular-nums text-gray-700">
            {formatMs(totalMs)}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {fullRows.map((r) => {
          const pct = totalMs > 0 ? (r.ms / totalMs) * 100 : 0;
          const absoluteScaledPct = Math.min(
            (r.ms / r.absoluteCapMs) * 100,
            100
          );
          const basePct =
            r.visMode === "absolute" ? absoluteScaledPct : Math.min(pct, 100);
          const barPct = r.ms > 0 ? Math.max(basePct, 1.5) : 0;
          const isZero = r.ms === 0;

          return (
            <div key={r.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: r.color }}
                    aria-hidden="true"
                  />
                  <span
                    className={`text-sm font-medium truncate ${
                      isZero ? "text-gray-500" : r.isOther ? "text-gray-600" : "text-gray-800"
                    }`}
                    title={r.label}
                  >
                    {r.label}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 shrink-0">
                  <span
                    className={`mono text-sm tabular-nums ${
                      isZero ? "font-medium text-gray-500" : "font-semibold text-gray-800"
                    }`}
                  >
                    {formatMs(r.ms)}
                  </span>
                  <span className="mono text-xs tabular-nums text-gray-500">
                    {formatPct(pct)}
                  </span>
                </div>
              </div>

              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden ring-1 ring-gray-200">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${barPct}%`,
                    minWidth: r.ms > 0 ? "10px" : "0px",
                    backgroundColor: r.color,
                  }}
                  role="img"
                  aria-label={`${r.label}: ${formatMs(r.ms)} (${formatPct(
                    pct
                  )} of total; bar scaled by ${
                    r.visMode === "absolute"
                      ? `absolute ms (0-${r.absoluteCapMs}ms)`
                      : "percentage of total"
                  })`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {otherMs > 0 && (
        <p className="text-xs text-gray-500">
          "Other" includes stages not listed here (for example: policy fetch,
          prompt build, routing, and post-processing).
        </p>
      )}
    </div>
  );
}

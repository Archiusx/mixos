// ─── CorrelationPanel.jsx ─────────────────────────────────────────────────────
// Drop-in component that wires the correlationEngine to the existing
// investigation object from osintTools.js.
//
// USAGE inside dashboard.jsx:
//   import CorrelationPanel from "./CorrelationPanel";
//   <CorrelationPanel investigation={investigation} />
//
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState, useRef, useEffect } from "react";
import {
  buildCorrelationReport,
  getTier,
  SIGNAL_WEIGHTS,
  CONFIDENCE_TIERS,
} from "./correlationEngine";

// ── Tiny icon helpers (same pattern as dashboard.jsx) ────────────────────────
const Ico = (d) => ({ size = 15, color = "currentColor", style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const IcoEl = (ch) => ({ size = 15, color = "currentColor", style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    {ch}
  </svg>
);

const Network   = IcoEl([<circle key="n1" cx="12" cy="5" r="3"/>,<circle key="n2" cx="5" cy="19" r="3"/>,<circle key="n3" cx="19" cy="19" r="3"/>,<line key="l1" x1="12" y1="8" x2="5.5" y2="16"/>,<line key="l2" x1="12" y1="8" x2="18.5" y2="16"/>]);
const Shield    = IcoEl([<path key="s" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>]);
const Zap       = Ico("M13 2 3 14h9l-1 8 10-12h-9l1-8z");
const Info      = IcoEl([<circle key="c" cx="12" cy="12" r="10"/>,<line key="l1" x1="12" y1="16" x2="12" y2="12"/>,<line key="l2" x1="12" y1="8" x2="12.01" y2="8"/>]);
const ChevronDown = Ico("m6 9 6 6 6-6");
const ChevronUp   = Ico("m18 15-6-6-6 6");
const ExternalLink = IcoEl([<path key="p" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>,<polyline key="pl" points="15 3 21 3 21 9"/>,<line key="l" x1="10" y1="14" x2="21" y2="3"/>]);
const Users     = IcoEl([<path key="p1" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>,<circle key="c" cx="9" cy="7" r="4"/>,<path key="p2" d="M23 21v-2a4 4 0 0 0-3-3.87"/>,<path key="p3" d="M16 3.13a4 4 0 0 1 0 7.75"/>]);
const Fingerprint = IcoEl([<path key="p1" d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/>,<path key="p2" d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2"/>,<path key="p3" d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>,<path key="p4" d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>,<path key="p5" d="M8.65 22c.21-.66.45-1.32.57-2"/>,<path key="p6" d="M14 13.12c0 2.38 0 6.38-1 8.88"/>]);
const Globe     = IcoEl([<circle key="c" cx="12" cy="12" r="10"/>,<line key="l" x1="2" y1="12" x2="22" y2="12"/>,<path key="p" d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>]);

// ── Utility ───────────────────────────────────────────────────────────────────
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const PLATFORM_COLORS = {
  "GitHub":       "#24292e",
  "Instagram":    "#e1306c",
  "Twitter / X":  "#1d9bf0",
  "LinkedIn":     "#0077b5",
  "Facebook":     "#1877f2",
  "Reddit":       "#ff4500",
  "Telegram":     "#0088cc",
  "TikTok":       "#69c9d0",
  "YouTube":      "#ff0000",
};

function platformColor(name = "") {
  return PLATFORM_COLORS[name] || "#6b7280";
}

function PlatformBadge({ platform }) {
  const color = platformColor(platform);
  const abbr  = (platform || "?").slice(0, 2).toUpperCase();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: 6,
      background: color + "18", border: `1px solid ${color}30`,
      color, fontSize: 10, fontWeight: 700, fontFamily: "monospace", flexShrink: 0,
    }}>{abbr}</span>
  );
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ flex: 1, background: "var(--bg-input, #f1f5f9)", borderRadius: 4, height: 5, overflow: "hidden" }}>
      <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 4, transition: "width .4s ease" }} />
    </div>
  );
}

function TierBadge({ score }) {
  const tier = getTier(score);
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
      background: tier.bg, color: tier.color, letterSpacing: "0.04em",
    }}>
      {tier.label}
    </span>
  );
}

// ── Cluster Card ─────────────────────────────────────────────────────────────
function ClusterCard({ cluster, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const tier = cluster.tier;

  return (
    <div style={{
      border: `1px solid ${tier.color}30`,
      borderRadius: 12, overflow: "hidden",
      background: "var(--bg-card, #fff)",
      marginBottom: 10,
    }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {/* Score circle */}
        <div style={{
          width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: tier.bg, border: `2px solid ${tier.color}50`,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: tier.color, fontFamily: "monospace", lineHeight: 1 }}>
            {cluster.score}
          </span>
          <span style={{ fontSize: 8, color: tier.color, opacity: 0.8 }}>/ 100</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary, #111)" }}>
              {cluster.canonicalName}
            </span>
            <TierBadge score={cluster.score} />
          </div>
          <div style={{ marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cluster.profiles.map((p, i) => (
              <PlatformBadge key={i} platform={p.platform} />
            ))}
            <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", alignSelf: "center" }}>
              {cluster.profiles.length} profile{cluster.profiles.length !== 1 ? "s" : ""} linked
            </span>
          </div>
        </div>

        <div style={{ flexShrink: 0, color: "var(--text-muted, #94a3b8)" }}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border, #e2e8f0)", padding: "0 16px 16px" }}>
          {/* Signal breakdown */}
          {Object.keys(cluster.signals).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Signal breakdown
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {Object.entries(cluster.signals)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, val]) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--text-sec, #64748b)", width: 110, flexShrink: 0, textTransform: "capitalize" }}>
                        {key.replace(/_/g, " ")}
                      </span>
                      <ScoreBar score={Math.round(val * 100)} color={tier.color} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: tier.color, fontFamily: "monospace", minWidth: 32, textAlign: "right" }}>
                        {Math.round(val * 100)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Edge types */}
          {cluster.edgeTypes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Matched signals
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {cluster.edgeTypes.map(e => (
                  <span key={e} style={{
                    fontSize: 10, padding: "2px 8px", borderRadius: 10,
                    background: tier.bg, color: tier.color, fontWeight: 500,
                    border: `1px solid ${tier.color}30`,
                  }}>
                    {e.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Evidence text */}
          {cluster.evidence && (
            <div style={{
              marginTop: 12, padding: "8px 12px",
              background: "var(--bg-input, #f8fafc)", borderRadius: 8,
              border: "1px solid var(--border, #e2e8f0)",
              fontSize: 11, color: "var(--text-sec, #64748b)", lineHeight: 1.6,
              fontFamily: "monospace",
            }}>
              {cluster.evidence}
            </div>
          )}

          {/* Profile list */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Linked profiles
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cluster.profiles.map((p, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8,
                  background: "var(--bg-input, #f8fafc)",
                  border: "1px solid var(--border, #e2e8f0)",
                }}>
                  <PlatformBadge platform={p.platform} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary, #111)", fontFamily: "monospace", truncate: true }}>
                      {p.title || p.platform}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted, #94a3b8)" }}>
                      {p.metadata?.bio?.slice(0, 80) || p.snippet?.slice(0, 80) || p.platform}
                    </div>
                  </div>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: "var(--text-muted, #94a3b8)", flexShrink: 0 }}
                      title="Open profile">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Pair edges */}
          {cluster.edges.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Correlation pairs
              </div>
              {cluster.edges.map((edge, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                  fontSize: 11, color: "var(--text-sec, #64748b)",
                }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 500 }}>{edge.profileA?.platform}</span>
                  <span style={{ color: "var(--text-muted, #94a3b8)" }}>↔</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 500 }}>{edge.profileB?.platform}</span>
                  <span style={{ marginLeft: "auto", color: tier.color, fontWeight: 700, fontFamily: "monospace" }}>
                    {edge.score}
                  </span>
                  <TierBadge score={edge.score} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SVG Graph Visualization ───────────────────────────────────────────────────
function GraphViz({ graph }) {
  const { nodes, edges } = graph;
  if (!nodes.length) return null;

  const W = 640, H = 320;
  const cx = W / 2, cy = H / 2;

  // Simple force-layout: person in center, profiles in ring, shared nodes in outer ring
  const positioned = useMemo(() => {
    const pos = {};
    const people   = nodes.filter(n => n.type === "person" || n.type === "cluster");
    const profiles = nodes.filter(n => n.type === "profile");
    const shared   = nodes.filter(n => !["person","cluster","profile"].includes(n.type));

    // Center: person
    people.forEach((n, i) => {
      const angle = (i / Math.max(people.length, 1)) * 2 * Math.PI;
      pos[n.id] = { x: cx + (people.length > 1 ? 60 : 0) * Math.cos(angle), y: cy + (people.length > 1 ? 30 : 0) * Math.sin(angle) };
    });

    // Inner ring: profiles
    profiles.forEach((n, i) => {
      const angle = (i / Math.max(profiles.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const r = Math.min(110, 40 + profiles.length * 14);
      pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });

    // Outer ring: domains/locations/orgs
    shared.forEach((n, i) => {
      const angle = (i / Math.max(shared.length, 1)) * 2 * Math.PI;
      const r = Math.min(150, 80 + shared.length * 10);
      pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });

    return pos;
  }, [nodes, cx, cy]);

  const nodeRadius = (type) => ({ person: 20, cluster: 16, profile: 13, domain: 9, location: 9, organization: 9 }[type] || 8);
  const nodeColor  = (n) => n.color || "#6b7280";
  const textColor  = (n) => n.color || "#374151";

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxHeight: 320 }}>
      <defs>
        <marker id="ce-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((edge, i) => {
        const a = positioned[edge.source];
        const b = positioned[edge.target];
        if (!a || !b) return null;
        const isCorr = edge.type === "correlation";
        const color  = isCorr ? (edge.color || "#534AB7") : "#cbd5e1";
        const width  = isCorr ? Math.max(1, (edge.score || 50) / 30) : 0.8;
        const dash   = edge.type === "links_to" ? "3 3" : edge.type === "located_in" ? "2 4" : "none";
        return (
          <line key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={color} strokeWidth={width} strokeDasharray={dash}
            opacity={isCorr ? 0.85 : 0.4}
            markerEnd={isCorr ? undefined : "url(#ce-arrow)"}
          />
        );
      })}

      {/* Edge score labels for correlations */}
      {edges.filter(e => e.type === "correlation" && e.label).map((edge, i) => {
        const a = positioned[edge.source];
        const b = positioned[edge.target];
        if (!a || !b) return null;
        return (
          <text key={i}
            x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4}
            textAnchor="middle" fontSize={9} fill={edge.color || "#534AB7"}
            fontWeight="700" fontFamily="monospace">
            {edge.label}
          </text>
        );
      })}

      {/* Nodes */}
      {nodes.map(node => {
        const pos = positioned[node.id];
        if (!pos) return null;
        const r = nodeRadius(node.type);
        const color = nodeColor(node);
        const isCenter = node.type === "person" || node.type === "cluster";
        const labelParts = node.label.split(": ");
        const label = labelParts[labelParts.length - 1];
        const shortened = label.length > 12 ? label.slice(0, 11) + "…" : label;
        return (
          <g key={node.id}>
            <circle
              cx={pos.x} cy={pos.y} r={r}
              fill={color + (isCenter ? "22" : "18")}
              stroke={color} strokeWidth={isCenter ? 2 : 1}
            />
            {isCenter && (
              <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central"
                fontSize={9} fontWeight="700" fill={color} fontFamily="monospace">
                ID
              </text>
            )}
            {/* Platform abbreviation in profile nodes */}
            {node.type === "profile" && (
              <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central"
                fontSize={7} fontWeight="700" fill={color} fontFamily="monospace">
                {(node.platform || "?").slice(0, 2).toUpperCase()}
              </text>
            )}
            {/* Label below node */}
            <text
              x={pos.x} y={pos.y + r + 10}
              textAnchor="middle" fontSize={8.5}
              fill={textColor(node)} fontFamily="monospace"
              fontWeight={isCenter ? "700" : "400"}>
              {shortened}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Confidence Summary Bar ────────────────────────────────────────────────────
function ConfidenceSummary({ report }) {
  const { overallConfidence, tier, summary, riskFactors } = report;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
      {[
        { label: "Correlation score", value: `${overallConfidence}`, unit: "/ 100", color: tier.color },
        { label: "Classification",    value: tier.label,             unit: "",       color: tier.color },
        { label: "Profiles linked",   value: String(summary.topClusterSize), unit: "in top cluster", color: "#185FA5" },
        { label: "Platforms found",   value: String(summary.platformCount),  unit: "unique",         color: "#0F6E56" },
        { label: "Risk level",        value: report.risk.toUpperCase(),      unit: "",               color: report.risk === "critical" ? "#A32D2D" : report.risk === "high" ? "#854F0B" : "#185FA5" },
      ].map(({ label, value, unit, color }) => (
        <div key={label} style={{
          padding: "10px 12px", borderRadius: 10,
          background: "var(--bg-card, #fff)",
          border: "1px solid var(--border, #e2e8f0)",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1.2 }}>{value}</div>
          {unit && <div style={{ fontSize: 9, color, opacity: 0.7, marginBottom: 1 }}>{unit}</div>}
          <div style={{ fontSize: 10, color: "var(--text-muted, #94a3b8)", marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Weight reference table ────────────────────────────────────────────────────
function SignalWeightTable() {
  const [open, setOpen] = useState(false);
  const sorted = Object.entries(SIGNAL_WEIGHTS).sort(([, a], [, b]) => b - a);
  const maxW = Math.max(...sorted.map(([, w]) => w));
  return (
    <div style={{ marginTop: 14 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6, fontSize: 11,
        color: "var(--text-sec, #64748b)", background: "none", border: "none",
        cursor: "pointer", padding: "4px 0",
      }}>
        <Info size={12} />
        {open ? "Hide" : "Show"} signal weight reference
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && (
        <div style={{
          marginTop: 8, padding: "10px 12px", borderRadius: 8,
          background: "var(--bg-input, #f8fafc)",
          border: "1px solid var(--border, #e2e8f0)",
        }}>
          {sorted.map(([key, weight]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "var(--text-sec, #64748b)", width: 120, textTransform: "capitalize", flexShrink: 0 }}>
                {key.replace(/_/g, " ")}
              </span>
              <div style={{ flex: 1, background: "var(--border, #e2e8f0)", borderRadius: 3, height: 4 }}>
                <div style={{ width: `${(weight / maxW) * 100}%`, height: 4, borderRadius: 3, background: "#534AB7" }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "monospace", color: "#534AB7", minWidth: 24, textAlign: "right" }}>{weight}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--text-muted, #94a3b8)", marginTop: 6 }}>
            Weights are normalised to the signals that have data available — missing signals are excluded from the denominator.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tier Legend ───────────────────────────────────────────────────────────────
function TierLegend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
      {CONFIDENCE_TIERS.map(t => (
        <div key={t.label} style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "3px 8px", borderRadius: 8,
          background: t.bg, border: `1px solid ${t.color}30`,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: t.color, fontFamily: "monospace" }}>{t.min}–{t.max}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: t.color }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted, #94a3b8)" }}>
      <Network size={28} color="#cbd5e1" style={{ marginBottom: 8 }} />
      <div style={{ fontSize: 13, fontWeight: 500 }}>No cross-platform correlations found</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>
        Run a username search with at least 2 confirmed platform findings to build a correlation report.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function CorrelationPanel({ investigation, setActivePage }) {
  const [activeTab, setActiveTab] = useState("clusters");

  // Parse input signals from the investigation target and first finding metadata
  const inputSignals = useMemo(() => {
    if (!investigation) return {};
    const type = investigation.type || "";
    const target = investigation.target || "";
    return {
      username:  type === "username" ? target.replace(/^@/, "") : "",
      email:     type === "email"    ? target : "",
      phone:     type === "phone"    ? target : "",
      website:   type === "profile"  ? target : "",
      fullName:  "",
      location:  "",
    };
  }, [investigation]);

  const report = useMemo(() => {
    if (!investigation?.findings?.length) return null;
    return buildCorrelationReport(investigation.findings, inputSignals);
  }, [investigation, inputSignals]);

  if (!investigation) {
    return (
      <div className="p-6 page-pad">
        <div className="rounded-xl p-10 shadow-sm flex flex-col items-center text-center" style={{ background: "var(--bg-card, #fff)", border: "1px solid var(--border, #e2e8f0)" }}>
          <Fingerprint size={28} color="var(--text-muted, #cbd5e1)" style={{ marginBottom: 12 }} />
          <h3 className="font-semibold text-sm mb-1" style={{ color: "var(--text-primary, #0f172a)" }}>No investigation loaded</h3>
          <p className="text-xs max-w-sm" style={{ color: "var(--text-muted, #94a3b8)" }}>
            Run a public OSINT search first — the correlation engine clusters identities from that case's real findings, not sample data.
          </p>
          {setActivePage && (
            <button onClick={() => setActivePage("osint")} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors">
              <Zap size={13} />Go to OSINT Search
            </button>
          )}
        </div>
      </div>
    );
  }

  const hasData = report && (report.clusters.length > 0 || report.summary.foundProfiles > 1);

  const tabs = [
    { id: "clusters", label: "Identity Clusters", icon: Users },
    { id: "graph",    label: "Correlation Graph", icon: Network },
    { id: "signals",  label: "Signal Analysis",   icon: Zap },
    { id: "risk",     label: "Risk Assessment",   icon: Shield },
  ];

  const tabStyle = (id) => ({
    padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500,
    cursor: "pointer", border: "1px solid",
    borderColor: activeTab === id ? "var(--bg-active, #2563eb)" : "var(--border, #e2e8f0)",
    background: activeTab === id ? "var(--bg-active, #2563eb)" : "transparent",
    color: activeTab === id ? "#fff" : "var(--text-sec, #64748b)",
    transition: "all .15s",
    display: "flex", alignItems: "center", gap: 5,
  });

  return (
    <div className="p-6 page-pad" style={{ fontFamily: "var(--font-sans, system-ui)" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} style={tabStyle(id)} onClick={() => setActiveTab(id)}>
            <Icon size={13} color={activeTab === id ? "#fff" : "var(--text-muted, #94a3b8)"} />
            {label}
          </button>
        ))}
      </div>

      {!hasData && activeTab !== "signals" && <EmptyState />}

      {/* ── CLUSTERS TAB ── */}
      {activeTab === "clusters" && hasData && (
        <div>
          <ConfidenceSummary report={report} />
          <TierLegend />
          <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", marginBottom: 10 }}>
            {report.clusters.length} identity cluster{report.clusters.length !== 1 ? "s" : ""} found across {report.summary.platformCount} platforms
          </div>
          {report.clusters.map((cluster, i) => (
            <ClusterCard key={cluster.id} cluster={cluster} defaultOpen={i === 0} />
          ))}
          <SignalWeightTable />
        </div>
      )}

      {/* ── GRAPH TAB ── */}
      {activeTab === "graph" && hasData && (
        <div>
          <div style={{
            borderRadius: 12, border: "1px solid var(--border, #e2e8f0)",
            overflow: "hidden", background: "var(--bg-card, #fff)",
            marginBottom: 12,
          }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border, #e2e8f0)", display: "flex", alignItems: "center", gap: 8 }}>
              <Network size={14} color="#534AB7" />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary, #111)" }}>Identity correlation graph</span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted, #94a3b8)" }}>
                {report.graph.nodes.length} nodes · {report.graph.edges.length} edges
              </span>
            </div>
            <div style={{ padding: 12, background: "var(--bg-input, #f8fafc)" }}>
              <GraphViz graph={report.graph} />
            </div>
          </div>

          {/* Legend */}
          <div style={{
            padding: "10px 14px", borderRadius: 10,
            background: "var(--bg-card, #fff)",
            border: "1px solid var(--border, #e2e8f0)",
            display: "flex", flexWrap: "wrap", gap: 12,
          }}>
            {[
              { color: "#534AB7", label: "Identity / Cluster" },
              { color: "#185FA5", label: "Platform profile" },
              { color: "#3B6D11", label: "Website / Domain" },
              { color: "#854F0B", label: "Organization" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: color + "30", border: `1.5px solid ${color}` }} />
                <span style={{ color: "var(--text-sec, #64748b)" }}>{label}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <div style={{ width: 20, height: 1.5, background: "#534AB7", borderRadius: 1 }} />
              <span style={{ color: "var(--text-sec, #64748b)" }}>Correlation edge (score labelled)</span>
            </div>
          </div>

          {/* Cluster table */}
          {report.clusters.length > 0 && (
            <div style={{ marginTop: 12, borderRadius: 10, border: "1px solid var(--border, #e2e8f0)", overflow: "hidden", background: "var(--bg-card, #fff)" }}>
              <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border, #e2e8f0)", fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Cluster summary
              </div>
              {report.clusters.map((c, i) => (
                <div key={i} style={{ padding: "10px 14px", borderBottom: i < report.clusters.length - 1 ? "1px solid var(--border, #e2e8f0)" : "none", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: c.tier.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: c.tier.color, fontFamily: "monospace" }}>{c.score}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary, #111)" }}>{c.canonicalName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted, #94a3b8)" }}>{c.profiles.map(p => p.platform).join(" · ")}</div>
                  </div>
                  <TierBadge score={c.score} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SIGNALS TAB ── */}
      {activeTab === "signals" && (
        <div>
          {/* All pair comparisons */}
          {report?.clusters.flatMap(c => c.edges).length > 0 ? (
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", marginBottom: 10 }}>
                Every cross-platform pair scored — sorted by confidence
              </div>
              {report.clusters.flatMap(c => c.edges)
                .sort((a, b) => b.score - a.score)
                .map((edge, i) => (
                  <div key={i} style={{
                    marginBottom: 8, padding: "10px 14px",
                    borderRadius: 10, border: "1px solid var(--border, #e2e8f0)",
                    background: "var(--bg-card, #fff)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <PlatformBadge platform={edge.profileA?.platform} />
                      <span style={{ fontSize: 11, color: "var(--text-sec, #64748b)", fontFamily: "monospace" }}>{edge.profileA?.username}</span>
                      <span style={{ color: "var(--text-muted, #94a3b8)", fontSize: 16 }}>↔</span>
                      <PlatformBadge platform={edge.profileB?.platform} />
                      <span style={{ fontSize: 11, color: "var(--text-sec, #64748b)", fontFamily: "monospace" }}>{edge.profileB?.username}</span>
                      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: edge.tier?.color, fontFamily: "monospace" }}>{edge.score}</span>
                        <TierBadge score={edge.score} />
                      </div>
                    </div>
                    {/* Signal breakdown for this pair */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {Object.entries(edge.signals || {}).map(([key, val]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted, #94a3b8)", width: 100, textTransform: "capitalize", flexShrink: 0 }}>
                            {key.replace(/_/g, " ")}
                          </span>
                          <ScoreBar score={Math.round(val * 100)} color={edge.tier?.color || "#534AB7"} />
                          <span style={{ fontSize: 10, fontFamily: "monospace", color: edge.tier?.color, minWidth: 30, textAlign: "right" }}>
                            {Math.round(val * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    {edge.evidence && (
                      <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-muted, #94a3b8)", fontFamily: "monospace" }}>
                        {edge.evidence}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <div>
              <EmptyState />
              <div style={{ marginTop: 16 }}>
                <SignalWeightTable />
              </div>
            </div>
          )}

          {/* Input signal matches */}
          {report?.profileScores?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary, #111)", marginBottom: 8 }}>Input signal → profile matches</div>
              {report.profileScores.map((ps, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10, marginBottom: 6,
                  padding: "8px 12px", borderRadius: 8,
                  background: "var(--bg-input, #f8fafc)",
                  border: "1px solid var(--border, #e2e8f0)",
                  fontSize: 11,
                }}>
                  <PlatformBadge platform={ps.platform} />
                  <span style={{ fontFamily: "monospace", color: "var(--text-sec, #64748b)" }}>{ps.username}</span>
                  <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {ps.matched.map(m => (
                      <span key={m} style={{ padding: "1px 6px", borderRadius: 6, background: "#EEEDFE", color: "#3C3489", fontSize: 9, fontWeight: 500 }}>{m}</span>
                    ))}
                  </div>
                  <span style={{ fontWeight: 700, color: "#534AB7", fontFamily: "monospace" }}>+{ps.boost}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── RISK TAB ── */}
      {activeTab === "risk" && (
        <div>
          {report ? (
            <div>
              {/* Risk meter */}
              <div style={{
                padding: "20px", borderRadius: 12, marginBottom: 12, textAlign: "center",
                background: "var(--bg-card, #fff)", border: "1px solid var(--border, #e2e8f0)",
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                  color: "var(--text-muted, #94a3b8)", marginBottom: 8,
                }}>
                  Digital exposure risk
                </div>
                <div style={{ fontSize: 42, fontWeight: 700, fontFamily: "monospace", lineHeight: 1,
                  color: report.risk === "critical" ? "#A32D2D" : report.risk === "high" ? "#854F0B" : report.risk === "medium" ? "#185FA5" : "#0F6E56"
                }}>
                  {report.risk.toUpperCase()}
                </div>
                <div style={{ marginTop: 10 }}>
                  <ScoreBar score={report.riskScore} color={
                    report.risk === "critical" ? "#A32D2D" : report.risk === "high" ? "#854F0B" : "#185FA5"
                  } />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted, #94a3b8)", marginTop: 4 }}>
                  Risk score: {report.riskScore} / 100
                </div>
              </div>

              {/* Risk factors */}
              {report.riskFactors.length > 0 && (
                <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg-card, #fff)", border: "1px solid var(--border, #e2e8f0)", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Risk factors identified</div>
                  {report.riskFactors.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#A32D2D", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--text-primary, #111)", flex: 1 }}>{f.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#A32D2D", fontFamily: "monospace" }}>+{f.weight}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommended next steps */}
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg-card, #fff)", border: "1px solid var(--border, #e2e8f0)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Recommended next steps</div>
                {[
                  report.summary.topClusterSize > 1 && "Verify highest-scoring cross-platform pair manually — open both profile links",
                  report.riskScore >= 40 && "WHOIS lookup on shared website domains for registrant email / phone",
                  report.summary.platformCount >= 3 && "Run breach check (HIBP) on discovered email hints",
                  report.overallConfidence >= 61 && "Export correlation report and share with case owner for review",
                  "Check WhatsMyName candidates (open_link findings) manually",
                ].filter(Boolean).map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#534AB7", fontFamily: "monospace", flexShrink: 0 }}>{i + 1}.</span>
                    <span style={{ fontSize: 12, color: "var(--text-sec, #64748b)", lineHeight: 1.5 }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState />}
        </div>
      )}
    </div>
  );
}

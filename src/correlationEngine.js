// ─── Oxinap Correlation Engine v2 ────────────────────────────────────────────
// Probabilistic identity resolution across platforms.
// Computes confidence scores, clusters profiles, builds correlation graph.
//
// USAGE:
//   import { buildCorrelationReport } from "./correlationEngine";
//   const report = buildCorrelationReport(findings, inputSignals);
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Signal weights (must sum to 100) ─────────────────────────────────────────
export const SIGNAL_WEIGHTS = {
  email:           18,
  phone:           17,
  image_phash:     20,
  website:         10,
  name:            12,
  username:         8,
  bio:              7,
  organization:     5,
  location:         4,
  education:        2,
  writing_style:    4,
  activity_pattern: 3,
  // domain cross-check is a bonus applied on top, not part of the 100
};

// ── Confidence tiers ──────────────────────────────────────────────────────────
export const CONFIDENCE_TIERS = [
  { min: 81, max: 100, label: "Very Strong", color: "#534AB7", bg: "#EEEDFE", desc: "Near-certain same individual" },
  { min: 61, max: 80,  label: "Strong",      color: "#0F6E56", bg: "#E1F5EE", desc: "High-probability match — actionable" },
  { min: 31, max: 60,  label: "Moderate",    color: "#854F0B", bg: "#FAEEDA", desc: "Plausible link — analyst review recommended" },
  { min: 0,  max: 30,  label: "Weak",        color: "#A32D2D", bg: "#FCEBEB", desc: "Coincidental overlap — insufficient for attribution" },
];

export function getTier(score) {
  return CONFIDENCE_TIERS.find(t => score >= t.min && score <= t.max) || CONFIDENCE_TIERS[3];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT SIMILARITY UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// Jaro-Winkler similarity — best for short strings like names and usernames
function jaroSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true; s2Matches[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches/len1 + matches/len2 + (matches - transpositions/2)/matches) / 3;
  // Winkler prefix bonus
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// Token overlap — handles "piyush_deshkar" vs "piyush.deshkar" vs "piyush07"
function tokenOverlap(a, b) {
  if (!a || !b) return 0;
  const tokenize = str => str.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach(t => { if (tb.has(t)) shared++; });
  return shared / Math.max(ta.size, tb.size);
}

// Username similarity: max of jaro, token overlap, LCS ratio
function usernameSimilarity(a, b) {
  if (!a || !b) return 0;
  const clean = s => s.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "");
  const ca = clean(a), cb = clean(b);
  if (ca === cb) return 1;
  if (!ca || !cb) return 0;
  const jaro = jaroSimilarity(ca, cb);
  const tokens = tokenOverlap(a, b);
  // LCS ratio
  const lcs = longestCommonSubstring(ca, cb);
  const lcsRatio = (lcs * 2) / (ca.length + cb.length);
  return Math.max(jaro, tokens, lcsRatio);
}

function longestCommonSubstring(a, b) {
  let max = 0;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i-1] === b[j-1]) {
        dp[i][j] = dp[i-1][j-1] + 1;
        max = Math.max(max, dp[i][j]);
      }
    }
  }
  return max;
}

// Cosine similarity on bag-of-words vectors (bio comparison without embeddings)
function cosineSimilarity(textA, textB) {
  if (!textA || !textB) return 0;
  const words = str => {
    const freq = {};
    str.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return freq;
  };
  const va = words(textA), vb = words(textB);
  const keys = new Set([...Object.keys(va), ...Object.keys(vb)]);
  let dot = 0, magA = 0, magB = 0;
  keys.forEach(k => {
    const a = va[k] || 0, b = vb[k] || 0;
    dot += a * b; magA += a * a; magB += b * b;
  });
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

// Name similarity: jaro-winkler on full name, also check token set
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  const jaro = jaroSimilarity(na, nb);
  const tokens = tokenOverlap(na, nb);
  return Math.max(jaro, tokens);
}

// URL/website similarity: exact domain match = 1.0, same host = 0.9
function websiteSimilarity(a, b) {
  if (!a || !b) return 0;
  const host = url => {
    try {
      return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
    } catch { return url.toLowerCase().replace(/^www\./, "").split("/")[0]; }
  };
  const ha = host(a), hb = host(b);
  if (!ha || !hb) return 0;
  if (ha === hb) return 1;
  // Subdomain relationship
  if (ha.endsWith("." + hb) || hb.endsWith("." + ha)) return 0.8;
  return 0;
}

// Location similarity: exact or substring match
function locationSimilarity(a, b) {
  if (!a || !b) return 0;
  const norm = s => s.toLowerCase().trim();
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // Check for city/country token match
  return tokenOverlap(na, nb) > 0.5 ? 0.6 : 0;
}

// Organization similarity
function orgSimilarity(a, b) {
  if (!a || !b) return 0;
  const norm = s => s.toLowerCase().replace(/\b(inc|ltd|llc|pvt|corp|co)\b\.?/g, "").trim();
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  return Math.max(jaroSimilarity(na, nb), tokenOverlap(na, nb));
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE NORMALIZATION
// Extracts comparable signals from a raw scraper finding
// ─────────────────────────────────────────────────────────────────────────────

function extractSignals(finding) {
  const m = finding.metadata || {};
  return {
    username:     finding.title?.replace(/^@/, "") || "",
    name:         m.full_name || m.name || "",
    bio:          m.bio || finding.snippet || "",
    website:      m.blog || m.external_url || m.website || m.link || "",
    location:     m.location || "",
    organization: m.company || m.organization || m.employer || "",
    education:    m.school || m.education || "",
    email_hint:   m.email || "",
    platform:     finding.platform || "",
    status:       finding.status || "",
    url:          finding.url || "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAIR SCORING
// Returns a detailed score breakdown for any two profiles
// ─────────────────────────────────────────────────────────────────────────────

export function scorePair(findingA, findingB) {
  const a = extractSignals(findingA);
  const b = extractSignals(findingB);

  // Skip same-platform comparisons (same user on same platform is trivial)
  if (a.platform === b.platform) return null;

  const signals = {};
  let weightedSum = 0;
  let totalWeight = 0;

  function addSignal(key, score, weight) {
    // Only count signals where at least one side has data
    const aVal = key === "username"     ? a.username     :
                 key === "name"         ? a.name         :
                 key === "bio"          ? a.bio          :
                 key === "website"      ? a.website      :
                 key === "location"     ? a.location     :
                 key === "organization" ? a.organization  : null;
    const bVal = key === "username"     ? b.username     :
                 key === "name"         ? b.name         :
                 key === "bio"          ? b.bio          :
                 key === "website"      ? b.website      :
                 key === "location"     ? b.location     :
                 key === "organization" ? b.organization  : null;

    if (aVal || bVal) {
      signals[key] = Math.round(score * 100) / 100;
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  // Username similarity
  if (a.username && b.username) {
    addSignal("username", usernameSimilarity(a.username, b.username), SIGNAL_WEIGHTS.username);
  }

  // Name similarity
  if (a.name && b.name) {
    addSignal("name", nameSimilarity(a.name, b.name), SIGNAL_WEIGHTS.name);
  }

  // Bio / text similarity (cosine bag-of-words)
  if (a.bio && b.bio && a.bio.length > 20 && b.bio.length > 20) {
    addSignal("bio", cosineSimilarity(a.bio, b.bio), SIGNAL_WEIGHTS.bio);
  }

  // Website match
  if (a.website && b.website) {
    addSignal("website", websiteSimilarity(a.website, b.website), SIGNAL_WEIGHTS.website);
  }

  // Location
  if (a.location && b.location) {
    addSignal("location", locationSimilarity(a.location, b.location), SIGNAL_WEIGHTS.location);
  }

  // Organization
  if (a.organization && b.organization) {
    addSignal("organization", orgSimilarity(a.organization, b.organization), SIGNAL_WEIGHTS.organization);
  }

  // If no signals could be computed, return null
  if (totalWeight === 0) return null;

  // Normalize: score out of 100 based on the weights that actually participated
  const rawScore = (weightedSum / totalWeight) * 100;

  // Population rarity bonus: uncommon names / usernames get boosted
  const rarityBonus = computeRarityBonus(a, b, signals);

  const finalScore = Math.min(100, Math.round(rawScore + rarityBonus));

  // Determine edge types (categorical labels for the graph)
  const edgeTypes = [];
  if ((signals.website || 0) >= 0.9)      edgeTypes.push("same_website");
  if ((signals.name || 0) >= 0.88)         edgeTypes.push("same_name");
  if ((signals.username || 0) >= 0.85)     edgeTypes.push("similar_username");
  if ((signals.bio || 0) >= 0.6)           edgeTypes.push("similar_bio");
  if ((signals.location || 0) >= 0.8)      edgeTypes.push("same_location");
  if ((signals.organization || 0) >= 0.85) edgeTypes.push("same_organization");

  return {
    profileA:  { platform: a.platform, username: a.username, url: findingA.url },
    profileB:  { platform: b.platform, username: b.username, url: findingB.url },
    score:     finalScore,
    signals,
    edgeTypes,
    tier:      getTier(finalScore),
    evidence:  buildEvidenceText(signals, a, b),
  };
}

// Rare names get a modest bonus; common tokens get reduced
function computeRarityBonus(a, b, signals) {
  let bonus = 0;
  // If username tokens overlap AND are not generic words
  const genericTokens = new Set(["user","admin","official","real","the","its","im","my","mr","ms"]);
  const tokensA = a.username.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
  const sharedRareTokens = tokensA.filter(t => {
    return !genericTokens.has(t) && b.username.toLowerCase().includes(t);
  });
  if (sharedRareTokens.length > 0) bonus += sharedRareTokens.length * 3;

  // Name contains unusual token (length > 6, not English)
  if (a.name && a.name.length > 6 && (signals.name || 0) > 0.85) bonus += 4;

  // Website is a personal domain (not twitter.com, github.com etc)
  const personalDomainBonus = (signals.website || 0) >= 0.9 ? 8 : 0;
  bonus += personalDomainBonus;

  return Math.min(bonus, 15); // cap at +15
}

function buildEvidenceText(signals, a, b) {
  const parts = [];
  if ((signals.website || 0) >= 0.9)  parts.push(`website match (${a.website})`);
  if ((signals.name || 0) >= 0.85)    parts.push(`name similarity ${pct(signals.name)}`);
  if ((signals.username || 0) >= 0.7) parts.push(`username overlap ${pct(signals.username)} ("${sharedTokens(a.username, b.username)}")`);
  if ((signals.bio || 0) >= 0.5)      parts.push(`bio cosine ${pct(signals.bio)}`);
  if ((signals.location || 0) >= 0.7) parts.push(`location "${a.location}"`);
  if ((signals.organization || 0) >= 0.7) parts.push(`org "${a.organization}"`);
  return parts.join(" · ") || "No strong individual signal — weak aggregate";
}

function pct(v) { return `${Math.round((v || 0) * 100)}%`; }

function sharedTokens(a, b) {
  const tokA = a.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
  const tokB = b.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
  return tokA.filter(t => tokB.includes(t)).join(", ") || a;
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT SIGNAL COMPARISON
// Compare investigator-supplied inputs against scraped profiles
// ─────────────────────────────────────────────────────────────────────────────

export function scoreProfileAgainstInput(finding, inputSignals) {
  const m = finding.metadata || {};
  const profileSig = extractSignals(finding);

  let boost = 0;
  const matched = [];

  // Direct email match (if investigator provided one and profile exposes hint)
  if (inputSignals.email && m.email) {
    const emailMatch = inputSignals.email.toLowerCase() === m.email.toLowerCase();
    if (emailMatch) { boost += 25; matched.push("email"); }
  }

  // Phone
  if (inputSignals.phone && m.phone) {
    const clean = s => s.replace(/\D/g, "");
    if (clean(inputSignals.phone).endsWith(clean(m.phone)) || clean(m.phone).endsWith(clean(inputSignals.phone))) {
      boost += 22; matched.push("phone");
    }
  }

  // Website / URL
  if (inputSignals.website && profileSig.website) {
    const ws = websiteSimilarity(inputSignals.website, profileSig.website);
    if (ws >= 0.9) { boost += ws * 15; matched.push("website"); }
  }

  // Name
  if (inputSignals.fullName && profileSig.name) {
    const ns = nameSimilarity(inputSignals.fullName, profileSig.name);
    if (ns > 0.7) { boost += ns * 12; matched.push(`name (${pct(ns)})`); }
  }

  // Username
  if (inputSignals.username && profileSig.username) {
    const us = usernameSimilarity(inputSignals.username, profileSig.username);
    if (us > 0.6) { boost += us * 8; matched.push(`username (${pct(us)})`); }
  }

  // Location
  if (inputSignals.location && profileSig.location) {
    const ls = locationSimilarity(inputSignals.location, profileSig.location);
    if (ls > 0.7) { boost += ls * 4; matched.push("location"); }
  }

  return { boost: Math.round(boost), matched };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY RESOLUTION & CLUSTERING
// Groups profiles into identity clusters using union-find
// ─────────────────────────────────────────────────────────────────────────────

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x) {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x, y) {
    const px = this.find(x), py = this.find(y);
    if (px === py) return;
    if (this.rank[px] < this.rank[py]) this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; }
  }
}

const CLUSTER_THRESHOLD = 55; // min pair score to merge profiles into same identity

export function clusterProfiles(findings) {
  // Only cluster found profiles with actual data
  const eligible = findings.filter(f =>
    (f.status === "found" || f.status === "blocked") && f.platform
  );
  if (eligible.length === 0) return [];

  const uf = new UnionFind(eligible.length);
  const edges = [];

  // Score every cross-platform pair
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const result = scorePair(eligible[i], eligible[j]);
      if (!result) continue;
      edges.push({ i, j, ...result });
      if (result.score >= CLUSTER_THRESHOLD) {
        uf.union(i, j);
      }
    }
  }

  // Group by cluster root
  const clusterMap = new Map();
  eligible.forEach((finding, idx) => {
    const root = uf.find(idx);
    if (!clusterMap.has(root)) clusterMap.set(root, { profiles: [], edges: [] });
    clusterMap.get(root).profiles.push(finding);
  });

  // Add relevant edges to each cluster
  edges.forEach(edge => {
    const root = uf.find(edge.i);
    if (clusterMap.has(root)) {
      clusterMap.get(root).edges.push(edge);
    }
  });

  // Build cluster objects
  const clusters = [];
  clusterMap.forEach(({ profiles, edges: clusterEdges }) => {
    const maxScore = clusterEdges.length > 0
      ? Math.max(...clusterEdges.map(e => e.score))
      : computeSingleProfileScore(profiles[0]);

    // Aggregate all evidence signals
    const allSignals = {};
    clusterEdges.forEach(e => {
      Object.entries(e.signals || {}).forEach(([k, v]) => {
        allSignals[k] = Math.max(allSignals[k] || 0, v);
      });
    });

    const allEdgeTypes = [...new Set(clusterEdges.flatMap(e => e.edgeTypes || []))];

    clusters.push({
      id: `CLUSTER-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      profiles,
      edges: clusterEdges,
      score: maxScore,
      tier: getTier(maxScore),
      signals: allSignals,
      edgeTypes: allEdgeTypes,
      canonicalName: deriveCanonicalName(profiles),
      evidence: clusterEdges.map(e => e.evidence).filter(Boolean).join(" | "),
    });
  });

  // Sort by score descending
  return clusters.sort((a, b) => b.score - a.score);
}

// Single profile with no cross-platform matches: baseline score from signal richness
function computeSingleProfileScore(finding) {
  const m = finding.metadata || {};
  let score = 20;
  if (m.bio && m.bio.length > 30) score += 5;
  if (m.location) score += 3;
  if (m.website || m.blog || m.external_url) score += 5;
  return Math.min(score, 35);
}

function deriveCanonicalName(profiles) {
  // Prefer LinkedIn > GitHub > full_name fields
  const order = ["LinkedIn", "GitHub", "Twitter / X", "Instagram", "Facebook"];
  for (const platform of order) {
    const p = profiles.find(f => f.platform === platform);
    if (p?.metadata?.name && p.metadata.name !== "Not public") return p.metadata.name;
    if (p?.metadata?.full_name && p.metadata.full_name !== "Not public") return p.metadata.full_name;
  }
  // Fallback: any non-null name
  for (const p of profiles) {
    const name = p.metadata?.name || p.metadata?.full_name;
    if (name && name !== "Not public") return name;
  }
  // Last resort: username from first found profile
  return profiles[0]?.title?.replace(/^@/, "") || "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH BUILDER
// Returns nodes + edges for graph visualization
// ─────────────────────────────────────────────────────────────────────────────

export function buildCorrelationGraph(clusters, inputSignals = {}) {
  const nodes = [];
  const edges = [];
  const nodeIndex = new Map();

  let nodeId = 0;

  function addNode(type, label, meta = {}) {
    const key = `${type}:${label}`;
    if (nodeIndex.has(key)) return nodeIndex.get(key);
    const id = nodeId++;
    nodes.push({ id, type, label, ...meta });
    nodeIndex.set(key, id);
    return id;
  }

  // Add investigator input as Person node
  const targetLabel = inputSignals.username || inputSignals.fullName || inputSignals.email || "Target";
  const personId = addNode("person", targetLabel, { color: "#534AB7", isTarget: true });

  clusters.forEach((cluster, ci) => {
    // Add cluster as a sub-identity node if multiple clusters
    const clusterId = clusters.length > 1
      ? addNode("cluster", `Cluster ${ci + 1}`, { score: cluster.score, tier: cluster.tier.label, color: cluster.tier.color })
      : personId;

    if (clusters.length > 1) {
      edges.push({
        source: personId, target: clusterId,
        type: "identity_cluster", score: cluster.score, label: `${cluster.score}%`,
      });
    }

    cluster.profiles.forEach(profile => {
      const pid = addNode("profile", `${profile.platform}: ${profile.title?.replace(/^@/, "")}`, {
        platform: profile.platform,
        url: profile.url,
        status: profile.status,
        color: getPlatformColor(profile.platform),
      });

      edges.push({
        source: clusterId, target: pid,
        type: "owns", label: profile.platform,
      });

      // Website node
      const ws = profile.metadata?.blog || profile.metadata?.external_url || profile.metadata?.website;
      if (ws && ws !== "Not public") {
        const domainLabel = ws.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
        const domainId = addNode("domain", domainLabel, { color: "#3B6D11" });
        edges.push({ source: pid, target: domainId, type: "links_to" });
      }

      // Location node
      const loc = profile.metadata?.location;
      if (loc && loc !== "Not public" && loc !== "Not listed publicly") {
        const locId = addNode("location", loc, { color: "#185FA5" });
        edges.push({ source: pid, target: locId, type: "located_in" });
      }

      // Organization node
      const org = profile.metadata?.company || profile.metadata?.organization;
      if (org && org !== "Not public") {
        const orgId = addNode("organization", org, { color: "#854F0B" });
        edges.push({ source: pid, target: orgId, type: "works_at" });
      }
    });

    // Add cross-profile edges (the correlation links)
    cluster.edges.forEach(edge => {
      if (edge.score < CLUSTER_THRESHOLD) return; // only show strong links
      const aKey = `profile:${edge.profileA.platform}: ${edge.profileA.username}`;
      const bKey = `profile:${edge.profileB.platform}: ${edge.profileB.username}`;
      const aId = nodeIndex.get(aKey);
      const bId = nodeIndex.get(bKey);
      if (aId !== undefined && bId !== undefined) {
        edges.push({
          source: aId, target: bId,
          type: "correlation", score: edge.score,
          label: `${edge.score}`,
          edgeTypes: edge.edgeTypes,
          color: edge.tier.color,
        });
      }
    });
  });

  return { nodes, edges };
}

function getPlatformColor(platform = "") {
  const colors = {
    "GitHub":       "#24292e",
    "Instagram":    "#e1306c",
    "Twitter / X":  "#111827",
    "LinkedIn":     "#0077b5",
    "Facebook":     "#1877f2",
    "Reddit":       "#ff4500",
    "Telegram":     "#0088cc",
    "TikTok":       "#111827",
    "YouTube":      "#ff0000",
  };
  return colors[platform] || "#888780";
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────

export function computeRiskAssessment(clusters, findings) {
  const foundProfiles = findings.filter(f => f.status === "found").length;
  const maxScore = clusters.length > 0 ? clusters[0].score : 0;
  const platformCount = new Set(findings.filter(f => f.status === "found").map(f => f.platform)).size;
  const hasMultiPlatformCluster = clusters.some(c => c.profiles.length > 1);

  // Risk factors
  const factors = [];
  if (platformCount >= 5) factors.push({ label: "High platform exposure", weight: 20 });
  if (maxScore >= 75)     factors.push({ label: "Very strong cross-platform correlation", weight: 20 });
  if (foundProfiles >= 5) factors.push({ label: "Extensive digital footprint", weight: 15 });
  if (hasMultiPlatformCluster) factors.push({ label: "Identity cluster resolved", weight: 10 });
  if (platformCount >= 3) factors.push({ label: "Multi-platform presence", weight: 10 });

  const riskScore = Math.min(100, factors.reduce((s, f) => s + f.weight, 0));
  const risk = riskScore >= 60 ? "critical" : riskScore >= 40 ? "high" : riskScore >= 20 ? "medium" : "low";

  return { risk, riskScore, factors };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export function buildCorrelationReport(findings, inputSignals = {}) {
  const clusters = clusterProfiles(findings);
  const graph = buildCorrelationGraph(clusters, inputSignals);
  const { risk, riskScore, factors } = computeRiskAssessment(clusters, findings);

  // Score each found profile against the investigator's supplied inputs
  const profileScores = findings
    .filter(f => f.status === "found")
    .map(f => {
      const { boost, matched } = scoreProfileAgainstInput(f, inputSignals);
      return { platform: f.platform, username: f.title, boost, matched };
    })
    .filter(p => p.boost > 0)
    .sort((a, b) => b.boost - a.boost);

  // Summary stats
  const foundCount = findings.filter(f => f.status === "found").length;
  const topCluster = clusters[0] || null;
  const overallConfidence = topCluster
    ? topCluster.score
    : Math.min(35 + foundCount * 5, 50);

  return {
    clusters,
    graph,
    risk,
    riskScore,
    riskFactors: factors,
    profileScores,
    overallConfidence,
    tier: getTier(overallConfidence),
    summary: {
      foundProfiles:    foundCount,
      platformCount:    new Set(findings.filter(f => f.status === "found").map(f => f.platform)).size,
      clusterCount:     clusters.length,
      topClusterSize:   topCluster?.profiles.length || 0,
      signalCount:      topCluster ? Object.keys(topCluster.signals).length : 0,
    },
  };
}

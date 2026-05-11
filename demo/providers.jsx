/* global React, Icon */

const ROLES = [
  { id: "vision",    label: "vision",      zh: "视觉理解", color: "#6FA8DC" },
  { id: "llm",       label: "llm",         zh: "文本生成", color: "#E8D9B4" },
  { id: "image_gen", label: "image_gen",   zh: "图像生成", color: "#C4513A" },
  { id: "image_edit",label: "image_edit",  zh: "图像编辑", color: "#B58867" },
  { id: "embedding", label: "embedding",   zh: "向量嵌入", color: "#6B8E5A" },
];

const ENDPOINTS = [
  // openai-compatible
  { kind: "openai", name: "OpenAI",        host: "api.openai.com",       model: "gpt-4o · gpt-4o-mini",     roles: ["llm","vision"],  latency: 286, status: "ok" },
  { kind: "openai", name: "DashScope",     host: "dashscope.aliyuncs.com",model: "qwen-vl-max · qwen-3",    roles: ["vision","llm"],  latency: 412, status: "ok", preferred: true },
  { kind: "openai", name: "Fireworks",     host: "api.fireworks.ai",     model: "flux-1-pro · sdxl-lightning",roles: ["image_gen"],   latency: 9400, status: "warn" },
  { kind: "openai", name: "Ollama (local)",host: "localhost:11434",      model: "bge-m3 · qwen2.5",        roles: ["embedding","llm"],latency: 34,  status: "ok" },
  // anthropic-compatible
  { kind: "anthropic", name: "Anthropic",  host: "api.anthropic.com",    model: "claude-sonnet-4.5",       roles: ["llm","vision"],  latency: 318, status: "ok", preferred: true },
  { kind: "anthropic", name: "Bedrock",    host: "bedrock.us-west-2",    model: "claude-sonnet-4 · claude-haiku-4",roles: ["llm"],   latency: 482, status: "ok" },
  // image specialists (other)
  { kind: "openai", name: "fal.ai",        host: "api.fal.run",          model: "flux-redux-dev · pulid",  roles: ["image_edit"],    latency: 4200, status: "ok" },
];

// active routing: which role flows to which endpoint
const ROUTING = [
  { role: "vision",     to: "DashScope",     weight: 0.7 },
  { role: "vision",     to: "OpenAI",        weight: 0.3 },
  { role: "llm",        to: "Anthropic",     weight: 0.55 },
  { role: "llm",        to: "OpenAI",        weight: 0.30 },
  { role: "llm",        to: "Bedrock",       weight: 0.15 },
  { role: "image_gen",  to: "Fireworks",     weight: 1.0 },
  { role: "image_edit", to: "fal.ai",        weight: 1.0 },
  { role: "embedding",  to: "Ollama (local)",weight: 1.0 },
];

const RoleBadge = ({ role, proto }) => {
  const r = ROLES.find((x) => x.id === role);
  const klass = role === "image_gen" ? "is-image" : role === "image_edit" ? "is-edit" : role === "embedding" ? "is-embed" : `is-${role}`;
  return (
    <span className={`role-badge ${klass}`} style={{ "--c": r?.color }}>
      <span className="proto">{proto}</span>
      <span className="role" style={{ color: r?.color }}>{r?.label}</span>
    </span>
  );
};

const sparkChars = (vals) => {
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const chars = ["\u2581","\u2582","\u2583","\u2584","\u2585","\u2586","\u2587"];
  return vals.map((v) => chars[Math.min(chars.length - 1, Math.floor(((v - min) / span) * (chars.length - 1)))]).join("");
};

const EndpointCard = ({ ep }) => {
  const lat = ep.latency;
  const tier = lat < 300 ? "ok" : lat < 800 ? "warn" : "bad";
  const p95 = Math.round(lat * 1.18);
  // tiny synthetic 8-step history around current latency
  const hist = Array.from({ length: 8 }, (_, i) => lat * (0.85 + Math.sin(i * 1.1 + lat) * 0.13 + i * 0.015));
  return (
  <div className={`endpoint-card ${ep.preferred ? "is-preferred" : ""}`}>
    <div>
      <div className="url">
        <span className="name">{ep.name}</span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span className="host">{ep.host}</span>
        {ep.preferred && <span className="preferred-chip" style={{ marginLeft: 8 }}>preferred</span>}
      </div>
      <div className="model">{ep.model}</div>
      <div className="roles">
        {ep.roles.map((r) => <RoleBadge key={r} role={r} proto={ep.kind === "openai" ? "OAI" : "ANT"} />)}
      </div>
      <div className="micro-line">
        <span>{ep.kind === "openai" ? "OAI" : "ANT"} · {lat < 1000 ? `${lat}ms` : `${(lat/1000).toFixed(1)}s`}</span>
        <span className="p95">↘ p95 {p95 < 1000 ? `${p95}ms` : `${(p95/1000).toFixed(1)}s`}</span>
        <span className="spark">{sparkChars(hist)}</span>
      </div>
    </div>
    <div className={`latency ${tier === "warn" ? "warn" : tier === "bad" ? "bad" : ""}`}>
      <span className="dot"/>
      {lat < 1000 ? `${lat} ms` : `${(lat/1000).toFixed(1)} s`}
    </div>
    <div className="actions" style={{ gridColumn: "1 / -1", justifySelf: "stretch", display: "flex", gap: 6 }}>
      <button className="btn" style={{ padding: "5px 10px", fontSize: 11 }}>
        <Icon name="test" size={11}/> Test
      </button>
      <button className="btn" style={{ padding: "5px 10px", fontSize: 11 }}>
        <Icon name="edit" size={11}/> Edit
      </button>
      <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11 }}>
        <Icon name="copy" size={11}/> Duplicate
      </button>
      <div style={{ flex: 1 }}/>
      <button className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 11, color: "var(--text-faint)" }}>
        Disable
      </button>
    </div>
  </div>
  );
};

// =========== Static Sankey-style curve diagram ===========
const Sankey = () => {
  const W = 900, H = 380;
  const leftX = 200, rightX = W - 220;
  const roleY = (i) => 40 + i * 64;        // 5 roles
  // endpoint positions, ordered to minimize visual crossings
  const epOrder = ["DashScope","OpenAI","Anthropic","Bedrock","Fireworks","fal.ai","Ollama (local)"];
  const epY = (name) => 28 + epOrder.indexOf(name) * 47;

  // build flow paths
  const flows = ROUTING.map((f) => {
    const roleIdx = ROLES.findIndex((r) => r.id === f.role);
    const r = ROLES[roleIdx];
    const y1 = roleY(roleIdx) + 20;
    const y2 = epY(f.to) + 11;
    const cx1 = leftX + 140, cx2 = rightX - 140;
    const t = Math.max(8, f.weight * 22);
    const d = `M ${leftX + 12} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${rightX - 4} ${y2}`;
    return { d, color: r.color, thick: t, weight: f.weight, role: f.role, to: f.to };
  });

  // animated dots drifting along the curves
  const particleT = React.useRef(0);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let raf;
    const loop = () => {
      particleT.current = (particleT.current + 1/480) % 1;
      setTick((x) => (x + 1) % 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        {ROLES.map((r) => (
          <linearGradient key={r.id} id={`flow-${r.id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor={r.color} stopOpacity="0.65"/>
            <stop offset="100%" stopColor={r.color} stopOpacity="0.22"/>
          </linearGradient>
        ))}
        <linearGradient id="rolebg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </linearGradient>
      </defs>

      {/* axis labels */}
      <text x={leftX - 8} y={16}  fontFamily="JetBrains Mono" fontSize="10" fill="#5C544B" textAnchor="end" letterSpacing="1.2">ROLES · 5</text>
      <text x={rightX + 8} y={16} fontFamily="JetBrains Mono" fontSize="10" fill="#5C544B" letterSpacing="1.2">ENDPOINTS · 7</text>

      {/* flow paths */}
      {flows.map((f, i) => (
        <g key={i}>
          <path id={`flow-path-${i}`} d={f.d}
            stroke={`url(#flow-${f.role})`}
            strokeWidth={f.thick}
            fill="none"
            strokeLinecap="round"
            opacity="0.85"
          />
        </g>
      ))}

      {/* role nodes (left) — technical role labels, not literary moments */}
      {ROLES.map((r, i) => {
        const y = roleY(i);
        return (
          <g key={r.id} transform={`translate(${leftX - 180} ${y})`}>
            <rect width="192" height="40" rx="10" fill="var(--surface-01)" stroke="var(--border-subtle)" />
            <rect x="0" y="0" width="2" height="40" fill={r.color}/>
            <text x="14" y="18" fontFamily="JetBrains Mono" fontSize="13" fontWeight="500" fill="#F0E8DD" letterSpacing="1.4">{r.label.toUpperCase()}</text>
            <text x="14" y="32" fontFamily="PingFang SC, Noto Sans SC, sans-serif" fontSize="11" fontWeight="400" fill="#948A7E">{r.zh}</text>
          </g>
        );
      })}

      {/* endpoint nodes (right) */}
      {epOrder.map((name) => {
        const ep = ENDPOINTS.find((e) => e.name === name);
        const y = epY(name);
        const proto = ep.kind === "openai" ? "OAI" : "ANT";
        return (
          <g key={name} transform={`translate(${rightX} ${y})`}>
            <rect width="200" height="32" rx="8" fill="var(--surface-02)" stroke="var(--border-subtle)" />
            <rect x="197" y="0" width="3" height="32" rx="1.5" fill={ep.kind === "openai" ? "#D97757" : "#B5C8DC"}/>
            <text x="12" y="14" fontFamily="JetBrains Mono" fontSize="11" fill="#F0E8DD">{name}</text>
            <text x="12" y="27" fontFamily="JetBrains Mono" fontSize="9" fill="#948A7E" letterSpacing="0.6">
              {proto} · {ep.latency < 1000 ? `${ep.latency}ms` : `${(ep.latency/1000).toFixed(1)}s`}
            </text>
          </g>
        );
      })}

      {/* legend bottom */}
      <g transform={`translate(${leftX - 180} ${H - 26})`}>
        {ROLES.map((r, i) => (
          <g key={r.id} transform={`translate(${i * 110} 0)`}>
            <rect width="14" height="6" rx="3" y="6" fill={r.color}/>
            <text x="20" y="13" fontFamily="JetBrains Mono" fontSize="10" fill="#948A7E">{r.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
};

const YAML_VIEW = (
  <pre className="yaml">{`# ~/aishop/providers.yaml
`}<span className="c"># Generated by visual editor · 2026-05-11 14:32</span>{`

endpoints:
  `}<span className="k">- name</span>{`: `}<span className="s">"OpenAI"</span>{`
    `}<span className="k">protocol</span>{`: openai
    `}<span className="k">base_url</span>{`: `}<span className="s">"https://api.openai.com/v1"</span>{`
    `}<span className="k">api_key</span>{`: `}<span className="s">{'"${OPENAI_API_KEY}"'}</span>{`
    `}<span className="k">models</span>{`:
      - `}<span className="s">"gpt-4o"</span>{`
      - `}<span className="s">"gpt-4o-mini"</span>{`
    `}<span className="k">roles</span>{`: [`}<span className="s">llm</span>{`, `}<span className="s">vision</span>{`]
    `}<span className="k">weight</span>{`: `}<span className="n">0.30</span>{`

  `}<span className="k">- name</span>{`: `}<span className="s">"DashScope"</span>{`
    `}<span className="k">protocol</span>{`: openai`}<span className="c">  # qwen 兼容层</span>{`
    `}<span className="k">base_url</span>{`: `}<span className="s">"https://dashscope.aliyuncs.com/compatible-mode/v1"</span>{`
    `}<span className="k">models</span>{`: [`}<span className="s">qwen-vl-max</span>{`, `}<span className="s">qwen-3-72b</span>{`]
    `}<span className="k">roles</span>{`: [`}<span className="s">vision</span>{`, `}<span className="s">llm</span>{`]
    `}<span className="k">weight</span>{`: `}<span className="n">0.70</span>{`

  `}<span className="k">- name</span>{`: `}<span className="s">"Anthropic"</span>{`
    `}<span className="k">protocol</span>{`: anthropic
    `}<span className="k">base_url</span>{`: `}<span className="s">"https://api.anthropic.com/v1"</span>{`
    `}<span className="k">models</span>{`: [`}<span className="s">claude-sonnet-4.5</span>{`]
    `}<span className="k">roles</span>{`: [`}<span className="s">llm</span>{`, `}<span className="s">vision</span>{`]
    `}<span className="k">weight</span>{`: `}<span className="n">0.55</span>{`

routing:
  `}<span className="k">vision</span>{`:     [DashScope, OpenAI]
  `}<span className="k">llm</span>{`:        [Anthropic, OpenAI, Bedrock]
  `}<span className="k">image_gen</span>{`:  [Fireworks]
  `}<span className="k">image_edit</span>{`: [fal.ai]
  `}<span className="k">embedding</span>{`:  [Ollama]`}</pre>
);

// =========== PROVIDERS PAGE ===========
const Providers = ({ locale }) => {
  const [view, setView] = React.useState("visual"); // 'visual' | 'yaml'
  const [openModal, setOpenModal] = React.useState(false);

  const oai = ENDPOINTS.filter((e) => e.kind === "openai");
  const ant = ENDPOINTS.filter((e) => e.kind === "anthropic");

  return (
    <div className="page">
      <div className="section-head">
        <span className="prov-title"><span className="zh">路由</span><span className="en">Providers</span></span>
        <span className="prov-terminal" style={{ marginLeft: 4 }}>openai-compat · anthropic-compat · 7 endpoints · all green</span>
        <div className="grow"/>
        <div className="view-toggle">
          <button className={view === "visual" ? "is-active" : ""} onClick={() => setView("visual")}>Visual</button>
          <button className={view === "yaml" ? "is-active" : ""} onClick={() => setView("yaml")}>YAML</button>
        </div>
        <button className="btn-primary" onClick={() => setOpenModal(true)}><Icon name="plus" size={14}/> Add Endpoint</button>
      </div>

      {view === "visual" ? (
        <>
          {/* Sankey */}
          <div className="sankey-card">
            <div className="sankey-live"><span className="dot"/> 3 requests in flight</div>
            <div className="sankey-head">
              <span style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 16, color: "var(--text-primary)", letterSpacing: "-0.01em", whiteSpace: "nowrap", flexShrink: 0 }}>Active Routing</span>
              <span className="sub" style={{ whiteSpace: "nowrap" }}>role → endpoint · weighted by traffic</span>
              <div style={{ flex: 1 }}/>
            </div>
            <Sankey/>
          </div>

          {/* Endpoint columns */}
          <div className="prov-grid">
            <div className="prov-section">
              <div className="prov-section-head">
                <span className="pill" style={{ color: "#D97757", borderColor: "rgba(217,119,87,0.4)" }}>OAI</span>
                <span className="label">OpenAI-compatible</span>
                <span className="grow"/>
                <span className="count">{oai.length} endpoints · {oai.reduce((a,e)=>a+e.roles.length,0)} role bindings</span>
              </div>
              {oai.map((ep) => <EndpointCard key={ep.name} ep={ep}/>)}
            </div>
            <div className="prov-section">
              <div className="prov-section-head">
                <span className="pill" style={{ color: "#B5C8DC", borderColor: "rgba(181,200,220,0.4)" }}>ANT</span>
                <span className="label">Anthropic-compatible</span>
                <span className="grow"/>
                <span className="count">{ant.length} endpoints · {ant.reduce((a,e)=>a+e.roles.length,0)} role bindings</span>
              </div>
              {ant.map((ep) => <EndpointCard key={ep.name} ep={ep}/>)}
              <div style={{ padding: 18, color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 11, borderTop: "1px solid var(--border-subtle)" }}>
                + 添加 anthropic 协议端点 (Bedrock · Vertex · 自定义代理)
              </div>
            </div>
          </div>
        </>
      ) : YAML_VIEW}

      {openModal && (
        <div
          onClick={() => setOpenModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(10,9,8,0.6)", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 520, background: "var(--surface-01)", border: "1px solid var(--border-strong)", borderRadius: 20, boxShadow: "var(--shadow-glass)" }}
          >
            <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 20 }}><em style={{ color: "var(--accent-soft)" }}>Add</em> Endpoint</span>
              <div style={{ flex: 1 }}/>
              <button className="btn btn-ghost" onClick={() => setOpenModal(false)}><Icon name="x" size={14}/></button>
            </div>
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Protocol">
                <div className="view-toggle" style={{ width: "100%" }}>
                  <button className="is-active" style={{ flex: 1 }}>openai</button>
                  <button style={{ flex: 1 }}>anthropic</button>
                </div>
              </Field>
              <Field label="Base URL">
                <input className="mono" defaultValue="https://api.openai.com/v1" style={inputStyle}/>
              </Field>
              <Field label="API Key">
                <input className="mono" defaultValue="sk-•••••••••••••••••••••••••••••••" type="password" style={inputStyle}/>
              </Field>
              <Field label="Model IDs">
                <input className="mono" defaultValue="gpt-4o, gpt-4o-mini" style={inputStyle}/>
              </Field>
              <Field label="Roles">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {ROLES.map((r) => (
                    <span key={r.id} className="role-badge" style={{ cursor: "pointer", opacity: ["llm","vision"].includes(r.id) ? 1 : 0.4 }}>
                      <span className="proto" style={{ color: r.color }}>{["llm","vision"].includes(r.id) ? "✓" : "+"}</span>
                      <span className="role" style={{ color: r.color }}>{r.label}</span>
                    </span>
                  ))}
                </div>
              </Field>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button className="btn" style={{ flex: 1, justifyContent: "center", padding: "10px" }}><Icon name="test" size={12}/> Test connection</button>
                <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }}>Save endpoint</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const inputStyle = {
  width: "100%",
  background: "var(--surface-02)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 4,
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--text-primary)",
  outline: "none",
};
const Field = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>{label}</span>
    {children}
  </div>
);

window.Providers = Providers;

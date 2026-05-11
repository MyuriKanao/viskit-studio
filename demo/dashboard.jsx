/* global React, Icon, StatusChip, ComplianceRing, Sparkline, LocaleFlag, Placeholder */

// =========== KIT CARD (used on dashboard) ===========
const KitCard = ({ kit, locale }) => {
  // 14 mini cells = a 7x2 collage
  const cells = kit.thumbs.slice(0, 14);
  return (
    <div className="kit-card" onClick={kit.onClick}>
      <div className="kit-card-grid">
        {cells.map((c, i) => (
          <div key={i} style={{ background: c }} />
        ))}
      </div>
      <div className="kit-card-body">
        <div className="kit-card-title">
          <div className="kit-card-name" title={kit.name}>{locale === "zh" ? kit.name : kit.nameEn}</div>
          <div className="kit-card-sku">{kit.sku}</div>
        </div>
        <div className="kit-card-meta">
          <StatusChip status={kit.status} locale={locale}/>
          <LocaleFlag code={kit.locale} />
          <div className="grow" />
          <ComplianceRing value={kit.score} size={28} stroke={2.5} showLabel={false}/>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 24, textAlign: "right" }}>{kit.score}</span>
        </div>
      </div>
    </div>
  );
};

const DASHBOARD_KITS = [
  {
    sku: "NEW001", name: "云感针织开衫", nameEn: "Cloud-Knit Cardigan",
    status: "ready", score: 92, locale: "CN",
    thumbs: ["#3a2820","#52382c","#704836","#a05a3e","#c97755","#d98a68","#e5a888","#8e5640","#6b4632","#3e2a20","#2a1c14","#5a3a2a","#8a5440","#a06a4e"],
  },
  {
    sku: "SKU042", name: "波西米亚粉中长裙", nameEn: "Bohemian Pink Midi Dress",
    status: "generating", score: 86, locale: "EN",
    thumbs: ["#9d5a72","#c87a8a","#e0a5b1","#b86b80","#8a4860","#6b3a4a","#a85e74","#d18a98","#c47788","#9c5c70","#85495a","#6e3a48","#502838","#3a2028"],
  },
  {
    sku: "SKU017", name: "玻尿酸精华水", nameEn: "Hyaluronic Essence Toner",
    status: "needs_review", score: 71, locale: "CN",
    thumbs: ["#3a4858","#536878","#7088a0","#8aa0b8","#a8bcce","#c5d2dc","#dde5ec","#6c8090","#4a5d70","#3a4a5c","#293442","#1f2832","#162028","#0d161d"],
  },
  {
    sku: "SKU089", name: "亚麻直筒阔腿裤", nameEn: "Linen Wide-Leg Trousers",
    status: "ready", score: 88, locale: "CN",
    thumbs: ["#c5b298","#b59f80","#a08b6c","#8a7558","#6f5d44","#574833","#403524","#2f261a","#d8c8b0","#cab68d","#a8906a","#7d6b4d","#5a4a32","#3a2e1c"],
  },
  {
    sku: "SKU101", name: "复古铜釦皮带", nameEn: "Vintage Brass Buckle Belt",
    status: "queued", score: 0, locale: "EN",
    thumbs: ["#5a3a26","#7a5236","#8e6240","#a06f48","#b07a50","#8a5a3a","#6a4228","#4a2c1a","#36200f","#28180a","#5e3d28","#8e6240","#b0824a","#c79658"],
  },
  {
    sku: "SKU064", name: "羊绒奶白围巾", nameEn: "Cashmere Cream Scarf",
    status: "failed", score: 0, locale: "EN",
    thumbs: ["#e5dccc","#d6cab8","#c5b8a2","#b3a48c","#9d8a72","#806953","#604d3a","#3e3022","#e8e0d2","#d2c7b6","#b6a98e","#90825f","#665636","#3c2f1c"],
  },
];

// =========== DASHBOARD ===========
const Dashboard = ({ locale, goto }) => {
  const kpis = [
    { label: locale==="zh" ? "本周生成套包" : "Kits this week",  value: 28,    unit: "套",   delta: "+18%", spark: [11,8,12,10,15,9,18,14,21,17,24,28], color: "var(--accent-soft)" },
    { label: locale==="zh" ? "平均合规分"   : "Avg compliance",  value: 87.4,  unit: "/100", delta: "+2.1", spark: [78,80,82,79,84,86,85,88,86,89,87,87], color: "#6B8E5A" },
    { label: locale==="zh" ? "人工修字均时" : "Avg manual edit", value: 4.2,   unit: "min",  delta: "−38%", spark: [9.1,8.3,7.5,8,6.4,5.8,5.1,5.6,4.8,4.5,4.4,4.2], color: "#C4924A", down: true },
    { label: locale==="zh" ? "API 累计成本" : "API spend (mo)",  value: 142.6, unit: "USD",  delta: "+$12.4", spark: [22,38,55,68,84,92,103,114,121,128,135,142], color: "#D4A65A" },
  ];

  return (
    <div className="page">
      {/* KPI strip */}
      <div className="section-head">
        <span className="title"><em>本周</em> Pulse</span>
        <span className="subtitle">07 May → 11 May 2026</span>
        <div className="grow"/>
        <button className="btn"><Icon name="refresh" size={12}/> 刷新</button>
        <button className="btn"><Icon name="filter" size={12}/> 周</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {kpis.map((k, i) => (
          <div key={i} className="kpi-card">
            <span className="label">{k.label}</span>
            <div className="value">
              <span>{k.value}</span>
              <span className="unit">{k.unit}</span>
            </div>
            <span className={`delta ${k.down ? "down" : ""}`}>{k.delta} <span style={{ color: "var(--text-faint)" }}>· vs 上周</span></span>
            <Sparkline data={k.spark} color={k.color}/>
          </div>
        ))}
      </div>

      {/* Recent Kits */}
      <div className="section-head" style={{ marginTop: 16 }}>
        <span className="title"><em>近期</em> 套包 <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-faint)", letterSpacing: "0.04em" }}>Recent Kits</span></span>
        <div className="grow"/>
        <div className="view-toggle">
          <button className="is-active"><Icon name="grid" size={11}/></button>
          <button>列表</button>
        </div>
        <button className="btn-primary"><Icon name="plus" size={14}/> 新建套包</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {DASHBOARD_KITS.map((k, i) => (
          <KitCard key={k.sku} kit={{ ...k, onClick: () => i === 0 && goto("kit-detail") }} locale={locale}/>
        ))}
      </div>

      {/* Queue strip */}
      <div className="section-head" style={{ marginTop: 16 }}>
        <span className="title"><em>队列</em> Now</span>
        <span className="subtitle">4 active · 7 queued · throttle 3/s</span>
        <div className="grow"/>
        <button className="btn"><Icon name="pause" size={12}/> 全部暂停</button>
      </div>
      <div className="queue-strip">
        {[
          { name: "波西米亚粉中长裙", sku: "SKU042 · EN", stages: ["done","done","active","queued","queued"], stage: "image_gen 3/9", eta: "≈ 4m" },
          { name: "羊绒驼色大衣",     sku: "SKU112 · CN", stages: ["done","done","done","active","queued"], stage: "scoring",     eta: "≈ 1m" },
          { name: "极简白衬衫",       sku: "SKU077 · CN", stages: ["done","active","queued","queued","queued"], stage: "style ref",  eta: "≈ 6m" },
          { name: "复古铜釦皮带",     sku: "SKU101 · EN", stages: ["active","queued","queued","queued","queued"], stage: "retrieve",  eta: "≈ 9m" },
        ].map((q, i) => (
          <div className="queue-row" key={i}>
            <div className="name">
              <span>{q.name}</span>
              <span className="mono">{q.sku}</span>
            </div>
            <div className="queue-progress">
              {q.stages.map((s, j) => (
                <div key={j} className={s === "done" ? "done" : s === "active" ? "active" : ""}/>
              ))}
            </div>
            <div className="stage">{q.stage}</div>
            <div className="eta">{q.eta}</div>
          </div>
        ))}
      </div>

    </div>
  );
};

window.Dashboard = Dashboard;

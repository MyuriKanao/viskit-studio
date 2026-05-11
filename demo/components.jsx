/* global React */

// ============ Icons (Lucide-style minimal stroke) ============
const Icon = ({ name, size = 16, stroke = 1.5, ...rest }) => {
  const paths = {
    home:       <><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></>,
    catalog:    <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    plus:       <><path d="M12 5v14M5 12h14"/></>,
    queue:      <><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="6" cy="6" r="1.2" fill="currentColor"/><circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="6" cy="18" r="1.2" fill="currentColor"/></>,
    vault:      <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><circle cx="8" cy="14.5" r="1.4"/></>,
    template:   <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></>,
    providers:  <><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M8 7 16 11M8 17l8-4"/></>,
    settings:   <><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></>,
    search:     <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    bell:       <><path d="M6 8a6 6 0 0 1 12 0v5l1.5 3h-15L6 13Z"/><path d="M10 19a2 2 0 0 0 4 0"/></>,
    sun:        <><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></>,
    moon:       <><path d="M20 15a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/></>,
    refresh:    <><path d="M21 4v6h-6"/><path d="M3 20v-6h6"/><path d="M3.5 14a9 9 0 0 0 16.6 2.5M20.5 10A9 9 0 0 0 3.9 7.5"/></>,
    edit:       <><path d="m3 21 3.5-1 11.5-11.5a2.1 2.1 0 0 0-3-3L3.5 17 3 21Z"/></>,
    code:       <><path d="m9 8-5 4 5 4M15 8l5 4-5 4"/></>,
    variants:   <><path d="M4 7h12a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8"/><path d="m17 4 3 3-3 3M11 19l3 3-3 3" transform="translate(0 -4)"/></>,
    play:       <><path d="M7 5v14l12-7Z"/></>,
    pause:      <><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></>,
    chevDown:   <><path d="m6 9 6 6 6-6"/></>,
    chevRight:  <><path d="m9 6 6 6-6 6"/></>,
    chevLeft:   <><path d="m15 6-6 6 6 6"/></>,
    download:   <><path d="M12 4v12M6 12l6 6 6-6"/><path d="M4 20h16"/></>,
    copy:       <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></>,
    sparkle:    <><path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6 9 9M15 15l3.4 3.4M5.6 18.4 9 15M15 9l3.4-3.4"/></>,
    lock:       <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
    test:       <><path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/></>,
    yaml:       <><path d="M4 5h16M4 12h16M4 19h10"/></>,
    x:          <><path d="M5 5l14 14M19 5 5 19"/></>,
    eye:        <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    arrowUp:    <><path d="M12 19V5M5 12l7-7 7 7"/></>,
    arrowDown:  <><path d="M12 5v14M5 12l7 7 7-7"/></>,
    filter:     <><path d="M4 5h16l-6 8v6l-4 1v-7Z"/></>,
    grid:       <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths[name] || null}
    </svg>
  );
};

// ============ Status Chip ============
const labelMap = {
  ready:         { zh: "已就绪",   en: "ready" },
  generating:    { zh: "生成中",   en: "generating" },
  queued:        { zh: "已排队",   en: "queued" },
  needs_review:  { zh: "待审阅",   en: "needs review" },
  failed:        { zh: "已失败",   en: "failed" },
};
const StatusChip = ({ status, locale = "zh" }) => (
  <span className={`chip chip-${status}`}>{labelMap[status][locale]}</span>
);

// ============ Compliance Ring ============
const ComplianceRing = ({ value, size = 64, stroke = 4, showLabel = true, locale = "zh" }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  // gradient: red → honey → moss based on value
  const ringId = React.useMemo(() => `ring-grad-${Math.random().toString(36).slice(2,8)}`, []);
  return (
    <div className="compliance-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"  stopColor="#A23E2F"/>
            <stop offset="50%" stopColor="#C4924A"/>
            <stop offset="100%" stopColor="#6B8E5A"/>
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface-02)" strokeWidth={stroke}/>
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        />
      </svg>
      <div className="score">
        <span style={{ fontSize: size * 0.34 }}>{value}</span>
        {showLabel && <span className="score-label">{locale === "zh" ? "合规" : "score"}</span>}
      </div>
    </div>
  );
};

// ============ Sparkline ============
const Sparkline = ({ data, color = "var(--accent-soft)", width = 220, height = 32 }) => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const step = width / (data.length - 1);
  const points = data.map((d, i) => `${i * step},${height - ((d - min) / range) * (height - 4) - 2}`).join(" ");
  const area = `0,${height} ${points} ${width},${height}`;
  const gid = React.useMemo(() => `sg-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`}/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      {/* terminal dot */}
      <circle cx={width} cy={height - ((data[data.length-1] - min) / range) * (height - 4) - 2} r="2" fill={color}/>
    </svg>
  );
};

// ============ Locale Flag ============
const LocaleFlag = ({ code = "CN" }) => (
  <span className="locale-flag">{code}</span>
);

// ============ Sidebar ============
const Sidebar = ({ current, onNav }) => {
  const items = [
    { key: "dashboard",  label: "首页",      en: "Dashboard",  icon: "home",      shortcut: "G D" },
    { key: "catalog",    label: "商品库",    en: "Catalog",    icon: "catalog",   shortcut: "G C" },
    { key: "new-kit",    label: "新建套包",  en: "New Kit",    icon: "plus",      shortcut: "N" },
    { key: "queue",      label: "队列",      en: "Queue",      icon: "queue",     badge: "4" },
    { key: "vault",      label: "爆款语料",  en: "Bestseller", icon: "vault" },
    { key: "templates",  label: "模板",      en: "Templates",  icon: "template" },
    { key: "providers",  label: "模型路由",  en: "Providers",  icon: "providers" },
    { key: "settings",   label: "设置",      en: "Settings",   icon: "settings" },
  ];
  const isClickable = (k) => ["dashboard","kit-detail","providers"].includes(k);
  const mapClick = (k) => {
    // only the 3 hero screens are wired
    if (k === "catalog") onNav("dashboard"); else onNav(k);
  };
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark" aria-hidden="true"></span>
        <span className="sidebar-logo-text">AIShop <em>Studio</em></span>
        <span className="sidebar-logo-version">v0.7</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">工作区 · Workspace</div>
        <nav className="sidebar-nav">
          {items.slice(0, 6).map((it) => (
            <a
              key={it.key}
              className={`sidebar-item ${current === it.key ? "is-active" : ""}`}
              onClick={() => mapClick(it.key)}
            >
              <span className="sidebar-item-icon"><Icon name={it.icon} /></span>
              <span>{it.label}</span>
              {it.badge
                ? <span className="sidebar-item-badge">{it.badge}</span>
                : <span className="sidebar-item-shortcut">{it.shortcut}</span>}
            </a>
          ))}
        </nav>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-label">系统 · System</div>
        <nav className="sidebar-nav">
          {items.slice(6).map((it) => (
            <a
              key={it.key}
              className={`sidebar-item ${current === it.key ? "is-active" : ""}`}
              onClick={() => onNav(it.key)}
            >
              <span className="sidebar-item-icon"><Icon name={it.icon} /></span>
              <span>{it.label}</span>
              <span className="sidebar-item-shortcut">{it.shortcut}</span>
            </a>
          ))}
        </nav>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        <div className="sidebar-storage">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>workspace · 本地</span>
            <span>34.2 / 50 GB</span>
          </div>
          <div className="sidebar-storage-bar"><div style={{ width: "68%" }} /></div>
          <div style={{ color: "var(--text-faint)", marginTop: 2 }}>~/aishop · MinIO synced 12m</div>
        </div>
      </div>
    </aside>
  );
};

// ============ Topbar ============
const Topbar = ({ crumbs, locale, setLocale, right }) => (
  <header className="topbar">
    <div className="crumb">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="crumb-sep">/</span>}
          {i === crumbs.length - 1
            ? <span className="crumb-current">{c}</span>
            : <span>{c}</span>}
        </React.Fragment>
      ))}
    </div>
    <div className="topbar-spacer" />
    {right}
    <button className="topbar-action" title="搜索">
      <Icon name="search" size={14}/>
      <span>搜索</span>
      <span className="mono">⌘K</span>
    </button>
    <div className="locale-toggle" role="tablist">
      <button className={locale === "zh" ? "is-active" : ""} onClick={() => setLocale("zh")}>中</button>
      <button className={locale === "en" ? "is-active" : ""} onClick={() => setLocale("en")}>EN</button>
    </div>
    <div className="provider-status" title="OpenAI · gpt-4o + DashScope · qwen-vl">
      <span className="dot" />
      <span>路由正常</span>
      <span className="mono">5 / 5</span>
    </div>
    <div className="avatar">L</div>
  </header>
);

// ============ Striped SVG placeholder ============
const Placeholder = ({ label, ratio = "1/1", tint = "#2A211C", stripe = "#1F1A16" }) => (
  <div style={{
    aspectRatio: ratio,
    background: `repeating-linear-gradient(45deg, ${tint} 0 6px, ${stripe} 6px 12px)`,
    border: "1px solid var(--border-subtle)",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-faint)",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  }}>{label}</div>
);

Object.assign(window, {
  Icon, StatusChip, ComplianceRing, Sparkline, LocaleFlag,
  Sidebar, Topbar, Placeholder, labelMap,
});

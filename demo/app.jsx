/* global React, ReactDOM, Sidebar, Topbar, Dashboard, KitDetail, Providers, useTweaks, TweaksPanel, TweakSection, TweakColor, TweakSelect */

const ACCENT_MAP = {
  "古铜红":   { token: "bronze",    swatch: "#C4513A" },
  "蜂蜜金":   { token: "amber",     swatch: "#B8843A" },
  "沉橄榄":   { token: "moss",      swatch: "#6B8E5A" },
  "墨青":     { token: "ink",       swatch: "#4A6F8E" },
  "茄绛":     { token: "aubergine", swatch: "#7A4666" },
};
const ACCENT_SWATCHES = Object.values(ACCENT_MAP).map((v) => v.swatch);
const TYPE_MAP = {
  "Instrument Serif × Inter": "instrument",
  "Fraunces × Inter":         "fraunces",
  "Noto Serif SC (all)":      "serif-only",
  "JetBrains Mono display":   "mono-display",
};

const PAGE_CRUMBS = {
  "dashboard":   ["AIShop Studio", "首页 · Dashboard"],
  "kit-detail":  ["AIShop Studio", "商品库", "云感针织开衫 · NEW001"],
  "providers":   ["AIShop Studio", "设置", "模型路由 · Providers"],
};

const SIDEBAR_KEY = {
  "dashboard": "dashboard",
  "kit-detail": "catalog",
  "providers":  "providers",
};

const accentFromSwatch = (s) => {
  const name = Object.keys(ACCENT_MAP).find((k) => ACCENT_MAP[k].swatch === s);
  return name || "古铜红";
};

const App = () => {
  const [screen, setScreen] = React.useState("dashboard");
  const [locale, setLocale] = React.useState("zh");
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);

  const accentSwatch = ACCENT_MAP[t.accent]?.swatch || ACCENT_SWATCHES[0];
  const accentToken = ACCENT_MAP[t.accent]?.token || "bronze";
  const typeToken = TYPE_MAP[t.typePair] || "instrument";

  React.useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace("#/", "");
      if (["dashboard","kit-detail","providers"].includes(h)) setScreen(h);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const goto = (s) => {
    setScreen(s);
    window.location.hash = `/${s}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell" data-accent={accentToken} data-type={typeToken}>
      <Sidebar current={SIDEBAR_KEY[screen]} onNav={(k) => {
        if (k === "dashboard")      goto("dashboard");
        else if (k === "providers") goto("providers");
        else                         goto("dashboard");
      }} />
      <main className="main">
        <Topbar
          crumbs={PAGE_CRUMBS[screen]}
          locale={locale}
          setLocale={setLocale}
          right={screen === "kit-detail" ? (
            <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", padding: "0 6px" }}>
              auto-saved · 12s ago
            </span>
          ) : null}
        />
        {screen === "dashboard"  && <Dashboard  locale={locale} goto={goto}/>}
        {screen === "kit-detail" && <KitDetail  locale={locale} goto={goto}/>}
        {screen === "providers"  && <Providers  locale={locale} goto={goto}/>}
      </main>

      <TweaksPanel>
        <TweakSection label="Accent">
          <TweakColor
            label={t.accent}
            value={accentSwatch}
            options={ACCENT_SWATCHES}
            onChange={(s) => setTweak("accent", accentFromSwatch(s))}
          />
        </TweakSection>
        <TweakSection label="Type pair">
          <TweakSelect
            label=""
            value={t.typePair}
            options={Object.keys(TYPE_MAP)}
            onChange={(v) => setTweak("typePair", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

const mount = () => {
  if (!window.Sidebar || !window.Dashboard || !window.KitDetail || !window.Providers || !window.TweaksPanel || !window.useTweaks) {
    return setTimeout(mount, 20);
  }
  ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
};
mount();

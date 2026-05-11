/* global React, Icon, StatusChip, ComplianceRing, LocaleFlag */

// Unsplash images — fashion / knitwear / skincare adjacent
// Use diverse direct urls with consistent dimensions
const HERO_IMGS = [
  "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=900&q=80&auto=format&fit=crop",   // knit/fabric
  "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=900&q=80&auto=format&fit=crop",   // cream sweater
  "https://images.unsplash.com/photo-1571513800374-df1bbe650e56?w=900&q=80&auto=format&fit=crop",   // beige knit close
  "https://images.unsplash.com/photo-1583744946564-b52ac1c389c8?w=900&q=80&auto=format&fit=crop",   // earthy editorial
  "https://images.unsplash.com/photo-1611042553365-9b101441c135?w=900&q=80&auto=format&fit=crop",   // model knit
];
const DETAIL_IMGS = [
  "https://images.unsplash.com/photo-1551798507-629020c81463?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1606513542745-97629752a13b?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1620799140188-3b2a02fd9a77?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1604176354204-9268737828e4?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1599335316713-580d9e3ee44a?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1612442058888-2d8c5e4d6ba9?w=700&q=80&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1583846783214-7229a91b20ed?w=700&q=80&auto=format&fit=crop",
];

const HERO_META = [
  { num: "H1", tag: "主图 · Hero", channel: "淘宝主图" },
  { num: "H2", tag: "主图 · Lifestyle", channel: "Amazon Hero" },
  { num: "H3", tag: "主图 · Macro", channel: "抖店首屏" },
  { num: "H4", tag: "主图 · Scene", channel: "小红书" },
  { num: "H5", tag: "主图 · Hold", channel: "微信视频号" },
];
const DETAIL_META = [
  { num: "M1", tag: "材质特写", channel: "详情" },
  { num: "M2", tag: "肌理 Macro", channel: "详情" },
  { num: "M3", tag: "尺码示意", channel: "详情" },
  { num: "M4", tag: "工艺细节", channel: "详情" },
  { num: "M5", tag: "搭配场景", channel: "详情" },
  { num: "M6", tag: "穿着对比", channel: "详情" },
  { num: "M7", tag: "色卡对照", channel: "详情" },
  { num: "M8", tag: "包装实拍", channel: "详情" },
  { num: "M9", tag: "卖点海报", channel: "详情" },
];

const SpecContent = ({ tab }) => {
  if (tab === "画面") return (
    <>
      <h2><span className="num">M1·</span>材质特写</h2>
      <blockquote>"让针织的呼吸感被看见。" — 灯光、织线、皮肤的三角关系。</blockquote>
      <p><strong>构图</strong>：中景偏上，模特半身入画，肩颈线为视觉锚点。背景米浮白纸卡，留出右侧 40% 负空间承载图内文案。</p>
      <p><strong>光线</strong>：45° 主光 + 侧逆补光，针织线圈高光为暖偏 5500K，阴影沉入 <em>古铜红</em> 调，避免冷蓝偏色。</p>
      <h3>构图关键词</h3>
      <p>negative space · 织物呼吸 · macro yarn · soft shadow</p>
      <h3>禁用元素</h3>
      <ul>
        <li>过曝阳光斑、彩色滤镜、动漫感渐变</li>
        <li>模特正脸 (M1–M3 仅展示肩颈以下)</li>
        <li>非品牌色字幕条</li>
      </ul>
    </>
  );
  if (tab === "图内文案") return (
    <>
      <h2><span className="num">M1·</span>图内文案</h2>
      <p>顶部右上角主标 + 左下脚标。中文为主，英文副标控制在 ≤ 12 字。</p>
      <table>
        <thead>
          <tr><th>层</th><th>内容</th><th>字号</th></tr>
        </thead>
        <tbody>
          <tr><td>主标</td><td>云感针织 · 重 0.32 kg</td><td>72</td></tr>
          <tr><td>副标</td><td>Cloud-Knit Cardigan</td><td>24</td></tr>
          <tr><td>脚注</td><td>NEW001 · S/M/L · 4 colors</td><td>16</td></tr>
        </tbody>
      </table>
      <h3>禁用词</h3>
      <p>"最佳 / 国家级 / 顶级"等绝对化用语；"100% 防水"等无依据承诺。</p>
      <h3>合规</h3>
      <p>本块经 <code>compliance.v2</code> 校验通过，得分 <strong style={{ color: "var(--success)" }}>96 / 100</strong>。</p>
    </>
  );
  return (
    <>
      <h2><span className="num">M1·</span>设计说明</h2>
      <p>本图作为详情页第一屏，承担 <strong>"建立材质信任"</strong> 的任务。文案让位于材质，留白让位于光。</p>
      <h3>层叠顺序</h3>
      <p><code>background</code> → <code>fabric_macro</code> → <code>highlight_pass</code> → <code>copy_layer</code> → <code>brand_lock_dot</code></p>
      <h3>导出预设</h3>
      <p>淘宝主图 800×800 · Amazon 2000×2000 · 详情通用 750×1000 · sRGB · 品牌色 <code>#C4513A</code> 守恒</p>
      <h3>变体策略</h3>
      <p>本图保留 4 个 variant：色温微调 (±200K)、模特朝向、文案位置、负空间留白比例。</p>
    </>
  );
};

// =========== TILE (single image in the 14-grid) ===========
const Tile = ({ src, num, tag, isHover, onHover }) => (
  <div
    className={`tile ${isHover ? "is-hover" : ""}`}
    onMouseEnter={onHover}
    onMouseLeave={() => onHover(null)}
  >
    <img src={src} alt={tag} loading="lazy"/>
    <span className="tile-lock-dot" title="Brand color locked #C4513A"/>
    <span className="tile-tag">
      <span style={{ color: "var(--accent-soft)" }}>{num}</span> · {tag}
    </span>
    <div className="tile-toolbar" onClick={(e) => e.stopPropagation()}>
      <button title="重新生成"><Icon name="refresh" size={13}/></button>
      <button title="编辑文字"><Icon name="edit" size={13}/></button>
      <button title="prompt"><Icon name="code" size={13}/></button>
      <button title="变体"><Icon name="variants" size={13}/></button>
    </div>
  </div>
);

// =========== KIT DETAIL ===========
const KitDetail = ({ locale, goto }) => {
  const [tab, setTab] = React.useState("画面");
  const [section, setSection] = React.useState("M1");
  const [hover, setHover] = React.useState(null);
  const [openDock, setOpenDock] = React.useState(null); // null | 'compliance' | 'provider' | 'cost'
  const tabs = locale === "zh"
    ? [{k:"画面",c:14},{k:"图内文案",c:14},{k:"设计说明",c:14}]
    : [{k:"画面",c:14,l:"Composition"},{k:"图内文案",c:14,l:"In-image Copy"},{k:"设计说明",c:14,l:"Design Notes"}];

  return (
    <>
      {/* sticky kit header */}
      <div className="kit-header">
        <button className="btn btn-ghost" onClick={() => goto("dashboard")} title="返回">
          <Icon name="chevLeft" size={14}/> 返回
        </button>
        <div className="kit-header-id">
          <div className="name">云感针织开衫 <span style={{ color: "var(--text-faint)", fontSize: 14, fontFamily: "var(--font-mono)", letterSpacing: 0, fontStyle: "normal", marginLeft: 8 }}>Cloud-Knit Cardigan</span></div>
          <div className="meta">
            <span>NEW001</span>
            <span className="dot"/>
            <LocaleFlag code="CN"/>
            <span className="dot"/>
            <span>类目 · 女装 / 针织</span>
            <span className="dot"/>
            <span>更新 · 12 分钟前</span>
            <span className="dot"/>
            <span style={{ color: "var(--text-secondary)" }}>由 <span style={{ color: "var(--accent-soft)" }}>L</span> 创建</span>
          </div>
        </div>
        <div className="kit-header-actions">
          <StatusChip status="ready" locale={locale}/>
          <ComplianceRing value={92} size={44} stroke={3} showLabel={false} locale={locale}/>
          <span className="kbd" style={{ marginLeft: 4 }}>⌘E</span>
          <button className="btn"><Icon name="refresh" size={12}/> 重生套包</button>
          <button className="btn"><Icon name="download" size={12}/> 导出 zip</button>
          <button className="btn-primary"><Icon name="edit" size={13}/> 进入编辑器</button>
        </div>
      </div>

      {/* main body */}
      <div className="kit-body">
        {/* === Spec column === */}
        <div className="spec-col">
          <div className="spec-tabs" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.k}
                className={`spec-tab ${tab === t.k ? "is-active" : ""}`}
                onClick={() => setTab(t.k)}
              >
                {t.k}
                <span className="count">{t.c}</span>
              </button>
            ))}
          </div>

          <div className="spec-content">
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.10em", textTransform: "uppercase" }}>
              spec.md · markdown rendered · 14 sections
            </p>
            <SpecContent tab={tab}/>

            <hr/>

            <h2><span className="num">M2·</span>肌理 Macro</h2>
            <p>近距离展示<strong>蓬松线圈</strong>的纤维走向，肉眼可分辨 6–8 股捻线。在 100% 放大下保留 1px 的光晕，确保电商压缩后仍清晰。</p>
            <div className="spec-inline-tabs">
              <button className="is-active">画面</button>
              <button>图内文案</button>
              <button>设计说明</button>
            </div>
            <p>使用 <code>flux-1-pro</code> 生成；refinement 由 <code>qwen-vl-max</code> 做 OCR 与品牌色锁定校验。</p>

            <h2><span className="num">M3·</span>尺码示意</h2>
            <p>采用 <em>不出镜对照</em> 策略——以衣物平铺与卷尺并置，避免人体尺度争议。</p>

            <h2><span className="num">M4·</span>工艺细节</h2>
            <p>领口锁边、袖口罗纹、纽扣特写三件套。<strong>禁止</strong>出现非本款的他款配饰。</p>
          </div>
        </div>

        {/* === Grid column === */}
        <div className="grid-col">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div className="brand-lock">
              <span className="brand-lock-swatch" />
              <span className="brand-lock-hex">#C4513A</span>
              <span className="brand-lock-label-zh">品牌色 · 已锁定 14/14</span>
              <span className="brand-lock-key">LOCK</span>
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
              · 5 hero (1:1) · 9 detail (2:3) · 14 / 14 generated
            </span>
            <div style={{ flex: 1 }}/>
            <button className="btn"><Icon name="sparkle" size={12}/> 全部变体</button>
            <button className="btn"><Icon name="eye" size={12}/> 灯箱模式</button>
          </div>

          {/* hero row */}
          <div className="grid14-label">
            <span className="num">H1–H5</span>
            <span className="name">主图 · 1:1</span>
            <span className="count">5 张 · brand-lock active</span>
          </div>
          <div className="grid14-row hero" data-hover={hover != null ? "true" : "false"}>
            {HERO_IMGS.map((src, i) => (
              <Tile key={i} src={src} num={HERO_META[i].num} tag={HERO_META[i].tag} isHover={hover === `h${i}`} onHover={(v) => setHover(v === null ? null : `h${i}`)}/>
            ))}
          </div>

          {/* detail row */}
          <div className="grid14-label" style={{ marginTop: 12 }}>
            <span className="num">M1–M9</span>
            <span className="name">详情 · 2:3</span>
            <span className="count">9 张 · stagger 80ms</span>
          </div>
          <div className="grid14-row detail" data-hover={hover != null ? "true" : "false"}>
            {DETAIL_IMGS.map((src, i) => (
              <Tile key={i} src={src} num={DETAIL_META[i].num} tag={DETAIL_META[i].tag} isHover={hover === `d${i}`} onHover={(v) => setHover(v === null ? null : `d${i}`)}/>
            ))}
          </div>

          <div style={{ paddingTop: 12, display: "flex", alignItems: "center", gap: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <span>hover any tile → others dim, hovered rises 4px with glow</span>
            <span style={{ flex: 1 }}/>
            <span>cost: $0.42</span><span>·</span>
            <span>compliance: 92</span><span>·</span>
            <span>generated: 4m 12s</span>
          </div>
        </div>
      </div>

      {/* Floating dock */}
      <div className="dock" role="toolbar">
        <div className={`dock-pane ${openDock === "compliance" ? "is-open" : ""}`} onClick={() => setOpenDock(openDock === "compliance" ? null : "compliance")}>
          <ComplianceRing value={92} size={36} stroke={3} showLabel={false}/>
          <div className="dock-pane-meta">
            <span className="dock-pane-label">合规 · Compliance</span>
            <span className="dock-pane-value">92 <span style={{ fontSize: 11, color: "var(--text-faint)", fontStyle: "normal", fontFamily: "var(--font-mono)" }}>/100</span></span>
          </div>
          <Icon name="chevDown" size={14}/>
        </div>
        <div className={`dock-pane ${openDock === "provider" ? "is-open" : ""}`} onClick={() => setOpenDock(openDock === "provider" ? null : "provider")}>
          <div className="dock-pane-meta">
            <span className="dock-pane-label">路由 · Provider trace</span>
            <span className="dock-pane-value">5 endpoints</span>
          </div>
          <span style={{ display: "flex", gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent-soft)" }}/>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#B5C8DC" }}/>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#E1D7C5" }}/>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#8FA88F" }}/>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#C9A989" }}/>
          </span>
          <Icon name="chevDown" size={14}/>
        </div>
        <div className={`dock-pane ${openDock === "cost" ? "is-open" : ""}`} onClick={() => setOpenDock(openDock === "cost" ? null : "cost")}>
          <div className="dock-pane-meta">
            <span className="dock-pane-label">成本 · Cost breakdown</span>
            <span className="dock-pane-value">$0.42</span>
          </div>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 10 }}>14 imgs · 38k tok</span>
          <Icon name="chevDown" size={14}/>
        </div>
      </div>

      {openDock === "compliance" && (
        <div className="dock-drawer">
          <h4>合规明细 · Compliance breakdown</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 32px" }}>
            {[
              { k: "禁用绝对化用语", v: 100, n: "0 hits" },
              { k: "品牌色守恒", v: 100, n: "14/14 locked" },
              { k: "图内文案 OCR 一致性", v: 96, n: "1 mismatch" },
              { k: "敏感品类标签", v: 88, n: "checked · pass" },
              { k: "尺寸单位规范", v: 92, n: "cm primary" },
              { k: "图片清晰度", v: 84, n: "12/14 ≥ 1.2 MP" },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, fontSize: 12, color: "var(--text-secondary)" }}>{r.k}</div>
                <div style={{ flex: 1, height: 4, background: "var(--surface-02)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${r.v}%`, background: r.v > 90 ? "var(--success)" : r.v > 80 ? "var(--warning)" : "var(--danger)" }}/>
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 28, textAlign: "right" }}>{r.v}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--text-faint)", minWidth: 90, textAlign: "right" }}>{r.n}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {openDock === "provider" && (
        <div className="dock-drawer">
          <h4>路由轨迹 · Provider trace · this kit</h4>
          <table style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--text-faint)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", padding: "6px 0" }}>role</th>
                <th style={{ textAlign: "left" }}>endpoint</th>
                <th style={{ textAlign: "left" }}>model</th>
                <th style={{ textAlign: "right" }}>p50</th>
                <th style={{ textAlign: "right" }}>calls</th>
              </tr>
            </thead>
            <tbody style={{ color: "var(--text-secondary)" }}>
              <tr><td style={{ padding: "8px 0" }}>vision</td><td>dashscope.aliyuncs.com</td><td>qwen-vl-max</td><td style={{ textAlign: "right" }}>412 ms</td><td style={{ textAlign: "right" }}>3</td></tr>
              <tr><td style={{ padding: "8px 0" }}>llm</td><td>api.openai.com</td><td>gpt-4o-mini</td><td style={{ textAlign: "right" }}>286 ms</td><td style={{ textAlign: "right" }}>5</td></tr>
              <tr><td style={{ padding: "8px 0" }}>image_gen</td><td>api.fireworks.ai</td><td>flux-1-pro</td><td style={{ textAlign: "right" }}>9.4 s</td><td style={{ textAlign: "right" }}>14</td></tr>
              <tr><td style={{ padding: "8px 0" }}>image_edit</td><td>api.fal.run</td><td>flux-redux-dev</td><td style={{ textAlign: "right" }}>4.2 s</td><td style={{ textAlign: "right" }}>2</td></tr>
              <tr><td style={{ padding: "8px 0" }}>embedding</td><td>localhost:11434</td><td>bge-m3</td><td style={{ textAlign: "right" }}>34 ms</td><td style={{ textAlign: "right" }}>9</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {openDock === "cost" && (
        <div className="dock-drawer">
          <h4>成本明细 · Cost breakdown · USD</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
            {[
              { k: "image_gen · flux-1-pro × 14", v: 0.28 },
              { k: "image_edit · redux × 2",      v: 0.06 },
              { k: "llm · gpt-4o-mini · 38k tok", v: 0.04 },
              { k: "vision · qwen-vl-max × 3",    v: 0.03 },
              { k: "embedding · local bge-m3",    v: 0.00 },
              { k: "storage · MinIO 142 MB",      v: 0.01 },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, borderBottom: "1px solid var(--border-subtle)", padding: "8px 0" }}>
                <span style={{ fontSize: 11, color: "var(--text-secondary)", flex: 1, fontFamily: "var(--font-mono)" }}>{r.k}</span>
                <span className="serif-i" style={{ fontSize: 18, color: "var(--text-primary)" }}>${r.v.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, textAlign: "right", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            total · <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--text-primary)", marginLeft: 4 }}>$0.42</span>
          </div>
        </div>
      )}
    </>
  );
};

window.KitDetail = KitDetail;

// Time-series panels on top of the vendored uPlot (assets/vendor/uplot, MIT).
// One measure per panel, each on its own y-axis (never dual-axis); panels share the time
// axis: crosshair, hover readout and zoom are synchronised across the group.
// Colours come from CSS tokens (--chart-1, --chart-2, …) so light/dark themes both work.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function themeColors() {
  return {
    s1: css('--chart-1') || '#2a78d6',
    s2: css('--chart-2') || '#eb6834',
    band: css('--chart-band') || 'rgba(42,120,214,0.14)',
    faint: css('--chart-faint') || 'rgba(42,120,214,0.45)',
    grid: css('--chart-grid') || '#e1e0d9',
    axis: css('--chart-axis') || '#898781',
    text: css('--text') || '#17212b',
  };
}

const fmt = (v, d, unit) => (v == null || !Number.isFinite(v) ? '–' : `${v.toFixed(d)}${unit ? ' ' + unit : ''}`);

let groupSeq = 0;

/**
 * panels: [{ key, title, unit, decimals, height?, series: [{ label, color: 1|2|'faint', width?, dash? }], band?: [i, j] }]
 * Data per panel: [ys1, ys2, …] aligned to the shared x array (unix seconds).
 */
export class ChartGroup {
  constructor(host, panels, { follow = true, emptyText = 'No data yet.' } = {}) {
    if (typeof window.uPlot !== 'function') throw new Error('uPlot failed to load');
    this.host = host;
    this.panels = panels;
    this.follow = follow;
    this.syncKey = `g${++groupSeq}`;
    this.xs = [];
    this.ys = {};
    this.hidden = new Set();
    this.zoomed = false;
    this.window = null; // [min, max] while zoomed
    this.charts = new Map();
    this.applying = false;
    host.classList.add('chart-group');
    host.textContent = '';
    this.empty = document.createElement('p');
    this.empty.className = 'chart-empty';
    this.empty.textContent = emptyText;
    host.appendChild(this.empty);
    this.figures = new Map();
    for (const p of panels) {
      const fig = document.createElement('figure');
      fig.className = 'chart-panel';
      const cap = document.createElement('figcaption');
      cap.innerHTML = '';
      const t = document.createElement('span');
      t.className = 'chart-title';
      t.textContent = p.title;
      const u = document.createElement('span');
      u.className = 'chart-unit';
      u.textContent = p.unit ? `(${p.unit})` : '';
      cap.append(t, ' ', u);
      const plot = document.createElement('div');
      plot.className = 'chart-host';
      fig.append(cap, plot);
      host.appendChild(fig);
      this.figures.set(p.key, { fig, plot });
      this.ys[p.key] = p.series.map(() => []);
    }
    this.build();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.onTheme = () => this.build();
    document.addEventListener('themechange', this.onTheme);
    this.mq = window.matchMedia('(prefers-color-scheme: dark)');
    this.mq.addEventListener('change', this.onTheme);
  }

  width() {
    return Math.max(260, Math.floor(this.host.clientWidth));
  }

  build() {
    for (const c of this.charts.values()) c.destroy();
    this.charts.clear();
    const col = themeColors();
    const narrow = window.innerWidth < 600;
    for (const p of this.panels) {
      const { plot, fig } = this.figures.get(p.key);
      fig.hidden = this.hidden.has(p.key) || !this.xs.length;
      plot.textContent = '';
      const series = [
        { value: (u, v) => (v == null ? '–' : new Date(v * 1000).toLocaleString()) },
        ...p.series.map((s) => ({
          label: s.label,
          stroke: s.color === 2 ? col.s2 : s.color === 'faint' ? col.faint : col.s1,
          width: s.width ?? 2,
          dash: s.dash,
          points: { show: false },
          value: (u, v) => fmt(v, p.decimals ?? 2, p.unit),
          show: !this.hidden.has(`${p.key}:${s.label}`),
        })),
      ];
      const opts = {
        width: this.width(),
        height: p.height ?? (narrow ? 170 : 210),
        series,
        scales: { x: { time: true } },
        axes: [
          { stroke: col.axis, grid: { stroke: col.grid, width: 1 }, ticks: { stroke: col.grid, width: 1 }, font: '11px system-ui, sans-serif' },
          {
            stroke: col.axis,
            grid: { stroke: col.grid, width: 1 },
            ticks: { show: false },
            size: 52,
            font: '11px system-ui, sans-serif',
            values: (u, splits) => splits.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.min(2, p.decimals ?? 2)))),
          },
        ],
        legend: { show: true, live: true },
        cursor: {
          sync: { key: this.syncKey, setSeries: false },
          drag: { x: true, y: false, setScale: true },
          points: { size: 8, width: 2 },
        },
        bands: p.band ? [{ series: [p.band[0] + 1, p.band[1] + 1], fill: col.band }] : undefined,
        hooks: {
          setScale: [(u, key) => key === 'x' && this.onUserScale(u)],
        },
      };
      const chart = new window.uPlot(opts, this.dataFor(p.key), plot);
      this.charts.set(p.key, chart);
    }
    if (this.window) this.applyWindow(this.window[0], this.window[1]);
  }

  dataFor(key) {
    return [this.xs, ...this.ys[key]];
  }

  /** Keep all panels on the same x range when the user zooms one of them. */
  onUserScale(u) {
    if (this.applying) return;
    const { min, max } = u.scales.x;
    if (min == null || max == null || !this.xs.length) return;
    const first = this.xs[0];
    const last = this.xs[this.xs.length - 1];
    this.zoomed = min > first + 1e-6 || max < last - 1e-6;
    this.window = this.zoomed ? [min, max] : null;
    this.applyWindow(min, max, u);
  }

  applyWindow(min, max, except = null) {
    this.applying = true;
    try {
      for (const c of this.charts.values()) if (c !== except) c.setScale('x', { min, max });
    } finally {
      this.applying = false;
    }
  }

  /** Replace all data. xs: unix seconds; byPanel: { key: [ys…] }. */
  setData(xs, byPanel) {
    this.xs = xs;
    for (const p of this.panels) if (byPanel[p.key]) this.ys[p.key] = byPanel[p.key];
    this.redraw();
  }

  redraw() {
    const n = this.xs.length;
    this.empty.hidden = n > 0;
    for (const p of this.panels) this.figures.get(p.key).fig.hidden = this.hidden.has(p.key) || n === 0;
    if (n) this.resize();
    this.applying = true;
    try {
      for (const [key, c] of this.charts) c.setData(this.dataFor(key), !this.zoomed);
    } finally {
      this.applying = false;
    }
    if (this.zoomed && this.window && n) {
      let [min, max] = this.window;
      if (this.follow) {
        const w = max - min;
        max = this.xs[n - 1];
        min = max - w;
        this.window = [min, max];
      }
      this.applyWindow(min, max);
    }
  }

  setFollow(on) {
    this.follow = on;
    this.redraw();
  }

  resetZoom() {
    this.zoomed = false;
    this.window = null;
    this.redraw();
  }

  /** Show/hide a whole panel, or one series as `${key}:${label}`. */
  setVisible(id, show) {
    if (show) this.hidden.delete(id);
    else this.hidden.add(id);
    const [key, label] = id.split(':');
    if (label) {
      const c = this.charts.get(key);
      const idx = this.panels.find((p) => p.key === key).series.findIndex((s) => s.label === label);
      if (c && idx >= 0) c.setSeries(idx + 1, { show });
    } else {
      const f = this.figures.get(key);
      if (f) f.fig.hidden = !show || !this.xs.length;
      this.resize();
    }
  }

  resize() {
    const w = this.width();
    for (const c of this.charts.values()) if (c.width !== w) c.setSize({ width: w, height: c.height });
  }

  destroy() {
    this.ro.disconnect();
    document.removeEventListener('themechange', this.onTheme);
    this.mq.removeEventListener('change', this.onTheme);
    for (const c of this.charts.values()) c.destroy();
    this.charts.clear();
  }
}

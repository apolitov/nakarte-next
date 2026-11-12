<script lang="ts">
  import { gradeColor, SURFACE_STYLE, GRADE_STOPS, formatKm, type Profile, type SurfaceClass } from './lib/profile';

  let { profile, onhover }: { profile: Profile; onhover: (i: number | null) => void } = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let width = $state(600);
  const H = 150;
  const PAD = { l: 44, r: 10, t: 10, b: 30 };
  const STRIP = 6; // surface strip under the chart
  let hoverIdx = $state<number | null>(null);

  const scale = $derived.by(() => {
    const lo = profile.minEle ?? 0;
    const hi = profile.maxEle ?? 1;
    const span = Math.max(hi - lo, 50);
    const mid = (hi + lo) / 2;
    return { y0: mid - span * 0.55, y1: mid + span * 0.55, len: Math.max(profile.length, 1) };
  });

  const x = (d: number) => PAD.l + (d / scale.len) * (width - PAD.l - PAD.r);
  const y = (e: number) => PAD.t + (1 - (e - scale.y0) / (scale.y1 - scale.y0)) * (H - PAD.t - PAD.b - STRIP);

  function niceStep(range: number, target: number) {
    const raw = range / target;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  }

  function draw() {
    if (!canvas) return;
    const dpr = devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    const css = getComputedStyle(canvas);
    const fg = css.getPropertyValue('--muted') || '#888';
    const line = css.getPropertyValue('--line') || '#ccc';
    const { dist, ele, grade, surface } = profile;
    const bottom = H - PAD.b - STRIP;

    // grid
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = fg;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    const ys = niceStep(scale.y1 - scale.y0, 4);
    for (let v = Math.ceil(scale.y0 / ys) * ys; v <= scale.y1; v += ys) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, yy); ctx.lineTo(width - PAD.r, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(v)}`, PAD.l - 6, yy);
    }
    const xs = niceStep(scale.len, Math.max(2, Math.floor(width / 90)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let d = 0; d <= scale.len; d += xs) ctx.fillText(formatKm(d), x(d), H - PAD.b + STRIP + 4);

    // area, coloured by grade, segment by segment
    for (let i = 1; i < dist.length; i++) {
      const e0 = ele[i - 1], e1 = ele[i];
      if (e0 == null || e1 == null) continue;
      const x0 = x(dist[i - 1]), x1 = x(dist[i]);
      ctx.fillStyle = gradeColor(grade[i]);
      ctx.beginPath();
      ctx.moveTo(x0, bottom); ctx.lineTo(x0, y(e0)); ctx.lineTo(x1, y(e1)); ctx.lineTo(x1, bottom); ctx.closePath();
      ctx.fill();
      // hairline seams between thin segments otherwise show through
      ctx.strokeStyle = ctx.fillStyle; ctx.stroke();
    }
    // outline
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < dist.length; i++) {
      const e = ele[i];
      if (e == null) { started = false; continue; }
      if (!started) { ctx.moveTo(x(dist[i]), y(e)); started = true; } else ctx.lineTo(x(dist[i]), y(e));
    }
    ctx.stroke();

    // surface strip
    for (let i = 1; i < dist.length; i++) {
      ctx.fillStyle = SURFACE_STYLE[surface[i]].color;
      ctx.fillRect(x(dist[i - 1]), bottom + 1, Math.max(1, x(dist[i]) - x(dist[i - 1]) + 0.5), STRIP);
    }

    // hover
    if (hoverIdx != null && ele[hoverIdx] != null) {
      const hx = Math.round(x(dist[hoverIdx])) + 0.5;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, PAD.t); ctx.lineTo(hx, bottom); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(hx, y(ele[hoverIdx]!), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  $effect(() => {
    void profile; void width; void hoverIdx;
    draw();
  });

  $effect(() => {
    const ro = new ResizeObserver(() => (width = wrap.clientWidth));
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  function pick(ev: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const d = ((ev.clientX - r.left - PAD.l) / (width - PAD.l - PAD.r)) * scale.len;
    const { dist } = profile;
    if (!dist.length || d < 0 || d > scale.len) return leave();
    let lo = 0, hi = dist.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (dist[m] < d) lo = m; else hi = m; }
    hoverIdx = d - dist[lo] < dist[hi] - d ? lo : hi;
    onhover(hoverIdx);
  }
  function leave() {
    hoverIdx = null;
    onhover(null);
  }

  const info = $derived.by(() => {
    if (hoverIdx == null) return null;
    const e = profile.ele[hoverIdx];
    const g = profile.grade[hoverIdx];
    return {
      d: formatKm(profile.dist[hoverIdx]),
      e: e == null ? '—' : `${Math.round(e)} м`,
      g: g == null ? '—' : `${g > 0 ? '+' : ''}${g.toFixed(1)}%`,
      s: SURFACE_STYLE[profile.surface[hoverIdx]].title,
    };
  });

  const surfaceShare = $derived.by(() => {
    const acc: Partial<Record<SurfaceClass, number>> = {};
    const { dist, surface } = profile;
    for (let i = 1; i < dist.length; i++) acc[surface[i]] = (acc[surface[i]] ?? 0) + dist[i] - dist[i - 1];
    return (Object.entries(acc) as [SurfaceClass, number][])
      .filter(([, m]) => m / profile.length > 0.005)
      .sort((a, b) => b[1] - a[1]);
  });
</script>

<div class="profile" bind:this={wrap}>
  <div class="head">
    <span><b>{formatKm(profile.length)}</b></span>
    <span>↗ {Math.round(profile.ascent)} м</span>
    <span>↘ {Math.round(profile.descent)} м</span>
    {#if profile.maxEle != null}<span class="muted">{Math.round(profile.minEle!)}–{Math.round(profile.maxEle)} м</span>{/if}
    {#if info}
      <span class="hover">{info.d} · {info.e} · {info.g} · {info.s}</span>
    {/if}
  </div>
  <canvas
    bind:this={canvas}
    style="width:{width}px;height:{H}px"
    onpointermove={pick}
    onpointerdown={pick}
    onpointerleave={leave}
  ></canvas>
  <div class="legend">
    <span class="muted">Уклон:</span>
    {#each GRADE_STOPS as [v, c] (v)}<span class="sw" style="background:{c}"></span>{v}%{/each}
    <span class="sep"></span>
    {#each surfaceShare as [s, m] (s)}
      <span class="sw" style="background:{SURFACE_STYLE[s].color}"></span>{SURFACE_STYLE[s].title} {Math.round((m / profile.length) * 100)}%
    {/each}
  </div>
</div>

<style>
  .profile {
    width: 100%;
  }
  canvas {
    display: block;
    touch-action: none;
    cursor: crosshair;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 0 4px 4px;
    font-variant-numeric: tabular-nums;
  }
  .head .hover {
    margin-left: auto;
  }
  .muted {
    color: var(--muted);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 12px;
    padding: 2px 4px 0;
  }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .sep {
    width: 10px;
  }
</style>

<script lang="ts">
  import { t } from '../lib/i18n';
  import { FERRY_COLOR, gradeColor, SURFACE_DASH, type Profile } from '../lib/profile';
  import { kindOf } from '../lib/checkpointKinds';
  import { SEG_SHORT, STRAIGHT_COLOR, dec, type SegClass } from '../lib/timeline';

  let {
    profile,
    classes,
    marks = [],
    maxGrade = 0,
    hoverIdx = null,
    band = null,
    height = 150,
    routeType = 'nk-road',
    onhover,
    onpick,
  }: {
    profile: Profile;
    classes: SegClass[];
    marks?: { d: number; kind: string; name: string }[];
    maxGrade?: number;
    hoverIdx?: number | null;
    /** highlighted stretch, metres */
    band?: [number, number] | null;
    height?: number;
    /** route type: picks the grade scale */
    routeType?: string;
    onhover: (i: number | null) => void;
    onpick?: (i: number) => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let tipEl: HTMLDivElement | undefined = $state();
  let width = $state(600);
  let themeTick = $state(0);

  const narrow = $derived(width < 500);
  const PAD = $derived({ l: narrow ? 34 : 44, r: 10, t: 26, b: 36 });

  const scale = $derived.by(() => {
    const mn = profile.minEle ?? 0;
    const mx = profile.maxEle ?? 100;
    let lo = Math.floor((mn - 15) / 50) * 50;
    let hi = Math.ceil((mx + 25) / 50) * 50;
    if (hi - lo < 100) hi = lo + 100;
    return { lo, hi, len: Math.max(profile.length, 1) };
  });

  const pw = $derived(width - PAD.l - PAD.r);
  const ph = $derived(height - PAD.t - PAD.b);
  const X = (d: number) => PAD.l + (d / scale.len) * pw;
  const Y = (e: number) => PAD.t + ph * (1 - (e - scale.lo) / (scale.hi - scale.lo));

  function niceStep(range: number, target: number) {
    const raw = range / Math.max(1, target);
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw)!;
  }

  let hatch: CanvasPattern | null = null;
  function hatchPattern(ctx: CanvasRenderingContext2D) {
    if (hatch) return hatch;
    const p = document.createElement('canvas');
    p.width = p.height = 8;
    const c = p.getContext('2d')!;
    c.strokeStyle = 'rgba(20,20,20,.6)';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-1, 9); c.lineTo(9, -1);
    c.moveTo(-1, 5); c.lineTo(5, -1);
    c.moveTo(3, 9); c.lineTo(9, 3);
    c.stroke();
    hatch = ctx.createPattern(p, 'repeat');
    return hatch;
  }

  const icons = new Map<string, Path2D>();
  const iconOf = (k: string) => {
    let p = icons.get(k);
    if (!p) icons.set(k, (p = new Path2D(kindOf(k).path)));
    return p;
  };

  function draw() {
    if (!canvas || width < 50) return;
    const dpr = devicePixelRatio || 1;
    const w = width, h = height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
    const ink = v('--ink', '#141414'), soft = v('--soft', '#5f5f5c'), grid = v('--line', '#e4e2dc'), paper = v('--paper', '#fff');
    const { dist, ele, grade } = profile;
    const n = dist.length;
    const bottom = PAD.t + ph;
    const mono = '"JetBrains Mono", ui-monospace, monospace';

    // grid and elevation labels
    ctx.font = `11px ${mono}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const ys = niceStep(scale.hi - scale.lo, 4);
    for (let e = Math.ceil(scale.lo / ys) * ys; e <= scale.hi; e += ys) {
      const y = Math.round(Y(e)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.fillStyle = soft;
      ctx.textAlign = 'right';
      ctx.fillText(`${e}${narrow ? '' : ` ${t('unit.m')}`}`, PAD.l - 5, y);
    }

    // highlighted stretch
    if (band) {
      ctx.fillStyle = 'rgba(255,216,61,.45)';
      ctx.fillRect(X(band[0]), PAD.t - 4, Math.max(3, X(band[1]) - X(band[0])), ph + 8);
    }

    // area coloured by grade; stretches over the limit hatched
    const pat = maxGrade ? hatchPattern(ctx) : null;
    for (let i = 1; i < n; i++) {
      const e0 = ele[i - 1], e1 = ele[i];
      if (e0 == null || e1 == null) continue;
      const x0 = X(dist[i - 1]) - 0.4, x1 = X(dist[i]) + 0.4;
      ctx.beginPath();
      ctx.moveTo(x0, Y(e0)); ctx.lineTo(x1, Y(e1)); ctx.lineTo(x1, bottom); ctx.lineTo(x0, bottom); ctx.closePath();
      ctx.fillStyle = classes[i] === 'ferry' ? 'rgba(47,127,193,.22)' : gradeColor(grade[i], routeType);
      ctx.fill();
      if (pat && (grade[i] ?? 0) > maxGrade) {
        ctx.fillStyle = pat;
        ctx.fill();
      }
    }
    // outline
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const e = ele[i];
      if (e == null) { started = false; continue; }
      if (!started) { ctx.moveTo(X(dist[i]), Y(e)); started = true; } else ctx.lineTo(X(dist[i]), Y(e));
    }
    ctx.stroke();

    // boat crossings: the word over the stretch, when there is room for it
    ctx.save();
    ctx.font = `600 11px ${getComputedStyle(canvas).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i0 = 1; i0 < n; ) {
      let i1 = i0;
      while (i1 + 1 < n && classes[i1 + 1] === classes[i0]) i1++;
      if (classes[i0] === 'ferry') {
        const xa = X(dist[i0 - 1]), xb = X(dist[i1]);
        let top = Infinity;
        for (let i = i0 - 1; i <= i1; i++) if (ele[i] != null) top = Math.min(top, Y(ele[i]!));
        const label = '⛴ ' + SEG_SHORT.ferry;
        if (xb - xa >= ctx.measureText(label).width + 6) {
          ctx.fillStyle = FERRY_COLOR;
          ctx.fillText(label, (xa + xb) / 2, Math.min(top, bottom) - 4);
        }
      }
      i0 = i1 + 1;
    }
    ctx.restore();

    // surface strip: the dash patterns of the map line
    const sy = bottom + 10;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    for (let i0 = 1; i0 < n; ) {
      const c = classes[i0];
      let i1 = i0;
      while (i1 + 1 < n && classes[i1 + 1] === c) i1++;
      const d = c === 'straight' ? [2, 2] : c === 'unknown' ? [1, 0] : SURFACE_DASH[c];
      ctx.strokeStyle = c === 'straight' ? STRAIGHT_COLOR : c === 'unknown' ? grid : c === 'ferry' ? FERRY_COLOR : ink;
      ctx.setLineDash(d[1] === 0 ? [] : d.map((x) => x * 5));
      ctx.beginPath();
      ctx.moveTo(X(dist[i0 - 1]), sy);
      ctx.lineTo(X(dist[i1]), sy);
      ctx.stroke();
      i0 = i1 + 1;
    }
    ctx.setLineDash([]);

    // km labels
    ctx.fillStyle = soft;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const xs = niceStep(scale.len / 1000, Math.max(2, Math.floor(w / 80)));
    for (let k = 0; k * 1000 <= scale.len + 1; k += xs) {
      const label = `${Number.isInteger(k) ? k : dec(k)}${k === 0 ? ` ${t('unit.km')}` : ''}`;
      ctx.fillText(label, Math.max(PAD.l + 10, X(k * 1000)), h - 4);
    }

    // checkpoints: a dotted line and the icon in a circle at the top
    for (const m of marks) {
      const x = Math.round(X(m.d)) + 0.5;
      const i = nearestIdx(m.d);
      const ey = ele[i] != null ? Y(ele[i]!) : bottom;
      ctx.strokeStyle = soft;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, ey); ctx.lineTo(x, 21); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = paper;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, 11, 10, 0, 7); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.translate(x - 7, 4);
      ctx.scale(14 / 24, 14 / 24);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(iconOf(m.kind));
      ctx.restore();
    }

    // cursor
    if (hoverIdx != null && hoverIdx < n) {
      const x = Math.round(X(dist[hoverIdx])) + 0.5;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, bottom + 14); ctx.stroke();
      const e = ele[hoverIdx];
      if (e != null) {
        ctx.fillStyle = '#ffd83d';
        ctx.strokeStyle = '#141414';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, Y(e), 5.5, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
  }

  function nearestIdx(d: number) {
    const { dist } = profile;
    let lo = 0, hi = dist.length - 1;
    if (hi < 1) return 0;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (dist[m] < d) lo = m;
      else hi = m;
    }
    return d - dist[lo] < dist[hi] - d ? lo : hi;
  }

  $effect(() => {
    void profile; void classes; void width; void height; void hoverIdx; void marks; void band; void maxGrade; void themeTick; void routeType;
    draw();
  });

  $effect(() => {
    const ro = new ResizeObserver(() => (width = wrap.clientWidth));
    ro.observe(wrap);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const bump = () => themeTick++;
    mq.addEventListener('change', bump);
    document.fonts?.ready.then(bump);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', bump);
    };
  });

  function idxAt(ev: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const d = ((ev.clientX - r.left - PAD.l) / pw) * scale.len;
    return nearestIdx(Math.max(0, Math.min(scale.len, d)));
  }

  const info = $derived.by(() => {
    if (hoverIdx == null || hoverIdx >= profile.dist.length) return null;
    const e = profile.ele[hoverIdx];
    const g = profile.grade[hoverIdx];
    return {
      x: X(profile.dist[hoverIdx]),
      d: `${dec(profile.dist[hoverIdx] / 1000)} ${t('unit.km')}`,
      e: e == null ? '' : `${Math.round(e)} ${t('unit.m')}`,
      g: g == null ? '' : `${g >= 0 ? '↑' : '↓'} ${dec(Math.abs(g))}%`,
      s: SEG_SHORT[classes[hoverIdx] ?? 'unknown'],
    };
  });
  let tipW = $state(0);
  $effect(() => {
    void info;
    tipW = tipEl?.offsetWidth ?? 0;
  });
</script>

<div class="cv" bind:this={wrap} style="height:{height}px">
  <canvas
    bind:this={canvas}
    style="width:{width}px;height:{height}px"
    aria-label={t('prof.canvas')}
    onpointermove={(e) => onhover(idxAt(e))}
    onpointerdown={(e) => onhover(idxAt(e))}
    onpointerleave={() => onhover(null)}
    onclick={(e) => onpick?.(idxAt(e as unknown as PointerEvent))}
  ></canvas>
  {#if info}
    <div class="tip" bind:this={tipEl} style="left:{Math.max(4, Math.min(width - tipW - 4, info.x - tipW / 2))}px">
      <b class="num">{info.d}</b>
      {#if info.e}<span class="num">{info.e}</span>{/if}
      {#if info.g}<span class="num">{info.g}</span>{/if}
      <span>{info.s}</span>
    </div>
  {/if}
</div>

<style>
  .cv {
    position: relative;
  }
  canvas {
    display: block;
    touch-action: none;
    cursor: crosshair;
  }
  .tip {
    position: absolute;
    top: 26px;
    z-index: 3;
    pointer-events: none;
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--tipbg);
    color: var(--tipink);
    font-size: 12.5px;
    white-space: nowrap;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
  }
  .tip b {
    font-weight: 500;
  }
</style>

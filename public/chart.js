/* Lightweight canvas candlestick chart with volume, crosshair, zoom/pan and price lines. */
'use strict';

class CandleChart {
  constructor(container, { decimals = 2 } = {}) {
    this.el = container;
    this.decimals = decimals;
    this.candles = [];
    this.lines = [];
    this.visible = 90;    // candles on screen
    this.offset = 0;      // candles scrolled back from the right edge
    this.mouse = null;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.colors = { up: '#19e37d', down: '#ff4d63', grid: 'rgba(160,255,220,0.06)', text: '#7f9c93', cross: 'rgba(232,243,239,0.35)', vol: 'rgba(160,190,180,0.22)' };
    new ResizeObserver(() => this.resize()).observe(container);
    this.bind();
    this.resize();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      if (this.drag) {
        const step = (this.plotW / this.visible);
        const moved = Math.round((e.clientX - this.drag.x) / step);
        this.offset = Math.max(0, Math.min(this.candles.length - 10, this.drag.offset + moved));
      }
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    c.addEventListener('mouseleave', () => { this.mouse = null; this.drag = null; this.draw(); });
    c.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, offset: this.offset }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.12 : 0.89;
      this.visible = Math.round(Math.max(20, Math.min(400, this.visible * f)));
      this.draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.offset = 0; this.visible = 90; this.draw(); });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.el.getBoundingClientRect();
    this.w = Math.max(200, width); this.h = Math.max(160, height);
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setData(candles, decimals) {
    this.candles = candles.slice();
    if (decimals !== undefined) this.decimals = decimals;
    this.offset = 0;
    this.draw();
  }

  // Merge a live candle (same bucket replaces, new bucket appends)
  update(c) {
    const last = this.candles[this.candles.length - 1];
    if (last && last.t === c.t) Object.assign(last, c);
    else if (!last || c.t > last.t) this.candles.push({ ...c });
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(); });
  }

  setLines(lines) { this.lines = lines || []; this.draw(); }

  fmt(v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: this.decimals, maximumFractionDigits: this.decimals }); }

  draw() {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const axisW = 78, axisH = 24;
    const plotW = (this.plotW = w - axisW), plotH = h - axisH;
    const volH = plotH * 0.16;
    const end = this.candles.length - this.offset;
    const start = Math.max(0, end - this.visible);
    const data = this.candles.slice(start, end);
    if (!data.length) { ctx.fillStyle = this.colors.text; ctx.fillText('Loading…', 20, 30); return; }

    let hi = -Infinity, lo = Infinity, vmax = 0;
    for (const c of data) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); vmax = Math.max(vmax, c.v); }
    for (const l of this.lines) if (l.price > lo * 0.97 && l.price < hi * 1.03) { hi = Math.max(hi, l.price); lo = Math.min(lo, l.price); }
    const pad = (hi - lo) * 0.08 || hi * 0.001;
    hi += pad; lo -= pad;
    const top = 10, bottom = plotH - volH - 6;
    const y = (p) => top + (hi - p) / (hi - lo) * (bottom - top);
    const step = plotW / this.visible;
    const xAt = (i) => plotW - (data.length - i - 0.5) * step;
    const bw = Math.max(1, step * 0.66);

    // grid + price axis
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const ticks = 7;
    const rough = (hi - lo) / ticks;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const unit = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((u) => u >= rough) || rough;
    for (let p = Math.ceil(lo / unit) * unit; p <= hi; p += unit) {
      const yy = Math.round(y(p)) + 0.5;
      ctx.strokeStyle = this.colors.grid; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillStyle = this.colors.text; ctx.fillText(this.fmt(p), plotW + 8, yy);
    }

    // time axis
    ctx.textBaseline = 'alphabetic';
    const every = Math.max(1, Math.ceil(80 / step));
    data.forEach((c, i) => {
      if ((start + i) % every) return;
      const xx = Math.round(xAt(i)) + 0.5;
      ctx.strokeStyle = this.colors.grid; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, plotH); ctx.stroke();
      const d = new Date(c.t);
      const label = d.getHours() === 0 && d.getMinutes() === 0 ? String(d.getDate()) : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      ctx.fillStyle = this.colors.text; ctx.fillText(label, xx - 14, h - 7);
    });

    // volume + candles
    data.forEach((c, i) => {
      const xx = xAt(i);
      const vh = vmax ? (c.v / vmax) * volH : 0;
      ctx.fillStyle = this.colors.vol;
      ctx.fillRect(xx - bw / 2, plotH - vh, bw, vh);
      const upC = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = upC ? this.colors.up : this.colors.down;
      ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, y(c.h)); ctx.lineTo(Math.round(xx) + 0.5, y(c.l)); ctx.stroke();
      const y1 = y(Math.max(c.o, c.c)), y2 = y(Math.min(c.o, c.c));
      ctx.fillRect(xx - bw / 2, y1, bw, Math.max(1, y2 - y1));
    });

    // custom lines (entry / TP / SL / liquidation)
    for (const l of this.lines) {
      if (l.price > hi || l.price < lo) continue;
      const yy = Math.round(y(l.price)) + 0.5;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = l.color; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      const tw = ctx.measureText(l.label).width + 10;
      ctx.fillStyle = l.color; ctx.fillRect(6, yy - 9, tw, 18);
      ctx.fillStyle = '#04110e'; ctx.textBaseline = 'middle'; ctx.fillText(l.label, 11, yy);
      ctx.font = '11px ui-monospace, Menlo, monospace';
    }

    // last price tag
    const last = this.candles[this.candles.length - 1];
    if (last && this.offset === 0) {
      const yy = Math.round(y(last.c)) + 0.5;
      const col = last.c >= last.o ? this.colors.up : this.colors.down;
      ctx.setLineDash([2, 3]); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.fillRect(plotW + 2, yy - 10, axisW - 4, 20);
      ctx.fillStyle = '#04110e'; ctx.textBaseline = 'middle'; ctx.fillText(this.fmt(last.c), plotW + 8, yy);
    }

    // crosshair + OHLC readout
    const m = this.mouse;
    if (m && m.x < plotW && m.y < plotH) {
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(data.length - 0.5 - (plotW - m.x) / step)));
      const c = data[idx];
      const xx = Math.round(xAt(idx)) + 0.5;
      ctx.strokeStyle = this.colors.cross; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, plotH); ctx.moveTo(0, m.y + 0.5); ctx.lineTo(plotW, m.y + 0.5); ctx.stroke(); ctx.setLineDash([]);
      const p = hi - (m.y - top) / (bottom - top) * (hi - lo);
      if (m.y < bottom + 4) {
        ctx.fillStyle = '#2a3f3a'; ctx.fillRect(plotW + 2, m.y - 10, axisW - 4, 20);
        ctx.fillStyle = '#e8f3ef'; ctx.textBaseline = 'middle'; ctx.fillText(this.fmt(p), plotW + 8, m.y);
      }
      if (c) {
        const col = c.c >= c.o ? this.colors.up : this.colors.down;
        const d = new Date(c.t);
        const parts = [['', d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })], ['O', this.fmt(c.o)], ['H', this.fmt(c.h)], ['L', this.fmt(c.l)], ['C', this.fmt(c.c)]];
        let x = 10;
        ctx.textBaseline = 'top';
        for (const [k, v] of parts) {
          if (k) { ctx.fillStyle = this.colors.text; ctx.fillText(k, x, 8); x += ctx.measureText(k).width + 4; }
          ctx.fillStyle = k ? col : '#c6d8d2'; ctx.fillText(v, x, 8); x += ctx.measureText(v).width + 12;
        }
      }
    }
  }
}

// Aggregate 1-minute candles into larger buckets.
function aggregateCandles(candles, minutes) {
  if (minutes <= 1) return candles.map((c) => ({ ...c }));
  const size = minutes * 60_000, out = [];
  for (const c of candles) {
    const t = Math.floor(c.t / size) * size;
    const last = out[out.length - 1];
    if (last && last.t === t) { last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v; }
    else out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
  }
  return out;
}

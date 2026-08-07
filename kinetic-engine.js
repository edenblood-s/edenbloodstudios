// Kinetic Typography engine — vanilla JS, no dependencies.
// Usage:
//   <div id="stage"></div>
//   <script src="kinetic-engine.js"></script>
//   <script>
//     const engine = new KineticA(document.getElementById("stage"), {
//       text: "Hola", paper: "#0e0e10", ink: "#ffffff", accent: "#3b82f6",
//       tiles: 34, offset: 26, speed: 0.02, spread: 0.025,
//       chroma: 0.35, shade: 0.35, grain: 0.7,
//     });
//     engine.start();
//   </script>

(function (global) {
  "use strict";

  const ASPECT = 16 / 9;

  function parseHex(hex) {
    let h = hex.replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const rgb = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

  class KineticA {
    constructor(stage, params) {
      this.stage = stage;
      this.p = params;
      this.frame = 0;
      this.raf = 0;
      this.running = false;
      this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.tintScratch = null;
      this.tctx = null;
      this.grainCanvas = null;
      this.dpr = 1;

      this.canvas = document.createElement("canvas");
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.canvas.style.display = "block";
      stage.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");

      this.mask = document.createElement("canvas");
      this.mctx = this.mask.getContext("2d", { willReadFrequently: true });
      this.warp = document.createElement("canvas");
      this.wctx = this.warp.getContext("2d");

      this.applyColors();
      this.resize();

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(stage);
    }

    setParams(params) {
      const textChanged = params.text !== this.p.text;
      const colorsChanged =
        params.paper !== this.p.paper ||
        params.ink !== this.p.ink ||
        params.accent !== this.p.accent;
      const grainChanged = params.grain !== this.p.grain;
      this.p = params;
      if (colorsChanged) this.applyColors();
      if (textChanged) this.drawLetter();
      if (grainChanged) this.buildGrain();
      if (!this.running) this.renderStatic();
    }

    applyColors() {
      this.paperRGB = parseHex(this.p.paper);
      this.inkRGB = parseHex(this.p.ink);
      this.accentRGB = parseHex(this.p.accent);
      this.accentInv = [
        255 - this.accentRGB[0],
        255 - this.accentRGB[1],
        255 - this.accentRGB[2],
      ];
    }

    resize() {
      const rect = this.stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = rect.width;
      this.h = rect.height;

      const pw = Math.round(this.w * this.dpr);
      const ph = Math.round(this.h * this.dpr);
      for (const c of [this.canvas, this.mask, this.warp]) {
        c.width = pw;
        c.height = ph;
      }

      this.buildGrain();
      this.drawLetter();
      if (!this.running) this.renderStatic();
    }

    drawLetter() {
      const { mctx, mask } = this;
      const W = mask.width;
      const H = mask.height;
      mctx.clearRect(0, 0, W, H);

      const text = (this.p.text || "A").slice(0, 12);
      const single = text.length === 1;
      let size = Math.round(H * (single ? 0.86 : 0.6));
      mctx.fillStyle = "#fff";
      mctx.textAlign = "center";
      mctx.textBaseline = "middle";
      const setFont = (s) => (mctx.font = `800 ${s}px system-ui, sans-serif`);
      setFont(size);
      if (!single) {
        const maxW = W * 0.9;
        let guard = 0;
        while (mctx.measureText(text).width > maxW && size > 12 && guard++ < 40) {
          size -= 4;
          setFont(size);
        }
      }
      mctx.fillText(text, W / 2, H * 0.54);
      this.measureBox();
    }

    measureBox() {
      const { mctx, mask } = this;
      const W = mask.width;
      const H = mask.height;
      try {
        const data = mctx.getImageData(0, 0, W, H).data;
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (let y = 0; y < H; y += 2) {
          for (let x = 0; x < W; x += 2) {
            if (data[(y * W + x) * 4 + 3] > 20) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < x0) { x0 = 0; y0 = 0; x1 = W; y1 = H; }
        this.box = { x0, y0, x1, y1 };
      } catch {
        this.box = { x0: 0, y0: 0, x1: W, y1: H };
      }
    }

    buildGrain() {
      if (this.p.grain <= 0) { this.grainCanvas = null; return; }
      const W = this.mask.width;
      const H = this.mask.height;
      if (!W || !H) return;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d");
      const img = g.createImageData(W, H);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const v = 128 + (n - 0.5) * 255;
        d[i] = d[i + 1] = d[i + 2] = clamp255(v);
        d[i + 3] = 12;
      }
      g.putImageData(img, 0, 0);
      g.globalAlpha = 0.06;
      g.fillStyle = "#000";
      const step = Math.max(2, Math.round(3 * this.dpr));
      for (let y = 0; y < H; y += step) g.fillRect(0, y, W, Math.max(1, Math.round(this.dpr)));
      this.grainCanvas = c;
    }

    renderFrame() {
      const { ctx, wctx, mask } = this;
      const W = mask.width;
      const H = mask.height;
      const p = this.p;
      const off = p.offset * this.dpr;

      wctx.globalCompositeOperation = "source-over";
      wctx.globalAlpha = 1;
      wctx.clearRect(0, 0, W, H);

      const TILES_X = Math.max(2, Math.round(p.tiles));
      const TILES_Y = Math.max(2, Math.round(p.tiles / ASPECT));
      const tileW = Math.floor(W / TILES_X);
      const tileH = Math.floor(H / TILES_Y);
      if (tileW > 0 && tileH > 0) {
        const cx0 = Math.max(0, Math.floor(this.box.x0 / tileW) - 1);
        const cy0 = Math.max(0, Math.floor(this.box.y0 / tileH) - 1);
        const cx1 = Math.min(TILES_X - 1, Math.ceil(this.box.x1 / tileW) + 1);
        const cy1 = Math.min(TILES_Y - 1, Math.ceil(this.box.y1 / tileH) + 1);
        const t = this.frame * p.speed;

        for (let y = cy0; y <= cy1; y++) {
          for (let x = cx0; x <= cx1; x++) {
            const phase = x * y;
            const wave1 = Math.sin(t + phase * p.spread);
            const wave2 = Math.sin(t * 0.7 + (x + y) * p.spread * 1.9 + 1.3);
            const mix = wave1 * 0.65 + wave2 * 0.45;
            const waveX = Math.round(mix * off);
            const waveY = Math.round(Math.sin(t * 0.9 + phase * p.spread * 0.6) * off * 0.7);

            const sx = x * tileW + waveX;
            const sy = y * tileH + waveY;
            const dx = x * tileW;
            const dy = y * tileH;
            const dw = x === TILES_X - 1 ? W - dx : tileW;
            const dh = y === TILES_Y - 1 ? H - dy : tileH;
            if (dw <= 0 || dh <= 0) continue;
            if (sx + dw <= 0 || sy + dh <= 0 || sx >= W || sy >= H) continue;

            wctx.globalAlpha = p.shade > 0
              ? 1 - p.shade * 0.5 + Math.min(1, Math.abs(mix)) * p.shade * 0.5
              : 1;
            wctx.drawImage(mask, sx, sy, dw, dh, dx, dy, dw, dh);
          }
        }
        wctx.globalAlpha = 1;
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgb(this.paperRGB);
      ctx.fillRect(0, 0, W, H);

      if (p.chroma > 0) {
        const shiftPx = Math.round(p.chroma * 5 * this.dpr) + 1;
        this.compositeTinted(this.accentRGB, shiftPx, 0.7 * p.chroma);
        this.compositeTinted(this.accentInv, -shiftPx, 0.6 * p.chroma);
      }
      this.compositeTinted(this.inkRGB, 0, 1);

      if (this.grainCanvas && p.grain > 0) {
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = p.grain;
        ctx.drawImage(this.grainCanvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    }

    compositeTinted(col, dxPx, alpha) {
      const W = this.warp.width;
      const H = this.warp.height;
      if (!this.tintScratch) {
        this.tintScratch = document.createElement("canvas");
        this.tctx = this.tintScratch.getContext("2d");
      }
      if (this.tintScratch.width !== W || this.tintScratch.height !== H) {
        this.tintScratch.width = W;
        this.tintScratch.height = H;
      }
      const s = this.tctx;
      s.globalCompositeOperation = "source-over";
      s.globalAlpha = 1;
      s.clearRect(0, 0, W, H);
      s.drawImage(this.warp, 0, 0);
      s.globalCompositeOperation = "source-in";
      s.fillStyle = rgb(col);
      s.fillRect(0, 0, W, H);
      s.globalCompositeOperation = "source-over";

      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(this.tintScratch, dxPx, 0);
      this.ctx.globalAlpha = 1;
    }

    renderStatic() {
      this.frame = 0;
      this.renderFrame();
    }

    tick = () => {
      if (!this.running) return;
      this.frame++;
      this.renderFrame();
      this.raf = requestAnimationFrame(this.tick);
    };

    start() {
      if (this.running) return;
      this.running = true;
      this.raf = requestAnimationFrame(this.tick);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    refreshLetter() {
      this.drawLetter();
      if (!this.running) this.renderStatic();
    }

    destroy() {
      this.stop();
      this._ro.disconnect();
      this.canvas.remove();
    }
  }

  global.KineticA = KineticA;
})(window);

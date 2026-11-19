// Shared 3D build viewer: real Minecraft block models and textures, drawn with deepslate (MIT).
// Upgraded with micro-ui inspired smooth Y-layer explode, floor-by-floor slice, camera presets, and DualView synced orbit.
(function () {
  const { BlockDefinition, BlockModel, Identifier, Structure, StructureRenderer, TextureAtlas, upperPowerOfTwo } = deepslate;
  const { mat4 } = glMatrix;
  const base = document.currentScript.src.replace(/viewer\.js.*$/, "");
  let resP = null;

  function resources() {
    if (resP) return resP;
    const j = (f) => fetch(base + "assets/" + f).then((r) => r.json());
    resP = Promise.all([
      j("block_definition.json"), j("model.json"), j("atlas.json"),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = base + "assets/atlas.png"; }),
    ]).then(([states, models, uv, atlas]) => {
      const defs = {}, mods = {};
      for (const id in states) defs["minecraft:" + id] = BlockDefinition.fromJson(states[id]);
      for (const id in models) mods["minecraft:" + id] = BlockModel.fromJson(models[id]);
      Object.values(mods).forEach((m) => m.flatten({ getBlockModel: (id) => mods[id] }));
      const c = document.createElement("canvas");
      const size = upperPowerOfTwo(Math.max(atlas.width, atlas.height));
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.drawImage(atlas, 0, 0);
      const idMap = {};
      for (const id in uv) {
        const [u, v, du, dv] = uv[id];
        const dv2 = du !== dv && id.startsWith("block/") ? du : dv;
        idMap[Identifier.create(id).toString()] = [u / size, v / size, (u + du) / size, (v + dv2) / size];
      }
      const ta = new TextureAtlas(ctx.getImageData(0, 0, size, size), idMap);
      const solid = /^(.*stone|.*_block|.*planks|.*_ore|.*bricks|.*concrete|.*terracotta|.*wool|redstone_lamp|target|deepslate|andesite|granite|diorite|obsidian|dirt|netherrack)$/;
      return {
        getBlockDefinition: (id) => defs[id.toString()],
        getBlockModel: (id) => mods[id.toString()],
        getTextureUV: (id) => ta.getTextureUV(id),
        getTextureAtlas: () => ta.getTextureAtlas(),
        getPixelSize: () => ta.getPixelSize(),
        getBlockFlags: (id) => ({ opaque: solid.test(id.path) && !/glass|slime|honey|note_block/.test(id.path) }),
        getBlockProperties: () => null,
        getDefaultBlockProperties: () => null,
      };
    });
    return resP;
  }

  function parse(state) {
    const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(state);
    const props = {};
    if (m[2]) m[2].split(",").forEach((kv) => { const [k, v] = kv.split("="); props[k] = v; });
    return [m[1], props];
  }

  function normalize(blocks) {
    return Array.isArray(blocks) ? blocks : Object.entries(blocks).map(([k, state]) => ({ pos: k.split(",").map(Number), state }));
  }

  function build(blocks, bounds) {
    const list = normalize(blocks);
    const lo = bounds ? [...bounds[0]] : [Infinity, Infinity, Infinity], hi = bounds ? [...bounds[1]] : [-Infinity, -Infinity, -Infinity];
    list.forEach((b) => b.pos.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }));
    const size = hi.map((v, i) => v - lo[i] + 1);
    const s = new Structure(size);
    list.forEach((b) => { const [id, props] = parse(b.state); try { s.addBlock(b.pos.map((v, i) => v - lo[i]), id, props); } catch (e) {} });
    return { s, size, lo, list };
  }

  function buildLayerStructures(list, size, lo) {
    const H = size[1];
    const structs = Array.from({ length: H }, () => new Structure([size[0], 1, size[2]]));
    const counts = new Uint16Array(H);
    for (const b of list) {
      const ly = b.pos[1] - lo[1];
      if (ly < 0 || ly >= H) continue;
      const [id, props] = parse(b.state);
      try { structs[ly].addBlock([b.pos[0] - lo[0], 0, b.pos[2] - lo[2]], id, props); counts[ly]++; } catch (e) {}
    }
    return { structs, counts };
  }

  function viewer(canvas, blocks, opts = {}) {
    let dead = false, renderer = null, resCache = null, size = [1, 1, 1], raf = 0, signal = null, signalOn = !!opts.signal;
    let shown = blocks, shownList = [], origin = [0, 0, 0];
    let yaw = opts.yaw ?? 0.65, pitch = opts.pitch ?? 0.5, zoom = opts.zoom ?? 1, spin = !!opts.spin;
    let targetExplode = opts.explode ?? 0, curExplode = targetExplode, sliceMax = opts.sliceMax ?? null;
    let layerRenderers = [], layerCounts = [], layersDirty = true;
    let camTarget = null, lastAnim = 0;
    const onCam = opts.onCam || null;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true });

    function fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        if (renderer) renderer.setViewport(0, 0, w, h);
        for (const lr of layerRenderers) if (lr) lr.setViewport(0, 0, w, h);
      }
    }

    function ensureLayers() {
      if (!layersDirty || !resCache) return;
      layersDirty = false;
      const { structs, counts } = buildLayerStructures(shownList, size, origin);
      layerCounts = counts;
      for (let ly = 0; ly < structs.length; ly++) {
        if (!counts[ly]) continue;
        if (layerRenderers[ly]) {
          layerRenderers[ly].setStructure(structs[ly]);
        } else {
          layerRenderers[ly] = new StructureRenderer(gl, structs[ly], resCache, { useInvisibleBlockBuffer: false });
          layerRenderers[ly].setViewport(0, 0, canvas.width, canvas.height);
        }
      }
    }

    function draw(now = performance.now()) {
      raf = 0;
      if (dead || !renderer) return;
      fit();
      const dt = Math.min(80, now - (lastAnim || now)); lastAnim = now;
      const ease = 1 - Math.exp(-dt / 85);
      let keepGoing = false;

      if (Math.abs(targetExplode - curExplode) > 0.002) {
        curExplode += (targetExplode - curExplode) * ease;
        keepGoing = true;
      } else {
        curExplode = targetExplode;
      }

      if (camTarget) {
        let rem = 0;
        for (const [k, curV, setV] of [
          ["yaw", yaw, (v) => (yaw = v)],
          ["pitch", pitch, (v) => (pitch = v)],
          ["zoom", zoom, (v) => (zoom = v)],
        ]) {
          if (camTarget[k] != null) {
            const diff = camTarget[k] - curV;
            if (Math.abs(diff) > 0.003) { setV(curV + diff * ease); rem++; }
            else setV(camTarget[k]);
          }
        }
        if (rem) keepGoing = true; else camTarget = null;
        if (onCam) onCam({ yaw, pitch, zoom });
      }

      const H = size[1];
      const effH = H + (H - 1) * curExplode * 1.15;
      const r = Math.hypot(size[0], effH, size[2]) / 2;
      const aspect = canvas.width / Math.max(1, canvas.height);
      const dist = (r / Math.tan((70 * Math.PI) / 360)) * 1.0 * Math.max(1, 1 / aspect) * zoom + 0.8;
      const view = mat4.create();
      mat4.translate(view, view, [0, 0, -dist]);
      mat4.rotate(view, view, pitch, [1, 0, 0]);
      mat4.rotate(view, view, yaw, [0, 1, 0]);
      mat4.translate(view, view, [-size[0] / 2, -size[1] / 2, -size[2] / 2]);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const useLayers = curExplode > 0.001 || (sliceMax != null && sliceMax < H);
      if (!useLayers) {
        renderer.drawStructure(view);
      } else {
        ensureLayers();
        const maxLy = sliceMax != null ? Math.min(H, sliceMax) : H;
        const midY = (H - 1) / 2;
        const lv = mat4.create();
        for (let ly = 0; ly < maxLy; ly++) {
          if (!layerCounts[ly] || !layerRenderers[ly]) continue;
          const yOff = ly + (ly - midY) * curExplode * 1.15;
          mat4.translate(lv, view, [0, yOff, 0]);
          layerRenderers[ly].drawStructure(lv);
        }
      }

      if (signalOn) {
        signal ??= RSBSignal.create(gl);
        if (signal.fresh !== shown) { signal.update(shown, origin); signal.fresh = shown; }
        const proj = mat4.create();
        mat4.perspective(proj, (70 * Math.PI) / 180, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 500);
        if (signal.draw(view, proj, now, { explode: curExplode, sliceMax, height: H })) keepGoing = true;
        else signal.rest();
      }
      canvas.dataset.ready = "1";
      if (spin) { yaw += 0.004; keepGoing = true; }
      if (keepGoing) ask(); else lastAnim = 0;
    }
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };

    let bounds = opts.bounds || null;
    function set(next, nb) {
      if (nb !== undefined) bounds = nb;
      return resources().then((res) => {
        if (dead) return;
        resCache = res;
        const b = build(next, bounds);
        size = b.size; origin = b.lo; shown = next; shownList = b.list; layersDirty = true;
        if (renderer) renderer.setStructure(b.s);
        else { fit(); renderer = new StructureRenderer(gl, b.s, res, { useInvisibleBlockBuffer: false }); renderer.setViewport(0, 0, canvas.width, canvas.height); }
        ask();
      });
    }

    let drag = null;
    const stopSpin = () => { spin = false; camTarget = null; };
    canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); stopSpin(); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      yaw += (e.clientX - drag[0]) / 120;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) / 120));
      drag = [e.clientX, e.clientY];
      if (onCam) onCam({ yaw, pitch, zoom });
      ask();
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !opts.wheel) return;
      e.preventDefault();
      camTarget = null;
      zoom = Math.max(0.4, Math.min(3, zoom * (1 + e.deltaY / 500)));
      if (onCam) onCam({ yaw, pitch, zoom });
      ask();
    }, { passive: false });
    const ro = new ResizeObserver(ask); ro.observe(canvas);
    canvas.style.touchAction = "pan-y"; canvas.style.cursor = "grab";
    const ready = set(blocks);

    const cam = (o) => {
      camTarget = null;
      if (o.yaw != null) yaw = o.yaw;
      if (o.pitch != null) pitch = o.pitch;
      if (o.zoom != null) zoom = o.zoom;
      spin = false;
      ask();
    };
    const camTo = (o) => { camTarget = o; spin = false; ask(); };
    const getCam = () => ({ yaw, pitch, zoom });
    const explode = (v) => { targetExplode = Math.max(0, Math.min(1, +v || 0)); ask(); };
    const slice = (v) => { sliceMax = v == null ? null : Math.max(1, Math.round(v)); ask(); };
    const height = () => size[1];

    return {
      set, cam, camTo, getCam, ready, redraw: ask, explode, slice, height,
      signal(on) { signalOn = on; if (signal) signal.rest(); ask(); },
      destroy() { dead = true; ro.disconnect(); cancelAnimationFrame(raf); },
    };
  }

  window.RSB = { viewer, resources };
})();

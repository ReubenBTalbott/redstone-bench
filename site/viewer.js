// Shared 3D build viewer: real Minecraft block models and textures, drawn with deepslate (MIT).
// window.RSB.viewer(canvas, blocks, opts) -> { set(blocks), destroy() }
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

  // blocks: [{pos, state}] or {"x,y,z": state}. bounds [[lo],[hi]] keeps the camera still while blocks move.
  function build(blocks, bounds) {
    if (!Array.isArray(blocks)) blocks = Object.entries(blocks).map(([k, state]) => ({ pos: k.split(",").map(Number), state }));
    const lo = bounds ? [...bounds[0]] : [Infinity, Infinity, Infinity], hi = bounds ? [...bounds[1]] : [-Infinity, -Infinity, -Infinity];
    blocks.forEach((b) => b.pos.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }));
    const size = hi.map((v, i) => v - lo[i] + 1);
    const s = new Structure(size);
    blocks.forEach((b) => { const [id, props] = parse(b.state); try { s.addBlock(b.pos.map((v, i) => v - lo[i]), id, props); } catch (e) {} });
    return { s, size };
  }

  function viewer(canvas, blocks, opts = {}) {
    let dead = false, renderer = null, size = [1, 1, 1], raf = 0;
    let yaw = opts.yaw ?? 0.65, pitch = opts.pitch ?? 0.5, zoom = opts.zoom ?? 1, spin = !!opts.spin;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true });

    function fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; renderer && renderer.setViewport(0, 0, w, h); }
    }
    function draw() {
      raf = 0;
      if (dead || !renderer) return;
      fit();
      const r = Math.hypot(size[0], size[1], size[2]) / 2;
      const aspect = canvas.width / canvas.height;
      const dist = (r / Math.tan((70 * Math.PI) / 360)) * 1.0 * Math.max(1, 1 / aspect) * zoom + 0.8;
      const view = mat4.create();
      mat4.translate(view, view, [0, 0, -dist]);
      mat4.rotate(view, view, pitch, [1, 0, 0]);
      mat4.rotate(view, view, yaw, [0, 1, 0]);
      mat4.translate(view, view, [-size[0] / 2, -size[1] / 2, -size[2] / 2]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      renderer.drawStructure(view);
      canvas.dataset.ready = "1";
      if (spin) { yaw += 0.004; ask(); }
    }
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };

    let bounds = opts.bounds || null;
    function set(next, nb) {
      if (nb !== undefined) bounds = nb;
      return resources().then((res) => {
        if (dead) return;
        const b = build(next, bounds);
        size = b.size;
        if (renderer) renderer.setStructure(b.s); else { fit(); renderer = new StructureRenderer(gl, b.s, res, { useInvisibleBlockBuffer: false }); renderer.setViewport(0, 0, canvas.width, canvas.height); }
        ask();
      });
    }

    let drag = null;
    const stopSpin = () => { spin = false; };
    canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); stopSpin(); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      yaw += (e.clientX - drag[0]) / 120; pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - drag[1]) / 120));
      drag = [e.clientX, e.clientY]; ask();
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("wheel", (e) => { if (!e.ctrlKey && !opts.wheel) return; e.preventDefault(); zoom = Math.max(0.4, Math.min(3, zoom * (1 + e.deltaY / 500))); ask(); }, { passive: false });
    const ro = new ResizeObserver(ask); ro.observe(canvas);
    canvas.style.touchAction = "pan-y"; canvas.style.cursor = "grab";
    const ready = set(blocks);
    const cam = (o) => { if (o.yaw != null) yaw = o.yaw; if (o.pitch != null) pitch = o.pitch; if (o.zoom != null) zoom = o.zoom; spin = false; ask(); };
    return { set, cam, ready, redraw: ask, destroy() { dead = true; ro.disconnect(); cancelAnimationFrame(raf); } };
  }

  window.RSB = { viewer, resources };
})();

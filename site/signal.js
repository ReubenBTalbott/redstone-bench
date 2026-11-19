// Signal view for the build viewer: dims the blocks and draws every redstone part through them, lit by its real state at this tick.
window.RSBSignal = (() => {
  const FLAT = { x: 0.34, y: 0.07, z: 0.34, cy: 0.07 }, LOW = { x: 0.42, y: 0.1, z: 0.42, cy: 0.1 }, POST = { x: 0.1, y: 0.32, z: 0.1, cy: 0.32 }, FULL = { x: 0.43, y: 0.43, z: 0.43, cy: 0.5 };
  const SMALL = { x: 0.16, y: 0.16, z: 0.16, cy: 0.5 };
  const POWERED = /(^|_)(button|pressure_plate)$|^(lever|observer|repeater|comparator|note_block|powered_rail|activator_rail|detector_rail|tripwire_hook|lightning_rod|copper_bulb|.*_copper_bulb)$/;
  const shapeOf = (id) => id === 'redstone_wire' ? FLAT : /repeater|comparator/.test(id) ? LOW : /torch/.test(id) ? POST : /lever|button|pressure_plate|tripwire_hook/.test(id) ? SMALL : FULL;
  function reading(state) {
    const m = /^(?:minecraft:)?([^\[]+)(?:\[(.*)\])?$/.exec(state), id = m[1], p = {};
    (m[2] || '').split(',').forEach((kv) => { const [k, v] = kv.split('='); p[k] = v; });
    let level = null, tone = 0;
    if (id === 'redstone_wire' || id === 'target' || /daylight_detector|weighted_pressure_plate/.test(id)) level = (+p.power || 0) / 15;
    else if (id === 'redstone_block') level = 1;
    else if (/redstone(_wall)?_torch/.test(id)) level = p.lit === 'false' ? 0 : 1;
    else if (id === 'redstone_lamp') { level = p.lit === 'true' ? 1 : 0; tone = 1; }
    else if (/copper_bulb/.test(id)) { level = p.lit === 'true' ? 1 : p.powered === 'true' ? 0.5 : 0; tone = 1; }
    else if (/^(sticky_)?piston$/.test(id)) { level = p.extended === 'true' ? 1 : 0; tone = 2; }
    else if (id === 'piston_head' || id === 'moving_piston') { level = 1; tone = 2; }
    else if (id === 'dispenser' || id === 'dropper') { level = p.triggered === 'true' ? 1 : 0; tone = 2; }
    else if (id === 'hopper') { level = p.enabled === 'false' ? 1 : 0; tone = 2; }
    else if (POWERED.test(id)) level = p.powered === 'true' ? 1 : 0;
    return level === null ? null : { level, tone, shape: shapeOf(id) };
  }
  const CORNERS = [[0, 1, 2, 3, [1, 0, 0]], [5, 4, 7, 6, [-1, 0, 0]], [4, 0, 6, 2, [0, 1, 0]], [3, 1, 7, 5, [0, -1, 0]], [4, 5, 0, 1, [0, 0, 1]], [2, 3, 6, 7, [0, 0, -1]]];
  const VERT = `attribute vec3 pos; attribute vec2 uv; attribute vec2 glow; uniform mat4 proj, view; varying vec2 vUv; varying vec2 vGlow;
    void main() { vUv = uv; vGlow = glow; gl_Position = proj * view * vec4(pos, 1.); }`;
  const FRAG = `precision mediump float; varying vec2 vUv; varying vec2 vGlow;
    void main() {
      vec2 d = abs(vUv - .5) * 2.; float edge = smoothstep(.72, 1., max(d.x, d.y)), e = vGlow.x;
      vec3 cold = vGlow.y < .5 ? vec3(.36, .08, .07) : vGlow.y < 1.5 ? vec3(.35, .25, .08) : vec3(.2, .27, .33);
      vec3 hot = vGlow.y < .5 ? vec3(1., .2, .11) : vec3(1., .74, .22); if (vGlow.y > 1.5) hot = vec3(.48, .82, .96);
      vec3 c = mix(cold, hot, smoothstep(0., .55, e)) + vec3(.2, .12, .08) * e * e * edge;
      gl_FragColor = vec4(c, mix(.24 + edge * .34, .5 + edge * .45, e));
    }`;
  function create(gl) {
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const prog = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); return p; };
    const parts = prog(VERT, FRAG), dim = prog('attribute vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }', 'precision mediump float; void main() { gl_FragColor = vec4(.055, .07, .09, .8); }');
    const quad = gl.createBuffer(), buffer = gl.createBuffer(), a = { pos: gl.getAttribLocation(parts, 'pos'), uv: gl.getAttribLocation(parts, 'uv'), glow: gl.getAttribLocation(parts, 'glow'), p: gl.getAttribLocation(dim, 'p') };
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    let live = new Map(), last = 0;
    return {
      update(blocks, lo) {
        const next = new Map(), list = Array.isArray(blocks) ? blocks.map((b) => [b.pos, b.state]) : Object.entries(blocks).map(([k, st]) => [k.split(',').map(Number), st]);
        for (const [pos, state] of list) {
          const r = reading(state);
          if (!r) continue;
          const key = pos.join(','), old = live.get(key);
          next.set(key, { ...r, at: pos.map((v, i) => v - lo[i]), glow: old ? old.glow : r.level });
        }
        live = next;
      },
      /** Draws one frame; true while something is still easing to its new level. */
      draw(view, proj, now, lay) {
        const dt = Math.min(80, now - (last || now)); last = now;
        const ease = 1 - Math.exp(-dt / 55), v = []; let moving = false;
        const exp = lay && lay.explode ? lay.explode : 0;
        const smax = lay && lay.sliceMax != null ? lay.sliceMax : Infinity;
        const midY = lay && lay.height ? (lay.height - 1) / 2 : 0;
        for (const c of live.values()) {
          c.glow += (c.level - c.glow) * ease;
          if (Math.abs(c.level - c.glow) > 0.01) moving = true; else c.glow = c.level;
          if (c.at[1] >= smax) continue;
          const yShift = exp ? (c.at[1] - midY) * exp * 1.15 : 0;
          const s = c.shape, o = [c.at[0] + 0.5, c.at[1] + yShift + s.cy, c.at[2] + 0.5];
          const corner = (i) => [o[0] + (i & 4 ? -s.x : s.x), o[1] + (i & 2 ? -s.y : s.y), o[2] + (i & 1 ? -s.z : s.z)];
          for (const [p, q, r, t] of CORNERS) for (const [i, u, w] of [[p, 0, 0], [q, 1, 0], [r, 0, 1], [r, 0, 1], [q, 1, 0], [t, 1, 1]]) v.push(...corner(i), u, w, c.glow, c.tone);
        }
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(dim); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(a.p); gl.vertexAttribPointer(a.p, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (v.length) {
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.useProgram(parts); gl.uniformMatrix4fv(gl.getUniformLocation(parts, 'proj'), false, proj); gl.uniformMatrix4fv(gl.getUniformLocation(parts, 'view'), false, view);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
          for (const [loc, n, off] of [[a.pos, 3, 0], [a.uv, 2, 12], [a.glow, 2, 20]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 28, off); }
          gl.drawArrays(gl.TRIANGLES, 0, v.length / 7);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
        return moving;
      },
      rest() { last = 0; },
      count: () => live.size,
    };
  }
  return { create };
})();

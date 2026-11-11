// Redstone Bench launch film. One timeline (frames at 30 fps) cut to the bars of the track (110 BPM, a bar = 65.45 f).
// Every 3D picture is a frame captured from the site's own viewer playing a real, verified build (video/capture.mjs).
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Img, staticFile, useCurrentFrame } from 'remotion';
import lines from '../../public/footage/lines.json';
import shrink from '../../public/footage/shrink.json';

const BAR = (n: number) => Math.round((n - 1) * 65.4545);
export const T = { line: BAR(1), build: BAR(2), run: BAR(4), shrink: BAR(6), wall: BAR(8), board: BAR(10), out: BAR(12), hit: BAR(12) + 45 };
export const END = T.hit + 105;

const INK = '#16222c', SOFT = '#52636f', RED = '#d7261c', GRASS = '#2f8436';
const PIX = 'Pixelify, sans-serif', NUM = 'Jersey, Pixelify, sans-serif', BODY = 'Figtree, sans-serif', MONO = 'Mono, monospace';
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const p = (f: number, a: number, b: number) => clamp((f - a) / (b - a));
const out3 = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const out5 = (t: number) => 1 - Math.pow(1 - clamp(t), 5);
const inOut = (t: number) => { const x = clamp(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const in3 = (t: number) => Math.pow(clamp(t), 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pad = (n: number) => String(Math.max(0, n)).padStart(4, '0');
const foot = (clip: string, f: number) => staticFile(`footage/${clip}/${pad(f)}.png`);

const FONTS: [string, string, string][] = [['Pixelify', 'pixelify.woff2', '700'], ['Jersey', 'jersey25.woff2', '400'], ['Figtree', 'figtree.woff2', '300 900'], ['Mono', 'mono.woff2', '500']];
const useFonts = () => {
  const [h] = useState(() => delayRender('fonts'));
  useEffect(() => {
    Promise.all(FONTS.map(([name, file, weight]) => { const ff = new FontFace(name, `url(${staticFile('fonts/' + file)})`, { weight }); return ff.load().then((x) => document.fonts.add(x)); }))
      .then(() => continueRender(h));
  }, [h]);
};

// A line that arrives whole: soft focus pull and a small settle, never typed.
const Arrive: React.FC<{ f: number; at: number; leave?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ f, at, leave, children, style }) => {
  const a = out3(p(f, at, at + 11)), l = leave == null ? 0 : in3(p(f, leave, leave + 9));
  return <div style={{ ...style, opacity: a * (1 - l), filter: `blur(${(1 - a) * 14 + l * 16}px)`, transform: `translateY(${(1 - a) * 22 - l * 18}px) scale(${mix(1.05, 1, a) + l * 0.06})` }}>{children}</div>;
};

const Promise1: React.FC<{ f: number }> = ({ f }) => {
  const l = in3(p(f, 50, 68));
  if (f > 70) return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${1 + 0.035 * p(f, 0, 60) + l * 0.7})`, filter: `blur(${l * 26}px)`, opacity: 1 - l }}>
      <div style={{ font: `700 168px/1.02 ${PIX}`, color: INK, textAlign: 'center', letterSpacing: -2 }}>
        <Arrive f={f} at={2}>Can AI build</Arrive>
        <Arrive f={f} at={9}><span style={{ color: RED }}>redstone</span>?</Arrive>
      </div>
    </AbsoluteFill>
  );
};

// The model's own block list (the run's real submission), one line a block, in step with the build beside it.
const CodeCard: React.FC<{ f: number }> = ({ f }) => {
  const g = f - T.build;
  const n = Math.round(lines.length * Math.pow(out3(g / 112), 1.15));
  const x = mix(-760, 96, out5(p(f, T.build - 2, T.build + 18))) - 900 * in3(p(f, T.run - 14, T.run + 4));
  const rows = 21, shown = lines.slice(Math.max(0, n - rows), n);
  return (
    <div style={{ position: 'absolute', left: x, top: 150, width: 640, height: 780, borderRadius: 30, background: '#fff', boxShadow: '0 30px 70px #1b4a6a26, 0 2px 0 #fff inset', overflow: 'hidden', filter: `blur(${in3(p(f, T.run - 14, T.run + 4)) * 10}px)` }}>
      <div style={{ padding: '26px 34px 0', font: `700 26px ${BODY}`, color: INK, display: 'flex', justifyContent: 'space-between' }}><span>submission.json</span><span style={{ font: `400 34px/0.8 ${NUM}`, color: SOFT }}>{n} / {lines.length}</span></div>
      <div style={{ position: 'absolute', left: 34, right: 20, bottom: 30, font: `500 19.5px/32px ${MONO}`, color: '#8a98a3', whiteSpace: 'nowrap' }}>
        {shown.map((s, i) => <div key={n - shown.length + i} style={{ color: i === shown.length - 1 ? INK : undefined, overflow: 'hidden', textOverflow: 'clip' }}>{s.length > 50 ? s.slice(0, 49) + '…' : s}</div>)}
      </div>
    </div>
  );
};

const SIDE: React.CSSProperties = { position: 'absolute', left: 60, width: 700, top: 0, height: 1080, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' };

const RunLine: React.FC<{ f: number }> = ({ f }) => (
  <div style={{ ...SIDE, font: `700 112px/1.04 ${PIX}`, color: INK, letterSpacing: -1 }}>
    <Arrive f={f} at={T.run + 2} leave={T.shrink - 12}>Real</Arrive>
    <Arrive f={f} at={T.run + 6} leave={T.shrink - 11}><span style={{ color: GRASS }}>Minecraft</span></Arrive>
    <Arrive f={f} at={T.run + 10} leave={T.shrink - 10}>runs it.</Arrive>
  </div>
);

const Volume: React.FC<{ f: number }> = ({ f }) => {
  const g = f - T.shrink;
  let k = 0; shrink.forEach((s, i) => { if (g >= s.at) k = i; });
  const since = g - shrink[k].at, pop = 1 + 0.1 * (1 - out3(since / 7));
  const a = out3(p(f, T.shrink, T.shrink + 10)), l = in3(p(f, T.wall - 10, T.wall + 2));
  return (
    <div style={{ ...SIDE, opacity: a * (1 - l), filter: `blur(${(1 - a) * 12 + l * 18}px)`, transform: `scale(${1 - l * 0.3})` }}>
      <div style={{ font: `700 54px ${PIX}`, color: INK }}>Then smaller.</div>
      <div style={{ font: `400 330px/0.86 ${NUM}`, color: GRASS, transform: `scale(${pop})`, fontVariantNumeric: 'tabular-nums' }}>{shrink[k].volume}</div>
      <div style={{ font: `600 40px ${BODY}`, color: SOFT, marginTop: 6 }}>blocks of space</div>
    </div>
  );
};

// The build itself: one clip while it assembles and runs, a second on the same stage while it shrinks.
const Stage: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.build - 4 || f > T.wall + 4) return null;
  const inn = out3(p(f, T.build - 4, T.build + 10));
  const cutOut = in3(p(f, T.shrink - 5, T.shrink)), cutIn = 1 - out3(p(f, T.shrink, T.shrink + 6));   // a cut hidden inside a zoom blur
  const leave = in3(p(f, T.wall - 10, T.wall + 3));
  const isShrink = f >= T.shrink;
  const src = isShrink ? foot('shrink', Math.min(130, f - T.shrink)) : foot('door', Math.min(261, Math.max(0, f - T.build)));
  const scale = (isShrink ? 1 - cutIn * 0.16 : 1 + cutOut * 0.2) * (1 - leave * 0.55);
  return <Img src={src} style={{ position: 'absolute', left: 500, top: 0, width: 1500, height: 1080, opacity: inn * (1 - leave), transform: `scale(${scale})`, filter: `blur(${(isShrink ? cutIn : cutOut) * 18 + leave * 14}px)` }} />;
};

const Wall: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.wall - 6 || f > T.board + 10) return null;
  const whip = in3(p(f, T.board - 9, T.board + 3));
  const W = 440, H = 371, gx = 24, x0 = (1920 - 4 * W - 3 * gx) / 2;
  return (
    <AbsoluteFill style={{ transform: `translateX(${-2200 * whip}px)`, filter: `blur(${whip * 22}px)` }}>
      {Array.from({ length: 8 }, (_, k) => {
        const a = out3(p(f, T.wall - 4 + k * 3, T.wall + 9 + k * 3)), row = Math.floor(k / 4), col = k % 4;
        return <Img key={k} src={foot('wall' + k, Math.min(130, Math.max(0, f - T.wall)))} style={{ position: 'absolute', left: x0 + col * (W + gx), top: row ? 652 : 58, width: W, height: H, opacity: a, transform: `scale(${mix(0.72, 1, a)})`, filter: `blur(${(1 - a) * 10}px)` }} />;
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 440, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 118px ${PIX}`, color: INK, letterSpacing: -1 }}>
        <Arrive f={f} at={T.wall + 8}>16 tasks. <span style={{ color: RED }}>384</span> runs.</Arrive>
      </div>
    </AbsoluteFill>
  );
};

const ROWS: [string, string, number][] = [['GPT-6 Astra', 'ultra', 75], ['GPT-6.1 Sol', 'ultra', 75], ['Gemini 4 Carbon', 'high', 68], ['GPT-6.1 Terra', 'max', 55], ['GPT-6 Luna', 'max', 20]];
const Board: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.board - 10 || f > T.hit) return null;
  const enter = out5(p(f, T.board - 8, T.board + 12)), leave = in3(p(f, T.out - 6, T.out + 16));
  return (
    <AbsoluteFill style={{ transform: `translateX(${2200 * (1 - enter)}px) scale(${1 - leave * 0.22})`, filter: `blur(${(1 - enter) * 22 + leave * 20}px)`, opacity: 1 - leave }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 84, textAlign: 'center', font: `700 84px ${PIX}`, color: INK, letterSpacing: -1 }}>Who builds <span style={{ color: GRASS }}>smallest</span>?</div>
      <div style={{ position: 'absolute', left: 250, top: 250, width: 1420, borderRadius: 36, background: '#fff', boxShadow: '0 30px 70px #1b4a6a22', padding: '14px 0' }}>
        {ROWS.map(([name, effort, score], i) => {
          const a = out3(p(f, T.board + 6 + i * 5, T.board + 20 + i * 5)), g = out5(p(f, T.board + 16 + i * 5, T.board + 62 + i * 5));
          return (
            <div key={name} style={{ display: 'grid', gridTemplateColumns: '70px 430px 1fr 150px', alignItems: 'center', height: 132, padding: '0 54px', borderTop: i ? '2px solid #e3ecf2' : 'none', opacity: a, transform: `translateX(${(1 - a) * 60}px)` }}>
              <div style={{ font: `400 52px ${NUM}`, color: SOFT }}>{i + 1}</div>
              <div><div style={{ font: `700 44px/1.1 ${BODY}`, color: INK }}>{name}</div><div style={{ font: `500 27px ${BODY}`, color: SOFT }}>{effort} effort</div></div>
              <div style={{ height: 26, borderRadius: 13, background: '#e3ecf2', overflow: 'hidden' }}><div style={{ width: `${score * g}%`, height: '100%', borderRadius: 13, background: GRASS }} /></div>
              <div style={{ font: `400 92px/1 ${NUM}`, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(score * g)}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// The mark is four blocks: they fly in from the corners and lock on the track's last hit, the name beside them.
const Lockup: React.FC<{ f: number }> = ({ f }) => {
  if (f < T.out + 4) return null;
  const S = 104, land = out5(p(f, T.out + 8, T.hit)), creep = 1 + 0.035 * p(f, T.hit, END) + 0.05 * (1 - out3(p(f, T.hit, T.hit + 9)));
  const name = out3(p(f, T.hit, T.hit + 10)), url = out3(p(f, T.hit + 16, T.hit + 30));
  const cells: [number, number, string, number, number][] = [[0, 0, RED, -1100, -700], [1, 0, INK, 1300, -700], [0, 1, INK, -1100, 800], [1, 1, RED, 1300, 800]];
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${creep})` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 56, marginTop: -30 }}>
        <div style={{ position: 'relative', width: 2 * S, height: 2 * S }}>
          {cells.map(([cx, cy, c, dx, dy], i) => <div key={i} style={{ position: 'absolute', left: cx * S, top: cy * S, width: S, height: S, background: c, transform: `translate(${dx * (1 - land)}px, ${dy * (1 - land)}px) rotate(${(1 - land) * (i % 2 ? 140 : -140)}deg)`, filter: `blur(${(1 - land) * 10}px)` }} />)}
        </div>
        <div style={{ font: `700 150px/1 ${PIX}`, color: INK, letterSpacing: -2, opacity: name, filter: `blur(${(1 - name) * 14}px)`, transform: `translateX(${(1 - name) * 40}px)` }}>Redstone Bench</div>
      </div>
      <div style={{ position: 'absolute', top: 700, left: 0, right: 0, textAlign: 'center', font: `600 44px ${BODY}`, color: SOFT, opacity: url, transform: `translateY(${(1 - url) * 14}px)` }}>redstone-bench.adamholter.chatgpt.site</div>
    </AbsoluteFill>
  );
};

export const Film: React.FC = () => {
  useFonts();
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(#cfe8fb, #eef7fd)' }}>
      <Stage f={f} />
      {f >= T.build - 4 && f < T.run + 6 && <CodeCard f={f} />}
      {f >= T.run && f < T.shrink && <RunLine f={f} />}
      {f >= T.shrink && f < T.wall + 4 && <Volume f={f} />}
      <Wall f={f} />
      <Board f={f} />
      <Lockup f={f} />
      <Promise1 f={f} />
    </AbsoluteFill>
  );
};

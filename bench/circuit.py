"""Circuit tasks: levers in, redstone lamps out. Used by verify.py."""
import re

STABLE = 20  # game ticks an output must hold to count


class Fail(Exception):
    pass


def runs(trace):
    """[0,0,1,1,1,0] -> 'off x2, on x3, off x1'"""
    out, i = [], 0
    while i < len(trace):
        j = i
        while j < len(trace) and trace[j] == trace[i]:
            j += 1
        out.append(f"{'on' if trace[i] else 'off'} x{j - i}")
        i = j
    return ", ".join(out)


class Bench:
    def __init__(self, arena, ins, outs, levers, lo, hi, stats):
        self.arena, self.rc = arena, arena.rc
        self.ins, self.outs, self.levers = ins, outs, levers   # name -> pos, name -> pos, name -> (off, on)
        self.lo, self.hi, self.stats = lo, hi, stats
        self.now = {k: 0 for k in ins}
        self.ticks = 0

    def set(self, name, v):
        self.now[name] = int(bool(v))
        if getattr(self, "on_set", None):
            self.on_set(name, self.now[name])
        self.arena.set_lever(self.ins[name], self.levers[name][self.now[name]])

    def tick(self):
        self.arena.step(1)
        self.ticks += 1
        self.stats["max_entities"] = max(self.stats["max_entities"], self.arena.entity_count())
        if not self.arena.grow_to_fit(self.lo, self.hi):
            raise Fail("something moved outside the build box")

    def lit(self, name):
        return int(self.arena.passed(f"execute if block {self.arena.w(self.outs[name])} minecraft:redstone_lamp[lit=true]"))

    def read(self):
        return {k: self.lit(k) for k in self.outs}

    def matches(self, expect):
        cmd = "execute"
        for k, v in expect.items():
            cmd += f" {'if' if v else 'unless'} block {self.arena.w(self.outs[k])} minecraft:redstone_lamp[lit=true]"
        return self.arena.passed(cmd)

    def settle(self, expect, hold, timeout):
        """Tick until outputs equal `expect` for `hold` ticks in a row. Returns the tick it was reached, or None."""
        reached, held = None, 0
        for t in range(1, timeout + hold + 1):
            self.tick()
            if self.matches(expect):
                if reached is None:
                    reached = t
                held += 1
                if held >= hold:
                    return reached
            else:
                reached, held = None, 0
        return None

    def record(self, name, n):
        out = []
        for _ in range(n):
            self.tick()
            out.append(self.lit(name))
        return out

    def fmt(self, d):
        return ", ".join(f"{k}={v}" for k, v in d.items())


def run_script(b, task):
    timeout, delays = task.get("timeout_ticks", 100), []
    script = task["test"]["script"]
    for i, st in enumerate(script):
        for k, v in st.get("set", {}).items():
            b.set(k, v)
        hold = st.get("hold", STABLE)
        d = b.settle(st["expect"], hold, timeout)
        if d is None:
            raise Fail(f"step {i + 1} of {len(script)} (levers {b.fmt(b.now)}): lamps are {b.fmt(b.read())}, but must become "
                       f"{b.fmt(st['expect'])} and hold for {hold} ticks, within {timeout} ticks")
        if st.get("set"):
            delays.append(d - 1)
    return max(delays or [0])


def run_clock(b, task):
    t, (inp,), (out,) = task["test"], list(b.ins), list(b.outs)
    P, starts = t["period"], []
    if b.settle({out: 0}, 2 * P, 4 * P) is None:
        raise Fail(f"start (lever off): lamp must be off and stay off for {2 * P} ticks")
    for cyc in range(1, t.get("cycles", 2) + 1):
        b.set(inp, 1)
        tr = b.record(out, 2 * P + 6 * P)
        rises = [i + 1 for i in range(len(tr)) if tr[i] and not (tr[i - 1] if i else 0)]
        if not rises or rises[0] > 2 * P:
            raise Fail(f"cycle {cyc}, lever on: lamp did not turn on within {2 * P} ticks. Lamp per tick: {runs(tr)}")
        gaps = [rises[i + 1] - rises[i] for i in range(len(rises) - 1)]
        if len(rises) < 5 or any(g != P for g in gaps):
            raise Fail(f"cycle {cyc}, lever on: the lamp must turn on once every {P} ticks exactly; "
                       f"gaps between turn-ons were {gaps}. Lamp per tick: {runs(tr)}")
        starts.append(rises[0])
        b.set(inp, 0)
        if b.settle({out: 0}, 3 * P, 3 * P) is None:
            raise Fail(f"cycle {cyc}, lever off: lamp must go off within {3 * P} ticks and stay off for {3 * P} ticks")
    return max(starts)


def run_pulse(b, task):
    t, (inp,), (out,) = task["test"], list(b.ins), list(b.outs)
    L, maxd, quiet, starts = t["length"], t.get("max_delay", 40), t.get("quiet", 60), []
    if b.settle({out: 0}, 40, 100) is None:
        raise Fail("start (lever off): lamp must be off and stay off for 40 ticks")
    for cyc in range(1, t.get("cycles", 3) + 1):
        b.set(inp, 1)
        tr = b.record(out, maxd + L + quiet)
        s = "".join(map(str, tr))
        m = re.fullmatch(r"(0*)(1+)(0*)", s)
        if not m or len(m.group(2)) != L or len(m.group(1)) >= maxd:
            raise Fail(f"cycle {cyc}, lever on (and kept on): the lamp must light once within {maxd} ticks, stay lit for exactly "
                       f"{L} ticks, then stay off. Lamp per tick: {runs(tr)}")
        starts.append(len(m.group(1)))
        b.set(inp, 0)
        tr = b.record(out, quiet)
        if any(tr):
            raise Fail(f"cycle {cyc}, lever off: the lamp must stay off for {quiet} ticks. Lamp per tick: {runs(tr)}")
    return max(starts)


RUNNERS = {"script": run_script, "clock": run_clock, "pulse": run_pulse}

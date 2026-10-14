"""Shared pieces of the Cube Arena v2 reference solvers.

Moves are (face, depth, amount): `depth` layers in from `face` (1 is the outer
layer), `amount` quarter turns clockwise as seen from that face. Every move
here turns a single layer, so every move counts 1.

The centre and edge stages are solved with commutators [X, Y] = X Y X' Y'
whose two halves overlap in exactly one piece, so each is a pure 3-cycle.
Batching several parallel slices into X (and Y) runs one 3-cycle per pair of
slices at the cost of a little more than one.
"""

from operator import itemgetter

import cube

FACES = "URFDLB"
FIDX = {f: i for i, f in enumerate(FACES)}
AXIS = {f: cube.FACE_AXIS[f][0] for f in FACES}
POSITIVE = {0: "R", 1: "U", 2: "F"}
OPPOSITE = {"U": "D", "D": "U", "R": "L", "L": "R", "F": "B", "B": "F"}


def inv(moves):
    return [(f, d, 4 - a) for f, d, a in reversed(moves)]


def token(mv):
    f, d, a = mv
    return ("%d" % d if d > 1 else "") + f + {1: "", 2: "2", 3: "'"}[a]


class Geo:
    """Sticker geometry and move tables for one size."""

    def __init__(self, n):
        self.n = n
        self.nn = n * n
        self.size = 6 * n * n
        self._src = {}
        self._dst = {}
        self._ig = {}
        stickers, index, _ = cube._geometry(n)
        self.pos = [p for p, _ in stickers]
        self.normal = [nm for _, nm in stickers]
        by_pos = {}
        for i, p in enumerate(self.pos):
            by_pos.setdefault(p, []).append(i)
        self.partner = [None] * self.size
        for idx in by_pos.values():
            if len(idx) == 2:
                self.partner[idx[0]] = idx[1]
                self.partner[idx[1]] = idx[0]

    # -- moves -------------------------------------------------------------
    def src(self, mv):
        s = self._src.get(mv)
        if s is None:
            f, d, a = mv
            s = self._src[mv] = cube.permutation(self.n, cube.face_turn(self.n, f, d, d, a))
        return s

    def dst(self, mv):
        d = self._dst.get(mv)
        if d is None:
            s = self.src(mv)
            d = [0] * len(s)
            for j, i in enumerate(s):
                d[i] = j
            self._dst[mv] = d
        return d

    def apply(self, state, moves):
        for mv in moves:
            ig = self._ig.get(mv)
            if ig is None:
                ig = self._ig[mv] = itemgetter(*self.src(mv))
            state = ig(state)
        return state

    def track(self, moves, j):
        """Where the sticker now at j is after the moves."""
        for mv in moves:
            j = self.dst(mv)[j]
        return j

    def simplify(self, moves):
        """Merge runs of turns about one axis (they commute) and drop what cancels."""
        n = self.n
        blocks = []  # [axis, {coord: quarter}]
        for f, d, a in moves:
            axis, layers, q = cube.face_turn(n, f, d, d, a)
            coord = layers[0]
            if blocks and blocks[-1][0] == axis:
                b = blocks[-1][1]
                b[coord] = (b.get(coord, 0) + q) % 4
                if not b[coord]:
                    del b[coord]
                if not b:
                    blocks.pop()
            else:
                blocks.append([axis, {coord: q}])
        out = []
        for axis, b in blocks:
            for coord in sorted(b, reverse=True):
                q = b[coord]
                dp = (n - 1 - coord) // 2 + 1
                dn = (n - 1 + coord) // 2 + 1
                if dn < dp:
                    out.append((OPPOSITE[POSITIVE[axis]], dn, q))
                else:
                    out.append((POSITIVE[axis], dp, (q * 3) % 4))
        return out

    # -- cells -------------------------------------------------------------
    def centre_cells(self, face):
        n, base = self.n, FIDX[face] * self.nn
        return [base + r * n + c for r in range(1, n - 1) for c in range(1, n - 1)]

    def face_of(self, j):
        return FACES[j // self.nn]

    def wing_cells(self, face):
        """Edge stickers on a face that are not corners and not midges."""
        n, base = self.n, FIDX[face] * self.nn
        mid = (n - 1) // 2 if n % 2 else None
        out = []
        for k in range(1, n - 1):
            if k == mid:
                continue
            out += [base + k, base + (n - 1) * n + k, base + k * n, base + k * n + n - 1]
        return out


# ---------------------------------------------------------------------------
# Centres


class CentreFamily:
    """[X, Y] with X = slices of one axis at depths A (amount e1) and
    Y = T^g . slices of the same axis at depths B (amount e2) . T^-g.
    Each (a, b) moves the piece at p1 to c (on T), the piece at c to p2,
    and the piece at p2 to p1."""

    __slots__ = ("T", "FA", "e1", "e2", "g", "inverse", "cells", "by_p1", "P", "Q")

    def moves(self, A, B):
        X = [(self.FA, a, self.e1) for a in A]
        Y = [(self.T, 1, self.g)] + [(self.FA, b, self.e2) for b in B] + [(self.T, 1, 4 - self.g)]
        return Y + X + inv(Y) + inv(X) if self.inverse else X + Y + inv(X) + inv(Y)


def centre_families(geo):
    n = geo.n
    fams = []
    for T in FACES:
        tcells = geo.centre_cells(T)
        for A in range(3):
            if A == AXIS[T]:
                continue
            FA = POSITIVE[A]
            for e1 in (1, 2, 3):
                for e2 in (1, 2, 3):
                    for g in (1, 3):
                        fwd = {}
                        for a in range(2, n):
                            X = [(FA, a, e1)]
                            dx = geo.dst(X[0])
                            xs = [j for j in tcells if dx[j] != j]
                            for b in range(2, n):
                                if b == a:
                                    continue
                                Y = [(T, 1, g), (FA, b, e2), (T, 1, 4 - g)]
                                cs = [j for j in xs if geo.track(Y, j) != j]
                                assert len(cs) == 1, (T, A, a, b)
                                c = cs[0]
                                seq = X + Y + inv(X) + inv(Y)
                                f1 = geo.track(seq, c)
                                f2 = geo.track(seq, f1)
                                assert geo.track(seq, f2) == c
                                fwd[(a, b)] = (c, f2, f1)
                        for inverse in (False, True):
                            fam = CentreFamily()
                            fam.T, fam.FA, fam.e1, fam.e2, fam.g, fam.inverse = T, FA, e1, e2, g, inverse
                            fam.cells = {k: ((c, p2, p1) if inverse else (c, p1, p2)) for k, (c, p1, p2) in fwd.items()}
                            fam.by_p1 = {p1: (k, c, p2) for k, (c, p1, p2) in fam.cells.items()}
                            some = next(iter(fam.cells.values()))
                            fam.P, fam.Q = geo.face_of(some[1]), geo.face_of(some[2])
                            assert all(geo.face_of(v[1]) == fam.P and geo.face_of(v[2]) == fam.Q for v in fam.cells.values())
                            fams.append(fam)
    return fams


class Centres:
    """Solves every face's centre, one face at a time (U, D, F, R, B, then L
    is done), with batched commutators. Outer face turns never move a centre
    piece to another face, so they are free set-up moves here and are not undone."""

    ORDER = "UDFRB"
    side = 0.0  # weight of pieces placed on later faces in passing (0: the plain method)
    batch = True  # grow commutators to several slices

    def __init__(self, geo):
        self.geo = geo
        self.fams = {T: [] for T in FACES}
        for fam in centre_families(geo):
            self.fams[fam.T].append(fam)
        # Face rotations: (src, dst) per face and quarter turns 0..3.
        self.rot = {}
        for f in FACES:
            ident = list(range(geo.size))
            self.rot[f] = [(ident, ident)] + [(geo.src((f, 1, r)), geo.dst((f, 1, r))) for r in (1, 2, 3)]

    def scheme_for(self, state):
        """Face -> colour to solve towards: the fixed centres on odd sizes, the best of the 24 schemes on even ones."""
        geo = self.geo
        n = geo.n
        if n % 2:
            m = (n - 1) // 2
            return {f: state[FIDX[f] * geo.nn + m * n + m] for f in FACES}
        cnt = {f: {} for f in FACES}
        for f in FACES:
            for j in geo.centre_cells(f):
                cnt[f][state[j]] = cnt[f].get(state[j], 0) + 1
        best = max(sorted(cube._SCHEMES), key=lambda sch: sum(cnt[f].get(sch[i], 0) for i, f in enumerate(FACES)))
        return {f: best[i] for i, f in enumerate(FACES)}

    def solve(self, state, scheme=None, track=None):
        """Moves that solve every centre. `track` (optional) is a second state that every move is applied to as well.
        Returns (moves, state, track)."""
        geo = self.geo
        scheme = scheme or self.scheme_for(state)
        protected = set()
        moves = []
        for T in self.ORDER:
            tc = scheme[T]
            cells = geo.centre_cells(T)
            while any(state[j] != tc for j in cells):
                step = self._step(state, T, protected, scheme)
                state = geo.apply(state, step)
                if track is not None:
                    track = geo.apply(track, step)
                moves += step
            protected.add(T)
        assert all(state[j] == scheme[f] for f in FACES for j in geo.centre_cells(f))
        return moves, state, track

    def _step(self, s, T, protected, scheme):
        geo = self.geo
        tc = scheme[T]
        rot = self.rot
        free = [F for F in FACES if F != T and F not in protected]
        cands = {P: [j for j in geo.centre_cells(P) if s[j] == tc] for P in free}
        configs = {}
        rotT = rot[T]
        for fam in self.fams[T]:
            P = fam.P
            if P in protected or fam.Q in protected:
                continue
            qs = cands[P]
            if not qs:
                continue
            for sp in range(4):
                dP = rot[P][sp][1]
                for q0 in qs:
                    hit = fam.by_p1.get(dP[q0])
                    if hit is None:
                        continue
                    k, c, _ = hit
                    for t in range(4):
                        if s[rotT[t][0][c]] != tc:
                            key = (id(fam), t, sp)
                            got = configs.get(key)
                            if got is None:
                                configs[key] = [fam, t, sp, [k]]
                            else:
                                got[3].append(k)
        assert configs, "no move found"

        def value(fam, t, sp, k):
            c, p1, p2 = fam.cells[k]
            cc = s[rotT[t][0][c]]
            c1 = s[rot[fam.P][sp][0][p1]]
            c2 = s[rot[fam.P][sp][0][p2]] if fam.Q == fam.P else s[p2]
            dT = (c1 == tc) - (cc == tc)
            if dT < 0:
                return None
            qc, pc = scheme[fam.Q], scheme[fam.P]
            return dT + self.side * ((cc == qc) - (c2 == qc) + (c2 == pc) - (c1 == pc))

        # Base candidates: one row (several a, one b) or one column (one a, several b).
        base = []
        for fam, t, sp, ks in configs.values():
            setup = (t != 0) + (sp != 0)
            rows, cols = {}, {}
            for a, b in ks:
                rows.setdefault(b, []).append(a)
                cols.setdefault(a, []).append(b)
            for b, As in rows.items():
                if not self.batch:
                    As = As[:1]
                base.append((len(As) / (2 * len(As) + 6 + setup), fam, t, sp, sorted(As), [b]))
            for a, Bs in cols.items():
                if len(Bs) > 1 and self.batch:
                    base.append((len(Bs) / (2 * len(Bs) + 6 + setup), fam, t, sp, [a], sorted(Bs)))
        base.sort(key=lambda x: -x[0])
        best = None
        n = geo.n
        for _, fam, t, sp, A, B in base[:12]:
            setup = (t != 0) + (sp != 0)
            val = 0.0
            for a in A:
                for b in B:
                    val += value(fam, t, sp, (a, b))
            cost = 2 * len(A) + 2 * len(B) + 4 + setup
            # Grow the rectangle while that improves value per move.
            grow_rows = len(B) == 1
            while self.batch:
                add = None
                for x in range(2, n):
                    if x in A or x in B:
                        continue
                    tot = 0.0
                    for y in (A if grow_rows else B):
                        v = value(fam, t, sp, (y, x) if grow_rows else (x, y))
                        if v is None:
                            tot = None
                            break
                        tot += v
                    if tot is not None and tot > 0 and (val + tot) / (cost + 2) > val / cost and (add is None or tot > add[1]):
                        add = (x, tot)
                if add is None:
                    break
                (B if grow_rows else A).append(add[0])
                val += add[1]
                cost += 2
            if best is None or val / cost > best[0]:
                best = (val / cost, fam, t, sp, list(A), list(B))
        _, fam, t, sp, A, B = best
        out = []
        if t:
            out.append((T, 1, t))
        if sp:
            out.append((fam.P, 1, sp))
        return out + fam.moves(A, B)


# ---------------------------------------------------------------------------
# Wings


class WingFamily:
    """[X, Y] with X = slices along O's axis at depths A (amount e1) and
    Y = T^g O^h T^-g. Each depth a moves the wing at p1 to c (on T), c to p2, p2 to p1."""

    __slots__ = ("T", "O", "FA", "g", "h", "e1", "inverse", "cells")

    def moves(self, A):
        X = [(self.FA, a, self.e1) for a in A]
        Y = [(self.T, 1, self.g), (self.O, 1, self.h), (self.T, 1, 4 - self.g)]
        return Y + X + inv(Y) + inv(X) if self.inverse else X + Y + inv(X) + inv(Y)


def wing_families(geo):
    n = geo.n
    mid = (n + 1) // 2 if n % 2 else None
    fams = []
    for T in FACES:
        tw = geo.wing_cells(T)
        for O in FACES:
            if AXIS[O] == AXIS[T]:
                continue
            FA = POSITIVE[AXIS[O]]
            for g in (1, 3):
                for h in (1, 2, 3):
                    Y = [(T, 1, g), (O, 1, h), (T, 1, 4 - g)]
                    ys = {j for j in tw if geo.track(Y, j) != j}
                    for e1 in (1, 2, 3):
                        fwd = {}
                        for a in range(2, n):
                            if a == mid:
                                continue
                            X = [(FA, a, e1)]
                            dx = geo.dst(X[0])
                            cs = [j for j in tw if dx[j] != j and j in ys]
                            assert len(cs) == 1, (T, O, a)
                            c = cs[0]
                            seq = X + Y + inv(X) + inv(Y)
                            f1 = geo.track(seq, c)
                            f2 = geo.track(seq, f1)
                            assert geo.track(seq, f2) == c
                            fwd[a] = (c, f2, f1)
                        for inverse in (False, True):
                            fam = WingFamily()
                            fam.T, fam.O, fam.FA, fam.g, fam.h, fam.e1, fam.inverse = T, O, FA, g, h, e1, inverse
                            fam.cells = [(a, c, p2, p1) if inverse else (a, c, p1, p2) for a, (c, p1, p2) in sorted(fwd.items())]
                            fams.append(fam)
    return fams


class Wings:
    batch = False  # several depths in one commutator (off: the plain method sets the bar)
    reach = 1  # pieces a step is credited with placing (1: one wing at a time, like slice-flip-slice)
    """Pairs edges: every wing is cycled onto the edge of a target state (the
    midges' colours on odd sizes, a chosen assignment on even ones). Each wing
    orbit has to be an even permutation of its target for 3-cycles to finish
    it; an odd orbit gets one inner-slice quarter turn first, and the centres
    that turn moves are solved again with centre commutators, which leave
    wings alone."""

    def __init__(self, geo, centres):
        self.geo = geo
        self.centres = centres
        n = geo.n
        self.fams = wing_families(geo)
        # Wing cubies: one representative sticker each, its partner, and the orbit (|offset| along the edge).
        self.cubies = []
        seen = set()
        for f in FACES:
            for j in geo.wing_cells(f):
                p = geo.partner[j]
                if p in seen or j in seen:
                    continue
                seen.add(j)
                seen.add(p)
                pos = geo.pos[j]
                k = next(i for i in range(3) if abs(pos[i]) != n - 1)
                # Order the two stickers so (normal a, normal b, offset direction) is right-handed:
                # then (colour a, colour b) names a wing piece wherever it is.
                na, nb = geo.normal[j], geo.normal[p]
                off = [0, 0, 0]
                off[k] = 1 if pos[k] > 0 else -1
                det = (na[0] * (nb[1] * off[2] - nb[2] * off[1]) - na[1] * (nb[0] * off[2] - nb[2] * off[0])
                       + na[2] * (nb[0] * off[1] - nb[1] * off[0]))
                a, b = (j, p) if det > 0 else (p, j)
                self.cubies.append((a, b, abs(pos[k])))
        self.orbits = sorted({o for _, _, o in self.cubies})
        # Edges: the 12 slots, each as (stickers on face 1, stickers on face 2) along it.
        self.strips = cube._edge_strips(n)

    def target_for(self, state, scheme):
        """A paired state for the wings to reach (only edge stickers matter)."""
        geo = self.geo
        n = geo.n
        t = list(state)
        if n % 2:
            m = (n - 2) // 2
            for a, b in self.strips:
                for i in a:
                    t[i] = state[a[m]]
                for i in b:
                    t[i] = state[b[m]]
            return tuple(t)
        # Even: give each edge slot the colour pair that most of its wings already show.
        cols = set(scheme.values())
        opp = {scheme[f]: scheme[OPPOSITE[f]] for f in FACES}
        options = []
        for si, (a, b) in enumerate(self.strips):
            for x in cols:
                for y in cols:
                    if x == y or opp[x] == y:
                        continue
                    hits = sum(state[i] == x and state[k] == y for i, k in zip(a, b))
                    options.append((hits, si, x, y))
        options.sort(key=lambda o: (-o[0], o[1], o[2], o[3]))
        used_slots, used_pairs, assign = set(), set(), {}
        for hits, si, x, y in options:
            pair = frozenset((x, y))
            if si in used_slots or pair in used_pairs:
                continue
            used_slots.add(si)
            used_pairs.add(pair)
            assign[si] = (x, y)
        for si, (a, b) in enumerate(self.strips):
            x, y = assign[si]
            for i in a:
                t[i] = x
            for i in b:
                t[i] = y
        return tuple(t)

    def odd_orbits(self, state, target):
        """Orbits whose wings are an odd permutation of the target."""
        out = []
        for o in self.orbits:
            cub = [(a, b) for a, b, oo in self.cubies if oo == o]
            where = {(target[a], target[b]): i for i, (a, b) in enumerate(cub)}
            perm = [where[(state[a], state[b])] for a, b in cub]
            seen = [False] * len(perm)
            cycles = 0
            for i in range(len(perm)):
                if not seen[i]:
                    cycles += 1
                    while not seen[i]:
                        seen[i] = True
                        i = perm[i]
            if (len(perm) - cycles) % 2:
                out.append(o)
        return out

    def solve(self, state, scheme):
        geo = self.geo
        n = geo.n
        target = self.target_for(state, scheme)
        moves = []
        odd = self.odd_orbits(state, target)
        if n % 2 == 0 and len(odd) * 2 > len(self.orbits):
            # Swapping one edge's two colours in the target flips every orbit's parity.
            best = None
            for si, (a, b) in enumerate(self.strips):
                hits = sum(target[i] == state[i] for i in a + b)
                if best is None or hits < best[0]:
                    best = (hits, si)
            a, b = self.strips[best[1]]
            t = list(target)
            x, y = target[a[0]], target[b[0]]
            for i in a:
                t[i] = y
            for i in b:
                t[i] = x
            target = tuple(t)
            odd = self.odd_orbits(state, target)
        if odd:
            for o in odd:
                # The U-axis slice at height o turns one wing of this orbit on each of the 4 side edges.
                d = (n - 1 - o) // 2 + 1
                step = [("U", d, 1)]
                state = geo.apply(state, step)
                moves += step
            assert not self.odd_orbits(state, target)
            fix, state, target = self.centres.solve(state, scheme, track=target)
            moves += fix
        for _ in range(100000):
            step = self._step(state, target)
            if step is None:
                break
            setup, comm = step
            state = geo.apply(state, setup + comm)
            target = geo.apply(target, setup)
            moves += setup + comm
        assert all(state[a] == target[a] and state[b] == target[b] for a, b, _ in self.cubies)
        return moves, state

    def _index(self):
        """(sticker from, sticker to) -> the family cells that move a wing that way."""
        idx = getattr(self, "_by_pair", None)
        if idx is None:
            partner = self.geo.partner
            idx = {}
            by_from = {}
            for fam in self.fams:
                for a, c, p1, p2 in fam.cells:
                    cell = (fam, a, c, p1, p2)
                    idx.setdefault((p1, c), []).append(cell)
                    idx.setdefault((partner[p1], partner[c]), []).append(cell)
                    by_from.setdefault(p1, []).append(cell)
                    by_from.setdefault(partner[p1], []).append(cell)
            self._by_pair = idx
            self._by_from = by_from
            self._setups = [[]] + [[(f, 1, q)] for f in FACES for q in (1, 2, 3)]
            self._setups2 = [[(f, 1, q), (g, 1, r)] for f in FACES for q in (1, 2, 3) for g in FACES if g != f for r in (1, 2, 3)]
        return idx

    def _step(self, s, t):
        """The next set-up and commutator, or None when every wing is home. Set-ups are outer
        turns, applied to the target too (they move whole edges), so they are not undone."""
        geo = self.geo
        partner = geo.partner
        idx = self._index()
        # Each misplaced wing and the cubie it belongs in (wings are unique within an orbit).
        home = {}
        for a, b, o in self.cubies:
            home[(o, t[a], t[b])] = a
        todo = []
        for a, b, o in self.cubies:
            if s[a] != t[a] or s[b] != t[b]:
                todo.append((a, home[(o, s[a], s[b])]))
        if not todo:
            return None

        def gain(s2, t2, c, p1, p2):
            pc, pp1, pp2 = partner[c], partner[p1], partner[p2]
            before = (s2[c] == t2[c] and s2[pc] == t2[pc]) + (s2[p1] == t2[p1] and s2[pp1] == t2[pp1]) + (s2[p2] == t2[p2] and s2[pp2] == t2[pp2])
            after = (s2[p1] == t2[c] and s2[pp1] == t2[pc]) + (s2[c] == t2[p2] and s2[pc] == t2[pp2]) + (s2[p2] == t2[p1] and s2[pp2] == t2[pp1])
            return after - before

        for setups in (self._setups, self._setups2):
            best = None
            for S in setups:
                s2 = geo.apply(s, S) if S else s
                t2 = geo.apply(t, S) if S else t
                for x, y in todo:
                    for fam, a, c, p1, p2 in idx.get((geo.track(S, x), geo.track(S, y)), ()):
                        g = gain(s2, t2, c, p1, p2)
                        if g > 0 and (best is None or min(g, self.reach) / (8 + len(S)) > best[0]):
                            best = (min(g, self.reach) / (8 + len(S)), S, fam, a, s2, t2, g)
            if best is not None:
                break
        if best is None:
            # What's left needs two wings of one edge cycled together, which these commutators never do.
            # Conjugate by an inner slice (it takes one of the two to another edge) and up to two outer
            # turns, all undone afterwards: the centres come back since the commutator leaves them alone.
            n = geo.n
            for M in [[]] + [[(f, d, q)] for f in "URF" for d in range(2, n) for q in (1, 2, 3)]:
                for S in self._setups + self._setups2:
                    C = M + S
                    back = inv(C)
                    for x, y in todo:
                        for fam, a, c, p1, p2 in idx.get((geo.track(C, x), geo.track(C, y)), ()):
                            # Colours seen in the conjugated frame, read from where they are now.
                            at = lambda j: s[geo.track(back, j)]  # noqa: E731
                            tt = lambda j: t[geo.track(back, j)]  # noqa: E731
                            pc, pp1, pp2 = partner[c], partner[p1], partner[p2]
                            before = (at(c) == tt(c) and at(pc) == tt(pc)) + (at(p1) == tt(p1) and at(pp1) == tt(pp1)) + (at(p2) == tt(p2) and at(pp2) == tt(pp2))
                            after = (at(p1) == tt(c) and at(pp1) == tt(pc)) + (at(c) == tt(p2) and at(pc) == tt(pp2)) + (at(p2) == tt(p1) and at(pp2) == tt(pp1))
                            g = after - before
                            if g > 0 and (best is None or g / (8 + 2 * len(C)) > best[0]):
                                best = (g / (8 + 2 * len(C)), C, fam, a)
                if best is not None:
                    break
            assert best is not None, "wings stuck"
            _, C, fam, a = best
            return [], list(C) + fam.moves([a]) + inv(C)
        _, S, fam, a, s2, t2, g = best
        # Batch the other depths of the same commutator that also gain.
        A, cost = [a], 8 + len(S)
        for a2, c, p1, p2 in (fam.cells if self.batch else ()):
            if a2 != a:
                g2 = gain(s2, t2, c, p1, p2)
                if g2 > 0 and (g + g2) / (cost + 2) > g / cost:
                    A.append(a2)
                    g += g2
                    cost += 2
        return list(S), fam.moves(sorted(A))

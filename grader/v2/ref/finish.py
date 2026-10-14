"""Cube Arena v2 reference, stage 3: solve a reduced cube (centres solved, edges
paired) with the beginner's layer-by-layer method, after fixing parity on even
sizes with the standard inner-slice algorithms.

The reduced NxN behaves as a 3x3 under outer face turns, so the 3x3 work is
done on a 54-sticker copy (corners, one sticker per edge, centres) and its
face turns are output unchanged.
"""

import cube
import nxn

G3 = nxn.Geo(3)
FACES = "URFDLB"

# Kociemba facelet indices of the 3x3.
CORNERS = [(8, 9, 20), (6, 18, 38), (0, 36, 47), (2, 45, 11), (29, 26, 15), (27, 44, 24), (33, 53, 42), (35, 17, 51)]
EDGES = [(5, 10), (7, 19), (3, 37), (1, 46), (32, 16), (28, 25), (30, 43), (34, 52), (23, 12), (21, 41), (50, 39), (48, 14)]
FACE_OF = lambda i: FACES[i // 9]  # noqa: E731

# The same algorithm with another side face in front (the cube turned about U-D).
RENAME = {
    "F": {"F": "F", "R": "R", "B": "B", "L": "L"},
    "R": {"F": "R", "R": "B", "B": "L", "L": "F"},
    "B": {"F": "B", "R": "L", "B": "F", "L": "R"},
    "L": {"F": "L", "R": "F", "B": "R", "L": "B"},
}
RIGHT_OF = {"F": "R", "R": "B", "B": "L", "L": "F"}
LEFT_OF = {v: k for k, v in RIGHT_OF.items()}


def parse(alg):
    out = []
    for t in alg.split():
        out.append((t[0], 1, {"": 1, "2": 2, "'": 3}[t[1:]]))
    return out


def alg_for(alg, front):
    m = RENAME[front]
    return [(m.get(f, f), d, a) for f, d, a in parse(alg)]


class Solver3:
    def __init__(self, s):
        self.s = tuple(s)
        self.moves = []
        self.col = {f: self.s[i * 9 + 4] for i, f in enumerate(FACES)}
        self.face_of_col = {c: f for f, c in self.col.items()}

    def do(self, moves):
        self.s = G3.apply(self.s, moves)
        self.moves += moves

    # -- pieces --------------------------------------------------------
    def find_edge(self, a, b):
        for e in EDGES:
            x, y = self.s[e[0]], self.s[e[1]]
            if (x, y) == (a, b):
                return e, 0
            if (x, y) == (b, a):
                return e, 1
        raise ValueError("edge not found")

    def find_corner(self, cols):
        cols = set(cols)
        for c in CORNERS:
            if {self.s[i] for i in c} == cols:
                return c
        raise ValueError("corner not found")

    def edge_ok(self, e):
        return all(self.s[i] == self.col[FACE_OF(i)] for i in e)

    def corner_ok(self, c):
        return all(self.s[i] == self.col[FACE_OF(i)] for i in c)

    def solved(self):
        return all(self.s[i] == self.col[FACE_OF(i)] for i in range(54))

    # -- 1. cross on D ---------------------------------------------------
    def cross(self):
        d = self.col["D"]
        for X in "FRBL":
            x = self.col[X]
            for _ in range(10):
                e, _ = self.find_edge(d, x)
                faces = {FACE_OF(i) for i in e}
                dsticker = e[0] if self.s[e[0]] == d else e[1]
                if "D" in faces:
                    (Y,) = faces - {"D"}
                    if Y == X and FACE_OF(dsticker) == "D":
                        break
                    self.do([(Y, 1, 2)])
                elif "U" in faces:
                    (Y,) = faces - {"U"}
                    if Y != X:
                        k = {(0): 0}
                        order = "FLBR"  # U moves an edge F -> L -> B -> R
                        k = (order.index(X) - order.index(Y)) % 4
                        self.do([("U", 1, k)])
                        continue
                    if FACE_OF(dsticker) == "U":
                        self.do([(X, 1, 2)])
                    else:
                        self.do(alg_for(CROSS_FLIP, X))
                else:
                    # Middle layer: lift it into U without leaving the cross disturbed.
                    Y, Z = sorted(faces, key="FRBL".index)
                    a, b = (Y, Z) if RIGHT_OF[Y] == Z else (Z, Y)  # b is right of a
                    # Turning a counter-clockwise lifts the a-b edge to U-a.
                    self.do([(a, 1, 3), ("U", 1, 1), (a, 1, 1)])
            assert self.edge_ok(self.find_edge(d, x)[0])

    # -- 2. first-layer corners -------------------------------------------
    def corners(self):
        d = self.col["D"]
        for X in "FRBL":
            Y = RIGHT_OF[X]
            want = (d, self.col[X], self.col[Y])
            trig = alg_for("R U R' U'", X)
            for _ in range(20):
                c = self.find_corner(want)
                faces = {FACE_OF(i) for i in c}
                if faces == {"D", X, Y}:
                    if self.corner_ok(c):
                        break
                    self.do(trig)
                    continue
                if "D" in faces:
                    (P,) = [f for f in faces - {"D"} if RIGHT_OF[f] in faces]
                    self.do(alg_for("R U R'", P))
                    continue
                if faces != {"U", X, Y}:
                    self.do([("U", 1, 1)])
                    continue
                self.do(trig)
            assert self.corner_ok(self.find_corner(want))

    # -- 3. middle-layer edges ---------------------------------------------
    def middle(self):
        u = self.col["U"]
        for _ in range(40):
            todo = [X for X in "FRBL" if not self.edge_ok(self.find_edge(self.col[X], self.col[RIGHT_OF[X]])[0])]
            if not todo:
                return
            placed = False
            for e in EDGES[:4]:
                a, b = self.s[e[0]], self.s[e[1]]
                if u in (a, b):
                    continue
                Z = FACE_OF(e[1])
                Q = self.face_of_col[b]
                k = ("FLBR".index(Q) - "FLBR".index(Z)) % 4
                self.do([("U", 1, k)])
                if self.face_of_col[a] == RIGHT_OF[Q]:
                    self.do(alg_for("U R U' R' U' F' U F", Q))
                else:
                    self.do(alg_for("U' L' U L U F U' F'", Q))
                placed = True
                break
            if not placed:
                # Every U edge belongs to the last layer: push one in to pop a wrong middle edge out.
                self.do(alg_for("U R U' R' U' F' U F", todo[0]))
        raise AssertionError("middle layer")

    # -- 4. last layer: small searches over a few algorithms ------------------
    def search(self, macros, goal, depth):
        if goal(self.s):
            return
        frontier = [(self.s, [])]
        seen = {self.s}
        for _ in range(depth):
            nxt = []
            for s, path in frontier:
                for m in macros:
                    t = G3.apply(s, m)
                    if t in seen:
                        continue
                    seen.add(t)
                    if goal(t):
                        self.do([x for p in path + [m] for x in p])
                        return
                    nxt.append((t, path + [m]))
            frontier = nxt
        raise AssertionError("last layer search failed")

    def last_layer(self):
        u = self.col["U"]
        ups = [[("U", 1, 1)], [("U", 1, 2)], [("U", 1, 3)]]
        top_edges = [e[0] for e in EDGES[:4]]
        self.search(ups + [parse("F R U R' U' F'"), parse("F U R U' R' F'")],
                    lambda s: all(s[i] == u for i in top_edges), 4)
        self.search(ups + [alg_for("R U R' U R U2 R' U", X) for X in "FRBL"],
                    lambda s: all(s[i] == self.col[FACE_OF(i)] for e in EDGES[:4] for i in e), 4)

        def corners_placed(s):
            return all({s[i] for i in c} == {self.col[FACE_OF(i)] for i in c} for c in CORNERS[:4])

        self.search([alg_for("U R U' L' U R' U' L", X) for X in "FRBL"], corners_placed, 3)
        # Twist each top corner in turn at UFR with (R' D' R D), turning U between corners.
        for _ in range(4):
            for _ in range(3):
                if self.s[8] == u:
                    break
                self.do(parse("R' D' R D R' D' R D"))
            self.do([("U", 1, 1)])
        assert self.solved()

    def solve(self):
        self.cross()
        self.corners()
        self.middle()
        self.last_layer()
        return self.moves


CROSS_FLIP = None  # found by search below


def _find_cross_flip():
    """Shortest moves taking the UF edge, flipped, into DF while the other cross edges stay."""
    solved = cube.solved(3)
    # The state: DF's edge sits at UF with its D colour on F.
    start = cube.apply(solved, "F2 U F' R' F R") if False else None
    # Build it directly: swap stickers of the DF edge into UF flipped.
    s = list(solved)
    s[7], s[19] = "F", "D"  # UF holds the D-F edge, D colour on F
    s[28], s[25] = "U", "F"  # DF holds the U-F edge
    target = tuple(solved)
    keep = [i for e in EDGES[4:8] for i in e]
    start = tuple(s)
    moves = [(f, 1, a) for f in FACES for a in (1, 2, 3)]
    frontier = [(start, [])]
    for _ in range(5):
        nxt = []
        for st, path in frontier:
            for m in moves:
                if path and path[-1][0] == m[0]:
                    continue
                t = G3.apply(st, [m])
                if all(t[i] == target[i] for i in keep):
                    return " ".join(nxn.token(x) for x in path + [m])
                nxt.append((t, path + [m]))
        frontier = nxt
    raise AssertionError("no cross flip")


CROSS_FLIP = _find_cross_flip()


# ---------------------------------------------------------------------------
# Parity on even sizes


def _block(n, face, amount):
    """Turn of the inner half block on `face`'s side (layers 2..n/2), as the fewest moves."""
    k = n // 2
    sfx = {1: "", 2: "2", 3: "'"}[amount]
    inv = {1: "'", 2: "2", 3: ""}[amount]
    if k - 1 <= 2:
        return ["%d%s%s" % (d, face, sfx) for d in range(2, k + 1)]
    return ["%d%sw%s" % (k, face, sfx), face + inv]


def parity_algs(n):
    """(OLL parity, PLL parity) as move tokens for an even n."""
    def expand(alg):
        out = []
        for t in alg.split():
            if t[0] in "rl":
                out += _block(n, t[0].upper(), {"": 1, "2": 2, "'": 3}[t[1:]])
            elif t.startswith("Uw"):
                out.append("%dUw%s" % (n // 2, t[2:]) if n // 2 > 2 else t)
            else:
                out.append(t)
        return out
    return expand("r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2"), expand("r2 U2 r2 Uw2 r2 Uw2")


def read3(state, n):
    """The 3x3 a reduced NxN behaves as."""
    nn = n * n
    pick = (0, 1, n - 1)
    return tuple(state[f * nn + pick[r] * n + pick[c]] for f in range(6) for r in range(3) for c in range(3))


def parity(s3):
    """(flipped, swapped): odd edge flips, and edge permutation parity unlike the corners'."""
    col = {f: s3[i * 9 + 4] for i, f in enumerate(FACES)}
    home_e = {frozenset((col[FACE_OF(a)], col[FACE_OF(b)])): i for i, (a, b) in enumerate(EDGES)}
    home_c = {frozenset(col[FACE_OF(i)] for i in c): k for k, c in enumerate(CORNERS)}
    flips = 0
    ep = []
    for a, b in EDGES:
        x, y = s3[a], s3[b]
        ep.append(home_e[frozenset((x, y))])
        # Orientation: the U/D colour (or, for middle edges, the F/B colour) on the first facelet is good.
        ref = (col["U"], col["D"]) if {x, y} & {col["U"], col["D"]} else (col["F"], col["B"])
        flips += x not in ref
    cp = [home_c[frozenset(s3[i] for i in c)] for c in CORNERS]

    def odd(p):
        seen, cyc = [False] * len(p), 0
        for i in range(len(p)):
            if not seen[i]:
                cyc += 1
                while not seen[i]:
                    seen[i] = True
                    i = p[i]
        return (len(p) - cyc) % 2

    return flips % 2 == 1, odd(ep) != odd(cp)


def solve(state):
    n = cube.size(state)
    state = "".join(state)
    out = []
    if n % 2 == 0 and n >= 4:
        oll, pll = parity_algs(n)
        flipped, swapped = parity(read3(state, n))
        if flipped:
            out += oll
            state = cube.apply(state, " ".join(oll))
        flipped, swapped = parity(read3(state, n))
        assert not flipped
        if swapped:
            out += pll
            state = cube.apply(state, " ".join(pll))
    moves = Solver3(read3(state, n)).solve()
    return out + [nxn.token(m) for m in G3.simplify(moves)]

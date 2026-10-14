"""Reference NxN cube for the Cube Arena coding benchmark (v2).

This is the same cube the grader uses, in plain Python: the same sticker
order, the same moves, the same move counting and the same stage checks, for
any size from 2x2 up. Import it from your own code if you like (copy it into
your stage folder), or use it from a shell.

    import cube
    s = cube.apply(cube.solved(6), "R U 3Rw' 2F2 Lw")
    cube.size(s)                      # 6
    cube.count("R U 3Rw' 2F2 x", 6)   # 4 (whole-cube rotations are free)
    cube.centres_solved(s), cube.edges_paired(s), cube.is_solved(s)

From a shell:

    python3 cube.py apply "<state>" "<moves>"   prints the new state
    python3 cube.py check "<state>" "<moves>"   what the moves achieve, and how many they count
    python3 cube.py show  "<state>"             draws the state as a net

The size is read from the state: an NxN state has 6*N*N letters.
See SPEC.md for the state format and the notation.
"""

import re
import sys
from operator import itemgetter

FACES = "URFDLB"

# Outward normal, screen-right and screen-down of each face in the net.
FRAME = {
    "U": ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    "R": ((1, 0, 0), (0, 0, -1), (0, -1, 0)),
    "F": ((0, 0, 1), (1, 0, 0), (0, -1, 0)),
    "D": ((0, -1, 0), (1, 0, 0), (0, 0, -1)),
    "L": ((-1, 0, 0), (0, 0, 1), (0, -1, 0)),
    "B": ((0, 0, -1), (-1, 0, 0), (0, -1, 0)),
}
# Axis index and sign of each face's normal.
FACE_AXIS = {"U": (1, 1), "D": (1, -1), "R": (0, 1), "L": (0, -1), "F": (2, 1), "B": (2, -1)}


class MoveError(ValueError):
    pass


def solved(n):
    """The solved NxN state."""
    return "".join(f * n * n for f in FACES)


def size(state):
    """N for an NxN state (6*N*N letters)."""
    n = int(round((len(state) / 6) ** 0.5))
    if n < 2 or 6 * n * n != len(state):
        raise ValueError("a state has 6*N*N letters; %d is not one of those" % len(state))
    return n


_GEOM = {}


def _geometry(n):
    g = _GEOM.get(n)
    if g is None:
        st = []
        for face in FACES:
            nrm, r, d = FRAME[face]
            for row in range(n):
                for col in range(n):
                    a = 2 * col - (n - 1)
                    b = 2 * row - (n - 1)
                    pos = tuple(nrm[k] * (n - 1) + r[k] * a + d[k] * b for k in range(3))
                    st.append((pos, nrm))
        g = (st, {s: i for i, s in enumerate(st)}, {})
        _GEOM[n] = g
    return g


def _rotate(v, axis, quarter):
    x, y, z = v
    for _ in range(quarter):
        if axis == 0:
            y, z = -z, y
        elif axis == 1:
            x, z = z, -x
        else:
            x, y = -y, x
    return (x, y, z)


def permutation(n, turn):
    """src for a turn (axis, layers, quarter): after the turn, sticker j shows what sticker src[j] showed."""
    stickers, index, cache = _geometry(n)
    src = cache.get(turn)
    if src is None:
        axis, layers, quarter = turn
        src = list(range(len(stickers)))
        for i, (pos, nrm) in enumerate(stickers):
            if pos[axis] in layers:
                src[index[(_rotate(pos, axis, quarter), _rotate(nrm, axis, quarter))]] = i
        src = tuple(src)
        cache[turn] = src
    return src


def _layer(n, sign, depth):
    """Coordinate of the depth-th layer (1-based) counted inwards from a face."""
    return sign * (n - 1 - 2 * (depth - 1))


def face_turn(n, face, first, last, amount):
    """The turn of layers first..last (1-based, counted from `face`), `amount` quarter turns clockwise."""
    axis, sign = FACE_AXIS[face]
    layers = tuple(_layer(n, sign, k) for k in range(first, last + 1))
    # Clockwise seen from outside the face is -90 degrees about its outward normal.
    cw = 3 if sign == 1 else 1
    return (axis, layers, (cw * amount) % 4)


_AMOUNT = {"": 1, "'": 3, "2": 2, "2'": 2}
_FANCY = re.compile("[’′‘`´]")
_PARSED = {}


def parse_move(raw, n):
    """One move -> (cost, turn). cost is 1 for any layer turn, 0 for a whole-cube rotation."""
    key = (raw, n)
    hit = _PARSED.get(key)
    if hit is not None:
        return hit
    tok = _FANCY.sub("'", raw)
    out = None
    m = re.fullmatch(r"([xyz])(2'|2|'|)", tok)
    if m:
        face = {"x": "R", "y": "U", "z": "F"}[m.group(1)]
        out = (0, face_turn(n, face, 1, n, _AMOUNT[m.group(2)]))
    if out is None:
        m = re.fullmatch(r"([MES])(2'|2|'|)", tok)
        if m:
            if n % 2 == 0:
                raise MoveError("%s: M, E and S need a middle layer, so they only work on odd sizes" % tok)
            follow = {"M": "L", "E": "D", "S": "F"}[m.group(1)]
            mid = (n + 1) // 2
            out = (1, face_turn(n, follow, mid, mid, _AMOUNT[m.group(2)]))
    if out is None:
        m = re.fullmatch(r"(\d+)?([URFDLB])(w?)(2'|2|'|)", tok)
        if not m:
            raise MoveError("%s: not a move" % raw)
        face = m.group(2)
        amount = _AMOUNT[m.group(4)]
        depth = None if m.group(1) is None else int(m.group(1))
        if m.group(3) == "w":
            k = 2 if depth is None else depth
            if n < 3 or k < 2 or k > n - 1:
                raise MoveError("%s: wide turns on a %dx%d cover 2 to %d layers" % (tok, n, n, n - 1))
            out = (1, face_turn(n, face, 1, k, amount))
        elif depth is None:
            out = (1, face_turn(n, face, 1, 1, amount))
        else:
            if depth < 2 or depth > n - 1:
                raise MoveError("%s: inner slices on a %dx%d are layers 2 to %d" % (tok, n, n, n - 1))
            out = (1, face_turn(n, face, depth, depth, amount))
    _PARSED[key] = out
    return out


_ONE = re.compile(r"(\d+)?[URFDLB]w?(2'|2|'|[’′‘`´])?|[MESxyz](2'|2|'|[’′‘`´])?")
_SCAN = re.compile(r"\d*[URFDLB]w?(?:2'|2|'|[’′‘`´])?|[MESxyz](?:2'|2|'|[’′‘`´])?")


def tokenize(moves):
    """Split moves written as text ("R U R' U'", "R,U2", "RUR'U'") or given as a list."""
    chunks = []
    for s in [moves] if isinstance(moves, str) else moves:
        chunks += [c.strip() for c in re.split(r"[\s,;]+", str(s)) if c.strip()]
    out = []
    for chunk in chunks:
        if _ONE.fullmatch(chunk):
            out.append(chunk)
            continue
        i = 0
        while i < len(chunk):
            m = _SCAN.match(chunk, i)
            if not m or not m.group(0):
                raise MoveError('could not read "%s" as moves' % chunk)
            out.append(m.group(0))
            i = m.end()
    return out


def apply(state, moves, n=None):
    """The state after the moves."""
    n = n or size(state)
    if len(state) != 6 * n * n:
        raise ValueError("a %dx%d state has %d stickers" % (n, n, 6 * n * n))
    s = state
    for tok in tokenize(moves):
        _, turn = parse_move(tok, n)
        s = "".join(itemgetter(*permutation(n, turn))(s))
    return s


def count(moves, n):
    """How many moves a sequence counts: 1 per layer turn (half, wide and inner turns too), 0 per rotation."""
    return sum(parse_move(t, n)[0] for t in tokenize(moves))


def faces(state):
    """The six faces, each a list of N rows (strings)."""
    n = size(state)
    nn = n * n
    return [[state[f * nn + r * n:f * nn + r * n + n] for r in range(n)] for f in range(6)]


def is_solved(state):
    """Every face one colour (in any whole-cube orientation)."""
    n = size(state)
    nn = n * n
    return all(len(set(state[f * nn:(f + 1) * nn])) == 1 for f in range(6))


def _schemes():
    """Face -> colour maps of the solved cube in each of its 24 orientations."""
    out = set()
    frontier = [solved(3)]
    while frontier:
        s = frontier.pop()
        key = "".join(s[f * 9 + 4] for f in range(6))
        if key in out:
            continue
        out.add(key)
        frontier += [apply(s, r, 3) for r in ("x", "y", "z")]
    return out


_SCHEMES = _schemes()


def centre_colours(state):
    """The colour of each face's centre (U R F D L B order), or None if some face's centre is not one colour."""
    n = size(state)
    nn = n * n
    out = []
    for f in range(6):
        cs = {state[f * nn + r * n + c] for r in range(1, n - 1) for c in range(1, n - 1)}
        if len(cs) != 1:
            return None
        out.append(cs.pop())
    return "".join(out)


def centres_solved(state):
    """Every face's centre (all but the outer ring of stickers) is one colour, in a real colour scheme.

    On a 2x2 there are no centres, so this is always true there."""
    n = size(state)
    if n < 3:
        return True
    cc = centre_colours(state)
    return cc is not None and cc in _SCHEMES


def _edge_strips(n):
    """The 12 edges, each as two lists of state indices: the N-2 stickers along it on each of its two faces."""
    stickers, index, _ = _geometry(n)
    by_pos = {}
    for i, (pos, _nrm) in enumerate(stickers):
        by_pos.setdefault(pos, []).append(i)
    edges = {}
    for pos, idx in by_pos.items():
        if len(idx) != 2:
            continue
        # Key an edge by the two outer coordinates it sits on.
        key = tuple(sorted((k, pos[k]) for k in range(3) if abs(pos[k]) == n - 1))
        edges.setdefault(key, []).append(idx)
    out = []
    for key in sorted(edges):
        pieces = sorted(edges[key])
        a = [p[0] for p in pieces]
        b = [p[1] for p in pieces]
        out.append((a, b))
    return out


_STRIPS = {}


def edges_paired(state):
    """Centres solved, and along each of the 12 edges both faces show one colour."""
    n = size(state)
    if not centres_solved(state):
        return False
    strips = _STRIPS.get(n)
    if strips is None:
        strips = _STRIPS[n] = _edge_strips(n)
    for a, b in strips:
        if len({state[i] for i in a}) != 1 or len({state[i] for i in b}) != 1:
            return False
    return True


def show(state):
    """The state as a net: U on top, then L F R B, then D."""
    n = size(state)
    fs = dict(zip(FACES, faces(state)))
    pad = " " * (n + 1)
    lines = [pad + fs["U"][r] for r in range(n)]
    lines += [" ".join(fs[f][r] for f in "LFRB") for r in range(n)]
    lines += [pad + fs["D"][r] for r in range(n)]
    return "\n".join(lines)


def _main(argv):
    if len(argv) >= 3 and argv[0] == "apply":
        print(apply(argv[1], argv[2]))
    elif len(argv) >= 3 and argv[0] == "check":
        n = size(argv[1])
        end = apply(argv[1], argv[2])
        print("moves:          %d" % count(argv[2], n))
        print("centres solved: %s" % centres_solved(end))
        print("edges paired:   %s" % edges_paired(end))
        print("solved:         %s" % is_solved(end))
        return 0
    elif len(argv) >= 2 and argv[0] == "show":
        print(show(argv[1]))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))

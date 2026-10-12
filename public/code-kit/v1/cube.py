"""Reference 5x5 cube for the Cube Arena coding benchmark (v1).

This is the same cube the grader uses, written in plain Python: the same
sticker order, the same moves, the same move counting. Use it to test your
solver; you may also import it from your own code (copy it into solver/).

    import cube
    state = cube.apply(cube.SOLVED, "R U Rw' 3Fw2 2R")
    cube.is_solved(state)            # False
    cube.count("R U Rw' 3Fw2 2R x")  # 5 (whole-cube rotations are free)

From a shell:

    python3 cube.py apply  "<150-letter state>" "<moves>"   prints the new state
    python3 cube.py check  "<150-letter state>" "<moves>"   says whether the moves solve it, and how many they count
    python3 cube.py show   "<150-letter state>"             draws the state as a net

See SPEC.md for the state format and the notation.
"""

import re
import sys

N = 5
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

SOLVED = "".join(f * N * N for f in FACES)


class MoveError(ValueError):
    pass


def _stickers(n):
    """(position, normal) of every sticker, in state order. Positions are doubled so they are integers."""
    out = []
    for face in FACES:
        nrm, r, d = FRAME[face]
        for row in range(n):
            for col in range(n):
                a = 2 * col - (n - 1)
                b = 2 * row - (n - 1)
                pos = tuple(nrm[k] * (n - 1) + r[k] * a + d[k] * b for k in range(3))
                out.append((pos, nrm))
    return out


_STICKERS = _stickers(N)
_INDEX = {s: i for i, s in enumerate(_STICKERS)}
_PERMS = {}


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


def _perm(axis, layers, quarter):
    """src[j] = the sticker whose colour lands on j after the turn."""
    key = (axis, layers, quarter)
    src = _PERMS.get(key)
    if src is None:
        src = list(range(len(_STICKERS)))
        for i, (pos, nrm) in enumerate(_STICKERS):
            if pos[axis] in layers:
                src[_INDEX[(_rotate(pos, axis, quarter), _rotate(nrm, axis, quarter))]] = i
        _PERMS[key] = src
    return src


def _layer(n, sign, depth):
    """Coordinate of the depth-th layer (1-based) counted inwards from a face."""
    return sign * (n - 1 - 2 * (depth - 1))


def _face_turn(face, first, last, amount):
    axis, sign = FACE_AXIS[face]
    layers = tuple(_layer(N, sign, k) for k in range(first, last + 1))
    # Clockwise seen from outside the face is -90 degrees about its outward normal.
    cw = 3 if sign == 1 else 1
    return (axis, layers, (cw * amount) % 4)


_AMOUNT = {"": 1, "'": 3, "2": 2, "2'": 2}
_FANCY = re.compile("[’′‘`´]")


def parse_move(raw):
    """One move -> (cost, turn). cost is 1 for any layer turn, 0 for a whole-cube rotation."""
    tok = _FANCY.sub("'", raw)
    m = re.fullmatch(r"([xyz])(2'|2|'|)", tok)
    if m:
        face = {"x": "R", "y": "U", "z": "F"}[m.group(1)]
        return 0, _face_turn(face, 1, N, _AMOUNT[m.group(2)])
    m = re.fullmatch(r"([MES])(2'|2|'|)", tok)
    if m:
        follow = {"M": "L", "E": "D", "S": "F"}[m.group(1)]
        mid = (N + 1) // 2
        return 1, _face_turn(follow, mid, mid, _AMOUNT[m.group(2)])
    m = re.fullmatch(r"(\d+)?([URFDLB])(w?)(2'|2|'|)", tok)
    if m:
        face = m.group(2)
        amount = _AMOUNT[m.group(4)]
        depth = None if m.group(1) is None else int(m.group(1))
        if m.group(3) == "w":
            k = 2 if depth is None else depth
            if k < 2 or k > N - 1:
                raise MoveError("%s: wide turns on a %dx%d cover 2 to %d layers" % (tok, N, N, N - 1))
            return 1, _face_turn(face, 1, k, amount)
        if depth is None:
            return 1, _face_turn(face, 1, 1, amount)
        if depth < 2 or depth > N - 1:
            raise MoveError("%s: inner slices on a %dx%d are layers 2 to %d" % (tok, N, N, N - 1))
        return 1, _face_turn(face, depth, depth, amount)
    raise MoveError("%s: not a move" % raw)


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


def apply(state, moves):
    """The state after the moves."""
    if len(state) != 6 * N * N:
        raise ValueError("a %dx%d state has %d stickers" % (N, N, 6 * N * N))
    s = state
    for tok in tokenize(moves):
        _, turn = parse_move(tok)
        src = _perm(*turn)
        s = "".join(s[k] for k in src)
    return s


def count(moves):
    """How many moves a sequence counts: 1 per layer turn (half and wide turns too), 0 per rotation."""
    return sum(parse_move(t)[0] for t in tokenize(moves))


def is_solved(state):
    """Every face one colour (in any whole-cube orientation)."""
    nn = N * N
    return all(len(set(state[f * nn:(f + 1) * nn])) == 1 for f in range(6))


def show(state):
    """The state as a net: U on top, then L F R B, then D."""
    nn = N * N
    face = {f: [state[i * nn + r * N:i * nn + r * N + N] for r in range(N)] for i, f in enumerate(FACES)}
    pad = " " * (N + 1)
    lines = [pad + face["U"][r] for r in range(N)]
    lines += [" ".join(face[f][r] for f in "LFRB") for r in range(N)]
    lines += [pad + face["D"][r] for r in range(N)]
    return "\n".join(lines)


def _main(argv):
    if len(argv) >= 3 and argv[0] == "apply":
        print(apply(argv[1], argv[2]))
    elif len(argv) >= 3 and argv[0] == "check":
        end = apply(argv[1], argv[2])
        print("solved" if is_solved(end) else "not solved", "in", count(argv[2]), "moves")
        return 0 if is_solved(end) else 1
    elif len(argv) >= 2 and argv[0] == "show":
        print(show(argv[1]))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))

"""Generate the app icons (stdlib only): a waveform on the Classic dark ground.

    python3 tools/icons/make_icons.py apps/web/public
"""
import math, struct, sys, zlib
from pathlib import Path

BG = (0x1D, 0x21, 0x25)
FG = (0x4C, 0xB7, 0xE6)

def png(path, size, ss=4):
    n = size * ss
    # Coverage of a sine stroke, supersampled for anti-aliasing.
    amp, cycles, width = 0.18 * n, 1.5, 0.055 * n
    x0, x1 = 0.18 * n, 0.82 * n
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            hit = 0
            for sy in range(ss):
                for sx in range(ss):
                    px, py = x * ss + sx + 0.5, y * ss + sy + 0.5
                    if x0 <= px <= x1:
                        t = (px - x0) / (x1 - x0)
                        f = lambda u: n / 2 - amp * math.sin(u * cycles * 2 * math.pi) * math.sin(u * math.pi)
                        cy = f(t)
                        slope = (f(t + 1e-4) - f(t - 1e-4)) / (2e-4 * (x1 - x0))
                        # Perpendicular distance, so the stroke is even on the slopes.
                        if abs(py - cy) / math.sqrt(1 + slope * slope) <= width / 2:
                            hit += 1
            a = hit / (ss * ss)
            row += bytes(round(BG[i] * (1 - a) + FG[i] * a) for i in range(3))
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", raw) + chunk(b"IEND", b""))

out = Path(sys.argv[1])
for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
    png(out / name, size, ss=4 if size <= 192 else 2)
    print("wrote", out / name)

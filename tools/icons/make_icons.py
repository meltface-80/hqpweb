"""Generate the app icons (stdlib only): a waveform on the Classic dark ground.

    python3 tools/icons/make_icons.py apps/web/public
"""
import math, struct, sys, zlib
from pathlib import Path

BG = (0x1D, 0x21, 0x25)
FG = (0x4C, 0xB7, 0xE6)

def png(path, size, ss=4, stroke=0.055):
    n = size * ss
    # Coverage of a sine stroke, supersampled for anti-aliasing.
    amp, cycles, width = 0.18 * n, 1.5, stroke * n
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
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))
    if path:
        Path(path).write_bytes(data)
    return data

def ico(path, images):
    """An .ico holding PNG images (supported by every current browser)."""
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for size, data in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    Path(path).write_bytes(head + entries + blobs)

out = Path(sys.argv[1])
for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
    png(out / name, size, ss=4 if size <= 192 else 2)
    print("wrote", out / name)
# Browser tabs: a thicker stroke so the waveform reads at 16–32 px.
png(out / "favicon-32.png", 32, ss=8, stroke=0.11)
ico(out / "favicon.ico", [(16, png(None, 16, ss=8, stroke=0.12)), (32, png(None, 32, ss=8, stroke=0.11))])
print("wrote", out / "favicon-32.png", "and", out / "favicon.ico")

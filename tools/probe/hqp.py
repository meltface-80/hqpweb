"""Minimal HQPlayer control-protocol client for probing (stdlib only).

    python3 hqp.py HOST discover|info|status|state|lists

Read-only by design. Live-change experiments belong in a separate, explicitly
invoked script that snapshots State first and restores it after (see
docs/design-v1.md §6) — never volume up.
"""
import re, socket, sys

def q(host, xml, port=4321, timeout=6):
    s = socket.create_connection((host, port), timeout=timeout)
    s.sendall(('<?xml version="1.0" encoding="UTF-8"?>' + xml).encode() + b"\n")
    buf = b""
    try:
        while b"\n" not in buf:
            d = s.recv(262144)
            if not d:
                break
            buf += d
    except socket.timeout:
        pass
    s.close()
    return buf.decode(errors="replace").strip()

def attrs(x):
    return dict(re.findall(r'(\w+)="([^"]*)"', x))

def items(x, tag):
    return [attrs(m) for m in re.findall(r"<%s ([^>]*)/>" % tag, x)]

def discover(timeout=3):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    s.settimeout(timeout)
    s.sendto(b'<?xml version="1.0" encoding="UTF-8"?><discover>hqplayer</discover>', ("239.192.0.199", 4321))
    out = []
    try:
        while True:
            data, addr = s.recvfrom(4096)
            out.append((addr[0], attrs(data.decode(errors="replace"))))
    except socket.timeout:
        pass
    return out

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "discover":
        for a, d in discover():
            print(a, d)
        sys.exit()
    host, cmd = sys.argv[1], sys.argv[2]
    if cmd == "info":
        print(attrs(q(host, "<GetInfo/>")))
    elif cmd == "status":
        print(attrs(q(host, '<Status subscribe="0"/>')))
    elif cmd == "state":
        print(attrs(q(host, "<State/>")))
    elif cmd == "lists":
        for tag, xml in (("ModesItem", "<GetModes/>"), ("RatesItem", "<GetRates/>"),
                         ("ShapersItem", "<GetShapers/>"), ("FiltersItem", "<GetFilters/>")):
            print(xml, [(i.get("index"), i.get("name") or i.get("rate")) for i in items(q(host, xml), tag)])

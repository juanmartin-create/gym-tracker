#!/usr/bin/env python3
"""Genera los iconos PNG de la PWA sin dependencias externas.
Dibuja una mancuerna (dumbbell) blanca sobre un fondo con degradado simulado.
"""
import struct, zlib, os

def png(width, height, pixels):
    """pixels: lista de filas, cada fila lista de (r,g,b,a)."""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filtro None por scanline
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

def lerp(a, b, t):
    return int(a + (b - a) * t)

def build(size, maskable=False):
    # Paleta: fondo violeta/indigo -> azul (degradado diagonal)
    c0 = (99, 102, 241)    # indigo-500
    c1 = (37, 99, 235)     # blue-600
    fg = (255, 255, 255)
    rows = []
    # margen extra para version "maskable" (zona segura).
    # No redondeamos esquinas: iOS aplica su propia mascara redondeada.
    pad = int(size * 0.16) if maskable else int(size * 0.10)
    cx = size / 2
    cy = size / 2
    for y in range(size):
        row = []
        for x in range(size):
            t = (x + y) / (2 * size)
            bg = (lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t), 255)
            px = bg
            # --- dibujar mancuerna (horizontal) ---
            unit = (size - 2 * pad)
            bar_h = unit * 0.12      # alto de la barra central
            bar_w = unit * 0.42      # largo de la barra central
            plate_w = unit * 0.10    # ancho de cada disco
            plate_h = unit * 0.40    # alto disco interno
            plate_h2 = unit * 0.26   # alto disco externo
            # barra central
            if abs(x - cx) <= bar_w / 2 and abs(y - cy) <= bar_h / 2:
                px = fg + (0,)
                px = (fg[0], fg[1], fg[2], 255)
            # discos internos (a cada lado de la barra)
            for sign in (-1, 1):
                px_inner = cx + sign * (bar_w / 2 + plate_w / 2)
                if abs(x - px_inner) <= plate_w / 2 and abs(y - cy) <= plate_h / 2:
                    px = (fg[0], fg[1], fg[2], 255)
                px_outer = cx + sign * (bar_w / 2 + plate_w * 1.6)
                if abs(x - px_outer) <= plate_w / 2 and abs(y - cy) <= plate_h2 / 2:
                    px = (fg[0], fg[1], fg[2], 255)
            row.append(px)
        rows.append(row)
    return png(size, size, rows)

here = os.path.dirname(os.path.abspath(__file__))
for size in (180, 192, 512):
    with open(os.path.join(here, f"icon-{size}.png"), "wb") as f:
        f.write(build(size))
with open(os.path.join(here, "icon-maskable-512.png"), "wb") as f:
    f.write(build(512, maskable=True))
print("iconos generados:", os.listdir(here))

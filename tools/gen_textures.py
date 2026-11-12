#!/usr/bin/env python3
"""Генерация 16x16 текстур попиксельно (чёткий пиксель-арт)."""
from PIL import Image
import math, os

OUT_B = "/home/user/nuclear_addon/NuclearCharge_RP/textures/blocks"
OUT_I = "/home/user/nuclear_addon/NuclearCharge_RP/textures/items"
os.makedirs(OUT_B, exist_ok=True)
os.makedirs(OUT_I, exist_ok=True)

S = 16

# палитра
STEEL   = (62, 62, 70, 255)
STEEL_D = (46, 46, 52, 255)
STEEL_L = (84, 84, 94, 255)
RIVET   = (100, 100, 112, 255)
BLACK   = (16, 16, 18, 255)
YELLOW  = (238, 200, 42, 255)
ORANGE  = (255, 122, 36, 255)
RED     = (206, 34, 28, 255)
RED_ON  = (255, 64, 44, 255)
RED_OFF = (66, 12, 10, 255)
DARKP   = (26, 26, 30, 255)


def new_grid():
    return [[STEEL for _ in range(S)] for _ in range(S)]


def px(g, x, y, c):
    if 0 <= x < S and 0 <= y < S:
        g[y][x] = c


def rect(g, x0, y0, x1, y1, c):
    for y in range(max(0, y0), min(S, y1 + 1)):
        for x in range(max(0, x0), min(S, x1 + 1)):
            g[y][x] = c


def frame(g, x0, y0, x1, y1, c):
    for x in range(x0, x1 + 1):
        px(g, x, y0, c); px(g, x, y1, c)
    for y in range(y0, y1 + 1):
        px(g, x0, y, c); px(g, x1, y, c)


def disc(g, cx, cy, r, c, cxr=None, cyr=None):
    cxr = cx if cxr is None else cxr
    cyr = cy if cyr is None else cyr
    for y in range(S):
        for x in range(S):
            if (x + 0.5 - cxr) ** 2 + (y + 0.5 - cyr) ** 2 <= r * r:
                g[y][x] = c


def trefoil(g, cx, cy, r_out, c=BLACK, bg=YELLOW, blades=((90,),)):
    """Знак радиации: диск bg, 3 чёрные лопасти-кольца + центральная точка."""
    disc(g, cx, cy, r_out, bg, cx, cy)
    r_dot = r_out * 0.24         # центральная точка
    r_blade0 = r_out * 0.46      # лопасти — кольцо от r0 до r_out
    for y in range(S):
        for x in range(S):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            r = math.hypot(dx, dy)
            if r <= r_dot:
                g[y][x] = c
                continue
            if r_blade0 <= r <= r_out:
                ang = math.degrees(math.atan2(-dy, dx)) % 360
                for A in (90, 210, 330):
                    diff = min(abs(ang - A), 360 - abs(ang - A))
                    if diff <= 29:
                        g[y][x] = c
                        break




# ---------- фотореалистичные фишки: шум, износ, блики ----------
import random as _rnd
_rng = _rnd.Random(20260114)

def add_noise(g, area, colors, density=0.14, seed_area=None):
    """Случайные пиксели-шум в прямоугольнике area=(x0,y0,x1,y1)."""
    x0, y0, x1, y1 = area
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if _rng.random() < density:
                g[y][x] = colors[_rng.randrange(len(colors))]


def edge_light(g, inset=1, light=(96, 96, 108, 255), dark=(28, 28, 34, 255)):
    """Свет сверху-слева, тень снизу-справа — объём металла."""
    for i in range(inset, 15 - inset + 1):
        if g[inset][i] != (0, 0, 0, 0): g[inset][i] = light
        if g[15 - inset][i] != (0, 0, 0, 0): g[15 - inset][i] = dark
    for j in range(inset, 15 - inset + 1):
        if g[j][inset] != (0, 0, 0, 0): g[j][inset] = light
        if g[j][15 - inset] != (0, 0, 0, 0): g[j][15 - inset] = dark


def bolts(g, positions):
    """Болты: тёмная точка + блик."""
    for (x, y) in positions:
        px(g, x, y, (30, 30, 36, 255))
        px(g, x, y - 1, (120, 120, 132, 255)) if y - 1 >= 0 else None


def scratches(g, n, colors=((120, 120, 130, 255), (48, 48, 56, 255)), area=(2, 2, 13, 13)):
    """Царапины — короткие линии."""
    for _ in range(n):
        x = _rng.randint(area[0], area[2] - 2)
        y = _rng.randint(area[1], area[3])
        c = colors[_rng.randrange(len(colors))]
        px(g, x, y, c)
        px(g, x + 1, y, c)


def metal_base(g):
    frame(g, 0, 0, 15, 15, STEEL_L)
    rect(g, 1, 1, 14, 14, STEEL)
    frame(g, 1, 1, 14, 14, STEEL_D)  # тонкая внутр. линия
    rect(g, 2, 2, 13, 13, STEEL)
    # заклёпки
    for x, y in [(2, 2), (13, 2), (2, 13), (13, 13)]:
        px(g, x, y, RIVET)


def hazard_band(g, y0, y1, c_a, c_b):
    """Диагональная полоса 'осторожно'."""
    for y in range(y0, y1 + 1):
        for x in range(S):
            g[y][x] = c_a if (x + y) % 4 < 2 else c_b


def save(g, path):
    img = Image.new("RGBA", (S, S))
    for y in range(S):
        for x in range(S):
            img.putpixel((x, y), g[y][x])
    img.save(path)
    big = img.resize((160, 160), Image.NEAREST)
    big.save(path.replace(".png", "_x10.png"))
    print("ok", path)


# ---------------- TOP: метал + большой трилистник ----------------
def tex_top(armed=False):
    g = new_grid()
    metal_base(g)
    c_bg = ORANGE if armed else YELLOW
    trefoil(g, 8, 8, 5.6, BLACK, c_bg)
    # шум только по углам панелей — знак остаётся чистым
    for (x0, y0, x1, y1) in [(2, 2, 6, 6), (10, 2, 13, 6), (2, 11, 6, 13), (10, 11, 13, 13)]:
        add_noise(g, (x0, y0, x1, y1), [(50, 50, 58, 255), (72, 72, 82, 255)], 0.12)
    scratches(g, 2)
    bolts(g, [(3, 3), (12, 3), (3, 12), (12, 12)])
    edge_light(g)
    if armed:
        frame(g, 0, 0, 15, 15, RED_ON)
    return g

# ---------------- SIDE: полосы + табличка + таймер ----------------
def tex_side(armed=False):
    g = new_grid()
    metal_base(g)
    c_a, c_b = (BLACK, YELLOW) if not armed else (BLACK, ORANGE)
    hazard_band(g, 0, 2, c_a, c_b)
    hazard_band(g, 13, 15, c_a, c_b)
    rect(g, 0, 3, 15, 12, STEEL)      # средняя панель
    frame(g, 0, 3, 15, 12, STEEL_D)
    # табличка с мини-трилистником
    rect(g, 1, 5, 7, 11, DARKP)
    trefoil(g, 4.5, 8, 2.9, BLACK, c_bg_or(YELLOW, ORANGE, armed))
    # таймер-дисплей
    rect(g, 9, 5, 14, 11, DARKP)
    led = RED_ON if armed else RED
    rect(g, 10, 6, 13, 7, led)        # верхний сегмент
    rect(g, 10, 9, 13, 10, RED_OFF if not armed else led)
    px(g, 11, 8, led); px(g, 12, 8, RED_OFF)
    if armed:
        for x in range(0, 16):
            for y in (3, 12):
                if (x + y) % 3 == 0:
                    px(g, x, y, (255, 70, 40, 130))
    # износ: грязь на стальной панели
    add_noise(g, (0, 4, 15, 12), [(52, 52, 60, 255), (70, 70, 80, 255)], 0.12)
    bolts(g, [(0, 4), (15, 4), (0, 12), (15, 12)])
    edge_light(g)
    return g

def c_bg_or(a, b, armed):
    return b if armed else a

# ---------------- BOTTOM: метал + люк ----------------
def tex_bottom():
    g = new_grid()
    metal_base(g)
    disc(g, 8, 8, 3.4, STEEL_D)
    disc(g, 8, 8, 2.2, STEEL_L)
    px(g, 6, 8, STEEL_D); px(g, 10, 8, STEEL_D)
    px(g, 8, 6, STEEL_D); px(g, 8, 10, STEEL_D)
    return g

# ---------------- ДЕТОНАТОР (предмет) ----------------
def tex_detonator():
    g = new_grid()
    # прозрачный фон
    for y in range(S):
        for x in range(S):
            g[y][x] = (0, 0, 0, 0)
    # антенна
    rect(g, 12, 0, 12, 4, (130, 130, 140, 255))
    px(g, 12, 0, RED_ON)
    # корпус
    rect(g, 2, 5, 13, 14, (156, 32, 26, 255))
    frame(g, 2, 5, 13, 14, (96, 16, 12, 255))
    # экран
    rect(g, 4, 7, 9, 10, (18, 22, 18, 255))
    frame(g, 3, 6, 10, 11, (60, 60, 64, 255))
    rect(g, 5, 8, 5, 9, RED_ON)
    rect(g, 7, 8, 8, 9, RED_ON)
    # кнопка подрыва
    disc(g, 11.5, 12, 1.8, YELLOW)
    px(g, 11, 12, BLACK)
    # насечки на рукояти
    px(g, 3, 13, (96, 16, 12, 255)); px(g, 5, 13, (96, 16, 12, 255))
    return g


save(tex_top(False), f"{OUT_B}/nuclear_charge_top.png")
save(tex_top(True),  f"{OUT_B}/nuclear_charge_top_armed.png")
save(tex_side(False), f"{OUT_B}/nuclear_charge_side.png")
save(tex_side(True),  f"{OUT_B}/nuclear_charge_side_armed.png")
save(tex_bottom(),   f"{OUT_B}/nuclear_charge_bottom.png")
save(tex_detonator(), f"{OUT_I}/nuclear_detonator.png")


# ---------------- ПУСКОВАЯ СТАНЦИЯ ----------------
def tex_station_side(loaded=False):
    g = new_grid()
    metal_base(g)
    c_a, c_b = (BLACK, YELLOW) if not loaded else (BLACK, ORANGE)
    hazard_band(g, 0, 1, c_a, c_b)
    hazard_band(g, 14, 15, c_a, c_b)
    rect(g, 0, 2, 15, 13, STEEL)
    frame(g, 0, 2, 15, 13, STEEL_D)
    # экран консоли
    rect(g, 2, 4, 9, 8, DARKP)
    frame(g, 1, 3, 10, 9, STEEL_L)
    if loaded:
        rect(g, 3, 5, 8, 7, RED_ON)
        px(g, 3, 5, (255, 200, 60, 255)); px(g, 8, 7, (255, 200, 60, 255))
    else:
        rect(g, 3, 5, 8, 7, (20, 40, 20, 255))
        px(g, 3, 5, (87, 211, 100, 255)); px(g, 5, 6, (87, 211, 100, 255))
        px(g, 7, 5, (87, 211, 100, 255)); px(g, 4, 7, (87, 211, 100, 255))
    # сигнальные лампы
    for i, x in enumerate((12, 14)):
        col = (RED_ON if (loaded or i == 0) else RED_OFF)
        disc(g, x + 0.5, 5.5, 1.2, col)
        px(g, x, 7, STEEL_D)
    # тумблеры: 2 рычажка под лампами
    px(g, 11, 9, (120, 120, 130, 255)); px(g, 11, 10, (60, 60, 70, 255))
    px(g, 13, 9, (120, 120, 130, 255)); px(g, 13, 10, (60, 60, 70, 255))
    px(g, 15, 9, (120, 120, 130, 255)); px(g, 15, 10, (60, 60, 70, 255))
    # кабель по низу панели
    for x in range(0, 16):
        if x % 5 != 0: px(g, x, 11, (24, 24, 28, 255))
    # кнопки на консоли
    px(g, 4, 12, RED_ON if loaded else (60, 12, 10, 255))
    px(g, 6, 12, YELLOW)
    px(g, 8, 12, (87, 211, 100, 255))
    # износ
    add_noise(g, (0, 2, 15, 13), [(52, 52, 60, 255), (70, 70, 80, 255)], 0.10)
    bolts(g, [(1, 2), (14, 2), (1, 15), (14, 15)])
    return g


def tex_station_top():
    g = new_grid()
    metal_base(g)
    # периметр-полоса опасности
    c_a, c_b = (BLACK, YELLOW)
    for x in range(16):
        for y in (0, 1, 14, 15):
            g[y][x] = c_a if (x + y) % 4 < 2 else c_b
    for y in range(16):
        for x in (0, 1, 14, 15):
            g[y][x] = c_a if (x + y) % 4 < 2 else c_b
    rect(g, 2, 2, 13, 13, STEEL)
    # стартовый люк
    disc(g, 8, 8, 4.2, STEEL_D)
    disc(g, 8, 8, 3.2, DARKP)
    disc(g, 8, 8, 2.0, (60, 64, 74, 255))
    trefoil(g, 8, 8, 1.7, BLACK, YELLOW)
    return g


def tex_station_bottom():
    g = new_grid()
    metal_base(g)
    for x, y in [(2, 2), (13, 2), (2, 13), (13, 13), (7, 7), (8, 8)]:
        px(g, x, y, STEEL_D)
    return g




# ---------------- ЦЕЛЬ-МЕТКА ----------------
def tex_marker_sparkle():
    """Мерцающий спрайт для мини-геометрии: прозрачный фон, красный ромб, белое ядро."""
    g = [[(0, 0, 0, 0) for _ in range(S)] for _ in range(S)]
    import math as _m
    for y in range(16):
        for x in range(16):
            d = abs(x + 0.5 - 8) + abs(y + 0.5 - 8)
            if d <= 4:
                g[y][x] = (226, 40, 30, 255)
            elif d <= 5:
                g[y][x] = (150, 24, 18, 255)
    rect(g, 7, 7, 8, 8, (255, 255, 255, 255))
    # искры-блёстки
    px(g, 3, 4, (255, 230, 120, 255))
    px(g, 12, 5, (255, 255, 255, 255))
    px(g, 4, 12, (255, 255, 255, 255))
    px(g, 11, 11, (255, 230, 120, 255))
    return g


def tex_target_marker():
    """Иконка для инвентаря: пластина с прицелом."""
    g = new_grid()
    metal_base(g)
    # тёмная панель
    rect(g, 2, 2, 13, 13, (34, 36, 42, 255))
    frame(g, 2, 2, 13, 13, STEEL_D)
    # белое кольцо прицела
    import math as _m
    for y in range(16):
        for x in range(16):
            d = _m.hypot(x + 0.5 - 8, y + 0.5 - 8)
            if 4.6 <= d <= 5.6:
                g[y][x] = (240, 240, 240, 255)
    # красный перекрест
    rect(g, 8, 3, 8, 13, (230, 40, 30, 255))
    rect(g, 3, 8, 13, 8, (230, 40, 30, 255))
    # белый центр
    rect(g, 7, 7, 8, 8, (250, 250, 250, 255))
    # угловые метки-скобы
    for (cx, cy, dx, dy) in [(3, 3, 1, 0), (3, 3, 0, 1), (12, 3, -1, 0), (12, 3, 0, 1),
                              (3, 12, 1, 0), (3, 12, 0, -1), (12, 12, -1, 0), (12, 12, 0, -1)]:
        px(g, cx, cy, (240, 240, 240, 255))
        px(g, cx + dx, cy + dy, (240, 240, 240, 255))
    return g

save(tex_marker_sparkle(), f"{OUT_B}/target_marker.png")
save(tex_target_marker(), f"{OUT_I}/target_marker_icon.png")



# ---------------- РАКЕТА (текстура сущности) ----------------
def tex_missile():
    g = new_grid()
    # стальной корпус с вертикальным блеском
    for y in range(16):
        for x in range(16):
            if x in (0, 15): g[y][x] = (40, 40, 46, 255)
            elif x in (1, 5, 10, 14): g[y][x] = (90, 90, 100, 255)
            elif x in (2, 11): g[y][x] = (112, 112, 124, 255)
            else: g[y][x] = (74, 74, 84, 255)
    # красный нос (верх текстуры)
    rect(g, 0, 0, 15, 3, (196, 30, 24, 255))
    rect(g, 1, 3, 14, 4, (150, 22, 18, 255))
    # полоса опасности
    hazard_band(g, 6, 8, BLACK, YELLOW)
    # тёмная зона стабилизаторов/сопла (низ) с оранжевым жаром
    rect(g, 0, 12, 15, 15, (34, 34, 40, 255))
    for x in (2, 7, 12):
        px(g, x, 13, (70, 70, 80, 255))
    for x in (3, 6, 9, 12):
        px(g, x, 15, (255, 122, 36, 255))
    # люк
    rect(g, 6, 10, 9, 11, (50, 50, 58, 255))
    frame(g, 6, 10, 9, 11, (90, 90, 100, 255))
    # объём: блик по центру, тень по краям
    for y in range(5, 12):
        px(g, 3, y, (128, 128, 140, 255))
        px(g, 14, y, (46, 46, 52, 255))
    add_noise(g, (0, 5, 15, 11), [(64, 64, 74, 255), (86, 86, 96, 255)], 0.08)
    return g

import os as _os
_os.makedirs("/home/user/nuclear_addon/NuclearCharge_RP/textures/entity", exist_ok=True)
save(tex_missile(), "/home/user/nuclear_addon/NuclearCharge_RP/textures/entity/missile.png")

save(tex_station_side(False), f"{OUT_B}/launch_station_side.png")
save(tex_station_side(True),  f"{OUT_B}/launch_station_side_loaded.png")
save(tex_station_top(),       f"{OUT_B}/launch_station_top.png")
save(tex_station_bottom(),    f"{OUT_B}/launch_station_bottom.png")


# превью-лист
files = [f"{OUT_B}/nuclear_charge_top.png", f"{OUT_B}/nuclear_charge_side.png",
         f"{OUT_B}/nuclear_charge_bottom.png", f"{OUT_B}/nuclear_charge_side_armed.png",
         f"{OUT_B}/nuclear_charge_top_armed.png", f"{OUT_I}/nuclear_detonator.png",
         f"{OUT_B}/launch_station_side.png", f"{OUT_B}/launch_station_side_loaded.png",
         f"{OUT_B}/launch_station_top.png", f"{OUT_B}/launch_station_bottom.png"]
scale, pad = 10, 8
imgs = [Image.open(f).convert("RGBA").resize((16 * scale, 16 * scale), Image.NEAREST) for f in files]
w = sum(i.width for i in imgs) + pad * (len(imgs) + 1)
h = max(i.height for i in imgs) + pad * 2
sheet = Image.new("RGBA", (w, h), (40, 40, 48, 255))
x = pad
for i in imgs:
    sheet.paste(i, (x, pad), i)
    x += i.width + pad
sheet.save("/home/user/tools/preview_textures.png")
print("preview saved")

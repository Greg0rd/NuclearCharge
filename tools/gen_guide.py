#!/usr/bin/env python3
"""Генерация GUIDE.html — иллюстрированного гайда по аддону Nuclear Charge."""
import base64, io, os
from PIL import Image

ROOT = "/home/user/nuclear_addon"

def b64(path, max_w=None, fmt="PNG", q=82):
    img = Image.open(path).convert("RGBA")
    if max_w and img.width > max_w:
        img = img.resize((max_w, int(img.height * max_w / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    if fmt == "JPEG":
        img = img.convert("RGB"); buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q)
    else:
        img.save(buf, "PNG")
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()

hero = b64(f"{ROOT}/docs_assets/hero.png", 1280, "JPEG", 82)
def tex(n): return b64(f"{ROOT}/NuclearCharge_RP/textures/blocks/{n}.png")
detonator = b64(f"{ROOT}/NuclearCharge_RP/textures/items/nuclear_detonator.png")

html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>☢ Nuclear Charge v1.1 — гайд по аддону</title>
<style>
  :root {{ --bg:#0d0f12; --panel:#161a20; --panel2:#1c222b; --line:#2a323e; --txt:#d7dde6; --dim:#8b96a5;
          --accent:#ffd23f; --red:#ff4b3a; --green:#57d364; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--txt); font:16px/1.65 'Segoe UI',system-ui,sans-serif; }}
  .wrap {{ max-width:980px; margin:0 auto; padding:0 20px 80px; }}
  header {{ position:relative; border-radius:0 0 18px 18px; overflow:hidden; }}
  header img {{ width:100%; display:block; }}
  header .ttl {{ position:absolute; left:0; right:0; bottom:0; padding:28px 34px 22px;
    background:linear-gradient(transparent, rgba(5,6,8,.92)); }}
  h1 {{ margin:0; font-size:clamp(26px,4.5vw,44px); letter-spacing:.5px; color:#fff; }}
  .sub {{ color:var(--accent); font-weight:600; margin-top:4px; }}
  h2 {{ font-size:24px; margin:44px 0 14px; padding-left:14px; border-left:4px solid var(--red); }}
  h3 {{ font-size:18px; margin:26px 0 8px; color:#fff; }}
  .dim {{ color:var(--dim); }}
  .panel {{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 22px; margin:14px 0; }}
  .grid {{ display:grid; gap:14px; }}
  .g2 {{ grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); }}
  .g3 {{ grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); }}
  .card {{ background:var(--panel2); border:1px solid var(--line); border-radius:12px; padding:16px; }}
  .card b {{ color:#fff; }}
  table {{ border-collapse:collapse; width:100%; margin:10px 0; font-size:15px; }}
  th,td {{ border:1px solid var(--line); padding:9px 12px; text-align:left; }}
  th {{ background:var(--panel2); color:var(--accent); }}
  tr:nth-child(even) td {{ background:rgba(255,255,255,.02); }}
  code {{ font-family:Consolas,monospace; background:#0a0c0f; border:1px solid var(--line);
    border-radius:6px; padding:2px 7px; color:#9fe8ff; font-size:14px; }}
  pre {{ background:#0a0c0f; border:1px solid var(--line); border-radius:10px; padding:14px 16px; overflow:auto; }}
  pre code {{ background:none; border:none; padding:0; }}
  .craft {{ display:flex; align-items:center; gap:18px; flex-wrap:wrap; margin:8px 0 4px; }}
  .craft-grid {{ display:grid; grid-template-columns:repeat(3,58px); grid-auto-rows:58px; gap:5px; }}
  .craft-col {{ display:grid; grid-template-columns:58px; grid-auto-rows:58px; gap:5px; }}
  .cell {{ background:#262c36; border:1px solid #39424f; border-radius:8px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; font-size:10px; color:var(--dim); text-align:center; line-height:1.2; padding:2px; }}
  .cell i {{ font-style:normal; font-size:20px; }}
  .arrow {{ font-size:30px; color:var(--dim); }}
  .result .cell {{ width:72px; height:72px; }}
  .texrow {{ display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; justify-content:center; padding:6px 0; }}
  .texrow figure {{ margin:0; text-align:center; }}
  .texrow img {{ image-rendering:pixelated; width:84px; height:84px; background:#20262f; border:1px solid var(--line); border-radius:10px; padding:6px; }}
  .texrow figcaption {{ font-size:12px; color:var(--dim); margin-top:5px; }}
  .timeline {{ position:relative; margin:18px 0 6px; padding-left:34px; }}
  .timeline::before {{ content:''; position:absolute; left:11px; top:6px; bottom:6px; width:3px; background:linear-gradient(var(--red),var(--accent),var(--green)); border-radius:2px; }}
  .step {{ position:relative; margin:0 0 18px; }}
  .step::before {{ content:''; position:absolute; left:-31px; top:5px; width:15px; height:15px; border-radius:50%;
    background:var(--bg); border:3px solid var(--red); }}
  .step b {{ color:#fff; font-size:17px; }}
  .warn {{ background:rgba(255,75,58,.09); border:1px solid rgba(255,75,58,.4); border-radius:12px; padding:14px 18px; margin:14px 0; }}
  .ok {{ background:rgba(87,211,100,.08); border:1px solid rgba(87,211,100,.35); border-radius:12px; padding:14px 18px; margin:14px 0; }}
  .badge {{ display:inline-block; background:var(--panel2); border:1px solid var(--line); color:var(--dim);
    border-radius:20px; padding:2px 12px; font-size:13px; margin:2px 4px 2px 0; }}
  .soundrow {{ display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px dashed var(--line); flex-wrap:wrap; }}
  .soundrow:last-child {{ border-bottom:none; }}
  .speaker {{ font-size:26px; }}
  footer {{ margin-top:60px; padding-top:18px; border-top:1px solid var(--line); color:var(--dim); font-size:14px; }}
  .v11 {{ background:rgba(255,210,63,.07); border:1px solid rgba(255,210,63,.35); border-radius:12px; padding:14px 18px; margin:14px 0; }}
</style>
</head>
<body>
<header>
  <img src="{hero}" alt="Ядерный взрыв в Minecraft">
  <div class="ttl">
    <h1>☢ Nuclear Charge <span style="font-size:.5em;color:var(--accent)">v1.1</span></h1>
    <div class="sub">Взрыв R=100 · таймер · красный камень · пульт · реальная сирена · гейгер · гриб · волна</div>
  </div>
</header>

<div class="wrap">

  <div class="v11">🆕 <b>v1.1 — по итогам игрового теста:</b> гриб крупнее и держится ~60 c · волна медленнее
  со стеной огня и отбрасыванием · исправлен «полукруг D» (чанки грузятся тикающими областями) ·
  детонация срабатывает даже если игрок улетел · реальная сирена и взрыв (свободные лицензии) ·
  щелчки Гейгера · мерцающие точки радиации на экране.</div>

  <h2>📦 Установка</h2>
  <div class="panel">
    <ol>
      <li>Откройте <code>NuclearCharge.mcaddon</code> — паки импортируются автоматически.</li>
      <li>Добавьте <b>Nuclear Charge [BP]</b> и <b>[RP]</b> в настройки мира.</li>
      <li>При первом входе подтвердите разрешение на <b>скрипты</b>.</li>
      <li>Звуки (сирена, взрыв, гейгер) настроятся сами — они в составе RP.</li>
    </ol>
    <span class="badge">Bedrock 1.21.90+</span>
    <span class="badge">Без экспериментов</span>
    <span class="badge">@minecraft/server 2.x</span>
  </div>

  <h2>🧱 Блок и предметы</h2>
  <div class="panel">
    <div class="texrow">
      <figure><img src="{tex('nuclear_charge_side')}" alt="бок"><figcaption>Заряд · бок</figcaption></figure>
      <figure><img src="{tex('nuclear_charge_top')}" alt="верх"><figcaption>Заряд · верх</figcaption></figure>
      <figure><img src="{tex('nuclear_charge_bottom')}" alt="низ"><figcaption>Заряд · низ</figcaption></figure>
      <figure><img src="{tex('nuclear_charge_side_armed')}" alt="бок активир."><figcaption>Активирован · бок</figcaption></figure>
      <figure><img src="{tex('nuclear_charge_top_armed')}" alt="верх активир."><figcaption>Активирован · верх</figcaption></figure>
      <figure><img src="{detonator}" alt="пульт"><figcaption>Пульт подрыва</figcaption></figure>
    </div>
  </div>

  <h2>🛠 Крафт</h2>
  <div class="grid g2">
    <div class="card">
      <h3>Ядерный заряд</h3>
      <div class="craft">
        <div class="craft-grid">
          <div class="cell"><i>⬜</i>железо</div><div class="cell"><i>⬜</i>железо</div><div class="cell"><i>⬜</i>железо</div>
          <div class="cell"><i>🟥</i>красный блок</div><div class="cell"><i>🧨</i>ТНТ</div><div class="cell"><i>🟥</i>красный блок</div>
          <div class="cell"><i>⬜</i>железо</div><div class="cell"><i>⬜</i>железо</div><div class="cell"><i>⬜</i>железо</div>
        </div>
        <div class="arrow">➜</div>
        <div class="result"><div class="cell" style="border-color:#6b5a1e;background:#2d2712"><i>☢</i>заряд</div></div>
      </div>
    </div>
    <div class="card">
      <h3>Пульт подрыва</h3>
      <div class="craft">
        <div class="craft-col">
          <div class="cell"><i>🟧</i>медь</div>
          <div class="cell"><i>🔴</i>красная пыль</div>
          <div class="cell"><i>⬜</i>железо</div>
        </div>
        <div class="arrow">➜</div>
        <div class="result"><div class="cell" style="border-color:#6b5a1e;background:#2d2712"><i>📡</i>пульт</div></div>
      </div>
    </div>
  </div>

  <h2>🎮 Способы активации</h2>
  <table>
    <tr><th>Способ</th><th>Действие</th><th>Таймер</th></tr>
    <tr><td>🔥 Кремень и огниво</td><td>ПКМ по заряду</td><td><b>20 сек</b></td></tr>
    <tr><td>🔴 Красный камень</td><td>сигнал в <b>соседний блок</b>: рычаг, кнопка, плита, пыль, растяжка, редстоун-блок/факел, наблюдатель</td><td><b>10 сек</b></td></tr>
    <tr><td>📡 Пульт подрыва</td><td>ПКМ пультом в руке (до <b>512 блоков</b>, работает даже издалека)</td><td><b>3 сек</b></td></tr>
  </table>
  <div class="panel">
    <b>Обезвреживание:</b> ПКМ рукой по мигающему заряду.<br>
    <b>Цепная реакция:</b> волна детонирует соседние заряды с задержкой.<br>
    <span class="dim">Красный камень срабатывает по «фронту» сигнала; при активации заряд удерживает свой чанк загруженным — таймер идёт даже когда игрок далеко.</span>
  </div>

  <h2>🔊 Звуки (свободные лицензии)</h2>
  <div class="panel">
    <div class="soundrow"><span class="speaker">🚨</span><div><b>Сирена гражданской обороны</b> — реальная запись, играет весь отсчёт (цикл 16 c), слышна до ~190 блоков.<br><span class="dim">«Civil-defense-siren-waver» — Techtonic, Wikimedia Commons, Public Domain.</span></div></div>
    <div class="soundrow"><span class="speaker">💥</span><div><b>Взрыв</b> — многослойный бум 7 c (замедленный взрыв + суб-бас + грохот-хвост), слышен до ~640 блоков.<br><span class="dim">Основа: «Explosion 10» и «Explosion-LS100155», Wikimedia Commons, Public Domain + процедурный слой.</span></div></div>
    <div class="soundrow"><span class="speaker">☑️</span><div><b>Щелчки Гейгера</b> — реальная запись счётчика; частота растёт по мере приближения к эпицентру.<br><span class="dim">«Geiger counter sound (KCl)», Wikimedia Commons, CC BY 3.0.</span></div></div>
  </div>

  <h2>💥 Хронология взрыва</h2>
  <div class="timeline">
    <div class="step"><b>Отсчёт — Сирена и мигание.</b> Реальная сирена ГО, блок мигает с ускорением, писк, отсчёт на экране. Вспышками ходит красная подсветка.</div>
    <div class="step"><b>Т-0 — Вспышка и грохот.</b> Белый экран (дальше = короче), тряска камеры, кастомный взрыв 7 c с раскатами, молнии.</div>
    <div class="step"><b>0–27 c — Ударная волна.</b> Сфера R=100 выжигается кольцами: <b>стена огня и дыма высотой до 20 блоков</b> движется по земле, сносит всё на пути, <b>отбрасывает и трясёт игроков</b> на фронте, грохочет взрывами. Чанки за фронтом удерживаются тикающими областями — воронка всегда полная (не «D»). Дно кратера — магма.</div>
    <div class="step"><b>0–35 c — Ядерный гриб.</b> Мощный ствол из дыма и огня взлетает до ~170 блоков, шляпка из трёх колец расширяется до 55 радиусов взрыва, лавовые искры, пепел, пыль по земле.</div>
    <div class="step"><b>35–60 c — Послесвечение.</b> Гриб висит и клубится, шляпка вспыхивает взрывами частиц, дым медленно оседает.</div>
    <div class="step"><b>После волны — Огненный шторм.</b> 140 очагов огня по площади взрыва.</div>
    <div class="step"><b>10 минут — Радиация.</b> Мерцающие <b>точки на экране</b> (как помехи старого дозиметра) + <b>щелчки Гейгера</b>, учащающиеся к эпицентру: иссушение в ядре, отравление/слабость/голод по краям. Таймер зоны в правом углу шкалы точек.</div>
  </div>

  <h2>⚙️ Настройка (CONFIG в scripts/main.js)</h2>
  <table>
    <tr><th>Параметр</th><th>По умолчанию</th><th>Описание</th></tr>
    <tr><td><code>explosionRadius</code></td><td>100</td><td>радиус разрушения сферы</td></tr>
    <tr><td><code>waveTicksPerStep</code></td><td>4</td><td>скорость волны (больше = медленнее и зрелищнее)</td></tr>
    <tr><td><code>craterDepthFactor</code></td><td>0.5</td><td>глубина кратера (доля радиуса)</td></tr>
    <tr><td><code>flintTimerSeconds</code></td><td>20</td><td>таймер кремня</td></tr>
    <tr><td><code>redstoneTimerSeconds</code></td><td>10</td><td>таймер красного камня</td></tr>
    <tr><td><code>remoteTimerSeconds</code></td><td>3</td><td>таймер пульта</td></tr>
    <tr><td><code>remoteSearchRadius</code></td><td>512</td><td>дальность пульта</td></tr>
    <tr><td><code>radiationSeconds</code></td><td>600</td><td>длительность зоны радиации</td></tr>
    <tr><td><code>mushroomRiseTicks</code></td><td>700</td><td>подъём гриба (35 c)</td></tr>
    <tr><td><code>mushroomLingerTicks</code></td><td>500</td><td>послесвечение шляпки (25 c)</td></tr>
    <tr><td><code>firesCount</code></td><td>140</td><td>очагов огненного шторма</td></tr>
    <tr><td><code>sirenEveryTicks</code></td><td>320</td><td>длина цикла сирены</td></tr>
  </table>

  <h2>🧪 Команды для теста</h2>
  <pre><code>/give @s nuclear:nuclear_charge
/give @s nuclear:nuclear_detonator
/setblock ~ ~ ~ nuclear:nuclear_charge</code></pre>

  <h2>🔧 Как устроено внутри</h2>
  <div class="grid g2">
    <div class="card"><b>Тикающие области.</b> Bedrock разрешает до 10. Одна удерживает чанк заряда (таймер идёт без игрока), 8 «едут» за фронтом волны секторов по 45° — воронка всегда круглая, взрыв доходит до конца даже при улётевшем игроке.</div>
    <div class="card"><b>Волна без лагов.</b> ≤160 колонок за шаг (4 тика), разрушение идёт волнами ~27 c. Фронт отбрасывает игроков и трясёт камеру — волна ощущается физически.</div>
    <div class="card"><b>Радиация на экране.</b> Каждые 2 тика actionbar перерисовывается случайными точками (плотность по дистанции) + индивидуальные щелчки Гейгера игроку с вероятностью по дистанции.</div>
    <div class="card"><b>Звук.</b> Кастомные OGG в RP + sound_definitions: сирена и бум через /playsound с радиусом слышимости, гейгер — напрямую игроку.</div>
  </div>

  <div class="warn">⚠️ Взрыв меняет ~3 млн блоков — тестируйте в копии мира. Слышимость сирены/взрыва зависит от настроек звука клиента.</div>
  <div class="ok">✅ Дымовой тест v1.1: 13/13 — активация, фронт сигнала, обезвреживание, детонация в выгруженном чанке, вращение областей за фронтом, гейгер, спеклы.</div>

  <footer>Nuclear Charge v1.1 · Script API v2 · Звуки: PD/CC BY (Wikimedia Commons), см. раздел «Звуки» · README.md — краткая версия</footer>
</div>
</body>
</html>"""
open(f"{ROOT}/GUIDE.html", "w", encoding="utf-8").write(html)
print("GUIDE.html:", os.path.getsize(f"{ROOT}/GUIDE.html") // 1024, "KB")

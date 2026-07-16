# Focus Peaking

*[Українською нижче ⬇](#focus-peaking-uk)*

A browser-based focus peaking tool for manually focusing cameras/webcams — no app install, just open it in a tab next to your camera feed.

It reads your camera through `getUserMedia`, computes a live sharpness score (Laplacian variance over a downscaled center region of interest), and shows:

- **Sharpness** — current score, smoothed (EMA)
- **Session peak** — highest score seen since start/reset
- **% of peak** — how close the current frame is to that peak, also reflected in the background color (red → orange → yellow → green)
- **Trend** — rising / falling / stable / "near peak"
- **Edge highlighting** — in-focus edges overlaid in green directly on the video, toggleable
- A small on-canvas history sparkline of the last few seconds

Supports multiple connected cameras (pick from a dropdown) and has a UK/EN language switch. It also checks `package.json` on the `main` branch once an hour and shows a banner if a newer version was released.

![Focus Peaking screenshot](./screenshot.png)

## Run locally

```
npm install
npm run dev
```

Open the printed local URL, grant camera access, and pick a camera from the dropdown if you have more than one.

## Updating

When you see the "new version available" banner:

```
git pull
npm install
```

then restart `npm run dev` (or rebuild if you're running a built version). Bump `version` in `package.json` when you push a change worth notifying others about.

---

<a id="focus-peaking-uk"></a>
## Focus Peaking (UA)

Інструмент для перевірки різкості фокусу камери/вебкамери прямо в браузері — без встановлення додатків, просто відкрий у вкладці поруч із зображенням з камери.

Зчитує камеру через `getUserMedia`, рахує показник різкості в реальному часі (дисперсія Лапласіана в зменшеній центральній області кадру) і показує:

- **Різкість** — поточне значення, згладжене (EMA)
- **Пік сесії** — найвище значення з моменту старту/скидання
- **% від піку** — наскільки поточний кадр близький до піку, також відображається кольором фону (червоний → оранжевий → жовтий → зелений)
- **Тренд** — росте / падає / стабільно / «біля піку»
- **Підсвітка країв** — контури у фокусі підсвічуються зеленим прямо на відео, можна вимкнути
- Невеликий графік історії за останні кілька секунд прямо на відео

Підтримує декілька підключених камер (вибір зі списку) і перемикач мови UK/EN. Раз на годину перевіряє `package.json` в гілці `main` і показує банер, якщо вийшла новіша версія.

## Запуск локально

```
npm install
npm run dev
```

Відкрий надруковане локальне посилання, дозволь доступ до камери й обери потрібну камеру зі списку, якщо їх декілька.

## Оновлення

Коли з'явився банер "доступна нова версія":

```
git pull
npm install
```

потім перезапусти `npm run dev` (або перезбери, якщо працюєш зі збіркою). Онови `version` у `package.json`, коли пушиш зміну, про яку варто повідомити інших.

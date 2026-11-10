# itdetiLearn — ученический сайт ITdeti

Чистый HTML + JS, без сборки и фреймворков. Работает с API `den1chis/itdeti` (маршруты `/student/...`).
Все пути относительные, страницы на hash-адресах (`#/courses`): сайт работает и в подпапке
(`https://den1chis.github.io/itdetiLearn/`), и в корне своего домена без переделок.

## Адрес API (выбирается сам, `config.js`)
- сайт открыт с `localhost` / `127.0.0.1` → `http://localhost:8000` (локальный бэкенд);
- любой другой адрес (GitHub Pages, свой домен) → `https://itdeti.onrender.com`;
- переопределение для проверки, только в своём браузере (в консоли):
  `localStorage.setItem('itdeti_learn_api_override', 'http://127.0.0.1:8000')`, убрать — `localStorage.removeItem('itdeti_learn_api_override')`.
  Адрес должен быть в `connect-src` Content-Security-Policy в `index.html`, иначе браузер его заблокирует.

На стороне сервера адрес сайта должен быть в CORS (`CORS_ORIGINS` бэкенда). По умолчанию там уже есть
`https://den1chis.github.io` (покрывает и CRM, и этот сайт) и `localhost:5500/5501`.

## Запуск локально
1. Бэкенд (`itdeti`): `python -m uvicorn main:app --host 0.0.0.0 --port 8000`.
2. В этой папке: `python -m http.server 5500`.
3. Открыть http://localhost:5500. Тестовые ученики — в описании `itdeti/scripts/seed_dev.py` (только dev).

## Публикация на GitHub Pages
1. На GitHub создать **публичный** репозиторий `itdetiLearn` (бесплатный тариф: Pages для публичных репозиториев бесплатны).
2. Отправить код в ветку `main` (команды — в `itdeti/docs/DEPLOY_RUNBOOK.md`, шаг 8).
3. Репозиторий → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, папка `/ (root)` → Save.
4. Через 1–2 минуты сайт доступен по адресу `https://den1chis.github.io/itdetiLearn/`.
Файл `.nojekyll` отключает обработку Jekyll (файлы отдаются как есть).

## Свой домен позже
1. В DNS домена: для поддомена (например `learn.example.kz`) запись `CNAME` → `den1chis.github.io`.
2. В корень репозитория добавить файл `CNAME` с одной строкой — именем домена (или указать домен в Settings → Pages → Custom domain, GitHub создаст файл сам), включить «Enforce HTTPS».
3. В бэкенде добавить домен в `CORS_EXTRA_ORIGINS` (например `https://learn.example.kz`) — на Render, без изменения кода.
Менять адрес API на сайте не нужно: для любого не-локального адреса используется `https://itdeti.onrender.com`.
Если позже сменится адрес сервера — поправить `PROD_API` в `config.js` и `connect-src` в `index.html`.

## Безопасность
CRM и этот сайт на GitHub Pages живут на одном адресе `den1chis.github.io` (одна origin) — хранилище браузера общее.
- Сайт читает и пишет только ключи `itdeti_learn_*` (`itdeti_learn_token`, `itdeti_learn_name`, `itdeti_learn_api_override`); ключи CRM (`itdeti_access_token`, `itdeti_refresh_token`, …) не трогает.
- Данные с сервера выводятся только через `textContent` (без `innerHTML`); ссылки — только `http(s)`, открываются с `rel="noopener noreferrer"`.
- Встраивание материалов — только страницы `docs.google.com` / `drive.google.com`, в `iframe` с `sandbox` и `referrerpolicy="no-referrer"`.
- `Content-Security-Policy` (в `<meta>` в `index.html`): скрипты и стили только свои файлы, запросы — к API, фреймы — Google.
  Ограничение: через `<meta>` нельзя задать `frame-ancestors` (защиту от встраивания этого сайта в чужие страницы) — GitHub Pages не даёт ставить заголовки.
- Токен ученика живёт 2 часа (`STUDENT_TOKEN_EXPIRE_MINUTES` бэкенда), после истечения — снова вход.

## Страницы
`#/login` → `#/courses` (мои курсы) → `#/course/<id>` (модули и уроки с отметками) → `#/lesson/<id>`
(материалы-ссылки, тексты, задания, кнопка «Урок пройден»). Кнопка «Выйти» в шапке.

## Файлы
- `config.js` — выбор адреса API.
- `app.js` — вся логика.
- `style.css` — цвета как в CRM, крупные шрифты и кнопки (дети 8–15 лет, сначала телефон).

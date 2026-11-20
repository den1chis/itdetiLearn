/* ITdeti — ученический сайт. Чистый JS, без фреймворков.
 *
 * Страницы (адрес после #):
 *   #/login            общий вход: логин с «@» — сотрудник (email и пароль CRM), без «@» — ученик
 *   #/courses          мои курсы                                   (ученик)
 *   #/course/<id>      модули и уроки с отметками прогресса        (ученик)
 *   #/lesson/<id>      материалы и задания, кнопка «Урок пройден»  (ученик)
 *   #/staff            начало режима сотрудника: «Мои ученики» (teacher/admin) или каталог (методист)
 *   #/catalog, #/catalog/course/<id>, #/catalog/lesson/<id>   каталог курсов (сотрудник, без записи прогресса)
 *   #/students, #/student/<id>                                ученики и их прогресс (teacher — свои, admin — все)
 *   #handoff=<код>     вход из CRM по одноразовому коду (код сразу убирается из адреса)
 *
 * Все данные с сервера выводятся через textContent (никакого innerHTML с данными).
 */
(function () {
  'use strict';

  var API = ((window.ITDETI_LEARN_CONFIG || {}).API_URL || 'https://itdeti.onrender.com').replace(/\/+$/, '');
  // Свои ключи хранилища: CRM живёт на том же адресе (den1chis.github.io), у неё ключи itdeti_*_token.
  // Сайт читает и пишет только ключи с префиксом itdeti_learn_.
  var KEY_PREFIX = 'itdeti_learn_';
  var TOKEN_KEY = KEY_PREFIX + 'token';
  var NAME_KEY = KEY_PREFIX + 'name';
  // Сессия сотрудника на платформе — свои ключи (не ключи CRM itdeti_*_token и не ключи ученика).
  var STAFF_ACCESS_KEY = KEY_PREFIX + 'staff_access';
  var STAFF_REFRESH_KEY = KEY_PREFIX + 'staff_refresh';
  var STAFF_NAME_KEY = KEY_PREFIX + 'staff_name';
  var STAFF_ROLES_KEY = KEY_PREFIX + 'staff_roles';
  var STAFF_ROLES = ['admin', 'teacher', 'methodist'];
  // Встраивать можно только страницы Google (как и в CSP, frame-src).
  var EMBED_HOSTS = ['docs.google.com', 'drive.google.com'];
  var app = document.getElementById('app');
  var topbar = document.getElementById('topbar');
  var flash = null; // сообщение для следующего экрана (например «время входа истекло»)

  // ------------------------------------------------------------ хранилище (может быть недоступно)
  function store(key, value) {
    if (key.indexOf(KEY_PREFIX) !== 0) return null;  // чужие ключи (CRM) не трогаем никогда
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (_) { return null; }
    return null;
  }

  // ------------------------------------------------------------ DOM-помощник
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;  // через CSSOM: CSP запрещает style-атрибуты
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  function render() {
    app.textContent = '';
    for (var i = 0; i < arguments.length; i++) append(app, arguments[i]);
    window.scrollTo(0, 0);
  }
  function safeUrl(url) {
    try {
      var u = new URL(url);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch (_) { return null; }
  }
  function safeEmbedUrl(url) {
    try {
      var u = new URL(url);
      return (u.protocol === 'https:' && EMBED_HOSTS.indexOf(u.hostname) !== -1) ? u.href : null;
    } catch (_) { return null; }
  }

  // ------------------------------------------------------------ API
  function ApiError(status, code, message, extra) {
    this.status = status; this.code = code; this.message = message; this.extra = extra || {};
  }

  function isStaff() { return !!store(STAFF_ACCESS_KEY); }

  // Один запрос обновления на всех (как в CRM): параллельные 401 ждут один и тот же /auth/refresh.
  var refreshing = null;
  function refreshStaff() {
    if (!refreshing) {
      var token = store(STAFF_REFRESH_KEY);
      refreshing = (token
        ? fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: token }) })
          .then(function (res) {
            if (!res.ok) return false;
            return res.json().then(function (data) {
              if (!isStaff()) return false;  // за это время вышли
              store(STAFF_ACCESS_KEY, data.access_token);
              if (data.refresh_token) store(STAFF_REFRESH_KEY, data.refresh_token);
              return true;
            });
          })
          .catch(function () { return false; })
        : Promise.resolve(false)
      ).then(function (ok) { refreshing = null; return ok; });
    }
    return refreshing;
  }

  function api(path, options) {
    var opts = options || {};
    return rawApi(path, opts).catch(function (err) {
      if (err.status === 401 && !opts.noAuth && !opts.noRetry && isStaff()) {
        return refreshStaff().then(function (ok) {
          if (!ok) throw err;
          opts.noRetry = true;
          return rawApi(path, opts);
        });
      }
      throw err;
    });
  }

  function rawApi(path, opts) {
    var headers = { 'Accept': 'application/json' };
    var token = isStaff() ? store(STAFF_ACCESS_KEY) : store(TOKEN_KEY);
    if (token && !opts.noAuth) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).catch(function () {
      throw new ApiError(0, 'network', 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.');
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
        if (res.ok) return data;
        var d = data && data.detail;
        var code = (d && d.code) || 'error';
        var message = (d && d.message) || (typeof d === 'string' ? d : 'Что-то пошло не так. Попробуй ещё раз.');
        throw new ApiError(res.status, code, message, d && typeof d === 'object' ? d : {});
      });
    });
  }

  // Ошибка на любой странице после входа: 401 -> снова на вход.
  function handleError(err) {
    if (err && err.status === 401 && !(err.code === 'invalid_credentials')) {
      if (isStaff()) { logout('Время входа закончилось. Войдите ещё раз.'); return; }
      logout(err.message && err.message !== 'Войдите заново' ? err.message : 'Время входа закончилось. Войди ещё раз.');
      return;
    }
    if (isStaff()) {
      render(
        h('div', { class: 'alert alert-error', text: err && err.status === 403 ? 'Нет доступа к этому разделу.' : ((err && err.message) || 'Ошибка') }),
        h('a', { class: 'btn', href: '#/staff', text: 'На главную' })
      );
      return;
    }
    render(
      h('div', { class: 'alert alert-error', text: (err && err.message) || 'Ошибка' }),
      h('a', { class: 'btn', href: '#/courses', text: 'К моим курсам' })
    );
  }

  function clearStudent() { store(TOKEN_KEY, null); store(NAME_KEY, null); }
  function clearStaff() {
    store(STAFF_ACCESS_KEY, null); store(STAFF_REFRESH_KEY, null);
    store(STAFF_NAME_KEY, null); store(STAFF_ROLES_KEY, null);
  }

  // Отзыв refresh-токена сотрудника на сервере (выход, вход учеником поверх сессии сотрудника).
  function revokeStaff() {
    var refresh = store(STAFF_REFRESH_KEY);
    if (refresh) {
      fetch(API + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) })
        .catch(function () { /* токен истечёт сам */ });
    }
    clearStaff();
  }

  function logout(message) {
    // Выход чистит только ключи платформы (itdeti_learn_*). Сессия CRM на этом же адресе не затрагивается.
    revokeStaff();
    clearStudent();
    flash = message || null;
    if (location.hash !== '#/login') location.hash = '#/login'; else route();
  }

  // ------------------------------------------------------------ подписи
  var STATUS_TEXT = { done: 'Пройден ✓', in_progress: 'Начат', not_started: '' };
  var TASK_KIND = { code: 'Задача с кодом', practice: 'Практика' };

  function minutesWord(n) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'минуту';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'минуты';
    return 'минут';
  }

  // ------------------------------------------------------------ экран: вход
  var WAKE_HINT_MS = 3000;
  var WAKING_TEXT = 'Сервер просыпается, это может занять до минуты…';

  function showLogin() {
    topbar.hidden = true;
    var errorBox = h('div', { role: 'alert' });
    if (flash) { errorBox.className = 'alert alert-warning'; errorBox.textContent = flash; flash = null; }
    var loginInput = h('input', { id: 'login', name: 'login', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: '254' });
    var passInput = h('input', { id: 'password', name: 'password', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true, maxlength: '72' });
    // Сотрудник (логин с «@») вводит пароль CRM — обычная клавиатура; ученику — цифровая.
    loginInput.addEventListener('input', function () {
      if (loginInput.value.indexOf('@') !== -1) passInput.removeAttribute('inputmode');
      else passInput.setAttribute('inputmode', 'numeric');
    });
    var button = h('button', { class: 'btn btn-primary btn-big', type: 'submit', text: 'Войти' });

    var form = h('form', { class: 'login-card', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var login = loginInput.value.trim();
      var staff = login.indexOf('@') !== -1;
      // Пароль сотрудника передаётся как есть (как в CRM); у ученика пробелы по краям убираются, как раньше.
      var password = staff ? passInput.value : passInput.value.trim();
      if (!login || !password) {
        showError('Введи логин и пароль.');
        return;
      }
      if (button.disabled) return;  // запрос уже идёт: пароль второй раз не отправляется
      button.disabled = true; button.textContent = 'Входим…';
      // Бесплатный сервер засыпает без запросов и просыпается до минуты: если ответа нет дольше 3 секунд,
      // говорим об этом. Запрос остаётся тем же самым (без повторной отправки пароля).
      var wakeTimer = setTimeout(function () {
        wakeTimer = null;
        errorBox.className = 'alert alert-warning';
        errorBox.textContent = WAKING_TEXT;
      }, WAKE_HINT_MS);
      function stopWaiting() {
        if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
        if (errorBox.textContent === WAKING_TEXT) { errorBox.className = ''; errorBox.textContent = ''; }
      }
      var request = staff
        ? staffLogin(login, password)
        : api('/student/auth/login', { method: 'POST', body: { login: login, password: password }, noAuth: true })
          .then(function (data) {
            revokeStaff();
            store(TOKEN_KEY, data.access_token);
            store(NAME_KEY, data.full_name || '');
            location.hash = '#/courses';
          });
      request
        .then(function () { stopWaiting(); })
        .catch(function (err) {
          stopWaiting();
          if (staff) {
            showError(staffLoginError(err));
            if (err.status === 401) { passInput.value = ''; passInput.focus(); }
          } else if (err.code === 'locked') {
            var n = err.extra.retry_after_minutes || 15;
            showError('Вход заблокирован на ' + n + ' ' + minutesWord(n) + ': было много неверных паролей. Подожди и попробуй снова.');
          } else if (err.code === 'invalid_credentials') {
            showError('Неверный логин или пароль. Проверь и попробуй ещё раз.');
            passInput.value = '';
            passInput.focus();
          } else {
            showError(err.message);
          }
        })
        .then(function () { button.disabled = false; button.textContent = 'Войти'; });
    } },
      h('div', { class: 'login-logo' }, h('img', { class: 'logo-mark', src: 'logo-64.png?v=2026112101', srcset: 'logo-64.png?v=2026112101 1x, logo-128.png?v=2026112101 2x', width: '40', height: '40', alt: '' }), 'ITdeti'),
      h('div', { class: 'login-sub', text: 'Вход для учеников и преподавателей' }),
      errorBox,
      h('label', { class: 'field', for: 'login' }, h('span', { text: 'Логин' }), loginInput),
      h('label', { class: 'field', for: 'password' }, h('span', { text: 'Пароль' }), passInput),
      button,
      h('p', { class: 'muted', style: 'text-align:center;font-size:15px;margin:16px 0 0', text: 'Логин и пароль выдаёт преподаватель. Сотрудники входят по email и паролю CRM.' })
    );

    function showError(message) {
      errorBox.className = 'alert alert-error';
      errorBox.textContent = message;
    }

    render(form);
    loginInput.focus();
  }

  // ------------------------------------------------------------ экран: мои курсы
  function showCourses() {
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/student/courses').then(function (courses) {
      var list = (courses || []).map(function (c) {
        var pct = c.lessons_total ? Math.round(100 * c.lessons_done / c.lessons_total) : 0;
        return h('a', { class: 'card', href: '#/course/' + encodeURIComponent(c.id) },
          h('p', { class: 'card-title', text: c.title }),
          c.description ? h('div', { class: 'muted', text: c.description }) : null,
          h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
            h('i', { style: 'width:' + pct + '%' })),
          h('div', { class: 'muted', text: 'Пройдено уроков: ' + c.lessons_done + ' из ' + c.lessons_total })
        );
      });
      render(
        h('h1', { text: 'Мои курсы' }),
        list.length ? list : h('div', { class: 'empty', text: 'Тебе пока не назначили курс. Спроси преподавателя.' })
      );
    }).catch(handleError);
  }

  // ------------------------------------------------------------ экран: курс
  function showCourse(id) {
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/student/courses/' + encodeURIComponent(id)).then(function (course) {
      var n = 0;
      var modules = (course.modules || []).map(function (m) {
        return h('section', { class: 'module' },
          h('h2', { class: 'module-title', text: m.title }),
          (m.lessons || []).map(function (l) {
            n += 1;
            return h('a', { class: 'lesson-row ' + l.status, href: '#/lesson/' + encodeURIComponent(l.id) },
              h('span', { class: 'num', text: l.status === 'done' ? '✓' : String(n) }),
              h('span', { class: 'name', text: l.title }),
              STATUS_TEXT[l.status] ? h('span', { class: 'tag', text: STATUS_TEXT[l.status] }) : null
            );
          })
        );
      });
      var pct = course.lessons_total ? Math.round(100 * course.lessons_done / course.lessons_total) : 0;
      render(
        h('a', { class: 'back', href: '#/courses', text: '← Мои курсы' }),
        h('h1', { text: course.title }),
        h('div', { class: 'progress' }, h('i', { style: 'width:' + pct + '%' })),
        h('div', { class: 'muted', style: 'margin-bottom:18px', text: 'Пройдено уроков: ' + course.lessons_done + ' из ' + course.lessons_total }),
        modules.length ? modules : h('div', { class: 'empty', style: 'margin-top:16px', text: 'В курсе пока нет уроков.' })
      );
    }).catch(handleError);
  }

  // ------------------------------------------------------------ экран: урок
  function materialView(m) {
    if (m.kind === 'text') {
      return h('div', { class: 'material' },
        h('p', { class: 'material-title', text: m.title }),
        h('p', { class: 'material-text', text: m.body || '' }));
    }
    var url = safeUrl(m.url);
    var embed = safeEmbedUrl(m.embed_url);
    var frameBox = h('div');
    var actions = h('div', { class: 'material-actions' },
      url ? h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Открыть ↗' }) : null,
      embed ? h('button', { class: 'btn', type: 'button', text: 'Показать здесь', onclick: function (e) {
        if (frameBox.firstChild) { frameBox.textContent = ''; e.target.textContent = 'Показать здесь'; return; }
        frameBox.appendChild(h('div', { class: 'embed' }, h('iframe', {
          src: embed, allow: 'fullscreen', loading: 'lazy', title: m.title,
          referrerpolicy: 'no-referrer',
          // Страница Google работает (скрипты, свой origin, «открыть в новой вкладке»), но не может
          // управлять нашей вкладкой (нет allow-top-navigation) и не видит наш origin.
          sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation'
        })));
        e.target.textContent = 'Скрыть';
      } }) : null
    );
    return h('div', { class: 'material' }, h('p', { class: 'material-title', text: m.title }), actions, frameBox);
  }

  function taskView(t, index) {
    return h('div', { class: 'task' },
      h('span', { class: 'task-kind', text: TASK_KIND[t.kind] || 'Задание' }),
      h('p', { class: 'task-title', text: (index + 1) + '. ' + t.title }),
      t.statement ? h('p', { class: 'task-statement', text: t.statement }) : null,
      t.starter_code ? h('pre', { class: 'code' }, h('code', { text: t.starter_code })) : null,
      t.hint ? h('details', { class: 'hint' }, h('summary', { text: 'Подсказка' }), h('p', { text: t.hint })) : null
    );
  }

  function showLesson(id) {
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/student/lessons/' + encodeURIComponent(id)).then(function (lesson) {
      // Открыл урок впервые -> «начат». Пройденный урок так и остаётся пройденным.
      if (lesson.status === 'not_started') {
        api('/student/lessons/' + encodeURIComponent(lesson.id) + '/progress', { method: 'POST', body: { status: 'in_progress' } })
          .then(function () {
            if (lesson.status !== 'not_started') return; // уже успели нажать «Урок пройден»
            lesson.status = 'in_progress'; pill.className = 'status-pill in_progress'; pill.textContent = 'Начат';
          })
          .catch(function () { /* не мешаем смотреть урок */ });
      }

      var pill = h('span', { class: 'status-pill ' + lesson.status, text: STATUS_TEXT[lesson.status] || 'Новый урок' });
      var finishBox = h('div', { class: 'finish' });

      function nextButtons() {
        return h('div', { class: 'nav-row' },
          lesson.next_lesson_id
            ? h('a', { class: 'btn btn-primary btn-big', href: '#/lesson/' + encodeURIComponent(lesson.next_lesson_id), text: 'Следующий урок →' })
            : h('a', { class: 'btn btn-big', href: '#/course/' + encodeURIComponent(lesson.course_id), text: 'К списку уроков' })
        );
      }

      function drawFinish() {
        finishBox.textContent = '';
        if (lesson.status === 'done') {
          append(finishBox, [h('div', { class: 'done-box', text: 'Урок пройден! Молодец! 🎉' }), nextButtons()]);
          return;
        }
        var err = h('div');
        var btn = h('button', { class: 'btn btn-success btn-big', type: 'button', text: '✓ Урок пройден', onclick: function () {
          btn.disabled = true; btn.textContent = 'Сохраняем…';
          api('/student/lessons/' + encodeURIComponent(lesson.id) + '/progress', { method: 'POST', body: { status: 'done' } })
            .then(function () {
              lesson.status = 'done';
              pill.className = 'status-pill done'; pill.textContent = STATUS_TEXT.done;
              drawFinish();
            })
            .catch(function (e) {
              if (e.status === 401) { handleError(e); return; }
              err.className = 'alert alert-error'; err.textContent = e.message;
              btn.disabled = false; btn.textContent = '✓ Урок пройден';
            });
        } });
        append(finishBox, [err, btn]);
      }
      drawFinish();

      render(
        h('a', { class: 'back', href: '#/course/' + encodeURIComponent(lesson.course_id), text: '← ' + lesson.course_title }),
        h('div', { class: 'crumbs', text: lesson.module_title }),
        h('h1', { text: lesson.title }),
        pill,
        lesson.description ? h('p', { class: 'material-text', style: 'margin-top:12px', text: lesson.description }) : null,
        (lesson.materials || []).length ? [h('h2', { text: 'Материалы' }), lesson.materials.map(materialView)] : null,
        (lesson.tasks || []).length ? [h('h2', { text: 'Задания' }), lesson.tasks.map(taskView)] : null,
        !(lesson.materials || []).length && !(lesson.tasks || []).length
          ? h('div', { class: 'empty', style: 'margin-top:16px', text: 'К этому уроку пока ничего не добавили.' }) : null,
        finishBox,
        lesson.prev_lesson_id
          ? h('div', { class: 'nav-row' }, h('a', { class: 'btn', href: '#/lesson/' + encodeURIComponent(lesson.prev_lesson_id), text: '← Предыдущий урок' }))
          : null
      );
    }).catch(handleError);
  }

  // ------------------------------------------------------------ сотрудник: вход, роли, одноразовый код из CRM
  function staffRoles() {
    try { return JSON.parse(store(STAFF_ROLES_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function canSeeStudents() {
    var roles = staffRoles();
    return roles.indexOf('admin') !== -1 || roles.indexOf('teacher') !== -1;
  }

  // Новая пара токенов сотрудника -> проверка ролей (/auth/me) -> сохранение. Без роли admin/teacher/methodist — отказ.
  function startStaffSession(tokens) {
    clearStudent();
    revokeStaff();
    store(STAFF_ACCESS_KEY, tokens.access_token);
    store(STAFF_REFRESH_KEY, tokens.refresh_token);
    return api('/auth/me').then(function (me) {
      var roles = (me && Array.isArray(me.roles) ? me.roles : []).filter(function (r) { return STAFF_ROLES.indexOf(r) !== -1; });
      if (!roles.length) throw new ApiError(403, 'no_role', '');
      store(STAFF_NAME_KEY, me.full_name || '');
      store(STAFF_ROLES_KEY, JSON.stringify(roles));
      return roles;
    }).catch(function (err) {
      var refresh = store(STAFF_REFRESH_KEY);
      clearStaff();
      if (refresh) {
        fetch(API + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) })
          .catch(function () { /* истечёт сам */ });
      }
      if (err.status === 403) throw new ApiError(403, 'no_role', 'У этой учётной записи нет доступа к платформе обучения.');
      throw err;
    });
  }

  // Тот же серверный вход, что у CRM (/auth/login): блокировка 5 попыток / 15 минут общая с CRM.
  function staffLogin(email, password) {
    return api('/auth/login', { method: 'POST', body: { email: email, password: password }, noAuth: true })
      .then(startStaffSession)
      .then(function () { location.hash = '#/staff'; });
  }

  function staffLoginError(err) {
    if (err.status === 401 || err.status === 422) return 'Неверный email или пароль.';
    if (err.status === 429) return err.message || 'Слишком много попыток входа. Попробуйте позже.';
    return err.message || 'Не удалось войти.';
  }

  // #handoff=<код> из CRM: код сразу убирается из адреса (и из истории), затем обменивается на НОВУЮ пару токенов.
  function takeHandoffCode() {
    var hash = location.hash || '';
    if (hash.indexOf('#handoff=') !== 0) return null;
    var code = hash.slice('#handoff='.length);
    try { history.replaceState(null, '', location.pathname + location.search + '#/staff'); } catch (_) { location.hash = '#/staff'; }
    return code;
  }

  function targetHash(target) {
    var m = /^student:([0-9a-f-]{36})$/.exec(target || '');
    if (m && canSeeStudents()) return '#/student/' + m[1];
    if (target === 'catalog') return '#/catalog';
    return '#/staff';
  }

  function redeemHandoff(code) {
    topbar.hidden = true;
    render(h('p', { class: 'loading', text: 'Входим…' }));
    api('/auth/handoff/redeem', { method: 'POST', body: { code: code }, noAuth: true })
      .then(function (data) {
        return startStaffSession(data).then(function () { return data.target; });
      })
      .then(function (target) {
        var next = targetHash(target);
        if (location.hash === next) route(); else location.hash = next;
      })
      .catch(function (err) {
        clearStaff();
        flash = err.status === 429
          ? (err.message || 'Слишком много попыток. Подождите минуту.')
          : 'Ссылка для входа недействительна или устарела. Войдите email и паролем CRM.';
        if (location.hash !== '#/login') location.hash = '#/login'; else route();
      });
  }

  // ------------------------------------------------------------ сотрудник: меню
  function staffTopbar() {
    var name = store(STAFF_NAME_KEY) || '';
    document.getElementById('hello').textContent = name ? name.split(' ')[0] : '';
    var brand = topbar.querySelector('.brand');
    if (brand) brand.setAttribute('href', '#/staff');
    var nav = document.getElementById('staffNav');
    if (!nav) {
      nav = h('span', { id: 'staffNav' });
      topbar.insertBefore(nav, document.getElementById('hello'));
    }
    nav.textContent = '';
    append(nav, [
      canSeeStudents() ? h('a', { class: 'btn btn-ghost', href: '#/students', text: 'Мои ученики' }) : null,
      h('a', { class: 'btn btn-ghost', href: '#/catalog', text: 'Курсы' })
    ]);
  }
  function studentTopbar() {
    var nav = document.getElementById('staffNav');
    if (nav) nav.parentNode.removeChild(nav);
    var brand = topbar.querySelector('.brand');
    if (brand) brand.setAttribute('href', '#/courses');
    document.getElementById('hello').textContent = store(NAME_KEY) ? 'Привет, ' + store(NAME_KEY).split(' ')[0] + '!' : '';
  }

  function staffNotice() {
    return h('div', { class: 'alert alert-warning', text: 'Режим сотрудника: просмотр глазами ученика, прогресс не записывается.' });
  }

  // ------------------------------------------------------------ сотрудник: каталог
  function showCatalog() {
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/lms/courses').then(function (courses) {
      var list = (courses || []).map(function (c) {
        return h('a', { class: 'card', href: '#/catalog/course/' + encodeURIComponent(c.id) },
          h('p', { class: 'card-title', text: c.title }),
          c.description ? h('div', { class: 'muted', text: c.description }) : null,
          h('div', { class: 'muted', text: 'Модулей: ' + (c.modules_count || 0) + ', уроков: ' + (c.lessons_count || 0) })
        );
      });
      render(
        h('h1', { text: 'Курсы' }),
        list.length ? list : h('div', { class: 'empty', text: 'Курсов пока нет.' })
      );
    }).catch(handleError);
  }

  function showCatalogCourse(id) {
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/lms/courses/' + encodeURIComponent(id)).then(function (course) {
      var n = 0;
      var modules = (course.modules || []).map(function (m) {
        return h('section', { class: 'module' },
          h('h2', { class: 'module-title', text: m.title }),
          (m.lessons || []).map(function (l) {
            n += 1;
            var extra = [];
            if (l.materials_count) extra.push('материалов: ' + l.materials_count);
            if (l.tasks_count) extra.push('заданий: ' + l.tasks_count);
            return h('a', { class: 'lesson-row', href: '#/catalog/lesson/' + encodeURIComponent(l.id) },
              h('span', { class: 'num', text: String(n) }),
              h('span', { class: 'name', text: l.title }),
              extra.length ? h('span', { class: 'tag', text: extra.join(', ') }) : null
            );
          })
        );
      });
      render(
        h('a', { class: 'back', href: '#/catalog', text: '← Курсы' }),
        h('h1', { text: course.title }),
        course.description ? h('p', { class: 'muted', text: course.description }) : null,
        modules.length ? modules : h('div', { class: 'empty', style: 'margin-top:16px', text: 'В курсе пока нет уроков.' })
      );
    }).catch(handleError);
  }

  // Урок глазами ученика, но без «Урок пройден» и без записи прогресса (сервер и так не примет токен сотрудника).
  function showCatalogLesson(id) {
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/lms/lessons/' + encodeURIComponent(id)).then(function (lesson) {
      return api('/lms/courses/' + encodeURIComponent(lesson.course_id)).catch(function () { return null; }).then(function (course) {
        var ordered = [];
        ((course && course.modules) || []).forEach(function (m) { (m.lessons || []).forEach(function (l) { ordered.push(l.id); }); });
        var index = ordered.indexOf(lesson.id);
        var prev = index > 0 ? ordered[index - 1] : null;
        var next = index !== -1 && index + 1 < ordered.length ? ordered[index + 1] : null;
        render(
          h('a', { class: 'back', href: '#/catalog/course/' + encodeURIComponent(lesson.course_id), text: '← ' + lesson.course_title }),
          staffNotice(),
          h('div', { class: 'crumbs', text: lesson.module_title }),
          h('h1', { text: lesson.title }),
          lesson.description ? h('p', { class: 'material-text', style: 'margin-top:12px', text: lesson.description }) : null,
          (lesson.materials || []).length ? [h('h2', { text: 'Материалы' }), lesson.materials.map(materialView)] : null,
          (lesson.tasks || []).length ? [h('h2', { text: 'Задания' }), lesson.tasks.map(taskView)] : null,
          !(lesson.materials || []).length && !(lesson.tasks || []).length
            ? h('div', { class: 'empty', style: 'margin-top:16px', text: 'К этому уроку пока ничего не добавили.' }) : null,
          h('div', { class: 'nav-row' },
            prev ? h('a', { class: 'btn', href: '#/catalog/lesson/' + encodeURIComponent(prev), text: '← Предыдущий урок' }) : null,
            next ? h('a', { class: 'btn btn-primary', href: '#/catalog/lesson/' + encodeURIComponent(next), text: 'Следующий урок →' }) : null
          )
        );
      });
    }).catch(handleError);
  }

  // ------------------------------------------------------------ сотрудник: мои ученики (только чтение)
  function courseLine(c) {
    return c.title + ' — пройдено ' + c.lessons_done + ' из ' + c.lessons_total;
  }

  function showStaffStudents() {
    if (!canSeeStudents()) { location.hash = '#/catalog'; return; }
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/teacher/learning/students').then(function (students) {
      var list = (students || []).map(function (st) {
        var c = (st.courses || [])[0];
        var pct = c && c.lessons_total ? Math.round(100 * c.lessons_done / c.lessons_total) : 0;
        return h('a', { class: 'card', href: '#/student/' + encodeURIComponent(st.id) },
          h('p', { class: 'card-title', text: st.full_name }),
          (st.courses || []).length
            ? (st.courses || []).map(function (course) { return h('div', { class: 'muted', text: courseLine(course) }); })
            : h('div', { class: 'muted', text: 'Курс не назначен' }),
          c ? h('div', { class: 'progress' }, h('i', { style: 'width:' + pct + '%' })) : null
        );
      });
      render(
        h('h1', { text: staffRoles().indexOf('admin') !== -1 ? 'Ученики' : 'Мои ученики' }),
        list.length ? list : h('div', { class: 'empty', text: 'Учеников пока нет.' })
      );
    }).catch(handleError);
  }

  function showStaffStudent(id) {
    if (!canSeeStudents()) { location.hash = '#/catalog'; return; }
    render(h('p', { class: 'loading', text: 'Загрузка…' }));
    api('/teacher/learning/students/' + encodeURIComponent(id)).then(function (st) {
      var blocks = (st.courses || []).map(function (c) {
        var pct = c.lessons_total ? Math.round(100 * c.lessons_done / c.lessons_total) : 0;
        var n = 0;
        return h('section', { class: 'module' },
          h('h2', { text: c.title }),
          h('div', { class: 'progress' }, h('i', { style: 'width:' + pct + '%' })),
          h('div', { class: 'muted', style: 'margin-bottom:12px', text: 'Пройдено уроков: ' + c.lessons_done + ' из ' + c.lessons_total }),
          (c.modules || []).map(function (m) {
            return h('div', null,
              h('p', { class: 'module-title', text: m.title }),
              (m.lessons || []).map(function (l) {
                n += 1;
                return h('a', { class: 'lesson-row ' + l.status, href: '#/catalog/lesson/' + encodeURIComponent(l.id) },
                  h('span', { class: 'num', text: l.status === 'done' ? '✓' : String(n) }),
                  h('span', { class: 'name', text: l.title }),
                  STATUS_TEXT[l.status] ? h('span', { class: 'tag', text: STATUS_TEXT[l.status] }) : null
                );
              })
            );
          })
        );
      });
      render(
        h('a', { class: 'back', href: '#/students', text: '← Ученики' }),
        h('h1', { text: st.full_name }),
        blocks.length ? blocks : h('div', { class: 'empty', text: 'Курс не назначен.' })
      );
    }).catch(handleError);
  }

  function staffRoute(hash) {
    staffTopbar();
    var m;
    if ((m = hash.match(/^#\/catalog\/course\/([\w-]+)$/))) showCatalogCourse(decodeURIComponent(m[1]));
    else if ((m = hash.match(/^#\/catalog\/lesson\/([\w-]+)$/))) showCatalogLesson(decodeURIComponent(m[1]));
    else if ((m = hash.match(/^#\/student\/([\w-]+)$/))) showStaffStudent(decodeURIComponent(m[1]));
    else if (hash === '#/catalog') showCatalog();
    else if (hash === '#/students') showStaffStudents();
    else if (hash === '#/staff') { if (canSeeStudents()) showStaffStudents(); else showCatalog(); }
    else location.hash = '#/staff';
  }

  // ------------------------------------------------------------ маршруты
  function route() {
    var hash = location.hash || '';
    var code = takeHandoffCode();
    if (code !== null) { redeemHandoff(code); return; }
    if (isStaff()) {
      if (hash === '#/login') { showLogin(); return; }
      topbar.hidden = false;
      staffRoute(location.hash || '');
      return;
    }
    var token = store(TOKEN_KEY);
    if (!token) {
      if (hash !== '#/login') { location.hash = '#/login'; return; }
      showLogin();
      return;
    }
    topbar.hidden = false;
    studentTopbar();

    var m;
    if ((m = hash.match(/^#\/course\/([\w-]+)$/))) showCourse(decodeURIComponent(m[1]));
    else if ((m = hash.match(/^#\/lesson\/([\w-]+)$/))) showLesson(decodeURIComponent(m[1]));
    else if (hash === '#/courses') showCourses();
    else location.hash = '#/courses';
  }

  document.getElementById('logoutBtn').addEventListener('click', function () { logout(); });
  window.addEventListener('hashchange', route);
  route();
})();

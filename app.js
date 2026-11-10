/* ITdeti — ученический сайт. Чистый JS, без фреймворков.
 *
 * Страницы (адрес после #):
 *   #/login            вход
 *   #/courses          мои курсы
 *   #/course/<id>      модули и уроки с отметками прогресса
 *   #/lesson/<id>      материалы и задания, кнопка «Урок пройден»
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

  function api(path, options) {
    var opts = options || {};
    var headers = { 'Accept': 'application/json' };
    var token = store(TOKEN_KEY);
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
      logout(err.message && err.message !== 'Войдите заново' ? err.message : 'Время входа закончилось. Войди ещё раз.');
      return;
    }
    render(
      h('div', { class: 'alert alert-error', text: (err && err.message) || 'Ошибка' }),
      h('a', { class: 'btn', href: '#/courses', text: 'К моим курсам' })
    );
  }

  function logout(message) {
    store(TOKEN_KEY, null);
    store(NAME_KEY, null);
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
  function showLogin() {
    topbar.hidden = true;
    var errorBox = h('div', { role: 'alert' });
    if (flash) { errorBox.className = 'alert alert-warning'; errorBox.textContent = flash; flash = null; }
    var loginInput = h('input', { id: 'login', name: 'login', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: '32' });
    var passInput = h('input', { id: 'password', name: 'password', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true, maxlength: '32' });
    var button = h('button', { class: 'btn btn-primary btn-big', type: 'submit', text: 'Войти' });

    var form = h('form', { class: 'login-card', novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var login = loginInput.value.trim();
      var password = passInput.value.trim();
      if (!login || !password) {
        showError('Введи логин и пароль.');
        return;
      }
      button.disabled = true; button.textContent = 'Входим…';
      api('/student/auth/login', { method: 'POST', body: { login: login, password: password }, noAuth: true })
        .then(function (data) {
          store(TOKEN_KEY, data.access_token);
          store(NAME_KEY, data.full_name || '');
          location.hash = '#/courses';
        })
        .catch(function (err) {
          if (err.code === 'locked') {
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
      h('div', { class: 'login-logo', text: 'ITdeti' }),
      h('div', { class: 'login-sub', text: 'Вход для учеников' }),
      errorBox,
      h('label', { class: 'field', for: 'login' }, h('span', { text: 'Логин' }), loginInput),
      h('label', { class: 'field', for: 'password' }, h('span', { text: 'Пароль' }), passInput),
      button,
      h('p', { class: 'muted', style: 'text-align:center;font-size:15px;margin:16px 0 0', text: 'Логин и пароль выдаёт преподаватель.' })
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

  // ------------------------------------------------------------ маршруты
  function route() {
    var hash = location.hash || '';
    var token = store(TOKEN_KEY);
    if (!token) {
      if (hash !== '#/login') { location.hash = '#/login'; return; }
      showLogin();
      return;
    }
    topbar.hidden = false;
    document.getElementById('hello').textContent = store(NAME_KEY) ? 'Привет, ' + store(NAME_KEY).split(' ')[0] + '!' : '';

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

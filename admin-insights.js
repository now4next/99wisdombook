/**
 * 관리자 페이지의 칼럼(인사이트) 관리.
 *
 * API: /api/admin/insights (GET/POST), /api/admin/insights/:id (PUT/DELETE)
 * 모두 관리자 세션이 필요하다. 서버는 출처 1개 이상 + quotable + 본문 200자를
 * 만족하지 않으면 발행을 거부하고 blockers 를 돌려준다.
 *
 * ⚠ 목록 API(/api/admin/insights)는 본문과 출처를 빼고 내려준다(가벼운 조회).
 *    편집할 때는 /api/insights/:slug 로 상세를 다시 받아야 한다.
 */
(function () {
  'use strict';

  var LENSES = [
    ['origin', '유래'], ['science', '과학'], ['history', '역사'], ['person', '인물'],
    ['business', '비즈니스'], ['daily', '일상'], ['counter', '반론'], ['eastwest', '동서'],
    ['practice', '실천'], ['reflection', '성찰']
  ];
  var LENS_KO = {};
  LENSES.forEach(function (l) { LENS_KO[l[0]] = l[1]; });

  // 기존 99편은 공백 제외 573~752자에 맞춰 놓았다. 새 글도 같은 범위를 쓴다.
  var MIN_CHARS = 573, MAX_CHARS = 752;

  var all = [];
  var editing = null;

  function chars(t) {
    return (t || '').replace(/[#>*|]/g, '').replace(/\s+/g, '').length;
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function el(id) { return document.getElementById(id); }

  function token() {
    return (window.wisdomAPI && window.wisdomAPI.token) ||
      localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
  }

  function authHeaders(json) {
    var h = { Authorization: 'Bearer ' + token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function load() {
    var body = el('ins-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="state">로딩 중...</td></tr>';
    try {
      var res = await fetch('/api/admin/insights', { headers: authHeaders(false) });
      if (res.status === 401) {
        body.innerHTML = '<tr><td colspan="7" class="state err">' +
          '관리자 권한이 필요합니다. 로그아웃 후 다시 로그인해 주세요.</td></tr>';
        return;
      }
      var data = await res.json();
      all = (data.items || []).slice().sort(function (a, b) { return a.chapter_id - b.chapter_id; });

      var sel = el('ins-lens');
      if (sel && sel.options.length <= 1) {
        LENSES.forEach(function (l) {
          var o = document.createElement('option');
          o.value = l[0];
          o.textContent = l[1];
          sel.appendChild(o);
        });
      }
      render();
    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="state err">' +
        '불러오지 못했습니다: ' + esc(e.message) + '</td></tr>';
    }
  }

  function render() {
    var q = ((el('ins-search') || {}).value || '').trim().toLowerCase();
    var lens = (el('ins-lens') || {}).value || '';

    var rows = all.filter(function (i) {
      if (lens && i.lens !== lens) return false;
      if (!q) return true;
      return [i.title, i.anchor_quote, i.slug, i.quotable].some(function (v) {
        return (v || '').toLowerCase().indexOf(q) !== -1;
      });
    });

    el('ins-count').textContent = rows.length === all.length
      ? '· 총 ' + all.length + '편'
      : '· ' + rows.length + ' / ' + all.length + '편';

    var body = el('ins-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="state">해당하는 칼럼이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(function (i) {
      return '<tr>' +
        '<td class="num" style="color:var(--ink);font-weight:600;">' + i.chapter_id + '</td>' +
        '<td class="num">' + i.part_id + '부</td>' +
        '<td><span class="badge">' + esc(LENS_KO[i.lens] || i.lens) + '</span></td>' +
        '<td><a href="/insight/' + encodeURIComponent(i.slug) + '" target="_blank" rel="noopener" style="color:var(--ink);font-weight:500;">' +
          esc(i.title) + '</a><br>' +
          '<span style="color:var(--muted-2);font-size:11.5px;font-family:var(--mono);">' + esc(i.slug) + '</span></td>' +
        '<td class="dim">' + esc(i.quotable || '') + '</td>' +
        '<td class="num">' + (i.reading_time || '-') + '분</td>' +
        '<td><button class="btn btn-edit" data-ins-edit="' + i.id + '">편집</button> ' +
          '<button class="btn btn-delete" data-ins-del="' + i.id + '">삭제</button></td>' +
        '</tr>';
    }).join('');
  }

  async function openModal(id) {
    var row = all.filter(function (i) { return i.id === id; })[0];
    if (!row) return;

    editing = null;
    el('ins-form-msg').style.display = 'none';

    var full = row;
    try {
      var res = await fetch('/api/insights/' + encodeURIComponent(row.slug));
      var d = await res.json();
      if (d && d.insight) full = d.insight;
    } catch (_) {}
    editing = full;

    el('ins-f-lens').innerHTML = LENSES.map(function (l) {
      return '<option value="' + l[0] + '"' + (l[0] === full.lens ? ' selected' : '') + '>' + l[1] + '</option>';
    }).join('');

    el('ins-modal-title').textContent = full.chapter_id + '장 · ' + (full.title || '');
    el('ins-f-chapter').value  = full.chapter_id || '';
    el('ins-f-slug').value     = full.slug || '';
    el('ins-f-title').value    = full.title || '';
    el('ins-f-anchor').value   = full.anchor_quote || '';
    el('ins-f-quotable').value = full.quotable || '';
    el('ins-f-body').value     = full.body_md || '';
    el('ins-f-action').value   = full.action || '';

    var src = full.sources;
    if (typeof src === 'string') {
      try { src = JSON.parse(src || '[]'); } catch (_) { src = []; }
    }
    el('ins-f-source').value = (src && src[0] && src[0].title) || '';

    updateCount();
    el('ins-modal').classList.add('active');
  }

  function closeModal() {
    el('ins-modal').classList.remove('active');
    editing = null;
  }

  function updateCount() {
    var n = chars(el('ins-f-body').value);
    var c = el('ins-f-count');
    var ok = n >= MIN_CHARS && n <= MAX_CHARS;
    c.textContent = '공백 제외 ' + n + '자' +
      (ok ? ' · 기준 범위' : ' · 기준 ' + MIN_CHARS + '~' + MAX_CHARS + '자를 벗어났습니다');
    c.style.color = ok ? 'var(--accent)' : 'var(--danger)';
  }

  function msg(text, ok) {
    var m = el('ins-form-msg');
    m.textContent = text;
    m.style.display = 'block';
    m.style.background = ok ? '#e8f5e9' : '#ffebee';
    m.style.color = ok ? 'var(--accent)' : 'var(--danger)';
  }

  async function save() {
    if (!editing) return;
    var btn = el('ins-save-btn');
    var bodyMd = el('ins-f-body').value;
    var source = el('ins-f-source').value.trim();
    var chapter = parseInt(el('ins-f-chapter').value, 10);

    if (!source) { msg('출처가 비어 있으면 서버가 발행을 거부합니다.', false); return; }
    if (!(chapter >= 1 && chapter <= 99)) { msg('장 번호는 1~99 사이여야 합니다.', false); return; }

    var srcType = (editing.sources && editing.sources[0] && editing.sources[0].type) || 'Book';
    var payload = {
      chapter_id:   chapter,
      part_id:      Math.floor((chapter - 1) / 11) + 1,
      lens:         el('ins-f-lens').value,
      slug:         el('ins-f-slug').value.trim(),
      title:        el('ins-f-title').value.trim(),
      anchor_quote: el('ins-f-anchor').value.trim(),
      quotable:     el('ins-f-quotable').value.trim(),
      body_md:      bodyMd,
      action:       el('ins-f-action').value,
      sources:      [{ type: srcType, title: source }],
      reading_time: Math.max(2, Math.round(chars(bodyMd) / 550)),
      /* status 를 함께 보내야 서버가 발행 조건(출처·quotable·본문 200자)을 다시 검사한다.
         빼면 이미 published 인 글은 검사 없이 그대로 저장돼 버린다. */
      status: 'published'
    };

    btn.disabled = true;
    btn.textContent = '저장 중...';
    try {
      var res = await fetch('/api/admin/insights/' + editing.id, {
        method: 'PUT',
        headers: authHeaders(true),
        body: JSON.stringify(payload)
      });
      var d = {};
      try { d = await res.json(); } catch (_) {}
      if (res.ok && d.success) {
        msg('저장했습니다.', true);
        await load();
        setTimeout(closeModal, 700);
      } else {
        msg(d.error || (d.blockers && d.blockers.join(' / ')) || ('저장 실패 (' + res.status + ')'), false);
      }
    } catch (e) {
      msg('저장 실패: ' + e.message, false);
    } finally {
      btn.disabled = false;
      btn.textContent = '저장';
    }
  }

  async function remove(id) {
    var row = all.filter(function (i) { return i.id === id; })[0];
    if (!row) return;
    var warn = row.chapter_id + '장 「' + row.title + '」을(를) 삭제합니다.\n\n' +
      '삭제하면 https://99wisdombook.org/insight/' + row.slug + ' 링크가 끊기고,\n' +
      '이미 발송된 알림을 보고 들어오는 독자도 빈 페이지를 보게 됩니다.\n\n계속할까요?';
    if (!confirm(warn)) return;
    try {
      var res = await fetch('/api/admin/insights/' + id, {
        method: 'DELETE',
        headers: authHeaders(false)
      });
      if (res.ok) await load();
      else alert('삭제 실패 (' + res.status + ')');
    } catch (e) {
      alert('삭제 실패: ' + e.message);
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var edit = t.getAttribute('data-ins-edit');
    if (edit) { openModal(parseInt(edit, 10)); return; }
    var del = t.getAttribute('data-ins-del');
    if (del) { remove(parseInt(del, 10)); return; }
    if (t.id === 'ins-modal') closeModal();
  });

  document.addEventListener('input', function (e) {
    if (!e.target || !e.target.id) return;
    if (e.target.id === 'ins-f-body') updateCount();
    if (e.target.id === 'ins-search') render();
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'ins-lens') render();
  });

  window.loadInsights  = load;
  window.closeInsModal = closeModal;
  window.saveInsight   = save;
})();

/* 독자의 기록 — 칼럼과 원문 양쪽에서 쓰는 한 벌.

   전에는 reader.html 안에만 있었다. 그래서 원문(/chapter/N)을 읽고
   느낀 것을 적을 자리가 없었다. 글을 읽는 자리는 두 곳인데 쓰는 자리는
   한 곳이었다.

   쓰는 권한은 서버가 말해 준다(GET /api/notes/:id/mine). 로그인은 없고,
   메일 링크로 받은 토큰을 api-client.js 가 들고 있다.

   쓰려면 api-client.js 가 먼저 실려 있어야 한다. */
(function () {
  var MIN = 30, MAX = 300;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(d) {
    var m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[1] + '. ' + m[2] + '. ' + m[3] : '';
  }

  var INPUT = 'width:100%;box-sizing:border-box;padding:11px 14px;border:1px solid var(--line);'
    + 'border-radius:10px;font-size:.92rem;font-family:inherit;color:inherit;background:var(--bg)';

  /**
   * @param {HTMLElement} sec   그릴 자리
   * @param {number} chapterId  장 번호
   * @param {object} [opts]     {title} 표제어 (기본 'Notes')
   */
  function mountNotes(sec, chapterId, opts) {
    if (!sec) return;
    var ch = chapterId;
    var o = opts || {};

    /* 예전 메일은 ?note= 로 토큰을 실어 보냈다. 그 메일이 아직 받은편지함에
       남아 있는 사람이 있으므로 함께 받는다. */
    var legacy = new URLSearchParams(location.search).get('note') || '';
    if (legacy && window.wisdomAPI && !wisdomAPI.readerToken) {
      try { localStorage.setItem('readerToken', legacy); } catch (_) {}
    }
    var tok = (window.wisdomAPI && wisdomAPI.readerToken) || legacy;

    var canWrite = false, myNick = null, myBody = null, editingNick = false;

    function draw(data) {
      var n = data.count || 0;
      var list = data.notes || [];
      /* 아무도 쓰지 않았고 나도 쓸 수 없으면 섹션을 숨긴다. 참여형 영역은
         빈 칸이 보이면 역효과다. */
      if (!n && !canWrite) { sec.innerHTML = ''; return; }

      var h = '<div class="slabel"><h2>Notes</h2>'
        + '<span class="sub">' + esc(o.title || '독자의 기록') + (n ? ' · ' + n : '') + '</span>'
        + '<span class="rule"></span></div>';

      if (canWrite) {
        h += '<div id="nf" style="margin-bottom:22px">';

        /* 별명은 처음 쓸 때만 묻는다. 이미 정한 사람에게는 바꿀 길만 둔다 —
           한 번 정하면 영영 못 바꾸는 이름이어서는 안 된다. */
        if (!myNick || editingNick) {
          h += '<input id="nn" maxlength="16" value="' + esc(editingNick ? myNick : '') + '"'
            + ' placeholder="표시할 별명 (선택 · 비워 두면 ‘독자’)" style="' + INPUT + ';margin-bottom:9px">';
        } else {
          h += '<div style="font-size:.82rem;color:var(--muted-2);margin-bottom:8px">'
            + esc(myNick) + ' 으로 남깁니다 '
            + '<button id="nedit" style="background:none;border:0;padding:0 0 0 4px;'
            + 'font:inherit;font-size:.82rem;color:var(--accent,#5FA97E);cursor:pointer;'
            + 'text-decoration:underline">별명 바꾸기</button></div>';
        }

        h += '<textarea id="nb" maxlength="' + MAX + '" rows="4"'
          + ' placeholder="이 글에서 느낀 것을 적어 주세요" style="' + INPUT
          + ';font-size:.95rem;line-height:1.7;resize:vertical"></textarea>'
          + '<div style="display:flex;align-items:center;gap:12px;margin-top:9px;flex-wrap:wrap">'
          + '<span id="nc" style="font-size:.8rem;color:var(--muted-2)">0 / ' + MAX + '</span>'
          + '<span style="font-size:.8rem;color:var(--muted-2)">' + MIN + '자 이상 · 다른 독자에게 공개됩니다</span>'
          + (myBody
              ? '<button id="ndel" class="sbtn" style="margin-left:auto">지우기</button>'
                + '<button id="ns" class="sbtn">기록 고치기</button>'
              : '<button id="ns" class="sbtn" style="margin-left:auto">기록 남기기</button>')
          + '</div><div id="nm" style="font-size:.85rem;margin-top:8px;color:var(--muted-2)"></div></div>';
      }

      h += list.map(function (x) {
        return '<div style="padding:15px 0;border-top:1px solid var(--line)">'
          + '<div style="font-size:.8rem;color:var(--muted-2);margin-bottom:5px">'
          + esc(x.nick || '독자') + '<span style="margin:0 6px">·</span>' + fmt(x.created_at) + '</div>'
          + '<div style="font-size:.95rem;line-height:1.75;white-space:pre-wrap">' + esc(x.body) + '</div>'
          + '</div>';
      }).join('');

      if (!list.length && canWrite)
        h += '<p style="font-size:.9rem;color:var(--muted-2);border-top:1px solid var(--line);'
          + 'padding-top:15px">아직 기록이 없습니다. 첫 기록을 남겨 보세요.</p>';

      /* 쓸 수 없는 사람에게는 쓰는 길을 알려 준다. 남의 기록만 보이고
         자기는 쓸 수 없는데 이유도 없으면 그냥 막힌 것처럼 보인다. */
      if (!canWrite && n)
        h += '<p style="margin:18px 0 0;font-size:.85rem;line-height:1.7;color:var(--muted-2);'
          + 'border-top:1px solid var(--line);padding-top:15px">'
          + '메일로 받은 링크로 들어오시면 기록을 남기실 수 있습니다. '
          + '<a href="/api/email/start" style="color:var(--accent,#5FA97E)">메일로 시작하기 →</a></p>';

      sec.innerHTML = h;
      if (!canWrite) return;

      var $ = function (i) { return document.getElementById(i); };
      var tb = $('nb'), btn = $('ns'), cnt = $('nc'), msg = $('nm'), nn = $('nn');

      /* 전에 쓴 것이 있으면 채워 둔다. 지우고 다시 쓰라고 할 일이 아니다. */
      if (myBody) { tb.value = myBody; cnt.textContent = myBody.length + ' / ' + MAX; }
      tb.addEventListener('input', function () { cnt.textContent = tb.value.length + ' / ' + MAX; });

      var ed = $('nedit');
      if (ed) ed.onclick = function () { editingNick = true; redraw(); };

      function fail(d) {
        msg.style.color = '';
        msg.textContent = (d && d.error) || '저장하지 못했습니다.';
        /* 만료는 사용자가 고칠 수 있는 일이다. 가는 곳을 준다. */
        if (d && d.expired) {
          try { localStorage.removeItem('readerToken'); } catch (_) {}
          msg.innerHTML = esc(d.error) + ' <a href="' + esc(d.start || '/api/email/start')
            + '" style="color:var(--accent,#5FA97E)">메일로 새 링크 받기 →</a>';
        }
      }

      btn.onclick = function () {
        var v = tb.value.trim();
        if (v.length < MIN) {
          msg.textContent = MIN + '자 이상 적어 주세요. 지금 ' + v.length + '자입니다.';
          return;
        }
        var label = btn.textContent;
        btn.disabled = true; btn.textContent = '저장 중…';
        var payload = { t: tok, body: v };
        if (nn) payload.nickname = nn.value.trim();
        fetch('/api/notes/' + ch, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(function (r) { return r.json(); }).then(function (d) {
          btn.disabled = false;
          if (d && d.success) { msg.textContent = ''; editingNick = false; load(); }
          else { btn.textContent = label; fail(d); }
        }).catch(function () {
          btn.disabled = false; btn.textContent = label;
          msg.textContent = '잠시 후 다시 시도해 주세요.';
        });
      };

      var del = $('ndel');
      if (del) del.onclick = function () {
        if (!confirm('이 기록을 지웁니다. 되돌릴 수 없습니다.')) return;
        del.disabled = true; del.textContent = '지우는 중…';
        fetch('/api/notes/' + ch, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: tok }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          del.disabled = false; del.textContent = '지우기';
          if (d && d.success) { myBody = null; load(); }
          else fail(d);
        }).catch(function () {
          del.disabled = false; del.textContent = '지우기';
          msg.textContent = '잠시 후 다시 시도해 주세요.';
        });
      };
    }

    var last = null;
    function redraw() { if (last) draw(last); }

    function load() {
      var mine = tok
        ? fetch('/api/notes/' + ch + '/mine?t=' + encodeURIComponent(tok))
            .then(function (r) { return r.json(); }).catch(function () { return null; })
        : Promise.resolve(null);

      Promise.all([
        fetch('/api/notes/' + ch).then(function (r) { return r.json(); }),
        mine,
      ]).then(function (res) {
        var m = res[1];
        canWrite = !!(m && m.canWrite);
        myNick = (m && m.nick) || null;
        myBody = (m && m.body) || null;
        last = res[0] || {};
        draw(last);
      }).catch(function () { sec.innerHTML = ''; });
    }

    load();
    if (tok) setTimeout(function () {
      sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
  }

  window.mountNotes = mountNotes;
})();

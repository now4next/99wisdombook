/* 메일로 받기 — 글을 읽는 자리마다 두는 입구.

   전에는 홈과 '오늘의 한 문장'에만 있었다. 그런데 사람이 실제로 머무는
   곳은 칼럼과 원문이다. 공유 링크로 들어온 사람은 글만 읽고 나갔고,
   다시 올 길을 주지 않았다. 열아홉 통을 보내고 아무도 알림을 켜지 않은
   데에는 그 몫이 있다.

   주소만 받는다. 비밀번호도 가입 절차도 없다 — 링크를 누르는 것이 곧
   신분 확인이다.

   이미 메일을 받고 있는 사람에게는 보여 주지 않는다. 켜 둔 사람에게
   켜라고 권하는 것은 소음이다. */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var DEFAULT_LEAD = '살아본 뒤에야 비로소 읽히는 문장들. 매일 아침 한 편씩 보내 드립니다.<br>'
    + '<b>회원가입도 비밀번호도 없습니다</b> — 주소만 적으시면 링크가 갑니다.';

  function open() {
    var back = document.getElementById('sub-cta-modal');
    if (back) { back.style.display = 'flex'; setTimeout(function () {
      var i = document.getElementById('sub-cta-email'); if (i) i.focus();
    }, 120); }
  }
  function close() {
    var back = document.getElementById('sub-cta-modal');
    if (back) back.style.display = 'none';
  }

  function ensureModal() {
    if (document.getElementById('sub-cta-modal')) return;
    var d = document.createElement('div');
    d.id = 'sub-cta-modal';
    d.style.cssText = 'display:none;position:fixed;inset:0;z-index:2000;background:rgba(28,24,20,.45);'
      + 'align-items:center;justify-content:center;padding:20px;';
    d.innerHTML =
      '<div id="sub-cta-sheet" style="background:var(--bg,#fff);border-radius:16px;max-width:400px;width:100%;'
      + 'padding:26px 24px;box-shadow:0 18px 50px rgba(0,0,0,.18);">'
      + '<h3 style="margin:0 0 8px;font-size:1.15rem;letter-spacing:-.02em">메일로 시작하기</h3>'
      + '<p style="margin:0 0 18px;font-size:.88rem;line-height:1.75;color:var(--muted-2)">'
      + '주소를 적어 주시면 링크를 보내 드립니다.<br>비밀번호는 없습니다.</p>'
      + '<form id="sub-cta-form">'
      + '<input id="sub-cta-email" type="email" required placeholder="name@example.com" autocomplete="email"'
      + ' style="width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid var(--line);'
      + 'border-radius:10px;font-size:.95rem;font-family:inherit;color:inherit;background:var(--bg)">'
      + '<button id="sub-cta-submit" type="submit" style="width:100%;box-sizing:border-box;margin-top:10px;'
      + 'background:var(--accent,#5FA97E);color:#fff;border:0;border-radius:999px;padding:12px;'
      + 'font-size:.95rem;font-weight:600;font-family:inherit;cursor:pointer">링크 받기</button>'
      + '</form>'
      + '<p id="sub-cta-done" style="display:none;margin:0;font-size:.9rem;line-height:1.8;color:var(--muted-2)">'
      + '메일을 보냈습니다.<br>받은편지함의 링크를 누르면 바로 시작됩니다.</p>'
      + '<button id="sub-cta-close" style="width:100%;margin-top:12px;background:none;border:0;'
      + 'font:inherit;font-size:.86rem;color:var(--muted-2);cursor:pointer;padding:8px">닫기</button>'
      + '</div>';
    document.body.appendChild(d);

    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    document.getElementById('sub-cta-close').onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    document.getElementById('sub-cta-form').onsubmit = function (e) {
      e.preventDefault();
      var b = document.getElementById('sub-cta-submit');
      b.disabled = true; b.textContent = '보내는 중…';
      var ref = '';
      try { ref = sessionStorage.getItem('pendingRef') || ''; } catch (_) {}
      fetch('/api/email/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('sub-cta-email').value.trim(), ref: ref }),
      }).catch(function () {}).then(function () {
        try { sessionStorage.removeItem('pendingRef'); } catch (_) {}
        /* 보냈는지 여부로 가입 여부가 드러나지 않게, 서버와 같은 말을 한다. */
        document.getElementById('sub-cta-form').style.display = 'none';
        document.getElementById('sub-cta-done').style.display = 'block';
        b.disabled = false; b.textContent = '링크 받기';
      });
    };
  }

  /**
   * @param {HTMLElement} el  그릴 자리
   * @param {object} [opts]   {lead, compact}
   */
  function mountSubscribeCta(el, opts) {
    if (!el) return;
    var o = opts || {};

    function show() {
      ensureModal();
      el.innerHTML =
        '<div class="daily-invite" style="grid-template-columns:1fr auto;align-items:center">'
        + '<div><h3 style="font-size:1.1rem">매일 아침, 한 편</h3>'
        + '<p style="margin-top:6px">' + (o.lead || DEFAULT_LEAD) + '</p></div>'
        + '<button class="btn-accent" id="sub-cta-open" style="border:0;font:inherit;cursor:pointer">'
        + '메일로 받기 →</button></div>';
      document.getElementById('sub-cta-open').onclick = open;
    }

    /* 토큰이 없으면 확실히 안 켠 사람이다. 있으면 서버에 물어본다 —
       토큰만으로는 알림을 켰는지 알 수 없다(보관함만 쓰는 사람도 있다). */
    var tok = window.wisdomAPI && wisdomAPI.readerToken;
    if (!tok) { show(); return; }

    wisdomAPI.me().then(function (u) {
      if (!u || !u.email_enabled) show();
    }).catch(function () { show(); });
  }

  window.mountSubscribeCta = mountSubscribeCta;
  window.openSubscribeCta = function () { ensureModal(); open(); };
})();

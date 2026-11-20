/* 공유 카드를 그린다 — 화면의 커버와 구워질 이미지가 함께 쓰는 코드.

   assets/card.css 와 한 벌이다. 여기서는 마크업을 만들고 글자 크기를
   맞추는 일만 한다.

   글자 크기 맞추기: 속담은 4자에서 38자까지 있어 한 크기로는 담기지
   않는다. 전에는 PIL 로 줄바꿈을 직접 계산해 가며 줄였는데, 브라우저는
   줄바꿈을 알아서 하므로 '넘치면 줄인다'만 반복하면 된다.

   줄이는 순서가 중요하다.
     1) 속담(머리)을 줄인다 — 줄 수가 먼저 어긋나는 쪽이다
     2) 그래도 넘치면 받침을 줄인다 — 문장을 자르는 것보다 작아지는 편이 낫다
     3) 마지막 수단으로만 줄임표를 붙인다 — 문장 끝이 소리 없이 사라지면 안 된다 */
(function () {
  var PART_NAME = {
    1: '경제와 거래', 2: '인과와 자연', 3: '시간과 변화', 4: '인간 본성과 심리',
    5: '관계와 처세', 6: '실행과 노력', 7: '위기와 생존', 8: '지혜와 통찰', 9: '운명과 수용',
  };
  var LENS_KO = {
    origin: '원형', science: '과학', history: '역사', person: '인물',
    business: '비즈니스', daily: '일상', counter: '반론',
    eastwest: '동서', practice: '실천', reflection: '성찰',
  };

  /* 비율별 설계값. assets/card.css 의 기본값과 같아야 한다. */
  var SPEC = {
    '2x1': { head: 84, headMin: 44, headLines: 3, sub: 33, subMin: 24, subLines: 2 },
    '1x1': { head: 116, headMin: 52, headLines: 4, sub: 39, subMin: 28, subLines: 3 },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function markup(item, ratio, opts) {
    var o = opts || {};
    var part = parseInt(item.part_id, 10) || 1;
    var ch = parseInt(item.chapter_id, 10) || 0;
    var lens = LENS_KO[item.lens] || item.lens || '';
    var head = String(item.anchor_quote || item.title || '').trim();
    /* 글 안의 커버에서는 받침(quotable)을 뺀다. 그 문장은 글 끝의
        'Quotable · 오늘의 한 줄' 에 이미 있어서, 커버에 또 실으면 한
        화면에 같은 문장이 두 번 나온다. 공유 카드는 혼자 떠다니므로
        계속 싣는다 — 그때는 받쳐 줄 글이 옆에 없다. */
    var sub = o.sub === false ? '' : String(item.quotable || '').trim();
    var no = (ch < 10 ? '0' : '') + ch;

    return '<div class="wcard t-p' + part + (ratio === '1x1' ? ' sq' : '') + '">'
      + '<div class="wc-ghost">' + no + '</div>'
      + '<div class="wc-main">'
      +   '<div class="wc-kicker">제' + part + '부 ' + ch + '장 · ' + esc(lens) + '</div>'
      +   '<div class="wc-head">' + esc(head) + '</div>'
      +   (sub ? '<div class="wc-rule"></div><div class="wc-sub">' + esc(sub) + '</div>' : '')
      + '</div>'
      + '<div class="wc-foot">'
      +   '<span class="wc-brand">99 WISDOM INSIGHT</span>'
      +   '<span class="wc-part">' + esc(PART_NAME[part] || '') + '의 법칙</span>'
      + '</div>'
      + '</div>';
  }

  function lineCount(el) {
    var lh = parseFloat(getComputedStyle(el).lineHeight);
    return lh > 0 ? Math.round(el.scrollHeight / lh) : 1;
  }

  /** 설계 크기 안에 들어오도록 글자 크기를 줄인다. */
  function fit(card, ratio) {
    var spec = SPEC[ratio] || SPEC['2x1'];
    var main = card.querySelector('.wc-main');
    var headEl = card.querySelector('.wc-head');
    var subEl = card.querySelector('.wc-sub');
    if (!main || !headEl) return;

    var over = function () { return main.scrollHeight > main.clientHeight + 1; };

    // 1) 머리
    var h = spec.head;
    while ((over() || lineCount(headEl) > spec.headLines) && h > spec.headMin) {
      h = Math.max(spec.headMin, Math.floor(h * 0.9));
      card.style.setProperty('--head', h + 'px');
    }

    if (!subEl) return;

    // 2) 받침
    var s = spec.sub;
    while ((over() || lineCount(subEl) > spec.subLines) && s > spec.subMin) {
      s = Math.max(spec.subMin, Math.floor(s * 0.94));
      card.style.setProperty('--sub', s + 'px');
    }

    // 3) 줄임표
    if (over() || lineCount(subEl) > spec.subLines) {
      var full = subEl.textContent;
      var lo = 8, hi = full.length, best = '';
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        subEl.textContent = full.slice(0, mid).replace(/[\s,·]+$/, '') + '…';
        if (!over() && lineCount(subEl) <= spec.subLines) { best = subEl.textContent; lo = mid + 1; }
        else hi = mid - 1;
      }
      subEl.textContent = best || (full.slice(0, 20) + '…');
    }
  }

  /**
   * 카드를 그려 넣는다.
   * @param {HTMLElement} host   담을 자리
   * @param {object} item        칼럼 (part_id·chapter_id·lens·anchor_quote·quotable)
   * @param {string} [ratio]     '2x1'(기본) · '1x1'
   * @param {object} [opts]      {scale:false} 면 설계 크기 그대로 둔다(굽기용)
   */
  function mountCard(host, item, ratio, opts) {
    if (!host || !item) return null;
    var o = opts || {};
    /* 'auto' — 좁은 화면에서는 정사각을 쓴다. 2:1 카드를 폰 폭(375px)에
       맞춰 줄이면 높이가 187px 밖에 안 되고 키커가 8px 가 된다. 세로가
       긴 쪽이 읽을 자리를 준다(자매 사이트도 커버는 세로형이다).

       ⚠ 원래 값을 먼저 담아 둔다. 비엄격 모드에서 arguments 는 파라미터와
       묶여 있어, ratio 에 다시 대입하면 arguments[2] 도 함께 바뀐다. */
    var asked = ratio;
    if (ratio === 'auto') ratio = pickRatio(host);
    ratio = ratio === '1x1' ? '1x1' : '2x1';

    if (asked === 'auto') {
      host.dataset.autoRatio = '1';
      host.dataset.item = JSON.stringify(item);
      host.dataset.opts = JSON.stringify({ sub: o.sub, scale: o.scale });
    }
    host.innerHTML = markup(item, ratio, o);
    var card = host.firstChild;

    /* 폰트가 아직 안 실렸으면 글자 폭이 달라져 맞춘 크기가 어긋난다.
       웹폰트를 쓰는 카드라 이 기다림이 꼭 필요하다. */
    var ready = (document.fonts && document.fonts.ready) || Promise.resolve();
    ready.then(function () {
      fit(card, ratio);
      if (o.scale !== false) scaleToHost(host, card);
      host.setAttribute('data-card-ready', '1');
    });

    if (o.scale !== false) {
      scaleToHost(host, card);
      if (!mountCard._bound) {
        mountCard._bound = true;
        window.addEventListener('resize', function () {
          document.querySelectorAll('.wcard-fit').forEach(function (h) {
            var c = h.querySelector('.wcard');
            if (!c) return;
            /* 비율 경계를 넘었으면 줄이는 것만으로는 안 된다. 다시 그린다. */
            var want = h.dataset.autoRatio ? pickRatio(h) : null;
            if (want && want !== (c.classList.contains('sq') ? '1x1' : '2x1')) {
              mountCard(h, JSON.parse(h.dataset.item), 'auto', JSON.parse(h.dataset.opts || '{}'));
              return;
            }
            scaleToHost(h, c);
          });
        });
      }
    }
    return card;
  }

  var RATIO_SWITCH = 560;   // 이 폭보다 좁으면 정사각

  function pickRatio(host) {
    var w = host.clientWidth || (window.innerWidth || 0);
    return w < RATIO_SWITCH ? '1x1' : '2x1';
  }

  /* 설계 크기 카드를 담는 자리 폭에 맞춰 줄인다. 카드 자체는 건드리지
     않으므로 구워질 이미지와 레이아웃이 어긋나지 않는다. */
  function scaleToHost(host, card) {
    var w = host.clientWidth;
    if (!w) return;
    var k = w / card.offsetWidth;
    card.style.transform = 'scale(' + k + ')';
    host.style.height = Math.round(card.offsetHeight * k) + 'px';
  }

  window.mountCard = mountCard;
  window.cardMarkup = markup;
  window.fitCard = fit;
})();

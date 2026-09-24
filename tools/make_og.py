# -*- coding: utf-8 -*-
"""
칼럼별 공유 카드(OG) 이미지 생성기

  python tools/make_og.py            # 발행된 전 칼럼 재생성
  python tools/make_og.py <slug> ..  # 지정 칼럼만

산출: og/{slug}.png (1200x600, 2:1)  — 카카오톡 / OG / 트위터 공용
      og/{slug}-1x1.png (1080x1080)  — 인스타 피드

카카오·페이스북 미리보기는 SVG를 읽지 못하므로 PNG로 굽는다.
디자인은 사이트의 라이트/파스텔 테마(assets/app.css)를 따른다.
"""
import io, json, os, sys, subprocess, base64, time
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, 'og')

BG      = (251, 251, 248)
INK     = (28, 30, 27)
INK_2   = (61, 66, 59)
MUTED   = (110, 116, 105)
MUTED_2 = (154, 160, 148)

PART_COLOR = {
    1: (201, 149, 74), 2: (95, 169, 126), 3: (94, 155, 198),
    4: (155, 135, 198), 5: (224, 144, 110), 6: (79, 160, 160),
    7: (212, 112, 110), 8: (176, 138, 102), 9: (139, 149, 166),
}
PART_NAME = {
    1: '경제와 거래', 2: '인과와 자연', 3: '시간과 변화', 4: '인간 본성과 심리',
    5: '관계와 처세', 6: '실행과 노력', 7: '위기와 생존', 8: '지혜와 통찰', 9: '운명과 수용',
}
LENS_KO = {
    'origin': '원형', 'science': '과학', 'history': '역사', 'person': '인물',
    'business': '비즈니스', 'daily': '일상', 'counter': '반론',
    'eastwest': '동서', 'practice': '실천', 'reflection': '성찰',
}

SERIF = r'C:\Windows\Fonts\NotoSerifKR-VF.ttf'
SANS  = r'C:\Windows\Fonts\NotoSansKR-VF.ttf'


def font(path, size, variation=None):
    f = ImageFont.truetype(path, size)
    if variation:
        try:
            f.set_variation_by_name(variation)
        except Exception:
            pass
    return f


def mix(c, bg, ratio):
    """c 를 bg 와 ratio(0~1) 비율로 섞는다."""
    return tuple(int(bg[i] + (c[i] - bg[i]) * ratio) for i in range(3))


def wrap(draw, text, fnt, max_w):
    """어절 단위 줄바꿈, 어절이 너무 길면 글자 단위."""
    words, lines, cur = text.split(' '), [], ''
    for w in words:
        test = (cur + ' ' + w).strip()
        if draw.textlength(test, font=fnt) <= max_w:
            cur = test
            continue
        if cur:
            lines.append(cur)
        if draw.textlength(w, font=fnt) > max_w:
            buf = ''
            for ch in w:
                if draw.textlength(buf + ch, font=fnt) <= max_w:
                    buf += ch
                else:
                    lines.append(buf); buf = ch
            cur = buf
        else:
            cur = w
    if cur:
        lines.append(cur)
    return lines


def radial_tint(size, color, strength=0.20):
    """좌상단에서 퍼지는 부드러운 파스텔 틴트."""
    W, H = size
    layer = Image.new('RGB', (W, H), color)
    g = Image.radial_gradient('L').resize((W * 2, H * 2), Image.LANCZOS)
    # 중심을 좌상단으로 이동시켜 잘라 쓴다
    mask = g.crop((W, H, W * 2, H * 2)).transpose(Image.ROTATE_180)
    mask = mask.point(lambda v: int((255 - v) * strength))
    return layer, mask


def build(item, ratio='2x1'):
    # 카드의 주인공은 속담(anchor_quote)이다. 공감이 가장 빨리 일어나는 문장이라
    # 가장 크게 놓고, 칼럼의 인사이트 한 줄(quotable)은 그 아래에 작게 받친다.
    if ratio == '2x1':
        W, H = 1200, 600
        pad, bar = 88, 12
        k_size, a_size, q_size, f_size = 26, 84, 33, 24
        a_min, a_max_lines, q_max_lines = 44, 3, 2
        ghost_size = 300
    else:
        W, H = 1080, 1080
        pad, bar = 96, 14
        k_size, a_size, q_size, f_size = 30, 116, 39, 28
        a_min, a_max_lines, q_max_lines = 52, 4, 3
        ghost_size = 380

    part = int(item.get('part_id') or 1)
    col  = PART_COLOR.get(part, PART_COLOR[1])

    im = Image.new('RGB', (W, H), BG)
    tint, mask = radial_tint((W, H), col, 0.22)
    im.paste(tint, (0, 0), mask)

    d = ImageDraw.Draw(im)

    # 좌측 액센트 바
    d.rectangle([0, 0, bar, H], fill=col)

    left = pad + bar

    # 고스트 장 번호 — 오른쪽에 크게, 가장자리에서 살짝 잘리도록 (의도된 재단)
    ghost_f = font(SERIF, ghost_size, 'Bold')
    gtxt = '%02d' % int(item.get('chapter_id') or 0)
    d.text((W - 36, H - 24), gtxt, font=ghost_f,
           fill=mix(col, BG, 0.26), anchor='rs')

    # ── 좌측 텍스트 블록: 키커 + 헤드라인을 하나로 묶어 수직 중앙 정렬 ──
    lens = LENS_KO.get(item.get('lens'), item.get('lens') or '')
    kicker = '제%d부 %d장 · %s' % (part, int(item.get('chapter_id') or 0), lens)
    kf = font(SANS, k_size, 'Medium')

    text_w = int((W - left - pad) * (0.78 if ratio == '2x1' else 0.95))

    anchor = (item.get('anchor_quote') or item.get('title') or '').strip()
    sub    = (item.get('quotable') or '').strip()

    gap      = int(k_size * 1.6)      # 키커 ↔ 속담
    foot_top = H - pad - f_size * 2 - 34
    avail    = foot_top - pad

    def layout(a_px, q_px):
        """주어진 두 크기로 배치했을 때의 줄과 전체 높이를 돌려준다."""
        af = font(SERIF, a_px, 'Bold')
        a_ls = wrap(d, anchor, af, text_w)

        qf = font(SANS, q_px, 'Medium')
        q_ls = wrap(d, sub, qf, text_w) if sub else []

        a_lh = int(af.size * 1.34)
        q_lh = int(qf.size * 1.62)
        mid_ = int(q_px * 1.3)        # 속담 ↔ 구분선
        rgap = int(q_px * 1.0)        # 구분선 ↔ 받침

        h = k_size + gap + a_lh * len(a_ls)
        if q_ls:
            h += mid_ + rgap + q_lh * len(q_ls)
        return dict(af=af, a_ls=a_ls, a_lh=a_lh, qf=qf, q_ls=q_ls, q_lh=q_lh,
                    mid=mid_, rgap=rgap, h=h)

    # 1) 헤드라인부터 줄인다. 속담이 4자에서 38자까지 있어 줄 수와 높이를 함께 본다.
    a_cur = a_size
    L = layout(a_cur, q_size)
    while (len(L['a_ls']) > a_max_lines or L['h'] > avail) and a_cur > a_min:
        a_cur = int(a_cur * 0.9)
        L = layout(a_cur, q_size)

    # 2) 그래도 넘치면 받침을 줄인다. 문장을 자르는 것보다 작아지는 편이 낫다.
    q_cur = q_size
    q_floor = int(q_size * 0.72)
    while (L['h'] > avail or len(L['q_ls']) > q_max_lines) and q_cur > q_floor:
        q_cur = int(q_cur * 0.94)
        L = layout(a_cur, q_cur)

    # 3) 마지막 수단으로만 줄임표를 붙인다. 문장 끝이 소리 없이 사라지는 일을 막는다.
    if len(L['q_ls']) > q_max_lines or L['h'] > avail:
        keep = max(1, min(q_max_lines, len(L['q_ls'])))
        if L['h'] > avail and keep > 1:
            keep -= 1
        if keep < len(L['q_ls']):
            L['q_ls'] = L['q_ls'][:keep]
            L['q_ls'][-1] = L['q_ls'][-1].rstrip() + '…'
        L['h'] = k_size + gap + L['a_lh'] * len(L['a_ls'])                  + L['mid'] + L['rgap'] + L['q_lh'] * len(L['q_ls'])

    af, a_lines, a_line_h = L['af'], L['a_ls'], L['a_lh']
    qf, q_lines, q_line_h = L['qf'], L['q_ls'], L['q_lh']
    mid, rule_gap, block_h = L['mid'], L['rgap'], L['h']
    q_size = qf.size

    top = max(pad, int((foot_top - block_h) * 0.46))

    d.ellipse([left, top + k_size * 0.28, left + 12, top + k_size * 0.28 + 12], fill=col)
    d.text((left + 24, top), kicker, font=kf, fill=mix(col, (0, 0, 0), 0.75))

    ty = top + k_size + gap
    for ln in a_lines:
        d.text((left, ty), ln, font=af, fill=INK)
        ty += a_line_h

    if q_lines:
        # 속담과 받침을 가르는 짧은 선. 부 색을 써서 좌측 액센트 바와 호응시킨다.
        ty += mid
        d.line([left, ty, left + int(q_size * 2.4), ty], fill=col, width=3)
        ty += rule_gap
        for ln in q_lines:
            d.text((left, ty), ln, font=qf, fill=INK_2)
            ty += q_line_h

    # ── 하단 ──
    fy = H - pad - f_size
    d.line([left, fy - 30, W - pad, fy - 30], fill=mix(INK, BG, 0.12), width=1)

    ff = font(SANS, f_size, 'Medium')
    d.text((left, fy), '99 WISDOM INSIGHT', font=ff, fill=mix(INK, BG, 0.62))

    pf = font(SANS, f_size - 3, 'Regular')
    d.text((W - pad, fy + 4), PART_NAME.get(part, '') + '의 법칙',
           font=pf, fill=MUTED, anchor='ra')

    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    # 공개 목록 API 를 쓴다. 관리자 API 는 실제 관리자 세션이 필요해졌고,
    # 카드에 들어가는 값(제목·quotable·장 번호)은 공개 목록에 전부 들어 있다.
    tmp = os.path.join(OUT, '_list.json')
    subprocess.run(['curl', '-s', 'https://99wisdombook.org/api/insights?limit=200',
                    '-o', tmp], check=True)
    payload = json.load(io.open(tmp, encoding='utf-8'))
    items = payload.get('items')
    os.remove(tmp)
    if not items:
        raise SystemExit('칼럼 목록을 받지 못했습니다: %s' % str(payload)[:200])

    want = set(sys.argv[1:])
    if want:
        items = [i for i in items if i['slug'] in want]

    for it in items:
        for ratio, suffix in (('2x1', ''), ('1x1', '-1x1')):
            im = build(it, ratio)
            p = os.path.join(OUT, '%s%s.png' % (it['slug'], suffix))
            im.save(p, 'PNG', optimize=True)
        print('%-32s %d부 %2d장  %s' % (it['slug'], it['part_id'], it['chapter_id'],
                                        (it.get('quotable') or it['title'])[:26]))
    print()
    print('생성: %d편 x 2종 = %d장 → og/' % (len(items), len(items) * 2))


if __name__ == '__main__':
    main()

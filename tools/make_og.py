# -*- coding: utf-8 -*-
"""
칼럼별 공유 카드(OG) 이미지 생성기

  python tools/make_og.py            # 발행된 전 칼럼 재생성
  python tools/make_og.py <slug> ..  # 지정 칼럼만
  python tools/make_og.py --keep-png # 중간 PNG 를 지우지 않는다(비교용)

산출: og/{slug}.jpg (1200x600, 2:1)  — 카카오톡 / OG / 트위터 / 메일 공용
      og/{slug}-1x1.jpg (1080x1080)  — 인스타 피드

어떻게 만드는가
---------------
디자인은 assets/card.css + card.js 한 벌에 있다. 이 스크립트는 그것을
tools/card.html 에 끼워 넣고 헤드리스 브라우저로 찍을 뿐이다. 그래서
칼럼 페이지 위에 보이는 커버와 여기서 구운 카드가 같은 원본에서 나온다.

전에는 PIL 로 픽셀을 직접 그렸다. 좌표와 줄바꿈을 손으로 계산해야 했고
(wrap() 을 직접 구현했다), 폰트 경로가 C:\\Windows\\Fonts 로 박혀 있어
한 대의 PC 에서만 구워졌다. 브라우저는 줄바꿈도 웹폰트도 알아서 한다.

왜 JPEG 인가
------------
카드는 넓은 그라데이션 면이라 PNG 로는 비효율이다. 같은 99편이
PNG 13.5MB 였던 것이 JPEG 로는 4MB 안팎이 된다. 레포와 git 히스토리가
그만큼 가벼워진다(PNG 는 바이너리라 커밋마다 통째로 쌓인다).

카카오·페이스북 미리보기는 SVG 를 읽지 못하므로 래스터로 굽는 것은
그대로다. 바뀐 것은 '무엇으로 그리는가'이지 '무엇을 내보내는가'가 아니다.
"""
import io, json, os, sys, subprocess, tempfile, shutil, time

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'og')
TPL = os.path.join(ROOT, 'tools', 'card.html')

JPEG_QUALITY = 88

RATIOS = (
    # (ratio, 파일 접미사, 가로, 세로)
    ('2x1', '', 1200, 600),
    ('1x1', '-1x1', 1080, 1080),
)

BROWSER = next((p for p in [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    shutil.which('msedge') or '',
    shutil.which('chrome') or '',
    shutil.which('chromium') or '',
] if p and os.path.exists(p)), None)


def file_url(path):
    return 'file:///' + os.path.abspath(path).replace('\\', '/')


def page(item, ratio):
    """틀에 값을 끼워 넣어 한 장짜리 HTML 을 만든다."""
    html = io.open(TPL, encoding='utf-8').read()
    return (html
            .replace('__APP_CSS__', file_url(os.path.join(ROOT, 'assets', 'app.css')))
            .replace('__CARD_CSS__', file_url(os.path.join(ROOT, 'assets', 'card.css')))
            .replace('__CARD_JS__', file_url(os.path.join(ROOT, 'card.js')))
            .replace('__ITEM__', json.dumps(item, ensure_ascii=False))
            .replace('__RATIO__', ratio))


def shoot(html, w, h, png_path, tmpdir):
    """헤드리스 브라우저로 한 장 찍는다."""
    src = os.path.join(tmpdir, 'card.html')
    io.open(src, 'w', encoding='utf-8', newline='\n').write(html)

    if os.path.exists(png_path):
        os.remove(png_path)

    prof = os.path.join(tmpdir, 'profile')
    # 파이프를 붙잡아야 한다. 런처는 렌더러 자식이 파일을 다 쓰기 전에 돌아온다.
    subprocess.run([
        BROWSER, '--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--hide-scrollbars',
        '--force-device-scale-factor=1',
        f'--user-data-dir={prof}',
        f'--window-size={w},{h}',
        # 웹폰트를 받아 오고 fit() 이 끝날 시간을 준다
        '--virtual-time-budget=9000',
        f'--screenshot={png_path}',
        file_url(src),
    ], capture_output=True, timeout=180)

    # 런처가 먼저 돌아오는 경우가 있어 파일이 떨어질 때까지 기다린다
    for _ in range(120):
        if os.path.exists(png_path) and os.path.getsize(png_path) > 1000:
            break
        time.sleep(0.25)
    if not os.path.exists(png_path):
        raise SystemExit('렌더 실패: %s' % png_path)


def bake(item, tmpdir, keep_png=False):
    made = []
    if True:
        for ratio, suffix, w, h in RATIOS:
            png = os.path.join(OUT, '%s%s.png' % (item['slug'], suffix))
            jpg = os.path.join(OUT, '%s%s.jpg' % (item['slug'], suffix))
            shoot(page(item, ratio), w, h, png, tmpdir)

            im = Image.open(png).convert('RGB')
            if im.size != (w, h):
                # 창 크기와 어긋나면 레이아웃이 밀린 것이다. 조용히 넘기지 않는다.
                raise SystemExit('크기가 어긋남 %s: %s (기대 %dx%d)' % (jpg, im.size, w, h))
            im.save(jpg, 'JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
            if not keep_png:
                os.remove(png)
            made.append(jpg)
    return made


def fetch_items():
    """공개 목록 API 를 쓴다. 카드에 들어가는 값은 전부 여기에 있다."""
    tmp = os.path.join(OUT, '_list.json')
    subprocess.run(['curl', '-s', 'https://99wisdombook.org/api/insights?limit=200',
                    '-o', tmp], check=True)
    payload = json.load(io.open(tmp, encoding='utf-8'))
    os.remove(tmp)
    items = payload.get('items')
    if not items:
        raise SystemExit('칼럼 목록을 받지 못했습니다: %s' % str(payload)[:200])
    return items


def main():
    if not BROWSER:
        raise SystemExit('헤드리스로 쓸 브라우저를 찾지 못했습니다 (Edge 또는 Chrome).')
    os.makedirs(OUT, exist_ok=True)

    args = sys.argv[1:]
    keep_png = '--keep-png' in args
    want = set(a for a in args if not a.startswith('--'))

    items = fetch_items()
    if want:
        items = [i for i in items if i['slug'] in want]
        missing = want - {i['slug'] for i in items}
        if missing:
            raise SystemExit('없는 슬러그: %s' % ', '.join(sorted(missing)))

    total = 0
    # 한 번 만들어 끝까지 돌려 쓴다. 브라우저가 프로필을 쥐고 있어서
    # 매번 지우려 하면 PermissionError 가 난다(ignore_cleanup_errors).
    tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    tmpdir = tmp.name
    for it in items:
        bake(it, tmpdir, keep_png)
        total += len(RATIOS)
        print('%-32s %d부 %2d장  %s' % (
            it['slug'], it['part_id'], it['chapter_id'],
            (it.get('quotable') or it['title'])[:26]))

    size = sum(os.path.getsize(os.path.join(OUT, f))
               for f in os.listdir(OUT) if f.endswith('.jpg'))
    print()
    print('생성: %d편 x %d종 = %d장 → og/' % (len(items), len(RATIOS), total))
    print('og/ 전체 JPEG %.1f MB' % (size / 1048576))
    tmp.cleanup()


if __name__ == '__main__':
    main()

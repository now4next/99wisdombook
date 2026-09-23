# -*- coding: utf-8 -*-
"""공개 배포용 디렉터리(dist/)를 만든다.

왜 필요한가
-----------
저장소 루트를 그대로 배포하면 개발 메모(*.md 94개), schema.sql, wrangler.toml,
백업 페이지(book_old.html 등)까지 전부 공개된다. 실제로 schema.sql 이
내려받히고 있었고 그 안에 관리자 비밀번호 해시가 들어 있었다.

Cloudflare Pages 의 `.assetsignore` 는 `wrangler pages deploy` 에서 동작하지
않는다(직접 업로드는 디렉터리를 통째로 올린다). `_redirects` 로 404 를 주는
방법도 이미 존재하는 정적 파일은 덮지 못한다. 그래서 올릴 것만 담은 디렉터리를
따로 만든다.

사용법
------
    python tools/build_public.py
    npx wrangler pages deploy dist --project-name 99wisdombook --branch main

⚠ data/ 와 og/ 는 런타임에 필요하므로 반드시 포함한다.
   data/chapters/*.md 는 functions/chapter/[id].js 가 ASSETS 로 읽고,
   data/wisdom.json 은 알림 크론이 읽는다.
"""
import os
import shutil
import sys
import fnmatch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

# 루트에서 제외할 파일 패턴 (하위 디렉터리에는 적용하지 않는다)
EXCLUDE_ROOT_FILES = [
    '*.md',            # 개발 메모. CLAUDE.md 포함 — 배포할 이유가 없다.
    '*.sql',           # schema.sql
    'wrangler.toml', 'wrangler.jsonc',
    '.assetsignore',
    '*_backup_*.html', '*_backup.html', '*_old.html',
    'book_old.html', 'book_simple*.html',
    'test_*.html', 'test_*.py', 'test_*.sh',
    'check_*.sh', 'wait_and_check.sh',
    '*.py',
    '.DS_Store', 'Thumbs.db',
]

# 통째로 제외할 디렉터리
EXCLUDE_DIRS = {
    'dist', 'tools', 'mockup', 'node_modules', '.git', '.wrangler', '.claude',
}


def excluded_root_file(name):
    return any(fnmatch.fnmatch(name, p) for p in EXCLUDE_ROOT_FILES)


def main():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    copied = skipped = 0
    for name in sorted(os.listdir(ROOT)):
        src = os.path.join(ROOT, name)

        if os.path.isdir(src):
            if name in EXCLUDE_DIRS or name.startswith('.'):
                skipped += 1
                continue
            shutil.copytree(src, os.path.join(DIST, name))
            copied += 1
            continue

        # _redirects, _routes.json, _headers 같은 제어 파일은 반드시 남긴다
        if name.startswith('_'):
            shutil.copy2(src, os.path.join(DIST, name))
            copied += 1
            continue

        if name.startswith('.') or excluded_root_file(name):
            skipped += 1
            continue

        shutil.copy2(src, os.path.join(DIST, name))
        copied += 1

    # 필수 파일이 빠지지 않았는지 확인한다. 하나라도 없으면 배포하면 안 된다.
    required = [
        'index.html', 'daily.html', 'reader.html', 'chapter-view.html',
        'admin.html', 'api-client.js', 'admin-insights.js',
        '_redirects', '_routes.json',
        'functions/api/[[path]].js', 'functions/insight/[slug].js',
        'functions/chapter/[id].js',
        'data/wisdom.json', 'data/chapters/1.md', 'data/chapters/99.md',
        'assets/app.css', 'assets/site.css',
        'og/ginkgo-survived.png',
    ]
    missing = [r for r in required if not os.path.exists(os.path.join(DIST, *r.split('/')))]
    if missing:
        print('필수 파일 누락 — 배포하지 말 것:')
        for m in missing:
            print('  -', m)
        sys.exit(1)

    # 새어 나가면 안 되는 것이 섞이지 않았는지도 확인한다
    leaked = [f for f in os.listdir(DIST) if excluded_root_file(f)]
    if leaked:
        print('제외했어야 할 파일이 남아 있음:', leaked)
        sys.exit(1)

    total = sum(len(fs) for _, _, fs in os.walk(DIST))
    print('dist/ 생성 완료: 최상위 %d개 항목, 전체 %d개 파일 (제외 %d개 항목)'
          % (copied, total, skipped))
    print('배포: npx wrangler pages deploy dist --project-name 99wisdombook --branch main')


if __name__ == '__main__':
    main()

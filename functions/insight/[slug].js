/**
 * /insight/{slug} — 칼럼 상세
 *
 * 정적 reader.html을 가져와 OG 메타를 서버에서 주입해 돌려준다.
 * (SNS 미리보기는 JS 실행 전 HTML만 읽으므로 서버 주입이 필요하다)
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const slug = decodeURIComponent(params.slug || '');
  const origin = new URL(request.url).origin;

  // 정적 셸
  let html;
  try {
    const res = await env.ASSETS.fetch(new URL('/reader.html', origin));
    html = await res.text();
  } catch (_) {
    return new Response('Not found', { status: 404 });
  }

  // 칼럼 조회 (없어도 셸은 돌려준다 — 클라이언트가 404 화면을 그린다)
  let it = null;
  try {
    it = await env.DB.prepare(
      "SELECT chapter_id, part_id, lens, slug, title, hook, quotable, hero_image, published_at FROM insights WHERE slug = ? AND status = 'published'"
    ).bind(slug).first();
  } catch (_) {}

  if (it) {
    const title = it.title + ' · 99 Wisdom Insight';
    const desc  = it.hook || it.quotable || '9부 99장의 지혜를 사례와 출처가 있는 칼럼으로.';
    const img   = it.hero_image || (origin + '/og-share.png');
    const url   = origin + '/insight/' + encodeURIComponent(it.slug);

    html = html
      .replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>')
      .replace(/(<meta name="description" content=")[^"]*(")/, '$1' + esc(desc) + '$2')
      .replace(/(<meta property="og:image"\s+content=")[^"]*(")/, '$1' + esc(img) + '$2');

    // og:title / og:description / og:url 은 셸에 없으므로 삽입
    html = html.replace(
      '<meta property="og:type"        content="article">',
      '<meta property="og:type"        content="article">\n' +
      '<meta property="og:title"       content="' + esc(title) + '">\n' +
      '<meta property="og:description" content="' + esc(desc) + '">\n' +
      '<meta property="og:url"         content="' + esc(url) + '">\n' +
      '<meta name="twitter:title"      content="' + esc(title) + '">\n' +
      '<meta name="twitter:description" content="' + esc(desc) + '">'
    );

    // 초기 렌더를 위한 slug 힌트
    html = html.replace('<body>', '<body data-slug="' + esc(it.slug) + '">');
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, must-revalidate'
    }
  });
}

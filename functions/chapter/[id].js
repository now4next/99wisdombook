/**
 * /chapter/{id} — 99장 원문을 디자인된 화면으로 (로그인 불필요)
 *
 * data/chapters/{id}.md 를 서버에서 읽어 OG 메타를 주입하고,
 * 본문을 인라인으로 실어 보내 클라이언트가 즉시 렌더하게 한다.
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseFront(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: m[2] };
}

export async function onRequestGet(context) {
  const { params, env, request } = context;
  const id = parseInt(params.id, 10);
  const origin = new URL(request.url).origin;

  if (!id || id < 1 || id > 99) {
    return Response.redirect(origin + '/parts.html', 302);
  }

  let html, mdText = null;
  try {
    const shell = await env.ASSETS.fetch(new URL('/chapter-view.html', origin));
    html = await shell.text();
  } catch (_) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const res = await env.ASSETS.fetch(new URL('/data/chapters/' + id + '.md', origin));
    if (res.ok) mdText = await res.text();
  } catch (_) {}

  if (mdText) {
    const { meta } = parseFront(mdText);
    const title = (meta.title || ('제' + id + '장')) + ' · 99 Wisdom Insight';
    const desc  = meta.subtitle || '9부 99장의 지혜.';
    const url   = origin + '/chapter/' + id;

    html = html
      .replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>')
      .replace(/(<meta name="description" content=")[^"]*(")/, '$1' + esc(desc) + '$2');

    html = html.replace(
      '<meta property="og:type"        content="article">',
      '<meta property="og:type"        content="article">\n' +
      '<meta property="og:title"       content="' + esc(title) + '">\n' +
      '<meta property="og:description" content="' + esc(desc) + '">\n' +
      '<meta property="og:url"         content="' + esc(url) + '">'
    );

    // 본문을 인라인으로 실어 2차 요청 없이 즉시 렌더
    html = html.replace(
      '<script>',
      '<script>window.__CHAPTER_MD__ = ' + JSON.stringify(mdText) + ';</script>\n<script>'
    );
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=600, must-revalidate'
    }
  });
}

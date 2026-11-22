# 칼럼 일괄 손보기 — 묶음 파일

`POST /api/admin/insights/bulk` 에 그대로 보내는 본문이다.
`Bearer CRON_SECRET` 또는 관리자 세션이 있어야 한다.

먼저 무엇이 바뀌는지 본다.

```bash
curl -s -X POST https://99wisdombook.org/api/admin/insights/bulk \
  -H "Authorization: Bearer <CRON_SECRET>" -H 'Content-Type: application/json' \
  -d "$(python -c "import json,sys;d=json.load(open('tools/column-batches/batch-2.json',encoding='utf-8'));d['dry_run']=True;print(json.dumps(d,ensure_ascii=False))")"
```

확인했으면 반영한다.

```bash
curl -s -X POST https://99wisdombook.org/api/admin/insights/bulk \
  -H "Authorization: Bearer <CRON_SECRET>" -H 'Content-Type: application/json' \
  --data-binary @tools/column-batches/batch-2.json
```

`replace` 는 찾는 글이 **정확히 한 번** 나올 때만 바꾼다. 어긋나면 그 편은
건드리지 않고 이유를 돌려주므로, 결과의 `failed` 가 0 인지 보면 된다.

## 반영한 뒤

`quotable` 이나 `anchor_quote` 가 바뀐 편은 카드를 다시 굽는다.

```bash
python tools/make_og.py hapjong-and-balance-theory
```

## 묶음 기록

| 묶음 | 편 | 한 일 |
|---|---|---|
| 1 | 22·32·15·9·82 | 22장 다시 씀, 나머지 문장 수술 (docs/column-batch-1.md) |
| 2 | 74·88·66·69·56 | 74장 quotable 교체, 나머지 되짚기 수술 |

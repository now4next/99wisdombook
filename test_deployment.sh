#!/bin/bash
echo "=== 배포 상태 확인 ==="
echo ""
echo "1️⃣ GitHub Pages 확인..."
curl -sL "https://now4next.github.io/99wisdombook/?v=1770972162" | grep -o "currentVersion='[0-9]*'" | head -1
echo ""
echo "2️⃣ 커스텀 도메인 확인..."
curl -sL "https://99wisdombook.org/?v=1770972162" | grep -o "currentVersion='[0-9]*'" | head -1
echo ""
echo "3️⃣ 로컬 파일 버전 확인..."
grep -o "currentVersion='[0-9]*'" book.html | head -1
echo ""
echo "=== 헤더 HTML 구조 확인 ==="
curl -sL "https://99wisdombook.org/?v=1770972162" | grep -A 30 "id=\"language-selector\"" | head -35

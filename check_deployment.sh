#!/bin/bash

echo "🔍 배포 URL 전체 점검 시작..."
echo "==========================================\n"

# 1. GitHub Pages (GitHub.io)
echo "1️⃣ GitHub Pages: https://now4next.github.io/99wisdombook/"
GITHUB_CONTENT=$(curl -sL https://now4next.github.io/99wisdombook/ | head -1)
if echo "$GITHUB_CONTENT" | grep -q "Hello world"; then
    echo "   ❌ 상태: 'Hello world' (문제)"
elif echo "$GITHUB_CONTENT" | grep -q "<!DOCTYPE html>"; then
    echo "   ✅ 상태: HTML 콘텐츠 정상"
else
    echo "   ⚠️ 상태: 알 수 없음"
fi
echo ""

# 2. Custom Domain
echo "2️⃣ 커스텀 도메인: https://99wisdombook.org/"
CUSTOM_CONTENT=$(curl -sL https://99wisdombook.org/ | head -1)
if echo "$CUSTOM_CONTENT" | grep -q "Hello world"; then
    echo "   ❌ 상태: 'Hello world' (문제)"
elif echo "$CUSTOM_CONTENT" | grep -q "<!DOCTYPE html>"; then
    echo "   ✅ 상태: HTML 콘텐츠 정상"
else
    echo "   ⚠️ 상태: 알 수 없음"
fi

# Check headers
HEADERS=$(curl -I -s https://99wisdombook.org/ | grep -i server)
if echo "$HEADERS" | grep -q "cloudflare"; then
    echo "   🌐 서버: Cloudflare (Cloudflare Pages 또는 Proxy)"
elif echo "$HEADERS" | grep -i "github"; then
    echo "   🌐 서버: GitHub Pages"
fi
echo ""

# 3. Local Server
echo "3️⃣ 로컬 서버: https://8080-idqfnd1t6em6blrmi76he.sandbox.novita.ai/"
LOCAL_CONTENT=$(curl -sL https://8080-idqfnd1t6em6blrmi76he.sandbox.novita.ai/ 2>/dev/null | head -1)
if echo "$LOCAL_CONTENT" | grep -q "<!DOCTYPE html>"; then
    echo "   ✅ 상태: HTML 콘텐츠 정상"
else
    echo "   ⚠️ 상태: 알 수 없음 또는 접근 불가"
fi
echo ""

# 4. GitHub Raw File
echo "4️⃣ GitHub 원본 파일 확인"
RAW_TITLE=$(curl -sL "https://raw.githubusercontent.com/now4next/99wisdombook/main/index.html" | grep -o "<title>.*</title>" | head -1)
echo "   📄 index.html 제목: $RAW_TITLE"
if echo "$RAW_TITLE" | grep -q "살아본"; then
    echo "   ✅ 저장소: 올바른 한글 콘텐츠 포함"
else
    echo "   ❌ 저장소: 문제 있음"
fi
echo ""

echo "==========================================\n"
echo "📊 종합 분석:"
echo ""
echo "✅ = 정상 작동"
echo "❌ = 문제 발생 (Hello world 또는 잘못된 콘텐츠)"
echo "⚠️ = 확인 필요"
echo ""
echo "🔧 문제 해결 방법:"
echo "   - Cloudflare Pages 프로젝트 삭제 (https://dash.cloudflare.com/)"
echo "   - GitHub Pages 설정 확인 (https://github.com/now4next/99wisdombook/settings/pages)"
echo "   - Cloudflare 캐시 삭제 (Purge Everything)"
echo "   - DNS 레코드 확인 (A records to GitHub Pages IPs)"
echo ""

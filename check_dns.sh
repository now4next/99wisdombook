#!/bin/bash

echo "🔍 DNS 전파 확인 중..."
echo "================================"
echo ""

# 99wisdombook.org 확인
echo "1️⃣ 도메인: 99wisdombook.org"
RESPONSE=$(curl -sI https://99wisdombook.org/ 2>&1)

if echo "$RESPONSE" | grep -q "Could not resolve host"; then
    echo "   ❌ DNS 아직 전파 안됨 (호스트를 찾을 수 없음)"
elif echo "$RESPONSE" | grep -q "HTTP"; then
    echo "   ✅ DNS 전파 완료! 응답 받음"
    echo "$RESPONSE" | head -5
else
    echo "   ⚠️ 알 수 없는 상태"
fi

echo ""
echo "2️⃣ GitHub Pages 기본 URL 확인"
GH_RESPONSE=$(curl -sL https://now4next.github.io/99wisdombook/ 2>&1 | head -5)

if echo "$GH_RESPONSE" | grep -q "<!DOCTYPE html>"; then
    echo "   ✅ GitHub Pages 정상 배포됨"
elif echo "$GH_RESPONSE" | grep -q "404"; then
    echo "   ❌ GitHub Pages 404 오류"
else
    echo "   ⏳ GitHub Pages 아직 배포 안됨"
fi

echo ""
echo "================================"
echo "📝 다음 단계:"
echo "  1. DNS 전파 대기 (5-30분)"
echo "  2. https://dnschecker.org/#A/99wisdombook.org 에서 확인"
echo "  3. GitHub Pages 설정에서 'Check again' 클릭"
echo ""

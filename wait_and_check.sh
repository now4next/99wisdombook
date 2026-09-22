#!/bin/bash

echo "🔍 GitHub Pages 배포 상태 모니터링"
echo "=========================================="
echo ""

for i in {1..6}; do
    echo "[$i/6] 확인 중... ($(date '+%H:%M:%S'))"
    
    # GitHub Pages 확인
    CONTENT=$(curl -sL https://now4next.github.io/99wisdombook/ 2>/dev/null | head -5)
    
    if echo "$CONTENT" | grep -q "<!DOCTYPE html>"; then
        echo "✅ 성공! GitHub Pages 배포 완료"
        echo ""
        echo "📄 페이지 내용:"
        echo "$CONTENT" | head -10
        echo ""
        echo "🌐 확인 URL:"
        echo "  - https://now4next.github.io/99wisdombook/"
        exit 0
    elif echo "$CONTENT" | grep -q "404"; then
        echo "⏳ 아직 배포 중... (404 에러)"
    elif [ -z "$CONTENT" ]; then
        echo "⏳ 아직 배포 중... (응답 없음)"
    else
        echo "⚠️ 알 수 없는 응답"
    fi
    
    if [ $i -lt 6 ]; then
        echo "   30초 후 재시도..."
        echo ""
        sleep 30
    fi
done

echo ""
echo "⏰ 타임아웃: 3분 동안 배포가 완료되지 않음"
echo ""
echo "🔧 수동 확인 필요:"
echo "  1. GitHub Actions: https://github.com/now4next/99wisdombook/actions"
echo "  2. GitHub Pages 설정: https://github.com/now4next/99wisdombook/settings/pages"
echo ""

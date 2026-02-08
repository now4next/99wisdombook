#!/usr/bin/env python3
"""
언어 전환 기능 자동 테스트 스크립트
각 언어를 클릭하고 번역이 제대로 작동하는지 확인합니다.
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
import time
import sys

# 테스트할 URL
BASE_URL = "https://8080-idqfnd1t6em6blrmi76he-c07dda5e.sandbox.novita.ai"

# 테스트할 언어 목록
LANGUAGES = [
    {"code": "ar", "name": "عربي", "text": "Arabic"},
    {"code": "zh-CN", "name": "中文", "text": "Chinese"},
    {"code": "en", "name": "English", "text": "English"},
    {"code": "fr", "name": "Français", "text": "French"},
    {"code": "ru", "name": "Русский", "text": "Russian"},
    {"code": "es", "name": "Español", "text": "Spanish"},
    {"code": "ja", "name": "日本語", "text": "Japanese"},
    {"code": "ko", "name": "한국어", "text": "Korean"}
]

def setup_driver():
    """Chrome WebDriver 설정"""
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    
    # 로그 레벨 설정
    options.add_argument('--log-level=3')
    options.add_experimental_option('excludeSwitches', ['enable-logging'])
    
    try:
        driver = webdriver.Chrome(options=options)
        return driver
    except Exception as e:
        print(f"❌ WebDriver 초기화 실패: {e}")
        sys.exit(1)

def login_as_guest(driver):
    """게스트로 로그인"""
    try:
        print("\n🔐 게스트 로그인 중...")
        driver.get(BASE_URL)
        
        # 페이지 로드 대기
        time.sleep(2)
        
        # 게스트 링크 찾기 및 클릭
        guest_link = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.XPATH, "//a[contains(text(), '게스트로 둘러보기')]"))
        )
        guest_link.click()
        
        # book.html로 이동 대기
        WebDriverWait(driver, 10).until(
            EC.url_contains("book.html")
        )
        
        print("✅ 게스트 로그인 성공!")
        time.sleep(3)  # Google Translate 로드 대기
        
        return True
    except Exception as e:
        print(f"❌ 게스트 로그인 실패: {e}")
        return False

def test_language_switch(driver, lang):
    """특정 언어로 전환 테스트"""
    try:
        print(f"\n🔄 {lang['name']} ({lang['code']}) 테스트 중...")
        
        # 언어 링크 찾기
        lang_link = driver.find_element(By.XPATH, f"//a[@data-lang='{lang['code']}']")
        
        # 클릭 전 스크롤
        driver.execute_script("arguments[0].scrollIntoView();", lang_link)
        time.sleep(0.5)
        
        # 클릭
        lang_link.click()
        print(f"  ✓ {lang['name']} 링크 클릭 완료")
        
        # 번역 적용 대기
        time.sleep(4)
        
        # 브라우저 콘솔 로그 확인
        logs = driver.get_log('browser')
        relevant_logs = [log for log in logs if 'switchLanguage' in log.get('message', '') or 
                         '언어' in log.get('message', '') or 'Translate' in log.get('message', '')]
        
        if relevant_logs:
            print("  📋 콘솔 로그:")
            for log in relevant_logs[-3:]:  # 최근 3개만
                print(f"    {log.get('message', '')[:100]}")
        
        # Google Translate 셀렉트 박스 값 확인
        try:
            select_value = driver.execute_script(
                "return document.querySelector('.goog-te-combo') ? document.querySelector('.goog-te-combo').value : null;"
            )
            print(f"  📝 번역 셀렉트 값: {select_value}")
            
            if select_value == lang['code']:
                print(f"  ✅ {lang['name']} 전환 성공!")
                return True
            else:
                print(f"  ⚠️  {lang['name']} 전환 실패 (예상: {lang['code']}, 실제: {select_value})")
                return False
                
        except Exception as e:
            print(f"  ⚠️  셀렉트 박스 확인 실패: {e}")
            
            # 페이지 제목 또는 내용 변화 확인 (대안)
            page_title = driver.title
            print(f"  📄 페이지 제목: {page_title}")
            
            # active 클래스 확인
            is_active = driver.execute_script(
                f"return document.querySelector('a[data-lang=\"{lang['code']}\"]').classList.contains('active');"
            )
            
            if is_active:
                print(f"  ✅ {lang['name']} UI 상태 활성화됨")
                return True
            else:
                print(f"  ❌ {lang['name']} UI 상태 비활성화")
                return False
        
    except Exception as e:
        print(f"  ❌ {lang['name']} 테스트 실패: {e}")
        return False

def check_google_translate_status(driver):
    """Google Translate 상태 확인"""
    try:
        print("\n🔍 Google Translate 상태 확인...")
        
        status = driver.execute_script("""
            return {
                translationReady: typeof translationReady !== 'undefined' ? translationReady : null,
                googleExists: typeof google !== 'undefined',
                selectBoxExists: document.querySelector('.goog-te-combo') !== null,
                selectBoxValue: document.querySelector('.goog-te-combo') ? document.querySelector('.goog-te-combo').value : null
            };
        """)
        
        print(f"  - translationReady: {status['translationReady']}")
        print(f"  - google 객체 존재: {status['googleExists']}")
        print(f"  - 셀렉트 박스 존재: {status['selectBoxExists']}")
        print(f"  - 현재 언어 값: {status['selectBoxValue']}")
        
        return status
        
    except Exception as e:
        print(f"  ❌ 상태 확인 실패: {e}")
        return None

def main():
    """메인 테스트 실행"""
    print("=" * 60)
    print("🧪 언어 전환 기능 자동 테스트 시작")
    print("=" * 60)
    
    driver = setup_driver()
    results = {}
    
    try:
        # 1. 게스트 로그인
        if not login_as_guest(driver):
            print("\n❌ 로그인 실패로 테스트 종료")
            return
        
        # 2. Google Translate 상태 확인
        status = check_google_translate_status(driver)
        
        if not status or not status['translationReady']:
            print("\n⚠️  Google Translate가 준비되지 않았습니다.")
            print("   페이지를 다시 로드합니다...")
            driver.refresh()
            time.sleep(5)
            status = check_google_translate_status(driver)
        
        # 3. 각 언어 테스트
        print("\n" + "=" * 60)
        print("📝 언어별 전환 테스트")
        print("=" * 60)
        
        for lang in LANGUAGES:
            result = test_language_switch(driver, lang)
            results[lang['code']] = result
            time.sleep(2)  # 언어 간 전환 대기
        
        # 4. 결과 요약
        print("\n" + "=" * 60)
        print("📊 테스트 결과 요약")
        print("=" * 60)
        
        success_count = sum(1 for v in results.values() if v)
        total_count = len(results)
        
        print(f"\n성공: {success_count}/{total_count}")
        print("\n상세 결과:")
        for lang in LANGUAGES:
            status_icon = "✅" if results.get(lang['code']) else "❌"
            print(f"  {status_icon} {lang['name']:12s} ({lang['code']:5s})")
        
        # 5. 최종 판정
        print("\n" + "=" * 60)
        if success_count == total_count:
            print("🎉 모든 언어 전환 테스트 통과!")
        elif success_count >= total_count * 0.7:
            print(f"⚠️  일부 언어 테스트 실패 ({success_count}/{total_count})")
        else:
            print(f"❌ 대부분의 언어 테스트 실패 ({success_count}/{total_count})")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ 테스트 중 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        
    finally:
        print("\n🧹 정리 중...")
        driver.quit()
        print("✅ 테스트 완료!")

if __name__ == "__main__":
    main()

from playwright.sync_api import sync_playwright
import time

def capture_screenshots():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 1024})
        page = context.new_page()
        
        # 로그인 페이지 캡처
        print("📸 로그인 페이지 캡처 중...")
        page.goto('https://8080-idqfnd1t6em6blrmi76he-c07dda5e.sandbox.novita.ai/')
        page.wait_for_load_state('networkidle')
        time.sleep(1)
        page.screenshot(path='/home/user/webapp/screenshot_login.png', full_page=True)
        print("✅ 로그인 페이지 저장: screenshot_login.png")
        
        # 회원가입 탭 클릭 후 캡처
        print("📸 회원가입 페이지 캡처 중...")
        page.click('button[data-tab="signup"]')
        time.sleep(0.5)
        page.screenshot(path='/home/user/webapp/screenshot_signup.png', full_page=True)
        print("✅ 회원가입 페이지 저장: screenshot_signup.png")
        
        # 테스트 회원가입
        print("📝 테스트 계정 생성 중...")
        page.fill('#signup-name', '테스트 사용자')
        page.fill('#signup-email', 'test@example.com')
        page.fill('#signup-password', 'password123')
        page.fill('#signup-password-confirm', 'password123')
        page.check('#terms-agree')
        page.click('button[type="submit"]')
        time.sleep(2)
        
        # 로그인 탭으로 자동 이동된 후 로그인
        print("🔐 로그인 중...")
        page.fill('#login-password', 'password123')
        page.click('button[type="submit"]')
        time.sleep(1)
        
        # 책 페이지 캡처
        print("📸 책 페이지 캡처 중...")
        page.screenshot(path='/home/user/webapp/screenshot_book.png', full_page=False)
        print("✅ 책 페이지 저장: screenshot_book.png")
        
        browser.close()
        print("\n🎉 모든 스크린샷 캡처 완료!")

if __name__ == '__main__':
    capture_screenshots()

/**
 * i18n Translation System
 * 간단하고 빠른 자체 다국어 지원 시스템
 */

class I18nTranslator {
    constructor() {
        this.currentLang = 'ko';
        this.translations = {};
        this.supportedLanguages = ['ko', 'en', 'zh-CN', 'ja', 'es', 'fr', 'ru', 'ar'];
        this.loadedLanguages = new Set();
    }

    /**
     * 특정 언어의 번역 파일 로드
     */
    async loadLanguage(lang) {
        if (this.loadedLanguages.has(lang)) {
            console.log(`✅ 언어 이미 로드됨: ${lang}`);
            return this.translations[lang];
        }

        try {
            console.log(`📥 언어 파일 로드 중: ${lang}`);
            const response = await fetch(`translations/${lang}.json`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            this.translations[lang] = data;
            this.loadedLanguages.add(lang);
            console.log(`✅ 언어 로드 완료: ${lang}`);
            return data;
        } catch (error) {
            console.error(`❌ 언어 로드 실패: ${lang}`, error);
            return null;
        }
    }

    /**
     * 언어 전환 (즉시 페이지 번역)
     */
    async switchLanguage(lang) {
        console.log(`🔄 언어 전환: ${this.currentLang} → ${lang}`);
        
        // 지원하지 않는 언어 체크
        if (!this.supportedLanguages.includes(lang)) {
            console.error(`❌ 지원하지 않는 언어: ${lang}`);
            return false;
        }

        // 번역 파일 로드
        const translations = await this.loadLanguage(lang);
        if (!translations) {
            console.error(`❌ 번역 파일 로드 실패: ${lang}`);
            return false;
        }

        // 현재 언어 업데이트
        this.currentLang = lang;

        // 페이지 번역 적용
        this.applyTranslations(translations, lang);

        // 로컬 스토리지에 저장
        localStorage.setItem('preferredLanguage', lang);

        // 언어 방향 설정 (아랍어는 RTL)
        document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        document.documentElement.setAttribute('lang', lang);

        console.log(`✅ 언어 전환 완료: ${lang}`);
        return true;
    }

    /**
     * 페이지에 번역 적용
     */
    applyTranslations(translations, lang) {
        console.log('📝 번역 적용 중...');

        // data-i18n 속성을 가진 모든 요소 찾기
        const elements = document.querySelectorAll('[data-i18n]');
        
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            
            if (translations[key]) {
                // 텍스트 또는 HTML 업데이트
                if (element.hasAttribute('data-i18n-html')) {
                    element.innerHTML = translations[key];
                } else {
                    element.textContent = translations[key];
                }
            }
        });

        // 플레이스홀더 번역
        const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
        placeholders.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            if (translations[key]) {
                element.setAttribute('placeholder', translations[key]);
            }
        });

        // title 속성 번역
        const titles = document.querySelectorAll('[data-i18n-title]');
        titles.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            if (translations[key]) {
                element.setAttribute('title', translations[key]);
            }
        });

        console.log(`✅ ${elements.length}개 요소 번역 완료`);
    }

    /**
     * 현재 언어 가져오기
     */
    getCurrentLanguage() {
        return this.currentLang;
    }

    /**
     * 지원 언어 목록
     */
    getSupportedLanguages() {
        return this.supportedLanguages;
    }

    /**
     * 특정 키의 번역 가져오기
     */
    translate(key, lang = null) {
        const targetLang = lang || this.currentLang;
        
        if (this.translations[targetLang] && this.translations[targetLang][key]) {
            return this.translations[targetLang][key];
        }
        
        // Fallback to Korean
        if (this.translations['ko'] && this.translations['ko'][key]) {
            return this.translations['ko'][key];
        }
        
        return key; // Return key if translation not found
    }

    /**
     * 초기화 (저장된 언어 설정 불러오기)
     */
    async init() {
        console.log('🚀 i18n 시스템 초기화...');
        
        // 저장된 언어 설정 확인
        const savedLang = localStorage.getItem('preferredLanguage');
        
        // 브라우저 언어 감지
        const browserLang = navigator.language || navigator.userLanguage;
        const detectedLang = browserLang.split('-')[0];
        
        // 우선순위: 저장된 언어 > 브라우저 언어 > 기본(한국어)
        let initialLang = 'ko';
        
        if (savedLang && this.supportedLanguages.includes(savedLang)) {
            initialLang = savedLang;
        } else if (this.supportedLanguages.includes(detectedLang)) {
            initialLang = detectedLang;
        } else if (browserLang === 'zh-CN' || browserLang === 'zh-Hans') {
            initialLang = 'zh-CN';
        }

        console.log(`🌐 초기 언어: ${initialLang}`);
        console.log(`   - 저장된 언어: ${savedLang || '없음'}`);
        console.log(`   - 브라우저 언어: ${browserLang}`);

        // 한국어는 기본이므로 한국어가 아닌 경우에만 전환
        if (initialLang !== 'ko') {
            await this.switchLanguage(initialLang);
        } else {
            // 한국어 번역도 로드 (translate 함수 사용을 위해)
            await this.loadLanguage('ko');
        }

        console.log('✅ i18n 시스템 초기화 완료');
    }
}

// 전역 인스턴스 생성
const i18n = new I18nTranslator();

// 페이지 로드 시 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => i18n.init());
} else {
    i18n.init();
}

// 전역으로 export
window.i18n = i18n;

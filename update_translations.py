import json

# 각 언어별로 필요한 키-값 추가
translations_to_add = {
    "ja": {
        "page_title": "人生を生きてから初めて読める文章たち",
        "book_title": "人生を生きてから\\n初めて読める\\n文章たち",
        "book_subtitle": "Lines Life Taught Me",
        "logout": "ログアウト",
        "loading_translation": "翻訳中...",
        "section_opening": "はじめに",
        "opening_text": "この本は人生の知恵を含む99の文章を紹介します。人生で経験する様々な状況で必要な洞察を提供します。",
        "section_closing": "おわりに",
        "closing_text": "これらの文章が皆さんの人生に小さな知恵を加えることを願います。人生は経験を通じて学ぶものであり、これらの文章がその経験を理解するのに役立つことを願います。",
        "part1_title": "第1部. 経済と取引の法則",
        "chapter1_title": "1. この世にタダはない",
        "chapter1_text": "すべてには代価があります。無料に見えるものも、どこかでコストを支払っています。",
        "chapter2_title": "2. ハイリスク・ハイリターン",
        "chapter2_text": "大きな利益を得るには、大きなリスクを取る必要があります。投資と人生の基本原則です。",
        "content_omitted": "※ 第3~99章 省略 ※",
        "author": "カン・リムソンセン 著"
    },
    "es": {
        "page_title": "Frases que solo se leen después de vivir",
        "book_title": "Frases que solo\\nse leen después\\nde vivir",
        "book_subtitle": "Lines Life Taught Me",
        "logout": "Cerrar sesión",
        "loading_translation": "Traduciendo...",
        "section_opening": "Palabras de apertura",
        "opening_text": "Este libro presenta 99 frases que contienen sabiduría de vida. Proporciona conocimientos necesarios en diversas situaciones que experimentamos a lo largo de la vida.",
        "section_closing": "Palabras de cierre",
        "closing_text": "Espero que estas frases agreguen un poco de sabiduría a tu vida. La vida se trata de aprender a través de la experiencia, y espero que estas frases te ayuden a comprender esa experiencia.",
        "part1_title": "Parte 1. Leyes de economía y comercio",
        "chapter1_title": "1. No hay almuerzo gratis",
        "chapter1_text": "Todo tiene un costo. Incluso las cosas que parecen gratuitas tienen un precio pagado en algún lugar.",
        "chapter2_title": "2. Alto riesgo, alto retorno",
        "chapter2_text": "Para obtener grandes ganancias, debes asumir grandes riesgos. Este es un principio fundamental de la inversión y la vida.",
        "content_omitted": "※ Capítulos 3-99 Omitidos ※",
        "author": "por Kang Lim Seonsaeng"
    },
    "fr": {
        "page_title": "Phrases qui ne se lisent qu'après avoir vécu",
        "book_title": "Phrases qui ne\\nse lisent qu'après\\navoir vécu",
        "book_subtitle": "Lines Life Taught Me",
        "logout": "Déconnexion",
        "loading_translation": "Traduction en cours...",
        "section_opening": "Mots d'ouverture",
        "opening_text": "Ce livre présente 99 phrases contenant la sagesse de la vie. Il fournit des perspectives nécessaires dans diverses situations que nous vivons tout au long de notre vie.",
        "section_closing": "Mots de clôture",
        "closing_text": "J'espère que ces phrases ajouteront un peu de sagesse à votre vie. La vie consiste à apprendre par l'expérience, et j'espère que ces phrases vous aideront à comprendre cette expérience.",
        "part1_title": "Partie 1. Lois de l'économie et du commerce",
        "chapter1_title": "1. Rien n'est gratuit dans le monde",
        "chapter1_text": "Tout a un coût. Même les choses qui semblent gratuites ont un prix payé quelque part.",
        "chapter2_title": "2. Risque élevé, rendement élevé",
        "chapter2_text": "Pour obtenir de grands profits, vous devez prendre de grands risques. C'est un principe fondamental de l'investissement et de la vie.",
        "content_omitted": "※ Chapitres 3-99 Omis ※",
        "author": "par Kang Lim Seonsaeng"
    },
    "ru": {
        "page_title": "Фразы, которые читаются только после жизни",
        "book_title": "Фразы, которые\\nчитаются только\\nпосле жизни",
        "book_subtitle": "Lines Life Taught Me",
        "logout": "Выйти",
        "loading_translation": "Перевод...",
        "section_opening": "Вступительные слова",
        "opening_text": "Эта книга представляет 99 фраз, содержащих жизненную мудрость. Она предоставляет понимание, необходимое в различных ситуациях, которые мы переживаем на протяжении жизни.",
        "section_closing": "Заключительные слова",
        "closing_text": "Надеюсь, что эти фразы добавят немного мудрости в вашу жизнь. Жизнь - это обучение через опыт, и я надеюсь, что эти фразы помогут вам понять этот опыт.",
        "part1_title": "Часть 1. Законы экономики и торговли",
        "chapter1_title": "1. В мире нет ничего бесплатного",
        "chapter1_text": "У всего есть своя цена. Даже то, что кажется бесплатным, где-то оплачивается.",
        "chapter2_title": "2. Высокий риск, высокая прибыль",
        "chapter2_text": "Чтобы получить большую прибыль, вы должны взять на себя большой риск. Это основной принцип инвестиций и жизни.",
        "content_omitted": "※ Главы 3-99 Опущены ※",
        "author": "Канг Лим Сонсэнг"
    },
    "ar": {
        "page_title": "جمل تُقرأ فقط بعد العيش",
        "book_title": "جمل تُقرأ فقط\\nبعد العيش",
        "book_subtitle": "Lines Life Taught Me",
        "logout": "تسجيل الخروج",
        "loading_translation": "جاري الترجمة...",
        "section_opening": "كلمات افتتاحية",
        "opening_text": "يقدم هذا الكتاب 99 جملة تحتوي على حكمة الحياة. يوفر رؤى ضرورية في مختلف المواقف التي نواجهها في حياتنا.",
        "section_closing": "كلمات ختامية",
        "closing_text": "آمل أن تضيف هذه الجمل القليل من الحكمة إلى حياتك. الحياة هي التعلم من خلال التجربة، وآمل أن تساعدك هذه الجمل على فهم تلك التجربة.",
        "part1_title": "الجزء 1. قوانين الاقتصاد والتجارة",
        "chapter1_title": "1. لا يوجد غداء مجاني",
        "chapter1_text": "كل شيء له ثمن. حتى الأشياء التي تبدو مجانية لها تكلفة مدفوعة في مكان ما.",
        "chapter2_title": "2. مخاطر عالية، عائد عالي",
        "chapter2_text": "للحصول على أرباح كبيرة، يجب أن تتحمل مخاطر كبيرة. هذا مبدأ أساسي للاستثمار والحياة.",
        "content_omitted": "※ الفصول 3-99 محذوفة ※",
        "author": "بواسطة كانغ ليم سونسينغ"
    },
    "zh-CN": {
        "page_title": "只有生活过后才能读懂的句子",
        "book_title": "只有生活过后\\n才能读懂的\\n句子",
        "book_subtitle": "Lines Life Taught Me",
        "logout": "登出",
        "loading_translation": "翻译中...",
        "section_opening": "开篇语",
        "opening_text": "本书介绍了包含人生智慧的99个句子。它为我们在人生中经历的各种情况提供了必要的洞察。",
        "section_closing": "结语",
        "closing_text": "希望这些句子能为你的生活增添一点智慧。人生就是通过经验学习，我希望这些句子能帮助你理解这些经验。",
        "part1_title": "第1部. 经济与交易法则",
        "chapter1_title": "1. 世上没有免费的午餐",
        "chapter1_text": "一切都是有代价的。即使看起来免费的东西，在某个地方也付出了成本。",
        "chapter2_title": "2. 高风险，高回报",
        "chapter2_text": "要获得巨大收益，就必须承担巨大风险。这是投资和人生的基本原则。",
        "content_omitted": "※ 第3-99章省略 ※",
        "author": "姜林先生 著"
    }
}

# 각 언어 파일 업데이트
for lang, new_keys in translations_to_add.items():
    file_path = f"translations/{lang}.json"
    
    try:
        # 기존 파일 읽기
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 새로운 키 추가/업데이트
        data.update(new_keys)
        
        # 파일 저장
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"✅ {lang}.json 업데이트 완료")
    
    except Exception as e:
        print(f"❌ {lang}.json 업데이트 실패: {e}")

print("\n✅ 모든 번역 파일 업데이트 완료!")

# Forever Exit — исследование собственников, агентов, взаимодействия и монетизации

Дата: 2026-08-03  
Статус: Research record; продуктовая стратегия утверждена отдельно в `docs/FOREVER_EXIT_001.md`  
Класс риска: R0

> Это не юридическая консультация. Все правовые выводы требуют письменного подтверждения лицензированного тайского адвоката до реализации или публичного использования.

## 1. Метод

Исследование охватывает 11 направлений международного рынка и два адверсариальных прохода по первоисточникам.

Градация источников:

| Градация | Источник | Допустимое использование |
| --- | --- | --- |
| A | закон, госорган, рецензируемое исследование, крупный независимый опрос | порог, ограничение, риск |
| B | официальная документация продукта, годовой отчёт, регулятор | доказательство того, что система делает |
| C | help-центр, юрфирма, отраслевая пресса | определение, форма, рабочая гипотеза |
| D | маркетинговое утверждение без методологии | не использовать как основание решения |

## 2. Исследованные модели

### A. Мандатный реестр

Продаётся не видимость, а право платформы публиковать конкретный объект. Без действующего мандата публичное предложение отсутствует.

Сильные стороны:

- fail-closed;
- защита от фальшивых и устаревших предложений;
- понятная атрибуция мандатодержателя;
- совместимость с единым объектом/юнитом без дублей.

Вывод: принять как обязательную инфраструктуру Forever Exit, а не как самостоятельный платный продукт.

### B. Hemnet — собственник платит за видимость

Модель работает при почти полном национальном покрытии и высокой ликвидности площадки.

Вывод: отклонить для ранней стадии Forever. При нулевом покрытии платная видимость не создаёт ценности и конфликтует с запретом превращать Forever в массовый listing portal.

### C. Эксклюзивный success-fee брокеридж

Модель продаёт результат и монетизируется первой закрытой сделкой.

Вывод: принять success fee как начальную экономику. Не строить собственную широкую штатную агентскую сеть; использовать действующую брокерскую операцию и позже прозрачный co-broker split.

### D. Протокол ко-брокериджа

Модель продаёт правила совместной сделки: единый ID объекта, роли, сплит, история и рейтинг.

Вывод: перспективно позже, но слишком рано до появления контролируемого инвентаря и повторяемых сделок. Не вводить принудительное правило «обязан разместить у Forever».

### E. Assignment Desk

Платформа обслуживает выход инвестора из off-plan до передачи.

Сильные стороны:

- остаётся внутри Phuket new developments;
- не требует массового трафика;
- может использовать спрос, который Forever уже видит;
- дополняет страх `resale & liquidity` в Navigator реальным ответом;
- поддерживает evidence-led disclosure.

Вывод: принять как первый транзакционный продукт внутри `FOREVER-EXIT-001`.

### F. Exit Passport

Продаётся доказательство: форма права, дата, источник, статус квоты, остаток аренды, FET, условия assignment, известные расходы и явно отсутствующие данные.

Вывод: принять как доказательный слой и lead magnet (`Exit Check`), а не как замену мандату и брокерской работе.

## 3. Главный продуктовый вывод

Дефицит Пхукета не сводится к отсутствию информации. Информация ходит между агентами, но редко соединяется с покупателем, который уже выбирает конкретный проект.

Forever имеет обратное преимущество:

```text
реальный спрос по проекту
→ поиск собственника/инвестора на выход
→ мандат на конкретный юнит
→ сравнение developer inventory и investor exit
→ закрытая сделка
```

Поэтому продукт строится demand-first, а не inventory-first.

## 4. Коррекции первоначальных гипотез

1. **Не делать базу assignment-условий отдельным главным продуктом.** Это полезные поля и evidence, но не причина, по которой клиент приходит.
2. **Не считать информацию о цене выхода уникальным дефицитом.** Ценность появляется только при наличии мандата и реального спроса.
3. **Не создавать отдельный раздел переуступок на старте.** Показывать exit второй ценой внутри проекта/юнита и по прямой ссылке.
4. **Не использовать 20-SPA review как permission gate.** Выборка договоров полезна для доказательств, но roadmap должен опираться на одну реальную ручную сделку и юридически подтверждённый workflow, чтобы не задерживать каталог и рынок.
5. **Не утверждать публично абсолютный нулевой расход assignment.** Land Office transfer stack обычно не применяется к цессии, но договорные/developer fees и конкретные правовые условия должны подтверждаться по документам и юридическому заключению.
6. **Не публиковать личные и юридические документы собственника по Owner Direct Publication policy.** SPA, mandate, payment evidence, FET, title и quota evidence — private evidence; публичными являются только safe derived fields и отдельно выбранные public materials.

## 5. Что усиливает исходную идею

### 5.1 Ownership & Exit Loop

Assignment Desk расширяется до последовательности:

```text
Ownership Record
→ private Exit Intent
→ signed Mandated Exit Offer
→ demand-first Exit Match
→ Exit Passport
→ transaction and verified comparable
```

Это превращает разовую продажу в долгую клиентскую связь и помогает существующим покупателям.

### 5.2 Две новые точки привлечения клиентов

На проектных страницах позже должны появиться:

- `I own a unit in this project / Я владелец юнита в этом проекте`;
- `Notify me about investor exits / Сообщить о выходах инвесторов`.

Первая создаёт seller/owner leads. Вторая создаёт buyer demand before public inventory exists.

### 5.3 Exit Check

Бесплатный первичный результат для собственника:

- возможен ли assignment/resale;
- что уже оплачено;
- что осталось оплатить;
- какие документы отсутствуют;
- известные договорные fees;
- грубый диапазон net outcome только при достаточных подтверждённых данных.

Exit Check ведёт к мандату. Платный standalone Exit Passport можно тестировать позже и включать в эксклюзивный мандат.

### 5.4 Unit identity without onboarding delay

Предложение должно быть связано с конкретным юнитом. Когда полный unit inventory ещё не загружен, Owner может создать минимальный canonical unit stub; это не должно блокировать быстрый 100+ project catalogue и не должно создавать свободный duplicate listing.

## 6. Рынок и международные паттерны

Полезные официальные/продуктовые ориентиры:

- Hemnet показывает, что owner-paid visibility требует почти полного покрытия и не является стартовой моделью Forever: https://www.hemnetgroup.se/en/media/press-releases/2026/hemnet-publishes-annual-and-sustainability-report-for-2025/
- FazWaz Premium подтверждает success-fee и exclusive urgency tiers как применимый коммерческий паттерн: https://www.fazwaz.co.th/en/fazwaz-premium
- DLD Trakheesi/Form A показывает mandate-gated ad permission, но нормы Дубая нельзя переносить в Таиланд без юридического основания: https://dubailand.gov.ae/en/eservices/real-estate-ad-permit/
- Zillow Owner Dashboard, Rightmove Track My Property, Homebot и Mosaik подтверждают отдельную продуктовую категорию пост-покупочного homeowner engagement:
  - https://www.zillow.com/z/owner-dashboard/
  - https://www.rightmove.co.uk/guides/track-your-property/
  - https://homebot.ai/real-estate-agents
  - https://mosaik.io/blog/homeowner-portals-post-closing

Forever не копирует эти продукты. Его преимущество — Phuket project context, verified owner mandate and live buyer demand.

## 7. Правовые и privacy ограничения

До реализации требуется письменное заключение по:

- тайским ограничениям на brokerage/front-office roles;
- структуре операционного юрлица и FBA;
- assignment/mandate mechanics;
- developer SPA restrictions;
- transfer/tax calculations;
- Royal Decree 342 before any public SBT calculator;
- Digital Platform Services applicability;
- PDPA roles, DPO, RoPA and notice-and-takedown.

Platform escrow, client-money custody and public owner registration are excluded.

## 8. Непроверенное — запрещено превращать в публичный факт

- точный объём assignment market Phuket;
- медианный срок экспозиции resale;
- универсальная Phuket commission rate;
- универсальный assignment fee;
- публичный 5-year SBT calculator without authoritative confirmation;
- universal developer-consent rule;
- DLD «maximum three brokers» claim;
- exact transfer-fee calculation basis when sources conflict.

## 9. Решение

Исследование поддерживает `FOREVER-EXIT-001` как продукт, который подходит Forever без изменения North Star.

Начать немедленно можно только с операционных действий:

1. buyer↔unit register;
2. lawyer-reviewed mandate;
3. one manual exit transaction;
4. private demand log;
5. DPO/privacy operating records.

Продуктовый код следует после стабильной ordinary Studio publication и не должен задерживать `FOREVER-STUDIO-FAST-PROJECT-ONBOARDING-001` или цель 100+ проектов.

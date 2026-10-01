# Итоги исследования: готовые решения и требования Республики Казахстан

Дата: 01.10.2026. Исследование провела команда из трёх агентов, которые работали параллельно: мессенджеры; задачи, документы и согласование; правовые требования РК. Данные GitHub (звёзды, активность) приведены на эту дату. Пометка **[не подтверждено]** означает, что факт не удалось проверить по первоисточнику.

## 1. Вывод

Ни один открытый продукт не закрывает связку «чат → задачи → решения с подтверждением → протоколы и приказы → согласование → контроль исполнения» с учётом требований РК (казахский язык, локализация данных, будущая ЭЦП НУЦ РК).

Принято решение разработать **собственное единое приложение**. Для генерации документов и конвертации в PDF используются готовые открытые компоненты (docxtemplater, Gotenberg), для будущей ЭЦП — NCALayer и NCANode.

## 2. Мессенджеры для развёртывания на своём сервере

| Продукт | Лицензия и ограничения | Мобильные приложения и push на своём сервере | RU / KZ | Задачи и подтверждения | Почему не выбран |
|---|---|---|---|---|---|
| [Mattermost](https://github.com/mattermost/mattermost) (39k ★) | Team Edition — до 250 пользователей. Бесплатная Entry — 50 пользователей и видимы только последние 10 000 сообщений | iOS/Android. Бесплатный push-сервис только тестовый, для работы нужен свой push-proxy | RU есть, KZ нет | Треды, Playbooks. «Request acknowledgement» — только в платной Professional | Подтверждение платное, нет казахского, нет документов |
| [Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) (46k ★) | Starter бесплатен до 50 пользователей | iOS/Android. В Community 10 000 push-уведомлений в месяц через облако вендора | RU есть, KZ нет | Треды, обсуждения. Отметки о прочтении — не в Community | Лимит 50 пользователей равен стартовой численности |
| [Zulip](https://github.com/zulip/zulip) (26k ★) | Apache-2.0, всё открыто | iOS/Android. Push через сервис Zulip бесплатен до 10 пользователей, дальше платно | RU есть, **KZ есть** | Темы, опросы, списки дел, отметки о прочтении, напоминания | Лучший из готовых, но это второе приложение, push через зарубежный сервис, нет документов |
| Matrix: [Synapse](https://github.com/element-hq/synapse) + Element | AGPL-3.0 | Push через matrix.org; для полной автономии нужны свой Sygnal и свои сборки приложений | RU есть, KZ [не подтверждено] | Треды, опросы. Подтверждений и чек-листов нет | Самый сложный в эксплуатации |
| [Huly](https://github.com/hcengineering/platform) (28k ★) | EPL-2.0 | [не подтверждено] | RU есть | Чат, трекер и документы вместе | Репозиторий заморожен, разработка перешла в сообщество; тяжёлый стек |
| [Tinode](https://github.com/tinode/chat) (13k ★) | GPL-3.0 / Apache-2.0 | Нативные приложения | RU есть | Простой мессенджер | Нет задач и документов |
| [Nextcloud Talk](https://github.com/nextcloud/spreed) | AGPL | Есть | RU есть | Опросы; задачи — в Deck | Требует весь Nextcloud |

**Перенос из WhatsApp** — обзор вариантов:
- **Импорт экспорта чата** (.zip с .txt и медиа) с конвертацией. Это самый надёжный путь, его и закладываем в ТЗ (раздел 3.9). Готовые конвертеры сырые (например, [witchi/whatsapp-mattermost](https://github.com/witchi/whatsapp-mattermost)), формат простой — пишем свой парсер.
- **Мост [mautrix-whatsapp](https://github.com/mautrix/whatsapp)** (только Matrix) и [Matterbridge](https://github.com/42wim/matterbridge) работают через неофициальный протокол WhatsApp Web: есть риск блокировки номера, это нарушает условия WhatsApp. Не используем.
- **WhatsApp Business Cloud API** предназначен только для переписки с клиентами и не читает существующие группы. Не подходит.

## 3. Задачи, рабочие пространства, документы

**Управление проектами.** [Plane](https://github.com/makeplane/plane), [OpenProject](https://github.com/opf/openproject), [Redmine](https://github.com/redmine/redmine), [Leantime](https://github.com/Leantime/leantime), [Kanboard](https://github.com/kanboard/kanboard), [WeKan](https://github.com/wekan/wekan), [Vikunja](https://github.com/go-vikunja/vikunja), [Taiga](https://github.com/taigaio/taiga-back):
- нигде нет RACI «из коробки»;
- представление загрузки по нескольким проектам в бесплатных версиях отсутствует (в OpenProject — только Enterprise, в Plane — платные тарифы);
- [Focalboard](https://github.com/mattermost-community/focalboard) официально не поддерживается.

**Рабочие пространства «всё в одном».** Nextcloud Hub (Talk + Deck + ONLYOFFICE/Collabora) силён в файлах, слаб в проектах. Huly — см. выше. AppFlowy, AFFiNE, Outline, Docmost — базы знаний, не подходят. Twake устарел.

**Генерация документов:**

| Компонент | Лицензия | Решение |
|---|---|---|
| [docxtemplater](https://github.com/open-xml-templating/docxtemplater) | Ядро MIT (подстановки, циклы, условия, строки таблиц); изображения и HTML — платные модули | **Используем ядро** (стек TypeScript) |
| [python-docx-template](https://github.com/elapouya/python-docx-template) | LGPL-2.1 | Альтернатива, если понадобится Python-сервис |
| [Gotenberg](https://github.com/gotenberg/gotenberg) | MIT | **Используем** для DOCX → PDF |
| [Carbone](https://github.com/carboneio/carbone) | CCL, не OSI | Не используем |
| [ONLYOFFICE Docs](https://github.com/ONLYOFFICE/DocumentServer) | AGPL-3.0, лимит подключений в бесплатной версии [не подтверждено] | Возможно позже для редактирования в браузере |

**Согласование и документооборот.** BPMN-движок [Flowable](https://github.com/flowable/flowable-engine) (Apache-2.0) избыточен для ~50 пользователей: маршруты реализуем простым конечным автоматом в API. Лицензия Camunda 8 не открытая. Открытых СЭД под РК/РФ с активной разработкой не найдено. [DocuSeal](https://github.com/docusealco/docuseal) не поддерживает ЭЦП НУЦ РК.

## 4. Требования Республики Казахстан

| Тема | Суть | Источник |
|---|---|---|
| Локализация ПДн | Базы с ПДн — на территории РК (ст. 12 п. 2) | [Закон №94-V](https://adilet.zan.kz/rus/docs/Z1300000094) |
| Изменения ПДн 2024–2026 | Уведомление об утечке за 1 рабочий день; Закон №326-VIII (с 24.06.2026): уведомление о начале обработки, право на блокирование, обезличивание и удаление; новые Правила сбора и обработки с 02.10.2026 | [обзор](https://actgr.kz/tpost/vd8ayp4nc1-chto-izmenilos-v-zakonodatelstve-o-perso) [не подтверждено по тексту закона] |
| Мессенджеры | С 15.09.2025 госслужащие переведены на национальный мессенджер Aitu. Приказ №343/НҚ (с 12.07.2026) — для госсектора и квазигоссектора только мессенджеры с серверами в РК. Для частного центра формально не обязателен, но собственная система ему соответствует | [kazpravda](https://kazpravda.kz/n/utverzhdena-data-perehoda-gossluzhashchih-na-natsionalnyy-messendzher-aitu/), [azh.kz](https://azh.kz/ru/news/view/129521) [текст приказа не найден] |
| ИКТ и ИБ | ПП №832 обязательно для госорганов и квазигоссектора; испытания ГТС — для интернет-ресурсов госорганизаций. Частному центру — как ориентир | [ПП №832](https://adilet.zan.kz/rus/docs/P1600000832), [synaq.sts.kz](https://synaq.sts.kz/) |
| ЭЦП | Электронный документ с ЭЦП равнозначен бумажному (ст. 7, 10). Подписание через NCALayer (`wss://127.0.0.1:13579`), клиент [ncalayer-js-client](https://github.com/sigex-kz/ncalayer-js-client); проверка — [NCANode](https://github.com/ncanode-kz/NCANode) (MIT, нужны библиотеки Kalkan); QR через eGov mobile — [SIGEX](https://sigex.kz/support/developers/api-egov-basic/) (коммерческий) | Закон №370-II |
| СЭД | ЕСЭДО — для госорганов; коммерческие СЭД (например, Documentolog) интегрируются через DOC24. Внутренние документы можно вести в собственной системе | [documentolog.com](https://documentolog.com/) |
| Языки | Делопроизводство — на казахском, русский официально употребляется наравне. Интерфейс и шаблоны должны быть на kk/ru | Закон «О языках в РК», ст. 8–9 |
| Хостинг в РК | QazCloud (группа Казахтелеком), PS Cloud Services, Transtelecom, Hoster.kz, KZ-регионы VK Cloud и Yandex Cloud; либо сервер центра | [ps.kz](https://www.ps.kz/company/about) |

## 5. Что проверить юристу центра

1. Действующую редакцию Закона №94-V после изменений 2026 года и обязанность уведомлять о начале обработки ПДн.
2. Распространяется ли приказ №343/НҚ на частные медицинские организации (по текущим данным — нет).
3. Допустимость Web Push через сервисы Google и Apple при передаче уведомления без содержимого.
4. Формы согласия сотрудников на обработку ПДн.

# Google Branding

Стан на 26 листопада 2026 року, Київ. Підготовлені HTML-чернетки збережено в цьому репозиторії.

| Поле Google Branding | Чернетка на GitHub | Шлях після публікації |
| --- | --- | --- |
| Application home page | [Про Вершину](branding/about.html) | `/about` |
| Application privacy policy link | [Політика конфіденційності](branding/privacy.html) | `/privacy` |
| Application terms of service link | [Умови користування](branding/terms.html) | `/terms` |

Файли лежать у `docs/branding/`. Це чернетки з умовною адресою підтримки `support@example.test`. Публікація на Railway і подача на перевірку Google ще попереду. Власного домену для Вершини поки немає.

Перед публікацією погодити тексти й контакт підтримки. Підключити домен із доступом до DNS до чинного сервісу Railway, підтвердити його в Google Search Console та додати в Google Auth Platform. Розгорнути погоджені сторінки, перевірити їх без входу й оновити адреси повернення OAuth. У Google Branding вказати публічні HTTPS-адреси сторінок. [Довідка Google](https://support.google.com/cloud/answer/15549049).

# edu

مستودع مشروع **edu**. تطبيق تمهيدي مبني بـ Express وواجهة ثابتة، مع اختبارات Playwright. واجهة OAuth المذكورة مسار تجريبي فقط ولا تنفذ تسجيل دخول حقيقيًا.

## البدء

يتطلب Node.js 20 أو أحدث وnpm.

```bash
npm ci
npm start
```

افتح `http://localhost:3000`، أو اختبر حالة الخدمة على `http://localhost:3000/api/health`. لتغيير المنفذ، اضبط المتغير `PORT`.

يستخدم الخادم حاليًا `helmet`، وتحديد حجم JSON إلى `100kb`، ومحدد معدل للطلبات على مسارات `/api`. أضيفت بنية GitHub OAuth وSupabase اختيارية؛ تعمل الخدمة الأساسية بدون أسرار، بينما تعيد مسارات المصادقة `503` حتى تُضبط متغيرات البيئة المطلوبة.

## المصادقة وقاعدة البيانات

يعتمد Stage 2 على GitHub OAuth وجلسات opaque tokens محفوظة كـ hashes داخل HttpOnly cookies. طبّق `supabase/schema.sql` على مشروع Supabase، ثم اضبط القيم الموجودة في `.env.production.example` (خصوصًا `SUPABASE_SERVICE_ROLE_KEY` الذي يجب أن يبقى على الخادم فقط). سجّل `GITHUB_CALLBACK_URL` نفسه في تطبيق GitHub OAuth. لا تُستخدم JWT في هذا التدفق.

## الفحوصات

```bash
python3 scripts/check_repo.py
npm run test:e2e:install
npm run test:e2e
```

تعمل الفحوصات واختبارات Chromium تلقائيًا في GitHub Actions عند فتح Pull Request أو الدفع إلى `main`. يحدث Dependabot اعتماديات npm وGitHub Actions أسبوعيًا. لا توجد قاعدة بيانات أو خدمة Supabase أو مصادقة OAuth مفعلة بعد؛ الاعتماديات المجهزة لا تعني أن هذه الميزات موجودة.

راجع [دليل إعداد GitHub](GITHUB_SETUP.md) للخطوات الاختيارية في إعدادات المستودع والاستفادة من الخطة المجانية.

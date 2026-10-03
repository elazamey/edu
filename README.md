# edu — Nexus Agent Platform

مستودع مشروع **edu** (منصة **Nexus Agent Platform**). تطبيق مبني بـ Express 5 وواجهة تفاعلية يمثل الأساس المعماري للمنصة (**Stage 4 & 4.1 Foundation**)، مع نظام مصادقة وجلسات محمية، وعزل بيانات متعدد المستخدمين، وطبقة تخزين محلية بصيغة JSON، واختبارات Playwright.

## المزايا والحدود المعمارية الحالية (Stage 4 & Stage 4.1 Hardening)

- **طبقة التخزين المحلي (`server/store.js`)**:
  - تخزين JSON ذري لعملية واحدة (`data/nexus-db.json` أو عبر `DATABASE_PATH`) مع نسخ احتياطي تلقائي (`.bak`).
  - **حماية Fail-Closed ضد تلف البيانات**: في حال تلف ملف JSON، يرفض الخادم الكتابة فوق الملف التالف أو تصفيره بصمت، وينشئ نسخة معزولة (`.corrupt.<timestamp>.bak`) ويرمي خطأ `StoreCorruptionError`.
  - مناسب للبيئات المحلية أو النشر أحادي العملية؛ التوسع متعدد العمليات يتطلب قاعدة بيانات خارجية في مراحل لاحقة.
- **المصادقة وإدارة الجلسات (`server/auth.js`)**:
  - تسجيل الحسابات (`POST /api/auth/register`) وتسجيل الدخول (`POST /api/auth/login`) بتجزئة `crypto.scryptSync` ومقارنة زمنية ثابتة `timingSafeEqual`، مع كوكيز جلسات موقعة بـ `HMAC-SHA256` (`HttpOnly`, `SameSite=Lax`).
  - **Fail-Closed في الإنتاج**: عند ضبط `NODE_ENV=production`، يرفض الخادم التشغيل ما لم يُضبط `SESSION_SECRET` أو `JWT_SECRET` بطول لا يقل عن 32 حرفًا.
  - **تعطيل الدخول التجريبي في الإنتاج**: المسار `POST /api/auth/github/demo` مخصص للتطوير والاختبار فقط، ويُعطّل تلقائيًا (`403 Forbidden`) في `NODE_ENV=production`. مصادقة GitHub OAuth الحقيقية غير منفذة بعد (`oauthImplemented: false`).
- **عزل المستخدمين وصلاحيات الوصول (`Multi-User Authorization`)**:
  - مسارات `GET /api/tasks` و`GET /api/chat` محمية بـ `requireAuth` وتعيد فقط المهام والمحادثات الخاصة بالمستخدم الحالي (`ownerId`).
  - عمليات تعديل أو تشغيل أو حذف المهام (`PATCH / DELETE / RUN`) تتحقق من ملكية المستخدم (`task.ownerId === req.user.id`) وترد بـ `403 Forbidden` عند محاولة الوصول لمهام مستخدم آخر.
- **محرك الوكلاء (`server/agent-engine.js`)**:
  - يعمل حاليًا كمحرك تنسيق قياسي محلي (**Deterministic Orchestration Mock**) لمرحلة التأسيس (Stage 4)، ولا يتصل بمزود ذكاء اصطناعي خارجي (Real AI Provider Gateway مخطط في Stage 5).

## البدء

يتطلب Node.js 20 أو أحدث وnpm.

```bash
npm ci
npm start
```

افتح `http://localhost:3000`، أو اختبر حالة الخدمة على `http://localhost:3000/api/health` وحالة التخزين على `http://localhost:3000/api/db/status`. لتغيير المنفذ، اضبط المتغير `PORT`.

## الفحوصات والاختبارات

```bash
python3 scripts/check_repo.py
npm run test:e2e:install
npm run test:e2e
```

تعمل الفحوصات واختبارات Chromium تلقائيًا في workflow `Repository checks` على GitHub Actions عند فتح Pull Request أو الدفع إلى `main`. راجع [دليل إعداد GitHub](GITHUB_SETUP.md) للخطوات الاختيارية والنشر على Render.

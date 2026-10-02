# edu — Nexus Agent Platform

مستودع مشروع **edu** (منصة **Nexus Agent Platform**). تطبيق متكامل مبني بـ Express 5 وواجهة تفاعلية مع نظام مصادقة وجلسات آمنة، وطبقة تخزين بيانات مستدامة، ومسارات لإدارة الوكلاء الأذكياء والمهام والمحادثات، مع اختبارات Playwright شاملة.

## المزايا الرئيسية (المرحلة الرابعة — Stage 4)

- **طبقة البيانات والتخزين (`server/store.js`)**: تخزين مستدام بصيغة JSON ذري (`data/nexus-db.json` أو عبر المتغير `DATABASE_PATH`) مع تهيئة تلقائية للوكلاء الافتراضيين وفحص جاهزية قاعدة البيانات عبر `/api/db/status`.
- **المصادقة وإدارة الجلسات (`server/auth.js`)**: تسجيل حسابات جديدة (`/api/auth/register`)، تسجيل الدخول (`/api/auth/login`) بتجزئة كلمات المرور عبر `crypto.scryptSync`، وجلسات موقعة عبر كوكيز `HttpOnly`، بالإضافة إلى وضع الدخول السريع التجريبي (`/api/auth/github/demo`) وتسجيل الخروج (`/api/auth/logout`).
- **نواة وكلاء Nexus والواجهة التفاعلية (`server/agent-engine.js`, `public/`)**:
  - استعراض وإضافة وكلاء جدد (`GET /api/agents`, `POST /api/agents`).
  - إنشاء المهام وتصفيتها وتشغيلها عبر الوكيل المختار وحذفها (`GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/:id/run`, `DELETE /api/tasks/:id`).
  - وحدة محادثة تفاعلية مع الوكلاء وحفظ السجل (`GET /api/chat`, `POST /api/chat`).

## البدء

يتطلب Node.js 20 أو أحدث وnpm.

```bash
npm ci
npm start
```

افتح `http://localhost:3000`، أو اختبر حالة الخدمة على `http://localhost:3000/api/health` وحالة قاعدة البيانات على `http://localhost:3000/api/db/status`. لتغيير المنفذ، اضبط المتغير `PORT`.

## الفحوصات والاختبارات

```bash
python3 scripts/check_repo.py
npm run test:e2e:install
npm run test:e2e
```

تعمل الفحوصات واختبارات Chromium تلقائيًا في GitHub Actions عند فتح Pull Request أو الدفع إلى `main`. راجع [دليل إعداد GitHub](GITHUB_SETUP.md) للخطوات الاختيارية في إعدادات المستودع والنشر على Render.

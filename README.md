# edu — Nexus Agent Platform

مستودع مشروع **edu** (منصة **Nexus Agent Platform**). تطبيق مبني بـ Express 5 وواجهة تفاعلية يغطي **Stage 4 & 4.1 (Security & Multi-User Hardening)** و**Stage 5 (Free-Only AI Gateway & Approval-Governed Execution)** مع اختبارات Playwright.

## المزايا والحدود المعمارية الحالية

1. **بوابة الذكاء المجاني فقط (`server/ai-policy.js`, `server/ai-providers.js`, `server/ai-gateway.js`) — Stage 5**:
   - **سياسة الإنفاق الصفري (`Fail-Closed Zero-Spend`)**: تفرض البوابة `AI_ACCESS_MODE=FREE_ONLY` و`MAX_SPEND_USD=0` و`BILLING_ALLOWED=false`، وترفض التشغيل فورًا عند مخالفة أي منها.
   - **تصنيف المزودين (`Pricing Tiers`)**:
     - المسموح: `FREE_FOREVER`، `FREE_QUOTA`، `LOCAL`.
     - المحظور: `TRIAL`، `PAID`، `UNKNOWN` (مع اشتراط لاحقة `:free` لنماذج OpenRouter وتكلفة `$0`).
   - **قفل التحقق الخماسي (`5-Gate Pre-Activation Lock`)**: يبقى كل مزود (`gemini`, `huggingface`, `nvidia`, `openrouter`, `ollama`) معطلًا افتراضيًا (`enabled: false`) حتى تتحقق البوابات الخمس صراحةً: `card` و`region` و`limits` و`storage` و`quota`.
   - **الفصل الرباعي وحوكمة الموافقات (`4-Layer Separation & Approval Gate`)**:
     1. **اقتراح الذكاء (`POST /api/tasks/:id/propose`)**: يولّد مقترحًا استشاريًا (`proposal`) دون سلطة تنفيذ.
     2. **قرار السياسة (`policyDecision`)**: يسجّل نتيجة فحص السياسة والبوابات الخمس.
     3. **سلطة التنفيذ (`POST /api/tasks/:id/approve`)**: لا يُسمح بتشغيل أي مهمة (`POST /api/tasks/:id/run`) إلا بعد اعتماد المشغل البشري الصريح، وإلا يُرفض الطلب بـ `409 Conflict`.
     4. **إثبات الدليل (`evidence`)**: يسجّل مصدر التنفيذ (`local-deterministic-mock` أو `live-provider-http`) مع ضبط `productionVerified: false` في الاختبارات المحلية والوهمية لعدم اعتبارها دليلًا على نجاح الإنتاج.

2. **الأمان وعزل المستخدمين (`server/auth.js`, `server/index.js`) — Stage 4.1**:
   - **Fail-Closed في الإنتاج**: يرفض الخادم التشغيل في `NODE_ENV=production` ما لم يُضبط `SESSION_SECRET` أو `JWT_SECRET` بطول $\ge 32$ حرفًا، ويعطّل المسار التجريبي `POST /api/auth/github/demo` (`403 Forbidden`).
   - **عزل متعدد المستخدمين**: مسارات `GET /api/tasks` و`GET /api/chat` محمية بـ `requireAuth` ومقيدة بـ `ownerId`، ومسارات التعديل والتشغيل والحذف تتحقق من الملكية (`403 Forbidden` لغير المالك).

3. **طبقة التخزين المحلي (`server/store.js`)**:
   - تخزين JSON ذري لعملية واحدة (`data/nexus-db.json` أو عبر `DATABASE_PATH`) مع حماية **Fail-Closed** عند تلف الملف وعزل النسخة التالفة بلاحقة `.corrupt.<timestamp>.bak`.

## البدء

يتطلب Node.js 20 أو أحدث وnpm.

```bash
npm ci
npm start
```

افتح `http://localhost:3000`، أو اختبر حالة الخدمة على `/api/health`، وحالة التخزين على `/api/db/status`، وحالة بوابة الذكاء والسياسة على `/api/ai/status`.

## الفحوصات والاختبارات (9 اختبارات Playwright إجمالًا)

يتضمن المستودع **9 اختبارات Playwright** (**2** في `e2e/health.spec.js` + **7** في `e2e/platform.spec.js`):

```bash
python3 scripts/check_repo.py
npm run test:e2e:install
npm run test:e2e
```

راجع [دليل إعداد GitHub](GITHUB_SETUP.md) لخطوات إعدادات المستودع، وتفعيل سجلات التشخيص (`ACTIONS_RUNNER_DEBUG` و`ACTIONS_STEP_DEBUG`)، والنشر على Render.

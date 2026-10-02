# edu

مستودع مشروع **edu**. تطبيق تمهيدي مبني بـ Express وواجهة ثابتة، مع اختبارات Playwright. واجهة OAuth المذكورة مسار تجريبي فقط ولا تنفذ تسجيل دخول حقيقيًا.

## البدء

يتطلب Node.js 20 أو أحدث وnpm.

```bash
npm ci
npm start
```

افتح `http://localhost:3000`، أو اختبر حالة الخدمة على `http://localhost:3000/api/health`. لتغيير المنفذ، اضبط المتغير `PORT`.

يستخدم الخادم حاليًا `helmet`، وتحديد حجم JSON إلى `100kb`، ومحدد معدل للطلبات على مسارات `/api`. لم تُضف المصادقة وقاعدة البيانات بعد، لذلك أزيلت اعتماديات JWT وbcrypt وSupabase وMongoDB إلى حين تنفيذها فعليًا.

## الفحوصات

```bash
python3 scripts/check_repo.py
npm run test:e2e:install
npm run test:e2e
```

تعمل الفحوصات واختبارات Chromium تلقائيًا في GitHub Actions عند فتح Pull Request أو الدفع إلى `main`. يحدث Dependabot اعتماديات npm وGitHub Actions أسبوعيًا. لا توجد قاعدة بيانات أو خدمة Supabase أو مصادقة OAuth مفعلة بعد؛ الاعتماديات المجهزة لا تعني أن هذه الميزات موجودة.

راجع [دليل إعداد GitHub](GITHUB_SETUP.md) للخطوات الاختيارية في إعدادات المستودع والاستفادة من الخطة المجانية.

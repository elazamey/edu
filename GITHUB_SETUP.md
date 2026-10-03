# إعداد GitHub للمستودع

الملفات الموجودة في هذا المستودع تعمل بمجرد دفعها إلى GitHub. بعض الميزات تحتاج ضبطًا من واجهة GitHub بواسطة مالك المستودع، ولا تفعّلها ملفات YAML وحدها.

## خطوات موصى بها

1. من **Settings → Actions → General** تأكد من السماح بتشغيل GitHub Actions. الفحص يستخدم runner مستضافًا من GitHub ولا يتطلب أسرارًا أو خدمة مدفوعة. راقب حدود الاستخدام الحالية في **Settings → Billing and licensing**؛ الحصص والسياسات قد تتغير.
2. من **Settings → Branches** أو **Settings → Rules → Rulesets** أضف قاعدة للفرع `main` إن كانت متاحة في خطتك: اطلب Pull Request وفحص `Repository checks` قبل الدمج، وامنع الدفع المباشر. قد يتطلب اختيار الفحص تشغيل workflow مرة أولى. توفر فرض القواعد يعتمد على نوع المستودع والخطة؛ في المستودعات العامة تكون خيارات أكثر متاحة عادةً.
3. من **Settings → Security → Code security and analysis** فعّل Dependabot alerts وsecret scanning إن كانا متاحين. ملف `dependabot.yml` ينشئ طلبات تحديث لـ GitHub Actions واعتماديات npm.
4. من **Settings → General → Features** أبقِ Issues مفعلة لاستخدام قوالب البلاغات. فعّل Discussions إن احتجت مساحة للأسئلة بدل البلاغات.
5. اختر رخصة مناسبة وأضف ملف `LICENSE` بعد اتخاذ قرار صاحب المشروع. عدم وجود رخصة لا يمنح الآخرين إذنًا عامًا بإعادة الاستخدام.
6. عند إضافة موقع ثابت، يمكن تفعيل **Pages** من Settings → Pages (حسب توافر الميزة والخطة). لا يوجد موقع للنشر بعد، لذلك لم نضف نشرًا تلقائيًا.

## تفعيل سجلات التشخيص في GitHub Actions (Enabling Debug Logging)

إذا لم توفر سجلات الـ workflow تفاصيل كافية لتشخيص سبب فشل workflow أو job أو step، يمكنك تفعيل سجلات التشخيص الإضافية عبر **Settings → Secrets and variables → Actions** (أو عند إعادة تشغيل الـ workflow عبر **Re-run jobs → Enable debug logging**):

### متطلبات الصلاحيات
- لإنشاء secrets أو variables في مستودع منظمة (Organization)، يجب امتلاك صلاحية `write`. وفي مستودع حساب شخصي، يجب أن تكون متعاونًا (Collaborator) أو مالك المستودع.
- لإنشاء secrets أو variables لبيئة (Environment) في مستودع شخصي يجب أن تكون المالك، وفي مستودع منظمة يجب امتلاك صلاحية `admin`.
- يمكن لأي شخص يملك صلاحية تشغيل الـ workflow تفعيل سجلات تشخيص الـ runner والـ steps عند إعادة التشغيل (Re-run).

### 1. سجلات تشخيص المشغّل (Runner Diagnostic Logging)
تضيف ملفين إضافيين إلى أرشيف السجلات (سجل عملية الـ Runner وسجل عملية الـ Worker):
1. اضبط السر (Secret) أو المتغير (Variable) باسم `ACTIONS_RUNNER_DEBUG` إلى القيمة `true` (إذا ضُبط الاثنان، تكون الأولوية للـ Secret على الـ Variable).
2. لتنزيل السجلات، حمّل أرشيف سجلات الـ workflow run وابحث داخل المجلد `runner-diagnostic-logs`.

### 2. سجلات تشخيص الخطوات (Step Debug Logging)
تزيد من تفصيل سجلات الخطوات أثناء التنفيذ وبعده، وتفعّل الخطوات المشروطة بـ `if: ${{ runner.debug == '1' }}` الموجودة في `.github/workflows/ci.yml`:
1. اضبط السر (Secret) أو المتغير (Variable) باسم `ACTIONS_STEP_DEBUG` إلى القيمة `true` (الأولوية للـ Secret عند وجود الاثنين).
2. بعد التفعيل، ستظهر أحداث التشخيص التفصيلية ومخرجات خطوة `Print runner and environment diagnostics` في سجلات الـ job.

## الأمان والتكلفة

- الصلاحية الافتراضية للـ workflow هي `contents: read`، ولا يُستخدم `pull_request_target` أو أسرار في فحوصات طلبات السحب.
- افتح طلبات Dependabot وراجعها قبل الدمج؛ لا يوجد دمج تلقائي لاعتماديات خارجية.
- لا تضع مفاتيح أو كلمات مرور في المستودع. استخدم GitHub Secrets عند الحاجة لاحقًا، ولا تطبعها في السجلات.
- عند إضافة ميزات جديدة، أضف فحوصات واختبارات مناسبة لها.

## نشر Nexus على Render

بعد دمج ملفات التطبيق و`render.yaml` في `main`، اختر **New → Blueprint** في Render واربط مستودع GitHub `elazamey/edu`. راجع المعاينة قبل تأكيد الإنشاء وتحقق من أن الخطة `free`. يولّد `render.yaml` متغير `SESSION_SECRET` تلقائيًا (`generateValue: true`) لتلبية شرط **Fail-Closed** في بيئة الإنتاج.

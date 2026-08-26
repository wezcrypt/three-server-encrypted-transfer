# تقرير المراجعة الأمنية

## الملخص التنفيذي

**المخاطر الإجمالية: HIGH**
**الجاهزية للإنتاج: غير جاهز**

راجعت المراجعة النهائية source code، config، migrations، endpoints، state machine، التشفير، mTLS، logging، tests، binaries، ووثائق التشغيل. اجتازت اختبارات المشروع **15/15**، اجتازت الاختبارات الأمنية **3/3**، ونتيجة `npm audit --omit=dev --audit-level=low` هي **0 vulnerabilities** في 26 أغسطس 2026. لا توجد نتيجة Critical مفتوحة. يبقى النشر الإنتاجي غير جاهز لوجود نقطة عالية واحدة متعلقة بتشغيل تطبيق الربط على VPS منفصلة، ونقطتين متوسطتين متعلقتين بذرية filesystem/database واختبار Windows.

## نتائج حرجة (Critical)

لا توجد نتائج Critical مفتوحة. لم أجد مساراً يجعل Server 2 أو Server 3 يفك ciphertext أو يصل إلى DEK/Master Key، ولم أجد إعادة استخدام IV مع DEK واحد، أو تعطيل `rejectUnauthorized`، أو حذف ciphertext المؤكد قبل `STORED`.

## نتائج عالية (High)

1. **[HIGH] تطبيق الربط لا يوفّر bootstrap عن بعد إلى ثلاث VPS مستقلة بلا قناة إدارة موثقة.**
   - **الموقع:** `connector/index.js`، الدالة `launch`، ووثيقة `DEPLOYMENT.md`.
   - **المشكلة:** binary المعبأ يشغّل العقد الثلاث محلياً داخل عملية واحدة لأغراض التشغيل المحلي/التجريبي. أما topology الإنتاجية المطلوبة، حيث كل عقدة في VPS مستقلة، فتتطلب توزيع source أو binary/config لكل VPS حسب deployment guide. لا توجد في التطبيق قناة SSH/mTLS إدارة أو agent موثقة تستطيع نسخ الملف، تثبيت service، وبدء العملية عن بعد اعتماداً على عنوان/port/الشهادة فقط.
   - **الأثر:** قد يعتقد المشغل أن إدخال عناوين VPS في Connector يكفي للنشر البعيد، فينتهي بتشغيل غير مقصود محلياً أو topology غير معزولة. هذا خطر معماري وتشغيلي، لا كشف plaintext مباشر.
   - **سيناريو الاستغلال:** تشغيل Connector على جهاز إداري مع hosts خارجية لا يثبت أو يبدأ خدمة في VPS المستهدفة؛ قد تُشغّل عملية co-located غير متوافقة مع سياسة العزل.
   - **الإصلاح المقترح:** أضف قناة bootstrap آمنة منفصلة تعتمد SSH بمفاتيح حسابات خدمة مقيدة أو agent إدارة mTLS مثبت مسبقاً على كل VPS، مع بصمة host key، allow-list، ومراجعة confirmation قبل تنفيذ النشر. بديل آمن: غلّف لكل VPS binary/config مخصصاً واستعمل Ansible/Terraform/CI محكوم.

## نتائج متوسطة (Medium)

1. **[MEDIUM] لا توجد معاملة ذرية واحدة تشمل fsync للملف وSQLite عبر نظام الملفات.**
   - **الموقع:** `shared/http-utils.js` و`shared/database.js` وعمليات حفظ chunks.
   - **المشكلة:** كتابة chunk تعمل `fsync` ثم تسجل DB في transaction، وهو ترتيب سليم لتجنب تأكيد chunk غير مكتوب، لكنه لا يحقق atomic transaction عابرة لنظام الملفات وقاعدة البيانات.
   - **الأثر:** انقطاع طاقة ضمن نافذة ضيقة قد يترك ملفاً موجوداً بلا صف DB أو صفاً لا يطابق ملفاً بعد عطل filesystem؛ الاستئناف يعالج أغلب الحالات لكنه يحتاج validation على reboot.
   - **سيناريو الاستغلال:** crash بعد كتابة/rename وقبل commit أو في عطل filesystem.
   - **الإصلاح المقترح:** أضف startup reconciliation يمسح/يعزل orphan files ويعيد hash للـchunks الموثقة قبل الاستئناف، واستخدم directory fsync بعد rename عند المنصات الداعمة.

2. **[MEDIUM] لم يُنفذ اختبار acceptance فعلي لملف exe على Windows x64.**
   - **الموقع:** `dist/three-server-connector-win-x64.exe`.
   - **المشكلة:** البيئة الحالية Linux فقط. تحققت البنية PE32+ وأُدرج ملحق SQLite Windows Node 22 x64، لكن لم ينفذ lifecycle حقيقي على Windows.
   - **الأثر:** احتمال مشكلة runtime/ACL أو native addon على Windows لا تظهر في اختبار Linux.
   - **سيناريو الاستغلال:** ليس استغلالاً مباشراً؛ خطر تشغيل وتهيئة قد يجعل service غير متاح أو يطبق permissions غير متوقعة.
   - **الإصلاح المقترح:** نفّذ CI acceptance على Windows Server/Windows 11 x64: `--generate`، `--config`، health، upload صغير، واختبر ACL للـconfig والشهادات.

## نتائج منخفضة (Low)

1. **[LOW] المثال غير التفاعلي يحتاج مراجعة token قبل التشغيل.**
   - **الموقع:** `connector/index.js`، `exampleConfig`.
   - **المشكلة:** ملف `--generate` يحمل placeholder توضيحياً لـupload token؛ إذا استعمله المشغل كما هو يمكن أن يكون token متوقعاً.
   - **الأثر:** ضعف مصادقة Server 1 في development أو production إذا لم يعدّل المثال.
   - **الإصلاح المقترح:** استبدال placeholder بتوليد token عشوائي عند تحميل المثال أو رفض القيمة المعروفة. **الحالة: CLOSED**؛ أصبحت القيمة `__GENERATE_SECURE_TOKEN_AT_RUNTIME__` مولداً صريحاً لـ32-byte token عشوائي عند تحميل config، ولا تعد token قابلة للاستعمال بحد ذاتها.

## مراجعة التشفير

Encryption: PASS
Key Management: PASS
Nonce/IV handling: PASS
Authentication tags: PASS

يستخدم التطبيق AES-256-GCM القياسي مع DEK 32 بايت عشوائي لكل ملف. الـIV يتكون من prefix عشوائي 8 بايت مع index 32 بت، وAAD يربط الـrecord بالملف والتحويل والترتيب والطول. اختبارات العبث وAAD الخاطئ وIV مختلف ناجحة. يُفرض Vault في production ويُرفض مزود development؛ لا يتوفر key provider في Server 2/3.

## مراجعة mTLS / PKI

mTLS: PASS
Certificate validation: PASS
Identity verification: PASS
Rotation: PASS

تفرض الاتصالات الداخلية TLS 1.3 وشهادة client وCA وتحقق `rejectUnauthorized=true`. يتحقق التطبيق أيضاً من CN/SAN للدور. يرفض الإنتاج الإقلاع في غياب CRL، ويفحص private-key mode في POSIX. ما زال يلزم اختبار CRL حقيقية وrenewal في بيئة production.

## مراجعة فقدان البيانات

Source deletion safety: PASS
Resume: PASS
Crash recovery: PASS

لا ينشئ Server 1 plaintext temp file ولا يملك حذفاً للمصدر. يحذف ciphertext المؤقت فقط بعد رد `STORED` النهائي. Relay لا يحذف chunks قبل تأكيد Storage. اختبار Storage unavailable ثم recovery ناجح ويثبت بقاء ciphertext قبل التأكيد. تبقى نتيجة filesystem/DB reconciliation المتوسطة أعلاه مطلوبة لتحمل power-loss المتطرف.

## مراجعة الاسترجاع

Download security: PASS (غير معرّض؛ لا يوجد endpoint retrieval في هذا الإصدار)
Key authorization: PASS (لا يوجد decrypt API خارجي)
Plaintext isolation: PASS

حجب retrieval مقصود في الإصدار الحالي لتجنب فتح مسار فك تشفير من دون طبقة هوية وملكية/تفويض. يجب أن يمر أي endpoint استرجاع مستقبلي بتصميم وتدقيق مستقلين.

## مراجعة الـ Dependencies

`npm audit --omit=dev --audit-level=low` أعاد **found 0 vulnerabilities**. الاعتماديات التشغيلية هي `better-sqlite3` و`pino` و`zod` و`@yao-pkg/pkg`. يلزم تثبيت الإصدارات عبر lockfile وتشغيل audit في CI قبل كل نشر؛ لا ترق الحزم تلقائياً من دون اختبار binary/native addon.

## مشاكل معمارية

المشكلة المعمارية الأساسية المفتوحة هي أن واجهة التحكم لا تملك remote deployment channel آمنة إلى VPS منفصلة. الخوادم نفسها قابلة للنشر منفصلة طبقاً للدليل، لكن شرط "زر واحد" لنشرها عن بعد يتطلب credentials/agent لم يقدمه المستخدم ولا يجوز افتراضه. كذلك لا يقدم الإصدار مسار استرجاع plaintext، وهو قرار تقليل سطح هجوم وليس خللاً.

## الإصلاحات المطلوبة (مرتبة حسب الأولوية)

1. تنفيذ remote bootstrap موثق ومقيد (SSH/agent mTLS) أو اعتماد pipeline بنية تحتية رسمي لتشغيل ثلاث VPS مستقلة من واجهة واحدة.
2. إجراء Windows x64 acceptance test فعلي للـexe، بما في ذلك ACL وnative SQLite lifecycle.
3. تطبيق startup filesystem/SQLite reconciliation وdirectory fsync حيث يتوفر.
4. إجراء اختبار CRL ملغاة وVault policy/rotation واختبار تحميل في production-like staging.

## اختبارات أمنية مطلوبة قبل الإنتاج

| الاختبار | الحالة |
|---|---|
| e2e encryption + plaintext isolation | PASS محلياً. |
| mTLS identity mismatch | PASS محلياً. |
| replay conflicting manifest | PASS محلياً. |
| path traversal وchunk validation | PASS محلياً. |
| outage + resume | PASS محلياً. |
| Windows binary acceptance | مطلوب. |
| Vault Transit with production policy | مطلوب. |
| CRL revocation on live certificate | مطلوب. |
| 10/50/90% network cut وpower-loss filesystem test | مطلوب. |
| load/flood/quota stress test | مطلوب. |
| remote three-VPS deployment exercise | مطلوب. |

## الحكم النهائي

**غير جاهز للإنتاج** حتى تعالج نتيجة High الخاصة بـremote bootstrap وتنفذ اختبارات Windows/Vault/CRL/تحمل production المذكورة. الكود الحالي مناسب لتجارب تطويرية وللنشر المنضبط يدوياً على ثلاث عقد وفق `DEPLOYMENT.md` بعد تنفيذ ضوابط production.

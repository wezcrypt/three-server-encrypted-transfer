# Phase 7 — الاستئناف والتعافي من الأعطال

**الحالة:** مكتملة. أضيفت عمليات استئناف تلقائية وعامل تنظيف محافظ قابل للتهيئة؛ وأثبت اختبار تكامل انقطاع الوجهة سلامة تسلسل الحذف.

## منطق الاستئناف

| الحالة | السلوك عند إعادة التشغيل أو إعادة المحاولة | مصير البيانات |
|---|---|---|
| `ENCRYPTING` | يبقى draft دائماً؛ بعد timeout يصبح `FAILED`، وتحذف فقط `.part` القديمة | لا يوجد plaintext temp؛ لا تُحذف بيانات مؤكدة. |
| `ENCRYPTED` أو `RELAY_RECEIVING` | Server 1 يرسل manifest مطابقاً ويبدأ من `nextChunk` المؤكد لدى Relay | يبقى ciphertext المحلي حتى `STORED`. |
| `FAILED` | انتقال ذري `FAILED → RECOVERY_PENDING → المرحلة المطلوبة` | لا يتم تحويله إلى STORED مباشرة. |
| Relay/Storage stale | يتحولان إلى `RECOVERY_PENDING` ويحتفظان بالـchunks verified | يعيد Server 1 تنشيط النقل من manifest المطابق. |
| `.part` قديم | عامل دوري يحذفه بعد `staleTransferHours` (الافتراضي 6 ساعات) | لا يحذف `.bin` مكتمل في Server 1 أو chunks verified أو Storage مؤكد. |
| `STORED` | terminal/idempotent | لا تعديل أو حذف عبر عامل التنظيف. |

## اختبار فشل الوجهة المنفذ

نفذ الاختبار `Server 1 resumes a failed transfer after Storage returns without deleting ciphertext early` بالتسلسل التالي:

| الخطوة | النتيجة |
|---|---|
| تشغيل Server 1 وServer 2 مع Storage غير متاح | رفع الملف يعيد `502` وحالة Server 1 تصبح `FAILED`. |
| فحص Server 1 | ملف ciphertext النهائي `.bin` ما زال موجوداً. |
| تشغيل Server 3 لاحقاً | لا يلزم تدخل يدوي في chunks أو metadata. |
| استدعاء عامل الاستئناف | يعيد manifest، ويتجاوز chunks التي يؤكدها Relay، ويكمل إلى Server 3. |
| فحص النهاية | Server 1 و2 و3 جميعاً `STORED`. |
| فحص الحذف | ciphertext المحلي يُحذف فقط بعد تأكيد `STORED`؛ لم يوجد حذف plaintext مصدر. |

نجحت اختبارات التكامل الخمس بعد إضافة سيناريو التعافي.

## قائمة الاختبارات اليدوية المتبقية قبل الإنتاج

| السيناريو | السلوك المطلوب |
|---|---|
| قطع الاتصال عند 10% و50% و90% | نفس transfer_id يستأنف من آخر index موثق. |
| قتل عملية Server 1 أثناء التشفير | يبقى `.part` فقط؛ بعد timeout تنظف بدون حذف مصدر المستخدم. |
| قتل Server 2 أثناء chunk | لا يسجل chunk verified حتى hash وfsync؛ يمكن إعادة الإرسال بأمان. |
| قتل Server 3 بعد آخر chunk وقبل complete | chunks الدائمة موجودة، لكن لا `STORED` حتى full hash عند retry. |
| تعطل SQLite | طلب النقل يفشل بشكل واضح ولا يعترف بنجاح غير محفوظ. |

> **قرار المتابعة:** لا يظهر مسار يؤدي إلى حذف نسخة قبل تأكيد الوجهة. تبدأ الآن جلسة تدقيق Data Loss الكاملة المنصوص عليها في القسم 8 من الدليل.

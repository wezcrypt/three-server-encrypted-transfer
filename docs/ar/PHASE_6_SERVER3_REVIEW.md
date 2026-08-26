# Phase 6 — Server 3 Final Storage

**الحالة:** مكتملة. تم تشغيل اختبار تكامل كامل من Server 1 إلى Server 2 إلى Server 3 بنجاح.

## التنفيذ

| المجال | التنفيذ | الضابط |
|---|---|---|
| قبول Storage | mTLS بهوية متوقعة `server2` فقط | لا يستطيع Server 1 أو عميل خارجي الكتابة مباشرة إلى Storage. |
| metadata | manifest ضيق لا يحتوي plaintext metadata أو DEK مغلف | Storage لا يملك ما يلزم لفك التشفير أو معرفة اسم المستخدم. |
| موقع التخزين | `files/<fileId>/chunks/<index>.chunk` | لا يوجد filename مستخدم؛ المسار مبني من UUID تم التحقق منه. |
| التحقق | SHA-256 لكل chunk، وترتيب متسلسل، ثم SHA-256 للـciphertext المجمع | لا يعد `STORED` قبل التحقق الكامل. |
| التأكيد | يحدّث قاعدة بياناته إلى `STORED` ويرجع `storageKey` فقط بعد التحقق | Relay لا يحذف نسخته قبل التأكيد النهائي. |
| تكرار الطلب | manifest أو chunk مكرر مطابق idempotent؛ المتعارض مرفوض | لا تتسبب retries في تلف أو تبديل ملف. |

## اختبار التكامل المنفذ

نفذ الاختبار `end-to-end transfer stores only ciphertext on Server 2 and Server 3` في 26 أغسطس 2026. استخدم ملفاً عشوائياً بحجم 2.5 MB وأرسل raw body إلى `POST /upload` في Server 1، ثم تحقق من البنود التالية:

| التحقق | النتيجة |
|---|---|
| استجابة Server 1 | `201` و`status=STORED`. |
| حالة قواعد البيانات | Server 1 وServer 2 وServer 3 جميعاً `STORED`. |
| wrapped DEK | موجود في Server 1 فقط؛ `NULL` في Server 2 وServer 3. |
| التخزين النهائي | storage key يطابق `files/<fileId>` فقط. |
| المحتوى النهائي | ciphertext مختلف عن المصدر العشوائي؛ لا تخزين plaintext. |
| نسخة Relay | مجلد temporary Relay حُذف بعد تأكيد Storage. |
| الاسم المرسل | `../sensitive.txt` لم يظهر في Relay؛ سجل Relay فقط `opaque-<fileId>`. |

بعد إصلاح تهيئة سجل ترحيلات SQLite ليُنشأ قبل أول استعلام، نجحت اختبارات التكامل الأربع كاملةً.

> **قرار المتابعة:** يكتمل الآن الحد البنيوي للبيانات الصريحة: Server 1 هو العقدة الوحيدة التي تتعامل مع plaintext وDEK. تبدأ المراجعة المستقلة لعزل plaintext حسب القسم 2 من الدليل.

# Phase 5 — Server 2 Relay

**الحالة:** مكتمل. Server 2 يستقبل ciphertext فقط ويثبت سلامته محلياً قبل الإرسال إلى Server 3.

## الضوابط المنفذة

| المجال | التنفيذ | النتيجة الأمنية |
|---|---|---|
| قبول الاتصال | mTLS + شهادة متوقعة لهوية `server1` | لا يستطيع عميل عام أو server3 استدعاء واجهات Relay. |
| manifest | مخطط remote ضيق لا يقبل filename أو content type أو plaintext size أو wrapped DEK | metadata الصريحة لا تصل إلى Relay. |
| replay | manifest مكرر ينجح فقط إذا كان مطابقاً حرفياً للبيانات الحرجة؛ خلافه `409` | transfer ID لا يمكن إعادة استعماله لتبديل ملف أو hash. |
| chunk | hash SHA-256 وحجم وعدّاد متوقع بشكل متسلسل | لا يمكن القفز أو استبدال أو تأكيد chunk مفقود. |
| التخزين المؤقت | `fileId/transferId/chunkIndex` فقط، مع فتح `wx` ثم link بلا overwrite | أسماء المستخدم لا تؤثر في مسارات النظام؛ وكتابة الملفات آمنة ضد الاستبدال الأساسي. |
| التحقق النهائي | SHA-256 للـciphertext المجمع قبل Storage | لا يصل ملف تالف إلى التخزين النهائي. |
| النقل للوجهة | mTLS مع تحقق هوية `server3` | لا يستطيع Relay أن يرسل ciphertext إلى عقدة غير موثوقة. |
| الحذف | لا يحذف Relay chunks إلا بعد `STORED` من Server 3 | لا حذف قبل تأكيد الوجهة النهائي. |

## مراجعة ذاتية

| السؤال | النتيجة |
|---|---|
| هل يرى Server 2 plaintext؟ | لا؛ request bodies هي records AES-GCM فقط، ولا يوجد فك تشفير أو مزود مفاتيح أو wrapped DEK. |
| هل يرى Server 2 DEK أو Master Key؟ | لا؛ ملفاته وإعداداته لا تستورد `key-provider`. |
| هل يستطيع أي mTLS client موقع استدعاء relay؟ | لا؛ مطلوب CN/SAN يطابق `server1`. |
| هل يمكن إعادة manifest متعارض؟ | لا؛ يعاد `TRANSFER_MANIFEST_CONFLICT`. |
| هل يمسح Relay بياناته قبل تأكيد Storage؟ | لا؛ الحذف يتم بعد `status=STORED` فقط. |
| هل تُخزن أسماء المستخدم كمسارات؟ | لا؛ يستخدم Relay `opaque-<fileId>` محلياً ولا يبني المسارات إلا من UUID/index. |

## قائمة اختبارات التكامل اللاحقة

| الاختبار | النتيجة المتوقعة |
|---|---|
| إرسال manifest من شهادة server3 | `403 MTLS_IDENTITY_MISMATCH`. |
| إرسال hash غير مطابق | `422 CHUNK_HASH_MISMATCH` وعدم تسجيل chunk verified. |
| إرسال index 2 قبل index 0 | `409 CHUNK_REJECTED`. |
| إرسال manifest نفسه مرتين | 201 ثم 200 مع next chunk الصحيح. |
| إرسال manifest نفسه مع ciphertext hash مختلف | `409 TRANSFER_MANIFEST_CONFLICT`. |
| Storage متوقف عند complete | يحتفظ Relay بالـchunks ويضع النقل FAILED/cابل للاستئناف، ولا يحذفها. |

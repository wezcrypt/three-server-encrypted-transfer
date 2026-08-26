# تدقيق مركز — عزل البيانات الصريحة بين العقد

**نطاق المراجعة:** `server1-upload/` و`server2-relay/` و`server3-storage/` و`shared/validation.js` وطبقة قاعدة البيانات، بالإضافة إلى اختبار النقل الكامل.
**قاعدة المراجعة:** لم يُعدّل كود خلال جلسة التدقيق.
**الحكم:** PASS؛ لا توجد نتيجة CRITICAL أو HIGH أو MEDIUM مفتوحة في نطاق عزل plaintext.

## التحقق الفعلي

| مسار محتمل لتسرب plaintext أو مفتاح | Server 2 | Server 3 | النتيجة |
|---|---|---|---|
| body requests | يستقبل AES-GCM records فقط | يستقبل AES-GCM records فقط | PASS |
| wrapped DEK | مخطط remote يرفضه؛ DB تسجله `NULL` | مخطط remote يرفضه؛ DB تسجله `NULL` | PASS |
| DEK/Master Key/Vault | لا يستورد `key-provider` ولا أي فك تشفير | لا يستورد `key-provider` ولا أي فك تشفير | PASS |
| أسماء الملفات | يستبدل محلياً بـ`opaque-<fileId>` | يستبدل محلياً بـ`opaque-<fileId>` | PASS |
| نوع المحتوى وحجم plaintext | لا يُرسل في remote manifest | لا يُرسل في remote manifest | PASS |
| نظام الملفات | chunks تحت UUID/index فقط | chunks دائمة تحت `files/<fileId>/chunks` | PASS |
| logs/errors | لا توجد طباعة body أو مفاتيح أو filename | لا توجد طباعة body أو مفاتيح أو filename | PASS |
| metadata وقاعدة البيانات | لا يوجد wrapped DEK؛ metadata اسم placeholder | لا يوجد wrapped DEK؛ metadata اسم placeholder | PASS |
| endpoint فك التشفير | غير موجود | غير موجود | PASS |

## أدلة الاختبار

اختبار التكامل الكامل أكد عملياً أن Server 1 وحده يحتوي `wrapped_dek`، بينما كلا العقدتين البعيدتين تحفظان `NULL`. كما أرسل الاختبار filename خبيثاً `../sensitive.txt` وتحقق من أن Relay يحفظ فقط `opaque-<fileId>`، وأن ciphertext المخزن في Server 3 مختلف عن المصدر. وقد نجح الاختبار في 26 أغسطس 2026.

## ملاحظات البحث الساكن

الفحص الساكن في كل من `server2-relay/index.js` و`server3-storage/index.js` لم يجد استدعاءات `unwrapDek` أو `decryptChunk` أو `createDecipheriv` أو متغيرات `MASTER_KEY` أو `VAULT_*` أو `wrappedDek`. المطابقة الوحيدة لـ`originalFilename` هي إنشاء placeholder اصطناعي من `fileId` بعد أن يمر manifest المقيد بالتحقق.

> **قرار المتابعة:** العزل البنيوي للـplaintext سليم. لا يمتلك Server 2 أو Server 3 القدرة البرمجية أو بيانات الاعتماد أو metadata اللازمة لفك تشفير الملف. يمكن الانتقال إلى Phase 7 للاستئناف والتعافي من الأعطال.

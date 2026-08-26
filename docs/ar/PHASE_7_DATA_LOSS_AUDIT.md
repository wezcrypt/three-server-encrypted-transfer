# تدقيق Data Loss — Phase 7

**نطاق المراجعة:** ترتيب الحالة، جميع عمليات الحذف، worker الاستعادة، والتدفقات من Server 1 إلى Server 3.
**قاعدة المراجعة:** لم يُعدّل كود خلال الجلسة.
**الحكم:** PASS؛ لا توجد نتائج CRITICAL أو HIGH أو MEDIUM مفتوحة في مسار فقدان البيانات.

## التسلسل الفعلي المراجع

> `Source → Encryption → ciphertext verification → Relay verification → Storage verification → STORED confirmation → temporary ciphertext deletion`

تطبيق Server 1 لا يملك أمر حذف للـplaintext المصدر أساساً، لأن الملف يصل stream من العميل ولا ينشئ التطبيق نسخة plaintext محلية. لذلك لا يمكن لفشل الشبكة أو worker أن يحذف المصدر. ciphertext المؤقت في Server 1 لا يحذف إلا بعد رد Relay الصريح `200` و`status=STORED`، عقب تسجيل الحالة `STORED` محلياً.

| عملية حذف | الشرط السابق | هل تمثل مصدر بيانات قابل للاسترجاع؟ | النتيجة |
|---|---|---|---|
| حذف `.part` عند فشل التشفير | لم يُعترف بالملف بعد وملف ciphertext النهائي غير موجود | لا؛ ملف جزئي غير موثوق فقط | PASS |
| حذف ciphertext Server 1 | `status=STORED` من Relay والحالة المحلية انتقلت إلى STORED | Storage النهائي تحقق من full hash | PASS |
| حذف Relay chunks | `status=STORED` من Server 3 بعد full hash | Server 3 يملك storage دائم | PASS |
| حذف `.part` القديم | timeout 6 ساعات قابل للضبط | لا يطابق إلا ملفات جزئية؛ لا يمس `.bin` أو chunks verified | PASS |
| حذف Storage chunks | لا يوجد مسار حذف في التطبيق | التخزين النهائي ثابت | PASS |

## سيناريوهات الأعطال

| السيناريو | النسخة المرجعية بعد الفشل | الاسترجاع | خطر حذف خاطئ |
|---|---|---|---|
| انقطاع عند 10% | المصدر عند العميل؛ Server 1 `.part` أو draft | يعاد الرفع؛ `.part` فقط تنظف بعد timeout | لا يوجد |
| انقطاع عند 50% | ciphertext النهائي في Server 1 وchunks verified في Relay إن وجدت | Server 1 يستأنف من `nextChunk` | لا يوجد |
| انقطاع عند 90% | ciphertext Server 1 + Relay verified chunks | idempotent chunk retry ثم full hash | لا يوجد |
| Storage غير متاح | Server 1 ciphertext وRelay chunks | اختبار تكامل يثبت استئنافاً ناجحاً عند عودة Storage | لا يوجد |
| Server 1 يتعطل بعد Storage تأكيد | ciphertext قد يبقى زيادةً (ليس فقداً) | retry idempotent يصل إلى STORED ثم يحذف ciphertext | لا يوجد |
| Server 2 يتعطل بعد Storage تأكيد | Storage دائم موجود؛ Relay chunks قد تبقى زيادةً | retry يعيد تأكيد Storage ثم ينظف Relay | لا يوجد |
| Server 3 يتعطل قبل complete | chunks النهائية موجودة لكن لا STORED | Relay يعيد manifest/chunks ثم complete | لا يوجد |
| فشل hash | نسخة المصدر/ciphertext الموثقة تبقى؛ chunk التالف لا يسجل | إعادة النقل من آخر verified | لا يوجد |
| worker يتعطل | لا يحدث حذف شامل؛ لا توجد عملية delete للـverified data | worker الدوري يبدأ عند الإقلاع | لا يوجد |
| إعادة تشغيل الجهاز | SQLite WAL + files الدائمة تحفظ الحالة | start-up resume وleases | لا يوجد |

## مراجعة التزامن والذرات

تسجل DB chunks في transaction بعد hash والكتابة و`fsync`، وتستخدم unique key `(transfer_id, chunk_index)`. يحمي lease مرحلة Relay→Storage من عمال متنافسين. الانتقالات المحظورة مثل `FAILED → STORED` ترفضها آلة الحالات. السلوك idempotent للـmanifest/chunk المتطابق يمنع الـretry من مضاعفة العداد أو استبدال البيانات.

> **قرار المراجعة:** التسلسل يحقق القاعدة الذهبية: لا يوجد حذف لنسخة معتبرة قبل تأكيد الوجهة. يمكن الانتقال إلى Phase 8.

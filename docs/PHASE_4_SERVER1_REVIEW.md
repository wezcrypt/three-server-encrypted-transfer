# Phase 4 — Server 1 Upload + Encryption

**الحالة:** مكتمل على مستوى خادم الرفع. اختبار النقل الكامل سيجري بعد اكتمال Server 2 وServer 3 في Phase 6.

## مسار التنفيذ

| الخطوة | التنفيذ | ضمان الأمان أو الاعتمادية |
|---|---|---|
| 1 | `POST /upload` يستقبل body متدفقاً عبر HTTPS | لا يُقرأ body كاملاً في الذاكرة. |
| 2 | حد `Content-Length` وحد تشفير داخلي `maxPlaintextBytes` | يرفض ملفاً أكبر من الحصة حتى عند غياب أو تزوير Content-Length. |
| 3 | يولد `fileId` و`transferId` عشوائيين وDEK جديداً | لا تستخدم أسماء المستخدم أو IDs متوقعة لمسار التخزين. |
| 4 | ينشئ صف `ENCRYPTING` دائماً ثم يشفّر إلى ciphertext محلي فقط | crash أثناء التشفير قابل للرصد والاسترداد؛ لا ينشأ plaintext temp file. |
| 5 | يخزن DEK مغلفاً في قاعدة Server 1 فقط | لا يدخل في manifest البعيد ولا في جسم طلب Relay. |
| 6 | يرسل manifest مصغراً ثم ciphertext chunks إلى Server 2 عبر mTLS | Server 2 لا يستقبل filename أو content type أو plaintext size أو wrapped DEK. |
| 7 | يحذف ciphertext المؤقت فقط عند `STORED` الصريح من Relay | لا توجد أي عملية حذف للـplaintext المصدر؛ يفوق ذلك القاعدة الذهبية تحفظاً. |

## واجهات Server 1

| Endpoint | المصادقة | السلوك |
|---|---|---|
| `POST /upload` | Bearer token في الإنتاج؛ اختياري محلياً للتطوير | يشفر الملف ويكمل النقل أو يعيد حالة فشل/انتظار بلا حذف للمصدر. |
| `GET /transfers/:transferId` | Bearer token في الإنتاج | يعيد ID والحالة فقط؛ لا يعيد metadata حساسة أو مفاتيح. |

## مراجعة ذاتية

| بند | النتيجة |
|---|---|
| تشفير streaming بلا plaintext temp | PASS |
| حد حجم ضمن stream وليس في header فقط | PASS |
| تشفير DEK ومحو buffer من الذاكرة بعد الاستخدام | PASS |
| عدم إرسال wrapped DEK أو filename إلى Relay | PASS |
| endpoint داخلي يستخدم HTTPS/mTLS حصراً | PASS |
| حذف ciphertext مشروط بـ`STORED` فقط | PASS |
| حذف plaintext مصدر | لا يوجد في التطبيق؛ PASS |
| فحص الصياغة والاختبارات الحالية | PASS: `npm run lint && npm test` (9/9) |

## اختبارات يدوية لاحقة

| الاختبار | النتيجة المتوقعة |
|---|---|
| رفع 1 بايت أقل من الحد | `201 STORED` بعد تشغيل Relay وStorage. |
| رفع فوق الحد بلا Content-Length | `413 UPLOAD_TOO_LARGE` وحذف ciphertext الجزئي فقط. |
| Relay غير متاح | `502` وحالة محلية `FAILED`؛ لا حذف للـsource ولا ciphertext الكامل القابل للاستئناف. |
| token مفقود في production | `401 UNAUTHORIZED` قبل قراءة body. |
| filename من نوع path traversal | لا يستخدم أبداً في مسار التخزين؛ يكمن فقط في DB Server 1 بشكل منقح. |

> **ملاحظة تشغيلية:** لأن الـplaintext يأتي مباشرة من العميل ولا يحتفظ التطبيق بنسخة مصدرية، فالقاعدة «لا حذف قبل تأكيد» تتحقق بنيوياً: لا يوجد حذف plaintext من قبل Server 1 من الأصل.

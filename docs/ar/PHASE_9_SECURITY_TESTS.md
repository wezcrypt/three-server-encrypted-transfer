# Phase 9 — Security Test Suite

**الحالة:** مكتملة. مجموعة الاختبارات الأمنية المنفذة تمر بالكامل.

| مجال الاختبار | السيناريو | النتيجة |
|---|---|---|
| Replay | إعادة manifest بنفس `transferId` مع ciphertext SHA-256 مختلف | PASS: Relay يعيد `409 TRANSFER_MANIFEST_CONFLICT`. |
| عقدة غير مصرح بها | شهادة server3 تحاول استدعاء Relay الذي يقبل server1 فقط | PASS: استجابة `403`. |
| path traversal | filename من `../../private/secret.txt` ومسار تخزين بـ`..` | PASS: الاسم يصبح metadata آمنة فقط، والمسار يرفض. |
| حجم/شكل chunk | index سالب، hash غير سداسي، حجم يتجاوز الحد | PASS: مخطط التحقق يرفضها. |
| سلامة ciphertext | تغيير بايت ciphertext أو AAD/index | PASS: GCM authentication يفشل. |
| IV reuse | تشفير chunks متتالية تحت DEK واحد | PASS: IV مختلف لكل index. |
| عزل المفاتيح | فحص e2e لقواعد بيانات العقد | PASS: wrapped DEK في Server 1 فقط. |
| size limit | حد stream داخل التشفير، وليس header فقط | PASS بالتصميم ومغطى بمسار `UPLOAD_TOO_LARGE`. |
| تسريب سجلات | redaction مركزي لمفاتيح/tokens/body/filename | PASS بالبحث الساكن ومراجعة إعداد logger. |

## أوامر التحقق

```bash
npm run lint
npm test
npm run test:security
```

آخر تنفيذ لـ`npm run test:security` حقق **3/3** نجاحات، وفحص الصياغة ناجح. تضم مجموعة المشروع حالياً اختبارات وحدة وتكامل وأمن تغطي المسار الأساسي، استئناف الوجهة، mTLS، تشفير AES-GCM، المراقبة، والتلاعب بالمدخلات.

> **حدود يجب تنفيذها قبل الإنتاج:** يظل مطلوباً إجراء scan dependencies في بيئة CI المتصلة بالإنترنت، واختبار تحميل مع ملفات كبيرة/آلاف الاتصالات، واختبار شهادات ملغاة فعلياً باستخدام CRL إنتاجية. هذه متطلبات تشغيلية لا تغطيها شهادات التطوير المحلية.

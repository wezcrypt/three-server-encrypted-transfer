# Phase 2 — طبقة التشفير وإدارة المفاتيح

**حالة البناء:** مكتملة.
**حالة المراجعة الأمنية المستقلة:** تنتقل الآن إلى نقطة التدقيق الإلزامية للأقسام 3 و4 من الدليل.

## التصميم المنفذ

| المجال | التنفيذ | خاصية الأمان |
|---|---|---|
| DEK | 32 بايت عشوائية من `crypto.randomBytes` لكل ملف | لا يُعاد استخدام مفتاح بيانات بين الملفات. |
| تشفير المحتوى | AES-256-GCM | سرية وسلامة موثقتان من المكتبة القياسية، من دون خوارزمية مخصصة. |
| إطار الـchunk | `IV(12) || Tag(16) || Ciphertext` | كل سجل نقل يملك IV وauthentication tag مستقلين. |
| IV | prefix عشوائي 8 بايت + `chunkIndex` 4 بايت | IV فريد لكل chunk ضمن DEK واحد؛ الحد الأقصى المفروض للـchunks أقل كثيراً من المجال المتاح. |
| AAD | file ID وtransfer ID وindex وطول plaintext وإصدار المخطط | يمنع تبديل chunks أو نقلها بين ملفات أو transfers مختلفة. |
| تغليف DEK | Vault Transit في الإنتاج، ومزوّد تطوير محلي منفصل | لا ينتقل DEK أو Master Key إلى Server 2/3 أو ضمن الملف. |
| فشل مزوّد المفاتيح | وقت مهلة ورفض الاستجابة غير الصحيحة | Vault غير المتاح أو المفتاح الخاطئ يمنع عملية التشفير أو فك التشفير؛ لا يوجد fallback صامت. |

## قائمة الاختبارات المنفذة

| الاختبار | الحالة | الدليل |
|---|---|---|
| تشفير ثم فك تشفير record بالمعلومات المطابقة | PASS | اختبار وحدة `AES-256-GCM record decrypts only with matching context`. |
| تغيير chunk index في AAD | PASS | فشل التحقق من GCM. |
| تعديل بايت ciphertext | PASS | فشل `decipher.final()` ولا يخرج plaintext موثوق. |
| IV فريد لكل chunk | PASS | اختبار تقارن IV لــindex 0 و1. |
| فحص الصياغة وتشغيل جميع الاختبارات | PASS | `npm run lint && npm test` في 26 أغسطس 2026. |

## قائمة الاختبارات اليدوية المطلوبة

| الاختبار | الإجراء | النتيجة المقبولة |
|---|---|---|
| تدوير مفتاح Vault | تشفير ملف بمفتاح Transit ثم تدوير المفتاح وفك DEK القديم | فك ناجح فقط حسب سياسة Vault، مع استمرار key version في metadata. |
| غياب Vault | تعطيل الوصول إلى `VAULT_ADDR` خلال التغليف | فشل الطلب وعدم إنشاء manifest صالح أو نقل ملف. |
| نمط الإنتاج مع مزود development | تشغيل `RUNTIME_ENV=production` و`KEY_PROVIDER=development` | توقف العملية قبل فتح منفذ الشبكة. |
| تسريب سجل | البحث في سجل تشغيل فاشل | لا يظهر `MASTER_KEY_B64` أو `VAULT_TOKEN` أو `wrappedDek` أو DEK. |
| تكرار IV متعمد | محاولة تمرير index يتجاوز المجال أو prefix غير صالح | رفض صريح، ولا يُستخدم IV مكرر. |

> **ضابط لا يقبل التنازل:** `MASTER_KEY_B64` مقبول في بيئة تطوير معزولة فقط. أي تشغيل إنتاجي يفرض `KEY_PROVIDER=vault`، ويجب أن تكون بيانات اعتماد Vault موجودة في Server 1 فقط.

## مراجع

[1] [Node.js Crypto: authenticated encryption](https://nodejs.org/api/crypto.html)
[2] [NIST SP 800-38D: GCM and GMAC](https://csrc.nist.gov/pubs/sp/800/38/d/final)
[3] [HashiCorp Vault Transit](https://developer.hashicorp.com/vault/docs/secrets/transit)

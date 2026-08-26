# تدقيق مركز — التشفير وإدارة المفاتيح

**نطاق المراجعة:** `shared/crypto.js` و`shared/key-provider.js` و`shared/validation.js` ومواضع تخزين metadata في `shared/database.js`.
**قاعدة المراجعة:** لم يُعدّل أي كود أثناء هذه المراجعة.
**النتيجة المؤقتة:** لا توجد ملاحظة CRITICAL أو HIGH؛ توجد ملاحظة MEDIUM واحدة يجب إصلاحها قبل استمرار البناء.

## ملخص النتائج

| المجال | النتيجة | الملاحظات |
|---|---|---|
| AES-256-GCM | PASS | يستخدم `createCipheriv` و`createDecipheriv` من Node.js مع `authTagLength=16`. |
| DEK العشوائي | PASS | يُنشأ DEK بطول 32 بايت من مصدر عشوائي تشفيري. |
| IV/nonce | PASS | prefix عشوائي فريد لكل ملف/DEK مقترن بـchunk index؛ يرفض index خارج مجال 32 بت. |
| AAD | PASS | يربط ciphertext بـfile ID وtransfer ID وترتيب chunk وطول plaintext. |
| authentication tags | PASS | فك التشفير لا ينجح قبل `decipher.final()` بعد تعيين tag وAAD. |
| فصل المفتاح عن العقد البعيدة | PASS تصميمياً | الحقل `wrappedDek` لا يُضمّن في `remoteTransferManifestSchema`، والتخزين البعيد سيستخدم `includeWrappedDek=false`. |
| Vault | PASS تصميمياً | الإنتاج يرفض بوضوح أي مزود غير Vault. |
| تدوير مفتاح تطويري | MEDIUM | المزوّد التطويري يربط فك التغليف حصراً بالإصدار الحالي ولا يملك خريطة مفاتيح إصدار قديم. |

## النتائج الحرجة والعالية

لا توجد نتائج Critical أو High في نطاق المراجعة الحالي.

## النتائج المتوسطة

1. **[MEDIUM] مزود التطوير لا يتيح قراءة ملفات ملفوفة بإصدار Development Key سابق.**

   | البند | التحليل |
   |---|---|
   | الموقع | `shared/key-provider.js`، الدالة `DevelopmentKeyProvider.unwrapDek`. |
   | المشكلة | تُرفض قيمة `wrappedDek` ما لم تطابق `DEV_KMS_KEY_VERSION` الحالي. بعد تدوير مفتاح تطوير، تفشل قراءة ملفات الإصدار السابق حتى لو ظل مفتاحه متاحاً بشكل مقصود. |
   | الأثر | قد يمنع اختبار الاسترجاع أو التعافي لملفات تطوير قديمة، ويضعف تحقق key-versioning في الاختبارات. لا يؤثر في نمط الإنتاج الذي يستخدم Vault Transit بإصدار ضمن ciphertext. |
   | سيناريو الاستغلال | ليس مسار كشف بيانات؛ إنه فقدان إمكانية قراءة موضعي عند تغيير إعداد تطوير من دون إبقاء المفتاح القديم. |
   | الإصلاح المطلوب | قبول خريطة مفاتيح تطوير صريحة `DEV_KMS_KEYS_JSON` بصيغة version→base64، مع استعمال الإصدار المضمّن في wrapped DEK، وحظرها في الإنتاج. |

## تحقق سلبي من التسريبات

فحص البحث الساكن رصد وجود أسماء `MASTER_KEY_B64` و`VAULT_TOKEN` و`wrappedDek` في كود الإدارة المشروع فقط، ولم يجد أي استدعاء `console.log` أو logger يطبع هذه القيم، أو أي تعطيل لـmTLS. لا توجد بعد طبقة سجلات تشغيلية؛ ستفحص عند Phase 8.

## قرار المعالجة

> تُعالج الملاحظة المتوسطة الآن قبل الانتقال إلى Phase 3. لا توجد ثغرة تصنف CRITICAL أو HIGH توقف التقدم، لكن تنفيذ الإصلاح مطلوب لإغلاق تعهد key versioning الوارد في الدليل.

## مراجع

[1] [NIST SP 800-38D: GCM/GMAC](https://csrc.nist.gov/pubs/sp/800/38/d/final)
[2] [Vault Transit: key rotation and ciphertext versions](https://developer.hashicorp.com/vault/docs/secrets/transit)

## إغلاق الملاحظة بعد المراجعة

بعد توثيق النتيجة، عُدّل مزوّد التطوير فقط ليقبل `DEV_KMS_KEYS_JSON`، وهي خريطة version→مفتاح base64، ويختار المفتاح وفق الإصدار المغلف. لا يغيّر هذا السلوك حظر مزود التطوير في الإنتاج. أُضيف اختبار `development provider unwraps an older configured key version`، وأصبح كامل اختبار الوحدات **PASS (6/6)**.

| رقم النتيجة | الحالة بعد الإصلاح | التحقق |
|---|---|---|
| MEDIUM-1 | CLOSED | تشغيل `npm run lint && npm test` بنجاح في 26 أغسطس 2026. |

> **حكم نقطة التدقيق:** PASS. لا توجد نتائج CRITICAL أو HIGH أو MEDIUM مفتوحة ضمن التشفير وإدارة المفاتيح، ويمكن الانتقال إلى Phase 3.

# سياسة الأمان

## ضوابط إلزامية

| المجال | الضابط |
|---|---|
| التشفير | AES-256-GCM من `node:crypto` فقط، مع DEK عشوائي فريد لكل ملف. |
| IV وAAD | IV من 8 بايت عشوائية + chunk index، وAAD يربط file ID وtransfer ID وindex والطول. |
| المفاتيح | Vault Transit إلزامي في production؛ `MASTER_KEY_B64` وضع تطوير فقط ومرفوض في production. |
| mTLS | TLS 1.3، CA موثوقة، client certificate مطلوب، `rejectUnauthorized=true`، تحقق CN/SAN تطبيقي. |
| الإلغاء | `MTLS_CRL_PATH`/`tls.crlPath` مطلوب في production لكل عقدة. |
| الهوية | Server 2 يقبل server1 فقط، وServer 3 يقبل server2 فقط. |
| البيانات الصريحة | Server 1 فقط؛ لا key provider ولا decrypt API في Server 2/3. |
| الملفات | UUID/index فقط في المسارات، `wx` للملفات المؤقتة، link بلا overwrite، permissions خاصة. |
| الحدود | حد upload/ chunk/timeout/rate limit؛ body متدفق لا يحمل الملف كاملاً في الذاكرة. |
| الحالة | state machine وtransactions وleases وidempotency. |
| السجلات | JSON منقح؛ لا body، authorization، cookie، token، keys، wrapped DEK، filename، stack trace. |

## نموذج التهديد

| المهاجم | القدرة | ما لا يستطيع الحصول عليه | الضوابط |
|---|---|---|---|
| A — إنترنت عام | يرسل uploads أو requests مشوهة إلى Server 1 | endpoint داخلي، DEK/Vault، مخزن Server 3 | HTTPS، Bearer production، rate/size limits، schema validation. |
| B — اختراق Server 2 | يقرأ أو يعدل ciphertext المؤقت | plaintext أو DEK أو Vault credentials | envelope encryption، manifest مصغر، غياب key provider، hash/AAD/GCM. |
| C — اختراق Server 3 | يقرأ ciphertext المخزن | plaintext أو DEK أو Vault credentials | نفس العزل، مسار لا يملك فك تشفير. |
| D — اختراق Server 1 | قد يصل plaintext الجاري وبيانات Vault بحسب حساب الخدمة | حدود Server 2/3 لا تمنع أثره على plaintext | حساب خدمة أقل صلاحية، Vault policy، hardening/monitoring، عزل VPS. |
| E — شهادة node مسروقة | يحاول انتحال node حتى الإلغاء | node آخر إذا CN/SAN غير مطابق أو الشهادة ملغاة | mTLS، identity check، CRL production، renewal سريع. |
| F — Vault token مسروق | يحاول فك DEK عبر Transit | plaintext المخزن دون ciphertext، وبيانات عقد أخرى | Vault policy ضيقة، token قصير العمر، audit logs، rotation/revocation. |

## إعدادات لا يجوز تعطيلها

لا تستخدم `NODE_TLS_REJECT_UNAUTHORIZED=0` ولا `rejectUnauthorized:false`. لا تضع private key أو Vault token أو Master Key في source code أو CLI arguments أو config files المشمولة بالنسخة. لا تستخدم مزود development في production. لا تعرض منافذ Server 2 أو Server 3 للإنترنت العام إلا عبر network policy تسمح فقط بعناوين العقدة السابقة.

## الاستجابة للحوادث

عند الاشتباه بتسريب شهادة، ألغها في CA، انشر CRL جديداً، أعد تشغيل العقد لتقرأ CRL، وأصدر شهادة بديلة. عند الاشتباه بتسريب Vault token، revoke فوراً ودوّر Transit key عند الحاجة. عند اختراق Server 2 أو Server 3، اعتبر ciphertext وmetadata المكشوفة معرضة، لكن لا تعتبر plaintext مكشوفاً دون دليل وصول منفصل إلى Server 1 أو Vault.

## حدود الإصدار

لا يشمل الإصدار API استرجاع plaintext للمستخدم، لأن ذلك يحتاج طبقة هوية وملكية وموافقة على مفتاح غير مدرجة في هذا التسليم. يحد ذلك عمداً من سطح الهجوم. لا تنشر production قبل اختبار CRL الفعلي وVault policy والتحمل في بيئتك.

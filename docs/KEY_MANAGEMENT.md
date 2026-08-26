# إدارة المفاتيح والتشفير

## Envelope Encryption

لكل ملف، ينشئ Server 1 **DEK** عشوائياً بطول 32 بايت. يستخدمه فقط أثناء معالجة upload لتشفير كل chunk بخوارزمية AES-256-GCM. لا يكتب DEK في ملف ciphertext أو remote manifest أو log أو API response.

| المادة | مكانها | من يستطيع الوصول | مدة الحياة |
|---|---|---|---|
| plaintext | stream/ذاكرة Server 1 فقط | عملية Server 1 | أثناء upload فقط؛ لا ينشأ plaintext temp file. |
| DEK | ذاكرة Server 1 ثم مغلف | Server 1 فقط | يمسح buffer بعد العملية؛ يحتاج لفك تشفير مستقبلي مصرح. |
| wrapped DEK | جدول `encryption_metadata` في DB Server 1 فقط | Server 1 وVault Transit بحسب policy | حتى سياسة الاحتفاظ بالملف. |
| Master Key / Transit Key | Vault فقط في production | Vault؛ لا يخرج كـplaintext للتطبيق | تديره Vault. |
| Vault Token | environment/secret manager لـServer 1 فقط | حساب خدمة Server 1 | قصير العمر قدر الإمكان؛ لا يسجل. |

## وضع الإنتاج: Vault Transit

يجب أن تكون القيم التالية موجودة في بيئة **Server 1 فقط**:

```bash
RUNTIME_ENV=production
KEY_PROVIDER=vault
VAULT_ADDR=https://vault.example.internal:8200
VAULT_TOKEN=<secret-from-service-account>
VAULT_TRANSIT_KEY=three-server-dek
MTLS_CRL_PATH=/etc/three-server/ca.crl.pem
```

يستدعي التطبيق `transit/encrypt/<key>` مع context مبني على `fileId`، ويخزن ciphertext الذي يعيده Vault باعتباره wrapped DEK. عند فك التشفير المستقبلي، يجب استعمال context نفسه. في حال عدم توفر Vault أو إرجاعه استجابة غير صالحة، يفشل التطبيق مغلقاً؛ لا يوجد fallback إلى environment master key.

### سياسة Vault الدنيا المقترحة

```hcl
path "transit/encrypt/three-server-dek" { capabilities = ["update"] }
path "transit/decrypt/three-server-dek" { capabilities = ["update"] }
```

خصص policy وtoken منفصلين لـServer 1، ولا تضع Vault address أو token أو policy في إعدادات Server 2/3. للحد من blast radius، لا تمنح API غير المشمولة بالإصدار صلاحية decrypt حتى تنفذ طبقة استرجاع بملكية وموافقة واضحة.

## وضع التطوير فقط

يسمح `KEY_PROVIDER=development` بمفتاح base64 محلي للاختبارات:

```bash
RUNTIME_ENV=development
KEY_PROVIDER=development
DEV_KMS_KEY_VERSION=v2
DEV_KMS_KEYS_JSON='{"v1":"<32-byte-base64>","v2":"<32-byte-base64>"}'
```

إذا لم تستخدم `DEV_KMS_KEYS_JSON`، يقبل `MASTER_KEY_B64` لمفتاح واحد. يحظر التطبيق هذا المزوّد عندما `RUNTIME_ENV=production`.

## التدوير والإلغاء

Vault Transit يضمّن key version في wrapped ciphertext. قبل تدوير transit key، تأكد من بقاء decrypt للإصدارات القديمة بحسب سياسة Vault. دوّر Vault token والشهادات وCRL وفق حادثة أو جدول مؤسسي. في وضع التطوير، تدعم `DEV_KMS_KEYS_JSON` قراءة الإصدار السابق لاختبار migration، لكن لا تعد بديلاً عن Vault.

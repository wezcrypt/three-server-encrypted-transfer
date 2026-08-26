# معمارية نظام النقل المشفّر عبر ثلاث خوادم

## نظرة عامة

ينقل النظام الملفات عبر ثلاث عقد مفصولة بحدود ثقة صريحة. **Server 1** هو الطرف الوحيد الذي يعالج plaintext أو يتعامل مع مزود المفاتيح. يستقبل Server 2 وServer 3 فقط records مشفرة بـAES-256-GCM وmetadata دنيا لازمة للتحقق والاستئناف.

```text
Client -- HTTPS + Bearer --> Server 1 -- mTLS --> Server 2 -- mTLS --> Server 3
                                |                 |                 |
                           plaintext+DEK      ciphertext only    ciphertext only
                           Vault access       no key provider    no key provider
```

## حدود الثقة

| العقدة | المدخلات | الوصول المسموح | البيانات المحظورة |
|---|---|---|---|
| Server 1 Upload | upload stream من العميل، وإعداد Vault | plaintext مؤقت في الذاكرة، DEK، Vault Transit، ciphertext مؤقت | تمرير DEK أو wrapped DEK أو filename للعقد البعيدة. |
| Server 2 Relay | mTLS من Server 1 فقط | ciphertext chunks، hashes، transfer/file UUIDs | plaintext، DEK، Master Key، Vault token، اسم الملف ونوعه وحجمه الصريح. |
| Server 3 Storage | mTLS من Server 2 فقط | ciphertext chunks، hashes، storage key مبني من file ID | plaintext، DEK، Master Key، Vault token، اسم الملف ونوعه وحجمه الصريح. |

## تسلسل النقل

| المرحلة | الإجراء | حالة النقل |
|---|---|---|
| 1 | Server 1 يخصص `transferId` و`fileId` وDEK فريد، ثم يسجل `ENCRYPTING`. | `ENCRYPTING` |
| 2 | يجمع stream إلى AES-GCM records؛ IV فريد لكل record وAAD يربط file/transfer/index/length. | `ENCRYPTED` |
| 3 | يرسل manifest مصغراً إلى Relay عبر mTLS؛ لا يحمل DEK أو plaintext metadata. | `RELAY_RECEIVING` |
| 4 | Relay يتحقق من SHA-256 لكل chunk ثم hash كامل للـciphertext. | `RELAY_VERIFIED` |
| 5 | Relay ينقل chunks إلى Storage بمصادقة mTLS، وStorage يتحقق منها ثم hash كامل. | `STORAGE_RECEIVING` |
| 6 | Storage يسجل `STORED` ويرد `storageKey=files/<fileId>`. | `STORED` |
| 7 | Relay يحذف temporary ciphertext بعد الرد؛ Server 1 يحذف ciphertext المؤقت فقط بعد `STORED`. | `STORED` |

## التخزين والحالة

تملك كل عقدة SQLite مستقلة مع WAL وforeign keys مفعلة. الجداول هي `files` و`transfers` و`chunks` و`nodes` و`encryption_metadata` و`events`. تسجل عمليات انتقال الحالة وكتابة chunk ضمن معاملات ذرية. تُستخدم lease في Relay عند مرحلة الإرسال إلى Storage لمنع عاملين من تنفيذ transfer واحد بالتزامن.

يخزن Server 3 الملفات في `files/<fileId>/chunks/<chunkIndex>.chunk` ولا يستخدم أبداً filename المرسل من العميل كجزء من المسار. يخزن Server 2 اسماً placeholder محلياً فقط: `opaque-<fileId>`.

## واجهات الشبكة

| العقدة | Endpoint | الطرف المخول |
|---|---|---|
| Server 1 | `POST /upload` | عميل يحمل Bearer token في production. |
| Server 1 | `GET /transfers/:transferId` و`GET /health` | Bearer token في production. |
| Server 2 | `/internal/transfers*` و`/health` | شهادة mTLS لهوية server1 فقط. |
| Server 3 | `/internal/transfers*` و`/health` | شهادة mTLS لهوية server2 فقط. |

## الاستئناف

يحفظ كل Server عداد chunks verified. يعيد Server 1 manifest مطابقاً ثم يبدأ من `nextChunk` الذي يؤكده Relay. الـmanifest أو chunk المتطابقان idempotent؛ أما conflicting duplicate فيرفض. عامل صيانة كل دقيقة ينقل stale transfers إلى recovery ويحذف فقط ملفات `.part` غير المؤكدة بعد timeout قابل للتهيئة؛ لا يحذف ciphertext المكتمل أو chunks verified أو Storage النهائي.

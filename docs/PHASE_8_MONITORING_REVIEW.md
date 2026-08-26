# Phase 8 — Monitoring, Logging, Health

**الحالة:** مكتملة. تستخدم الخوادم سجلات JSON منظمة منقحة وواجهات صحة تمنع كشف secrets أو بيانات الملفات.

## السجلات المنظمة

| العقدة | أحداث مسجلة | بيانات مستبعدة صراحةً |
|---|---|---|
| Server 1 | نجاح النقل، فشل النقل، خطأ معالج الطلب | `authorization`، tokens، Master Key، Vault Token، wrapped DEK، filename، request body، stack/message. |
| Server 2 | تأكيد Storage، فشل Relay→Storage، خطأ طلب | نفس القائمة، مع عدم وجود plaintext أو key provider في هذه العقدة. |
| Server 3 | تأكيد التخزين، فشل التحقق النهائي، خطأ طلب | نفس القائمة، مع عدم وجود plaintext أو key provider في هذه العقدة. |

يسجل النظام `transferId` و`fileId` وأكواد أحداث ثابتة، وهي بيانات تشغيلية لازمة للتتبع ولا تحمل اسم المستخدم أو محتوى الملف. جميع الحقول الحساسة في logger تمر عبر قائمة redaction مركزية.

## واجهات الصحة

| Endpoint | الحماية | الحقول |
|---|---|---|
| `GET /health` — Server 1 | Bearer token عندما يكون مهيأً؛ إلزامي في production | uptime، RSS، heap، CPU/load، RAM، disk، active/failed transfers. |
| `GET /health` — Server 2 | mTLS وهوية server1 فقط | نفس حقول التشغيل، بلا metadata ملف. |
| `GET /health` — Server 3 | mTLS وهوية server2 فقط | نفس حقول التشغيل، بلا metadata ملف. |

## التحقق

| الاختبار | النتيجة |
|---|---|
| فحص صياغة كامل | PASS |
| جميع اختبارات الوحدة والتكامل | PASS: 12/12 في 26 أغسطس 2026. |
| اختبار health snapshot | PASS؛ يحتوي مؤشرات النقل ولا يحتوي `wrappedDek` أو `filename`. |
| مراجعة redaction | PASS؛ تتضمن authorization/cookie/body/keys/tokens/filename/error stack. |

> **قرار المتابعة:** لا تسجل هذه المرحلة محتوى plaintext أو credentials أو wrapped key. يمكن الانتقال إلى مجموعة الاختبارات الأمنية Phase 9.

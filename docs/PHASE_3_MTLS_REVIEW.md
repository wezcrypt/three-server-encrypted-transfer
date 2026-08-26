# Phase 3 — إعداد mTLS والهوية

**حالة البناء:** مكتملة.
**الخطوة التالية:** جلسة تدقيق مركزة للقسم 5 من الدليل، قبل بناء APIs الخوادم.

## التنفيذ

| البند | التنفيذ | الضابط |
|---|---|---|
| CA داخلية | سكربت تطوير يولد CA RSA-4096 وشهادات RSA-3072 منفصلة لـserver1/server2/server3 | المفاتيح الخاصة تكتب بصلاحية `0600`، ولا تُدرج أي شهادة أو مفتاح في الكود. |
| استخدام الشهادات | كل شهادة تملك `serverAuth` و`clientAuth`، وSAN خاصاً بهوية العقدة | يمكن لكل عقدة أن تكون TLS server وTLS client ضمن مسار mTLS. |
| مصافحة mTLS | `requestCert: true` و`rejectUnauthorized: true` على الخادم والعميل | اتصال بلا شهادة موثوقة يُرفض قبل API handler. |
| حد TLS | TLS 1.3 كحد أدنى | لا يوجد fallback إلى TLS أقدم. |
| التحقق التطبيقي | تتحقق `verifyRequestPeer` و`verifyResponsePeer` من socket authorization ومن CN/SAN للهوية المتوقعة | شهادة صحيحة لـnode آخر لا تخول استدعاء endpoint دور مختلف. |
| عميل داخلي | `mtlsRequest` يقبل HTTPS فقط ويتحقق من هوية الخادم بعد المصافحة | يمنع خطأ توجيه Relay/Storage إلى endpoint غير متوقع. |

## اختبارات منفذة

| الاختبار | الحالة | النتيجة |
|---|---|---|
| Client server1 موثق إلى server2 مع تحقق server2 من server1 | PASS | استجابة 200 وidentity=`server1`. |
| Client يتوقع server3 لكنه يتصل بشهادة server2 | PASS | العميل يرفض الاستجابة لاختلاف الهوية. |
| فحص صياغة المصدر | PASS | `npm run lint`. |

## قائمة اختبارات يدوية

| الاختبار | الإجراء | النتيجة المقبولة |
|---|---|---|
| عميل بلا شهادة | استدعاء منفذ Server 2 بـTLS عادي | فشل المصافحة. |
| شهادة CA أخرى | تقديم شهادة client صدرتها CA غير موثوقة | فشل المصافحة. |
| شهادة server3 على endpoint يستدعيه server1 | محاولة نداء API Server 2 من شهادة server3 | رفض HTTP 403 بسبب `MTLS_IDENTITY_MISMATCH`. |
| شهادة منتهية | استبدال شهادة node بشهادة منتهية | فشل المصافحة. |
| إعداد إنتاجي ناقص | حذف ca أو cert أو key | فشل الإقلاع بأمان قبل فتح المنفذ. |

> **حدود الإصدار:** سكربت الشهادات مخصص للتطوير والاختبارات فقط. الإنتاج يتطلب CA داخلية مُدارة، وسياسة إصدار وتجديد وإلغاء شهادات موثقة في `DEPLOYMENT.md`.

## مراجع

[1] [Node.js TLS API](https://nodejs.org/api/tls.html)
[2] [OWASP TLS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)

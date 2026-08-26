# Phase 10 — Documentation, Deployment, Connector

**الحالة:** مكتملة؛ تنتقل الحزمة إلى المراجعة الأمنية النهائية للأقسام 1–21.

## تسليمات Phase 10

| التسليم | المسار | التحقق |
|---|---|---|
| كود Server 1 | `server1-upload/index.js` | مشمول في اختبارات التكامل، التشفير، والاستئناف. |
| كود Server 2 | `server2-relay/index.js` | مشمول في mTLS/replay/e2e. |
| كود Server 3 | `server3-storage/index.js` | مشمول في e2e والتحقق النهائي. |
| تطبيق الربط | `connector/index.js` | CLI تفاعلي يجمع بيانات العقد الثلاث، ينشئ configs ويشغلها تلقائياً. |
| Linux binary | `dist/three-server-connector-linux-x64` | ELF x86_64؛ تم اختباره بـ`--help` و`--generate` وإطلاق العقد الفعلي. |
| Windows binary | `dist/three-server-connector-win-x64.exe` | PE32+ x64؛ يحزم ملحق SQLite Windows x64، ويتطلب اختبار تشغيل أخير على Windows مستهدف قبل production. |
| المعمارية | `docs/ARCHITECTURE.md` | يحدد حدود الثقة والمسارات وواجهات الشبكة. |
| الأمان | `docs/SECURITY.md` | يحدد الضوابط ونموذج التهديد والحوادث. |
| المفاتيح | `docs/KEY_MANAGEMENT.md` | يحدد Vault/development/key rotation. |
| النشر | `docs/DEPLOYMENT.md` | يحدد VPS/systemd/Firewall/checklist production. |

## ضمان تطبيق الربط

> بعد إدخال العنوان والمنفذ والشهادات والمفتاح ومسار التخزين لكل عقدة والضغط على متابعة CLI، لا يطلب التطبيق إعداداً يدوياً إضافياً. يتحقق من الملفات، ينشئ three node configs، يشغّل Server 3 ثم Server 2 ثم Server 1، ويشغل منطق التشفير والمصادقة والاستئناف المضمن في الخوادم تلقائياً.

في بيئة source، يشغّل Connector ثلاث عمليات Node. في binary المعبأ، يشغّل العقد الثلاث داخل العملية المعبأة نفسها لتوافق Windows/Linux. في production الموزع على VPS منفصلة، يُوزع source/binary لكل عقدة وفق `DEPLOYMENT.md` وتبقى بيانات الاتصال والـmTLS متطابقة.

## ملاحظة تشغيلية مهمة

يتحقق الـLinux binary فعلياً في هذا التسليم. لا يمكن تشغيل PE32+ داخل بيئة Linux الحالية؛ لذلك يبقى اختبار acceptance على Windows x64 بنداً مطلوباً قبل نشر production، لا عيباً مكتشفاً في source code. الملحق المدمج له ABI Node 22 Windows x64 المطابق للـbinary.

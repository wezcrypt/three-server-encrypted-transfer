# نظام نقل ملفات مشفّر عبر ثلاث خوادم

[![English](https://img.shields.io/badge/Language-English-2563eb)](README.md)
[![العربية](https://img.shields.io/badge/اللغة-العربية-0f766e)](README.AR.md)

تنفيذ مرجعي يركز على الأمان لنقل ملفات مرن عبر ثلاث خدمات معزولة.

## تحميل Connector

اختر نظام التشغيل لتنزيل تطبيق Connector الجاهز مباشرةً. لا تحتاج إلى بناء التطبيق أو كتابة أي أمر كي تحمّله.

[![تنزيل Windows](https://img.shields.io/badge/تنزيل-Windows%20EXE-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/wezcrypt/three-server-encrypted-transfer/releases/download/v1.0.0/three-server-connector-win-x64.exe)
[![تنزيل Linux](https://img.shields.io/badge/تنزيل-Linux%20x64-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/wezcrypt/three-server-encrypted-transfer/releases/download/v1.0.0/three-server-connector-linux-x64)

تتضمن صفحة الإصدار أيضاً ملف بصمات SHA-256 للتحقق من سلامة الملفات وملاحظات الإصدار الكاملة.

```text
العميل  ── HTTPS + Bearer ──>  Server 1: Upload  ── mTLS ──>  Server 2: Relay  ── mTLS ──>  Server 3: Storage
                                       │                                           │                           │
                                plaintext + DEK                            ciphertext فقط             ciphertext فقط
                                وصول إلى Vault                               بلا مفاتيح                 بلا مفاتيح
```

يشفّر النظام كل ملف عند حدود الرفع، وينقل ciphertext المتحقق منه على شكل chunks، ثم يخزّن ciphertext فقط في الوجهة النهائية. يعتمد التصميم على حدود ثقة صريحة، وتشفيراً موثقاً، وmTLS، وحالة نقل دائمة، وتعافياً محافظاً من الأعطال.

> **تنبيه مهم:** المستودع متاح للعامة من أجل المراجعة والتطوير، لكنه **غير جاهز للإنتاج** قبل إكمال النتائج التشغيلية والاختبارات المرحلية المفتوحة في [تقرير التدقيق الأمني النهائي](docs/ar/FINAL_SECURITY_AUDIT.md). لا تستخدم شهادات التطوير أو مفاتيحه أو قيم الإعدادات النموذجية في بيئة الإنتاج.

## المزايا الأساسية

| الميزة | التنفيذ |
|---|---|
| تشفير لكل ملف | يُنشأ مفتاح بيانات DEK عشوائي بطول 256 بت لكل ملف ويستخدم مع AES-256-GCM. |
| Envelope Encryption | يقوم Server 1 فقط بتغليف DEK باستخدام HashiCorp Vault Transit في الإنتاج؛ ولا يستلم Server 2 أو Server 3 مفاتيح صريحة. |
| نقل آمن بين الخدمات | تتطلب الاتصالات الداخلية TLS 1.3 وشهادات عميل والتحقق من CA والتحقق التطبيقي من هوية العقدة وقائمة CRL في الإنتاج. |
| سلامة الـchunks | يتم تجزئة والتحقق من كل chunk مشفرة، ثم يتحقق التخزين النهائي من hash الكامل للـciphertext. |
| استئناف وتعافٍ | حالة نقل SQLite دائمة، ومعالجة idempotent للـmanifest، وchunks قابلة للاستئناف، وleases، وتنظيف محافظ للنقولات القديمة. |
| عزل البيانات الصريحة | يوجد plaintext كـstream داخل Server 1 فقط؛ ولا يوجد ملف plaintext مؤقت أو endpoint لفك التشفير أو مزود مفاتيح في Server 2 أو Server 3. |
| أدوات للمشغّل | تجمع واجهة Connector CLI إعدادات العقد، وتنشئ configuration محمية، وتشغل topology تطويرية مشتركة الموقع. |

## بنية المستودع

| المسار | الغرض |
|---|---|
| `server1-upload/` | HTTPS upload API وتشفير streaming وتغليف المفاتيح وتعافي النقل. |
| `server2-relay/` | ترحيل ciphertext عبر mTLS فقط مع تحقق manifest وchunks. |
| `server3-storage/` | التخزين النهائي للـciphertext والتحقق من hash الكامل. |
| `shared/` | التشفير والتحقق وSQLite وmTLS والمراقبة وآلة الحالات والتعافي. |
| `connector/` | مصدر واجهة المشغّل متعددة المنصات. |
| `config/` | مولد شهادات مخصص للتطوير فقط. |
| `migrations/` | مخطط SQLite الدائم. |
| `tests/` | اختبارات الوحدة والتكامل والتعافي وmTLS والأمان. |
| `docs/` | الوثائق الإنجليزية. |
| `docs/ar/` | الوثائق العربية الكاملة. |

## البدء السريع

### التشغيل من المصدر

```bash
npm install
npm run certs:dev
npm run lint
npm test
npm run test:security
```

ينشئ مولد شهادات التطوير المواد المحلية داخل `config/certs/` وهي مستثناة عمداً من Git. لا تستخدم هذه الشهادات في الإنتاج.

### بناء وتشغيل Connector

```bash
npm run build:connector
chmod +x dist/three-server-connector-linux-x64
./dist/three-server-connector-linux-x64
```

في Windows x64:

```powershell
.\dist\three-server-connector-win-x64.exe
```

تتحقق واجهة Connector من مواقع CA وCRL، وعناوين العقد، والمنافذ، وشهادات mTLS، والمفاتيح الخاصة، ومسارات التخزين، وحدود الرفع، وملف runtime. ثم تنشئ ملفات إعداد العقد المحمية وتشغّل الخدمات الثلاث لتوزيع تطويري مشترك الموقع.

## متطلبات الإنتاج

يجب أن تستخدم بيئة الإنتاج ثلاث عقد أو حسابات خدمة مستقلة. يجب أن يستطيع Server 1 الاتصال بـServer 2، ويستطيع Server 2 الاتصال بـServer 3. لا يجوز عرض endpoints الداخلية الخاصة بـServer 2 أو Server 3 على الإنترنت العام.

| المتطلب | التوقع في الإنتاج |
|---|---|
| مزود المفاتيح | `RUNTIME_ENV=production` و`KEY_PROVIDER=vault` على Server 1 فقط. |
| إلغاء الشهادات | CRL محدثة إلزامية في configuration كل عقدة. |
| التحكم بالوصول | استخدم upload token أو طبقة وصول موثقة مماثلة أمام Server 1. |
| سياسة الشبكة | اسمح فقط بـServer 1 → Server 2 وServer 2 → Server 3 على منافذ الخدمات الداخلية. |
| إدارة الأسرار | استخدم secret manager أو environment حساب خدمة. لا ترفع مفاتيح خاصة أو tokens أو بيانات Vault أو configuration مولدة إلى Git. |
| التحقق | أكمل الإصلاحات والاختبارات المذكورة في تقرير التدقيق قبل الإنتاج. |

راجع [دليل النشر](docs/ar/DEPLOYMENT.md) و[إدارة المفاتيح](docs/ar/KEY_MANAGEMENT.md) و[الأمان](docs/ar/SECURITY.md) للتفاصيل الكاملة.

## التحقق

```bash
npm run lint
npm test
npm run test:security
npm audit --omit=dev --audit-level=low
```

سجل التحقق المحلي النهائي الموثق نجاح 15 اختباراً للمشروع و3 اختبارات أمنية مخصصة وعدم وجود ثغرات في اعتماديات الإنتاج المدققة. أعد تنفيذ هذه الأوامر في بيئتك قبل كل إصدار.

## الوثائق

| الوثيقة | الوصف |
|---|---|
| [المعمارية](docs/ar/ARCHITECTURE.md) | حدود الثقة وتدفق البيانات وواجهات API وبنية التخزين ونموذج التعافي. |
| [الأمان](docs/ar/SECURITY.md) | الضوابط الأمنية ونموذج التهديد والاستجابة للحوادث وإعدادات الإنتاج الإلزامية. |
| [إدارة المفاتيح](docs/ar/KEY_MANAGEMENT.md) | دورة DEK وتهيئة Vault Transit وتدوير المفاتيح وحدود وضع التطوير. |
| [النشر](docs/ar/DEPLOYMENT.md) | topology ‏VPS والشهادات وsystemd وfirewall وقائمة التحقق قبل الإنتاج. |
| [تقرير التدقيق الأمني النهائي](docs/ar/FINAL_SECURITY_AUDIT.md) | النتائج وقرار الجاهزية والإصلاحات والاختبارات قبل الإنتاج. |
| [مراجعات المراحل](docs/ar/) | سجلات البناء والمراجعة لكل مرحلة تنفيذ. |

## المساهمة

راجع [CONTRIBUTING.md](CONTRIBUTING.md) قبل فتح issue أو pull request. يجب إبلاغ التقارير الأمنية الحساسة على نحو خاص وفق [SECURITY.md](SECURITY.md) بدلاً من الإفصاح العلني في issues.

## الترخيص

لم يُضف ترخيص مفتوح المصدر بعد. جميع الحقوق محفوظة ما لم يضف مالك المستودع ملف ترخيص.

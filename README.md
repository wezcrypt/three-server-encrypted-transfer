# Three-Server Encrypted Transfer / نظام نقل ملفات مشفّر عبر ثلاث خوادم

A production-oriented reference implementation for encrypted, resumable file transfer across **Server 1 (Upload) → Server 2 (Relay) → Server 3 (Storage)**. It uses envelope encryption, AES-256-GCM, chunk integrity checks, mutual TLS, a durable state machine, and conservative recovery rules.

تنفيذ مرجعي عملي لنقل ملفات مشفّرة وقابلة للاستئناف عبر **Server 1 (الرفع) → Server 2 (الترحيل) → Server 3 (التخزين)**. يستخدم تشفيراً مغلفاً، وAES-256-GCM، والتحقق من سلامة الـchunks، وmTLS، وآلة حالات دائمة، وقواعد تعافٍ محافظة تمنع فقدان البيانات.

> **Security status / الحالة الأمنية:** The final security review marks this repository **not production-ready until the documented operational HIGH finding and remaining staging tests are resolved**. Read [`docs/FINAL_SECURITY_AUDIT.md`](docs/FINAL_SECURITY_AUDIT.md) before deployment.
> يبيّن تقرير التدقيق الأمني النهائي أن الحزمة **غير جاهزة للنشر الإنتاجي** قبل معالجة النتيجة التشغيلية عالية الخطورة والاختبارات المتبقية في بيئة staging. راجع [`docs/FINAL_SECURITY_AUDIT.md`](docs/FINAL_SECURITY_AUDIT.md) قبل النشر.

## Architecture / المعمارية

```text
Client -- HTTPS + Bearer --> Server 1 -- mTLS --> Server 2 -- mTLS --> Server 3
                                |                 |                 |
                        plaintext + DEK      ciphertext only    ciphertext only
                        Vault access         no key access      no key access
```

| Component / المكوّن | English | العربية |
|---|---|---|
| Server 1 — Upload | Receives a streaming upload, generates a per-file DEK, encrypts without a plaintext temporary file, and sends ciphertext to Relay. | يستقبل الرفع المتدفق، وينشئ DEK فريداً لكل ملف، ويشفّر بلا ملف plaintext مؤقت، ثم يرسل ciphertext إلى Relay. |
| Server 2 — Relay | Accepts ciphertext only from Server 1 through mTLS, verifies every chunk, and relays it to final storage. | يستقبل ciphertext فقط من Server 1 عبر mTLS، ويتحقق من كل chunk، ثم يرحّلها إلى التخزين النهائي. |
| Server 3 — Storage | Verifies the complete ciphertext hash and stores chunks under `files/<fileId>`. | يتحقق من hash الكامل للـciphertext ويخزن الـchunks تحت `files/<fileId>`. |
| Connector | Interactive CLI that collects node addresses, ports, certificates, and storage paths; it generates configs and launches all nodes for a co-located development deployment. | واجهة CLI تفاعلية تجمع عناوين العقد ومنافذها وشهاداتها ومسارات التخزين؛ تنشئ الإعدادات وتشغّل العقد في نشر تطويري مشترك الموقع. |

## Repository layout / بنية المستودع

| Path / المسار | Contents / المحتوى |
|---|---|
| `server1-upload/` | HTTPS upload API, streaming encryption, envelope-key handling, and recovery. / API الرفع وتشفير streaming وإدارة مفاتيح التغليف والتعافي. |
| `server2-relay/` | mTLS-only ciphertext relay and chunk verification. / ترحيل ciphertext عبر mTLS والتحقق من الـchunks. |
| `server3-storage/` | Final ciphertext storage and complete hash verification. / التخزين النهائي للـciphertext والتحقق من hash الكامل. |
| `shared/` | Cryptography, validation, state machine, SQLite, mTLS, logging, and recovery helpers. / التشفير والتحقق وآلة الحالات وSQLite وmTLS والسجلات والتعافي. |
| `connector/` | Unified bilingual CLI source. / مصدر واجهة CLI الموحدة. |
| `docs/` | Architecture, deployment, key-management, and security-review documents. / وثائق المعمارية والنشر والمفاتيح والتدقيق الأمني. |
| `tests/` | Unit, integration, and security tests. / اختبارات الوحدة والتكامل والأمان. |
| `dist/` | Built Linux x64 connector and Windows x64 executable. / تطبيق الربط المبني للينكس وملف Windows التنفيذي. |

## Quick start / بدء سريع

### Source development / تطوير المصدر

```bash
npm install
npm run certs:dev
npm test
npm run test:security
npm run build:connector
```

The development certificate generator is local-only. Do **not** use development certificates or the environment-based key provider in production.

مولد شهادات التطوير محلي فقط. **لا** تستخدم شهادات التطوير أو مزود المفاتيح القائم على environment في الإنتاج.

### Connector binaries / تطبيق الربط المعبأ

**Linux x64 / لينكس x64**

```bash
chmod +x dist/three-server-connector-linux-x64
./dist/three-server-connector-linux-x64
```

**Windows x64 / ويندوز x64**

```powershell
.\dist\three-server-connector-win-x64.exe
```

The CLI asks for each server’s address, port, mTLS certificate, private key, CA/CRL path, and storage path. It validates the entries, generates protected node configuration files, and starts the three services automatically for a co-located deployment.

تطلب واجهة CLI عنوان ومنفذ وشهادة mTLS والمفتاح الخاص ومسار CA/CRL ومسار التخزين لكل خادم. ثم تتحقق من القيم، وتنشئ ملفات إعداد محمية، وتشغّل الخدمات الثلاث تلقائياً في النشر المشترك الموقع.

## Production requirements / متطلبات الإنتاج

| Requirement / المتطلب | English | العربية |
|---|---|---|
| Key management | Server 1 must use HashiCorp Vault Transit: `RUNTIME_ENV=production` and `KEY_PROVIDER=vault`. | يجب أن يستخدم Server 1 ‏HashiCorp Vault Transit مع `RUNTIME_ENV=production` و`KEY_PROVIDER=vault`. |
| Certificate revocation | A current CRL is mandatory for production configuration. | CRL محدثة إلزامية لإعدادات الإنتاج. |
| Network isolation | Permit only Server 1 → Server 2 and Server 2 → Server 3 on internal ports. | اسمح فقط بـServer 1 → Server 2 وServer 2 → Server 3 على المنافذ الداخلية. |
| Separate nodes | Deploy each server on a separate VPS or service account. | انشر كل خادم في VPS أو حساب خدمة منفصل. |
| Readiness | Complete the open items in the final audit before production. | أكمل البنود المفتوحة في تقرير التدقيق النهائي قبل الإنتاج. |

## Verification / التحقق

```bash
npm run lint
npm test
npm run test:security
npm audit --omit=dev --audit-level=low
```

The final local verification completed with **15 project tests passing**, **3 security tests passing**, and **0 audited dependency vulnerabilities** on 26 August 2026.

اكتمل التحقق المحلي النهائي بنجاح **15 اختباراً للمشروع** و**3 اختبارات أمنية**، مع **0 ثغرات في الاعتماديات المدققة** بتاريخ 26 أغسطس 2026.

## Documentation / الوثائق

- [Architecture / المعمارية](docs/ARCHITECTURE.md)
- [Security / الأمان](docs/SECURITY.md)
- [Key Management / إدارة المفاتيح](docs/KEY_MANAGEMENT.md)
- [Deployment / النشر](docs/DEPLOYMENT.md)
- [Final Security Audit / تقرير التدقيق الأمني النهائي](docs/FINAL_SECURITY_AUDIT.md)
- [Phase Reviews / مراجعات المراحل](docs/)

## License / الترخيص

No license has been selected for this repository. Choose an appropriate license before publishing a reusable public project.

لم يُحدد ترخيص لهذا المستودع. اختر ترخيصاً مناسباً قبل نشر مشروع عام قابل لإعادة الاستخدام.

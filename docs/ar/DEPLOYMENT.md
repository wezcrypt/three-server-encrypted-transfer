# النشر والتشغيل

## متطلبات النشر

انشر كل عقدة في VPS أو حساب خدمة منفصل. لا تشارك system users أو مسارات التخزين أو بيانات Vault بين Server 1 وServer 2 وServer 3. ثبّت Node.js 22.13.x عند تشغيل المصدر، أو استخدم binary المعبأ للمنصة المناسبة. يحتاج binary إلى certificate/key/CA/CRL ومسار تخزين قابل للكتابة؛ لا يحتاج Node.js للمسار المعبأ.

| العقدة | المنفذ المقترح | ingress policy | secret محلي |
|---|---:|---|---|
| Server 1 | 8443 | العميل/Reverse proxy | Vault token فقط في production، upload token. |
| Server 2 | 9443 | عناوين Server 1 فقط | private key وشهادة node فقط. |
| Server 3 | 10443 | عناوين Server 2 فقط | private key وشهادة node فقط. |

## الشهادات

للتطوير فقط:

```bash
npm install
npm run certs:dev
```

ينشئ الأمر CA وشهادات nodes تحت `config/certs`. لا تستخدمها في production. أصدر CA وشهادات production عبر PKI مؤسسية، وأمّن private key بـ`0600` في POSIX، وانشر CRL محدثة. يجب أن يحتوي config production على `tls.crlPath` لكل عقدة.

## استخدام تطبيق الربط

### Linux

```bash
chmod +x three-server-connector-linux-x64
./three-server-connector-linux-x64
```

### Windows

```powershell
.\three-server-connector-win-x64.exe
```

تظهر الواجهة CLI التفاعلية مرتبةً حقول runtime ومسار CA/CRL، ثم العنوان والمنفذ والشهادة والمفتاح ومسار التخزين لكل من Server 1/2/3، ثم token وupload limit. عند الإنهاء، تتحقق من المسارات والقيم، وتنشئ ملفات node config مقيدة الصلاحية في workspace، وتشغل العقد الثلاث تلقائياً. في development ينشئ التطبيق DEK master development عشوائياً داخل بيئة العملية إذا لم يكن موجوداً. في production يجب تزويد Vault environment variables لـServer 1.

لتهيئة غير تفاعلية:

```bash
./three-server-connector-linux-x64 --generate connector.json
# حرر connector.json بقيم حقيقية، مع عدم وضع Vault token فيه
./three-server-connector-linux-x64 --config connector.json
```

## تشغيل المصدر مع systemd

عند توزيع source code على عقد منفصلة، أنشئ config JSON مستقلاً لكل عقدة ثم استخدم وحدة systemd مماثلة:

```ini
[Unit]
Description=Three Server Upload Node
After=network-online.target

[Service]
Type=simple
User=three-server1
Group=three-server1
WorkingDirectory=/opt/three-server-transfer
Environment=CONFIG_PATH=/etc/three-server/server1.json
EnvironmentFile=/etc/three-server/server1.env
ExecStart=/usr/bin/node /opt/three-server-transfer/server1-upload/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/three-server1

[Install]
WantedBy=multi-user.target
```

أنشئ وحدات منفصلة لـServer 2 وServer 3 مع `ExecStart` و`CONFIG_PATH` ومسار الخدمة المناسبين. لا تستخدم user root. إذا استخدمت nginx أمام Server 1، مرر HTTPS إلى Server 1 أو تأكد أن TLS بين nginx وServer 1 موثوق؛ لا تضع Server 2/3 خلف proxy عام.

## checklist ما قبل الإنتاج

| الإجراء | مطلوب |
|---|---|
| `KEY_PROVIDER=vault` وVault policy ضيقة في Server 1 | نعم |
| غياب `MASTER_KEY_B64` و`DEV_KMS_KEYS_JSON` من production | نعم |
| CRL production صحيحة ومختبرة بشهادة ملغاة | نعم |
| private keys صلاحيتها 0600 ومملوكة لحساب الخدمة | نعم |
| firewall يسمح فقط Server 1→2 وServer 2→3 | نعم |
| volume منفصل ومشفّر لكل storage path | نعم |
| backup مشفر لـSQLite وStorage Server 3 | نعم |
| `npm test` و`npm run test:security` وdependency audit في CI | نعم |
| اختبار تحميل وتعطل الشبكة في حجم الإنتاج | نعم |

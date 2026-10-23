#!/bin/bash
# First boot of the FireJam server (Amazon Linux 2023, arm64).
set -euxo pipefail
dnf install -y nodejs22 nodejs22-npm tar
ln -sf /usr/bin/node-22 /usr/bin/node || true
ln -sf /usr/bin/npm-22 /usr/bin/npm || true

mkdir -p /opt/firejam
cat > /opt/firejam/update.sh <<'EOF'
#!/bin/bash
# Pull the latest release from S3, install, restart. Run by deploy.sh through Systems Manager.
set -euo pipefail
cd /opt/firejam
aws s3 cp s3://__BUCKET__/latest.tgz /opt/firejam/latest.tgz --region __REGION__
rm -rf /opt/firejam/app.new && mkdir -p /opt/firejam/app.new
tar -xzf latest.tgz -C /opt/firejam/app.new
# Keep profiles and history across releases.
mkdir -p /opt/firejam/data
cd /opt/firejam/app.new && npm ci --omit=dev --workspace server --include-workspace-root=false --no-audit --no-fund
rm -rf /opt/firejam/app && mv /opt/firejam/app.new /opt/firejam/app
systemctl restart firejam
echo "released $(date -u)"
EOF
chmod +x /opt/firejam/update.sh

cat > /etc/systemd/system/firejam.service <<'EOF'
[Unit]
Description=FireJam server
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/firejam/app/server
ExecStart=/usr/bin/node --import tsx src/index.ts
Environment=FIREJAM_PORT=80
Environment=FIREJAM_DATA_DIR=/opt/firejam/data
# The AWS SDK reads ~/.aws; the sandboxed service user needs a home to look in.
Environment=HOME=/opt/firejam/data
Environment=AWS_REGION=__REGION__
Environment=NODE_ENV=production
Restart=always
RestartSec=2
DynamicUser=yes
ReadWritePaths=/opt/firejam/data
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
# The sandboxed service user (DynamicUser) must be able to save profiles here.
mkdir -p /opt/firejam/data && chmod 0777 /opt/firejam/data
systemctl daemon-reload
systemctl enable firejam
/opt/firejam/update.sh

#!/usr/bin/env bash
# Deploys FireJam to AWS:
#   S3          holds the release tarball
#   EC2         one Graviton t4g.micro (Amazon Linux 2023) runs the Node server under systemd
#   IAM         instance role: read the release from S3, Systems Manager access (no SSH keys),
#               and Amazon Bedrock for "Pick for us"
#   CloudFront  HTTPS + WebSockets in front of the instance (https://<id>.cloudfront.net)
#
# Re-running it ships a new release to the same instance (via SSM) and keeps the URL.
#
# Usage: bash deploy/aws/deploy.sh            (region: AWS_REGION, default ap-southeast-2)
set -euo pipefail

AWS=${AWS:-aws}
# Sydney. (This account's organization only allows ap-southeast-2; CloudFront's edges in
# India and elsewhere carry viewers to it, ~150 ms from India, which the sync absorbs.)
REGION=${AWS_REGION:-ap-southeast-2}
NAME=firejam
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$ROOT/deploy/aws"
STATE="$HERE/.state"
mkdir -p "$STATE"
aws_() { "$AWS" --region "$REGION" --output text "$@"; }
note() { printf '\n== %s\n' "$*"; }
# On Windows (Git Bash) aws.exe needs Windows paths, and MSYS must not rewrite args like /aws/service/....
export MSYS_NO_PATHCONV=1
win() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
fileurl() { printf 'file://%s' "$(win "$1")"; }

ACCOUNT=$(aws_ sts get-caller-identity --query Account)
BUCKET="$NAME-releases-$ACCOUNT-$REGION"
note "Account $ACCOUNT, region $REGION"

# ---------- release ----------
note "Building the web app and packing a release"
(cd "$ROOT" && npm run build >/dev/null)
# Ship the TV app too, so any Android TV / Fire TV can install it from <url>/firejam.apk.
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then cp "$APK" "$ROOT/web/dist/firejam.apk" && echo "including firejam.apk"; fi
REL="release-$(date +%Y%m%d%H%M%S).tgz"
tar -czf "$STATE/$REL" -C "$ROOT" \
  --exclude='server/data' --exclude='server/media/*.mp4' \
  package.json package-lock.json shared server web/package.json web/dist

if ! aws_ s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  aws_ s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  aws_ s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi
aws_ s3 cp "$(win "$STATE/$REL")" "s3://$BUCKET/$REL" >/dev/null
aws_ s3 cp "$(win "$STATE/$REL")" "s3://$BUCKET/latest.tgz" >/dev/null
echo "uploaded s3://$BUCKET/$REL"

# ---------- IAM role for the instance ----------
ROLE="$NAME-server"
if ! aws_ iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  note "Creating instance role $ROLE"
  aws_ iam create-role --role-name "$ROLE" --assume-role-policy-document "$(fileurl "$HERE/trust-ec2.json")" >/dev/null
  aws_ iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws_ iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws_ iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  sleep 10 # instance profiles take a moment to become usable
fi
sed "s/__BUCKET__/$BUCKET/g" "$HERE/server-policy.json" > "$STATE/server-policy.json"
aws_ iam put-role-policy --role-name "$ROLE" --policy-name "$NAME-server" --policy-document "$(fileurl "$STATE/server-policy.json")"

# ---------- instance ----------
INSTANCE=$(aws_ ec2 describe-instances \
  --filters "Name=tag:Name,Values=$NAME-server" "Name=instance-state-name,Values=pending,running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId')
if [ "$INSTANCE" = "None" ] || [ -z "$INSTANCE" ]; then
  note "Launching the server instance"
  VPC=$(aws_ ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId')
  # Only CloudFront may reach the instance; there is no SSH (Systems Manager is used instead).
  SG=$(aws_ ec2 create-security-group --group-name "$NAME-server" --description "FireJam: HTTP from CloudFront only" --vpc-id "$VPC" --query GroupId)
  PL=$(aws_ ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId')
  aws_ ec2 authorize-security-group-ingress --group-id "$SG" \
    --ip-permissions "IpProtocol=tcp,FromPort=80,ToPort=80,PrefixListIds=[{PrefixListId=$PL}]" >/dev/null
  AMI=$(aws_ ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value)
  sed "s/__BUCKET__/$BUCKET/g; s/__REGION__/$REGION/g" "$HERE/user-data.sh" > "$STATE/user-data.sh"
  INSTANCE=$(aws_ ec2 run-instances --image-id "$AMI" --instance-type t4g.micro \
    --iam-instance-profile Name="$ROLE" --security-group-ids "$SG" \
    --user-data "$(fileurl "$STATE/user-data.sh")" \
    --metadata-options HttpTokens=required \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME-server}]" \
    --query 'Instances[0].InstanceId')
  aws_ ec2 wait instance-running --instance-ids "$INSTANCE"
  # A fixed address so the CloudFront origin never changes.
  ALLOC=$(aws_ ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME-server}]" --query AllocationId)
  aws_ ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" >/dev/null
  sleep 5
else
  note "Shipping $REL to $INSTANCE"
  aws_ ec2 start-instances --instance-ids "$INSTANCE" >/dev/null
  aws_ ec2 wait instance-running --instance-ids "$INSTANCE"
  CMD=$(aws_ ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
    --parameters "commands=[\"/opt/firejam/update.sh\"]" --query Command.CommandId)
  aws_ ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
  aws_ ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query StandardOutputContent | tail -5
fi
ORIGIN=$(aws_ ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].PublicDnsName')
echo "instance $INSTANCE at $ORIGIN"

# ---------- CloudFront ----------
DIST=$(aws_ cloudfront list-distributions --query "DistributionList.Items[?Comment=='$NAME'].Id | [0]")
if [ "$DIST" = "None" ] || [ -z "$DIST" ]; then
  note "Creating the CloudFront distribution (HTTPS + WebSockets)"
  sed "s/__ORIGIN__/$ORIGIN/g; s/__REF__/$NAME-$(date +%s)/g" "$HERE/cloudfront.json" > "$STATE/cloudfront.json"
  DIST=$(aws_ cloudfront create-distribution --distribution-config "$(fileurl "$STATE/cloudfront.json")" --query Distribution.Id)
else
  # Same address for every TV even when the server moves (e.g. to another region): repoint the origin.
  CURRENT=$(aws_ cloudfront get-distribution-config --id "$DIST" --query 'DistributionConfig.Origins.Items[0].DomainName')
  if [ "$CURRENT" != "$ORIGIN" ]; then
    note "Pointing CloudFront at the new server ($CURRENT -> $ORIGIN)"
    "$AWS" cloudfront get-distribution-config --id "$DIST" --output json > "$STATE/dist.json"
    ETAG=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['ETag'])" "$(win "$STATE/dist.json")")
    python -c "
import json, sys
d = json.load(open(sys.argv[1]))['DistributionConfig']
d['Origins']['Items'][0]['DomainName'] = sys.argv[2]
json.dump(d, open(sys.argv[3], 'w'))" "$(win "$STATE/dist.json")" "$ORIGIN" "$(win "$STATE/dist-new.json")"
    aws_ cloudfront update-distribution --id "$DIST" --if-match "$ETAG" \
      --distribution-config "$(fileurl "$STATE/dist-new.json")" --query Distribution.Status
  fi
fi
DOMAIN=$(aws_ cloudfront get-distribution --id "$DIST" --query Distribution.DomainName)
echo "$DOMAIN" > "$STATE/domain"

note "FireJam is deploying at https://$DOMAIN"
echo "CloudFront takes a few minutes to go live everywhere. Check: curl -s https://$DOMAIN/api/info"

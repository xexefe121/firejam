#!/usr/bin/env bash
# Removes FireJam's server from one region: instance, its address, security group and
# release bucket. The CloudFront distribution is shared across regions and kept unless
# --all is given (it must be disabled first and takes ~15 minutes to delete).
#
# Usage: AWS_REGION=ap-southeast-2 bash deploy/aws/teardown.sh [--all]
set -euo pipefail
AWS=${AWS:-aws}
REGION=${AWS_REGION:?set AWS_REGION to the region to clean up}
export MSYS_NO_PATHCONV=1
aws_() { "$AWS" --region "$REGION" --output text "$@"; }
STATE="$(cd "$(dirname "$0")" && pwd)/.state"; mkdir -p "$STATE"
win() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
ACCOUNT=$(aws_ sts get-caller-identity --query Account)

for I in $(aws_ ec2 describe-instances --filters Name=tag:Name,Values=firejam-server "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId'); do
  echo "terminating $I"
  aws_ ec2 terminate-instances --instance-ids "$I" >/dev/null
  aws_ ec2 wait instance-terminated --instance-ids "$I"
done
for A in $(aws_ ec2 describe-addresses --filters Name=tag:Name,Values=firejam-server --query 'Addresses[].AllocationId'); do
  echo "releasing address $A"
  aws_ ec2 release-address --allocation-id "$A"
done
SG=$(aws_ ec2 describe-security-groups --filters Name=group-name,Values=firejam-server --query 'SecurityGroups[0].GroupId')
if [ "$SG" != "None" ] && [ -n "$SG" ]; then echo "deleting security group $SG"; aws_ ec2 delete-security-group --group-id "$SG"; fi
BUCKET="firejam-releases-$ACCOUNT-$REGION"
if aws_ s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "deleting bucket $BUCKET"
  aws_ s3 rb "s3://$BUCKET" --force >/dev/null
fi

if [ "${1:-}" = "--all" ]; then
  DIST=$(aws_ cloudfront list-distributions --query "DistributionList.Items[?Comment=='firejam'].Id | [0]")
  if [ "$DIST" != "None" ] && [ -n "$DIST" ]; then
    echo "disabling CloudFront $DIST (delete it once it shows Deployed)"
    "$AWS" cloudfront get-distribution-config --id "$DIST" --output json > "$STATE/dist.json"
    python -c "
import json, sys
d = json.load(open(sys.argv[1])); cfg = d['DistributionConfig']; cfg['Enabled'] = False
json.dump(cfg, open(sys.argv[2], 'w')); print(d['ETag'])" "$(win "$STATE/dist.json")" "$(win "$STATE/dist-off.json")" > "$STATE/etag"
    aws_ cloudfront update-distribution --id "$DIST" --if-match "$(cat "$STATE/etag")" --distribution-config "file://$(win "$STATE/dist-off.json")" >/dev/null
  fi
fi
echo "done: $REGION"

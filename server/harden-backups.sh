#!/bin/bash
# Make the data safe to lose nothing: 7-day backups, delete protection,
# versioning on the media bucket, old versions cleaned after 30 days,
# one snapshot right now, and a weekly snapshot kept for 30 days.
set -e
export AWS_DEFAULT_REGION=ap-southeast-2
DB=gdm-db
MEDIA=gooddaymates-media
ACC=$(aws sts get-caller-identity --query Account --output text)

echo "1+2) backups 7 days, delete protection on"
aws rds modify-db-instance --db-instance-identifier $DB \
  --backup-retention-period 7 --deletion-protection --apply-immediately >/dev/null
echo "   ok"

echo "3) versioning on the media bucket"
aws s3api put-bucket-versioning --bucket $MEDIA --versioning-configuration Status=Enabled
echo "   ok"

echo "4) old versions cleaned after 30 days"
cat > /tmp/lc.json <<'JSON'
{"Rules":[{"ID":"old-versions-30d","Status":"Enabled","Filter":{"Prefix":""},
"NoncurrentVersionExpiration":{"NoncurrentDays":30},
"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}]}
JSON
aws s3api put-bucket-lifecycle-configuration --bucket $MEDIA --lifecycle-configuration file:///tmp/lc.json
echo "   ok"

echo "5) a snapshot right now"
SNAP=gdm-db-manual-$(date -u +%Y%m%d-%H%M)
aws rds create-db-snapshot --db-instance-identifier $DB --db-snapshot-identifier $SNAP >/dev/null
echo "   started $SNAP"

echo "6) weekly snapshot, kept 30 days"
ROLE=AWSBackupDefaultServiceRole
if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE --assume-role-policy-document \
   '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"backup.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores
  sleep 10
fi
aws backup create-backup-vault --backup-vault-name gdm >/dev/null 2>&1 || true
PLAN=$(aws backup list-backup-plans --query "BackupPlansList[?BackupPlanName=='gdm-weekly'].BackupPlanId | [0]" --output text)
if [ "$PLAN" = "None" ] || [ -z "$PLAN" ]; then
  PLAN=$(aws backup create-backup-plan --backup-plan '{"BackupPlanName":"gdm-weekly","Rules":[{"RuleName":"weekly","TargetBackupVaultName":"gdm","ScheduleExpression":"cron(0 15 ? * SUN *)","StartWindowMinutes":120,"CompletionWindowMinutes":360,"Lifecycle":{"DeleteAfterDays":30}}]}' --query BackupPlanId --output text)
fi
aws backup create-backup-selection --backup-plan-id $PLAN --backup-selection \
  "{\"SelectionName\":\"gdm-db\",\"IamRoleArn\":\"arn:aws:iam::$ACC:role/$ROLE\",\"Resources\":[\"arn:aws:rds:ap-southeast-2:$ACC:db:$DB\"]}" >/dev/null 2>&1 || echo "   (selection already there)"
echo "   plan $PLAN"

echo "--- CHECK ---"
aws rds describe-db-instances --db-instance-identifier $DB \
  --query 'DBInstances[0].{keep:BackupRetentionPeriod,prot:DeletionProtection}' --output table
aws s3api get-bucket-versioning --bucket $MEDIA --query Status --output text
echo HARDEN_DONE

#!/bin/bash
# Read-only: ask the API function what the database holds, and print it.
set -e
export AWS_DEFAULT_REGION=ap-southeast-2
aws lambda invoke --function-name gdm-api --cli-binary-format raw-in-base64-out --payload '{"action":"admin.schema"}' /tmp/schema.json >/dev/null
aws s3 cp /tmp/schema.json s3://gdm-web-7k2m9x/_schema.json --cache-control no-cache >/dev/null
echo SCHEMA_READY
head -c 300 /tmp/schema.json; echo

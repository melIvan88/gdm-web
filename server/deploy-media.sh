#!/bin/bash
# Redeploy the gdm-media Lambda: Cognito-checked callers, photo uploads allowed.
# Run in AWS CloudShell:  curl -sfL https://raw.githubusercontent.com/melIvan88/gdm-web/<sha>/server/deploy-media.sh | bash -s -- <sha>
set -e
export AWS_DEFAULT_REGION=ap-southeast-2
V=${1:-main}
POOL=ap-southeast-2_HTNP4wFdH
CLIENT=6hchh6gm0tnh8mpnpt1g65pa47
POOL2=ap-southeast-2_qov8Kjqlx
CLIENT2=7jsinsek67q3hbt9adrcchroh2
BUCKET=$(aws lambda get-function-configuration --function-name gdm-media --query 'Environment.Variables.BUCKET' --output text)
rm -rf ~/gdmmedia && mkdir -p ~/gdmmedia && cd ~/gdmmedia
curl -sfL -o index.mjs "https://raw.githubusercontent.com/melIvan88/gdm-web/$V/server/media/index.mjs"
head -c 60 index.mjs; echo
J1=$(curl -sfL "https://cognito-idp.ap-southeast-2.amazonaws.com/$POOL/.well-known/jwks.json")
J2=$(curl -sfL "https://cognito-idp.ap-southeast-2.amazonaws.com/$POOL2/.well-known/jwks.json")
rm -f f.zip && zip -q f.zip index.mjs
aws lambda update-function-code --function-name gdm-media --zip-file fileb://f.zip >/dev/null
aws lambda wait function-updated --function-name gdm-media
python3 - "$BUCKET" "$POOL" "$CLIENT" "$POOL2" "$CLIENT2" "$J1" "$J2" <<'PY' > env.json
import json,sys
b,p,c,p2,c2,j1,j2 = sys.argv[1:8]
print(json.dumps({"Variables":{"BUCKET":b,"COGNITO_POOL":p,"COGNITO_CLIENT":c,"COGNITO_POOL2":p2,"COGNITO_CLIENT2":c2,"JWKS_JSON":j1,"JWKS_JSON2":j2}}))
PY
aws lambda update-function-configuration --function-name gdm-media --environment file://env.json >/dev/null
aws lambda wait function-updated --function-name gdm-media
echo "MEDIA_OK bucket=$BUCKET"
aws lambda get-function-configuration --function-name gdm-media --query 'Environment.Variables.BUCKET' --output text

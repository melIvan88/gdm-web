#!/bin/bash
# Add the notes feature (feed posts on the server) to the gdm-api Lambda.
# Patches the LIVE code, so nothing already deployed is lost.
# Run in AWS CloudShell:  curl -sfL https://raw.githubusercontent.com/melIvan88/gdm-web/<sha>/server/deploy-api.sh | bash -s -- <sha>
set -e
export AWS_DEFAULT_REGION=ap-southeast-2
V=${1:-main}
rm -rf ~/gdmapi && mkdir -p ~/gdmapi && cd ~/gdmapi
curl -sfL -o f.zip "$(aws lambda get-function --function-name gdm-api --query Code.Location --output text)"
unzip -o -q f.zip
cp index.mjs index.live.mjs
curl -sfL -o add-notes.js "https://raw.githubusercontent.com/melIvan88/gdm-web/$V/server/api/add-notes.js"
node add-notes.js index.live.mjs index.mjs
node --check index.mjs && echo SYNTAX_OK
rm -f new.zip && zip -qr new.zip index.mjs node_modules package.json 2>/dev/null || zip -qr new.zip index.mjs node_modules
aws lambda update-function-code --function-name gdm-api --zip-file fileb://new.zip >/dev/null
aws lambda wait function-updated --function-name gdm-api
aws lambda invoke --function-name gdm-api --cli-binary-format raw-in-base64-out --payload '{"action":"admin.migrate007"}' mig.json >/dev/null
echo "MIGRATE: $(cat mig.json)"
echo API_DONE

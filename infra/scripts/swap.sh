#!/usr/bin/env bash
# Troca a cor ativa de produção (frontend + API REST + WebSocket).
# Uso: infra/scripts/swap.sh <blue|green>
# Ver docs/adr/0002-blue-green-frontend.md
set -euo pipefail

TO="${1:-}"
[[ "$TO" == "blue" || "$TO" == "green" ]] || { echo "uso: $0 <blue|green>" >&2; exit 2; }
export AWS_REGION="${AWS_REGION:-us-east-1}"
WEB=fcar.fpoiato.com
API=api.fcar.fpoiato.com
WS=ws.fcar.fpoiato.com
ZONE_ID=Z094351536ZBINA5SU45F
CLOUDFRONT_ZONE_ID=Z2FDTNDATAQYW2 # zona fixa de todo alias para CloudFront

FROM=$(aws ssm get-parameter --name /fcar/active-color --query Parameter.Value --output text)
if [[ "$FROM" == "$TO" ]]; then echo "Cor ativa já é $TO."; exit 0; fi
echo "Swap: $FROM -> $TO"

# 1. Frontend: move o domínio principal para a distribuição de destino (atômico).
DIST=$(aws ssm get-parameter --name "/fcar/web/$TO/distribution-id" --query Parameter.Value --output text)
DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)
# O CloudFront valida a posse do domínio por um TXT `_<domínio>` apontando para o destino.
TXT_CHANGE=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch \
  "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"_$WEB\",\"Type\":\"TXT\",\"TTL\":60,\"ResourceRecords\":[{\"Value\":\"\\\"$DIST_DOMAIN\\\"\"}]}}]}" \
  --query ChangeInfo.Id --output text)
aws route53 wait resource-record-sets-changed --id "$TXT_CHANGE"
for attempt in 1 2 3 4 5 6; do
  if aws cloudfront associate-alias --alias "$WEB" --target-distribution-id "$DIST" 2>/tmp/fcar-swap.err; then
    break
  fi
  if [[ $attempt == 6 ]]; then cat /tmp/fcar-swap.err >&2; exit 1; fi
  echo "  aguardando propagação do TXT (tentativa $attempt)..."; sleep 20
done
echo "  web: $WEB -> $DIST"

# 2. DNS do domínio principal para a nova distribuição.
CHANGES=$(cat <<JSON
{"Comment":"fcar swap $FROM -> $TO","Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$WEB","Type":"A","AliasTarget":{"HostedZoneId":"$CLOUDFRONT_ZONE_ID","DNSName":"$DIST_DOMAIN","EvaluateTargetHealth":false}}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$WEB","Type":"AAAA","AliasTarget":{"HostedZoneId":"$CLOUDFRONT_ZONE_ID","DNSName":"$DIST_DOMAIN","EvaluateTargetHealth":false}}}
]}
JSON
)
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$CHANGES" >/dev/null
echo "  dns: $WEB -> $DIST_DOMAIN"

# 3. API REST e WebSocket: domínios principais para a stage de destino.
aws apigateway update-base-path-mapping --domain-name "$API" --base-path '(none)' \
  --patch-operations "op=replace,path=/stage,value=$TO" >/dev/null
WS_API=$(aws apigatewayv2 get-api-mappings --domain-name "$WS" --query 'Items[0].ApiId' --output text)
WS_MAPPING=$(aws apigatewayv2 get-api-mappings --domain-name "$WS" --query 'Items[0].ApiMappingId' --output text)
aws apigatewayv2 update-api-mapping --domain-name "$WS" --api-mapping-id "$WS_MAPPING" \
  --api-id "$WS_API" --stage "$TO" >/dev/null
echo "  api/ws: stage $TO"

# 4. Registra a nova cor ativa.
aws ssm put-parameter --name /fcar/active-color --value "$TO" --overwrite >/dev/null
echo "  /fcar/active-color = $TO"

# 5. Reconcilia o CloudFormation com o novo estado (não muda nada em produção).
if [[ "${SKIP_RECONCILE:-}" != "1" ]]; then
  (cd "$(dirname "$0")/.." && npx cdk deploy fcar-backend fcar-frontend \
    -c "fcar:activeColor=$TO" --require-approval never)
fi
echo "Swap concluído: $TO ativo."

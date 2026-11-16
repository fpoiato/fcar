# 0002 — Blue/green do frontend com duas distribuições CloudFront

## Contexto

O frontend roda em dois ambientes completos (bucket S3 + distribuição CloudFront por cor). O
plano original era trocar a produção mudando só o DNS de `fcar.fpoiato.com`, mas o CloudFront
**não permite o mesmo domínio alternativo em duas distribuições**, e uma distribuição recusa
requisições para um host que não está nos seus aliases. Mudar só o DNS não funciona.

## Decisão

- `blue.fcar.fpoiato.com` e `green.fcar.fpoiato.com` ficam sempre na sua distribuição (smoke tests).
- `fcar.fpoiato.com` fica **apenas** na distribuição ativa. O CDK monta os aliases a partir de
  `fcar:activeColor` (lido de `/fcar/active-color`).
- O swap (`infra/scripts/swap.sh <cor>`):
  1. Grava o TXT `_fcar.fpoiato.com` com o domínio da distribuição de destino (o CloudFront
     exige essa prova de posse mesmo dentro da mesma conta) e roda `aws cloudfront associate-alias`,
     que move o domínio de forma **atômica**. O CloudFront roteia pelo host, então o tráfego muda
     neste passo, sem janela de erro.
  2. Atualiza os registros A/AAAA de `fcar.fpoiato.com` para a nova distribuição.
  3. Move `api.` e `ws.` para a stage da nova cor (ver ADR 0001).
  4. Grava a nova cor em `/fcar/active-color`.
  5. `cdk deploy fcar-backend fcar-frontend -c fcar:activeColor=<cor>`: o template passa a
     descrever o estado real (não muda nada em produção).

## Consequências

- Todo `cdk deploy` das stacks `fcar-frontend` e `fcar-backend` precisa receber a cor ativa do SSM.
  Com a cor errada, o CloudFormation tentaria mover o domínio de volta e falharia com
  `CNAMEAlreadyExists`, sem afetar produção. Use `npm run deploy:backend` / `deploy:frontend` ou o workflow.
- O passo 1 leva o tempo de propagação do CloudFront (minutos) para refletir em todas as edges.
- O TXT `_fcar.fpoiato.com` é gerenciado pelo script, não pelo CDK.
- Rollback = rodar o swap para a cor anterior.

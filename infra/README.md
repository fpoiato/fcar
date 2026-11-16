# infra

AWS CDK (TypeScript). Conta `986873053420`, região `us-east-1`.

## Stacks

| Stack              | Issue | O que contém                                                     |
| ------------------ | ----- | ---------------------------------------------------------------- |
| `fcar-github-oidc` | #3    | Roles `fcar-gha-deploy` e `fcar-gha-readonly` assumidas via OIDC |

## Pré-requisitos já existentes na conta (não gerenciados aqui)

- CDK bootstrap (`CDKToolkit`, qualifier `hnb659fds`)
- OIDC provider `token.actions.githubusercontent.com` (compartilhado com outros projetos)

## GitHub Actions

- `fcar-gha-deploy`: só pode ser assumida por jobs nos environments `prod-deploy` e `prod-swap`.
- `fcar-gha-readonly`: só por jobs de `pull_request` (para `cdk diff`).
- Teste: rodar o workflow `aws-oidc-check` manualmente.

## Deploy manual (bootstrap das roles)

```bash
npx cdk deploy fcar-github-oidc
```

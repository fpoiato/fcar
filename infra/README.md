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

## Hosts

Definidos em `lib/config.ts` (`HOSTS`), todos cobertos pelo certificado:

| Host                                               | Uso                                         |
| -------------------------------------------------- | ------------------------------------------- |
| `fcar.fpoiato.com`                                 | frontend, cor ativa                         |
| `blue.fcar.` / `green.fcar.`                       | frontend por cor (smoke test antes do swap) |
| `api.fcar.` / `api-blue.fcar.` / `api-green.fcar.` | API REST ativa e por cor                    |
| `ws.fcar.` / `ws-blue.fcar.` / `ws-green.fcar.`    | WebSocket ativo e por cor                   |
| `media.fcar.`                                      | fotos das unidades                          |

Registros DNS são criados pelas stacks que os usam (#5, #6), apenas sob `*.fcar.fpoiato.com`.

## Cor ativa e deploy manual do backend

A cor ativa fica no SSM em `/fcar/active-color` (criado manualmente uma vez, valor inicial `blue`).
O CDK a recebe por contexto. O script `npm run deploy:backend -w infra` lê o parâmetro e faz o deploy.
Ver [ADR 0001](../docs/adr/0001-blue-green-backend.md).

## Erros centralizados (`/fcar/errors`)

- Toda `FcarFunction` tem uma subscription filter (`fcar-errors`) com filtro grosso
  (`ERROR`, `Task timed out`, `Runtime exited`, `Runtime.OutOfMemory`) → `fcar-error-forwarder`.
- O forwarder grava no `/fcar/errors` **somente** erros reais: linhas JSON `level=ERROR` e falhas de
  plataforma (timeout, memória, init). "Invoke Error" é descartado (o wrapper já registra a exceção).
- Formato: `CentralError` em `backend/src/lib/central-error.ts`.
- Alarmes: `fcar-central-errors-high` (> 20 erros em 5 min) e `fcar-error-forwarder-failing`.
- O próprio forwarder não é assinado, para não haver recursão.

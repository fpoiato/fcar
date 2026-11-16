# Observabilidade

## Fluxo de erros

```
Lambda (logger JSON, level=ERROR)  ─┐
falhas de plataforma (timeout, OOM) ─┼─ subscription filter ─▶ fcar-error-forwarder ─▶ /fcar/errors
frontend → POST /client-errors (#10)┘                                                      │
                                                                                            ▼
                                                    fcar-error-to-issue ─▶ issue no GitHub (Triage)
```

## /fcar/errors → issue (`fcar-error-to-issue`)

- **Fingerprint** (`backend/src/lib/errors/fingerprint.ts`): origem + tipo + função + nome do erro +
  primeiros frames do stack normalizados (sem ids, números, hashes de bundle, linha:coluna).
  Sem stack, usa a mensagem normalizada.
- **Primeira ocorrência:** cria a issue com labels `type:error-backend|frontend`, `area:*` e
  `status:triage`, com análise do **Amazon Nova Micro** (`us.amazon.nova-micro-v1:0`). Se o modelo
  falhar ou responder fora do formato, a issue sai com um resumo padrão.
- **Recorrência:** acumula; no máximo **1 comentário por hora** com a contagem.
- **Issue fechada e erro voltou:** cria uma issue nova referenciando a anterior.
- **Limite global:** 10 issues novas por hora (`MAX_ISSUES_PER_HOUR`).
- **Concorrência:** trava condicional no DynamoDB (`ERRFP#<fp>`); só um worker cria a issue.
- **Conteúdo não confiável:** a evidência é tratada como dado. Menções `@`, cercas de código e
  palavras de fechamento (`closes #N`) são neutralizadas, e o prompt do modelo deixa claro que
  instruções dentro da evidência devem ser ignoradas.
- **Token:** fine-grained, só `fpoiato/fcar`, Issues read/write, em Secrets Manager
  `fcar/github-issues-token`. A issue entra no board pela sincronização de labels (#14).

## Alarmes

| Alarme                         | Quando                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| `fcar-central-errors-high`     | > 20 erros em 5 min no `/fcar/errors`                      |
| `fcar-error-forwarder-failing` | o forwarder falhou (erros podem não chegar ao log central) |
| `fcar-error-to-issue-failing`  | erros não estão virando issues (token, Bedrock ou GitHub)  |

O forwarder e o `error-to-issue` **não** alimentam o `/fcar/errors` (evita loop); as falhas deles
ficam nos logs próprios e nos alarmes.

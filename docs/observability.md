# Observabilidade

## Fluxo de erros

```
Lambda (logger JSON, level=ERROR)  ─┐
falhas de plataforma (timeout, OOM) ─┼─ subscription filter ─▶ fcar-error-forwarder ─▶ /fcar/errors
frontend → POST /client-errors (#10)┘                                                      │
                                                                                            ▼
                                                    fcar-error-to-issue ─▶ issue no GitHub (Triage)
```

## Erros do frontend (`POST /client-errors`)

- Público (sem login), aceita até 20 eventos por chamada e 32 KB. Corpo JSON mesmo com
  `Content-Type: text/plain` (`navigator.sendBeacon`). Contrato em `packages/shared/src/client-errors.ts`.
- Tipos: `js`, `promise`, `http`, `network` (status 0: rede/CORS/offline), `csp`, `chunk-load`, `console`.
- Cada evento vira uma linha `level=ERROR` com `data.source=frontend` na Lambda `fcar-client-errors`,
  e daí segue o mesmo caminho dos erros do backend.
- Proteções: validação zod com truncamento, throttling da rota (20 req/s, burst 40) e **WAF** com
  bloqueio por IP acima de 100 requisições em 5 minutos (`fcar-api` / `client-errors-rate-per-ip`).
- Payload inválido responde 400 e **não** gera log de erro (não vira issue).
- CORS: a API reflete apenas as origens de `ALLOWED_ORIGINS` (`fcar.`, `blue.`, `green.` e `localhost:4200`).

## /fcar/errors → issue (`fcar-error-to-issue`)

- **Fingerprint** (`backend/src/lib/errors/fingerprint.ts`): origem + tipo + função + nome do erro +
  primeiros frames do stack normalizados (sem ids, números, hashes de bundle, linha:coluna).
  Sem stack, usa a mensagem normalizada.
- **Primeira ocorrência:** cria a issue com labels `type:error-backend|frontend`, `area:*` e
  `status:triage`, e título `[erro <origem>] <erro> em <função>`. O corpo traz a seção `## Análise` com o marcador
  `<!-- fcar-analysis:pending -->`; a análise em si é feita depois pelo **Claude no GitHub Actions**
  (workflow `claude-analyze-error`), que substitui o marcador.
- **Recorrência:** acumula; no máximo **1 comentário por hora** com a contagem.
- **Issue fechada e erro voltou:** cria uma issue nova referenciando a anterior.
- **Limite global:** 10 issues novas por hora (`MAX_ISSUES_PER_HOUR`).
- **Concorrência:** trava condicional no DynamoDB (`ERRFP#<fp>`); só um worker cria a issue.
- **Conteúdo não confiável:** a evidência é tratada como dado. Menções `@`, cercas de código e
  palavras de fechamento (`closes #N`) são neutralizadas, e o Claude é instruído a
  ignorar instruções dentro da evidência.
- **Token:** fine-grained, só `fpoiato/fcar`, Issues read/write, em Secrets Manager
  `fcar/github-issues-token`. A issue entra no board pela sincronização de labels (#14).

## Alarmes

| Alarme                         | Quando                                                     |
| ------------------------------ | ---------------------------------------------------------- |
| `fcar-central-errors-high`     | > 20 erros em 5 min no `/fcar/errors`                      |
| `fcar-error-forwarder-failing` | o forwarder falhou (erros podem não chegar ao log central) |
| `fcar-error-to-issue-failing`  | erros não estão virando issues (token ou GitHub)           |

O forwarder e o `error-to-issue` **não** alimentam o `/fcar/errors` (evita loop); as falhas deles
ficam nos logs próprios e nos alarmes.

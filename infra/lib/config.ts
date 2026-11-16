export const FCAR = {
  account: '986873053420',
  region: 'us-east-1',
  repo: 'fpoiato/fcar',
  domain: 'fcar.fpoiato.com',
  hostedZoneName: 'fpoiato.com',
  hostedZoneId: 'Z094351536ZBINA5SU45F',
  githubOidcProviderArn:
    'arn:aws:iam::986873053420:oidc-provider/token.actions.githubusercontent.com',
  cdkQualifier: 'hnb659fds',
} as const;

/**
 * Prefixos aceitos no claim `sub` do OIDC do GitHub. O repositório usa o subject imutável
 * (`repo:<owner>@<ownerId>/<repo>@<repoId>`); o formato antigo fica aceito por compatibilidade.
 */
export const GITHUB_OIDC_SUB_PREFIXES = [
  'repo:fpoiato@28718134/fcar@1459367548',
  `repo:${FCAR.repo}`,
] as const;

export const env = { account: FCAR.account, region: FCAR.region };

/**
 * Distribuições CloudFront do frontend (stack fcar-frontend, #5). Fixas para restringir as
 * permissões da role de deploy sem criar dependência entre stacks.
 */
export const WEB_DISTRIBUTION_IDS = { blue: 'E3GC1S5KZJXEU3', green: 'E1ZMKROHY90H2W' } as const;

/** Hosts do projeto. Todos cobertos pelo certificado `fcar.fpoiato.com` + `*.fcar.fpoiato.com`. */
export const HOSTS = {
  web: FCAR.domain,
  webBlue: `blue.${FCAR.domain}`,
  webGreen: `green.${FCAR.domain}`,
  api: `api.${FCAR.domain}`,
  apiBlue: `api-blue.${FCAR.domain}`,
  apiGreen: `api-green.${FCAR.domain}`,
  ws: `ws.${FCAR.domain}`,
  wsBlue: `ws-blue.${FCAR.domain}`,
  wsGreen: `ws-green.${FCAR.domain}`,
  media: `media.${FCAR.domain}`,
} as const;

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

export const env = { account: FCAR.account, region: FCAR.region };

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

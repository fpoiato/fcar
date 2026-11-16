export const FCAR = {
  account: '986873053420',
  region: 'us-east-1',
  repo: 'fpoiato/fcar',
  domain: 'fcar.fpoiato.com',
  hostedZoneName: 'fpoiato.com',
  githubOidcProviderArn:
    'arn:aws:iam::986873053420:oidc-provider/token.actions.githubusercontent.com',
  cdkQualifier: 'hnb659fds',
} as const;

export const env = { account: FCAR.account, region: FCAR.region };

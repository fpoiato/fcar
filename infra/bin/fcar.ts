import { App, Tags } from 'aws-cdk-lib';
import { BackendStack } from '../lib/backend-stack.js';
import { env } from '../lib/config.js';
import { DnsCertsStack } from '../lib/dns-certs-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';
import { isColor } from '../lib/constructs/fcar-function.js';

const app = new App();
Tags.of(app).add('project', 'fcar');

// Cor ativa: o deploy passa `-c fcar:activeColor=$(aws ssm get-parameter --name /fcar/active-color ...)`.
const activeColor = app.node.tryGetContext('fcar:activeColor') ?? 'blue';
if (!isColor(activeColor)) throw new Error(`fcar:activeColor inválido: ${activeColor}`);

new GithubOidcStack(app, 'fcar-github-oidc', { env });
const dns = new DnsCertsStack(app, 'fcar-dns-certs', { env });
new BackendStack(app, 'fcar-backend', {
  env,
  zone: dns.zone,
  certificate: dns.certificate,
  activeColor,
});

new FrontendStack(app, 'fcar-frontend', {
  env,
  zone: dns.zone,
  certificate: dns.certificate,
  activeColor,
});

app.synth();

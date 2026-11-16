import { App, Tags } from 'aws-cdk-lib';
import { env } from '../lib/config.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const app = new App();
Tags.of(app).add('project', 'fcar');

new GithubOidcStack(app, 'fcar-github-oidc', { env });

app.synth();

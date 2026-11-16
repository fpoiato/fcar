import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { env } from '../lib/config.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const template = Template.fromStack(new GithubOidcStack(new App(), 'test', { env }));

describe('GithubOidcStack', () => {
  it('não cria um novo OIDC provider', () => {
    template.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
    template.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('role de deploy só confia nos environments protegidos do repo', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'fcar-gha-deploy',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:fpoiato@28718134/fcar@1459367548:environment:prod-deploy',
                  'repo:fpoiato@28718134/fcar@1459367548:environment:prod-swap',
                  'repo:fpoiato/fcar:environment:prod-deploy',
                  'repo:fpoiato/fcar:environment:prod-swap',
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('role de leitura só confia em pull_request do repo', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'fcar-gha-readonly',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:fpoiato@28718134/fcar@1459367548:pull_request',
                  'repo:fpoiato/fcar:pull_request',
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it('nenhuma policy concede acesso administrativo amplo', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const p of Object.values(policies)) {
      const statements = (p as { Properties: { PolicyDocument: { Statement: unknown[] } } })
        .Properties.PolicyDocument.Statement as { Action: string | string[] }[];
      for (const s of statements) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        expect(actions).not.toContain('*');
      }
    }
  });
});

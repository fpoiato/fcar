import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { describe, expect, it } from 'vitest';
import { BackendStack } from '../lib/backend-stack.js';
import { env } from '../lib/config.js';

const app = new App();
const deps = new Stack(app, 'deps', { env });
const stack = new BackendStack(app, 'backend', {
  env,
  activeColor: 'blue',
  zone: route53.HostedZone.fromHostedZoneAttributes(deps, 'Z', {
    hostedZoneId: 'Z1',
    zoneName: 'fpoiato.com',
  }),
  certificate: acm.Certificate.fromCertificateArn(
    deps,
    'C',
    'arn:aws:acm:us-east-1:986873053420:certificate/x',
  ),
});
const t = Template.fromStack(stack);

type Sub = { Properties: { LogGroupName: unknown; DestinationArn: unknown } };
const subs = () => Object.values(t.findResources('AWS::Logs::SubscriptionFilter')) as Sub[];
/** Log groups assinados pelo forwarder (pipeline de erros das Lambdas). */
const subscribedGroups = () =>
  subs()
    .filter((r) => JSON.stringify(r.Properties.DestinationArn).includes('Forwarder'))
    .map((r) => JSON.stringify(r.Properties.LogGroupName));

describe('ErrorPipeline', () => {
  it('cria o log group central retido', () => {
    t.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ LogGroupName: '/fcar/errors' }),
    });
  });

  it('assina todas as Lambdas do projeto, exceto o próprio forwarder', () => {
    const groups = subscribedGroups();
    expect(groups.length).toBe(2); // health e ws-connection (o forwarder e o error-to-issue não)
    expect(groups.some((s) => s.includes('Forwarder'))).toBe(false);
    for (const r of subs().filter((x) =>
      JSON.stringify(x.Properties.DestinationArn).includes('Forwarder'),
    )) {
      expect((r.Properties as unknown as { FilterPattern: string }).FilterPattern).toBe(
        '?"ERROR" ?"Task timed out" ?"Runtime exited" ?"Runtime.OutOfMemory"',
      );
    }
  });

  it('o forwarder não assina o /fcar/errors (sem recursão)', () => {
    expect(subscribedGroups().some((s) => s.includes('Central'))).toBe(false);
  });

  it('forwarder escreve no log central', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'fcar-error-forwarder',
      Environment: { Variables: Match.objectLike({ CENTRAL_ERRORS_LOG_GROUP: '/fcar/errors' }) },
    });
  });

  it('error-to-issue assina o /fcar/errors e não é assinado por ninguém', () => {
    const central = subs().filter((r) =>
      JSON.stringify(r.Properties.LogGroupName).includes('Central'),
    );
    expect(central).toHaveLength(1);
    expect(JSON.stringify(central[0]!.Properties.DestinationArn)).toContain('ErrorToIssue');
    expect(subscribedGroups().some((s) => s.includes('ErrorToIssue'))).toBe(false);
  });

  it('error-to-issue: Nova Micro, secret do token e limites', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'fcar-error-to-issue',
      Environment: {
        Variables: Match.objectLike({
          GITHUB_REPO: 'fpoiato/fcar',
          GITHUB_TOKEN_SECRET: 'fcar/github-issues-token',
          MAX_ISSUES_PER_HOUR: '10',
        }),
      },
    });
    const policies = JSON.stringify(t.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('inference-profile/us.amazon.nova-micro-v1:0');
    expect(policies).toContain('secretsmanager:GetSecretValue');
  });

  it('alarmes de volume de erros e de falha do forwarder', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'fcar-central-errors-high' });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcar-error-forwarder-failing',
    });
  });
});

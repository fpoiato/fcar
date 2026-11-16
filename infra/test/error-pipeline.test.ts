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

const subscribedGroups = () =>
  Object.values(t.findResources('AWS::Logs::SubscriptionFilter')).map((r) =>
    JSON.stringify((r as { Properties: { LogGroupName: unknown } }).Properties.LogGroupName),
  );

describe('ErrorPipeline', () => {
  it('cria o log group central retido', () => {
    t.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({ LogGroupName: '/fcar/errors' }),
    });
  });

  it('assina todas as Lambdas do projeto, exceto o próprio forwarder', () => {
    const subs = subscribedGroups();
    expect(subs.length).toBe(2); // health e ws-connection
    expect(subs.some((s) => s.includes('Forwarder'))).toBe(false);
    t.allResourcesProperties('AWS::Logs::SubscriptionFilter', {
      FilterPattern: '?"ERROR" ?"Task timed out" ?"Runtime exited" ?"Runtime.OutOfMemory"',
    });
  });

  it('nenhuma assinatura no próprio /fcar/errors (sem recursão)', () => {
    expect(subscribedGroups().some((s) => s.includes('Central'))).toBe(false);
  });

  it('forwarder escreve no log central', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'fcar-error-forwarder',
      Environment: { Variables: Match.objectLike({ CENTRAL_ERRORS_LOG_GROUP: '/fcar/errors' }) },
    });
  });

  it('alarmes de volume de erros e de falha do forwarder', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'fcar-central-errors-high' });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'fcar-error-forwarder-failing',
    });
  });
});

import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { describe, expect, it } from 'vitest';
import { env } from '../lib/config.js';
import { FrontendStack } from '../lib/frontend-stack.js';

function synth(activeColor: 'blue' | 'green') {
  const app = new App();
  const deps = new Stack(app, 'deps', { env });
  const stack = new FrontendStack(app, 'frontend', {
    env,
    activeColor,
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
  return Template.fromStack(stack);
}

const aliasesByComment = (t: Template) =>
  Object.fromEntries(
    Object.values(t.findResources('AWS::CloudFront::Distribution')).map((d) => {
      const cfg = (
        d as { Properties: { DistributionConfig: { Comment: string; Aliases: string[] } } }
      ).Properties.DistributionConfig;
      return [cfg.Comment, [...cfg.Aliases].sort()];
    }),
  );

describe('FrontendStack', () => {
  const t = synth('blue');

  it('dois buckets privados, criptografados e só HTTPS', () => {
    for (const color of ['blue', 'green']) {
      t.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: `fcar-web-${color}`,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    }
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
  });

  it('domínio principal só na distribuição ativa', () => {
    expect(aliasesByComment(t)).toEqual({
      'fcar web blue': ['blue.fcar.fpoiato.com', 'fcar.fpoiato.com'],
      'fcar web green': ['green.fcar.fpoiato.com'],
    });
    expect(aliasesByComment(synth('green'))).toEqual({
      'fcar web blue': ['blue.fcar.fpoiato.com'],
      'fcar web green': ['fcar.fpoiato.com', 'green.fcar.fpoiato.com'],
    });
  });

  it('SPA: 403/404 servem o index.html', () => {
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: [
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ],
      }),
    });
  });

  it('headers de segurança com CSP, HSTS e frame DENY', () => {
    t.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("frame-ancestors 'none'"),
          }),
          FrameOptions: { FrameOption: 'DENY', Override: true },
          StrictTransportSecurity: Match.objectLike({ IncludeSubdomains: true }),
        }),
      }),
    });
  });

  it('registros DNS: cada cor + principal (A e AAAA)', () => {
    t.resourceCountIs('AWS::Route53::RecordSet', 6);
  });

  it('publica bucket e distribuição de cada cor no SSM para o deploy', () => {
    for (const color of ['blue', 'green']) {
      t.hasResourceProperties('AWS::SSM::Parameter', { Name: `/fcar/web/${color}/bucket` });
      t.hasResourceProperties('AWS::SSM::Parameter', {
        Name: `/fcar/web/${color}/distribution-id`,
      });
    }
  });
});

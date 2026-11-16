import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { FCAR } from './config.js';

/**
 * Zona `fpoiato.com` (existente, apenas referenciada) e o certificado do projeto.
 * Em us-east-1, o mesmo certificado serve CloudFront e os custom domains do API Gateway.
 */
export class DnsCertsStack extends Stack {
  readonly zone: route53.IHostedZone;
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: FCAR.hostedZoneId,
      zoneName: FCAR.hostedZoneName,
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: FCAR.domain,
      subjectAlternativeNames: [`*.${FCAR.domain}`],
      validation: acm.CertificateValidation.fromDns(this.zone),
      certificateName: 'fcar',
    });
    certificate.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.certificate = certificate;

    new ssm.StringParameter(this, 'CertificateArnParam', {
      parameterName: '/fcar/certificate-arn',
      stringValue: certificate.certificateArn,
      description: 'Certificado ACM fcar.fpoiato.com + *.fcar.fpoiato.com',
    });

    new CfnOutput(this, 'CertificateArn', { value: certificate.certificateArn });
  }
}

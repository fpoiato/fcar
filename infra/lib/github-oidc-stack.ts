import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { FCAR, GITHUB_OIDC_SUB_PREFIXES, WEB_DISTRIBUTION_IDS } from './config.js';

/**
 * Roles assumidas pelo GitHub Actions via OIDC (sem access keys).
 * O OIDC provider do GitHub já existe na conta e é apenas referenciado.
 */
export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubProvider',
      FCAR.githubOidcProviderArn,
    );

    const audience = { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' };
    const cdkRole = (kind: string) =>
      `arn:aws:iam::${FCAR.account}:role/cdk-${FCAR.cdkQualifier}-${kind}-role-${FCAR.account}-${FCAR.region}`;

    // Deploy e swap: somente a partir dos environments protegidos do repo.
    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'fcar-gha-deploy',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: audience,
        StringLike: {
          'token.actions.githubusercontent.com:sub': GITHUB_OIDC_SUB_PREFIXES.flatMap((p) => [
            `${p}:environment:prod-deploy`,
            `${p}:environment:prod-swap`,
          ]),
        },
      }),
      description: 'GitHub Actions (fpoiato/fcar) - deploy e swap blue/green',
    });

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkRoles',
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(cdkRole),
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'FrontendSync',
        actions: ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: ['arn:aws:s3:::fcar-web-*', 'arn:aws:s3:::fcar-web-*/*'],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidation',
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        // Restringido às distribuições do projeto na issue #5 (ARNs conhecidos após a criação).
        resources: [`arn:aws:cloudfront::${FCAR.account}:distribution/*`],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ActiveColorParameter',
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [`arn:aws:ssm:${FCAR.region}:${FCAR.account}:parameter/fcar/*`],
      }),
    );

    // Deploy na cor inativa e swap (infra/scripts/deploy.sh e swap.sh).
    const arn = (svc: string, res: string) =>
      `arn:aws:${svc}:${FCAR.region}:${FCAR.account}:${res}`;
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'LambdaVersionsAndAliases',
        actions: ['lambda:GetAlias', 'lambda:PublishVersion', 'lambda:UpdateAlias'],
        resources: [arn('lambda', 'function:fcar-*'), arn('lambda', 'function:fcar-*:*')],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListFunctionsAndStacks',
        actions: ['lambda:ListFunctions', 'cloudformation:DescribeStacks'],
        resources: ['*'],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ApiGatewayDeploymentsAndMappings',
        actions: ['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH'],
        resources: [
          `arn:aws:apigateway:${FCAR.region}::/restapis/*`,
          `arn:aws:apigateway:${FCAR.region}::/apis/*`,
          `arn:aws:apigateway:${FCAR.region}::/domainnames/*`,
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SwapCloudFrontAlias',
        // associate-alias exige também UpdateDistribution na distribuição de destino.
        actions: [
          'cloudfront:GetDistribution',
          'cloudfront:AssociateAlias',
          'cloudfront:UpdateDistribution',
        ],
        resources: Object.values(WEB_DISTRIBUTION_IDS).map(
          (id) => `arn:aws:cloudfront::${FCAR.account}:distribution/${id}`,
        ),
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SwapDns',
        actions: ['route53:ChangeResourceRecordSets'],
        resources: [`arn:aws:route53:::hostedzone/${FCAR.hostedZoneId}`],
        conditions: {
          'ForAllValues:StringLike': {
            'route53:ChangeResourceRecordSetsNormalizedRecordNames': [
              FCAR.domain,
              `*.${FCAR.domain}`,
              `_${FCAR.domain}`, // TXT de prova de posse exigido pelo associate-alias
            ],
          },
        },
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SwapDnsWait',
        actions: ['route53:GetChange'],
        resources: ['arn:aws:route53:::change/*'],
      }),
    );

    // Leitura para PRs (cdk diff): não pode alterar nada.
    const readOnlyRole = new iam.Role(this, 'ReadOnlyRole', {
      roleName: 'fcar-gha-readonly',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: audience,
        StringLike: {
          'token.actions.githubusercontent.com:sub': GITHUB_OIDC_SUB_PREFIXES.map(
            (p) => `${p}:pull_request`,
          ),
        },
      }),
      description: 'GitHub Actions (fpoiato/fcar) - leitura para cdk diff em PRs',
    });
    readOnlyRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkLookup',
        actions: ['sts:AssumeRole'],
        resources: [cdkRole('lookup')],
      }),
    );
    readOnlyRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStacks',
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
          'cloudformation:ListStacks',
          'ssm:GetParameter',
        ],
        resources: ['*'],
      }),
    );

    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new CfnOutput(this, 'ReadOnlyRoleArn', { value: readOnlyRole.roleArn });
  }
}

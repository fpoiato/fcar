import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import type { Construct } from 'constructs';
import { FCAR, HOSTS } from './config.js';
import { ErrorPipeline } from './constructs/error-pipeline.js';
import { COLORS, type Color, FcarFunction } from './constructs/fcar-function.js';

export interface BackendStackProps extends StackProps {
  zone: route53.IHostedZone;
  certificate: acm.ICertificate;
  /** Cor que recebe api.fcar / ws.fcar. Vem de /fcar/active-color via contexto. */
  activeColor: Color;
}

/**
 * API REST + WebSocket com blue/green:
 * - stages `blue` e `green` com a stage variable `color` → alias da Lambda
 * - api-blue/api-green e ws-blue/ws-green sempre na sua cor; api./ws. na cor ativa
 * - CloudFormation cria as stages com a implantação inicial e não as altera depois;
 *   o deploy (#15) cria novas implantações apenas na stage inativa
 */
export class BackendStack extends Stack {
  readonly table: dynamodb.Table;
  readonly connectionsTable: dynamodb.Table;
  readonly restApi: apigw.RestApi;
  readonly functions: FcarFunction[] = [];

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // ---------- Dados ----------
    this.table = new dynamodb.Table(this, 'MainTable', {
      tableName: 'fcar-main',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'fcar-ws-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'byUser',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    // ---------- REST ----------
    const accessLogs = new logs.LogGroup(this, 'RestAccessLogs', {
      logGroupName: '/fcar/apigw/rest-access',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.restApi = new apigw.RestApi(this, 'RestApi', {
      restApiName: 'fcar-api',
      deploy: false,
      cloudWatchRole: false, // a conta já tem a role de logs do API Gateway
      endpointConfiguration: { types: [apigw.EndpointType.REGIONAL] },
      defaultCorsPreflightOptions: {
        allowOrigins: [
          `https://${HOSTS.web}`,
          `https://${HOSTS.webBlue}`,
          `https://${HOSTS.webGreen}`,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
        allowMethods: apigw.Cors.ALL_METHODS,
        maxAge: Duration.hours(1),
      },
    });

    const health = this.addFunction('health');
    this.addRestRoute('GET', 'health', health);

    // Implantação inicial com ID lógico fixo: o CloudFormation nunca a substitui,
    // então as stages não mudam em `cdk deploy` (quem promove é o workflow de deploy).
    const initialDeployment = new apigw.CfnDeployment(this, 'InitialDeployment', {
      restApiId: this.restApi.restApiId,
      description: 'Implantação inicial (gerenciada pelo CDK apenas na criação)',
    });
    initialDeployment.node.addDependency(...this.restApi.methods);

    const restStages = {} as Record<Color, apigw.CfnStage>;
    for (const color of COLORS) {
      restStages[color] = new apigw.CfnStage(this, `RestStage-${color}`, {
        restApiId: this.restApi.restApiId,
        stageName: color,
        deploymentId: initialDeployment.ref,
        variables: { color },
        tracingEnabled: true,
        methodSettings: [
          {
            httpMethod: '*',
            resourcePath: '/*',
            throttlingBurstLimit: 200,
            throttlingRateLimit: 100,
            metricsEnabled: true,
          },
        ],
        accessLogSetting: {
          destinationArn: accessLogs.logGroupArn,
          format: JSON.stringify({
            requestId: '$context.requestId',
            ip: '$context.identity.sourceIp',
            method: '$context.httpMethod',
            path: '$context.resourcePath',
            status: '$context.status',
            latency: '$context.responseLatency',
            integrationError: '$context.integrationErrorMessage',
            stage: '$context.stage',
          }),
        },
      });
    }

    const restDomain = (host: string, color: Color | 'active') => {
      const domain = new apigw.DomainName(this, `RestDomain-${host}`, {
        domainName: host,
        certificate: props.certificate,
        endpointType: apigw.EndpointType.REGIONAL,
        securityPolicy: apigw.SecurityPolicy.TLS_1_2,
      });
      const stage = restStages[color === 'active' ? props.activeColor : color];
      new apigw.CfnBasePathMapping(this, `RestMapping-${host}`, {
        domainName: domain.domainName,
        restApiId: this.restApi.restApiId,
        stage: stage.stageName,
      }).addDependency(stage);
      this.aliasRecord(props.zone, host, new targets.ApiGatewayDomain(domain));
    };
    restDomain(HOSTS.api, 'active');
    restDomain(HOSTS.apiBlue, 'blue');
    restDomain(HOSTS.apiGreen, 'green');

    // ---------- WebSocket ----------
    const wsConnection = this.addFunction('ws-connection', {
      CONNECTIONS_TABLE: this.connectionsTable.tableName,
    });
    this.connectionsTable.grantReadWriteData(wsConnection.fn);

    const wsApi = new apigwv2.CfnApi(this, 'WsApi', {
      name: 'fcar-ws',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });
    const wsIntegration = new apigwv2.CfnIntegration(this, 'WsIntegration', {
      apiId: wsApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${wsConnection.stageQualifiedArn}/invocations`,
    });
    const wsRoutes = ['$connect', '$disconnect', '$default'].map(
      (routeKey) =>
        new apigwv2.CfnRoute(this, `WsRoute${routeKey.replace('$', '-')}`, {
          apiId: wsApi.ref,
          routeKey,
          target: `integrations/${wsIntegration.ref}`,
        }),
    );
    this.allowInvoke(
      wsConnection,
      'WsInvoke',
      `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.ref}/*`,
    );

    const wsDeployment = new apigwv2.CfnDeployment(this, 'WsInitialDeployment', {
      apiId: wsApi.ref,
    });
    wsRoutes.forEach((r) => wsDeployment.addDependency(r));

    const wsStages = {} as Record<Color, apigwv2.CfnStage>;
    for (const color of COLORS) {
      wsStages[color] = new apigwv2.CfnStage(this, `WsStage-${color}`, {
        apiId: wsApi.ref,
        stageName: color,
        deploymentId: wsDeployment.ref,
        stageVariables: { color },
        defaultRouteSettings: { throttlingBurstLimit: 100, throttlingRateLimit: 50 },
      });
    }

    const wsDomain = (host: string, color: Color | 'active') => {
      const domain = new apigwv2.CfnDomainName(this, `WsDomain-${host}`, {
        domainName: host,
        domainNameConfigurations: [
          {
            certificateArn: props.certificate.certificateArn,
            endpointType: 'REGIONAL',
            securityPolicy: 'TLS_1_2',
          },
        ],
      });
      const stage = wsStages[color === 'active' ? props.activeColor : color];
      new apigwv2.CfnApiMapping(this, `WsMapping-${host}`, {
        apiId: wsApi.ref,
        domainName: domain.ref,
        stage: stage.stageName,
      }).addDependency(stage);
      new route53.ARecord(this, `WsRecord-${host}`, {
        zone: props.zone,
        recordName: host,
        target: route53.RecordTarget.fromAlias(
          new targets.ApiGatewayv2DomainProperties(
            domain.attrRegionalDomainName,
            domain.attrRegionalHostedZoneId,
          ),
        ),
      });
    };
    wsDomain(HOSTS.ws, 'active');
    wsDomain(HOSTS.wsBlue, 'blue');
    wsDomain(HOSTS.wsGreen, 'green');

    // As Lambdas do WebSocket precisam responder aos clientes (postToConnection).
    wsConnection.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.ref}/*/POST/@connections/*`,
        ],
      }),
    );

    // ---------- Observabilidade ----------
    // Sempre por último: assina os logs de todas as Lambdas criadas acima.
    const errors = new ErrorPipeline(this, 'ErrorPipeline');

    new CfnOutput(this, 'CentralErrorsLogGroup', { value: errors.logGroup.logGroupName });
    new CfnOutput(this, 'RestApiId', { value: this.restApi.restApiId });
    new CfnOutput(this, 'WsApiId', { value: wsApi.ref });
    new CfnOutput(this, 'ActiveColor', { value: props.activeColor });
  }

  addFunction(name: string, environment?: Record<string, string>): FcarFunction {
    const f = new FcarFunction(this, `Fn-${name}`, {
      name,
      environment: { TABLE_NAME: this.table.tableName, ...environment },
    });
    this.table.grantReadWriteData(f.fn);
    this.functions.push(f);
    return f;
  }

  /** Rota REST que invoca o alias da cor da stage (`${stageVariables.color}`). */
  addRestRoute(method: string, routePath: string, f: FcarFunction): apigw.Method {
    const resource = this.restApi.root.resourceForPath(routePath);
    const integration = new apigw.Integration({
      type: apigw.IntegrationType.AWS_PROXY,
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${f.stageQualifiedArn}/invocations`,
    });
    const m = resource.addMethod(method, integration);
    this.allowInvoke(
      f,
      `Invoke-${method}-${routePath.replace(/[^A-Za-z0-9]/g, '')}`,
      this.restApi.arnForExecuteApi(method, `/${routePath}`, '*'),
    );
    return m;
  }

  private allowInvoke(f: FcarFunction, id: string, sourceArn: string): void {
    for (const color of COLORS) {
      new lambda.CfnPermission(this, `${id}-${color}`, {
        action: 'lambda:InvokeFunction',
        functionName: `${f.fn.functionArn}:${color}`,
        principal: 'apigateway.amazonaws.com',
        sourceArn,
      }).addDependency(f.aliases[color]);
    }
  }

  private aliasRecord(zone: route53.IHostedZone, host: string, target: route53.IAliasRecordTarget) {
    new route53.ARecord(this, `Record-${host}`, {
      zone,
      recordName: host,
      target: route53.RecordTarget.fromAlias(target),
    });
  }
}

export { FCAR };

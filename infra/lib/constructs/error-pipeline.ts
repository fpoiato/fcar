import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as destinations from 'aws-cdk-lib/aws-logs-destinations';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { FCAR } from '../config.js';
import { FcarFunction } from './fcar-function.js';

export const CENTRAL_ERRORS_LOG_GROUP = '/fcar/errors';
export const GITHUB_TOKEN_SECRET = 'fcar/github-issues-token';
export const ISSUE_MODEL_ID = 'us.amazon.nova-micro-v1:0';

export interface ErrorPipelineProps {
  /** Tabela onde ficam fingerprints e o limite de issues por hora. */
  table: dynamodb.ITable;
}

/**
 * Filtro grosso aplicado em cada Lambda: qualquer linha que *possa* ser erro. O forwarder
 * decide com precisão (JSON `level=ERROR` ou falha de plataforma) e descarta o resto.
 */
export const ERROR_CANDIDATE_PATTERN = logs.FilterPattern.anyTerm(
  'ERROR',
  'Task timed out',
  'Runtime exited',
  'Runtime.OutOfMemory',
);

/**
 * Log group central `/fcar/errors` (somente erros) + Lambda `fcar-error-forwarder`.
 * Deve ser criado depois de todas as Lambdas da stack: assina o log group de cada
 * `FcarFunction` da mesma stack com `forwardErrors !== false`.
 */
export class ErrorPipeline extends Construct {
  readonly logGroup: logs.LogGroup;
  readonly forwarder: FcarFunction;
  readonly subscribed: FcarFunction[];
  readonly errorToIssue: FcarFunction;

  constructor(scope: Construct, id: string, props: ErrorPipelineProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.logGroup = new logs.LogGroup(this, 'Central', {
      logGroupName: CENTRAL_ERRORS_LOG_GROUP,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.forwarder = new FcarFunction(this, 'Forwarder', {
      name: 'error-forwarder',
      forwardErrors: false,
      timeout: Duration.seconds(30),
      environment: { CENTRAL_ERRORS_LOG_GROUP },
    });
    this.logGroup.grantWrite(this.forwarder.fn); // CreateLogStream + PutLogEvents

    this.subscribed = FcarFunction.all(this).filter(
      (f) => f.forwardErrors && Stack.of(f) === stack,
    );
    for (const f of this.subscribed) {
      new logs.SubscriptionFilter(this, `Sub-${f.functionName}`, {
        logGroup: f.logGroup,
        destination: new destinations.LambdaDestination(this.forwarder.fn),
        filterPattern: ERROR_CANDIDATE_PATTERN,
        filterName: 'fcar-errors',
      });
    }

    // ---------- /fcar/errors → issue no GitHub (Triage) ----------
    this.errorToIssue = new FcarFunction(this, 'ErrorToIssue', {
      name: 'error-to-issue',
      forwardErrors: false, // seus erros não podem gerar issues (loop)
      timeout: Duration.seconds(60),
      environment: {
        TABLE_NAME: props.table.tableName,
        GITHUB_REPO: FCAR.repo,
        GITHUB_TOKEN_SECRET,
        MAX_ISSUES_PER_HOUR: '10',
        COMMENT_INTERVAL_MINUTES: '60',
      },
    });
    props.table.grantReadWriteData(this.errorToIssue.fn);
    secretsmanager.Secret.fromSecretNameV2(this, 'GithubToken', GITHUB_TOKEN_SECRET).grantRead(
      this.errorToIssue.fn,
    );
    this.errorToIssue.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${stack.region}:${stack.account}:inference-profile/${ISSUE_MODEL_ID}`,
          'arn:aws:bedrock:*::foundation-model/amazon.nova-micro-v1:0',
        ],
      }),
    );
    new logs.SubscriptionFilter(this, 'CentralToIssue', {
      logGroup: this.logGroup,
      destination: new destinations.LambdaDestination(this.errorToIssue.fn),
      filterPattern: logs.FilterPattern.allEvents(),
      filterName: 'fcar-error-to-issue',
    });
    const issueFailures = new logs.MetricFilter(this, 'ErrorToIssueFailures', {
      logGroup: this.errorToIssue.logGroup,
      filterPattern: logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
      metricNamespace: 'fcar',
      metricName: 'ErrorToIssueFailures',
      metricValue: '1',
      defaultValue: 0,
    });
    new cloudwatch.Alarm(this, 'ErrorToIssueFailing', {
      alarmName: 'fcar-error-to-issue-failing',
      alarmDescription: 'Erros não estão virando issues no GitHub (token, Bedrock ou GitHub fora)',
      metric: issueFailures.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Volume de erros no log central e falhas do próprio forwarder.
    const errorCount = new logs.MetricFilter(this, 'ErrorCount', {
      logGroup: this.logGroup,
      filterPattern: logs.FilterPattern.allEvents(),
      metricNamespace: 'fcar',
      metricName: 'CentralErrors',
      metricValue: '1',
      defaultValue: 0,
    });
    new cloudwatch.Alarm(this, 'ErrorsHigh', {
      alarmName: 'fcar-central-errors-high',
      alarmDescription: 'Muitos erros no /fcar/errors em 5 minutos',
      metric: errorCount.metric({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 20,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'ForwarderFailing', {
      alarmName: 'fcar-error-forwarder-failing',
      alarmDescription:
        'O forwarder de erros está falhando: erros podem não chegar ao /fcar/errors',
      metric: this.forwarder.fn.metricErrors({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}

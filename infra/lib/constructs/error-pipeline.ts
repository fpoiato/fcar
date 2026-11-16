import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as destinations from 'aws-cdk-lib/aws-logs-destinations';
import { Construct } from 'constructs';
import { FcarFunction } from './fcar-function.js';

export const CENTRAL_ERRORS_LOG_GROUP = '/fcar/errors';

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

  constructor(scope: Construct, id: string) {
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

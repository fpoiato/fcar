import { Logger, withHandler } from '@fcar/shared';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  } satisfies APIGatewayProxyResult;
}

export type HttpFn = (
  event: APIGatewayProxyEvent,
  context: Context,
  logger: Logger,
) => Promise<APIGatewayProxyResult>;

/**
 * Handler HTTP padrão: contexto de log, HttpError → resposta controlada (sem log de erro),
 * qualquer outra exceção → log `level=ERROR` (vai para /fcar/errors) e 500 com correlationId.
 */
export function httpHandler(service: string, fn: HttpFn) {
  const logger = new Logger(service);
  return withHandler(
    logger,
    async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
      const correlationId =
        event.headers?.['x-correlation-id'] ??
        event.headers?.['X-Correlation-Id'] ??
        event.requestContext?.requestId ??
        context.awsRequestId;
      try {
        const res = await fn(event, context, logger);
        return { ...res, headers: { ...res.headers, 'X-Correlation-Id': correlationId } };
      } catch (err) {
        if (err instanceof HttpError) {
          if (err.status >= 500) logger.error(err.message, err);
          return json(err.status, { error: err.code, message: err.message, correlationId });
        }
        logger.error('Unhandled error', err);
        return json(500, { error: 'internal_error', correlationId });
      }
    },
  );
}

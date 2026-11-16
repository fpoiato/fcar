import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { handler } from './handler.js';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

describe('health', () => {
  it('responde ok com a cor da stage', async () => {
    vi.stubEnv('FCAR_APP_VERSION', '1.2.3');
    const res = await handler(
      {
        headers: {},
        stageVariables: { color: 'green' },
        requestContext: { requestId: 'r' },
      } as unknown as APIGatewayProxyEvent,
      { awsRequestId: 'x' } as Context,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'ok',
      color: 'green',
      appVersion: '1.2.3',
    });
  });
});

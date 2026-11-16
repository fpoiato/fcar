import { describe, expect, it } from 'vitest';
import type { CentralError } from '../central-error.js';
import { issueBody, issueLabels, issueTitle, recurrenceComment } from './issue-body.js';

const e: CentralError = {
  timestamp: '2026-11-16T00:00:00Z',
  source: 'frontend',
  kind: 'exception',
  function: 'fcar-client-errors',
  logGroup: 'g',
  logStream: 's',
  eventId: '1',
  errorName: 'Error',
  message: 'falhou ``` @alguem closes #1',
  stack: 'at x',
  requestId: 'r1',
};
const a = {
  title: 'Falha ao carregar estoque',
  summary: 'resumo',
  probableCause: 'causa',
  suggestedSteps: ['passo'],
  suspectFiles: ['frontend/src/app/x.ts'],
};

describe('issue', () => {
  it('título e labels por origem, sempre em triage', () => {
    expect(issueTitle(e, a)).toBe('[erro frontend] Falha ao carregar estoque');
    expect(issueLabels(e)).toEqual([
      'type:error-frontend',
      'area:frontend',
      'area:observability',
      'status:triage',
    ]);
    expect(issueLabels({ ...e, source: 'backend' })[0]).toBe('type:error-backend');
  });

  it('corpo traz aviso, análise, evidência neutralizada e fingerprint', () => {
    const body = issueBody(e, a, { fingerprint: 'abc', ai: true });
    expect(body).toContain('dado não confiável');
    expect(body).toContain('Amazon Nova');
    expect(body).toContain('`frontend/src/app/x.ts`');
    expect(body).toContain('<!-- fcar-fingerprint:abc -->');
    expect(body.match(/```/g)).toHaveLength(2); // só a cerca do bloco de evidência
    expect(body).not.toMatch(/@alguem|closes #1/);
  });

  it('tabela de evidência não tem linhas vazias nem pipes soltos', () => {
    const body = issueBody({ ...e, color: undefined, requestId: 'a|b' }, a, {
      fingerprint: 'f',
      ai: true,
    });
    const table = body.slice(body.indexOf('| Campo |'), body.indexOf('```text')).trim().split('\n');
    expect(table.every((l) => l.startsWith('|'))).toBe(true);
    expect(body).toContain('a\\|b');
  });

  it('recorrência referencia a issue anterior', () => {
    expect(issueBody(e, a, { fingerprint: 'f', ai: false, previousIssue: 7 })).toContain(
      'Recorrência de #7',
    );
  });

  it('comentário de recorrência', () => {
    expect(recurrenceComment(5, e)).toContain('**5**');
  });
});

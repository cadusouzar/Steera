import { BadRequestException } from '@nestjs/common';
import { AntiCsrfHeaderGuard } from './anti-csrf-header.guard';

describe('AntiCsrfHeaderGuard', () => {
  let guard: AntiCsrfHeaderGuard;

  const buildContext = (headers: Record<string, string | undefined>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as any;

  beforeEach(() => {
    guard = new AntiCsrfHeaderGuard();
  });

  it('allows the request through when X-Requested-With: XMLHttpRequest is present', () => {
    expect(guard.canActivate(buildContext({ 'x-requested-with': 'XMLHttpRequest' }))).toBe(true);
  });

  it('rejects with 400 when the header is missing entirely', () => {
    expect(() => guard.canActivate(buildContext({}))).toThrow(BadRequestException);
  });

  it('rejects with 400 when the header has the wrong value', () => {
    expect(() => guard.canActivate(buildContext({ 'x-requested-with': 'fetch' }))).toThrow(BadRequestException);
  });
});

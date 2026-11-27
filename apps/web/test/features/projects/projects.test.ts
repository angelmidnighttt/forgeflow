import { describe, expect, it } from '@jest/globals';
import { ErrorCode, type Environment, type Project } from '@forgeflow/contracts';
import {
  ENVIRONMENT_NAME_TAKEN,
  formErrorsFrom,
  PROJECT_NAME_TAKEN,
} from '@/features/projects/form-errors';
import { withAddedEnvironment, withEnvironment } from '@/features/projects/project-state';
import { ApiError, NetworkError } from '@/lib/api-client';

const at = '2026-11-27T00:00:00.000Z';
const environment = (id: string, name: string, isProtected = false): Environment => ({
  id,
  name,
  protected: isProtected,
  createdAt: at,
});
const project: Project = {
  id: 'p',
  name: 'Checkout',
  environments: [
    environment('d', 'development'),
    environment('s', 'staging'),
    environment('p', 'production', true),
  ],
  createdAt: at,
};

describe('project state', () => {
  it('replaces a changed environment in place, keeping the order', () => {
    const updated = withEnvironment(project, environment('s', 'uat', true));
    expect(updated.environments.map((e) => [e.name, e.protected])).toEqual([
      ['development', false],
      ['uat', true],
      ['production', true],
    ]);
    expect(project.environments[1]!.name).toBe('staging');
  });

  it('adds a new environment last', () => {
    const added = withAddedEnvironment(project, environment('x', 'preview'));
    expect(added.environments.map((e) => e.name)).toEqual([
      'development',
      'staging',
      'production',
      'preview',
    ]);
  });
});

describe('formErrorsFrom', () => {
  it('shows a taken name under the name field', () => {
    const taken = new ApiError(409, ErrorCode.NameTaken, 'taken', { field: 'name' });
    expect(formErrorsFrom(taken, PROJECT_NAME_TAKEN)).toEqual({
      fields: { name: PROJECT_NAME_TAKEN },
      form: null,
    });
    expect(formErrorsFrom(taken, ENVIRONMENT_NAME_TAKEN).fields.name).toBe(ENVIRONMENT_NAME_TAKEN);
  });

  it('shows anything else above the form', () => {
    expect(formErrorsFrom(new ApiError(403, ErrorCode.RoleNotAllowed, 'no'), 'x')).toEqual({
      fields: {},
      form: 'Vai trò của bạn không được phép làm việc này.',
    });
    expect(formErrorsFrom(new NetworkError(new Error('offline')), 'x').form).toMatch(
      /Không kết nối được/,
    );
  });
});

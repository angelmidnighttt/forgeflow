import { describe, expect, it } from '@jest/globals';
import { AUDIT_ACTIONS } from '@forgeflow/contracts';
import {
  auditActorName,
  describeAuditEntry,
  isDescribedAuditAction,
} from '@/features/organizations/audit-format';

describe('describeAuditEntry', () => {
  it('describes every action the API records', () => {
    for (const action of AUDIT_ACTIONS) expect(isDescribedAuditAction(action)).toBe(true);
  });

  it('reads like a sentence, with Vietnamese role names', () => {
    expect(
      describeAuditEntry({
        action: 'member.role_changed',
        metadata: { email: 'lan@example.test', name: 'Lan', from: 'member', to: 'admin' },
      }),
    ).toBe('Đổi vai trò của Lan từ thành viên thành quản trị viên');
    expect(
      describeAuditEntry({
        action: 'environment.renamed',
        metadata: { project: 'Checkout', from: 'staging', to: 'uat' },
      }),
    ).toBe('Đổi tên environment “staging” thành “uat” (project “Checkout”)');
    expect(
      describeAuditEntry({
        action: 'environment.created',
        metadata: { project: 'Checkout', name: 'eu', protected: true },
      }),
    ).toBe('Thêm environment “eu” vào project “Checkout”, có bảo vệ');
  });

  it('describes integration secrets without ever showing one', () => {
    expect(
      describeAuditEntry({
        action: 'integration.secret_rotated',
        metadata: {
          integration: 'Alertmanager',
          kind: 'alertmanager',
          secret: 'token',
          version: 3,
        },
      }),
    ).toBe('Đổi secret “token” của integration “Alertmanager” (phiên bản 3)');
    expect(
      describeAuditEntry({
        action: 'integration.created',
        metadata: { integration: 'acme-org', kind: 'github', secrets: [] },
      }),
    ).toBe('Kết nối integration “acme-org” (github)');
  });

  it('falls back to the email, and tells the special cases apart', () => {
    expect(
      describeAuditEntry({
        action: 'member.removed',
        metadata: { email: 'x@example.test', name: null, role: 'viewer' },
      }),
    ).toBe('Xoá x@example.test (người xem) khỏi organization');
    expect(
      describeAuditEntry({
        action: 'invitation.revoked',
        metadata: { email: 'y@example.test', role: 'member', reason: 'email_not_sent' },
      }),
    ).toBe('Huỷ lời mời gửi y@example.test vì không gửi được email');
    expect(
      describeAuditEntry({ action: 'invitation.accepted', metadata: { alreadyMember: true } }),
    ).toBe('Nhận lời mời khi đã là thành viên (giữ vai trò cũ)');
  });

  it('copes with actions and details it does not know', () => {
    expect(describeAuditEntry({ action: 'deployment.started', metadata: {} })).toBe(
      'Thao tác deployment.started',
    );
    expect(describeAuditEntry({ action: 'project.renamed', metadata: {} })).toBe(
      'Đổi tên project từ “?” thành “?”',
    );
  });
});

describe('auditActorName', () => {
  it('prefers the name, then the email', () => {
    const user = { type: 'user' as const, id: '00000000-0000-4000-8000-000000000000' };
    expect(auditActorName({ ...user, name: 'Lan', email: 'lan@example.test' })).toBe('Lan');
    expect(auditActorName({ ...user, name: null, email: 'lan@example.test' })).toBe(
      'lan@example.test',
    );
    expect(auditActorName({ type: 'user', id: null, name: null, email: null })).toBe(
      'Tài khoản đã bị xoá',
    );
    expect(auditActorName({ type: 'system', id: null, name: null, email: null })).toBe('ForgeFlow');
  });
});

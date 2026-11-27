import {
  ORGANIZATION_ROLES,
  type AuditLogEntry,
  type OrganizationRole,
} from '@forgeflow/contracts';
import { ROLE_LABELS } from './roles';

type Metadata = AuditLogEntry['metadata'];

/** A text detail of the entry, or "?" when it is missing (an entry written by an older version). */
function text(metadata: Metadata, key: string): string {
  const value = metadata[key];
  return typeof value === 'string' && value !== '' ? value : '?';
}

function quoted(metadata: Metadata, key: string): string {
  return `“${text(metadata, key)}”`;
}

function role(metadata: Metadata, key: string): string {
  const value = metadata[key];
  return ORGANIZATION_ROLES.includes(value as OrganizationRole)
    ? ROLE_LABELS[value as OrganizationRole].toLocaleLowerCase('vi-VN')
    : text(metadata, key);
}

function version(metadata: Metadata): string {
  const value = metadata.version;
  return typeof value === 'number' ? String(value) : '?';
}

/** The person an entry is about (a member): their name, else their email. */
function person(metadata: Metadata): string {
  const name = metadata.name;
  return typeof name === 'string' && name !== '' ? name : text(metadata, 'email');
}

const DESCRIBE: Record<string, (m: Metadata) => string> = {
  'organization.created': (m) => `Tạo organization ${quoted(m, 'name')}`,
  'organization.renamed': (m) =>
    `Đổi tên organization từ ${quoted(m, 'from')} thành ${quoted(m, 'to')}`,
  'member.role_changed': (m) =>
    `Đổi vai trò của ${person(m)} từ ${role(m, 'from')} thành ${role(m, 'to')}`,
  'member.removed': (m) => `Xoá ${person(m)} (${role(m, 'role')}) khỏi organization`,
  'member.left': () => 'Rời organization',
  'invitation.created': (m) => `Mời ${text(m, 'email')} với vai trò ${role(m, 'role')}`,
  'invitation.revoked': (m) =>
    m.reason === 'email_not_sent'
      ? `Huỷ lời mời gửi ${text(m, 'email')} vì không gửi được email`
      : `Thu hồi lời mời gửi ${text(m, 'email')}`,
  'invitation.accepted': (m) =>
    m.alreadyMember === true
      ? 'Nhận lời mời khi đã là thành viên (giữ vai trò cũ)'
      : `Nhận lời mời, tham gia với vai trò ${role(m, 'role')}`,
  'project.created': (m) => `Tạo project ${quoted(m, 'name')}`,
  'project.renamed': (m) => `Đổi tên project từ ${quoted(m, 'from')} thành ${quoted(m, 'to')}`,
  'environment.created': (m) =>
    `Thêm environment ${quoted(m, 'name')} vào project ${quoted(m, 'project')}` +
    (m.protected === true ? ', có bảo vệ' : ''),
  'environment.renamed': (m) =>
    `Đổi tên environment ${quoted(m, 'from')} thành ${quoted(m, 'to')} (project ${quoted(m, 'project')})`,
  'environment.protected': (m) =>
    `Bật bảo vệ cho environment ${quoted(m, 'name')} (project ${quoted(m, 'project')})`,
  'integration.created': (m) =>
    `Kết nối integration ${quoted(m, 'integration')} (${text(m, 'kind')})`,
  'integration.secret_rotated': (m) =>
    `Đổi secret ${quoted(m, 'secret')} của integration ${quoted(m, 'integration')} (phiên bản ${version(m)})`,
  'integration.secret_revoked': (m) =>
    `Thu hồi secret ${quoted(m, 'secret')} của integration ${quoted(m, 'integration')}`,
  'environment.unprotected': (m) =>
    `Tắt bảo vệ cho environment ${quoted(m, 'name')} (project ${quoted(m, 'project')})`,
};

/** What an entry records, as a Vietnamese sentence without its actor ("Đổi vai trò của …"). */
export function describeAuditEntry(entry: Pick<AuditLogEntry, 'action' | 'metadata'>): string {
  const describe = DESCRIBE[entry.action];
  return describe ? describe(entry.metadata) : `Thao tác ${entry.action}`;
}

/** Who acted: their name, else their email; ForgeFlow itself, or an account that is gone. */
export function auditActorName(actor: AuditLogEntry['actor']): string {
  if (actor.type === 'system') return 'ForgeFlow';
  return actor.name ?? actor.email ?? 'Tài khoản đã bị xoá';
}

/** Whether the web app knows how to describe `action` (the API may add actions later). */
export function isDescribedAuditAction(action: string): boolean {
  return action in DESCRIBE;
}
